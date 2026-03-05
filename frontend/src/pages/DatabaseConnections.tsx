import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  Globe,
  User,
  MonitorIcon,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface Connection {
  pid: number;
  user: string;
  ip: string | null;
  started_at: string;
  state: string;
  query: string;
  application_name: string;
  backend_type: string;
}

interface Database {
  id: number;
  name: string;
  status: string;
}

const getSystemProcessDescription = (type: string) => {
  const descriptions: Record<string, string> = {
    "autovacuum launcher": "Managing background cleanup",
    "autovacuum worker": "Cleaning up dead tuples",
    "logical replication launcher": "Managing logical replication",
    "background writer": "Flushing dirty buffers to disk",
    checkpointer: "Writing checkpoints to disk",
    walwriter: "Writing WAL logs to disk",
    "stats collector": "Collecting system statistics",
  };
  return descriptions[type] || type;
};

export default function DatabaseConnections() {
  const { id } = useParams<{ id: string }>();
  const { token, logout } = useAuth();
  const [database, setDatabase] = useState<Database | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminatingPid, setTerminatingPid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDatabase = useCallback(async () => {
    try {
      const res = await authFetch(`/api/databases/${id}`, token, {}, logout);
      if (!res.ok) throw new Error("Database not found");
      const data = await res.json();
      setDatabase(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [id, token, logout]);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await authFetch(`/api/databases/${id}/connections`, token, {}, logout);
      if (res.ok) {
        const data = await res.json();
        setConnections(data || []);
      }
    } catch (err) {
      console.error("Failed to fetch connections:", err);
    } finally {
      setLoading(false);
    }
  }, [id, token, logout]);

  const terminateConnection = async (pid: number) => {
    if (
      !window.confirm(`Are you sure you want to terminate connection ${pid}?`)
    )
      return;

    setTerminatingPid(pid);
    try {
      const res = await authFetch(
        `/api/databases/${id}/connections/${pid}/terminate`,
        token,
        {
          method: "POST",
        },
        logout
      );
      if (res.ok) {
        fetchConnections();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to terminate connection");
      }
    } catch (err) {
      console.error("Failed to terminate connection:", err);
      alert("An error occurred while terminating the connection");
    } finally {
      setTerminatingPid(null);
    }
  };

  useEffect(() => {
    if (id) {
      fetchDatabase();
      fetchConnections();

      const interval = setInterval(() => {
        fetchConnections();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [id, fetchDatabase, fetchConnections]);

  if (loading && !database) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-400">Loading connections...</div>
      </div>
    );
  }

  if (error || !database) {
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
    <div className="flex flex-col gap-6 h-full p-6">
      <div className="flex items-center gap-4">
        <Link to={`/db/${id}/dashboard`}>
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft size={16} />
            Back
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <DitherAvatar value={database?.name || "database"} size={32} />

          <h1 className="text-2xl font-medium text-neutral-100">
            Connections for {database.name}
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-900/50 border-b border-border">
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    Type
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    PID
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    User
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    Source
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    Started
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    State
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    Application
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase">
                    Current Query
                  </th>
                  <th className="p-4 text-xs font-medium text-neutral-400 uppercase text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {connections.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="p-8 text-center text-neutral-500"
                    >
                      No active connections found
                    </td>
                  </tr>
                ) : (
                  connections.map((conn) => {
                    const isSystem = conn.backend_type !== "client backend";
                    return (
                      <tr
                        key={conn.pid}
                        className={`hover:bg-neutral-800/30 transition-colors ${isSystem ? "opacity-60" : ""}`}
                      >
                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${isSystem
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                              }`}
                          >
                            {isSystem ? "System" : "Client"}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-sm text-neutral-300">
                          {conn.pid}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-sm text-neutral-200">
                            <User size={14} className="text-neutral-500" />
                            {conn.user || "N/A"}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-sm text-neutral-200">
                            <Globe size={14} className="text-neutral-500" />
                            {conn.ip || "Local/Internal"}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-sm text-neutral-400">
                            <Clock size={14} />
                            {new Date(conn.started_at).toLocaleString()}
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${conn.state === "active"
                              ? "bg-green-500/10 text-green-400 border border-green-500/20"
                              : "bg-neutral-500/10 text-neutral-400 border border-neutral-500/20"
                              }`}
                          >
                            {conn.state || (isSystem ? "background" : "idle")}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-neutral-400">
                          <div className="flex items-center gap-2">
                            <MonitorIcon size={14} />
                            {conn.application_name ||
                              (isSystem ? database.name : "Unknown")}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 max-w-md">
                            <TerminalWindow
                              size={14}
                              className="text-neutral-500 flex-shrink-0"
                            />
                            <code
                              className="text-xs text-neutral-300 truncate bg-neutral-900 px-2 py-1 rounded border border-border"
                              title={conn.query || conn.backend_type}
                            >
                              {conn.query ||
                                (isSystem
                                  ? getSystemProcessDescription(
                                    conn.backend_type,
                                  )
                                  : "idle")}
                            </code>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          {!isSystem && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                              onClick={() => terminateConnection(conn.pid)}
                              disabled={terminatingPid === conn.pid}
                              title="Terminate Connection"
                            >
                              {terminatingPid === conn.pid ? (
                                <div className="h-4 w-4 border-2 border-red-400 border-t-transparent animate-spin rounded-full" />
                              ) : (
                                <X size={16} />
                              )}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
