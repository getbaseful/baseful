import { useState, useEffect } from "react";
import {
  CheckCircle,
  XCircle,
  ArrowClockwise,
  ShieldCheck,
  Copy,
  Check,
  CircleNotch,
  Globe,
  CheckIcon,
  LockKey,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface WebServerStatus {
  domain: string;
  ip: string;
  propagated: boolean;
  ssl_enabled: boolean;
  app_port: number;
  proxy_port: number;
}

export default function WebServer() {
  const { token, logout } = useAuth();
  const [status, setStatus] = useState<WebServerStatus | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await authFetch("/api/system/webserver/status", token, {}, logout);
      const data = await res.json();
      setStatus(data);
      if (data.domain) {
        setDomainInput(data.domain);
      }
    } catch (err) {
      console.error("Failed to fetch web server status", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSaveDomain = async () => {
    setActionLoading(true);
    try {
      const res = await authFetch("/api/system/webserver/domain", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput }),
      }, logout);
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error("Failed to save domain", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckDNS = async () => {
    setActionLoading(true);
    try {
      const res = await authFetch("/api/system/webserver/check-dns", token, {}, logout);
      const data = await res.json();
      if (status) {
        setStatus({ ...status, propagated: data.propagated });
      }
    } catch (err) {
      console.error("Failed to check DNS", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleProvisionSSL = async () => {
    setActionLoading(true);
    try {
      const res = await authFetch("/api/system/webserver/provision-ssl", token, {
        method: "POST",
      }, logout);
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error("Failed to provision SSL", err);
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0a0a0a] gap-3">
        <CircleNotch size={24} className="text-neutral-500 animate-spin" weight="bold" />
        <div className="text-neutral-400 text-sm font-medium">Loading server status...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full  relative">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-white/[0.08] bg-white/[0.02] px-8 py-5 flex items-center gap-3">
        <h1 className="text-xl font-medium text-neutral-100 tracking-tight">
          System Overview
        </h1>
        <span className="text-neutral-600 font-light hidden sm:inline">/</span>
        <span className="text-md text-neutral-400">Web Server</span>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-4xl mx-auto w-full px-6 sm:px-8 py-10 space-y-8">

          {/* Section Description */}
          <div className="mb-2 px-1">
            <h2 className="text-base font-medium text-neutral-100 mb-1.5 flex items-center gap-2">
              <Globe size={20} className="text-neutral-400" />
              Domain & SSL Configuration
            </h2>
            <p className="text-sm text-neutral-500 leading-relaxed max-w-2xl">
              Connect a custom domain to your instance and secure your dashboard traffic with an automated Let's Encrypt SSL certificate via Caddy.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Domain Configuration Card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#0c0c0e] shadow-sm flex flex-col">
              <div className="p-6 border-b border-white/[0.06]">
                <h3 className="text-sm font-medium text-neutral-200">Domain Settings</h3>
                <p className="text-xs text-neutral-500 mt-1">Enter the domain used to access this dashboard.</p>
              </div>
              <div className="p-6 space-y-6 flex-1 bg-white/[0.01]">
                <div className="space-y-3">
                  <Label htmlFor="domain" className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
                    Domain Name
                  </Label>
                  <div className="flex gap-3">
                    <Input
                      id="domain"
                      placeholder="e.g., dashboard.example.com"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      className="bg-[#121214] border-white/[0.08] text-neutral-200 text-sm h-10 px-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all flex-1"
                    />
                    <Button
                      onClick={handleSaveDomain}
                      disabled={actionLoading || !domainInput || domainInput === status?.domain}
                      className="bg-blue-600 hover:bg-blue-500 text-white h-10 px-5 shadow-sm transition-all whitespace-nowrap"
                    >
                      {actionLoading ? <CircleNotch size={16} className="animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>

                {status?.domain && (
                  <div className="pt-6 border-t border-white/[0.06] space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-neutral-300">DNS Propagation</span>
                      {status.propagated ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                          <CheckCircle size={14} weight="bold" />
                          Propagated
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 text-xs font-medium">
                          <XCircle size={14} weight="bold" />
                          Not Detected
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      className="w-full bg-[#121214] border-white/[0.08] hover:bg-white/[0.04] text-neutral-300 h-9 text-xs font-medium gap-2 transition-all"
                      onClick={handleCheckDNS}
                      disabled={actionLoading}
                    >
                      <ArrowClockwise className={actionLoading ? "animate-spin" : ""} size={14} weight="bold" />
                      Check DNS Again
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* DNS Settings Card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#0c0c0e] shadow-sm flex flex-col">
              <div className="p-6 border-b border-white/[0.06]">
                <h3 className="text-sm font-medium text-neutral-200">DNS Records</h3>
                <p className="text-xs text-neutral-500 mt-1">Add this A-record to your DNS provider.</p>
              </div>
              <div className="p-6 flex-1 bg-white/[0.01] flex flex-col justify-center">

                {/* Code-like Copy Box */}
                <div className="bg-[#121214] rounded-lg border border-white/[0.08] overflow-hidden">
                  <div className="grid grid-cols-3 border-b border-white/[0.06] bg-white/[0.02]">
                    <div className="p-2.5 text-[10px] uppercase font-semibold tracking-wider text-neutral-500 pl-4 border-r border-white/[0.04]">Type</div>
                    <div className="p-2.5 text-[10px] uppercase font-semibold tracking-wider text-neutral-500 pl-4 border-r border-white/[0.04]">Name</div>
                    <div className="p-2.5 text-[10px] uppercase font-semibold tracking-wider text-neutral-500 pl-4">Value (IP Address)</div>
                  </div>
                  <div className="grid grid-cols-3 text-sm font-mono text-neutral-300">
                    <div className="p-3 pl-4 border-r border-white/[0.04] flex items-center">A</div>
                    <div className="p-3 pl-4 border-r border-white/[0.04] flex items-center">@</div>
                    <div className="p-3 pl-4 flex items-center justify-between group">
                      <span className="text-blue-400">{status?.ip || "Loading..."}</span>
                      <button
                        onClick={() => copyToClipboard(status?.ip || "")}
                        className="text-neutral-500 hover:text-neutral-200 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Copy IP Address"
                      >
                        {copied ? (
                          <Check size={16} className="text-emerald-500" weight="bold" />
                        ) : (
                          <Copy size={16} weight="duotone" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-neutral-500 mt-4 flex items-start gap-2">
                  <span className="text-blue-400/80 mt-0.5 shrink-0">ℹ</span>
                  Note: DNS changes can take up to 24-48 hours to propagate globally across all networks.
                </p>
              </div>
            </div>
          </div>

          {/* SSL Certificate Card (Conditional) */}
          {status?.domain && status.propagated && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.02] shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl border shadow-sm shrink-0 ${status.ssl_enabled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                    {status.ssl_enabled ? <LockKey size={24} weight="duotone" /> : <ShieldCheck size={24} weight="duotone" />}
                  </div>
                  <div className="space-y-1 mt-0.5">
                    <h3 className="text-base font-medium text-neutral-100">
                      SSL Certificate
                    </h3>
                    <p className="text-sm text-neutral-400 leading-relaxed max-w-lg">
                      {status.ssl_enabled
                        ? "Your domain is fully secured with an active SSL certificate. All traffic is encrypted."
                        : "Your domain is successfully pointing to this server. You can now provision a free Let's Encrypt SSL certificate."}
                    </p>
                  </div>
                </div>

                {!status.ssl_enabled && (
                  <div className="shrink-0">
                    <Button
                      onClick={handleProvisionSSL}
                      disabled={actionLoading}
                      className="bg-blue-600 hover:bg-blue-500 text-white h-10 px-5 shadow-md shadow-blue-500/20 transition-all font-medium"
                    >
                      {actionLoading ? (
                        <div className="flex items-center gap-2">
                          <CircleNotch size={16} className="animate-spin" weight="bold" />
                          Provisioning...
                        </div>
                      ) : (
                        "Provision SSL"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Internal Routing Wrapper */}
          <div className="pt-4">
            <h2 className="text-base font-medium text-neutral-100 mb-1.5 flex items-center gap-2">
              <CheckIcon size={20} className="text-neutral-400" />
              Internal Routing
            </h2>
            <p className="text-sm text-neutral-500 leading-relaxed max-w-2xl mb-6">
              Caddy automatically routes reverse-proxy traffic to these internal container ports.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-xl border border-white/[0.06] bg-[#0c0c0e] hover:bg-white/[0.02] transition-colors flex flex-col items-center justify-center text-center gap-2">
                <div className="text-[11px] uppercase tracking-widest font-semibold text-neutral-500">App Port (Dashboard & API)</div>
                <div className="text-2xl font-mono text-neutral-200">{status?.app_port || "—"}</div>
              </div>
              <div className="p-5 rounded-xl border border-white/[0.06] bg-[#0c0c0e] hover:bg-white/[0.02] transition-colors flex flex-col items-center justify-center text-center gap-2">
                <div className="text-[11px] uppercase tracking-widest font-semibold text-neutral-500">Database Proxy Port</div>
                <div className="text-2xl font-mono text-neutral-200">{status?.proxy_port || "—"}</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}