import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ClockCounterClockwiseIcon,
  FloppyDiskIcon,
  GearIcon,
  UploadIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDatabase } from "@/context/DatabaseContext";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import { toast } from "sonner";

interface BackupSettings {
  database_id: number;
  enabled: boolean;
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  path_prefix: string;
  encryption_enabled: boolean;
  encryption_public_key: string;
}

interface Backup {
  id: number;
  database_id: number;
  filename: string;
  is_encrypted: boolean;
  size_bytes: number;
  status: string;
  s3_url: string;
  error: string;
  created_at: string;
}

type BackupSection = "overview" | "settings" | "external";
type DecryptMode = "download" | "restore";

export default function Backup() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { selectedDatabase } = useDatabase();
  const { token, logout } = useAuth();

  const [settingsForm, setSettingsForm] = useState<BackupSettings>({
    database_id: parseInt(id || "0"),
    enabled: false,
    provider: "s3",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    access_key: "",
    secret_key: "",
    path_prefix: "/baseful/backups",
    encryption_enabled: false,
    encryption_public_key: "",
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["backupSettings", id, token],
    queryFn: async () => {
      const res = await authFetch(
        `/api/databases/${id}/backups/settings`,
        token,
        {},
        logout,
      );
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json() as Promise<BackupSettings>;
    },
    enabled: !!id && !!token,
  });

  useEffect(() => {
    if (settings) {
      setSettingsForm(settings);
    }
  }, [settings]);

  const { data: backups, isLoading: backupsLoading } = useQuery({
    queryKey: ["backups", id, token],
    queryFn: async () => {
      const res = await authFetch(
        `/api/databases/${id}/backups`,
        token,
        {},
        logout,
      );
      if (!res.ok) throw new Error("Failed to fetch backups");
      return res.json() as Promise<Backup[]>;
    },
    enabled: !!id && !!token,
    refetchInterval: 5000,
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings: BackupSettings) => {
      const res = await authFetch(
        `/api/databases/${id}/backups/settings`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSettings),
        },
        logout,
      );
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backupSettings", id] });
      toast.success("Settings saved successfully");
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Failed to save settings";
      toast.error(`Failed to save settings: ${message}`);
    },
  });

  const manualBackupMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(
        `/api/databases/${id}/backups/manual`,
        token,
        {
          method: "POST",
        },
        logout,
      );
      if (!res.ok) throw new Error("Failed to trigger backup");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups", id] });
      toast.success("Backup started");
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Failed to start backup";
      toast.error(`Failed to start backup: ${message}`);
    },
  });

  const [backupToRollback, setBackupToRollback] = useState<number | null>(null);
  const [decryptDialogOpen, setDecryptDialogOpen] = useState(false);
  const [decryptMode, setDecryptMode] = useState<DecryptMode>("download");
  const [targetBackup, setTargetBackup] = useState<Backup | null>(null);
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");
  const [decryptLoading, setDecryptLoading] = useState(false);
  const [keyGuideOpen, setKeyGuideOpen] = useState(false);

  const hasSettingsChanges = useMemo(() => {
    if (!settings) return false;

    const normalize = (value: BackupSettings): BackupSettings => ({
      ...value,
      endpoint: value.endpoint || "",
      region: value.region || "",
      bucket: value.bucket || "",
      access_key: value.access_key || "",
      secret_key: value.secret_key || "",
      path_prefix: value.path_prefix || "",
      encryption_public_key: value.encryption_public_key || "",
      encryption_enabled: !!value.encryption_enabled,
      enabled: !!value.enabled,
    });

    return (
      JSON.stringify(normalize(settingsForm)) !==
      JSON.stringify(normalize(settings))
    );
  }, [settings, settingsForm]);

  const rollbackMutation = useMutation({
    mutationFn: async (backupId: number) => {
      const res = await authFetch(
        `/api/databases/${id}/backups/${backupId}/restore`,
        token,
        {
          method: "POST",
        },
        logout,
      );
      if (!res.ok) throw new Error("Failed to trigger restore");
      return res.json();
    },
    onSuccess: () => {
      setBackupToRollback(null);
      toast.success(
        "Restore started. Database will be unavailable during restoration.",
      );
    },
    onError: (err) => {
      setBackupToRollback(null);
      const message =
        err instanceof Error ? err.message : "Failed to start restore";
      toast.error(`Failed to start restore: ${message}`);
    },
  });

  // External restore state
  const [externalRestoreMode, setExternalRestoreMode] = useState<
    "file" | "connection"
  >("file");
  const [activeSection, setActiveSection] = useState<BackupSection>("overview");
  const [connectionString, setConnectionString] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sectionLabel: Record<BackupSection, string> = {
    overview: "Recent Backups",
    settings: "Settings",
    external: "External Restore",
  };

  const restoreFromFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch(
        `/api/databases/${id}/restore/file`,
        token,
        {
          method: "POST",
          body: formData,
        },
        logout,
      );
      if (!res.ok) throw new Error("Failed to restore from file");
      return res.json();
    },
    onSuccess: () => {
      toast.success(
        "Restore started. Database will be unavailable during restoration.",
      );
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Failed to start restore";
      toast.error(`Failed to start restore: ${message}`);
    },
  });

  const restoreFromConnectionMutation = useMutation({
    mutationFn: async (connStr: string) => {
      const res = await authFetch(
        `/api/databases/${id}/restore/connection`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connection_string: connStr }),
        },
        logout,
      );
      if (!res.ok) throw new Error("Failed to restore from connection");
      return res.json();
    },
    onSuccess: () => {
      setConnectionString("");
      toast.success(
        "Restore started. Database will be unavailable during restoration.",
      );
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Failed to start restore";
      toast.error(`Failed to start restore: ${message}`);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      restoreFromFileMutation.mutate(file);
    }
  };

  const handleSaveSettings = () => {
    if (
      settingsForm.encryption_enabled &&
      !settingsForm.encryption_public_key.trim()
    ) {
      toast.error("Encryption is enabled, but no public key is configured.");
      return;
    }
    saveSettingsMutation.mutate(settingsForm);
  };

  const handleResetSettings = () => {
    if (!settings) return;
    setSettingsForm(settings);
  };

  const openDecryptDialog = (backup: Backup, mode: DecryptMode) => {
    setTargetBackup(backup);
    setDecryptMode(mode);
    setDecryptDialogOpen(true);
  };

  const handleDecryptAction = async () => {
    if (!id || !targetBackup || !privateKeyInput.trim()) {
      toast.error("Private key is required.");
      return;
    }

    setDecryptLoading(true);
    try {
      if (decryptMode === "download") {
        const res = await authFetch(
          `/api/databases/${id}/backups/${targetBackup.id}/download-decrypted`,
          token,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              private_key: privateKeyInput,
              passphrase: passphraseInput,
            }),
          },
          logout,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to decrypt backup");
        }

        const blob = await res.blob();
        const disposition = res.headers.get("content-disposition") || "";
        const filenameMatch = disposition.match(/filename="([^"]+)"/);
        const filename =
          filenameMatch?.[1] || targetBackup.filename.replace(/\.gpg$/, "");

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const res = await authFetch(
          `/api/databases/${id}/backups/${targetBackup.id}/restore-with-key`,
          token,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              private_key: privateKeyInput,
              passphrase: passphraseInput,
            }),
          },
          logout,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to start restore");
        }
        toast.success(
          "Restore started. Database will be unavailable during restoration.",
        );
      }

      setDecryptDialogOpen(false);
      setPrivateKeyInput("");
      setPassphraseInput("");
      setTargetBackup(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setDecryptLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-blue-400 bg-blue-500/20 px-1.5 py-1 rounded";
      case "pending":
        return "text-amber-400 bg-amber-500/20 px-1.5 py-1 rounded";
      case "failed":
        return "text-red-400 bg-red-500/20 px-1.5 py-1 rounded";
      default:
        return "text-neutral-400 bg-neutral-500/20 px-1.5 py-1 rounded";
    }
  };

  const BackupRow = ({
    backup,
    onRollback,
    isRollingBack,
  }: {
    backup: Backup;
    onRollback: () => void;
    isRollingBack: boolean;
  }) => (
    <TableRow className="hover:bg-neutral-800/40 border-0">
      <TableCell className="border-b border-r border-border align-middle py-1.5">
        <span
          className={`text-xs cursor-default font-medium capitalize ${getStatusColor(
            backup.status,
          )}`}
          title={backup.error ? `${backup.error}` : backup.status}
        >
          {backup.status}
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs border-b border-r border-border align-middle py-1.5">
        {backup.filename}
      </TableCell>
      <TableCell className="border-b border-r border-border align-middle py-1.5">
        {formatBytes(backup.size_bytes)}
      </TableCell>
      <TableCell className="text-neutral-400 border-b border-r border-border align-middle py-1.5">
        {new Date(backup.created_at).toLocaleString()}
      </TableCell>
      <TableCell className="border-b border-border align-middle py-1.5 text-right">
        <div
          className={`grid w-full gap-2 ${
            backup.status === "completed" ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
          {backup.is_encrypted && backup.status === "completed" ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-8 px-3 text-xs"
              onClick={() => openDecryptDialog(backup, "download")}
            >
              Download
            </Button>
          ) : backup.s3_url ? (
            <Button asChild size={"sm"} variant={"outline"}>
              <a
                href={backup.s3_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center h-8 px-3 text-xs font-medium"
              >
                Download
              </a>
            </Button>
          ) : (
            <div />
          )}
          {backup.status === "completed" && (
            <Button
              variant="outline"
              size="sm"
              onClick={
                backup.is_encrypted
                  ? () => openDecryptDialog(backup, "restore")
                  : onRollback
              }
              disabled={backup.is_encrypted ? false : isRollingBack}
              className="w-full cursor-pointer h-8 px-3 text-xs"
            >
              Restore
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  if (settingsLoading) {
    return <div className="p-8 text-neutral-400">Loading settings...</div>;
  }

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex flex-row border-b border-border p-4 items-center gap-3 w-full">
        <div className="flex flex-row items-center gap-3 flex-1">
          <DitherAvatar
            value={selectedDatabase?.name || "database"}
            size={32}
          />

          <div className="flex flex-row items-center gap-2">
            <h1 className="text-xl md:text-2xl font-medium text-neutral-100">
              Backups & Restoration
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!settingsForm.enabled && (
            <div className="hidden sm:flex text-amber-500 text-xs bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 items-center gap-1">
              <WarningIcon />
              Backups Disabled
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <div className="hidden md:flex w-64 shrink-0 p-4 overflow-hidden flex-col">
          <ul className="flex flex-col gap-1">
            <li>
              <button
                onClick={() => setActiveSection("overview")}
                className={`w-full rounded-md flex flex-row items-center gap-2 text-left px-3 py-2 transition-colors ${
                  activeSection === "overview"
                    ? "bg-muted/75 text-neutral-100"
                    : "hover:bg-neutral-800/50 text-neutral-300"
                }`}
              >
                <ArchiveIcon size={16} />
                <span className="text-base">Overview</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveSection("settings")}
                className={`w-full rounded-md flex flex-row items-center gap-2 text-left px-3 py-2 transition-colors ${
                  activeSection === "settings"
                    ? "bg-muted/75 text-neutral-100"
                    : "hover:bg-neutral-800/50 text-neutral-300"
                }`}
              >
                <GearIcon size={16} />
                <span className="text-base">Settings</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveSection("external")}
                className={`w-full rounded-md flex flex-row items-center gap-2 text-left px-3 py-2 transition-colors ${
                  activeSection === "external"
                    ? "bg-muted/75 text-neutral-100"
                    : "hover:bg-neutral-800/50 text-neutral-300"
                }`}
              >
                <UploadIcon size={16} />
                <span className="text-base">External Restore</span>
              </button>
            </li>
          </ul>
        </div>

        <div className="flex-1 flex flex-col min-h-0 md:border-l border-border overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="hidden md:block text-xl md:text-2xl font-medium text-neutral-200">
              {sectionLabel[activeSection]}
            </h2>
            <div className="md:hidden">
              <Select
                value={activeSection}
                onValueChange={(value) =>
                  setActiveSection(value as BackupSection)
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-auto w-auto !border-0 !bg-transparent dark:!bg-transparent hover:!bg-transparent dark:hover:!bg-transparent active:!bg-transparent data-[state=open]:!bg-transparent !p-0 text-xl font-medium text-neutral-200 !shadow-none !ring-0 !ring-offset-0 !outline-none focus:!ring-0 focus-visible:!ring-0 focus-visible:!border-0 focus-visible:!outline-none gap-1.5 [&>svg]:opacity-100 [&>svg]:text-neutral-400"
                >
                  <SelectValue placeholder={sectionLabel[activeSection]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overview">Recent Backups</SelectItem>
                  <SelectItem value="settings">Settings</SelectItem>
                  <SelectItem value="external">External Restore</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {activeSection === "overview" ? (
              <Button
                onClick={() => manualBackupMutation.mutate()}
                disabled={
                  manualBackupMutation.isPending ||
                  (settingsForm.provider === "s3" && !settingsForm.bucket)
                }
                className="gap-2"
              >
                {manualBackupMutation.isPending
                  ? "Starting..."
                  : "Create Backup"}
              </Button>
            ) : (
              <div />
            )}
          </div>

          {activeSection === "overview" && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 overflow-auto">
                <Table className="border-separate border-spacing-0 min-w-[720px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-0">
                      <TableHead className="bg-[#141414]! border-b border-r border-border last:border-r-0">
                        Status
                      </TableHead>
                      <TableHead className="bg-[#141414]! border-b border-r border-border last:border-r-0">
                        Filename
                      </TableHead>
                      <TableHead className="bg-[#141414]! border-b border-r border-border last:border-r-0">
                        Size
                      </TableHead>
                      <TableHead className="bg-[#141414]! border-b border-r border-border last:border-r-0">
                        Created At
                      </TableHead>
                      <TableHead className="bg-[#141414]! border-b border-border text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backupsLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center py-8 border-b border-border"
                        >
                          Loading backups...
                        </TableCell>
                      </TableRow>
                    ) : backups?.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center py-8 text-neutral-500 border-b border-border"
                        >
                          No backups found. Configure settings and trigger a
                          backup.
                        </TableCell>
                      </TableRow>
                    ) : (
                      backups?.map((backup) => (
                        <BackupRow
                          key={backup.id}
                          backup={backup}
                          onRollback={() => setBackupToRollback(backup.id)}
                          isRollingBack={
                            rollbackMutation.isPending &&
                            rollbackMutation.variables === backup.id
                          }
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {activeSection === "settings" && (
            <div className="p-4 md:p-8 flex flex-col gap-5 max-w-4xl">
              <div className="border border-border rounded-xl bg-card p-5 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-neutral-100">
                    Backup Configuration
                  </h3>
                  <p className="text-sm text-neutral-500 mt-1">
                    Configure storage, credentials, and optional encryption.
                  </p>
                </div>
                <div className="flex items-center gap-3 bg-neutral-900 border border-border rounded-lg px-3 py-2">
                  <span className="text-xs font-medium text-neutral-300">
                    {settingsForm.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch
                    checked={settingsForm.enabled}
                    onCheckedChange={(c: boolean) =>
                      setSettingsForm({ ...settingsForm, enabled: c })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-neutral-200">
                      Storage Target
                    </h4>
                    <p className="text-xs text-neutral-500 mt-1">
                      Where backup files are uploaded.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Provider
                    </label>
                    <Select
                      value={settingsForm.provider}
                      onValueChange={(value) =>
                        setSettingsForm({
                          ...settingsForm,
                          provider: value,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="s3">S3 Compatible Storage</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Bucket Name
                    </label>
                    <Input
                      value={settingsForm.bucket}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          bucket: e.target.value,
                        })
                      }
                      placeholder="my-database-backups"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Path Prefix
                    </label>
                    <Input
                      value={settingsForm.path_prefix}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          path_prefix: e.target.value,
                        })
                      }
                      placeholder="/baseful/backups"
                    />
                  </div>
                </div>

                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-neutral-200">
                      Connection
                    </h4>
                    <p className="text-xs text-neutral-500 mt-1">
                      Endpoint and region used for object storage.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Region
                    </label>
                    <Input
                      value={settingsForm.region}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          region: e.target.value,
                        })
                      }
                      placeholder="us-east-1"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Endpoint URL
                    </label>
                    <Input
                      value={settingsForm.endpoint}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          endpoint: e.target.value,
                        })
                      }
                      placeholder="https://s3.amazonaws.com"
                    />
                    <p className="text-[10px] text-neutral-500">
                      Leave empty for AWS S3. Required for MinIO, R2, etc.
                    </p>
                  </div>
                </div>

                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-neutral-200">
                      Credentials
                    </h4>
                    <p className="text-xs text-neutral-500 mt-1">
                      Access key pair used to upload and read backups.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Access Key ID
                    </label>
                    <Input
                      type="password"
                      value={settingsForm.access_key}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          access_key: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Secret Access Key
                    </label>
                    <Input
                      type="password"
                      value={settingsForm.secret_key}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          secret_key: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-neutral-200">
                        Encryption
                      </h4>
                      <p className="text-xs text-neutral-500 mt-1">
                        Encrypt backups with your public key before upload.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] text-neutral-500 hover:text-neutral-300"
                      onClick={() => setKeyGuideOpen(true)}
                    >
                      Key guide
                    </Button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-neutral-900 px-3 py-2">
                    <div>
                      <p className="text-xs text-neutral-200">
                        Encrypt Backups
                      </p>
                      <p className="text-[10px] text-neutral-500 mt-0.5">
                        Disabled by default.
                      </p>
                    </div>
                    <Switch
                      checked={settingsForm.encryption_enabled}
                      onCheckedChange={(c: boolean) =>
                        setSettingsForm({
                          ...settingsForm,
                          encryption_enabled: c,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-neutral-400">
                      Public Key (ASCII-armored OpenPGP)
                    </label>
                    <Textarea
                      value={settingsForm.encryption_public_key}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          encryption_public_key: e.target.value,
                        })
                      }
                      placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
                      className="min-h-36 max-h-64 overflow-y-auto font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "external" && (
            <div className="p-4 md:p-6 max-w-2xl flex flex-col gap-6">
              <div className="border border-border rounded-lg bg-card p-6 flex flex-col gap-6">
                <div className="flex flex-col gap-1 pb-4 border-b border-border">
                  <h3 className="text-lg font-medium text-neutral-100">
                    Restore from External Source
                  </h3>
                  <p className="text-sm text-neutral-500">
                    Restore your database from a local file or external
                    PostgreSQL connection.
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setExternalRestoreMode("file")}
                      className={`flex-1 py-3 px-4 rounded-md border text-sm font-medium transition-colors ${
                        externalRestoreMode === "file"
                          ? "border-blue-500 bg-blue-500/10 text-blue-400"
                          : "border-border bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      <UploadIcon className="inline-block mr-2" size={16} />
                      Upload File
                    </button>
                    <button
                      onClick={() => setExternalRestoreMode("connection")}
                      className={`flex-1 py-3 px-4 rounded-md border text-sm font-medium transition-colors ${
                        externalRestoreMode === "connection"
                          ? "border-blue-500 bg-blue-500/10 text-blue-400"
                          : "border-border bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      <ClockCounterClockwiseIcon
                        className="inline-block mr-2"
                        size={16}
                      />
                      External Connection
                    </button>
                  </div>

                  {externalRestoreMode === "file" && (
                    <div className="border border-dashed border-border rounded-lg p-8 text-center">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept=".sql,.dump"
                        className="hidden"
                      />
                      <UploadIcon
                        size={48}
                        className="mx-auto text-neutral-500 mb-4"
                      />
                      <p className="text-neutral-300 mb-2">
                        Click to select a backup file
                      </p>
                      <p className="text-sm text-neutral-500 mb-4">
                        Supports .sql and .dump files
                      </p>
                      <Button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={restoreFromFileMutation.isPending}
                        className="gap-2"
                      >
                        {restoreFromFileMutation.isPending ? (
                          "Starting restore..."
                        ) : (
                          <>
                            <UploadIcon size={18} />
                            Select File
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {externalRestoreMode === "connection" && (
                    <div className="flex flex-col gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-neutral-400">
                          PostgreSQL Connection String
                        </label>
                        <Input
                          value={connectionString}
                          onChange={(e) => setConnectionString(e.target.value)}
                          placeholder="postgresql://user:password@host:5432/database"
                        />
                        <p className="text-[10px] text-neutral-500">
                          Enter a connection string to an external PostgreSQL
                          database. The data will be dumped and restored into
                          this database.
                        </p>
                      </div>
                      <Button
                        onClick={() =>
                          restoreFromConnectionMutation.mutate(connectionString)
                        }
                        disabled={
                          restoreFromConnectionMutation.isPending ||
                          !connectionString
                        }
                        className="gap-2 self-end"
                      >
                        {restoreFromConnectionMutation.isPending ? (
                          "Starting restore..."
                        ) : (
                          <>
                            <ClockCounterClockwiseIcon size={18} />
                            Restore from External DB
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-amber-500 text-sm">
                    <WarningIcon size={18} />
                    <span>
                      Warning: This will replace all current data in the
                      database.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={backupToRollback !== null}
        onOpenChange={(open) => !open && setBackupToRollback(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rollback</DialogTitle>
            <DialogDescription>
              Are you sure you want to rollback to this backup?
              <br />
              <br />
              <span className="text-red-500 font-bold">
                WARNING: This action is destructive.
              </span>
              <br />
              All current data in this database will be completely replaced by
              the backup data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupToRollback(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (backupToRollback) rollbackMutation.mutate(backupToRollback);
              }}
              disabled={rollbackMutation.isPending}
            >
              {rollbackMutation.isPending
                ? "Restoring..."
                : "I understand, restore backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={keyGuideOpen} onOpenChange={setKeyGuideOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Backup Encryption Key Guide</DialogTitle>
            <DialogDescription>
              End-to-end setup for creating and using a key pair with encrypted
              backups on macOS, Linux, and Windows.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h4 className="text-neutral-100 font-medium">
                1. Generate a new key pair
              </h4>
              <p className="text-neutral-400">
                Use RSA for compatibility with backup encryption.
              </p>
              <pre className="text-[11px] bg-neutral-900 border border-border rounded-md p-3 overflow-x-auto text-neutral-300 whitespace-pre-wrap">
                {`macOS (Homebrew):
brew install gnupg
gpg --full-generate-key

Linux:
sudo apt install gnupg   # Debian/Ubuntu
gpg --full-generate-key

Windows:
# Install Gpg4win, open Kleopatra, then create a new OpenPGP key
# or use gpg in terminal if installed
gpg --full-generate-key

# choose: (1) RSA and RSA
# key size: 4096
# set expiration (for example: 1y)
# finish and set your passphrase`}
              </pre>
            </section>

            <section className="space-y-2">
              <h4 className="text-neutral-100 font-medium">
                2. Export and store your keys
              </h4>
              <p className="text-neutral-400">
                Paste only the public key into Baseful. Keep private key outside
                the app.
              </p>
              <pre className="text-[11px] bg-neutral-900 border border-border rounded-md p-3 overflow-x-auto text-neutral-300 whitespace-pre-wrap">
                {`# Export public key (paste in Backup Settings)
gpg --armor --export your-email@example.com > public-rsa.asc

# Export private key (store securely outside Baseful)
gpg --armor --export-secret-keys your-email@example.com > private-rsa.asc`}
              </pre>
            </section>

            <section className="space-y-2">
              <h4 className="text-neutral-100 font-medium">
                3. Configure Baseful
              </h4>
              <p className="text-neutral-400">
                In Backup Settings, paste the armored public key, enable
                encryption, and save.
              </p>
              <p className="text-neutral-400">
                Important: only backups created after enabling encryption are
                encrypted.
              </p>
            </section>

            <section className="space-y-2">
              <h4 className="text-neutral-100 font-medium">
                4. Download or restore encrypted backups
              </h4>
              <p className="text-neutral-400">
                Baseful will ask for your private key and passphrase each time.
                They are not stored.
              </p>
              <pre className="text-[11px] bg-neutral-900 border border-border rounded-md p-3 overflow-x-auto text-neutral-300 whitespace-pre-wrap">
                {`# Optional local decrypt command
gpg --decrypt backup.sql.gpg > backup.sql`}
              </pre>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {activeSection === "settings" && hasSettingsChanges && (
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
                onClick={handleResetSettings}
                disabled={saveSettingsMutation.isPending}
                className="text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.08] h-9 text-sm rounded-full px-5"
              >
                Discard
              </Button>
              <Button
                onClick={handleSaveSettings}
                disabled={saveSettingsMutation.isPending}
                className="bg-blue-600 hover:bg-blue-500 text-white h-9 text-sm px-5 rounded-full shadow-md shadow-blue-500/20 transition-all"
              >
                {saveSettingsMutation.isPending ? (
                  <div className="flex items-center gap-2">
                    <FloppyDiskIcon size={14} className="animate-pulse" />
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

      <Dialog
        open={decryptDialogOpen}
        onOpenChange={(open) => {
          setDecryptDialogOpen(open);
          if (!open) {
            setPrivateKeyInput("");
            setPassphraseInput("");
            setTargetBackup(null);
          }
        }}
      >
        <DialogContent className="p-0 gap-0! bg-card max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="border-b border-border p-4 mb-0! gap-0">
            <DialogTitle className="text-xl font-medium">
              {decryptMode === "download"
                ? "Decrypt & Download Backup"
                : "Decrypt & Restore Backup"}
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              Provide the private key for this encrypted backup. The key is used
              only for this action and is not stored.
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-neutral-400 uppercase tracking-wider text-xs font-medium">
                Private Key (ASCII-armored OpenPGP)
              </label>
              <Textarea
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value)}
                placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
                className="min-h-36 max-h-[28vh] overflow-y-auto font-mono text-xs bg-background"
              />
            </div>

            <div className="space-y-2">
              <label className="text-neutral-400 uppercase tracking-wider text-xs font-medium">
                Passphrase (if your key has one)
              </label>
              <Input
                type="password"
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                placeholder="Optional passphrase"
                className="w-full"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border p-4 mt-0">
            <Button
              variant="outline"
              onClick={() => setDecryptDialogOpen(false)}
              disabled={decryptLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleDecryptAction} disabled={decryptLoading}>
              {decryptLoading
                ? "Processing..."
                : decryptMode === "download"
                  ? "Decrypt & Download"
                  : "Decrypt & Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
