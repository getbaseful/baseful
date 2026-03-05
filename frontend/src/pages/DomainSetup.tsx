import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Globe,
  Shield,
  CheckCircle,
  WarningCircleIcon,
  CopyIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { SquareArrowOutUpRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface DomainStatus {
  configured: boolean;
  domain?: string;
}

export default function DomainSetup() {
  const { token, logout } = useAuth();
  const [domainStatus, setDomainStatus] = useState<DomainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchDomainStatus = async () => {
      try {
        const res = await authFetch("/api/system/domain", token, {}, logout);
        if (res.ok) {
          const data = await res.json();
          setDomainStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch domain status:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDomainStatus();
  }, []);

  const currentIP =
    typeof window !== "undefined" ? window.location.hostname : "";

  return (
    <div className="flex flex-col gap-6 h-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/">
          <Button variant="ghost" size="sm" className="cursor-pointer">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-medium text-neutral-100">
            Domain Setup
          </h1>
          <p className="text-sm text-neutral-400">
            Configure your domain to enable SSL/TLS encryption
          </p>
        </div>
      </div>

      {/* Current Status */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-medium text-neutral-200 mb-4">
          Current Status
        </h2>

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-neutral-800 rounded w-1/3"></div>
            <div className="h-4 bg-neutral-800 rounded w-1/2"></div>
          </div>
        ) : domainStatus?.configured ? (
          <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <CheckCircle className="w-6 h-6 text-green-500" />
            <div>
              <p className="text-sm font-medium text-green-400">
                Domain is configured
              </p>
              <p className="text-xs text-neutral-400">
                Your domain{" "}
                <span className="text-green-300">{domainStatus.domain}</span> is
                connected and SSL is available.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <WarningCircleIcon className="w-6 h-6 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-400">
                No domain configured
              </p>
              <p className="text-xs text-neutral-400">
                You're currently using an IP address. Connect a domain to enable
                SSL/TLS.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Setup Instructions */}
      {!domainStatus?.configured && (
        <>
          {/* Step 1: Get Server IP */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center font-medium">
                1
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-neutral-200 mb-2">
                  Get your server IP address
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  You'll need your server's IP address to configure DNS records.
                </p>

                <div className="flex items-center gap-2 p-3 bg-neutral-900 rounded-lg border border-border">
                  <code className="flex-1 text-sm font-mono text-neutral-300">
                    {currentIP || "Detecting..."}
                  </code>
                  {currentIP && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(currentIP);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="p-2 hover:bg-neutral-800 rounded-md transition-colors text-neutral-400 hover:text-neutral-200"
                      title="Copy IP"
                    >
                      {copied ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <CopyIcon className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Configure DNS */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center font-medium">
                2
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-neutral-200 mb-2">
                  Configure DNS records
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  Add an A record pointing your domain to your server IP.
                </p>

                <div className="space-y-3">
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">Type</div>
                    <div className="text-sm font-mono text-neutral-300">
                      A Record
                    </div>
                  </div>
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">
                      Name / Host
                    </div>
                    <div className="text-sm font-mono text-neutral-300">
                      @ (or leave blank)
                    </div>
                  </div>
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">
                      Value / Target
                    </div>
                    <div className="text-sm font-mono text-neutral-300">
                      {currentIP || "Your server IP"}
                    </div>
                  </div>
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">TTL</div>
                    <div className="text-sm font-mono text-neutral-300">
                      3600 (1 hour) or Auto
                    </div>
                  </div>
                </div>

                <p className="text-xs text-neutral-500 mt-4">
                  <strong>Note:</strong> DNS changes may take up to 24 hours to
                  propagate, though it usually takes just a few minutes.
                </p>
              </div>
            </div>
          </div>

          {/* Step 3: Enable SSL/TLS in the Dashboard */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center font-medium">
                3
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-neutral-200 mb-2">
                  Enable SSL/TLS in the Dashboard
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  Once DNS is configured and your domain resolves to your server
                  IP, you can enable SSL directly from the Web Server settings.
                  Caddy will automatically provision and renew your certificates.
                </p>
                <Link to="/webserver" className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors">
                  Go to Web Server Settings
                  <SquareArrowOutUpRight className="w-4 h-4 ml-1.5" />
                </Link>
              </div>
            </div>
          </div>

        </>
      )}

      {/* Already Configured - Show SSL Status */}
      {domainStatus?.configured && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-6 h-6 text-green-500" />
            <h2 className="text-lg font-medium text-neutral-200">
              SSL/TLS Configuration
            </h2>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-neutral-900 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-300">
                    Your Domain
                  </p>
                  <p className="text-xs text-neutral-500">
                    {domainStatus.domain}
                  </p>
                </div>
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
            </div>

            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">
                Automated SSL is ready
              </h3>
              <p className="text-xs text-neutral-400">
                SSL certificates are managed automatically by Caddy. No manual certificate generation or renewal is required.
              </p>
            </div>

            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <h3 className="text-sm font-medium text-blue-400 mb-2">
                For production use
              </h3>
              <p className="text-xs text-neutral-400 mb-2">
                Consider using Let's Encrypt for free, trusted SSL certificates:
              </p>
              <div className="font-mono text-xs text-neutral-400 bg-neutral-900 p-3 rounded">
                <div>
                  sudo certbot certonly --standalone -d {domainStatus.domain}
                </div>
                <div>
                  sudo cp /etc/letsencrypt/live/{domainStatus.domain}
                  /fullchain.pem backend/
                </div>
                <div>
                  sudo cp /etc/letsencrypt/live/{domainStatus.domain}
                  /privkey.pem backend/
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-medium text-neutral-200 mb-4">
          Need Help?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="https://github.com/tobiasrasmsn/baseful"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-neutral-900 rounded-lg border border-border hover:border-neutral-700 transition-colors"
          >
            <SquareArrowOutUpRight className="w-5 h-5 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-neutral-300">
                GitHub Repository
              </p>
              <p className="text-xs text-neutral-500">
                Documentation and issues
              </p>
            </div>
          </a>
          <a
            href="https://github.com/tobiasrasmsn/baseful/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-neutral-900 rounded-lg border border-border hover:border-neutral-700 transition-colors"
          >
            <Globe className="w-5 h-5 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-neutral-300">
                Community Discussions
              </p>
              <p className="text-xs text-neutral-500">
                Get help from the community
              </p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
