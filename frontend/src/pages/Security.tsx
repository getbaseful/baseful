import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  Clock,
  ShieldCheck,
  Tag,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface UpdateStatus {
  available: boolean;
  currentHash: string;
  remoteHash: string;
  lastChecked: string;
  checkingStatus: boolean;
  updatingStatus: boolean;
}

type SecuritySection = "baseful" | "system";

const systemHardeningItems = [
  {
    title: "SSH keys only",
    description:
      "Use SSH keys for authentication only, disabling password-based login.",
  },
  {
    title: "Firewall default-deny",
    description:
      "Enable a strict firewall policy that denies all incoming traffic by default.",
  },
  {
    title: "Tailscale",
    description:
      "Enable Tailscale for secure, private networking between your devices.",
  },
  {
    title: "Fail2ban",
    description:
      "Automatically block IP addresses that show malicious signs, such as too many failed attempts.",
  },
  {
    title: "Change default SSH port",
    description:
      "Move SSH to a non-standard port to reduce automated brute-force attempts.",
  },
  {
    title: "Disable root login",
    description:
      "Prevent direct root access over SSH and require non-root escalation.",
  },
  {
    title: "Unattended upgrades",
    description:
      "Automatically install security updates to keep the host patched.",
  },
];

const sectionLabel: Record<SecuritySection, string> = {
  baseful: "Baseful",
  system: "System",
};

export default function Security() {
  const { token, logout } = useAuth();
  const [activeSection, setActiveSection] = useState<SecuritySection>("baseful");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const upgradeCommand =
    "curl -sSL https://raw.githubusercontent.com/tobiasrasmsn/baseful/main/install.sh | bash -s -- update";

  const fetchUpdateStatus = async (forceCheck = false) => {
    if (forceCheck) setActionLoading(true);
    try {
      const endpoint = forceCheck
        ? "/api/system/update-check"
        : "/api/system/update-status";
      const res = await authFetch(
        endpoint,
        token,
        { method: forceCheck ? "POST" : "GET" },
        logout,
      );
      if (res.ok) {
        const data = await res.json();
        setUpdateStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch update status", err);
    } finally {
      if (forceCheck) setActionLoading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUpdateStatus();
  }, []);

  const formatHash = (hash: string) => {
    if (!hash) return "Unknown";
    return hash.substring(0, 7);
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
          Loading security settings...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-row border-b border-border p-4 items-center gap-3 w-full">
        <h1 className="text-xl md:text-2xl font-medium text-neutral-100">
          Security
        </h1>
      </div>

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <div className="hidden md:flex w-64 shrink-0 p-4 overflow-hidden flex-col">
          <ul className="flex flex-col gap-1">
            <li>
              <button
                onClick={() => setActiveSection("baseful")}
                className={`w-full rounded-md flex flex-row items-center gap-2 text-left px-3 py-2 transition-colors ${
                  activeSection === "baseful"
                    ? "bg-muted/75 text-neutral-100"
                    : "hover:bg-neutral-800/50 text-neutral-300"
                }`}
              >
                <ArrowClockwise size={16} />
                <span className="text-base">Baseful</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveSection("system")}
                className={`w-full rounded-md flex flex-row items-center gap-2 text-left px-3 py-2 transition-colors ${
                  activeSection === "system"
                    ? "bg-muted/75 text-neutral-100"
                    : "hover:bg-neutral-800/50 text-neutral-300"
                }`}
              >
                <ShieldCheck size={16} />
                <span className="text-base">System</span>
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
                onValueChange={(value) => setActiveSection(value as SecuritySection)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-auto w-auto !border-0 !bg-transparent dark:!bg-transparent hover:!bg-transparent dark:hover:!bg-transparent active:!bg-transparent data-[state=open]:!bg-transparent !p-0 text-xl font-medium text-neutral-200 !shadow-none !ring-0 !ring-offset-0 !outline-none focus:!ring-0 focus-visible:!ring-0 focus-visible:!border-0 focus-visible:!outline-none gap-1.5 [&>svg]:opacity-100 [&>svg]:text-neutral-400"
                >
                  <SelectValue placeholder={sectionLabel[activeSection]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baseful">Baseful</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {activeSection === "baseful" ? (
              <Button
                variant="outline"
                onClick={() => fetchUpdateStatus(true)}
                disabled={actionLoading || updateStatus?.checkingStatus}
                className="gap-2"
              >
                {actionLoading || updateStatus?.checkingStatus ? (
                  <CircleNotch size={16} className="animate-spin" />
                ) : (
                  <ArrowClockwise size={16} weight="bold" />
                )}
                Check Updates
              </Button>
            ) : (
              <div />
            )}
          </div>

          {activeSection === "baseful" && (
            <div className="p-4 md:p-8 flex flex-col gap-5 max-w-5xl">
              <div className="border border-border rounded-xl bg-card p-5">
                <h3 className="text-lg font-medium text-neutral-100">
                  Baseful Updates
                </h3>
                <p className="text-sm text-neutral-500 mt-1">
                  Review the current update status and use the command below to
                  upgrade your server when a new version is available.
                </p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    <ShieldCheck size={16} className="text-neutral-400" />
                    Status
                  </div>
                  <div className="flex items-center gap-2 text-sm text-neutral-200">
                    {updateStatus?.available ? (
                      <div className="flex items-center gap-1.5 font-medium">
                        <Warning
                          size={16}
                          weight="bold"
                          className="text-neutral-400"
                        />
                        Update Available
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 font-medium">
                        <CheckCircle
                          size={16}
                          weight="bold"
                          className="text-neutral-400"
                        />
                        Up to Date
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    <Tag size={16} className="text-neutral-400" />
                    Version
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-500">Current hash</div>
                    <div className="text-lg font-mono text-neutral-200">
                      {formatHash(updateStatus?.currentHash || "")}
                    </div>
                    {updateStatus?.remoteHash && (
                      <div className="text-xs text-neutral-500">
                        Remote:{" "}
                        <span className="font-mono text-neutral-300">
                          {formatHash(updateStatus.remoteHash)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    <Clock size={16} className="text-neutral-400" />
                    Last Checked
                  </div>
                  <div className="text-sm text-neutral-300">
                    {updateStatus?.lastChecked
                      ? new Date(updateStatus.lastChecked).toLocaleString()
                      : "Never"}
                  </div>
                </div>
              </div>

              <div className="border border-border rounded-xl bg-card p-5 space-y-3">
                <p className="text-sm text-neutral-300">
                  Upgrade command (run on your server):
                </p>
                <code className="block w-full overflow-x-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-neutral-200">
                  {upgradeCommand}
                </code>
              </div>
            </div>
          )}

          {activeSection === "system" && (
            <div className="p-4 md:p-8 flex flex-col gap-5 max-w-5xl">
              <div className="border border-border rounded-xl bg-card p-5">
                <h3 className="text-lg font-medium text-neutral-100">
                  System Hardening
                </h3>
                <p className="text-sm text-neutral-500 mt-1">
                  These controls are planned in the UI. For now, use the
                  installer hardening flow on your host to apply them.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {systemHardeningItems.map((item) => (
                  <div
                    key={item.title}
                    className="border border-border rounded-xl bg-card p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-neutral-100">
                        {item.title}
                      </h4>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 border border-border rounded-full px-2 py-0.5">
                        Planned
                      </span>
                    </div>
                    <p className="text-sm text-neutral-400 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
