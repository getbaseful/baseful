package main

import (
	"bytes"
	"context"
	"errors"
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
)

const (
	defaultDatabaseBindIP        = "127.0.0.1"
	defaultProxyRoleReadyTimeout = 45 * time.Second
)

func getDatabaseHostBindIP() string {
	if bindIP := strings.TrimSpace(os.Getenv("DATABASE_BIND_IP")); bindIP != "" {
		return bindIP
	}
	return defaultDatabaseBindIP
}

func quoteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func quoteLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}

func runContainerCommand(ctx context.Context, cli *client.Client, containerID string, cmd []string) (string, string, int, error) {
	execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return "", "", 0, err
	}

	attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
	if err != nil {
		return "", "", 0, err
	}
	defer attachResp.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if _, err := stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader); err != nil && err != io.EOF {
		return stdout.String(), stderr.String(), 0, err
	}

	inspectResp, err := cli.ContainerExecInspect(ctx, execResp.ID)
	if err != nil {
		return stdout.String(), stderr.String(), 0, err
	}

	return stdout.String(), stderr.String(), inspectResp.ExitCode, nil
}

func waitForContainerPostgres(ctx context.Context, cli *client.Client, containerID string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error

	for time.Now().Before(deadline) {
		stdout, stderr, exitCode, err := runContainerCommand(ctx, cli, containerID, []string{"pg_isready", "-U", "postgres"})
		if err == nil && exitCode == 0 {
			return nil
		}

		msg := strings.TrimSpace(stdout + "\n" + stderr)
		if msg == "" && err != nil {
			msg = err.Error()
		}
		if msg != "" {
			lastErr = fmt.Errorf("%s", msg)
		} else {
			lastErr = fmt.Errorf("pg_isready exit code %d", exitCode)
		}
		time.Sleep(time.Second)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("timeout waiting for postgres")
	}
	return lastErr
}

func runPostgresSQL(ctx context.Context, cli *client.Client, containerID, databaseName, sqlText string) error {
	cmd := []string{
		"psql",
		"-v", "ON_ERROR_STOP=1",
		"-U", "postgres",
		"-d", databaseName,
		"-c", sqlText,
	}
	stdout, stderr, exitCode, err := runContainerCommand(ctx, cli, containerID, cmd)
	if err != nil {
		return err
	}
	if exitCode != 0 {
		message := strings.TrimSpace(stderr)
		if message == "" {
			message = strings.TrimSpace(stdout)
		}
		if message == "" {
			message = fmt.Sprintf("psql exited with code %d", exitCode)
		}
		return fmt.Errorf("%s", message)
	}
	return nil
}

func ensureDatabaseProxyAccessWithCredentials(ctx context.Context, cli *client.Client, databaseID int, databaseName, containerID, existingUser, existingPass string) (string, string, error) {
	proxyUser := strings.TrimSpace(existingUser)
	proxyPass := strings.TrimSpace(existingPass)
	if proxyUser == "" {
		proxyUser = fmt.Sprintf("baseful_proxy_%d", databaseID)
	}
	if proxyPass == "" {
		password, err := generatePassword(32)
		if err != nil {
			return "", "", err
		}
		proxyPass = password
	}

	if err := waitForContainerPostgres(ctx, cli, containerID, defaultProxyRoleReadyTimeout); err != nil {
		return "", "", fmt.Errorf("postgres readiness check failed: %w", err)
	}

	roleSQL := fmt.Sprintf(`
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %s) THEN
        CREATE ROLE %s LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    ELSE
        ALTER ROLE %s WITH LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END $$;
`, quoteLiteral(proxyUser), quoteIdentifier(proxyUser), quoteLiteral(proxyPass), quoteIdentifier(proxyUser), quoteLiteral(proxyPass))
	if err := runPostgresSQL(ctx, cli, containerID, "postgres", roleSQL); err != nil {
		return "", "", fmt.Errorf("failed to create proxy role: %w", err)
	}

	databaseSQL := fmt.Sprintf(`
ALTER DATABASE %s OWNER TO %s;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %s TO %s;
`, quoteIdentifier(databaseName), quoteIdentifier(proxyUser), quoteIdentifier(databaseName), quoteIdentifier(proxyUser))
	if err := runPostgresSQL(ctx, cli, containerID, "postgres", databaseSQL); err != nil {
		return "", "", fmt.Errorf("failed to grant proxy database access: %w", err)
	}

	schemaSQL := fmt.Sprintf(`
ALTER SCHEMA public OWNER TO %s;
GRANT USAGE, CREATE ON SCHEMA public TO %s;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %s;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %s;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO %s;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO %s;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO %s;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO %s;
ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO %s;
ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO %s;
ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO %s;
`, quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser), quoteIdentifier(proxyUser))
	if err := runPostgresSQL(ctx, cli, containerID, databaseName, schemaSQL); err != nil {
		return "", "", fmt.Errorf("failed to grant proxy schema access: %w", err)
	}

	if _, err := db.DB.Exec(
		"UPDATE databases SET proxy_username = ?, proxy_password = ? WHERE id = ?",
		proxyUser, proxyPass, databaseID,
	); err != nil {
		return "", "", fmt.Errorf("failed to persist proxy role credentials: %w", err)
	}

	return proxyUser, proxyPass, nil
}

func ensureDatabaseProxyAccessByID(ctx context.Context, cli *client.Client, databaseID int) error {
	var databaseName, containerID, proxyUser, proxyPass string
	err := db.DB.QueryRow(
		"SELECT name, container_id, COALESCE(proxy_username, ''), COALESCE(proxy_password, '') FROM databases WHERE id = ?",
		databaseID,
	).Scan(&databaseName, &containerID, &proxyUser, &proxyPass)
	if err != nil {
		return err
	}

	_, _, err = ensureDatabaseProxyAccessWithCredentials(ctx, cli, databaseID, databaseName, containerID, proxyUser, proxyPass)
	return err
}

func provisionExistingDatabaseProxyAccess() error {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to connect to Docker while provisioning proxy roles: %w", err)
	}
	defer cli.Close()

	rows, err := db.DB.Query(`
		SELECT id, name, container_id, COALESCE(proxy_username, ''), COALESCE(proxy_password, ''), COALESCE(status, '')
		FROM databases
		WHERE COALESCE(container_id, '') <> ''
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var failures []string
	for rows.Next() {
		var databaseID int
		var databaseName, containerID, proxyUser, proxyPass, status string
		if err := rows.Scan(&databaseID, &databaseName, &containerID, &proxyUser, &proxyPass, &status); err != nil {
			return err
		}

		inspect, inspectErr := cli.ContainerInspect(ctx, containerID)
		if inspectErr != nil || inspect.State == nil || !inspect.State.Running {
			if strings.TrimSpace(proxyUser) == "" || strings.TrimSpace(proxyPass) == "" {
				log.Printf("Skipping proxy role provisioning for database %d until container is running\n", databaseID)
			}
			continue
		}

		if _, _, err := ensureDatabaseProxyAccessWithCredentials(ctx, cli, databaseID, databaseName, containerID, proxyUser, proxyPass); err != nil {
			failures = append(failures, fmt.Sprintf("database %d: %v", databaseID, err))
		}

		// Keep status aligned with the container state while we are inspecting it.
		if status != "active" {
			_, _ = db.DB.Exec("UPDATE databases SET status = 'active' WHERE id = ?", databaseID)
		}
	}

	if len(failures) > 0 {
		return errors.New(strings.Join(failures, "; "))
	}
	return rows.Err()
}

func warnAboutLegacyPublicDatabaseBindings() {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Printf("Warning: failed to inspect legacy database port bindings: %v\n", err)
		return
	}
	defer cli.Close()

	type containerBindingTarget struct {
		containerID string
		label       string
	}

	targets := []containerBindingTarget{}

	dbRows, err := db.DB.Query("SELECT COALESCE(container_id, ''), name FROM databases WHERE COALESCE(container_id, '') <> ''")
	if err == nil {
		defer dbRows.Close()
		for dbRows.Next() {
			var containerID, name string
			if scanErr := dbRows.Scan(&containerID, &name); scanErr == nil && containerID != "" {
				targets = append(targets, containerBindingTarget{
					containerID: containerID,
					label:       "database " + name,
				})
			}
		}
	}

	branchRows, err := db.DB.Query(`
		SELECT COALESCE(container_id, ''), COALESCE(name, '')
		FROM branches
		WHERE COALESCE(container_id, '') <> ''
	`)
	if err == nil {
		defer branchRows.Close()
		for branchRows.Next() {
			var containerID, name string
			if scanErr := branchRows.Scan(&containerID, &name); scanErr == nil && containerID != "" {
				targets = append(targets, containerBindingTarget{
					containerID: containerID,
					label:       "branch " + name,
				})
			}
		}
	}

	for _, target := range targets {
		inspect, inspectErr := cli.ContainerInspect(ctx, target.containerID)
		if inspectErr != nil || inspect.NetworkSettings == nil {
			continue
		}

		for port, bindings := range inspect.NetworkSettings.Ports {
			if string(port) != "5432/tcp" {
				continue
			}
			for _, binding := range bindings {
				hostIP := strings.TrimSpace(binding.HostIP)
				if hostIP == "" || hostIP == "0.0.0.0" || hostIP == "::" {
					log.Printf("Warning: %s container %s still exposes %s on %s:%s. Existing containers must be recreated or host-firewalled manually to remove direct public database access.\n", target.label, target.containerID[:12], port, binding.HostIP, binding.HostPort)
				}
			}
		}
	}
}
