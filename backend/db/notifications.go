package db

import "database/sql"

type NotificationSettings struct {
	SMTPHost          string `json:"smtp_host"`
	SMTPPort          int    `json:"smtp_port"`
	SMTPUsername      string `json:"smtp_username"`
	SMTPPassword      string `json:"smtp_password"`
	SMTPFromEmail     string `json:"smtp_from_email"`
	SMTPFromName      string `json:"smtp_from_name"`
	SMTPToEmail       string `json:"smtp_to_email"`
	DiscordWebhookURL string `json:"discord_webhook_url"`
}

func GetNotificationSettings() (*NotificationSettings, error) {
	var settings NotificationSettings
	err := DB.QueryRow(`
		SELECT
			COALESCE(smtp_host, ''),
			COALESCE(smtp_port, 587),
			COALESCE(smtp_username, ''),
			COALESCE(smtp_password, ''),
			COALESCE(smtp_from_email, ''),
			COALESCE(smtp_from_name, ''),
			COALESCE(smtp_to_email, ''),
			COALESCE(discord_webhook_url, '')
		FROM notification_settings
		WHERE id = 1
	`).Scan(
		&settings.SMTPHost,
		&settings.SMTPPort,
		&settings.SMTPUsername,
		&settings.SMTPPassword,
		&settings.SMTPFromEmail,
		&settings.SMTPFromName,
		&settings.SMTPToEmail,
		&settings.DiscordWebhookURL,
	)

	if err == sql.ErrNoRows {
		return &NotificationSettings{SMTPPort: 587}, nil
	}
	if err != nil {
		return nil, err
	}

	return &settings, nil
}

func UpdateNotificationSettings(settings NotificationSettings) error {
	_, err := DB.Exec(`
		INSERT INTO notification_settings (
			id,
			smtp_host,
			smtp_port,
			smtp_username,
			smtp_password,
			smtp_from_email,
			smtp_from_name,
			smtp_to_email,
			discord_webhook_url,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			smtp_host = excluded.smtp_host,
			smtp_port = excluded.smtp_port,
			smtp_username = excluded.smtp_username,
			smtp_password = excluded.smtp_password,
			smtp_from_email = excluded.smtp_from_email,
			smtp_from_name = excluded.smtp_from_name,
			smtp_to_email = excluded.smtp_to_email,
			discord_webhook_url = excluded.discord_webhook_url,
			updated_at = CURRENT_TIMESTAMP
	`,
		1,
		settings.SMTPHost,
		settings.SMTPPort,
		settings.SMTPUsername,
		settings.SMTPPassword,
		settings.SMTPFromEmail,
		settings.SMTPFromName,
		settings.SMTPToEmail,
		settings.DiscordWebhookURL,
	)
	return err
}
