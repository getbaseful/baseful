package db

import (
	"database/sql"
)

const (
	NotificationEventBackupFailed              = "backup_failed"
	NotificationEventBackupCompleted           = "backup_completed"
	NotificationEventRestoreStarted            = "restore_started"
	NotificationEventRestoreFailed             = "restore_failed"
	NotificationEventRestoreCompleted          = "restore_completed"
	NotificationEventProxyConnectionFailed     = "proxy_connection_failed"
	NotificationEventProxyConnectionProhibited = "proxy_connection_prohibited"
	NotificationEventProxyGlobalFailed         = "proxy_global_connection_failed"
	NotificationEventProxyGlobalProhibited     = "proxy_global_connection_prohibited"
	NotificationEventAuthLoginFailed           = "auth_login_failed"
	NotificationEventAuthRegisterBlocked       = "auth_register_not_whitelisted"
	NotificationEventAuthRegisterSuccess       = "auth_register_success"
)

var DatabaseNotificationEventDefaults = map[string]bool{
	NotificationEventBackupFailed:              true,
	NotificationEventBackupCompleted:           false,
	NotificationEventRestoreStarted:            true,
	NotificationEventRestoreFailed:             true,
	NotificationEventRestoreCompleted:          true,
	NotificationEventProxyConnectionFailed:     true,
	NotificationEventProxyConnectionProhibited: true,
}

func SupportedDatabaseNotificationEvents() []string {
	return []string{
		NotificationEventBackupFailed,
		NotificationEventBackupCompleted,
		NotificationEventRestoreStarted,
		NotificationEventRestoreFailed,
		NotificationEventRestoreCompleted,
		NotificationEventProxyConnectionFailed,
		NotificationEventProxyConnectionProhibited,
	}
}

func IsSupportedDatabaseNotificationEvent(eventKey string) bool {
	_, ok := DatabaseNotificationEventDefaults[eventKey]
	return ok
}

func defaultDatabaseNotificationPreferences() map[string]bool {
	prefs := make(map[string]bool, len(DatabaseNotificationEventDefaults))
	for key, val := range DatabaseNotificationEventDefaults {
		prefs[key] = val
	}
	return prefs
}

func GetDatabaseNotificationPreferences(databaseID int) (map[string]bool, error) {
	prefs := defaultDatabaseNotificationPreferences()

	rows, err := DB.Query(`
		SELECT event_key, enabled
		FROM database_notification_preferences
		WHERE database_id = ?
	`, databaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		var enabled bool
		if err := rows.Scan(&key, &enabled); err != nil {
			return nil, err
		}
		if IsSupportedDatabaseNotificationEvent(key) {
			prefs[key] = enabled
		}
	}

	return prefs, nil
}

func UpsertDatabaseNotificationPreferences(databaseID int, prefs map[string]bool) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, key := range SupportedDatabaseNotificationEvents() {
		enabled := DatabaseNotificationEventDefaults[key]
		if val, ok := prefs[key]; ok {
			enabled = val
		}
		if _, err := tx.Exec(`
			INSERT INTO database_notification_preferences (database_id, event_key, enabled, updated_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(database_id, event_key) DO UPDATE SET
				enabled = excluded.enabled,
				updated_at = CURRENT_TIMESTAMP
		`, databaseID, key, enabled); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func IsNotificationEventEnabledForDatabase(databaseID int, eventKey string) (bool, error) {
	if !IsSupportedDatabaseNotificationEvent(eventKey) {
		return false, nil
	}

	var enabled bool
	err := DB.QueryRow(`
		SELECT enabled
		FROM database_notification_preferences
		WHERE database_id = ? AND event_key = ?
	`, databaseID, eventKey).Scan(&enabled)
	if err == sql.ErrNoRows {
		return DatabaseNotificationEventDefaults[eventKey], nil
	}
	if err != nil {
		return false, err
	}
	return enabled, nil
}
