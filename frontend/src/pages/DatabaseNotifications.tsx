import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  BellSimple,
  CheckCircle,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { useAuth } from "@/context/AuthContext";
import { useDatabase } from "@/context/DatabaseContext";
import { authFetch } from "@/lib/api";

interface EventDefinition {
  key: string;
  label: string;
  description: string;
  category: "Backups" | "Proxy";
}

const eventDefinitions: EventDefinition[] = [
  {
    key: "backup_failed",
    label: "Backup Failed",
    description: "Send a notification when a backup job fails.",
    category: "Backups",
  },
  {
    key: "backup_completed",
    label: "Backup Completed",
    description: "Send a notification when a backup job finishes successfully.",
    category: "Backups",
  },
  {
    key: "restore_started",
    label: "Restore Started",
    description: "Send a notification when a restore operation starts.",
    category: "Backups",
  },
  {
    key: "restore_failed",
    label: "Restore Failed",
    description: "Send a notification when a restore operation fails.",
    category: "Backups",
  },
  {
    key: "restore_completed",
    label: "Restore Completed",
    description: "Send a notification when a restore operation completes.",
    category: "Backups",
  },
  {
    key: "proxy_connection_failed",
    label: "Proxy: Connection Failed",
    description: "Send a notification when proxy backend connections fail.",
    category: "Proxy",
  },
  {
    key: "proxy_connection_prohibited",
    label: "Proxy: Connection Prohibited",
    description:
      "Send a notification when proxy connections are blocked (invalid/revoked token, invalid purpose).",
    category: "Proxy",
  },
];

export default function DatabaseNotifications() {
  const { id } = useParams<{ id: string }>();
  const { token, logout } = useAuth();
  const { selectedDatabase } = useDatabase();
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [originalPreferences, setOriginalPreferences] = useState<
    Record<string, boolean>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchPreferences = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const [prefsRes, masterRes] = await Promise.all([
          authFetch(
            `/api/databases/${id}/notification-preferences`,
            token,
            {},
            logout,
          ),
          authFetch("/api/system/notifications/master", token, {}, logout),
        ]);
        if (!prefsRes.ok) {
          throw new Error("Failed to load database notification preferences");
        }
        if (!masterRes.ok) {
          throw new Error("Failed to load notifications master setting");
        }

        const data = (await prefsRes.json()) as Record<string, boolean>;
        const masterData = (await masterRes.json()) as { enabled?: boolean };
        const normalized: Record<string, boolean> = {};
        for (const event of eventDefinitions) {
          normalized[event.key] = Boolean(data[event.key]);
        }

        setPreferences(normalized);
        setOriginalPreferences(normalized);
        setMasterEnabled(Boolean(masterData.enabled));
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load notification preferences",
        );
      } finally {
        setLoading(false);
      }
    };

    void fetchPreferences();
  }, [id, token, logout]);

  const hasChanges =
    JSON.stringify(preferences) !== JSON.stringify(originalPreferences);
  const databaseName = selectedDatabase?.name || `Database ${id ?? ""}`;

  const groupedEvents = useMemo(() => {
    return {
      Backups: eventDefinitions.filter((e) => e.category === "Backups"),
      Proxy: eventDefinitions.filter((e) => e.category === "Proxy"),
    };
  }, []);

  const setPreference = (key: string, enabled: boolean) => {
    setPreferences((prev) => ({ ...prev, [key]: enabled }));
    if (success) setSuccess(null);
    if (error) setError(null);
  };

  const handleSave = async () => {
    if (!id || !masterEnabled) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authFetch(
        `/api/databases/${id}/notification-preferences`,
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preferences),
        },
        logout,
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(
          data.error || "Failed to save notification preferences",
        );
      }

      const updated = (await res.json()) as Record<string, boolean>;
      const normalized: Record<string, boolean> = {};
      for (const event of eventDefinitions) {
        normalized[event.key] = Boolean(updated[event.key]);
      }

      setPreferences(normalized);
      setOriginalPreferences(normalized);
      setSuccess("Database notification preferences saved");
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save notification preferences",
      );
    } finally {
      setSaving(false);
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
          Loading notification preferences...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-row border-b border-border p-4 items-center justify-between gap-3 w-full">
        <div className="flex flex-row items-center gap-3 flex-1">
          <DitherAvatar
            value={selectedDatabase?.name || "database"}
            size={32}
          />
          <h1 className="text-xl md:text-2xl font-medium text-neutral-100">
            Alerts for {databaseName}
          </h1>
        </div>
        <Button
          onClick={handleSave}
          size={"sm"}
          disabled={!masterEnabled || !hasChanges || saving}
        >
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
                Notifications are disabled by the server master toggle. Enable
                them and finish sender setup in Notification Center before
                editing database alerts.
              </span>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-6 space-y-2">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-neutral-300">
                <BellSimple size={18} />
              </div>
              <div>
                <h2 className="text-base font-medium text-neutral-100">
                  Event Toggles
                </h2>
                <p className="text-sm text-neutral-500 mt-1">
                  Pick which events for this database should send notifications.
                  Sender setup (SMTP/Discord) is configured in Server
                  Notifications. Auth event toggles are also managed on the
                  Server Notifications page.
                </p>
              </div>
            </div>
          </div>

          {Object.entries(groupedEvents).map(([category, items]) => (
            <div
              key={category}
              className="rounded-xl border border-border bg-card p-6 space-y-4"
            >
              <h3 className="text-sm font-medium text-neutral-300 uppercase tracking-wide">
                {category}
              </h3>
              <div className="space-y-2">
                {items.map((event) => (
                  <div
                    key={event.key}
                    className="flex items-start justify-between gap-3 px-3 py-3 rounded-lg border border-white/[0.06] bg-white/[0.01]"
                  >
                    <div>
                      <div className="text-sm text-neutral-200 font-medium">
                        {event.label}
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">
                        {event.description}
                      </div>
                    </div>
                    <Switch
                      checked={Boolean(preferences[event.key])}
                      onCheckedChange={(checked) =>
                        setPreference(event.key, checked)
                      }
                      disabled={!masterEnabled || saving}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
