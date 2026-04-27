import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CpuIcon, HardDriveIcon, MemoryIcon, PlusIcon } from "@phosphor-icons/react";
import { useDatabase } from "@/context/DatabaseContext";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

import { Progress } from "@/components/ui/progress";

interface Project {
  id: number;
  name: string;
  description: string;
}

interface CreateDatabaseDialogProps {
  onDatabaseCreated: (database?: {
    id: number;
    name: string;
    type: string;
    projectId: number;
    containerId?: string;
    internalHost?: string;
  }) => void;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  navigateOnCreate?: boolean;
  hideProjectSelector?: boolean;
  allowProjectless?: boolean;
  startStopped?: boolean;
}

export default function CreateDatabaseDialog({
  onDatabaseCreated,
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  navigateOnCreate = true,
  hideProjectSelector = false,
  allowProjectless = false,
  startStopped = false,
}: CreateDatabaseDialogProps) {
  const { setSelectedDatabase } = useDatabase();
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("postgresql");
  const [version, setVersion] = useState("17");
  const [projectId, setProjectId] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [maxCpu, setMaxCpu] = useState<number>(1);
  const [maxRamMb, setMaxRamMb] = useState<number>(512);
  const [maxStorageMb, setMaxStorageMb] = useState<number>(1024);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const { token, logout } = useAuth();
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const shouldRenderTrigger = Boolean(children) || controlledOpen === undefined;

  useEffect(() => {
    if (open && token) {
      fetchProjects();
    }
  }, [open, token]);

  const fetchProjects = async () => {
    if (!token) return;
    try {
      const response = await authFetch("/api/projects", token, {}, logout);

      if (response.status === 401) {
        logout();
        return;
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        setProjects(data);
        if (!hideProjectSelector && data.length > 0 && !projectId) {
          setProjectId(String(data[0].id));
        }
      } else {
        setProjects([]);
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err);
      setProjects([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setProgress(0);
    setStatusMessage("Initializing...");

    const parsedProjectId = projectId ? parseInt(projectId) : 0;

    if (!allowProjectless && !projectId) {
      setError("Please select a project");
      setLoading(false);
      return;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token && token !== "__cookie_session__") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch("/api/databases", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          name,
          type,
          version,
          projectId: parsedProjectId,
          maxCpu,
          maxRamMb,
          maxStorageMb,
        }),
      });

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create database");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to read server response");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          let update: any;
          try {
            update = JSON.parse(line);
          } catch (parseError) {
            console.error("Error parsing stream line:", parseError);
            continue;
          }

          if (update.status === "error") {
            throw new Error(update.message);
          }

          setStatusMessage(update.message);
          if (update.progress !== undefined) {
            setProgress(update.progress);
          }

          if (update.status === "success") {
            const data = update.data;
            // Auto-select the new database and navigate to it
            if (data.id) {
              let finalStatus: "stopped" | "active" = "active";

              if (startStopped) {
                setStatusMessage("Stopping database...");
                const stopResponse = await authFetch(
                  `/api/databases/${data.id}/stop`,
                  token,
                  { method: "POST" },
                  logout,
                );

                if (stopResponse.status === 401) {
                  logout();
                  return;
                }

                const stopData = await stopResponse.json().catch(() => ({}));
                if (!stopResponse.ok) {
                  const createdDatabase = {
                    id: data.id,
                    name,
                    type,
                    host: data.internal_host || "",
                    port: 5432,
                    status: "active" as const,
                    projectId: parsedProjectId,
                  };
                  setSelectedDatabase(createdDatabase);
                  onDatabaseCreated({
                    id: data.id,
                    name,
                    type,
                    projectId: parsedProjectId,
                    containerId: data.container_id,
                    internalHost: data.internal_host || "",
                  });
                  throw new Error(
                    stopData?.error ||
                      "Database was created, but stopping it failed. It is currently running.",
                  );
                }

                finalStatus = "stopped";
              }

              const newDatabase = {
                id: data.id,
                name: name,
                type: type,
                host: data.internal_host || "",
                port: 5432,
                status: finalStatus,
                projectId: parsedProjectId,
              };
              setSelectedDatabase(newDatabase);
              if (navigateOnCreate) {
                navigate(`/db/${data.id}/dashboard`);
              }
              onDatabaseCreated({
                id: data.id,
                name,
                type,
                projectId: parsedProjectId,
                containerId: data.container_id,
                internalHost: data.internal_host || "",
              });
            }

            setName("");
            setType("postgresql");
            setVersion("17");
            setProjectId("");
            setMaxCpu(1);
            setMaxRamMb(512);
            setMaxStorageMb(1024);
            setOpen(false);
          }
        }
      }
    } catch (error: any) {
      setError(error.message);
      console.error("Error creating database:", error);
    } finally {
      setLoading(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {shouldRenderTrigger ? (
        <DialogTrigger asChild>
          {children || (
            <Button variant="ghost" size="sm" className="cursor-pointer">
              <PlusIcon size={16} />
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent className="p-0 gap-0! bg-card">
        <DialogHeader className="border-b border-border p-4 mb-0! gap-0">
          <DialogTitle className="text-xl font-medium">Create Database</DialogTitle>
          <DialogDescription>
            Provision a new Postgres instance
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-4">
          <div className="grid gap-4 py-4">
            {error && (
              <div className="p-3 text-sm bg-red-500/10 border border-red-500/20 text-red-400 rounded-md">
                {error}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="name" className="text-neutral-400 uppercase tracking-wider text-xs font-medium">Database Name</Label>
              <Input
                id="name"
                placeholder="my-database"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full"
              />
            </div>
            {!hideProjectSelector && (
              <div className="grid gap-2">
                <Label htmlFor="project" className="text-neutral-400 uppercase tracking-wider text-xs font-medium">Project</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No projects available
                      </SelectItem>
                    ) : (
                      projects.map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === "postgresql" && (
              <div className="grid gap-2">
                <Label htmlFor="version" className="text-neutral-400 uppercase tracking-wider text-xs font-medium">PostgreSQL Version</Label>
                <Select value={version} onValueChange={setVersion}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="16">16</SelectItem>
                    <SelectItem value="17">17</SelectItem>
                    <SelectItem value="18">18 (latest)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Resource Limits Section */}
            <div className="border-y border-border py-4 mt-2">
              <h3 className="text-neutral-400 uppercase tracking-wider text-xs font-medium mb-3">
                Resource Limits
              </h3>

              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="maxCpu" className="text-neutral-400 uppercase tracking-wider text-[10px] font-normal flex items-center gap-1"><CpuIcon size={12} />CPU Cores</Label>
                  <Select
                    value={String(maxCpu)}
                    onValueChange={(value) => setMaxCpu(parseFloat(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.5">0.5 CPU</SelectItem>
                      <SelectItem value="1">1 CPU</SelectItem>
                      <SelectItem value="2">2 CPUs</SelectItem>
                      <SelectItem value="4">4 CPUs</SelectItem>
                      <SelectItem value="8">8 CPUs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="maxRamMb" className="text-neutral-400 uppercase tracking-wider text-[10px] font-normal flex items-center gap-1"><MemoryIcon size={12} />RAM</Label>
                  <Select
                    value={String(maxRamMb)}
                    onValueChange={(value) => setMaxRamMb(parseInt(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="256">256 MB</SelectItem>
                      <SelectItem value="512">512 MB</SelectItem>
                      <SelectItem value="1024">1 GB</SelectItem>
                      <SelectItem value="2048">2 GB</SelectItem>
                      <SelectItem value="4096">4 GB</SelectItem>
                      <SelectItem value="8192">8 GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="maxStorageMb" className="text-neutral-400 uppercase tracking-wider text-[10px] font-normal flex items-center gap-1"><HardDriveIcon size={12} />Storage</Label>
                  <Select
                    value={String(maxStorageMb)}
                    onValueChange={(value) => setMaxStorageMb(parseInt(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="512">512 MB</SelectItem>
                      <SelectItem value="1024">1 GB</SelectItem>
                      <SelectItem value="5120">5 GB</SelectItem>
                      <SelectItem value="10240">10 GB</SelectItem>
                      <SelectItem value="51200">50 GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {loading && (
              <div className="grid gap-2">
                <div className="flex justify-between text-[10px] font-medium uppercase tracking-wider">
                  <span className="text-neutral-400">{statusMessage}</span>
                  <span className="text-primary">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-1" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Provisioning..." : "Create Database"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
