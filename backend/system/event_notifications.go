package system

import (
	"fmt"
	"sync"
	"time"

	"baseful/db"
)

var (
	notificationCooldownMu sync.Mutex
	notificationCooldowns  = map[string]time.Time{}
)

func withinCooldown(key string, cooldown time.Duration) bool {
	if cooldown <= 0 {
		return false
	}
	notificationCooldownMu.Lock()
	defer notificationCooldownMu.Unlock()

	now := time.Now()
	until, ok := notificationCooldowns[key]
	if ok && until.After(now) {
		return true
	}
	notificationCooldowns[key] = now.Add(cooldown)
	return false
}

func deliverNotification(subject, body string) {
	masterEnabled, err := db.IsNotificationsMasterEnabled()
	if err != nil || !masterEnabled {
		return
	}

	settings, err := db.GetNotificationSettings()
	if err != nil {
		return
	}

	if settings.SMTPHost != "" && settings.SMTPFromEmail != "" && settings.SMTPToEmail != "" {
		_ = SendSMTPEmail(*settings, settings.SMTPToEmail, subject, body)
	}
	if settings.DiscordWebhookURL != "" {
		content := fmt.Sprintf("**%s**\n%s", subject, body)
		_ = SendDiscordWebhook(settings.DiscordWebhookURL, content)
	}
}

func NotifyDatabaseEventAsync(databaseID int, eventKey, subject, body string, cooldown time.Duration, dedupeSuffix string) {
	go func() {
		enabled, err := db.IsNotificationEventEnabledForDatabase(databaseID, eventKey)
		if err != nil || !enabled {
			return
		}

		cooldownKey := fmt.Sprintf("db:%d:event:%s:%s", databaseID, eventKey, dedupeSuffix)
		if withinCooldown(cooldownKey, cooldown) {
			return
		}

		deliverNotification(subject, body)
	}()
}

func NotifyGlobalEventAsync(eventKey, subject, body string, cooldown time.Duration, dedupeSuffix string) {
	go func() {
		enabled, err := db.IsGlobalNotificationEventEnabled(eventKey)
		if err != nil || !enabled {
			return
		}

		cooldownKey := fmt.Sprintf("global:event:%s:%s", eventKey, dedupeSuffix)
		if withinCooldown(cooldownKey, cooldown) {
			return
		}

		deliverNotification(subject, body)
	}()
}
