package db

import "database/sql"

var GlobalNotificationEventDefaults = map[string]bool{
	NotificationEventAuthLoginFailed:       false,
	NotificationEventAuthRegisterBlocked:   true,
	NotificationEventAuthRegisterSuccess:   false,
	NotificationEventProxyGlobalFailed:     true,
	NotificationEventProxyGlobalProhibited: true,
}

func SupportedGlobalNotificationEvents() []string {
	return []string{
		NotificationEventAuthLoginFailed,
		NotificationEventAuthRegisterBlocked,
		NotificationEventAuthRegisterSuccess,
		NotificationEventProxyGlobalFailed,
		NotificationEventProxyGlobalProhibited,
	}
}

func IsSupportedGlobalNotificationEvent(eventKey string) bool {
	_, ok := GlobalNotificationEventDefaults[eventKey]
	return ok
}

func defaultGlobalNotificationPreferences() map[string]bool {
	prefs := make(map[string]bool, len(GlobalNotificationEventDefaults))
	for key, val := range GlobalNotificationEventDefaults {
		prefs[key] = val
	}
	return prefs
}

func GetGlobalNotificationPreferences() (map[string]bool, error) {
	prefs := defaultGlobalNotificationPreferences()

	rows, err := DB.Query(`
		SELECT event_key, enabled
		FROM system_notification_preferences
	`)
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
		if IsSupportedGlobalNotificationEvent(key) {
			prefs[key] = enabled
		}
	}

	return prefs, nil
}

func UpsertGlobalNotificationPreferences(prefs map[string]bool) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, key := range SupportedGlobalNotificationEvents() {
		enabled := GlobalNotificationEventDefaults[key]
		if val, ok := prefs[key]; ok {
			enabled = val
		}
		if _, err := tx.Exec(`
			INSERT INTO system_notification_preferences (event_key, enabled, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(event_key) DO UPDATE SET
				enabled = excluded.enabled,
				updated_at = CURRENT_TIMESTAMP
		`, key, enabled); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func IsGlobalNotificationEventEnabled(eventKey string) (bool, error) {
	if !IsSupportedGlobalNotificationEvent(eventKey) {
		return false, nil
	}

	var enabled bool
	err := DB.QueryRow(`
		SELECT enabled
		FROM system_notification_preferences
		WHERE event_key = ?
	`, eventKey).Scan(&enabled)
	if err == sql.ErrNoRows {
		return GlobalNotificationEventDefaults[eventKey], nil
	}
	if err != nil {
		return false, err
	}
	return enabled, nil
}
