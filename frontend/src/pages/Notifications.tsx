import { useEffect, useState } from "react";
import {
  BellSimple,
  CircleNotch,
  EnvelopeSimple,
  Warning,
  CheckCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface NotificationSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_from_email: string;
  smtp_from_name: string;
  smtp_to_email: string;
  discord_webhook_url: string;
}

interface GlobalNotificationPreferences {
  auth_login_failed: boolean;
  auth_register_not_whitelisted: boolean;
  auth_register_success: boolean;
  proxy_global_connection_failed: boolean;
  proxy_global_connection_prohibited: boolean;
}

const defaultSettings: NotificationSettings = {
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_from_email: "",
  smtp_from_name: "",
  smtp_to_email: "",
  discord_webhook_url: "",
};

const defaultGlobalPreferences: GlobalNotificationPreferences = {
  auth_login_failed: false,
  auth_register_not_whitelisted: true,
  auth_register_success: false,
  proxy_global_connection_failed: true,
  proxy_global_connection_prohibited: true,
};

export default function Notifications() {
  const { token, logout } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [originalSettings, setOriginalSettings] =
    useState<NotificationSettings>(defaultSettings);
  const [globalPreferences, setGlobalPreferences] =
    useState<GlobalNotificationPreferences>(defaultGlobalPreferences);
  const [originalGlobalPreferences, setOriginalGlobalPreferences] =
    useState<GlobalNotificationPreferences>(defaultGlobalPreferences);
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [originalMasterEnabled, setOriginalMasterEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingDiscord, setTestingDiscord] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [settingsRes, prefsRes, masterRes] = await Promise.all([
          authFetch("/api/system/notifications", token, {}, logout),
          authFetch("/api/system/notification-preferences", token, {}, logout),
          authFetch("/api/system/notifications/master", token, {}, logout),
        ]);

        if (!settingsRes.ok) {
          throw new Error("Failed to load notification settings");
        }
        if (!prefsRes.ok) {
          throw new Error("Failed to load notification preferences");
        }
        if (!masterRes.ok) {
          throw new Error("Failed to load notifications master setting");
        }

        const data = (await settingsRes.json()) as NotificationSettings;
        const prefs = (await prefsRes.json()) as GlobalNotificationPreferences;
        const masterData = (await masterRes.json()) as { enabled?: boolean };
        const normalized: NotificationSettings = {
          smtp_host: data.smtp_host ?? "",
          smtp_port: data.smtp_port ?? 587,
          smtp_username: data.smtp_username ?? "",
          smtp_password: data.smtp_password ?? "",
          smtp_from_email: data.smtp_from_email ?? "",
          smtp_from_name: data.smtp_from_name ?? "",
          smtp_to_email: data.smtp_to_email ?? "",
          discord_webhook_url: data.discord_webhook_url ?? "",
        };
        const normalizedPrefs: GlobalNotificationPreferences = {
          auth_login_failed: Boolean(prefs.auth_login_failed),
          auth_register_not_whitelisted: Boolean(
            prefs.auth_register_not_whitelisted,
          ),
          auth_register_success: Boolean(prefs.auth_register_success),
          proxy_global_connection_failed: Boolean(
            prefs.proxy_global_connection_failed,
          ),
          proxy_global_connection_prohibited: Boolean(
            prefs.proxy_global_connection_prohibited,
          ),
        };
        setSettings(normalized);
        setOriginalSettings(normalized);
        setGlobalPreferences(normalizedPrefs);
        setOriginalGlobalPreferences(normalizedPrefs);
        const normalizedMaster = Boolean(masterData.enabled);
        setMasterEnabled(normalizedMaster);
        setOriginalMasterEnabled(normalizedMaster);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to load settings";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void fetchSettings();
  }, [token, logout]);

  const updateField = <K extends keyof NotificationSettings>(
    field: K,
    value: NotificationSettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
    if (success) setSuccess(null);
  };

  const hasChanges =
    JSON.stringify(settings) !== JSON.stringify(originalSettings) ||
    JSON.stringify(globalPreferences) !==
      JSON.stringify(originalGlobalPreferences) ||
    masterEnabled !== originalMasterEnabled;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: NotificationSettings = {
        ...settings,
        smtp_port:
          Number.isFinite(settings.smtp_port) && settings.smtp_port > 0
            ? settings.smtp_port
            : 587,
      };

      const res = await authFetch(
        "/api/system/notifications",
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        logout,
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Failed to save notification settings");
      }

      const prefsRes = await authFetch(
        "/api/system/notification-preferences",
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(globalPreferences),
        },
        logout,
      );
      if (!prefsRes.ok) {
        const data = (await prefsRes.json()) as { error?: string };
        throw new Error(
          data.error || "Failed to save global notification preferences",
        );
      }
      const prefsData =
        (await prefsRes.json()) as GlobalNotificationPreferences;
      const normalizedPrefs: GlobalNotificationPreferences = {
        auth_login_failed: Boolean(prefsData.auth_login_failed),
        auth_register_not_whitelisted: Boolean(
          prefsData.auth_register_not_whitelisted,
        ),
        auth_register_success: Boolean(prefsData.auth_register_success),
        proxy_global_connection_failed: Boolean(
          prefsData.proxy_global_connection_failed,
        ),
        proxy_global_connection_prohibited: Boolean(
          prefsData.proxy_global_connection_prohibited,
        ),
      };

      const masterRes = await authFetch(
        "/api/system/notifications/master",
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: masterEnabled }),
        },
        logout,
      );
      if (!masterRes.ok) {
        const data = (await masterRes.json()) as { error?: string };
        throw new Error(
          data.error || "Failed to save notifications master setting",
        );
      }
      const masterData = (await masterRes.json()) as { enabled?: boolean };
      const normalizedMaster = Boolean(masterData.enabled);

      setOriginalSettings(payload);
      setSettings(payload);
      setGlobalPreferences(normalizedPrefs);
      setOriginalGlobalPreferences(normalizedPrefs);
      setMasterEnabled(normalizedMaster);
      setOriginalMasterEnabled(normalizedMaster);
      setSuccess("Notification settings saved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const setGlobalPreference = <K extends keyof GlobalNotificationPreferences>(
    key: K,
    enabled: boolean,
  ) => {
    setGlobalPreferences((prev) => ({ ...prev, [key]: enabled }));
    if (error) setError(null);
    if (success) setSuccess(null);
  };

  const getNormalizedSettingsPayload = (): NotificationSettings => ({
    ...settings,
    smtp_port:
      Number.isFinite(settings.smtp_port) && settings.smtp_port > 0
        ? settings.smtp_port
        : 587,
  });

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authFetch(
        "/api/system/notifications/test-email",
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(getNormalizedSettingsPayload()),
        },
        logout,
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Failed to send test email");
      }
      const data = (await res.json()) as { message?: string };
      setSuccess(data.message || "Test email sent");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to send test email";
      setError(message);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestDiscord = async () => {
    setTestingDiscord(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authFetch(
        "/api/system/notifications/test-discord",
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(getNormalizedSettingsPayload()),
        },
        logout,
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Failed to send Discord test message");
      }
      const data = (await res.json()) as { message?: string };
      setSuccess(data.message || "Discord test message sent");
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to send Discord test message";
      setError(message);
    } finally {
      setTestingDiscord(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CircleNotch
          size={24}
          className="text-neutral-500 animate-spin"
          weight="bold"
        />
        <div className="text-neutral-400 text-sm font-medium">
          Loading notification settings...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-row border-b border-border p-4 items-center justify-between gap-3 w-full">
        <h1 className="text-xl md:text-2xl font-medium text-neutral-100">
          Server Notifications
        </h1>
        <Button onClick={handleSave} disabled={!hasChanges || saving}>
          {saving ? (
            <>
              <CircleNotch size={16} className="animate-spin mr-2" />
              Saving
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full px-6 sm:px-8 py-8 space-y-6">
          <div className="space-y-3">
            {success && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                <CheckCircle size={16} weight="bold" />
                <span>{success}</span>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <Warning size={16} weight="bold" />
                <span>{error}</span>
              </div>
            )}
            {!masterEnabled && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                <Warning size={16} weight="bold" />
                <span>
                  Master notifications are disabled. No email or Discord
                  notifications will be delivered until you enable the master
                  toggle.
                </span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-neutral-300">
                  <BellSimple size={18} />
                </div>
                <div>
                  <h2 className="text-base font-medium text-neutral-100">
                    Master Toggle
                  </h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Disable all outbound notifications globally. When off, no
                    email or Discord notifications are sent regardless of event
                    toggles.
                  </p>
                </div>
              </div>
              <Switch
                checked={masterEnabled}
                onCheckedChange={setMasterEnabled}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-neutral-300">
                  <EnvelopeSimple size={18} />
                </div>
                <div>
                  <h2 className="text-base font-medium text-neutral-100">
                    Email (SMTP)
                  </h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Configure your SMTP provider credentials for email
                    notifications.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestEmail}
                disabled={!masterEnabled || testingEmail || saving}
              >
                {testingEmail ? (
                  <>
                    <CircleNotch size={14} className="animate-spin mr-1" />
                    Testing
                  </>
                ) : (
                  "Test Email"
                )}
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="smtp_host">SMTP Host</Label>
                <Input
                  id="smtp_host"
                  placeholder="smtp.example.com"
                  value={settings.smtp_host}
                  onChange={(e) => updateField("smtp_host", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp_port">SMTP Port</Label>
                <Input
                  id="smtp_port"
                  type="number"
                  min={1}
                  max={65535}
                  placeholder="587"
                  value={settings.smtp_port}
                  onChange={(e) =>
                    updateField("smtp_port", parseInt(e.target.value, 10) || 0)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp_username">SMTP Username</Label>
                <Input
                  id="smtp_username"
                  placeholder="username"
                  value={settings.smtp_username}
                  onChange={(e) => updateField("smtp_username", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp_password">SMTP Password</Label>
                <Input
                  id="smtp_password"
                  type="password"
                  placeholder="••••••••"
                  value={settings.smtp_password}
                  onChange={(e) => updateField("smtp_password", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp_from_email">From Email</Label>
                <Input
                  id="smtp_from_email"
                  type="email"
                  placeholder="noreply@example.com"
                  value={settings.smtp_from_email}
                  onChange={(e) =>
                    updateField("smtp_from_email", e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp_from_name">From Name</Label>
                <Input
                  id="smtp_from_name"
                  placeholder="Baseful"
                  value={settings.smtp_from_name}
                  onChange={(e) => updateField("smtp_from_name", e.target.value)}
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="smtp_to_email">To Email (Recipient)</Label>
                <Input
                  id="smtp_to_email"
                  type="email"
                  placeholder="alerts@example.com"
                  value={settings.smtp_to_email}
                  onChange={(e) => updateField("smtp_to_email", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-neutral-300">
                  <BellSimple size={18} />
                </div>
                <div>
                  <h2 className="text-base font-medium text-neutral-100">
                    Discord Webhook
                  </h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Add a webhook URL to allow Discord channel notifications.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestDiscord}
                disabled={!masterEnabled || testingDiscord || saving}
              >
                {testingDiscord ? (
                  <>
                    <CircleNotch size={14} className="animate-spin mr-1" />
                    Testing
                  </>
                ) : (
                  "Test Webhook"
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="discord_webhook_url">Webhook URL</Label>
              <Input
                id="discord_webhook_url"
                placeholder="https://discord.com/api/webhooks/..."
                value={settings.discord_webhook_url}
                onChange={(e) =>
                  updateField("discord_webhook_url", e.target.value)
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-neutral-300">
                <BellSimple size={18} />
              </div>
              <div>
                <h2 className="text-base font-medium text-neutral-100">
                  Global Security Alerts
                </h2>
                <p className="text-sm text-neutral-500 mt-1">
                  Control server-wide auth and unknown-database proxy alerts.
                  Database-scoped proxy alerts are configured per database.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3 px-3 py-3 rounded-lg border border-white/[0.06] bg-white/[0.01]">
                <div>
                  <div className="text-sm text-neutral-200 font-medium">
                    Proxy: Handshake/Unknown-DB Failed
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Notify when proxy connections fail before a database can be
                    identified.
                  </div>
                </div>
                <Switch
                  checked={globalPreferences.proxy_global_connection_failed}
                  onCheckedChange={(checked) =>
                    setGlobalPreference("proxy_global_connection_failed", checked)
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-3 px-3 py-3 rounded-lg border border-white/[0.06] bg-white/[0.01]">
                <div>
                  <div className="text-sm text-neutral-200 font-medium">
                    Proxy: Handshake/Unknown-DB Prohibited
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Notify when proxy connections are rejected before a database
                    can be identified.
                  </div>
                </div>
                <Switch
                  checked={globalPreferences.proxy_global_connection_prohibited}
                  onCheckedChange={(checked) =>
                    setGlobalPreference(
                      "proxy_global_connection_prohibited",
                      checked,
                    )
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-3 px-3 py-3 rounded-lg border border-white/[0.06] bg-white/[0.01]">
                <div>
                  <div className="text-sm text-neutral-200 font-medium">
                    Login Failed
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Notify when a login attempt fails.
                  </div>
                </div>
                <Switch
                  checked={globalPreferences.auth_login_failed}
                  onCheckedChange={(checked) =>
                    setGlobalPreference("auth_login_failed", checked)
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-3 px-3 py-3 rounded-lg border border-white/[0.06] bg-white/[0.01]">
                <div>
                  <div className="text-sm text-neutral-200 font-medium">
                    Signup Blocked (Not Whitelisted)
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Notify when someone tries to register with a non-whitelisted
                    email.
                  </div>
                </div>
                <Switch
                  checked={globalPreferences.auth_register_not_whitelisted}
                  onCheckedChange={(checked) =>
                    setGlobalPreference("auth_register_not_whitelisted", checked)
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-3 px-3 py-3 rounded-lg border border-white/[0.06] bg-white/[0.01]">
                <div>
                  <div className="text-sm text-neutral-200 font-medium">
                    Signup Success
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Notify when a new account is successfully created.
                  </div>
                </div>
                <Switch
                  checked={globalPreferences.auth_register_success}
                  onCheckedChange={(checked) =>
                    setGlobalPreference("auth_register_success", checked)
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
