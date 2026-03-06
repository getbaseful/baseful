package db

import (
	"database/sql"
	"strings"
)

func IsNotificationsMasterEnabled() (bool, error) {
	value, err := GetSetting("notifications_master_enabled")
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strings.ToLower(strings.TrimSpace(value)) != "false", nil
}

func SetNotificationsMasterEnabled(enabled bool) error {
	if enabled {
		return UpdateSetting("notifications_master_enabled", "true")
	}
	return UpdateSetting("notifications_master_enabled", "false")
}
