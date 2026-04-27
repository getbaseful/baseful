package backups

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"baseful/db"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"golang.org/x/crypto/openpgp"
)

type BackupSettings struct {
	DatabaseID          int    `json:"database_id"`
	Enabled             bool   `json:"enabled"`
	Provider            string `json:"provider"`
	Endpoint            string `json:"endpoint"`
	Region              string `json:"region"`
	Bucket              string `json:"bucket"`
	AccessKey           string `json:"access_key"`
	SecretKey           string `json:"secret_key"`
	HasAccessKey        bool   `json:"has_access_key,omitempty"`
	HasSecretKey        bool   `json:"has_secret_key,omitempty"`
	PathPrefix          string `json:"path_prefix"`
	AutomationEnabled   bool   `json:"automation_enabled"`
	AutomationFrequency string `json:"automation_frequency"`
	EncryptionEnabled   bool   `json:"encryption_enabled"`
	EncryptionPublicKey string `json:"encryption_public_key"`
}

type Backup struct {
	ID          int    `json:"id"`
	DatabaseID  int    `json:"database_id"`
	Filename    string `json:"filename"`
	IsEncrypted bool   `json:"is_encrypted"`
	SizeBytes   int64  `json:"size_bytes"`
	Status      string `json:"status"`
	S3URL       string `json:"s3_url"`
	Error       string `json:"error"`
	CreatedAt   string `json:"created_at"`
}

type combinedReadCloser struct {
	io.Reader
	closer io.Closer
}

func (c *combinedReadCloser) Close() error {
	if c.closer != nil {
		return c.closer.Close()
	}
	return nil
}

func GetBackupSettings(databaseID int) (*BackupSettings, error) {
	var s BackupSettings
	s.DatabaseID = databaseID
	err := db.DB.QueryRow(`
		SELECT enabled, provider, endpoint, region, bucket, access_key, secret_key, path_prefix, COALESCE(automation_enabled, 0), COALESCE(automation_frequency, 'daily'), COALESCE(encryption_enabled, 0), COALESCE(encryption_public_key, '')
		FROM backup_settings WHERE database_id = ?
	`, databaseID).Scan(
		&s.Enabled, &s.Provider, &s.Endpoint, &s.Region, &s.Bucket, &s.AccessKey, &s.SecretKey, &s.PathPrefix, &s.AutomationEnabled, &s.AutomationFrequency, &s.EncryptionEnabled, &s.EncryptionPublicKey,
	)
	if err == sql.ErrNoRows {
		// Return defaults
		return &BackupSettings{
			DatabaseID:          databaseID,
			Enabled:             false,
			Provider:            "s3",
			Endpoint:            "",
			Region:              "us-east-1",
			PathPrefix:          "/baseful/backups",
			AutomationEnabled:   false,
			AutomationFrequency: "daily",
			EncryptionEnabled:   false,
			EncryptionPublicKey: "",
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func SaveBackupSettings(s *BackupSettings) error {
	if s.EncryptionEnabled {
		if strings.TrimSpace(s.EncryptionPublicKey) == "" {
			return fmt.Errorf("encryption is enabled but encryption_public_key is empty")
		}
	}
	if strings.TrimSpace(s.AutomationFrequency) == "" {
		s.AutomationFrequency = "daily"
	}

	_, err := db.DB.Exec(`
		INSERT INTO backup_settings (database_id, enabled, provider, endpoint, region, bucket, access_key, secret_key, path_prefix, automation_enabled, automation_frequency, encryption_enabled, encryption_public_key, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(database_id) DO UPDATE SET
			enabled=excluded.enabled,
			provider=excluded.provider,
			endpoint=excluded.endpoint,
			region=excluded.region,
			bucket=excluded.bucket,
			access_key=excluded.access_key,
			secret_key=excluded.secret_key,
			path_prefix=excluded.path_prefix,
			automation_enabled=excluded.automation_enabled,
			automation_frequency=excluded.automation_frequency,
			encryption_enabled=excluded.encryption_enabled,
			encryption_public_key=excluded.encryption_public_key,
			updated_at=CURRENT_TIMESTAMP
	`, s.DatabaseID, s.Enabled, s.Provider, s.Endpoint, s.Region, s.Bucket, s.AccessKey, s.SecretKey, s.PathPrefix, s.AutomationEnabled, s.AutomationFrequency, s.EncryptionEnabled, s.EncryptionPublicKey)
	return err
}

func ListBackups(databaseID int) ([]Backup, error) {
	// Get Settings for signing
	settings, _ := GetBackupSettings(databaseID)
	var minioClient *minio.Client
	if settings != nil && settings.Enabled && settings.AccessKey != "" {
		useSSL := !strings.HasPrefix(settings.Endpoint, "http://")
		endpoint := strings.TrimPrefix(strings.TrimPrefix(settings.Endpoint, "http://"), "https://")
		minioClient, _ = minio.New(endpoint, &minio.Options{
			Creds:        credentials.NewStaticV4(settings.AccessKey, settings.SecretKey, ""),
			Secure:       useSSL,
			Region:       settings.Region,
			BucketLookup: minio.BucketLookupPath,
		})
	}

	rows, err := db.DB.Query(`
		SELECT id, database_id, filename, object_key, is_encrypted, size_bytes, status, s3_url, error, created_at
		FROM backups WHERE database_id = ? ORDER BY created_at DESC
	`, databaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var backups []Backup
	for rows.Next() {
		var b Backup
		var isEncrypted sql.NullBool
		var sb sql.NullInt64
		var s3url, errStr, objKey sql.NullString
		if err := rows.Scan(&b.ID, &b.DatabaseID, &b.Filename, &objKey, &isEncrypted, &sb, &b.Status, &s3url, &errStr, &b.CreatedAt); err != nil {
			return nil, err
		}
		if isEncrypted.Valid {
			b.IsEncrypted = isEncrypted.Bool
		}
		if sb.Valid {
			b.SizeBytes = sb.Int64
		}
		if s3url.Valid {
			b.S3URL = s3url.String
		}
		if errStr.Valid {
			b.Error = errStr.String
		}

		// Generate signed URL for non-encrypted backups only
		if minioClient != nil && b.Status == "completed" && !b.IsEncrypted {
			key := ""
			if objKey.Valid && objKey.String != "" {
				key = objKey.String
			} else {
				// Fallback to reconstructing key from filename
				// This assumes prefix hasn't changed since backup
				key = fmt.Sprintf("%s/%s", strings.Trim(settings.PathPrefix, "/"), b.Filename)
				if settings.PathPrefix == "" || settings.PathPrefix == "/" {
					key = b.Filename
				}
			}

			// Sign it
			if key != "" {
				signedUrl, err := minioClient.PresignedGetObject(context.Background(), settings.Bucket, key, time.Hour*24, nil)
				if err == nil {
					b.S3URL = signedUrl.String()
				}
			}
		}

		backups = append(backups, b)
	}
	return backups, nil
}

func PerformBackup(databaseID int) error {
	settings, err := GetBackupSettings(databaseID)
	if err != nil {
		return fmt.Errorf("failed to get settings: %w", err)
	}

	// 1. Get Database Info
	var dbName, containerID string
	err = db.DB.QueryRow("SELECT name, container_id FROM databases WHERE id = ?", databaseID).Scan(&dbName, &containerID)
	if err != nil {
		return fmt.Errorf("database not found: %w", err)
	}

	// 2. Prepare S3 Client
	useSSL := !strings.HasPrefix(settings.Endpoint, "http://")
	endpoint := strings.TrimPrefix(strings.TrimPrefix(settings.Endpoint, "http://"), "https://")

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(settings.AccessKey, settings.SecretKey, ""),
		Secure:       useSSL,
		Region:       settings.Region,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return fmt.Errorf("failed to create s3 client: %w", err)
	}

	// 3. Prepare Docker Execution
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	// 4. Create Backup Record (Pending)
	filename := fmt.Sprintf("%s_%s.sql", dbName, time.Now().Format("20060102_150405"))
	isEncrypted := settings.EncryptionEnabled && strings.TrimSpace(settings.EncryptionPublicKey) != ""
	if settings.EncryptionEnabled && strings.TrimSpace(settings.EncryptionPublicKey) == "" {
		return fmt.Errorf("backup encryption is enabled but no public key is configured")
	}
	if isEncrypted {
		filename += ".gpg"
	}

	// Determine object key early
	objectName := fmt.Sprintf("%s/%s", strings.Trim(settings.PathPrefix, "/"), filename)
	if settings.PathPrefix == "" || settings.PathPrefix == "/" {
		objectName = filename
	}

	res, err := db.DB.Exec(`
		INSERT INTO backups (database_id, filename, object_key, is_encrypted, status, created_at)
		VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
	`, databaseID, filename, objectName, isEncrypted)
	if err != nil {
		return err
	}
	backupID, _ := res.LastInsertId()

	// Update status helper
	updateStatus := func(status, errorMsg string, size int64, s3Url string) {
		_, _ = db.DB.Exec(`
			UPDATE backups SET status = ?, error = ?, size_bytes = ?, s3_url = ? WHERE id = ?
		`, status, errorMsg, size, s3Url, backupID)
	}

	// 5. Exec pg_dump
	// Use --column-inserts for better compatibility if needed, or custom format -Fc
	// Defaulting to plain SQL for now as requested
	cmd := []string{"pg_dump", "-U", "postgres", dbName}
	execConfig := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := cli.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		updateStatus("failed", "Docker exec create failed: "+err.Error(), 0, "")
		return err
	}

	resp, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
	if err != nil {
		updateStatus("failed", "Docker exec attach failed: "+err.Error(), 0, "")
		return err
	}
	defer resp.Close()

	// 6. Stream to S3
	pr, pw := io.Pipe()
	var uploadErr error
	var uploadInfo minio.UploadInfo

	contentType := "application/sql"
	go func() {
		defer pw.Close()
		if isEncrypted {
			entities, parseErr := openpgp.ReadArmoredKeyRing(strings.NewReader(settings.EncryptionPublicKey))
			if parseErr != nil {
				pw.CloseWithError(fmt.Errorf("failed to parse armored public key (try RSA keypair for compatibility): %w", parseErr))
				return
			}
			encWriter, encErr := openpgp.Encrypt(pw, entities, nil, nil, nil)
			if encErr != nil {
				pw.CloseWithError(fmt.Errorf("failed to initialize encryption: %w", encErr))
				return
			}
			_, copyErr := stdcopy.StdCopy(encWriter, os.Stderr, resp.Reader)
			if copyErr != nil {
				log.Printf("StdCopy error: %v", copyErr)
				_ = encWriter.Close()
				pw.CloseWithError(copyErr)
				return
			}
			if closeErr := encWriter.Close(); closeErr != nil {
				pw.CloseWithError(closeErr)
			}
			return
		}

		_, err := stdcopy.StdCopy(pw, os.Stderr, resp.Reader)
		if err != nil {
			log.Printf("StdCopy error: %v", err)
			pw.CloseWithError(err)
		}
	}()

	if isEncrypted {
		contentType = "application/pgp-encrypted"
	}
	uploadInfo, uploadErr = minioClient.PutObject(ctx, settings.Bucket, objectName, pr, -1, minio.PutObjectOptions{
		ContentType: contentType,
	})

	if uploadErr != nil {
		updateStatus("failed", "S3 Upload failed: "+uploadErr.Error(), 0, "")
		return uploadErr
	}

	// 7. Success
	s3Url := fmt.Sprintf("%s/%s/%s", settings.Endpoint, settings.Bucket, objectName)
	updateStatus("completed", "", uploadInfo.Size, s3Url)

	return nil
}

func getBackupObjectReader(databaseID int, backupID int) (*Backup, io.ReadCloser, error) {
	var b Backup
	var objectKey sql.NullString
	err := db.DB.QueryRow(`SELECT filename, object_key, is_encrypted FROM backups WHERE id = ? AND database_id = ?`, backupID, databaseID).Scan(&b.Filename, &objectKey, &b.IsEncrypted)
	if err != nil {
		return nil, nil, fmt.Errorf("backup not found: %w", err)
	}
	b.ID = backupID
	b.DatabaseID = databaseID

	settings, err := GetBackupSettings(databaseID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get settings: %w", err)
	}

	useSSL := !strings.HasPrefix(settings.Endpoint, "http://")
	endpoint := strings.TrimPrefix(strings.TrimPrefix(settings.Endpoint, "http://"), "https://")

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(settings.AccessKey, settings.SecretKey, ""),
		Secure:       useSSL,
		Region:       settings.Region,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create s3 client: %w", err)
	}

	key := ""
	if objectKey.Valid && objectKey.String != "" {
		key = objectKey.String
	} else {
		key = fmt.Sprintf("%s/%s", strings.Trim(settings.PathPrefix, "/"), b.Filename)
		if settings.PathPrefix == "" || settings.PathPrefix == "/" {
			key = b.Filename
		}
	}

	object, err := minioClient.GetObject(context.Background(), settings.Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to download backup: %w", err)
	}
	return &b, object, nil
}

func decryptBackupStream(encrypted io.Reader, armoredPrivateKey, passphrase string) (io.Reader, error) {
	if strings.TrimSpace(armoredPrivateKey) == "" {
		return nil, fmt.Errorf("private key is required for encrypted backup")
	}

	entities, err := openpgp.ReadArmoredKeyRing(strings.NewReader(armoredPrivateKey))
	if err != nil {
		return nil, fmt.Errorf("invalid armored private key: %w", err)
	}

	passphraseBytes := []byte(passphrase)
	for _, entity := range entities {
		if entity.PrivateKey != nil && entity.PrivateKey.Encrypted {
			if err := entity.PrivateKey.Decrypt(passphraseBytes); err != nil {
				return nil, fmt.Errorf("failed to decrypt private key: %w", err)
			}
		}
		for i := range entity.Subkeys {
			if entity.Subkeys[i].PrivateKey != nil && entity.Subkeys[i].PrivateKey.Encrypted {
				if err := entity.Subkeys[i].PrivateKey.Decrypt(passphraseBytes); err != nil {
					return nil, fmt.Errorf("failed to decrypt private subkey: %w", err)
				}
			}
		}
	}

	md, err := openpgp.ReadMessage(encrypted, entities, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt backup content: %w", err)
	}
	return md.UnverifiedBody, nil
}

func GetBackupDownloadReader(databaseID int, backupID int, armoredPrivateKey, passphrase string) (io.ReadCloser, string, bool, error) {
	backup, object, err := getBackupObjectReader(databaseID, backupID)
	if err != nil {
		return nil, "", false, err
	}

	if !backup.IsEncrypted {
		return object, backup.Filename, false, nil
	}

	decryptedReader, err := decryptBackupStream(object, armoredPrivateKey, passphrase)
	if err != nil {
		_ = object.Close()
		return nil, "", true, err
	}

	filename := strings.TrimSuffix(backup.Filename, ".gpg")
	if filename == backup.Filename {
		filename = backup.Filename + ".decrypted.sql"
	}
	return &combinedReadCloser{Reader: decryptedReader, closer: object}, filename, true, nil
}

func RestoreBackupWithPrivateKey(databaseID int, backupID int, armoredPrivateKey, passphrase string) error {
	reader, _, wasEncrypted, err := GetBackupDownloadReader(databaseID, backupID, armoredPrivateKey, passphrase)
	if err != nil {
		return err
	}
	defer reader.Close()

	if !wasEncrypted {
		return fmt.Errorf("backup is not encrypted; use normal restore")
	}
	return RestoreFromFile(databaseID, reader)
}

func RestoreBackup(databaseID int, backupID int) error {
	backup, object, err := getBackupObjectReader(databaseID, backupID)
	if err != nil {
		return err
	}
	defer object.Close()
	if backup.IsEncrypted {
		return fmt.Errorf("this backup is encrypted and cannot be restored in-app; decrypt it outside Baseful and use External Restore > Upload File")
	}
	return RestoreFromFile(databaseID, object)
}

// RestoreFromFile restores a database from an uploaded SQL file
func RestoreFromFile(databaseID int, fileContent io.Reader) error {
	// 1. Get Database Info
	var dbName, containerID string
	err := db.DB.QueryRow("SELECT name, container_id FROM databases WHERE id = ?", databaseID).Scan(&dbName, &containerID)
	if err != nil {
		return fmt.Errorf("database not found: %w", err)
	}

	// 2. Docker Client
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	// Helper to exec and check
	execPsql := func(sqlCmd string, stepName string) error {
		fullCmd := fmt.Sprintf(`psql -U postgres -d postgres -c "%s"`, sqlCmd)
		execConfig := container.ExecOptions{
			Cmd:          []string{"/bin/sh", "-c", fullCmd},
			AttachStdout: true,
			AttachStderr: true,
		}
		execID, err := cli.ContainerExecCreate(ctx, containerID, execConfig)
		if err != nil {
			return fmt.Errorf("failed to create %s exec: %w", stepName, err)
		}
		resp, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
		if err != nil {
			return fmt.Errorf("failed to attach %s exec: %v", stepName, err)
		}
		defer resp.Close()

		var outBuf strings.Builder
		_, _ = io.Copy(&outBuf, resp.Reader)

		inspect, err := cli.ContainerExecInspect(ctx, execID.ID)
		if err != nil {
			return fmt.Errorf("failed to inspect %s exec: %v", stepName, err)
		}
		if inspect.ExitCode != 0 {
			return fmt.Errorf("failed during %s (exit %d): %s", stepName, inspect.ExitCode, outBuf.String())
		}
		return nil
	}

	// 3. Terminate Connections
	terminateCmd := fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid();", dbName)
	if err := execPsql(terminateCmd, "terminate connections"); err != nil {
		return err
	}

	// 4. Drop Database
	dropCmd := fmt.Sprintf("DROP DATABASE IF EXISTS \\\"%s\\\";", dbName)
	if err := execPsql(dropCmd, "drop database"); err != nil {
		return err
	}

	// 5. Create Database
	createCmd := fmt.Sprintf("CREATE DATABASE \\\"%s\\\";", dbName)
	if err := execPsql(createCmd, "create database"); err != nil {
		return err
	}

	// 6. Restore from file
	execConfigRestore := container.ExecOptions{
		Cmd:          []string{"psql", "-U", "postgres", "-d", dbName},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
	}

	execIDRestore, err := cli.ContainerExecCreate(ctx, containerID, execConfigRestore)
	if err != nil {
		return fmt.Errorf("failed to create restore exec: %w", err)
	}

	respRestore, err := cli.ContainerExecAttach(ctx, execIDRestore.ID, container.ExecStartOptions{})
	if err != nil {
		return fmt.Errorf("failed to attach restore exec: %v", err)
	}
	defer respRestore.Close()

	go func() {
		_, copyErr := io.Copy(respRestore.Conn, fileContent)
		if copyErr != nil {
			log.Printf("Error piping file to docker: %v", copyErr)
		}
		respRestore.CloseWrite()
	}()

	var restoreOutBuf strings.Builder
	_, copyErr := io.Copy(&restoreOutBuf, respRestore.Reader)
	if copyErr != nil {
		log.Printf("Error reading restore output: %v", copyErr)
	}

	inspectRestore, err := cli.ContainerExecInspect(ctx, execIDRestore.ID)
	if err != nil {
		return fmt.Errorf("failed to inspect restore exec: %w", err)
	}
	if inspectRestore.ExitCode != 0 {
		return fmt.Errorf("restore failed with exit code %d: %s", inspectRestore.ExitCode, restoreOutBuf.String())
	}

	return nil
}

// RestoreFromConnection restores a database from an external PostgreSQL connection
func RestoreFromConnection(databaseID int, connectionString string) error {
	// 1. Get Database Info
	var dbName, containerID string
	err := db.DB.QueryRow("SELECT name, container_id FROM databases WHERE id = ?", databaseID).Scan(&dbName, &containerID)
	if err != nil {
		return fmt.Errorf("database not found: %w", err)
	}

	// 2. Docker Client
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	// Helper to exec and check
	execPsql := func(sqlCmd string, stepName string) error {
		fullCmd := fmt.Sprintf(`psql -U postgres -d postgres -c "%s"`, sqlCmd)
		execConfig := container.ExecOptions{
			Cmd:          []string{"/bin/sh", "-c", fullCmd},
			AttachStdout: true,
			AttachStderr: true,
		}
		execID, err := cli.ContainerExecCreate(ctx, containerID, execConfig)
		if err != nil {
			return fmt.Errorf("failed to create %s exec: %w", stepName, err)
		}
		resp, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
		if err != nil {
			return fmt.Errorf("failed to attach %s exec: %v", stepName, err)
		}
		defer resp.Close()

		var outBuf strings.Builder
		_, _ = io.Copy(&outBuf, resp.Reader)

		inspect, err := cli.ContainerExecInspect(ctx, execID.ID)
		if err != nil {
			return fmt.Errorf("failed to inspect %s exec: %v", stepName, err)
		}
		if inspect.ExitCode != 0 {
			return fmt.Errorf("failed during %s (exit %d): %s", stepName, inspect.ExitCode, outBuf.String())
		}
		return nil
	}

	// 3. Terminate Connections
	terminateCmd := fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid();", dbName)
	if err := execPsql(terminateCmd, "terminate connections"); err != nil {
		return err
	}

	// 4. Drop Database
	dropCmd := fmt.Sprintf("DROP DATABASE IF EXISTS \\\"%s\\\";", dbName)
	if err := execPsql(dropCmd, "drop database"); err != nil {
		return err
	}

	// 5. Create Database
	createCmd := fmt.Sprintf("CREATE DATABASE \\\"%s\\\";", dbName)
	if err := execPsql(createCmd, "create database"); err != nil {
		return err
	}

	// 6. Restore from external database using pg_dump | psql
	// Use plain SQL format (-Fp) instead of custom format (-Fc) to avoid extension/ownership issues
	restoreCmd := fmt.Sprintf(`pg_dump -Fp "%s" | psql -U postgres -d "%s"`, connectionString, dbName)
	execConfigRestore := container.ExecOptions{
		Cmd:          []string{"/bin/sh", "-c", restoreCmd},
		AttachStdout: true,
		AttachStderr: true,
	}

	execIDRestore, err := cli.ContainerExecCreate(ctx, containerID, execConfigRestore)
	if err != nil {
		return fmt.Errorf("failed to create restore exec: %w", err)
	}

	respRestore, err := cli.ContainerExecAttach(ctx, execIDRestore.ID, container.ExecStartOptions{})
	if err != nil {
		return fmt.Errorf("failed to attach restore exec: %v", err)
	}
	defer respRestore.Close()

	var restoreOutBuf strings.Builder
	_, err = io.Copy(&restoreOutBuf, respRestore.Reader)
	if err != nil {
		log.Printf("Error reading restore output: %v", err)
	}

	inspectRestore, err := cli.ContainerExecInspect(ctx, execIDRestore.ID)
	if err != nil {
		return fmt.Errorf("failed to inspect restore exec: %w", err)
	}
	if inspectRestore.ExitCode != 0 {
		return fmt.Errorf("restore failed with exit code %d: %s", inspectRestore.ExitCode, restoreOutBuf.String())
	}

	return nil
}
