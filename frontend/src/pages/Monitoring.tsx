import { useState, useEffect } from "react";
import { Graph, Clock, Power, Check, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface MonitoringSettings {
  metrics_enabled: boolean;
  metrics_sample_rate: string;
}

export default function Monitoring() {
  const { token, logout } = useAuth();
  const [settings, setSettings] = useState<MonitoringSettings>({
    metrics_enabled: true,
    metrics_sample_rate: "5",
  });
  const [originalSettings, setOriginalSettings] = useState<MonitoringSettings>({
    metrics_enabled: true,
    metrics_sample_rate: "5",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await authFetch(`/api/settings`, token, {}, logout);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setOriginalSettings(data);
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authFetch(`/api/settings`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }, logout);

      if (!res.ok) {
        throw new Error("Failed to update monitoring settings");
      }

      setOriginalSettings(settings);
      setSuccess("Monitoring settings updated successfully");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({ ...originalSettings });
    setError(null);
    setSuccess(null);
  };

  const hasChanges =
    settings.metrics_enabled !== originalSettings.metrics_enabled ||
    settings.metrics_sample_rate !== originalSettings.metrics_sample_rate;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-500 text-sm">
          Loading monitoring settings...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-row border-b border-border p-4 items-center gap-4">
        <div className="flex flex-row items-center gap-3 flex-1">
          <Graph size={24} weight="bold" className="text-blue-400" />
          <h1 className="text-2xl font-medium text-neutral-100">
            Monitoring Settings
          </h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl px-8 py-8">
          {success && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
              <Check size={16} weight="bold" />
              <span>{success}</span>
            </div>
          )}

          {error && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <Warning size={16} weight="bold" />
              <span>{error}</span>
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-sm font-medium text-neutral-200 mb-1">
              Global Monitoring Configuration
            </h2>
            <p className="text-sm text-neutral-500 leading-relaxed">
              Configure how Baseful collects metrics from your databases. These
              settings apply to all databases on this server.
            </p>
          </div>

          <div className="space-y-1">
            {/* Enable/Disable Toggle */}
            <div className="group py-6 border-t border-white/[0.06] first:border-0 first:pt-0">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                <div className="flex items-start gap-4 flex-1">
                  <div className="p-2 rounded-md bg-white/[0.04] text-neutral-400 mt-0.5">
                    <Power size={18} weight="bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-200">
                      Collection Status
                    </Label>
                    <p className="text-sm text-neutral-500 leading-relaxed max-w-xs">
                      Completely enable or disable background metric collection
                      for all databases.
                    </p>
                  </div>
                </div>

                <div className="sm:w-48 flex items-center justify-end">
                  <button
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        metrics_enabled: !prev.metrics_enabled,
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${settings.metrics_enabled
                        ? "bg-blue-600"
                        : "bg-neutral-700"
                      }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.metrics_enabled
                          ? "translate-x-6"
                          : "translate-x-1"
                        }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Sample Rate */}
            <div className="group py-6 border-t border-white/[0.06]">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                <div className="flex items-start gap-4 flex-1">
                  <div className="p-2 rounded-md bg-white/[0.04] text-neutral-400 mt-0.5">
                    <Clock size={18} weight="bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-200">
                      Sample Rate
                    </Label>
                    <p className="text-sm text-neutral-500 leading-relaxed max-w-xs">
                      How often Baseful polls Docker and PostgreSQL for new
                      metrics. Higher rates provide more detail but use more
                      CPU.
                    </p>
                  </div>
                </div>

                <div className="sm:w-48 space-y-3">
                  <div className="relative">
                    <Input
                      type="number"
                      min="1"
                      max="60"
                      value={settings.metrics_sample_rate}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          metrics_sample_rate: e.target.value,
                        }))
                      }
                      className="bg-[#0f0f10] border-white/[0.08] text-neutral-200 text-sm h-9 focus:border-blue-500/50 focus:ring-0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 pointer-events-none">
                      sec
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 5, 10, 30, 60].map((val) => (
                      <button
                        key={val}
                        onClick={() =>
                          setSettings((prev) => ({
                            ...prev,
                            metrics_sample_rate: val.toString(),
                          }))
                        }
                        className="text-[10px] px-2 py-1 rounded bg-white/[0.04] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-300 transition-colors border border-white/[0.04]"
                      >
                        {val}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Footer */}
      {hasChanges && (
        <div className="border-t border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur px-8 py-4">
          <div className="max-w-2xl flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Unsaved changes</span>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={handleReset}
                disabled={saving}
                className="text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06] h-8 text-sm"
              >
                Discard
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-500 text-white h-8 text-sm px-4 gap-2"
              >
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
