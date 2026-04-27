import { useState, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon, CheckIcon, ArrowSquareOut } from "@phosphor-icons/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDatabase } from "@/context/DatabaseContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Database {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  status: string;
  version: string;
  created_at: string;
  container_id: string;
  token?: string;
  token_expires_at?: string;
  has_legacy_public_bindings?: boolean;
  legacy_public_database_binding?: boolean;
  legacy_public_branch_binding_count?: number;
  legacy_public_binding_target_count?: number;
}

interface DatabaseMetrics {
  active_connections: number;
  database_size: string;
  cpu_usage_percent: number;
  memory_usage_mb: number;
  memory_limit_mb: number;
  memory_usage_percent: number;
  cache_hit_ratio?: number;
  uptime_seconds?: number;
  max_connections?: number;
  total_transactions?: number;
  longest_query_seconds?: number;
  io_read_bps?: number;
  io_write_bps?: number;
}

interface MetricHistorySample {
  timestamp: string;
  cpu_usage_percent: number;
  memory_usage_mb: number;
  memory_usage_percent: number;
  active_connections: number;
  io_read_bps?: number;
  io_write_bps?: number;
}

export default function DatabaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshDatabases } = useDatabase();
  const { token, logout } = useAuth();
  const { data: settings } = useQuery({
    queryKey: ["settings", token],
    queryFn: async () => {
      const res = await authFetch("/api/settings", token, {}, logout);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
    enabled: !!token,
    refetchInterval: 30000,
    staleTime: 1000 * 60 * 5,
  });

  const metricsEnabled = settings?.metrics_enabled ?? true;
  const metricsSampleRate = settings?.metrics_sample_rate ?? 1;

  const {
    data: database,
    isLoading: databaseLoading,
    error: databaseError,
    refetch: refetchDatabase,
  } = useQuery<Database>({
    queryKey: ["database", id, token],
    queryFn: async () => {
      const res = await authFetch(`/api/databases/${id}`, token, {}, logout);
      if (!res.ok) throw new Error("Database not found");
      return res.json();
    },
    enabled: !!id && !!token,
    refetchInterval: 5000,
    staleTime: 1000 * 30,
  });

  const { data: metrics, isLoading: metricsLoading } =
    useQuery<DatabaseMetrics>({
      queryKey: ["metrics", id, token],
      queryFn: async () => {
        const res = await authFetch(
          `/api/databases/${id}/metrics`,
          token,
          {},
          logout,
        );
        if (!res.ok) throw new Error("Failed to fetch metrics");
        return res.json();
      },
      enabled: !!id && !!token && database?.status === "active",
      refetchInterval: 5000,
      staleTime: 1000 * 5,
    });

  const { data: history = [] } = useQuery<MetricHistorySample[]>({
    queryKey: ["history", id, token],
    queryFn: async () => {
      const res = await authFetch(
        `/api/databases/${id}/metrics/history`,
        token,
        {},
        logout,
      );
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!id && !!token && database?.status === "active" && metricsEnabled,
    refetchInterval: 10000,
    staleTime: 1000 * 10,
  });

  const { data: limits } = useQuery<{
    max_cpu: number;
    max_ram_mb: number;
    max_storage_mb: number;
  }>({
    queryKey: ["limits", id, token],
    queryFn: async () => {
      const res = await authFetch(
        `/api/databases/${id}/limits`,
        token,
        {},
        logout,
      );
      if (!res.ok) throw new Error("Failed to fetch limits");
      return res.json();
    },
    enabled: !!id && !!token,
  });

  const aggregatedHistory = useMemo(() => {
    if (!history || history.length === 0) return [];

    const result: MetricHistorySample[] = [];
    const chunkSize = Math.max(1, Math.floor(60 / metricsSampleRate));

    for (let i = 0; i < history.length; i += chunkSize) {
      const chunk = history.slice(i, i + chunkSize);
      const count = chunk.length;

      const aggregated = chunk.reduce(
        (acc, curr) => ({
          cpu_usage_percent: acc.cpu_usage_percent + curr.cpu_usage_percent,
          memory_usage_percent:
            acc.memory_usage_percent + curr.memory_usage_percent,
          memory_usage_mb: acc.memory_usage_mb + curr.memory_usage_mb,
          active_connections: Math.max(
            acc.active_connections,
            curr.active_connections,
          ),
          io_read_bps: acc.io_read_bps + (curr.io_read_bps || 0),
          io_write_bps: acc.io_write_bps + (curr.io_write_bps || 0),
        }),
        {
          cpu_usage_percent: 0,
          memory_usage_percent: 0,
          memory_usage_mb: 0,
          active_connections: 0,
          io_read_bps: 0,
          io_write_bps: 0,
        },
      );

      result.push({
        timestamp: chunk[0].timestamp,
        cpu_usage_percent:
          Math.round((aggregated.cpu_usage_percent / count) * 10) / 10,
        memory_usage_percent:
          Math.round((aggregated.memory_usage_percent / count) * 10) / 10,
        memory_usage_mb:
          Math.round((aggregated.memory_usage_mb / count) * 10) / 10,
        active_connections: aggregated.active_connections,
        io_read_bps: Math.round((aggregated.io_read_bps / count) * 10) / 10,
        io_write_bps: Math.round((aggregated.io_write_bps / count) * 10) / 10,
      });
    }

    return result;
  }, [history, metricsSampleRate]);

  const loading = databaseLoading;
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const error = databaseError ? (databaseError as Error).message : null;
  const [copied, setCopied] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [, setConnectionWarning] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);

  const [connectionLoading, setConnectionLoading] = useState(false);
  const [rotatingToken, setRotatingToken] = useState(false);
  const [useDomain, setUseDomain] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmRotateTokenOpen, setConfirmRotateTokenOpen] = useState(false);
  const [confirmSecureLegacyOpen, setConfirmSecureLegacyOpen] = useState(false);

  const currentHostname = window.location.hostname;
  const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(currentHostname);
  const isLocal =
    currentHostname === "localhost" || currentHostname === "127.0.0.1";
  const canUseDomain = !isIP && !isLocal;

  const displayConnectionString = useMemo(() => {
    if (!connectionString) return "";

    let finalHost = "";
    if (useDomain) {
      finalHost = currentHostname;
    } else if (isIP && !isLocal) {
      finalHost = currentHostname;
    }

    if (finalHost) {
      // Replace the host in postgresql://token:JWT@HOST:PORT/db_ID
      return connectionString.replace(/@([^:/]+)/, `@${finalHost}`);
    }

    return connectionString;
  }, [connectionString, useDomain, currentHostname, isIP, isLocal]);

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      const res = await authFetch(
        `/api/databases/${id}/${action}`,
        token,
        {
          method: "POST",
        },
        logout,
      );
      if (!res.ok) {
        throw new Error(`Failed to ${action} database`);
      }

      if (action === "delete") {
        refreshDatabases();
        navigate("/");
        return;
      }

      // Refresh database status
      refetchDatabase();
      refreshDatabases();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchConnectionString = async () => {
    setConnectionLoading(true);
    try {
      const res = await authFetch(
        `/api/databases/${id}/connection-string`,
        token,
        {},
        logout,
      );
      if (res.ok) {
        const data = await res.json();
        setConnectionString(data.connection_string);
        setConnectionWarning(data.warning || "");
        setTokenExpiresAt(data.expires_at || null);
      }
    } catch (err: unknown) {
      console.error("Failed to fetch connection string:", err);
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleOpenConnectionDialog = async () => {
    setConnectionDialogOpen(true);
    await fetchConnectionString();
  };

  const rotateConnectionToken = async () => {
    setRotatingToken(true);
    try {
      const res = await authFetch(
        `/api/databases/${id}/tokens/rotate`,
        token,
        { method: "POST" },
        logout,
      );
      if (!res.ok) {
        throw new Error("Failed to rotate token");
      }

      const data = await res.json();
      setConnectionString(data.connection_string || "");
      setTokenExpiresAt(data.expires_at || null);
      setConnectionWarning(
        "Token rotated. Previous connection strings were revoked immediately.",
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate token");
    } finally {
      setRotatingToken(false);
    }
  };

  const secureLegacyBindings = async () => {
    setActionLoading("secure-legacy-bindings");
    try {
      const res = await authFetch(
        `/api/databases/${id}/secure-legacy-bindings`,
        token,
        { method: "POST" },
        logout,
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error ||
            data?.message ||
            "Failed to secure legacy database bindings",
        );
      }

      if (Array.isArray(data?.failures) && data.failures.length > 0) {
        toast.success(
          `${data.message} ${data.failures.length} target(s) still need manual retry.`,
        );
      } else {
        toast.success(data?.message || "Legacy bindings secured");
      }

      await refetchDatabase();
      refreshDatabases();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to secure legacy database bindings",
      );
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-600/10 text-green-300";
      case "starting":
        return "bg-yellow-600/10 text-yellow-300";
      case "stopped":
        return "bg-red-600/10 text-red-300";
      default:
        return "bg-gray-600/10 text-gray-300";
    }
  };

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    if (seconds < 86400)
      return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B/s";
    const k = 1024;
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const tokenExpiryInfo = useMemo(() => {
    if (!tokenExpiresAt) return null;

    const expiryDate = new Date(tokenExpiresAt);
    if (Number.isNaN(expiryDate.getTime())) return null;

    const msLeft = expiryDate.getTime() - Date.now();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    const isExpired = msLeft <= 0;
    const isNearExpiry = !isExpired && daysLeft <= 30;

    const exact = expiryDate.toLocaleString();
    let relative = "";
    if (isExpired) {
      relative = "expired";
    } else if (daysLeft >= 365) {
      relative = `in ${Math.floor(daysLeft / 365)} year(s)`;
    } else if (daysLeft >= 30) {
      relative = `in ${Math.floor(daysLeft / 30)} month(s)`;
    } else {
      relative = `in ${daysLeft} day(s)`;
    }

    return { exact, relative, isExpired, isNearExpiry };
  }, [tokenExpiresAt]);

  if (!metricsEnabled) {
    return (
      <div className="p-12">
        <h1 className="text-4xl font-bold text-neutral-100">Hello</h1>
        <p className="text-neutral-500 mt-4">
          Monitoring is currently disabled in settings.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-red-400">{error || "Database not found"}</div>
        <Link to="/" className="text-blue-400 hover:text-blue-300">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex flex-col items-center justify-between">
        <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
          <div className="flex flex-row items-center gap-3 flex-1">
            <DitherAvatar value={database?.name || "database"} size={32} />

            <div className="flex flex-row items-center gap-2">
              {loading ? (
                <Skeleton className="h-8 w-48" />
              ) : (
                <>
                  <h1 className="text-lg md:text-2xl font-medium text-neutral-100">
                    {database?.name}
                  </h1>
                  <div
                    className={`${getStatusColor(database?.status || "")} text-xs uppercase h-fit w-fit px-2 py-1 rounded-sm`}
                  >
                    {database?.status}
                  </div>
                  {database?.has_legacy_public_bindings && (
                    <div className="bg-amber-500/10 text-amber-300 text-xs uppercase h-fit w-fit px-2 py-1 rounded-sm">
                      Legacy Public Port
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex flex-row gap-2">
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-border bg-neutral-900 text-neutral-300 hover:text-neutral-100"
                  >
                    Actions
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-fit p-2 flex flex-col gap-2">
                  {database?.status === "stopped" ? (
                    <Button
                      onClick={() => handleAction("start")}
                      variant={"secondary"}
                      className="cursor-pointer"
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === "start" ? "Starting..." : "Start"}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleAction("stop")}
                      variant={"secondary"}
                      className="cursor-pointer"
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === "stop" ? "Stopping..." : "Stop"}
                    </Button>
                  )}
                  <Button
                    onClick={() => handleAction("restart")}
                    variant={"secondary"}
                    className="cursor-pointer"
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "restart" ? "Reloading..." : "Reload"}
                  </Button>
                  <Button
                    onClick={() => handleAction("vacuum")}
                    variant={"secondary"}
                    className="cursor-pointer"
                    disabled={
                      actionLoading !== null || database?.status !== "active"
                    }
                  >
                    {actionLoading === "vacuum" ? "Vacuuming..." : "Vacuum"}
                  </Button>
                  {database?.has_legacy_public_bindings && (
                    <Button
                      onClick={() => setConfirmSecureLegacyOpen(true)}
                      variant={"secondary"}
                      className="cursor-pointer"
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === "secure-legacy-bindings"
                        ? "Securing..."
                        : "Secure Legacy Ports"}
                    </Button>
                  )}
                  <Button
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="cursor-pointer"
                    variant={"destructive"}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "delete" ? "Deleting..." : "Delete"}
                  </Button>
                </PopoverContent>
              </Popover>
            )}
            <Dialog
              open={connectionDialogOpen}
              onOpenChange={setConnectionDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  size={"sm"}
                  variant={"default"}
                  className="cursor-pointer"
                  onClick={handleOpenConnectionDialog}
                >
                  Connect
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl p-0 gap-0! bg-card">
                <DialogHeader className="border-b border-border p-4 mb-0! gap-0">
                  <DialogTitle className="text-xl font-medium">
                    Database Connection
                  </DialogTitle>
                </DialogHeader>

                <div className="p-4">
                  <div className="space-y-6">
                    {/* Domain Toggle - Minimalist layout without wrapping borders */}
                    {canUseDomain && (
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-neutral-200">
                            Use Custom Domain
                          </span>
                          <span className="text-sm text-neutral-500">
                            Connect via {currentHostname} instead of raw IP
                            address.
                          </span>
                        </div>
                        <button
                          onClick={() => setUseDomain(!useDomain)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                            useDomain ? "bg-foreground" : "bg-muted"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow ring-0 transition duration-200 ease-in-out ${
                              useDomain
                                ? "translate-x-4 bg-card"
                                : "translate-x-0 bg-muted-foreground"
                            }`}
                          />
                        </button>
                      </div>
                    )}

                    {connectionLoading ? (
                      <div className="py-6 text-sm text-neutral-500 animate-pulse">
                        Retrieving connection string...
                      </div>
                    ) : displayConnectionString ? (
                      <div className="space-y-0">
                        {/* Connection String Label & Expiry */}
                        <div className="flex items-center justify-between rounded-t-md border border-border bg-muted px-3 py-1.5">
                          <label className="text-sm font-medium text-neutral-300">
                            Connection string
                          </label>
                          <div className="flex items-center overflow-hidden rounded-md border border-border bg-muted/20">
                            {tokenExpiryInfo && (
                              <span
                                className={`px-2 py-1 text-xs ${
                                  tokenExpiryInfo.isExpired
                                    ? "text-red-400"
                                    : tokenExpiryInfo.isNearExpiry
                                      ? "text-amber-400/90"
                                      : "text-neutral-400"
                                }`}
                              >
                                Expires {tokenExpiryInfo.exact}
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-6 rounded-none px-2 text-xs ${
                                tokenExpiryInfo ? "border-l border-border" : ""
                              }`}
                              onClick={() => setConfirmRotateTokenOpen(true)}
                              disabled={rotatingToken || connectionLoading}
                            >
                              {rotatingToken ? "..." : "Rotate"}
                            </Button>
                          </div>
                        </div>

                        {/* Core Input Block - The Focus is here */}
                        <div className="group relative flex items-center overflow-hidden rounded-b-md border border-border border-t-0 bg-card transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
                          <input
                            readOnly
                            className="w-full bg-transparent px-3 py-2.5 text-sm font-mono text-foreground outline-none selection:bg-muted placeholder:text-muted-foreground"
                            value={displayConnectionString}
                          />
                          {/* Seamless copy button inside the input container */}
                          <div className="flex bg-card pr-1.5">
                            <button
                              onClick={() =>
                                copyToClipboard(displayConnectionString)
                              }
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground flex-shrink-0"
                              title="Copy to clipboard"
                            >
                              {copied ? (
                                <CheckIcon
                                  size={16}
                                  className="text-foreground"
                                />
                              ) : (
                                <CopyIcon size={16} />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                        No connection string available
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Keep this connection string secure. Do not share it in
                      public repos, chats, or client-side code. Rotate the token
                      immediately if you think it was exposed.
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete Database?"
        description="Are you sure you want to delete this database? This will remove the container and all data."
        confirmText="Delete"
        confirmVariant="destructive"
        loading={actionLoading === "delete"}
        onConfirm={async () => {
          await handleAction("delete");
          setConfirmDeleteOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirmRotateTokenOpen}
        onOpenChange={setConfirmRotateTokenOpen}
        title="Rotate Access Token?"
        description="Existing connection strings will stop working immediately."
        confirmText="Rotate"
        confirmVariant="destructive"
        loading={rotatingToken}
        onConfirm={async () => {
          await rotateConnectionToken();
          setConfirmRotateTokenOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirmSecureLegacyOpen}
        onOpenChange={setConfirmSecureLegacyOpen}
        title="Secure Legacy Public Ports?"
        description={`This recreates the legacy-exposed database container${(database?.legacy_public_branch_binding_count || 0) > 0 ? ` and ${database?.legacy_public_branch_binding_count} branch container(s)` : ""} with loopback-only host bindings. Expect a brief interruption while the data is moved into the secured replacement container. Any apps still connecting to old raw Postgres ports will stop working and should use the proxy connection string instead.`}
        confirmText="Secure Now"
        loading={actionLoading === "secure-legacy-bindings"}
        onConfirm={async () => {
          await secureLegacyBindings();
          setConfirmSecureLegacyOpen(false);
        }}
      />

      {database?.has_legacy_public_bindings && (
        <div className="mx-6 md:mx-12 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="font-medium text-amber-200">
                Direct public database exposure detected
              </p>
              <p className="text-amber-100/80">
                {database.legacy_public_database_binding
                  ? "This database"
                  : "At least one branch for this database"}{" "}
                still has a legacy raw Postgres port published publicly.
                {database.legacy_public_branch_binding_count
                  ? ` ${database.legacy_public_branch_binding_count} branch container(s) are included in the migration.`
                  : ""}
              </p>
            </div>
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={() => setConfirmSecureLegacyOpen(true)}
              disabled={actionLoading !== null}
            >
              {actionLoading === "secure-legacy-bindings"
                ? "Securing..."
                : "Secure Legacy Ports"}
            </Button>
          </div>
        </div>
      )}

      <div className="p-6 md:p-12 pb-4 md:pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 w-full border-b border-border">
              <span className="text-sm font-medium text-neutral-300">CPU</span>
            </div>
            {metricsLoading ? (
              <div className="p-4">
                <div className="h-8 w-16 bg-neutral-800 animate-pulse rounded"></div>
              </div>
            ) : (
              <div className="p-4">
                <p className="text-2xl font-medium text-neutral-100 font-mono">
                  {metrics?.cpu_usage_percent !== undefined &&
                  metrics?.cpu_usage_percent < 0.01
                    ? metrics?.cpu_usage_percent.toFixed(4)
                    : (metrics?.cpu_usage_percent?.toFixed(1) ?? "0")}
                  %
                </p>
                <p className="text-sm text-neutral-500 ">
                  of {limits?.max_cpu ?? 1} CPU
                  {limits?.max_cpu !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Connections
              </span>
            </div>
            <div className="p-4 flex flex-row items-end justify-between">
              <div>
                {metricsLoading ? (
                  <Skeleton className="h-8 w-16 mb-1" />
                ) : (
                  <p className={`text-2xl font-medium font-mono`}>
                    {metrics?.active_connections ?? 0}
                  </p>
                )}
                <p className="text-sm text-neutral-500">Active queries</p>
              </div>
              {!metricsLoading && (
                <Link to={`/db/${id}/connections`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs gap-1.5 text-neutral-400 hover:text-neutral-100"
                  >
                    Details
                    <ArrowSquareOut size={14} />
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Memory
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <>
                  <Skeleton className="h-8 w-24 mb-1" />
                  <Skeleton className="h-4 w-32" />
                </>
              ) : (
                <>
                  <p className={`text-2xl font-medium font-mono`}>
                    {metrics?.memory_usage_mb?.toFixed(1) ?? "0"} MB
                  </p>
                  <p className="text-sm text-neutral-500">
                    {metrics?.memory_usage_percent?.toFixed(1) ?? 0}% of{" "}
                    {(limits?.max_ram_mb ?? 512).toLocaleString()} MB
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">Size</span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-24 mb-1" />
              ) : (
                <p className="text-2xl font-medium font-mono">
                  {metrics?.database_size?.replace("SET\n", "") || "0 MB"}
                </p>
              )}
              <p className="text-sm text-neutral-500">Database size</p>
            </div>
          </div>
        </div>

        <div className="px-6 md:px-12 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Cache Hit Ratio
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-20 mb-1" />
              ) : (
                <p
                  className={`text-2xl font-medium font-mono ${metrics?.cache_hit_ratio && metrics.cache_hit_ratio < 95 ? "text-amber-400" : "text-neutral-100"}`}
                >
                  {metrics?.cache_hit_ratio?.toFixed(2) ?? "0.00"}%
                </p>
              )}
              <p className="text-sm text-neutral-500">Data served from RAM</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Uptime
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-28 mb-1" />
              ) : (
                <p className="text-2xl font-medium text-neutral-100 font-mono">
                  {metrics?.uptime_seconds
                    ? formatUptime(metrics.uptime_seconds)
                    : "0s"}
                </p>
              )}
              <p className="text-sm text-neutral-500">Since last restart</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Longest Query
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-16 mb-1" />
              ) : (
                <p
                  className={`text-2xl font-medium font-mono ${metrics?.longest_query_seconds && metrics.longest_query_seconds > 60 ? "text-red-400" : "text-neutral-100"}`}
                >
                  {metrics?.longest_query_seconds?.toFixed(1) ?? "0.0"}s
                </p>
              )}
              <p className="text-sm text-neutral-500">
                Oldest active transaction
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 md:px-12 pb-6 grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
          {/* CPU & Memory Chart */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 flex flex-row justify-between items-center">
              <h3 className="text-2xl font-medium text-neutral-300 mb-6">
                Resource Usage (1H)
              </h3>
              {!metricsLoading && (
                <div className="flex flex-row items-center gap-1">
                  <div className="bg-blue-500/10 text-xs font-mono text-blue-300 px-2 py-1 rounded-sm">
                    <h2>CPU</h2>
                  </div>
                  <div className="bg-purple-500/10 text-xs font-mono text-purple-300 px-2 py-1 rounded-sm">
                    <h2>RAM</h2>
                  </div>
                  <div className="bg-orange-500/10 text-xs font-mono text-orange-300 px-2 py-1 rounded-sm">
                    <h2>DR</h2>
                  </div>
                  <div className="bg-emerald-500/10 text-xs font-mono text-emerald-300 px-2 py-1 rounded-sm">
                    <h2>DW</h2>
                  </div>
                </div>
              )}
            </div>
            <div className="h-[250px] w-full p-4 scale-105">
              {metricsLoading ? (
                <div className="p-4 pb-3 w-full h-full">
                  <Skeleton className="h-full w-full rounded-md" />
                </div>
              ) : (
                <div className="h-full w-full scale-105">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={aggregatedHistory}>
                      <defs>
                        <linearGradient
                          id="colorCpu"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#3b82f6"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#3b82f6"
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="colorMem"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#a855f7"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#a855f7"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>

                      <XAxis dataKey="timestamp" hide />
                      <YAxis yAxisId="left" hide />
                      <YAxis yAxisId="right" orientation="right" hide />

                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#171717",
                          border: "1px solid #333",
                          fontSize: "12px",
                          borderRadius: "8px",
                        }}
                        labelFormatter={(timestamp) => {
                          return new Date(timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });
                        }}
                        formatter={(
                          value: number | undefined,
                          name: string | undefined,
                        ) => {
                          const label = name || "Metric";
                          if (value === undefined) return ["-", label];
                          if (
                            label.includes("Read") ||
                            label.includes("Write")
                          ) {
                            return [formatBytes(value), label];
                          }
                          return [`${value}%`, label];
                        }}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="cpu_usage_percent"
                        name="CPU %"
                        stroke="#3b82f6"
                        fillOpacity={1}
                        fill="url(#colorCpu)"
                        isAnimationActive={false}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="memory_usage_percent"
                        name="Memory %"
                        stroke="#a855f7"
                        fillOpacity={1}
                        fill="url(#colorMem)"
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="io_read_bps"
                        name="Disk Read"
                        stroke="#fdba74"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="io_write_bps"
                        name="Disk Write"
                        stroke="#6ee7b7"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Connections Chart */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4">
              <h3 className="text-2xl font-medium text-neutral-300 mb-6">
                Peak Connections (1H)
              </h3>
            </div>
            <div className="h-[250px] w-full p-4 scale-105">
              {metricsLoading ? (
                <div className="p-4 pb-3 w-full h-full">
                  <Skeleton className="h-full w-full rounded-md" />
                </div>
              ) : (
                <div className="h-full w-full scale-105">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={aggregatedHistory}>
                      <XAxis dataKey="timestamp" hide />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#171717",
                          border: "1px solid #333",
                          fontSize: "12px",
                          borderRadius: "12px",
                        }}
                        labelFormatter={(timestamp) => {
                          return new Date(timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });
                        }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="active_connections"
                        name="Connections"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
