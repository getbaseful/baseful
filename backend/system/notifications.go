package system

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/smtp"
	"strings"
	"time"

	"baseful/db"
)

func SendSMTPEmail(settings db.NotificationSettings, toEmail, subject, body string) error {
	smtpHost := strings.TrimSpace(settings.SMTPHost)
	fromEmail := strings.TrimSpace(settings.SMTPFromEmail)
	toEmail = strings.TrimSpace(toEmail)
	if smtpHost == "" {
		return fmt.Errorf("smtp host is required")
	}
	if settings.SMTPPort < 1 || settings.SMTPPort > 65535 {
		return fmt.Errorf("smtp port must be between 1 and 65535")
	}
	if fromEmail == "" {
		return fmt.Errorf("from email is required")
	}
	if toEmail == "" {
		return fmt.Errorf("recipient email is required")
	}

	fromHeader := fromEmail
	if fromName := strings.TrimSpace(settings.SMTPFromName); fromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", fromName, fromEmail)
	}

	msg := strings.Join([]string{
		fmt.Sprintf("From: %s", fromHeader),
		fmt.Sprintf("To: %s", toEmail),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")

	var auth smtp.Auth
	if username := strings.TrimSpace(settings.SMTPUsername); username != "" {
		auth = smtp.PlainAuth("", username, settings.SMTPPassword, smtpHost)
	}

	addr := fmt.Sprintf("%s:%d", smtpHost, settings.SMTPPort)
	if err := smtp.SendMail(addr, auth, fromEmail, []string{toEmail}, []byte(msg)); err != nil {
		return fmt.Errorf("failed to send smtp email: %w", err)
	}

	return nil
}

func SendDiscordWebhook(webhookURL, content string) error {
	webhookURL = strings.TrimSpace(webhookURL)
	if webhookURL == "" {
		return fmt.Errorf("discord webhook url is required")
	}

	payload, err := json.Marshal(map[string]string{"content": content})
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Post(webhookURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to send webhook request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("discord webhook returned %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	return nil
}
