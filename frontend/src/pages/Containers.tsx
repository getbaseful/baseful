import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CubeIcon,
  GlobeIcon,
  TerminalIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

interface TopologyNodeData extends Record<string, unknown> {
  node: GraphNode;
  isSelected: boolean;
  isRelated: boolean;
  outboundRouteCount: number;
  hasIncoming: boolean;
  hasOutgoing: boolean;
  containerMatch?: ContainerInfo;
  actionLoading?: "start" | "stop" | "restart" | "logs";
  isAdmin: boolean;
  onSelect: (nodeId: string) => void;
  onOpen: (node: GraphNode, containerMatch?: ContainerInfo) => void;
  onOpenLogs: (container: ContainerInfo) => void;
  onContainerAction: (
    container: ContainerInfo,
    action: "start" | "stop" | "restart",
  ) => void;
  onOpenProxyLogs: () => void;
}

type TopologyFlowNode = Node<TopologyNodeData, "topologyNode">;
type TopologyFlowEdge = Edge;

function ProxyRouteEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
}: EdgeProps<TopologyFlowEdge>) {
  const laneX = sourceX + 34;
  const path = `M ${sourceX} ${sourceY} L ${laneX} ${sourceY} L ${laneX} ${targetY} L ${targetX} ${targetY}`;

  return <BaseEdge path={path} style={style} />;
}

const NAME_FALLBACK = "unnamed";
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.2;

const BASEFUL_SIMULATED_LABEL = "baseful.simulated";
const BASEFUL_SIMULATED_ID = "local-baseful-simulated";
const DEFAULT_CARD_WIDTH = 220;
const CONTAINER_CARD_WIDTH = 276;
const INTERNET_CARD_WIDTH = 232;
const DEFAULT_CARD_HEIGHT = 150;
const CONTAINER_CARD_HEIGHT = 186;
const SERVICE_CARD_HEIGHT = 188;
const INTERNET_CARD_HEIGHT = 164;
const MAX_RENDERED_TERMINAL_LINES = 1200;
const MAX_RENDERED_LOG_CHARS = 300000;
const MAX_RENDERED_LOG_LINES = 4000;

function getNodeCardDimensions(node: GraphNode) {
  return {
    width:
      node.kind === "internet"
        ? INTERNET_CARD_WIDTH
        : node.kind === "container"
          ? CONTAINER_CARD_WIDTH
          : DEFAULT_CARD_WIDTH,
    height:
      node.kind === "internet"
        ? INTERNET_CARD_HEIGHT
        : node.kind === "service"
          ? SERVICE_CARD_HEIGHT
          : node.kind === "container"
            ? CONTAINER_CARD_HEIGHT
            : DEFAULT_CARD_HEIGHT,
  };
}

type LogLevel =
  | "error"
  | "warning"
  | "success"
  | "hint"
  | "info"
  | "debug"
  | "default";

function classifyLogLine(line: string): LogLevel {
  const normalized = line.toLowerCase();

  if (
    /\b(fatal|panic|error|exception|failed|permission denied|operation not permitted)\b/.test(
      normalized,
    )
  ) {
    return "error";
  }
  if (/\b(warn|warning|deprecated|retry)\b/.test(normalized)) {
    return "warning";
  }
  if (/\b(success|ready|started|complete|done|listening)\b/.test(normalized)) {
    return "success";
  }
  if (/\b(hint|tip|suggestion)\b/.test(normalized)) {
    return "hint";
  }
  if (/\b(debug|trace|verbose)\b/.test(normalized)) {
    return "debug";
  }
  if (/\b(info|notice|log)\b/.test(normalized)) {
    return "info";
  }
  return "default";
}

function getLogLevelClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-red-300";
    case "warning":
      return "text-amber-300";
    case "success":
      return "text-emerald-300";
    case "hint":
      return "text-cyan-300";
    case "info":
      return "text-blue-300";
    case "debug":
      return "text-violet-300";
    default:
      return "text-neutral-300";
  }
}

function splitDockerLogLine(line: string): { prefix: string; body: string } {
  const dockerTimestampMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?)\s?(.*)$/,
  );
  if (!dockerTimestampMatch) {
    return { prefix: "", body: line };
  }

  return {
    prefix: dockerTimestampMatch[1],
    body: dockerTimestampMatch[2] || "",
  };
}

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
  const yGap = 220;

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

function TopologyNodeCard({ data }: NodeProps<TopologyFlowNode>) {
  const {
    node,
    isSelected,
    isRelated,
    outboundRouteCount,
    hasIncoming,
    hasOutgoing,
    containerMatch,
    actionLoading,
    isAdmin,
    onSelect,
    onOpen,
    onOpenLogs,
    onContainerAction,
    onOpenProxyLogs,
  } = data;
  const isContainer = node.kind === "container";
  const { width: cardWidth, height: cardHeight } = getNodeCardDimensions(node);

  let iconNode = <CubeIcon className="w-4 h-4 text-neutral-400" />;
  let nodeTypeStr = "Node";

  if (node.kind === "project") {
    const isBaseful = node.label.toLowerCase() === "baseful";
    iconNode = isBaseful ? (
      <div className="bg-muted rounded-sm p-1 size-4">
        <img src="/logo.png" alt="Baseful" className="object-contain" />
      </div>
    ) : (
      <DitherAvatar value={node.label} size={16} />
    );
    nodeTypeStr = "Project";
  } else if (node.kind === "service") {
    iconNode = <ServiceIconSVG className="w-4 h-4 text-neutral-400" />;
    nodeTypeStr = "Service";
  } else if (node.kind === "internet") {
    iconNode = <GlobeIcon className="w-4 h-4 text-blue-300" />;
    nodeTypeStr = "Internet";
  } else if (node.kind === "network") {
    iconNode = <NetworkIconSVG className="w-4 h-4 text-neutral-400" />;
    nodeTypeStr = "Network";
  } else if (isContainer) {
    iconNode = node.isSimulated ? (
      <CubeIcon className="w-4 h-4 text-amber-300" />
    ) : (
      <DockerLogoSVG className="w-4 h-4 text-neutral-300" />
    );
    nodeTypeStr = "Container";
  }

  const actionsDisabled = node.isSimulated || Boolean(actionLoading);
  const actionButtonClass = `h-7 flex-1 min-w-0 px-2 py-0 border rounded-md flex items-center justify-center text-[10px] uppercase tracking-wider font-semibold border-neutral-700 ${
    actionsDisabled
      ? "opacity-40 pointer-events-none"
      : "hover:bg-neutral-800 cursor-pointer"
  }`;
  const openButtonClass =
    "h-7 flex-1 min-w-0 px-2 py-0 border rounded-md flex items-center justify-center text-[10px] uppercase tracking-wider font-semibold border-neutral-700 hover:bg-neutral-800 cursor-pointer";

  return (
    <div
      className={`rounded-[10px] border flex flex-col select-none transition-colors overflow-hidden ${
        isSelected
          ? "bg-neutral-800 border-neutral-500 shadow-xl"
          : isRelated
            ? "bg-[#181818] border-neutral-600 shadow-md"
            : "bg-[#121212] border-[#2a2a2a] shadow-md hover:border-[#3e3e3e]"
      }`}
      style={{ width: cardWidth, height: cardHeight }}
      onClick={() => onSelect(node.id)}
    >
      {hasIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          id="target-main"
          isConnectable={false}
          className="!h-2.5 !w-2.5 !rounded-full !border !border-neutral-700 !bg-[#111111] !left-[-5px] !cursor-default !pointer-events-none"
        />
      )}
      {node.kind === "container" && hasIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          id="target-route"
          isConnectable={false}
          style={{ top: "38%" }}
          className="!h-2.5 !w-2.5 !rounded-full !border !border-neutral-700 !bg-[#111111] !left-[-5px] !cursor-default !pointer-events-none"
        />
      )}
      {hasOutgoing && (
        <Handle
          type="source"
          position={Position.Right}
          id="source-main"
          isConnectable={false}
          className="!h-2.5 !w-2.5 !rounded-full !border !border-neutral-700 !bg-[#111111] !right-[-5px] !cursor-default !pointer-events-none"
        />
      )}
      {node.id === "service:proxy" && hasOutgoing && (
        <Handle
          type="source"
          position={Position.Right}
          id="source-route"
          isConnectable={false}
          style={{ top: "58%", right: -5 }}
          className="!h-2.5 !w-2.5 !rounded-full !border !border-neutral-700 !bg-[#111111] !cursor-default !pointer-events-none"
        />
      )}
      <div
        className={`flex items-center gap-2.5 px-3 ${
          isContainer ? "h-[46px]" : "h-[34px]"
        } border-b ${isSelected ? "border-neutral-600" : "border-[#2a2a2a]"}`}
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
                  node.status?.toLowerCase() === "running"
                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                    : "text-neutral-300 bg-neutral-700/30 border-neutral-600"
                }`}
              >
                {node.status || "Unknown"}
              </span>
            )}
            {node.version && node.kind !== "service" && (
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
                {node.status?.replace("Up ", "") || "N/A"}
              </span>
            </div>
          </div>
        ) : node.kind === "project" ? (
          <div className="space-y-2">
            <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest block">
              Project Members
            </span>
            <div className="flex -space-x-1.5 overflow-hidden">
              {(node.users || []).slice(0, 7).map((u, i) => (
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
              {(!node.users || node.users.length === 0) && (
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
                {node.count} {node.count === 1 ? "Container" : "Containers"}{" "}
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
              <span className="text-[10px] text-neutral-300 font-semibold">
                {outboundRouteCount}
              </span>
            </div>
            {node.id === "service:proxy" && isAdmin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProxyLogs();
                }}
                className={`h-7 w-full rounded border px-2 text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                  actionLoading
                    ? "border-neutral-700 text-neutral-500 cursor-not-allowed"
                    : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
                disabled={Boolean(actionLoading)}
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
              External traffic enters here before being forwarded to the proxy
              layer.
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
          className={`flex items-center px-3 border-t gap-1 ${
            isContainer ? "h-[48px]" : "h-[40px]"
          } ${isSelected ? "border-neutral-600" : "border-[#2a2a2a]"}`}
        >
          {isContainer && containerMatch && !node.isSimulated && (
            <>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  if (actionsDisabled) return;
                  e.stopPropagation();
                  onOpenLogs(containerMatch);
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !actionsDisabled
                  ) {
                    e.preventDefault();
                    onOpenLogs(containerMatch);
                  }
                }}
                className={actionButtonClass}
                title="View logs"
              >
                Logs
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  if (actionsDisabled) return;
                  e.stopPropagation();
                  onContainerAction(
                    containerMatch,
                    containerMatch.state === "running" ? "stop" : "start",
                  );
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !actionsDisabled
                  ) {
                    e.preventDefault();
                    onContainerAction(
                      containerMatch,
                      containerMatch.state === "running" ? "stop" : "start",
                    );
                  }
                }}
                className={actionButtonClass}
                title={containerMatch.state === "running" ? "Stop" : "Start"}
              >
                {containerMatch.state === "running" ? "Stop" : "Start"}
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  if (actionsDisabled) return;
                  e.stopPropagation();
                  onContainerAction(containerMatch, "restart");
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !actionsDisabled
                  ) {
                    e.preventDefault();
                    onContainerAction(containerMatch, "restart");
                  }
                }}
                className={actionButtonClass}
                title="Restart"
              >
                Restart
              </div>
            </>
          )}
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(node.id);
              onOpen(node, containerMatch);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(node.id);
              }
            }}
            className={openButtonClass}
          >
            Open
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [flowViewport, setFlowViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    TopologyFlowNode,
    TopologyFlowEdge
  > | null>(null);

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
  const [pendingContainerAction, setPendingContainerAction] = useState<{
    container: ContainerInfo;
    action: "start" | "stop" | "restart";
  } | null>(null);
  const [isMobileDrawer, setIsMobileDrawer] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapInitializedRef = useRef(false);

  const terminalOutput = useMemo(
    () =>
      selectedContainer ? containerHistory[selectedContainer.id] || [] : [],
    [selectedContainer, containerHistory],
  );
  const renderedTerminalOutput = useMemo(() => {
    const hiddenCount = Math.max(
      0,
      terminalOutput.length - MAX_RENDERED_TERMINAL_LINES,
    );
    return {
      hiddenCount,
      lines:
        hiddenCount > 0
          ? terminalOutput.slice(-MAX_RENDERED_TERMINAL_LINES)
          : terminalOutput,
    };
  }, [terminalOutput]);
  const currentPath = useMemo(
    () => (selectedContainer ? containerCwd[selectedContainer.id] || "/" : "/"),
    [selectedContainer, containerCwd],
  );
  const renderedLogsContent = useMemo(() => {
    const hiddenChars = Math.max(
      0,
      logsContent.length - MAX_RENDERED_LOG_CHARS,
    );
    return {
      hiddenChars,
      text:
        hiddenChars > 0
          ? logsContent.slice(-MAX_RENDERED_LOG_CHARS)
          : logsContent,
    };
  }, [logsContent]);
  const renderedLogLines = useMemo(() => {
    const lines = renderedLogsContent.text.split(/\r?\n/);
    const hiddenLineCount = Math.max(0, lines.length - MAX_RENDERED_LOG_LINES);
    const visibleLines =
      hiddenLineCount > 0 ? lines.slice(-MAX_RENDERED_LOG_LINES) : lines;
    return { hiddenLineCount, lines: visibleLines };
  }, [renderedLogsContent.text]);

  const scrollTerminalToBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);
  const scrollLogsToBottom = useCallback(() => {
    if (!logsScrollRef.current) return;
    logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
  }, []);

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

  const confirmContainerAction = useCallback(async () => {
    if (!pendingContainerAction) return;
    await handleContainerAction(
      pendingContainerAction.container,
      pendingContainerAction.action,
    );
    setPendingContainerAction(null);
  }, [handleContainerAction, pendingContainerAction]);

  const pendingActionTitle = pendingContainerAction
    ? `${pendingContainerAction.action === "restart" ? "Restart" : pendingContainerAction.action === "stop" ? "Stop" : "Start"} container?`
    : "Confirm container action";

  const pendingActionDescription = pendingContainerAction
    ? pendingContainerAction.action === "stop"
      ? `This will stop "${getContainerDisplayNames(pendingContainerAction.container).clean}" immediately. The database will go offline until it is started again.`
      : pendingContainerAction.action === "restart"
        ? `This will restart "${getContainerDisplayNames(pendingContainerAction.container).clean}". The database will go offline during restart and return once it is up again.`
        : `This will start "${getContainerDisplayNames(pendingContainerAction.container).clean}". The database will come online after startup completes.`
    : "Please confirm this action.";

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
    const frame = requestAnimationFrame(() => {
      scrollTerminalToBottom();
      requestAnimationFrame(scrollTerminalToBottom);
    });

    return () => cancelAnimationFrame(frame);
  }, [
    selectedContainer,
    renderedTerminalOutput.lines.length,
    scrollTerminalToBottom,
  ]);

  useEffect(() => {
    if (!logsDialogOpen) return;

    const frame = requestAnimationFrame(() => {
      scrollLogsToBottom();
      requestAnimationFrame(scrollLogsToBottom);
    });

    return () => cancelAnimationFrame(frame);
  }, [
    logsDialogOpen,
    logsLoading,
    renderedLogsContent.text.length,
    scrollLogsToBottom,
  ]);

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

  const fitMapToViewport = useCallback(() => {
    if (!reactFlowInstance) return;
    void reactFlowInstance.fitView({
      padding: 0.18,
      duration: 400,
      minZoom: 0.85,
      maxZoom: MAX_SCALE,
    });
  }, [reactFlowInstance]);

  useEffect(() => {
    if (
      !reactFlowInstance ||
      mapInitializedRef.current ||
      topology.nodes.length === 0
    ) {
      return;
    }
    fitMapToViewport();
    mapInitializedRef.current = true;
  }, [fitMapToViewport, reactFlowInstance, topology.nodes.length]);

  const handleNodeOpen = useCallback(
    (node: GraphNode, containerMatch?: ContainerInfo) => {
      if (node.kind === "container" && containerMatch) {
        setSelectedContainer(containerMatch);
        return;
      }
      if (node.kind === "project") {
        if (node.label.toLowerCase() === "baseful") {
          setBasefulUsersDrawerOpen(true);
          return;
        }
        const project = Object.values(projectsById).find(
          (p) => (p as any).name === node.label,
        );
        if (project) {
          setSelectedManageProject(project as any);
          setManageProjectDialogOpen(true);
        }
      }
    },
    [projectsById],
  );

  const flowNodes = useMemo<TopologyFlowNode[]>(
    () =>
      topology.nodes.map((node) => {
        const isContainer = node.kind === "container";
        const containerMatch =
          isContainer && node.containerId
            ? containers.find((c) => c.id === node.containerId)
            : undefined;
        const { width, height } = getNodeCardDimensions(node);
        const hasIncoming = topology.edges.some(
          (edge) => edge.target === node.id,
        );
        const hasOutgoing = topology.edges.some(
          (edge) => edge.source === node.id,
        );

        return {
          id: node.id,
          type: "topologyNode",
          position: {
            x: node.x - width / 2,
            y: node.y - height / 2,
          },
          draggable: false,
          selectable: true,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: {
            node,
            isSelected: selectedNodeId === node.id,
            isRelated: highlightedGraph.nodeIds.has(node.id),
            outboundRouteCount: topology.edges.filter(
              (edge) => edge.source === node.id && edge.kind === "route",
            ).length,
            hasIncoming,
            hasOutgoing,
            containerMatch,
            actionLoading: containerActionLoading[node.containerId || node.id],
            isAdmin: Boolean(user?.isAdmin),
            onSelect: setSelectedNodeId,
            onOpen: handleNodeOpen,
            onOpenLogs: (container) => {
              void openContainerLogs(container);
            },
            onContainerAction: (container, action) => {
              setPendingContainerAction({ container, action });
            },
            onOpenProxyLogs: () => {
              void openProxyLogs();
            },
          },
        };
      }),
    [
      topology.nodes,
      topology.edges,
      containers,
      selectedNodeId,
      highlightedGraph.nodeIds,
      containerActionLoading,
      user?.isAdmin,
      handleNodeOpen,
      openContainerLogs,
      openProxyLogs,
    ],
  );

  const flowEdges = useMemo<TopologyFlowEdge[]>(
    () =>
      topology.edges.map((edge) => {
        const isRelated = highlightedGraph.edgeIds.has(edge.id);
        const isRoute = edge.kind === "route";
        const neutralStroke = isRelated ? "#6b7280" : "#3f3f46";
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle:
            edge.kind === "route" && edge.source === "service:proxy"
              ? "source-route"
              : "source-main",
          targetHandle:
            edge.kind === "route" && edge.target.startsWith("container:")
              ? "target-route"
              : "target-main",
          type:
            edge.kind === "route" && edge.source === "service:proxy"
              ? "proxyRoute"
              : "smoothstep",
          animated: false,
          selectable: false,
          interactionWidth: 0,
          markerEnd: undefined,
          style: {
            stroke: neutralStroke,
            strokeOpacity: isRelated ? 1 : 0.4,
            strokeWidth: isRoute
              ? isRelated
                ? 1.6
                : 1.2
              : isRelated
                ? 2
                : 1.5,
            strokeDasharray: isRoute ? "4 6" : undefined,
          },
        };
      }),
    [highlightedGraph.edgeIds, topology.edges],
  );

  const nodeTypes = useMemo(() => ({ topologyNode: TopologyNodeCard }), []);
  const edgeTypes = useMemo(() => ({ proxyRoute: ProxyRouteEdge }), []);

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
          {renderedTerminalOutput.hiddenCount > 0 && (
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 pb-2">
              Showing last {MAX_RENDERED_TERMINAL_LINES} entries (
              {renderedTerminalOutput.hiddenCount} hidden)
            </div>
          )}
          {renderedTerminalOutput.lines.map((line, i) => {
            const isCommand = line.includes("] > ");
            const [cwdPart, commandPart] = isCommand
              ? line.split("] > ", 2)
              : ["", ""];
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
                        {cwdPart.substring(1)}
                      </span>
                      <span className="text-white">#</span>
                    </div>
                    <span className="text-neutral-100">{commandPart}</span>
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
            <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/[0.05] bg-transparent">
              <ReactFlow<TopologyFlowNode, TopologyFlowEdge>
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={(instance) => setReactFlowInstance(instance)}
                onPaneClick={() => setSelectedNodeId(null)}
                onNodeClick={
                  ((_event, node) => {
                    setSelectedNodeId(node.id);
                  }) as NodeMouseHandler<TopologyFlowNode>
                }
                onViewportChange={setFlowViewport}
                minZoom={MIN_SCALE}
                maxZoom={MAX_SCALE}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                panOnDrag
                panOnScroll
                zoomOnScroll={false}
                zoomOnPinch
                zoomOnDoubleClick={false}
                selectionOnDrag={false}
                connectionLineType={ConnectionLineType.SmoothStep}
                defaultEdgeOptions={{
                  type: "smoothstep",
                  zIndex: 0,
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 0,
                    height: 0,
                  },
                }}
                fitView={false}
                proOptions={{ hideAttribution: true }}
                className="bg-transparent"
              >
                <Background
                  id="container-map-dots"
                  variant={BackgroundVariant.Dots}
                  gap={32}
                  size={1.4}
                  color="rgba(255,255,255,0.18)"
                />
              </ReactFlow>

              <div className="absolute top-3 right-3 z-20 flex items-center gap-2 text-sm text-neutral-300 bg-card border border-white/10 rounded-md pl-2 pr-1 py-1">
                <span>{Math.round(flowViewport.zoom * 100)}%</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fitMapToViewport}
                  className="h-7"
                >
                  Reset View
                </Button>
              </div>
            </div>

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
                <div
                  ref={logsScrollRef}
                  className="flex-1 overflow-auto p-4 font-mono text-xs text-neutral-300"
                >
                  {logsLoading ? (
                    "Loading logs..."
                  ) : renderedLogsContent.text ? (
                    <div className="whitespace-pre-wrap break-all">
                      {renderedLogsContent.hiddenChars > 0 && (
                        <div className="text-[10px] uppercase tracking-wide text-neutral-500 pb-2">
                          Showing last {MAX_RENDERED_LOG_CHARS.toLocaleString()}{" "}
                          characters (
                          {renderedLogsContent.hiddenChars.toLocaleString()}{" "}
                          hidden)
                        </div>
                      )}
                      {renderedLogLines.hiddenLineCount > 0 && (
                        <div className="text-[10px] uppercase tracking-wide text-neutral-500 pb-2">
                          Showing last {MAX_RENDERED_LOG_LINES.toLocaleString()}{" "}
                          lines (
                          {renderedLogLines.hiddenLineCount.toLocaleString()}{" "}
                          hidden)
                        </div>
                      )}
                      {renderedLogLines.lines.map((line, i) => {
                        const { prefix, body } = splitDockerLogLine(line);
                        const level = classifyLogLine(body || line);
                        return (
                          <div key={i} className={getLogLevelClass(level)}>
                            {prefix ? (
                              <>
                                <span className="text-neutral-500">
                                  {prefix}
                                </span>{" "}
                                <span>{body}</span>
                              </>
                            ) : (
                              line
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    "No log output."
                  )}
                </div>
              </DialogContent>
            </Dialog>

              <ConfirmDialog
                open={Boolean(pendingContainerAction)}
                onOpenChange={(open) => {
                  if (!open) setPendingContainerAction(null);
                }}
                title={pendingActionTitle}
                description={pendingActionDescription}
                onConfirm={() => void confirmContainerAction()}
                confirmText={
                  pendingContainerAction?.action === "restart"
                  ? "Restart"
                  : pendingContainerAction?.action === "stop"
                    ? "Stop"
                    : "Start"
              }
              confirmVariant={
                pendingContainerAction?.action === "start"
                  ? "default"
                  : "destructive"
              }
              loading={
                pendingContainerAction
                  ? containerActionLoading[
                      pendingContainerAction.container.id
                    ] === pendingContainerAction.action
                  : false
              }
            />

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
        )}
      </div>
    </div>
  );
}
