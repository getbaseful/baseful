package backups

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"baseful/db"
)

type BackupCardProfile struct {
	CardID           string
	OwnerUserID      sql.NullInt64
	SourceDatabaseID sql.NullInt64
	Settings         BackupSettings
}

type legacyTopologyBackupCard struct {
	ID         string         `json:"id"`
	DatabaseID *int           `json:"databaseId"`
	Config     BackupSettings `json:"config"`
}

func sanitizeStoredSecret(secret string) (string, bool) {
	trimmed := strings.TrimSpace(secret)
	return "", trimmed != ""
}

func maskStoredAccessKey(accessKey string) (string, bool) {
	trimmed := strings.TrimSpace(accessKey)
	if trimmed == "" {
		return "", false
	}
	if len(trimmed) <= 4 {
		return "****", true
	}
	return strings.Repeat("*", len(trimmed)-4) + trimmed[len(trimmed)-4:], true
}

func SanitizeBackupSettingsForResponse(settings *BackupSettings) *BackupSettings {
	if settings == nil {
		return nil
	}

	sanitized := *settings
	sanitized.AccessKey, sanitized.HasAccessKey = maskStoredAccessKey(settings.AccessKey)
	sanitized.SecretKey, sanitized.HasSecretKey = sanitizeStoredSecret(settings.SecretKey)
	return &sanitized
}

func PrepareBackupSettingsForSave(databaseID int, settings *BackupSettings) error {
	if settings == nil {
		return fmt.Errorf("settings are required")
	}

	existing, err := GetBackupSettings(databaseID)
	if err != nil {
		return err
	}

	if strings.TrimSpace(settings.AccessKey) == "" && existing != nil {
		settings.AccessKey = existing.AccessKey
	}
	if strings.TrimSpace(settings.SecretKey) == "" && existing != nil {
		settings.SecretKey = existing.SecretKey
	}
	return nil
}

func buildBackupCardProfileFromSource(sourceDatabaseID *int, requested BackupSettings) (BackupSettings, error) {
	resolved := requested
	if sourceDatabaseID == nil || *sourceDatabaseID <= 0 {
		return resolved, nil
	}

	sourceSettings, err := GetBackupSettings(*sourceDatabaseID)
	if err != nil {
		return BackupSettings{}, err
	}
	if sourceSettings == nil || !sourceSettings.Enabled {
		return BackupSettings{}, fmt.Errorf("source database backup settings are not enabled")
	}

	resolved = *sourceSettings
	resolved.DatabaseID = 0

	if strings.TrimSpace(requested.Provider) != "" {
		resolved.Provider = requested.Provider
	}
	if strings.TrimSpace(requested.Endpoint) != "" {
		resolved.Endpoint = requested.Endpoint
	}
	if strings.TrimSpace(requested.Region) != "" {
		resolved.Region = requested.Region
	}
	if strings.TrimSpace(requested.Bucket) != "" {
		resolved.Bucket = requested.Bucket
	}
	if strings.TrimSpace(requested.AccessKey) != "" {
		resolved.AccessKey = requested.AccessKey
	}
	if strings.TrimSpace(requested.SecretKey) != "" {
		resolved.SecretKey = requested.SecretKey
	}
	if strings.TrimSpace(requested.PathPrefix) != "" {
		resolved.PathPrefix = requested.PathPrefix
	}
	resolved.AutomationEnabled = requested.AutomationEnabled
	if strings.TrimSpace(requested.AutomationFrequency) != "" {
		resolved.AutomationFrequency = requested.AutomationFrequency
	}
	resolved.EncryptionEnabled = requested.EncryptionEnabled
	if strings.TrimSpace(requested.EncryptionPublicKey) != "" || !requested.EncryptionEnabled {
		resolved.EncryptionPublicKey = requested.EncryptionPublicKey
	}
	resolved.Enabled = true

	return resolved, nil
}

func UpsertBackupCardProfile(cardID string, ownerUserID int, sourceDatabaseID *int, settings BackupSettings) error {
	if strings.TrimSpace(cardID) == "" {
		return fmt.Errorf("card id is required")
	}

	var ownerValue any
	if ownerUserID > 0 {
		ownerValue = ownerUserID
	}

	var sourceValue any
	if sourceDatabaseID != nil && *sourceDatabaseID > 0 {
		sourceValue = *sourceDatabaseID
	}

	settings.DatabaseID = 0
	if settings.AutomationFrequency == "" {
		settings.AutomationFrequency = "daily"
	}

	_, err := db.DB.Exec(`
		INSERT INTO topology_backup_card_profiles (
			card_id, owner_user_id, source_database_id,
			provider, endpoint, region, bucket, access_key, secret_key, path_prefix,
			automation_enabled, automation_frequency, encryption_enabled, encryption_public_key, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(card_id) DO UPDATE SET
			owner_user_id = COALESCE(excluded.owner_user_id, topology_backup_card_profiles.owner_user_id),
			source_database_id = COALESCE(excluded.source_database_id, topology_backup_card_profiles.source_database_id),
			provider = excluded.provider,
			endpoint = excluded.endpoint,
			region = excluded.region,
			bucket = excluded.bucket,
			access_key = excluded.access_key,
			secret_key = excluded.secret_key,
			path_prefix = excluded.path_prefix,
			automation_enabled = excluded.automation_enabled,
			automation_frequency = excluded.automation_frequency,
			encryption_enabled = excluded.encryption_enabled,
			encryption_public_key = excluded.encryption_public_key,
			updated_at = CURRENT_TIMESTAMP
	`, cardID, ownerValue, sourceValue, settings.Provider, settings.Endpoint, settings.Region, settings.Bucket, settings.AccessKey, settings.SecretKey, settings.PathPrefix, settings.AutomationEnabled, settings.AutomationFrequency, settings.EncryptionEnabled, settings.EncryptionPublicKey)
	return err
}

func GetBackupCardProfile(cardID string) (*BackupCardProfile, error) {
	var profile BackupCardProfile
	profile.CardID = cardID
	profile.Settings.DatabaseID = 0

	err := db.DB.QueryRow(`
		SELECT owner_user_id, source_database_id, provider, endpoint, region, bucket, access_key, secret_key, path_prefix,
		       COALESCE(automation_enabled, 0), COALESCE(automation_frequency, 'daily'),
		       COALESCE(encryption_enabled, 0), COALESCE(encryption_public_key, '')
		FROM topology_backup_card_profiles
		WHERE card_id = ?
	`, cardID).Scan(
		&profile.OwnerUserID, &profile.SourceDatabaseID, &profile.Settings.Provider, &profile.Settings.Endpoint, &profile.Settings.Region,
		&profile.Settings.Bucket, &profile.Settings.AccessKey, &profile.Settings.SecretKey, &profile.Settings.PathPrefix,
		&profile.Settings.AutomationEnabled, &profile.Settings.AutomationFrequency,
		&profile.Settings.EncryptionEnabled, &profile.Settings.EncryptionPublicKey,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	profile.Settings.Enabled = true
	return &profile, nil
}

func DeleteBackupCardProfile(cardID string) error {
	_, err := db.DB.Exec("DELETE FROM topology_backup_card_profiles WHERE card_id = ?", cardID)
	return err
}

func EnsureBackupCardProfileFromDatabase(cardID string, ownerUserID int, databaseID int) error {
	settings, err := GetBackupSettings(databaseID)
	if err != nil {
		return err
	}
	if settings == nil || !settings.Enabled {
		return fmt.Errorf("database backup settings are not enabled")
	}

	sourceDatabaseID := databaseID
	return UpsertBackupCardProfile(cardID, ownerUserID, &sourceDatabaseID, *settings)
}

func CreateBackupCardProfile(cardID string, ownerUserID int, sourceDatabaseID *int, requested BackupSettings) (*BackupCardProfile, error) {
	resolved, err := buildBackupCardProfileFromSource(sourceDatabaseID, requested)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(resolved.AccessKey) == "" || strings.TrimSpace(resolved.SecretKey) == "" {
		return nil, fmt.Errorf("backup credentials are required")
	}

	if err := UpsertBackupCardProfile(cardID, ownerUserID, sourceDatabaseID, resolved); err != nil {
		return nil, err
	}

	return GetBackupCardProfile(cardID)
}

func MigrateLegacyTopologyBackupCardProfiles() error {
	var backupCardsJSON string
	err := db.DB.QueryRow(
		"SELECT backup_cards_json FROM topology_service_cards WHERE id = 1",
	).Scan(&backupCardsJSON)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}

	var backupCards []legacyTopologyBackupCard
	if err := json.Unmarshal([]byte(backupCardsJSON), &backupCards); err != nil {
		return nil
	}

	for _, card := range backupCards {
		if strings.TrimSpace(card.ID) == "" {
			continue
		}

		existing, err := GetBackupCardProfile(card.ID)
		if err != nil {
			return err
		}
		if existing != nil {
			continue
		}

		if strings.TrimSpace(card.Config.AccessKey) == "" &&
			strings.TrimSpace(card.Config.SecretKey) == "" &&
			(card.DatabaseID == nil || *card.DatabaseID <= 0) {
			continue
		}

		var sourceDatabaseID *int
		if card.DatabaseID != nil && *card.DatabaseID > 0 {
			sourceDatabaseID = card.DatabaseID
		}

		if err := UpsertBackupCardProfile(card.ID, 0, sourceDatabaseID, card.Config); err != nil {
			return err
		}
	}

	return nil
}
