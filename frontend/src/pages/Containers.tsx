import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CubeIcon,
  GlobeIcon,
  ListBulletsIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import { ManageProjectDialog } from "@/components/ManageProjectDialog";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { LetterAvatar } from "@/components/ui/letter-avatar";
import { UserManagementPanel } from "@/components/users/UserManagementPanel";
import { toast } from "sonner";

interface ContainerInfo {
  id: string;
  names: string[];
  image: string;
  status: string;
  state: string;
  ip: string;
  labels: Record<string, string>;
  created: number;
}

interface UserInfo {
  id: number;
  email: string;
  avatarUrl?: string;
}

interface ProjectInfo {
  id: number;
  name: string;
  users?: UserInfo[];
}

interface ProxyInfo {
  running: boolean;
  port: number;
  host: string;
}

type GraphKind = "internet" | "project" | "service" | "container" | "network";

interface GraphNode {
  id: string;
  kind: GraphKind;
  label: string;
  detail: string;
  version?: string;
  color: string;
  containerId?: string;
  users?: UserInfo[];
  ip?: string;
  status?: string;
  count?: number;
  isSimulated?: boolean;
  x: number;
  y: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "belongs" | "exposes" | "route";
}

interface MapViewport {
  x: number;
  y: number;
  scale: number;
}

const NAME_FALLBACK = "unnamed";
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.2;

const BASEFUL_SIMULATED_LABEL = "baseful.simulated";
const BASEFUL_SIMULATED_ID = "local-baseful-simulated";

function getContainerName(container: ContainerInfo): string {
  return container.names?.[0]?.replace("/", "") || NAME_FALLBACK;
}

function getContainerDisplayNames(container: ContainerInfo): {
  clean: string;
  full: string;
} {
  const full = getContainerName(container);
  const basefulPattern = /^baseful-(.+)-[a-f0-9]{12,}$/i;
  const match = full.match(basefulPattern);
  if (!match) return { clean: full, full };

  const clean = match[1] || full;
  return { clean, full };
}

function inferProjectName(
  labels: Record<string, string>,
  projectsById: Record<string, ProjectInfo> = {},
): string {
  const basefulProjectId = labels["baseful.project_id"];
  if (basefulProjectId && basefulProjectId !== "0") {
    const name =
      projectsById[basefulProjectId]?.name || `Project ${basefulProjectId}`;
    return name.toLowerCase() === "baseful" ? "Baseful" : name;
  }

  const name =
    labels["com.docker.compose.project"] ||
    labels["com.docker.stack.namespace"] ||
    labels["project"] ||
    "unassigned";

  return name.toLowerCase() === "baseful" ? "Baseful" : name;
}

function isBasefulContainer(
  container: ContainerInfo,
  projectsById: Record<string, ProjectInfo> = {},
): boolean {
  const labels = container.labels || {};
  const directProjectNames = [
    labels["project"],
    labels["com.docker.compose.project"],
    labels["com.docker.stack.namespace"],
  ];

  if (directProjectNames.some((name) => name?.toLowerCase() === "baseful")) {
    return true;
  }

  const basefulProjectId = labels["baseful.project_id"];
  if (
    basefulProjectId &&
    basefulProjectId !== "0" &&
    projectsById[basefulProjectId]?.name?.toLowerCase() === "baseful"
  ) {
    return true;
  }

  return (
    inferProjectName(labels, projectsById).toLowerCase() === "baseful" ||
    labels[BASEFUL_SIMULATED_LABEL] === "true"
  );
}

function inferSubnet(ip: string): string {
  const parts = ip.split(".");
  if (parts.length !== 4) return "unknown-network";
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function buildTopology(
  containers: ContainerInfo[],
  projectsById: Record<string, ProjectInfo>,
  allUsers: UserInfo[],
  proxyInfo: ProxyInfo | null,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const projectSet = new Set<string>();
  const networkSet = new Set<string>();

  containers.forEach((container) => {
    const project = inferProjectName(container.labels, projectsById);
    projectSet.add(project);

    if (container.ip) {
      networkSet.add(inferSubnet(container.ip));
    }
  });

  const projects = [...projectSet].sort();
  const networks = [...networkSet].sort();

  const containersPerNetwork: Record<string, number> = {};
  containers.forEach((c) => {
    if (c.ip) {
      const s = inferSubnet(c.ip);
      containersPerNetwork[s] = (containersPerNetwork[s] || 0) + 1;
    }
  });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const xByKind: Record<GraphKind, number> = {
    internet: -140,
    project: 120,
    service: 400,
    container: 560,
    network: 920,
  };

  let currentY = 80;
  const yGap = 160;

  const projectY = new Map<string, number>();
  projects.forEach((project) => {
    projectY.set(project, currentY);

    const projectInfo = Object.values(projectsById).find(
      (p) => p.name.toLowerCase() === project.toLowerCase(),
    );
    const users = projectInfo?.users;

    let label = project;
    let finalUsers = users;

    if (project.toLowerCase() === "baseful") {
      label = "Baseful";
      finalUsers = allUsers;
    }

    nodes.push({
      id: `project:${project}`,
      kind: "project",
      label: label,
      detail: "project",
      color: "#2f4f4f",
      users: finalUsers,
      x: xByKind.project,
      y: currentY,
    });
    currentY += yGap;
  });

  if (proxyInfo) {
    const preferredProxyProject = projectY.has("Baseful")
      ? "Baseful"
      : projects.length > 0
        ? projects[0]
        : null;
    const projectAnchorY =
      (preferredProxyProject
        ? projectY.get(preferredProxyProject)
        : undefined) || 80;
    const projectRows = Array.from(projectY.values());
    const minRowDistance = 170;
    const yCandidates = [
      projectAnchorY - 220,
      projectAnchorY + 220,
      projectAnchorY - 320,
      projectAnchorY + 320,
      projectAnchorY + 420,
    ];
    const proxyY =
      yCandidates.find((candidate) =>
        projectRows.every(
          (rowY) => Math.abs(rowY - candidate) >= minRowDistance,
        ),
      ) || projectAnchorY + 520;
    const proxyX =
      preferredProxyProject && preferredProxyProject.toLowerCase() === "baseful"
        ? xByKind.project
        : xByKind.service;
    const internetY = proxyY;

    nodes.push({
      id: "internet:public",
      kind: "internet",
      label: "Client Access",
      detail: "ingress",
      color: "#1f2937",
      x: xByKind.internet,
      y: internetY,
    });

    nodes.push({
      id: "service:proxy",
      kind: "service",
      label: "Baseful Proxy",
      detail: proxyInfo.running ? "running" : "stopped",
      version: `${proxyInfo.host}:${proxyInfo.port}`,
      status: proxyInfo.running ? "Running" : "Stopped",
      color: proxyInfo.running ? "#0f5132" : "#4b5563",
      x: proxyX,
      y: proxyY,
    });

    edges.push({
      id: "edge:internet:public:service:proxy",
      source: "internet:public",
      target: "service:proxy",
      kind: "route",
    });
  }

  currentY = 80;

  // Group containers by project to make lines less intertwined
  const sortedContainers = containers.slice().sort((a, b) => {
    const projA = inferProjectName(a.labels, projectsById);
    const projB = inferProjectName(b.labels, projectsById);
    if (projA !== projB) return projA.localeCompare(projB);
    return getContainerName(a).localeCompare(getContainerName(b));
  });

  sortedContainers.forEach((container) => {
    const names = getContainerDisplayNames(container);
    const project = inferProjectName(container.labels, projectsById);

    const [imageNamePath, rawVersion = ""] = container.image.split(":");
    const imageName = imageNamePath.split("/").pop() || "";
    const imageNameLower = imageName.toLowerCase();
    const isDatabaseContainer =
      Boolean(container.labels?.["baseful.database"]) ||
      Boolean(container.labels?.["baseful.branch"]) ||
      imageNameLower.startsWith("postgres");
    // Hide version if it's a sha256 hash or is unusually long
    const isShaOrLong =
      rawVersion.startsWith("sha256") || rawVersion.length > 20;
    const versionStr =
      isShaOrLong || !rawVersion ? "" : `${imageName} ${rawVersion}`.trim();

    nodes.push({
      id: `container:${container.id}`,
      kind: "container",
      label: names.clean,
      detail: container.state,
      status: container.status,
      ip: container.ip,
      version: versionStr,
      color: container.state === "running" ? "#0f5132" : "#4b5563",
      containerId: container.id,
      isSimulated: container.labels[BASEFUL_SIMULATED_LABEL] === "true",
      x: xByKind.container,
      y: currentY,
    });

    // Keep structural ownership link for all containers.
    edges.push({
      id: `edge:project:${project}:container:${container.id}`,
      source: `project:${project}`,
      target: `container:${container.id}`,
      kind: "belongs",
    });

    // Overlay route link only for DB/branch postgres traffic through proxy.
    if (proxyInfo && isDatabaseContainer) {
      edges.push({
        id: `edge:service:proxy:container:${container.id}`,
        source: "service:proxy",
        target: `container:${container.id}`,
        kind: "route",
      });
    }

    if (container.ip) {
      const subnet = inferSubnet(container.ip);
      edges.push({
        id: `edge:container:${container.id}:network:${subnet}`,
        source: `container:${container.id}`,
        target: `network:${subnet}`,
        kind: "exposes",
      });
    }

    currentY += yGap;
  });

  currentY = 80;
  networks.forEach((network) => {
    nodes.push({
      id: `network:${network}`,
      kind: "network",
      label: network,
      detail: "subnet",
      count: containersPerNetwork[network] || 0,
      color: "#4f3a1f",
      x: xByKind.network,
      y: currentY,
    });
    currentY += yGap;
  });

  return { nodes, edges };
}

const ServiceIconSVG = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="2" y="4" width="20" height="4" rx="1" />
    <rect x="2" y="10" width="20" height="4" rx="1" />
    <rect x="2" y="16" width="20" height="4" rx="1" />
  </svg>
);

const NetworkIconSVG = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="5" r="3" />
    <circle cx="5" cy="19" r="3" />
    <circle cx="19" cy="19" r="3" />
    <line x1="10.5" y1="7.6" x2="6.5" y2="16.4" />
    <line x1="13.5" y1="7.6" x2="17.5" y2="16.4" />
  </svg>
);

const DockerLogoSVG = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 340 268"
    className={className}
  >
    <defs>
      <clipPath id="docker-clip">
        <rect width="339.5" height="268" fill="none" />
      </clipPath>
    </defs>
    <g clipPath="url(#docker-clip)">
      <path
        fill="currentColor"
        d="M334,110.1c-8.3-5.6-30.2-8-46.1-3.7-.9-15.8-9-29.2-24-40.8l-5.5-3.7-3.7,5.6c-7.2,11-10.3,25.7-9.2,39,.8,8.2,3.7,17.4,9.2,24.1-20.7,12-39.8,9.3-124.3,9.3H0c-.4,19.1,2.7,55.8,26,85.6,2.6,3.3,5.4,6.5,8.5,9.6,19,19,47.6,32.9,90.5,33,65.4,0,121.4-35.3,155.5-120.8,11.2.2,40.8,2,55.3-26,.4-.5,3.7-7.4,3.7-7.4l-5.5-3.7h0ZM85.2,92.7h-36.7v36.7h36.7v-36.7ZM132.6,92.7h-36.7v36.7h36.7v-36.7ZM179.9,92.7h-36.7v36.7h36.7v-36.7ZM227.3,92.7h-36.7v36.7h36.7v-36.7ZM37.8,92.7H1.1v36.7h36.7v-36.7ZM85.2,46.3h-36.7v36.7h36.7v-36.7ZM132.6,46.3h-36.7v36.7h36.7v-36.7ZM179.9,46.3h-36.7v36.7h36.7v-36.7ZM179.9,0h-36.7v36.7h36.7V0Z"
      />
    </g>
  </svg>
);

export default function Containers() {
  const { token, logout, user } = useAuth();
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectsById, setProjectsById] = useState<Record<string, ProjectInfo>>(
    {},
  );
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);
  const [proxyInfo, setProxyInfo] = useState<ProxyInfo | null>(null);
  const [selectedContainer, setSelectedContainer] =
    useState<ContainerInfo | null>(null);
  const [containerHistory, setContainerHistory] = useState<
    Record<string, string[]>
  >({});
  const [containerCwd, setContainerCwd] = useState<Record<string, string>>({});
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [command, setCommand] = useState("");
  const [executing, setExecuting] = useState(false);
  const [viewport, setViewport] = useState<MapViewport>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [isPanning, setIsPanning] = useState(false);
  const [mapViewportSize, setMapViewportSize] = useState({
    width: 960,
    height: 620,
  });

  const [manageProjectDialogOpen, setManageProjectDialogOpen] = useState(false);
  const [basefulUsersDrawerOpen, setBasefulUsersDrawerOpen] = useState(false);
  const [selectedManageProject, setSelectedManageProject] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [containerActionLoading, setContainerActionLoading] = useState<
    Record<string, "start" | "stop" | "restart" | "logs" | undefined>
  >({});
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsContainerName, setLogsContainerName] = useState("");
  const [logsContent, setLogsContent] = useState("");
  const [isMobileDrawer, setIsMobileDrawer] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const mapInitializedRef = useRef(false);
  const panStateRef = useRef({
    active: false,
    moved: false,
    pointerStartX: 0,
    pointerStartY: 0,
    viewportStartX: 0,
    viewportStartY: 0,
  });
  const safariGestureScaleRef = useRef(1);

  const terminalOutput = useMemo(
    () =>
      selectedContainer ? containerHistory[selectedContainer.id] || [] : [],
    [selectedContainer, containerHistory],
  );
  const currentPath = useMemo(
    () => (selectedContainer ? containerCwd[selectedContainer.id] || "/" : "/"),
    [selectedContainer, containerCwd],
  );

  useEffect(() => {
    if (!executing && selectedContainer) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [executing, selectedContainer]);

  useEffect(() => {
    const updateMobileDrawer = () => {
      if (typeof window === "undefined") return;
      setIsMobileDrawer(window.innerWidth < 768);
    };
    updateMobileDrawer();
    window.addEventListener("resize", updateMobileDrawer);
    return () => window.removeEventListener("resize", updateMobileDrawer);
  }, []);

  const fetchContainers = useCallback(async () => {
    try {
      setLoading(true);
      const [
        containersResponse,
        projectsResponse,
        usersResponse,
        proxyResponse,
      ] = await Promise.all([
        authFetch("/api/docker/containers", token, {}, logout),
        authFetch("/api/projects", token, {}, logout),
        user?.isAdmin
          ? authFetch("/api/auth/users", token, {}, logout)
          : Promise.resolve(null),
        authFetch("/api/docker/proxy", token, {}, logout),
      ]);

      if (!containersResponse.ok) throw new Error("Failed to fetch containers");
      const rawContainerData: ContainerInfo[] = await containersResponse.json();
      let projectMap: Record<string, ProjectInfo> = {};

      const isLocal =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      if (projectsResponse.ok) {
        const projectsData: ProjectInfo[] = await projectsResponse.json();
        projectMap = projectsData.reduce(
          (acc, project) => {
            acc[String(project.id)] = project;
            return acc;
          },
          {} as Record<string, ProjectInfo>,
        );
        setProjectsById(projectMap);
      }

      const hasBasefulContainer = rawContainerData.some((container) =>
        isBasefulContainer(container, projectMap),
      );

      let containerData =
        user?.isAdmin && isLocal && !hasBasefulContainer
          ? [
              ...rawContainerData,
              {
                id: BASEFUL_SIMULATED_ID,
                names: ["/baseful-local"],
                image: "baseful/dashboard:local",
                status: "Simulated (local only)",
                state: "running",
                ip: "127.0.0.1",
                labels: {
                  project: "baseful",
                  [BASEFUL_SIMULATED_LABEL]: "true",
                },
                created: 0,
              },
            ]
          : rawContainerData;

      if (!user?.isAdmin) {
        containerData = containerData.filter(
          (container) => !isBasefulContainer(container, projectMap),
        );
        setBasefulUsersDrawerOpen(false);
      }

      setContainers(containerData);

      if (usersResponse?.ok) {
        const usersData: UserInfo[] = await usersResponse.json();
        setAllUsers(usersData || []);
      } else {
        setAllUsers([]);
      }

      if (proxyResponse.ok) {
        const proxyData: ProxyInfo = await proxyResponse.json();
        setProxyInfo(proxyData);
      } else {
        setProxyInfo(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [token, logout, user?.isAdmin]);

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 30000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

  const handleContainerAction = useCallback(
    async (container: ContainerInfo, action: "start" | "stop" | "restart") => {
      if (container.id === BASEFUL_SIMULATED_ID) return;
      setContainerActionLoading((prev) => ({
        ...prev,
        [container.id]: action,
      }));
      try {
        const response = await authFetch(
          `/api/docker/containers/${container.id}/${action}`,
          token,
          { method: "POST" },
          logout,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || `Failed to ${action} container`);
        }
        toast.success(
          action === "restart"
            ? "Container restarted"
            : `Container ${action === "start" ? "started" : "stopped"}`,
        );
        await fetchContainers();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed");
      } finally {
        setContainerActionLoading((prev) => ({
          ...prev,
          [container.id]: undefined,
        }));
      }
    },
    [fetchContainers, logout, token],
  );

  const openContainerLogs = useCallback(
    async (container: ContainerInfo) => {
      if (container.id === BASEFUL_SIMULATED_ID) return;
      setContainerActionLoading((prev) => ({
        ...prev,
        [container.id]: "logs",
      }));
      setLogsLoading(true);
      setLogsContent("");
      setLogsContainerName(getContainerDisplayNames(container).clean);
      setLogsDialogOpen(true);
      try {
        const response = await authFetch(
          `/api/docker/containers/${container.id}/logs?tail=200`,
          token,
          {},
          logout,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to fetch logs");
        }
        setLogsContent(data?.logs || "");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch logs";
        setLogsContent(`Error: ${message}`);
        toast.error(message);
      } finally {
        setLogsLoading(false);
        setContainerActionLoading((prev) => ({
          ...prev,
          [container.id]: undefined,
        }));
      }
    },
    [logout, token],
  );

  const openProxyLogs = useCallback(async () => {
    const proxyNodeId = "service:proxy";
    setContainerActionLoading((prev) => ({
      ...prev,
      [proxyNodeId]: "logs",
    }));
    setLogsLoading(true);
    setLogsContent("");
    setLogsContainerName("Baseful Proxy");
    setLogsDialogOpen(true);
    try {
      const response = await authFetch(
        "/api/docker/proxy/logs?tail=300",
        token,
        {},
        logout,
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to fetch proxy logs");
      }
      setLogsContent(data?.logs || "");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch proxy logs";
      setLogsContent(`Error: ${message}`);
      toast.error(message);
    } finally {
      setLogsLoading(false);
      setContainerActionLoading((prev) => ({
        ...prev,
        [proxyNodeId]: undefined,
      }));
    }
  }, [logout, token]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command || !selectedContainer || executing) return;

    const cmd = command.trim();
    const containerId = selectedContainer.id;
    const cwd = containerCwd[containerId] || "/";

    setExecuting(true);

    setContainerHistory((prev) => ({
      ...prev,
      [containerId]: [...(prev[containerId] || []), `[${cwd}] > ${cmd}`],
    }));

    setCommandHistory((prev) =>
      [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50),
    );
    setHistoryIndex(-1);
    setCommand("");

    try {
      const response = await authFetch(
        `/api/docker/containers/${containerId}/exec`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd, cwd }),
        },
        logout,
      );

      const data = await response.json();

      if (data.cwd) {
        setContainerCwd((prev) => ({ ...prev, [containerId]: data.cwd }));
      }

      if (data.output) {
        setContainerHistory((prev) => ({
          ...prev,
          [containerId]: [...(prev[containerId] || []), data.output],
        }));
      } else if (data.error) {
        setContainerHistory((prev) => ({
          ...prev,
          [containerId]: [...(prev[containerId] || []), `Error: ${data.error}`],
        }));
      }
    } catch (err) {
      setContainerHistory((prev) => ({
        ...prev,
        [containerId]: [
          ...(prev[containerId] || []),
          `System Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        ],
      }));
    } finally {
      setExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommand("");
      }
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  const parseAnsi = (text: string) => {
    const escapePrefix = `${String.fromCharCode(27)}[`;
    const chunks = text.split(escapePrefix);
    let currentColor = "text-neutral-300";
    const output: React.ReactNode[] = [];

    chunks.forEach((chunk, index) => {
      if (index === 0) {
        if (chunk)
          output.push(
            <span key={`text-${index}`} className={currentColor}>
              {chunk}
            </span>,
          );
        return;
      }

      const markerIndex = chunk.indexOf("m");
      if (markerIndex === -1) {
        output.push(
          <span key={`tail-${index}`} className={currentColor}>
            {chunk}
          </span>,
        );
        return;
      }

      const code = chunk.slice(0, markerIndex);
      const remainder = chunk.slice(markerIndex + 1);

      switch (code) {
        case "31":
          currentColor = "text-red-400";
          break;
        case "32":
          currentColor = "text-emerald-400";
          break;
        case "33":
          currentColor = "text-yellow-400";
          break;
        case "34":
          currentColor = "text-blue-400";
          break;
        case "35":
          currentColor = "text-purple-400";
          break;
        case "36":
          currentColor = "text-cyan-400";
          break;
        case "0":
          currentColor = "text-neutral-300";
          break;
        default:
          break;
      }

      if (remainder) {
        output.push(
          <span key={`seg-${index}`} className={currentColor}>
            {remainder}
          </span>,
        );
      }
    });

    return output.length > 0 ? output : [<span key="fallback">{text}</span>];
  };

  const topology = useMemo(
    () => buildTopology(containers, projectsById, allUsers, proxyInfo),
    [containers, projectsById, allUsers, proxyInfo],
  );
  const nodeById = useMemo(
    () => Object.fromEntries(topology.nodes.map((n) => [n.id, n])),
    [topology.nodes],
  );

  const topologyBounds = useMemo(() => {
    if (topology.nodes.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 1200,
        maxY: 700,
        width: 1200,
        height: 700,
      };
    }

    const minX = Math.min(...topology.nodes.map((n) => n.x - 100));
    const maxX = Math.max(...topology.nodes.map((n) => n.x + 100));
    const minY = Math.min(...topology.nodes.map((n) => n.y - 36));
    const maxY = Math.max(...topology.nodes.map((n) => n.y + 36));

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [topology.nodes]);

  useEffect(() => {
    const element = mapViewportRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setMapViewportSize({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(280, Math.round(rect.height)),
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitMapToViewport = useCallback(() => {
    const pad = 70;
    const fitScale = Math.min(
      (mapViewportSize.width - pad * 2) / Math.max(topologyBounds.width, 1),
      (mapViewportSize.height - pad * 2) / Math.max(topologyBounds.height, 1),
    );
    const scale = Math.max(0.85, Math.min(MAX_SCALE, fitScale));
    const x =
      mapViewportSize.width / 2 -
      (topologyBounds.minX + topologyBounds.width / 2) * scale;
    const y =
      mapViewportSize.height / 2 -
      (topologyBounds.minY + topologyBounds.height / 2) * scale;

    setViewport({ x, y, scale });
  }, [mapViewportSize.height, mapViewportSize.width, topologyBounds]);

  useEffect(() => {
    if (mapInitializedRef.current || topology.nodes.length === 0) return;
    fitMapToViewport();
    mapInitializedRef.current = true;
  }, [topology.nodes.length, fitMapToViewport]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOX = html.style.overscrollBehaviorX;
    const prevHtmlOY = html.style.overscrollBehaviorY;
    const prevBodyOX = body.style.overscrollBehaviorX;
    const prevBodyOY = body.style.overscrollBehaviorY;
    const prevBodyOF = body.style.overflow;

    html.style.overscrollBehaviorX = "none";
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorX = "none";
    body.style.overscrollBehaviorY = "none";
    body.style.overflow = "hidden";

    return () => {
      html.style.overscrollBehaviorX = prevHtmlOX;
      html.style.overscrollBehaviorY = prevHtmlOY;
      body.style.overscrollBehaviorX = prevBodyOX;
      body.style.overscrollBehaviorY = prevBodyOY;
      body.style.overflow = prevBodyOF;
    };
  }, []);

  useEffect(() => {
    const element = mapViewportRef.current;
    if (!element) return;

    const zoomAtPoint = (clientX: number, clientY: number, ratio: number) => {
      const rect = element.getBoundingClientRect();
      const centerX = clientX - rect.left;
      const centerY = clientY - rect.top;

      setViewport((prev) => {
        const nextScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, prev.scale * ratio),
        );
        if (nextScale === prev.scale) return prev;
        const worldX = (centerX - prev.x) / prev.scale;
        const worldY = (centerY - prev.y) / prev.scale;
        return {
          x: centerX - worldX * nextScale,
          y: centerY - worldY * nextScale,
          scale: nextScale,
        };
      });
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const isZoom = e.ctrlKey || e.metaKey;
      if (isZoom) {
        const ratio = e.deltaY > 0 ? 0.94 : 1.06;
        zoomAtPoint(e.clientX, e.clientY, ratio);
      } else {
        setViewport((prev) => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    const handleGStart = (e: any) => {
      e.preventDefault();
      safariGestureScaleRef.current = e.scale || 1;
    };

    const handleGChange = (e: any) => {
      e.preventDefault();
      const scale = e.scale || 1;
      const ratio = scale / Math.max(safariGestureScaleRef.current, 0.001);
      safariGestureScaleRef.current = scale;
      if (ratio !== 1) {
        const rect = element.getBoundingClientRect();
        zoomAtPoint(
          e.clientX ?? rect.left + rect.width / 2,
          e.clientY ?? rect.top + rect.height / 2,
          ratio,
        );
      }
    };

    const handleGEnd = (e: any) => e.preventDefault();
    const handleTouchMove = (e: TouchEvent) => e.preventDefault();

    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("gesturestart", handleGStart, { passive: false });
    element.addEventListener("gesturechange", handleGChange, {
      passive: false,
    });
    element.addEventListener("gestureend", handleGEnd, { passive: false });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("gesturestart", handleGStart);
      element.removeEventListener("gesturechange", handleGChange);
      element.removeEventListener("gestureend", handleGEnd);
      element.removeEventListener("touchmove", handleTouchMove);
    };
  }, [loading, containers.length]);

  const handleMapMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target === e.currentTarget) {
      setSelectedNodeId(null);
    }
    panStateRef.current = {
      active: true,
      moved: false,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      viewportStartX: viewport.x,
      viewportStartY: viewport.y,
    };
    setIsPanning(true);
  };

  const handleMapMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!panStateRef.current.active) return;
    const dx = e.clientX - panStateRef.current.pointerStartX;
    const dy = e.clientY - panStateRef.current.pointerStartY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      panStateRef.current.moved = true;
    }

    setViewport((prev) => ({
      ...prev,
      x: panStateRef.current.viewportStartX + dx,
      y: panStateRef.current.viewportStartY + dy,
    }));
  };

  const handleMapTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];

    if (e.target === e.currentTarget) {
      setSelectedNodeId(null);
    }
    panStateRef.current = {
      active: true,
      moved: false,
      pointerStartX: touch.clientX,
      pointerStartY: touch.clientY,
      viewportStartX: viewport.x,
      viewportStartY: viewport.y,
    };
    setIsPanning(true);
  };

  const handleMapTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!panStateRef.current.active || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - panStateRef.current.pointerStartX;
    const dy = touch.clientY - panStateRef.current.pointerStartY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      panStateRef.current.moved = true;
    }

    setViewport((prev) => ({
      ...prev,
      x: panStateRef.current.viewportStartX + dx,
      y: panStateRef.current.viewportStartY + dy,
    }));
  };

  const endMapPan = () => {
    panStateRef.current.active = false;
    setIsPanning(false);
  };

  const highlightedGraph = useMemo(() => {
    if (!selectedNodeId) {
      return { nodeIds: new Set<string>(), edgeIds: new Set<string>() };
    }

    const nodeIds = new Set<string>([selectedNodeId]);
    const edgeIds = new Set<string>();

    topology.edges.forEach((edge) => {
      if (edge.target === selectedNodeId || edge.source === selectedNodeId) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.source);
        nodeIds.add(edge.target);
      }
    });

    return { nodeIds, edgeIds };
  }, [selectedNodeId, topology.edges]);

  const proxyRouteBundle = useMemo(() => {
    const proxyNode = nodeById["service:proxy"];
    if (!proxyNode) return null;
    const containerAnchorOffsetY = -16;

    const bundledRoutes = topology.edges
      .filter(
        (edge) =>
          edge.kind === "route" &&
          edge.source === "service:proxy" &&
          edge.target.startsWith("container:"),
      )
      .map((edge) => ({ edgeId: edge.id, node: nodeById[edge.target] }))
      .filter((item): item is { edgeId: string; node: GraphNode } =>
        Boolean(item.node),
      )
      .map((item) => ({
        ...item,
        routeY: item.node.y + containerAnchorOffsetY,
      }));

    if (bundledRoutes.length === 0) return null;

    const proxyConnectorX = proxyNode.x + 110;
    const nearestTargetConnectorX = Math.min(
      ...bundledRoutes.map((item) => item.node.x - 110),
    );
    const rawTrunkX =
      proxyConnectorX + (nearestTargetConnectorX - proxyConnectorX) * 0.8;
    // Keep the vertical trunk outside container cards to avoid lines crossing cards.
    const trunkX = Math.round(Math.min(rawTrunkX, nearestTargetConnectorX - 24));
    const trunkMinY = Math.min(
      proxyNode.y,
      ...bundledRoutes.map((item) => item.routeY),
    );
    const trunkMaxY = Math.max(
      proxyNode.y,
      ...bundledRoutes.map((item) => item.routeY),
    );

    return {
      proxyNode,
      proxyConnectorX,
      trunkX,
      trunkMinY,
      trunkMaxY,
      bundledRoutes,
    };
  }, [nodeById, topology.edges]);

  const renderTerminalDialogContent = () => (
    <DialogContent className="sm:max-w-[85vw] w-full h-[85vh] flex flex-col p-0 gap-0 bg-[#0c0c0c] border-neutral-800 text-neutral-200 shadow-2xl overflow-hidden focus:outline-none">
      <DialogHeader className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center justify-between pr-8">
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-md bg-neutral-800 border border-neutral-700">
              <TerminalWindowIcon className="w-3.5 h-3.5 text-neutral-400" />
            </div>
            <DialogTitle className="text-sm font-medium font-mono text-neutral-300">
              root@{selectedContainer?.names[0].replace("/", "")}:{currentPath}
            </DialogTitle>
          </div>
          <div className="flex items-center gap-4">
            <DialogDescription className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500">
              {selectedContainer?.state}
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-neutral-600 hover:text-neutral-300"
              onClick={() =>
                selectedContainer &&
                setContainerHistory((prev) => ({
                  ...prev,
                  [selectedContainer.id]: [],
                }))
              }
            >
              <ArrowClockwiseIcon className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div
        ref={scrollRef}
        className="flex-1 bg-[#0c0c0c] p-5 font-mono text-xs md:text-sm overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-neutral-800"
      >
        <div className="flex flex-col gap-1.5">
          {terminalOutput.map((line, i) => {
            const isCommand = line.includes("] > ");
            return (
              <div key={i} className="break-all whitespace-pre-wrap flex gap-2">
                {isCommand ? (
                  <div className="flex flex-wrap items-center gap-x-2">
                    <div className="flex items-center gap-1 font-bold">
                      <span className="text-emerald-500">
                        root@{selectedContainer?.names[0].replace("/", "")}
                      </span>
                      <span className="text-white">:</span>
                      <span className="text-blue-400">
                        {line.split("] > ")[0].substring(1)}
                      </span>
                      <span className="text-white">#</span>
                    </div>
                    <span className="text-neutral-100">
                      {line.split("] > ")[1]}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col">{parseAnsi(line)}</div>
                )}
              </div>
            );
          })}
          {executing && (
            <div className="flex items-center gap-2 text-neutral-500 mt-1">
              <span className="animate-pulse">_</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-3 bg-neutral-900/40 border-t border-neutral-800/50 backdrop-blur-sm">
        <form
          onSubmit={handleExecute}
          className="flex gap-2 relative items-center"
        >
          <div className="flex items-center gap-1 font-mono text-sm whitespace-nowrap">
            <span className="text-emerald-500 font-bold">
              root@{selectedContainer?.names[0].replace("/", "")}
            </span>
            <span className="text-white">:</span>
            <span className="text-blue-400 font-bold">{currentPath}</span>
            <span className="text-white">#</span>
          </div>
          <input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-neutral-100 placeholder:text-neutral-700 focus:ring-0 w-full h-9"
            disabled={executing}
            autoFocus
            autoComplete="off"
          />
          <div className="flex items-center gap-2 pr-1">
            <span className="text-[10px] text-neutral-600 font-mono hidden md:inline">
              ENTER to run
            </span>
            <Button
              type="submit"
              disabled={executing || !command}
              size="sm"
              className="h-7 bg-blue-600 hover:bg-blue-500 text-white border-none shadow-lg shadow-blue-900/20 active:scale-95 transition-all text-[10px] uppercase tracking-wider font-bold"
            >
              {executing ? "..." : "Exec"}
            </Button>
          </div>
        </form>
      </div>
    </DialogContent>
  );

  const renderTerminalTrigger = (
    container: ContainerInfo,
    variant: "icon" | "button" = "icon",
  ) => (
    <Dialog onOpenChange={(open) => open && setSelectedContainer(container)}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <TerminalIcon size={14} />
          </Button>
        ) : (
          <Button size="sm" className="gap-2">
            <TerminalIcon size={14} />
            Open Terminal
          </Button>
        )}
      </DialogTrigger>
      {renderTerminalDialogContent()}
    </Dialog>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col border-b border-border p-4 gap-4 w-full">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-medium text-neutral-100">Containers</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchContainers}
            className="gap-2"
          >
            <ArrowClockwiseIcon className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="px-0 pb-0 flex-1 flex flex-col min-h-0">
        {loading && containers.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="border-border/50 bg-card/50">
                <CardHeader className="pb-2">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed rounded-lg border-red-500/20 bg-red-500/5">
            <p className="text-red-500 font-medium mb-2">
              Error connecting to Docker
            </p>
            <p className="text-sm text-neutral-400 max-w-md">{error}</p>
          </div>
        ) : containers.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed rounded-lg border-neutral-800">
            <CubeIcon size={48} className="text-neutral-700 mb-4" />
            <p className="text-neutral-300 font-medium mb-1">
              No Containers Found
            </p>
            <p className="text-sm text-neutral-500 max-w-md">
              No containers managed by Baseful were detected on this server.
            </p>
          </div>
        ) : (
          <div className="relative w-full flex-1 min-h-0">
            <div
              ref={mapViewportRef}
              className={`relative h-full w-full overflow-hidden  bg-transparent overscroll-none select-none ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
              style={{ touchAction: "none" }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${mapViewportSize.width} ${mapViewportSize.height}`}
                onMouseDown={handleMapMouseDown}
                onMouseMove={handleMapMouseMove}
                onMouseUp={endMapPan}
                onMouseLeave={endMapPan}
                onTouchStart={handleMapTouchStart}
                onTouchMove={handleMapTouchMove}
                onTouchEnd={endMapPan}
                onTouchCancel={endMapPan}
              >
                <defs>
                  <pattern
                    id="map-dots"
                    x="0"
                    y="0"
                    width="32"
                    height="32"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle
                      cx="1"
                      cy="1"
                      r="1"
                      fill="#ffffff"
                      fillOpacity="0.2"
                    />
                  </pattern>
                  <filter
                    id="node-shadow"
                    x="-20%"
                    y="-20%"
                    width="140%"
                    height="140%"
                  >
                    <feDropShadow
                      dx="0"
                      dy="2"
                      stdDeviation="2"
                      floodColor="#000000"
                      floodOpacity="0.25"
                    />
                  </filter>
                </defs>

                <g
                  transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.scale})`}
                >
                  <rect
                    x={topologyBounds.minX - 1000}
                    y={topologyBounds.minY - 1000}
                    width={topologyBounds.width + 2000}
                    height={topologyBounds.height + 2000}
                    fill="url(#map-dots)"
                  />

                  {topology.edges.map((edge) => {
                    const source = nodeById[edge.source];
                    const target = nodeById[edge.target];
                    if (!source || !target) return null;
                    if (
                      edge.kind === "route" &&
                      edge.source === "service:proxy" &&
                      edge.target.startsWith("container:")
                    ) {
                      return null;
                    }

                    const isRelated = highlightedGraph.edgeIds.has(edge.id);
                    const isRoute = edge.kind === "route";
                    const stroke = isRoute
                      ? isRelated
                        ? "#7c8ca3"
                        : "#5a6678"
                      : isRelated
                        ? "#6b7280"
                        : "#3f3f46";
                    const opacity = isRoute
                      ? isRelated
                        ? 0.8
                        : 0.45
                      : isRelated
                        ? 1
                        : 0.4;
                    const width = isRoute
                      ? isRelated
                        ? 1.6
                        : 1.2
                      : isRelated
                        ? 2
                        : 1.5;

                    return (
                      <line
                        key={edge.id}
                        x1={source.x + 110}
                        y1={source.y}
                        x2={target.x - 110}
                        y2={target.y}
                        stroke={stroke}
                        strokeOpacity={opacity}
                        strokeWidth={width}
                        strokeDasharray={isRoute ? "4 6" : undefined}
                      />
                    );
                  })}

                  {proxyRouteBundle && (
                    <>
                      <line
                        x1={proxyRouteBundle.proxyConnectorX}
                        y1={proxyRouteBundle.proxyNode.y}
                        x2={proxyRouteBundle.trunkX}
                        y2={proxyRouteBundle.proxyNode.y}
                        stroke={
                          selectedNodeId === "service:proxy"
                            ? "#7c8ca3"
                            : "#5a6678"
                        }
                        strokeOpacity={
                          selectedNodeId === "service:proxy" ? 0.8 : 0.45
                        }
                        strokeWidth={
                          selectedNodeId === "service:proxy" ? 1.6 : 1.2
                        }
                        strokeDasharray="4 6"
                      />
                      <line
                        x1={proxyRouteBundle.trunkX}
                        y1={proxyRouteBundle.trunkMinY}
                        x2={proxyRouteBundle.trunkX}
                        y2={proxyRouteBundle.trunkMaxY}
                        stroke={
                          selectedNodeId === "service:proxy"
                            ? "#7c8ca3"
                            : "#5a6678"
                        }
                        strokeOpacity={
                          selectedNodeId === "service:proxy" ? 0.8 : 0.45
                        }
                        strokeWidth={
                          selectedNodeId === "service:proxy" ? 1.6 : 1.2
                        }
                        strokeDasharray="4 6"
                      />
                      {proxyRouteBundle.bundledRoutes.map((item) => {
                        const isRelated =
                          highlightedGraph.edgeIds.has(item.edgeId) ||
                          highlightedGraph.nodeIds.has(item.node.id) ||
                          selectedNodeId === "service:proxy";

                        return (
                          <line
                            key={`bundle:${item.edgeId}`}
                            x1={proxyRouteBundle.trunkX}
                            y1={item.routeY}
                            x2={item.node.x - 110}
                            y2={item.routeY}
                            stroke={isRelated ? "#7c8ca3" : "#5a6678"}
                            strokeOpacity={isRelated ? 0.8 : 0.45}
                            strokeWidth={isRelated ? 1.6 : 1.2}
                            strokeDasharray="4 6"
                          />
                        );
                      })}
                    </>
                  )}

                  {topology.nodes.map((node) => {
                    const isContainer = node.kind === "container";
                    const isSelected = selectedNodeId === node.id;
                    const isRelated = highlightedGraph.nodeIds.has(node.id);
                    const outboundRouteCount = topology.edges.filter(
                      (edge) =>
                        edge.source === node.id && edge.kind === "route",
                    ).length;
                    const containerMatch =
                      isContainer && node.containerId
                        ? containers.find((c) => c.id === node.containerId)
                        : undefined;
                    const cardWidth = node.kind === "internet" ? 232 : 220;
                    const cardHeight =
                      node.kind === "internet"
                        ? 164
                        : node.kind === "service"
                          ? 188
                          : 150;

                    let iconNode = (
                      <CubeIcon className="w-4 h-4 text-neutral-400" />
                    );
                    let nodeTypeStr = "Node";

                    if (node.kind === "project") {
                      const isBaseful = node.label.toLowerCase() === "baseful";
                      iconNode = isBaseful ? (
                        <img
                          src="/logo.png"
                          alt="Baseful"
                          className="w-4 h-4 rounded-sm object-contain"
                        />
                      ) : (
                        <DitherAvatar value={node.label} size={16} />
                      );
                      nodeTypeStr = "Project";
                    } else if (node.kind === "service") {
                      iconNode = (
                        <ServiceIconSVG className="w-4 h-4 text-neutral-400" />
                      );
                      nodeTypeStr = "Service";
                    } else if (node.kind === "internet") {
                      iconNode = (
                        <GlobeIcon className="w-4 h-4 text-blue-300" />
                      );
                      nodeTypeStr = "Internet";
                    } else if (node.kind === "network") {
                      iconNode = (
                        <NetworkIconSVG className="w-4 h-4 text-neutral-400" />
                      );
                      nodeTypeStr = "Network";
                    } else if (isContainer) {
                      iconNode = node.isSimulated ? (
                        <CubeIcon className="w-4 h-4 text-amber-300" />
                      ) : (
                        <DockerLogoSVG className="w-4 h-4 text-neutral-300" />
                      );
                      nodeTypeStr = "Container";
                    }

                    return (
                      <g key={node.id} style={{ cursor: "default" }}>
                        <foreignObject
                          x={node.x - cardWidth / 2 - 10}
                          y={node.y - cardHeight / 2 - 10}
                          width={cardWidth + 20}
                          height={cardHeight + 20}
                        >
                          <div className="w-full h-full p-2.5 flex items-center justify-center">
                            <div
                              className={`rounded-[10px] border flex flex-col select-none transition-colors overflow-hidden ${
                                isSelected
                                  ? "bg-neutral-800 border-neutral-500 shadow-xl"
                                  : isRelated
                                    ? "bg-[#181818] border-neutral-600 shadow-md"
                                    : "bg-[#121212] border-[#2a2a2a] shadow-md hover:border-[#3e3e3e]"
                              }`}
                              style={{ width: cardWidth, height: cardHeight }}
                              onClick={() => {
                                if (panStateRef.current.moved) return;
                                setSelectedNodeId(node.id);
                              }}
                            >
                              <div
                                className={`flex items-center gap-2.5 px-3 h-[34px] border-b ${
                                  isSelected
                                    ? "border-neutral-600"
                                    : "border-[#2a2a2a]"
                                }`}
                              >
                                <div className="flex-shrink-0 flex items-center justify-center">
                                  {iconNode}
                                </div>
                                <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-between">
                                  <span className="text-xs font-semibold text-neutral-300 truncate leading-tight">
                                    {node.label}
                                  </span>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {node.kind === "service" && (
                                      <span
                                        className={`text-[10px] tracking-tight uppercase font-medium px-1.5 py-0.5 rounded border ${
                                          node.status?.toLowerCase() ===
                                          "running"
                                            ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                                            : "text-neutral-300 bg-neutral-700/30 border-neutral-600"
                                        }`}
                                      >
                                        {node.status || "Unknown"}
                                      </span>
                                    )}
                                    {node.version &&
                                      node.kind !== "service" && (
                                        <span className="text-[10px] tracking-tight uppercase text-neutral-400 font-medium px-1.5 py-0.5 bg-[#1f1f1f] rounded border border-[#2a2a2a]">
                                          {node.version}
                                        </span>
                                      )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex-1 flex flex-col px-3 py-2 justify-center">
                                {isContainer ? (
                                  <div className="space-y-2.5">
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">
                                        Internal IP
                                      </span>
                                      <span className="text-[10px] text-neutral-300 font-mono bg-neutral-900/50 px-1.5 py-0.5 rounded border border-white/5 w-fit">
                                        {node.ip || "N/A"}
                                      </span>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">
                                        Uptime
                                      </span>
                                      <span className="text-[10px] text-neutral-300 truncate leading-tight">
                                        {node.status?.replace("Up ", "") ||
                                          "N/A"}
                                      </span>
                                    </div>
                                  </div>
                                ) : node.kind === "project" ? (
                                  <div className="space-y-2">
                                    <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest block">
                                      Project Members
                                    </span>
                                    <div className="flex -space-x-1.5 overflow-hidden">
                                      {(node.users || [])
                                        .slice(0, 7)
                                        .map((u, i) => (
                                          <div
                                            key={i}
                                            className="h-6 w-6 rounded-full border-2 border-neutral-700 flex items-center justify-center overflow-hidden bg-muted"
                                          >
                                            {u.avatarUrl ? (
                                              <img
                                                src={u.avatarUrl}
                                                className="size-full object-cover"
                                                alt=""
                                              />
                                            ) : (
                                              <LetterAvatar
                                                name={u.email}
                                                size={20}
                                                className="rounded-full"
                                              />
                                            )}
                                          </div>
                                        ))}
                                      {(node.users?.length || 0) > 7 && (
                                        <div className="inline-flex h-6 min-w-6 px-1 rounded-full border-2 border-neutral-700 items-center justify-center bg-neutral-800 text-[10px] font-semibold text-neutral-200">
                                          +{(node.users?.length || 0) - 7}
                                        </div>
                                      )}
                                      {(!node.users ||
                                        node.users.length === 0) && (
                                        <span className="text-[10px] text-neutral-500 italic">
                                          No members assigned
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ) : node.kind === "network" ? (
                                  <div className="space-y-1">
                                    <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest block">
                                      Network Status
                                    </span>
                                    <div className="flex items-center justify-between bg-blue-500/5 border border-blue-500/10 rounded px-2 py-1.5">
                                      <span className="text-[10px] text-blue-400 font-bold tracking-tight">
                                        {node.count}{" "}
                                        {node.count === 1
                                          ? "Container"
                                          : "Containers"}{" "}
                                        Active
                                      </span>
                                    </div>
                                  </div>
                                ) : node.kind === "service" ? (
                                  <div className="space-y-2">
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">
                                        Endpoint
                                      </span>
                                      <span className="text-[10px] text-neutral-300 font-mono bg-neutral-900/50 px-1.5 py-0.5 rounded border border-white/5 w-fit max-w-full truncate">
                                        {node.version || "N/A"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between rounded border border-white/5 bg-neutral-900/40 px-2 py-1">
                                      <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider">
                                        Active Routes
                                      </span>
                                      <span className="text-[10px] text-sky-300 font-semibold">
                                        {outboundRouteCount}
                                      </span>
                                    </div>
                                    {node.id === "service:proxy" &&
                                      user?.isAdmin && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void openProxyLogs();
                                          }}
                                          className={`h-7 w-full rounded border px-2 text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                                            containerActionLoading[
                                              "service:proxy"
                                            ]
                                              ? "border-neutral-700 text-neutral-500 cursor-not-allowed"
                                              : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                                          }`}
                                          disabled={Boolean(
                                            containerActionLoading[
                                              "service:proxy"
                                            ],
                                          )}
                                        >
                                          View Logs
                                        </button>
                                      )}
                                  </div>
                                ) : node.kind === "internet" ? (
                                  <div className="space-y-2.5">
                                    <div className="flex items-center justify-between rounded border border-sky-500/20 bg-sky-500/5 px-2 py-1.5">
                                      <span className="text-[9px] text-sky-200 font-bold uppercase tracking-wider">
                                        Public Entry
                                      </span>
                                      <span className="text-[10px] text-sky-300 font-semibold">
                                        Active
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1.5">
                                      <div className="rounded border border-white/5 bg-neutral-900/40 px-2 py-1.5">
                                        <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">
                                          Protocol
                                        </div>
                                        <div className="text-[10px] text-neutral-200 font-mono">
                                          HTTP(S)
                                        </div>
                                      </div>
                                      <div className="rounded border border-white/5 bg-neutral-900/40 px-2 py-1.5">
                                        <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">
                                          Routed To
                                        </div>
                                        <div className="text-[10px] text-neutral-200 font-semibold">
                                          {outboundRouteCount} Service
                                          {outboundRouteCount === 1 ? "" : "s"}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-[9px] text-neutral-400 leading-tight">
                                      External traffic enters here before being
                                      forwarded to the proxy layer.
                                    </div>
                                  </div>
                                ) : (
                                  node.detail && (
                                    <span className="text-[11px] text-neutral-400 truncate leading-tight">
                                      {nodeTypeStr}
                                    </span>
                                  )
                                )}
                              </div>
                              {(isContainer || node.kind === "project") && (
                                <div
                                  className={`flex items-center justify-end px-3 h-[40px] border-t gap-1 ${
                                    isSelected
                                      ? "border-neutral-600"
                                      : "border-[#2a2a2a]"
                                  }`}
                                >
                                  {isContainer &&
                                    containerMatch &&
                                    !node.isSimulated && (
                                      <>
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          onClick={(e) => {
                                            if (
                                              node.isSimulated ||
                                              Boolean(
                                                containerActionLoading[
                                                  containerMatch.id
                                                ],
                                              )
                                            ) {
                                              return;
                                            }
                                            e.stopPropagation();
                                            void openContainerLogs(
                                              containerMatch,
                                            );
                                          }}
                                          onKeyDown={(e) => {
                                            if (
                                              e.key === "Enter" ||
                                              e.key === " "
                                            ) {
                                              e.preventDefault();
                                              if (
                                                node.isSimulated ||
                                                Boolean(
                                                  containerActionLoading[
                                                    containerMatch.id
                                                  ],
                                                )
                                              ) {
                                                return;
                                              }
                                              void openContainerLogs(
                                                containerMatch,
                                              );
                                            }
                                          }}
                                          className={`h-6 min-w-6 px-2 py-0 border rounded-md flex items-center justify-center text-[10px] border-neutral-700 ${
                                            node.isSimulated ||
                                            Boolean(
                                              containerActionLoading[
                                                containerMatch.id
                                              ],
                                            )
                                              ? "opacity-40 pointer-events-none"
                                              : "hover:bg-neutral-800 cursor-pointer"
                                          }`}
                                          title="View logs"
                                        >
                                          <ListBulletsIcon size={12} />
                                        </div>
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          onClick={(e) => {
                                            if (
                                              node.isSimulated ||
                                              Boolean(
                                                containerActionLoading[
                                                  containerMatch.id
                                                ],
                                              )
                                            ) {
                                              return;
                                            }
                                            e.stopPropagation();
                                            void handleContainerAction(
                                              containerMatch,
                                              containerMatch.state === "running"
                                                ? "stop"
                                                : "start",
                                            );
                                          }}
                                          onKeyDown={(e) => {
                                            if (
                                              e.key === "Enter" ||
                                              e.key === " "
                                            ) {
                                              e.preventDefault();
                                              if (
                                                node.isSimulated ||
                                                Boolean(
                                                  containerActionLoading[
                                                    containerMatch.id
                                                  ],
                                                )
                                              ) {
                                                return;
                                              }
                                              void handleContainerAction(
                                                containerMatch,
                                                containerMatch.state ===
                                                  "running"
                                                  ? "stop"
                                                  : "start",
                                              );
                                            }
                                          }}
                                          className={`h-6 min-w-6 px-2 py-0 border rounded-md flex items-center justify-center text-[10px] border-neutral-700 ${
                                            node.isSimulated ||
                                            Boolean(
                                              containerActionLoading[
                                                containerMatch.id
                                              ],
                                            )
                                              ? "opacity-40 pointer-events-none"
                                              : "hover:bg-neutral-800 cursor-pointer"
                                          }`}
                                          title={
                                            containerMatch.state === "running"
                                              ? "Stop"
                                              : "Start"
                                          }
                                        >
                                          {containerMatch.state ===
                                          "running" ? (
                                            <StopIcon size={12} />
                                          ) : (
                                            <PlayIcon size={12} />
                                          )}
                                        </div>
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          onClick={(e) => {
                                            if (
                                              node.isSimulated ||
                                              Boolean(
                                                containerActionLoading[
                                                  containerMatch.id
                                                ],
                                              )
                                            ) {
                                              return;
                                            }
                                            e.stopPropagation();
                                            void handleContainerAction(
                                              containerMatch,
                                              "restart",
                                            );
                                          }}
                                          onKeyDown={(e) => {
                                            if (
                                              e.key === "Enter" ||
                                              e.key === " "
                                            ) {
                                              e.preventDefault();
                                              if (
                                                node.isSimulated ||
                                                Boolean(
                                                  containerActionLoading[
                                                    containerMatch.id
                                                  ],
                                                )
                                              ) {
                                                return;
                                              }
                                              void handleContainerAction(
                                                containerMatch,
                                                "restart",
                                              );
                                            }
                                          }}
                                          className={`h-6 min-w-6 px-2 py-0 border rounded-md flex items-center justify-center text-[10px] border-neutral-700 ${
                                            node.isSimulated ||
                                            Boolean(
                                              containerActionLoading[
                                                containerMatch.id
                                              ],
                                            )
                                              ? "opacity-40 pointer-events-none"
                                              : "hover:bg-neutral-800 cursor-pointer"
                                          }`}
                                          title="Restart"
                                        >
                                          <ArrowClockwiseIcon size={12} />
                                        </div>
                                      </>
                                    )}
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedNodeId(node.id); // Also highlight when opening drawer
                                      if (panStateRef.current.moved) return;
                                      if (isContainer && containerMatch) {
                                        setSelectedContainer(containerMatch);
                                      } else if (node.kind === "project") {
                                        if (
                                          node.label.toLowerCase() === "baseful"
                                        ) {
                                          setBasefulUsersDrawerOpen(true);
                                          return;
                                        }
                                        const p = Object.values(
                                          projectsById,
                                        ).find(
                                          (p) => (p as any).name === node.label,
                                        );
                                        if (p) {
                                          setSelectedManageProject(p as any);
                                          setManageProjectDialogOpen(true);
                                        }
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setSelectedNodeId(node.id);
                                      }
                                    }}
                                    className="h-6 min-w-6 px-2 py-0 uppercase tracking-wider font-bold border border-neutral-700 rounded-md hover:bg-neutral-800 cursor-pointer flex items-center justify-center text-[10px]"
                                  >
                                    Open
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </foreignObject>
                      </g>
                    );
                  })}
                </g>
              </svg>

              <ManageProjectDialog
                open={manageProjectDialogOpen}
                onOpenChange={setManageProjectDialogOpen}
                project={selectedManageProject}
                onProjectUpdated={fetchContainers}
              />

              <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
                <DialogContent className="sm:max-w-[85vw] w-full h-[75vh] flex flex-col p-0 gap-0 bg-[#0c0c0c] border-neutral-800 text-neutral-200 overflow-hidden">
                  <DialogHeader className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/50">
                    <DialogTitle className="text-sm font-medium font-mono text-neutral-300">
                      Logs: {logsContainerName || "Container"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-neutral-300">
                    {logsLoading
                      ? "Loading logs..."
                      : logsContent || "No log output."}
                  </div>
                </DialogContent>
              </Dialog>

              <Drawer
                open={basefulUsersDrawerOpen}
                onOpenChange={setBasefulUsersDrawerOpen}
                direction={isMobileDrawer ? "bottom" : "right"}
              >
                <DrawerContent
                  className={
                    isMobileDrawer
                      ? "h-[88vh] !max-h-none w-full bg-card border-t border-border rounded-none"
                      : "h-full !w-[92vw] sm:!w-[820px] sm:!max-w-[820px] !max-w-[92vw] bg-card border-l border-border rounded-none"
                  }
                >
                  <DrawerHeader>
                    <DrawerTitle>Baseful Users & Whitelist</DrawerTitle>
                    <DrawerDescription>
                      Manage signed-up users, project access, permissions, and
                      whitelist.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="flex-1 min-h-0">
                    <UserManagementPanel showHeader={false} />
                  </div>
                </DrawerContent>
              </Drawer>

              <div className="absolute top-3 right-3 flex items-center gap-2 text-sm text-neutral-300 bg-card border border-white/10 rounded-md pl-2 pr-1 py-1">
                <span>{Math.round(viewport.scale * 100)}%</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fitMapToViewport}
                  className="h-7"
                >
                  Reset View
                </Button>
              </div>

              <Drawer
                open={!!selectedContainer}
                onOpenChange={(open: boolean) =>
                  !open && setSelectedContainer(null)
                }
                direction={isMobileDrawer ? "bottom" : "right"}
              >
                <DrawerContent
                  className={
                    isMobileDrawer
                      ? "h-[82vh] !max-h-none bg-card border-t border-border rounded-none"
                      : "h-full bg-card border-l border-border rounded-none"
                  }
                >
                  {selectedContainer && (
                    <>
                      <DrawerHeader>
                        <DrawerTitle>
                          {getContainerDisplayNames(selectedContainer).clean}
                        </DrawerTitle>
                        <DrawerDescription className="font-mono text-[11px] truncate">
                          {getContainerDisplayNames(selectedContainer).full}
                        </DrawerDescription>
                      </DrawerHeader>
                      <div className="flex-1 min-h-0 overflow-y-auto space-y-6 p-4">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-wider text-neutral-500">
                            Image
                          </label>
                          <div className="text-xs font-mono bg-neutral-900 border border-neutral-800 p-2 rounded break-all">
                            {selectedContainer.image}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {selectedContainer.state}
                          </Badge>
                          <Badge variant="outline">
                            {selectedContainer.ip || "No IP"}
                          </Badge>
                          <Badge variant="outline">
                            {inferProjectName(
                              selectedContainer.labels,
                              projectsById,
                            )}
                          </Badge>
                        </div>

                        <div className="pt-4">
                          {renderTerminalTrigger(selectedContainer, "button")}
                        </div>
                      </div>
                    </>
                  )}
                </DrawerContent>
              </Drawer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
