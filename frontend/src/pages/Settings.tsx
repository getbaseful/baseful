import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  Cpu,
  Memory,
  HardDrive,
  ArrowCounterClockwise,
  Warning,
  Check,
  CircleNotch,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import { DitherAvatar } from "@/components/ui/hash-avatar";

interface ResourceLimits {
  max_cpu: number;
  max_ram_mb: number;
  max_storage_mb: number;
}

interface Database {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  status: string;
  version?: string;
  container_id?: string;
}

export default function Settings() {
  const { id } = useParams<{ id: string }>();
  const { token, logout } = useAuth();
  const [database, setDatabase] = useState<Database | null>(null);
  const [limits, setLimits] = useState<ResourceLimits>({
    max_cpu: 1,
    max_ram_mb: 512,
    max_storage_mb: 1024,
  });
  const [originalLimits, setOriginalLimits] = useState<ResourceLimits>({
    max_cpu: 1,
    max_ram_mb: 512,
    max_storage_mb: 1024,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    if (id) {
      fetchDatabase();
      fetchResourceLimits();
    }
  }, [id]);

  const fetchDatabase = async () => {
    try {
      const res = await authFetch(`/api/databases/${id}`, token, {}, logout);
      if (!res.ok) throw new Error("Database not found");
      const data = await res.json();
      setDatabase(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchResourceLimits = async () => {
    try {
      const res = await authFetch(`/api/databases/${id}/limits`, token, {}, logout);
      if (res.ok) {
        const data = await res.json();
        const newLimits = {
          max_cpu: data.max_cpu || 1,
          max_ram_mb: data.max_ram_mb || 512,
          max_storage_mb: data.max_storage_mb || 1024,
        };
        setLimits(newLimits);
        setOriginalLimits(newLimits);
      }
    } catch (err) {
      console.error("Failed to fetch resource limits:", err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authFetch(`/api/databases/${id}/limits`, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limits),
      }, logout);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update resource limits");
      }

      const data = await res.json();
      setOriginalLimits(limits);
      setSuccess("Resource limits updated successfully");
      setNeedsRestart(data.needs_restart || false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLimits({ ...originalLimits });
    setError(null);
    setSuccess(null);
  };

  const handleInputChange = (field: keyof ResourceLimits, value: string) => {
    const numValue = parseFloat(value) || 0;
    setLimits((prev) => ({
      ...prev,
      [field]: Math.max(0, numValue),
    }));
  };

  const hasChanges =
    limits.max_cpu !== originalLimits.max_cpu ||
    limits.max_ram_mb !== originalLimits.max_ram_mb ||
    limits.max_storage_mb !== originalLimits.max_storage_mb;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CircleNotch size={24} className="text-neutral-500 animate-spin" weight="bold" />
        <div className="text-neutral-400 text-sm font-medium">Loading settings...</div>
      </div>
    );
  }

  if (error && !database) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <div className="flex flex-col items-center text-center max-w-sm gap-3 p-6 rounded-xl bg-red-500/10 border border-red-500/20">
          <Warning size={32} className="text-red-400" weight="duotone" />
          <h2 className="text-lg font-medium text-red-500">Failed to load</h2>
          <p className="text-red-400/80 text-sm">{error || "Database not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full  relative ">
      {/* Header */}
      <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
        <div className="flex flex-row items-center gap-3 flex-1">
          <DitherAvatar value={database?.name || "database"} size={32} />

          <div className="flex flex-row items-center gap-2">
            <h1 className="text-2xl font-medium text-neutral-100">
              Backups & Restoration
            </h1>
          </div>
        </div>

      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full px-6 sm:px-8 py-10">

          {/* Alerts */}
          <div className="space-y-4 mb-10">
            {success && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm shadow-sm animate-in fade-in slide-in-from-top-2">
                <Check size={18} weight="bold" />
                <span className="font-medium">{success}</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm shadow-sm animate-in fade-in slide-in-from-top-2">
                <Warning size={18} weight="bold" />
                <span className="font-medium">{error}</span>
              </div>
            )}

            {needsRestart && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 rounded-lg bg-amber-500/10 border border-amber-500/20 shadow-sm animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-3 text-amber-400">
                  <ArrowCounterClockwise size={18} weight="bold" className="shrink-0" />
                  <span className="text-sm font-medium">Restart required for changes to take effect</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await authFetch(`/api/databases/${id}/restart`, token, {
                        method: "POST",
                      }, logout);
                      setNeedsRestart(false);
                      setSuccess("Database restarted successfully");
                    } catch (err) {
                      setError("Failed to restart database");
                    }
                  }}
                  className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/30 h-8 text-xs font-semibold whitespace-nowrap"
                >
                  Restart Now
                </Button>
              </div>
            )}
          </div>

          {/* Section Description */}
          <div className="mb-6 px-1">
            <h2 className="text-base font-medium text-neutral-100 mb-1.5">
              Resource Limits
            </h2>
            <p className="text-sm text-neutral-500 leading-relaxed max-w-2xl">
              Configure the maximum resources allocated to this database. Adjusting these values allows you to scale performance up or down. Changes apply immediately but may require a soft restart.
            </p>
          </div>

          {/* Settings Card */}
          <div className="rounded-xl border shadow-sm overflow-hidden flex flex-col">

            {/* CPU */}
            <div className="group flex flex-col md:flex-row md:items-start justify-between gap-6 p-6 md:p-8 border-b border-white/[0.06]">
              <div className="flex items-start gap-4 max-w-md">
                <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-neutral-300 shadow-sm">
                  <Cpu size={20} weight="duotone" />
                </div>
                <div className="space-y-1.5 mt-0.5">
                  <Label className="text-sm font-medium text-neutral-200">
                    CPU Cores
                  </Label>
                  <p className="text-sm text-neutral-500 leading-relaxed">
                    Maximum CPU cores available for query processing and background maintenance tasks.
                  </p>
                </div>
              </div>

              <div className="md:w-64 space-y-3 shrink-0">
                <div className="relative group/input">
                  <Input
                    type="number"
                    min="0.1"
                    max="16"
                    step="0.1"
                    value={limits.max_cpu}
                    onChange={(e) => handleInputChange("max_cpu", e.target.value)}
                    className="bg-[#121214] border-white/[0.08] text-neutral-200 text-sm h-10 px-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-all"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-500 pointer-events-none">
                    cores
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[0.5, 1, 2, 4].map((val) => (
                    <button
                      key={val}
                      onClick={() => setLimits((prev) => ({ ...prev, max_cpu: val }))}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-white/[0.03] text-neutral-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-neutral-200 transition-all active:scale-95"
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RAM */}
            <div className="group flex flex-col md:flex-row md:items-start justify-between gap-6 p-6 md:p-8 border-b border-white/[0.06]">
              <div className="flex items-start gap-4 max-w-md">
                <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-neutral-300 shadow-sm">
                  <Memory size={20} weight="duotone" />
                </div>
                <div className="space-y-1.5 mt-0.5">
                  <Label className="text-sm font-medium text-neutral-200">
                    Memory Allocation
                  </Label>
                  <p className="text-sm text-neutral-500 leading-relaxed">
                    Maximum RAM assigned. Insufficient memory may cause heavy queries to fail or trigger disk swap operations.
                  </p>
                </div>
              </div>

              <div className="md:w-64 space-y-3 shrink-0">
                <div className="relative group/input">
                  <Input
                    type="number"
                    min="64"
                    max="32768"
                    step="64"
                    value={limits.max_ram_mb}
                    onChange={(e) => handleInputChange("max_ram_mb", e.target.value)}
                    className="bg-[#121214] border-white/[0.08] text-neutral-200 text-sm h-10 px-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-all"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-500 pointer-events-none">
                    MB
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[256, 512, 1024, 2048, 4096].map((val) => (
                    <button
                      key={val}
                      onClick={() => setLimits((prev) => ({ ...prev, max_ram_mb: val }))}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-white/[0.03] text-neutral-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-neutral-200 transition-all active:scale-95"
                    >
                      {val >= 1024 ? `${val / 1024} GB` : `${val} MB`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Storage */}
            <div className="group flex flex-col md:flex-row md:items-start justify-between gap-6 p-6 md:p-8">
              <div className="flex items-start gap-4 max-w-md">
                <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-neutral-300 shadow-sm">
                  <HardDrive size={20} weight="duotone" />
                </div>
                <div className="space-y-1.5 mt-0.5">
                  <Label className="text-sm font-medium text-neutral-200">
                    Storage Capacity
                  </Label>
                  <p className="text-sm text-neutral-500 leading-relaxed">
                    Maximum disk space available for database data files, search indices, and transaction logs.
                  </p>
                </div>
              </div>

              <div className="md:w-64 space-y-3 shrink-0">
                <div className="relative group/input">
                  <Input
                    type="number"
                    min="128"
                    max="1048576"
                    step="128"
                    value={limits.max_storage_mb}
                    onChange={(e) => handleInputChange("max_storage_mb", e.target.value)}
                    className="bg-[#121214] border-white/[0.08] text-neutral-200 text-sm h-10 px-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-all"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-500 pointer-events-none">
                    MB
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[1024, 5120, 10240, 51200].map((val) => (
                    <button
                      key={val}
                      onClick={() => setLimits((prev) => ({ ...prev, max_storage_mb: val }))}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-white/[0.03] text-neutral-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-neutral-200 transition-all active:scale-95"
                    >
                      {val >= 1024 ? `${val / 1024} GB` : `${val} MB`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Floating Action Bar (Unsaved Changes) */}
      {hasChanges && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div className="flex items-center justify-between gap-4 rounded-full border border-white/[0.1] bg-neutral-900/90 py-3 px-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-3 pl-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
              <span className="text-sm font-medium text-neutral-200">
                You have unsaved changes
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={handleReset}
                disabled={saving}
                className="text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.08] h-9 text-sm rounded-full px-5"
              >
                Discard
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-500 text-white h-9 text-sm px-5 rounded-full shadow-md shadow-blue-500/20 transition-all"
              >
                {saving ? (
                  <div className="flex items-center gap-2">
                    <CircleNotch size={16} className="animate-spin" weight="bold" />
                    Saving...
                  </div>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}