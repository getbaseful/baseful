import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowClockwiseIcon,
  ClockCounterClockwiseIcon,
  CubeIcon,
  DatabaseIcon,
  FolderPlusIcon,
  GlobeIcon,
  HardDrivesIcon,
  ShieldStarIcon,
  TerminalIcon,
  TerminalWindowIcon,
  TrashIcon,
  UploadIcon,
} from "@phosphor-icons/react";
import {
  applyNodeChanges,
  BaseEdge,
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionLineType,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CreateDatabaseDialog from "@/components/database/CreateDatabaseDialog";
import { useAuth } from "@/context/AuthContext";
import { useDatabase } from "@/context/DatabaseContext";
import { useProject } from "@/context/ProjectContext";
import { authFetch } from "@/lib/api";
import { ManageProjectDialog } from "@/components/ManageProjectDialog";
import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

interface DatabaseInfo {
  id: number;
  name: string;
  projectId: number;
  status: string;
  type: string;
}

interface BackupSettingsInfo {
  database_id: number;
  enabled: boolean;
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  has_access_key?: boolean;
  has_secret_key?: boolean;
  path_prefix: string;
  automation_enabled: boolean;
  automation_frequency: string;
  encryption_enabled: boolean;
  encryption_public_key: string;
}

interface BackupCardInfo {
  id: string;
  label: string;
  config: BackupSettingsInfo;
  databaseId?: number | null;
}

interface AutomationCardInfo {
  id: string;
  label: string;
  automation_enabled: boolean;
  automation_frequency: string;
  databaseId?: number | null;
  backupCardId?: string | null;
}

type GraphKind =
  | "internet"
  | "project"
  | "service"
  | "container"
  | "network"
  | "automation"
  | "backup";

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
  connectedContainers?: string[];
  projectCount?: number;
  networkRole?: string;
  databaseId?: number;
  databaseName?: string;
  backupProvider?: string;
  backupBucket?: string;
  backupEndpoint?: string;
  backupPathPrefix?: string;
  backupEncryptionEnabled?: boolean;
  automationFrequency?: string;
  isSimulated?: boolean;
  x: number;
  y: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "belongs" | "exposes" | "route" | "backup";
}

interface TopologyNodeData extends Record<string, unknown> {
  node: GraphNode;
  isSelected: boolean;
  isRelated: boolean;
  outboundRouteCount: number;
  hasIncoming: boolean;
  hasOutgoing: boolean;
  hasIncomingRoute: boolean;
  hasOutgoingRoute: boolean;
  canAttachProjectConnection: boolean;
  canAcceptIncomingConnection: boolean;
  canStartOutgoingConnection: boolean;
  canDelete: boolean;
  canOpenBackupPage: boolean;
  containerMatch?: ContainerInfo;
  actionLoading?: "start" | "stop" | "restart" | "logs";
  isAdmin: boolean;
  onSelect: (nodeId: string) => void;
  onOpen: (node: GraphNode, containerMatch?: ContainerInfo) => void;
  onOpenLogs: (container: ContainerInfo) => void;
  onContainerAction: (
    container: ContainerInfo,
    action: "start" | "stop" | "restart",
    databaseId?: number,
  ) => void;
  onOpenProxyLogs: () => void;
  onOpenBackupPage: (databaseId: number) => void;
  onRequestDelete: (node: GraphNode) => void;
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
const NETWORK_CARD_WIDTH = 256;
const AUTOMATION_CARD_WIDTH = 214;
const BACKUP_CARD_WIDTH = 280;
const DEFAULT_CARD_HEIGHT = 150;
const CONTAINER_CARD_HEIGHT = 186;
const SERVICE_CARD_HEIGHT = 188;
const INTERNET_CARD_HEIGHT = 164;
const NETWORK_CARD_HEIGHT = 188;
const AUTOMATION_CARD_HEIGHT = 148;
const BACKUP_CARD_HEIGHT = 224;
const MAX_RENDERED_TERMINAL_LINES = 1200;
const MAX_RENDERED_LOG_CHARS = 300000;
const MAX_RENDERED_LOG_LINES = 4000;
const NODE_POSITION_STORAGE_KEY = "baseful.containers.node-positions.v1";
const VIEWPORT_STORAGE_KEY = "baseful.containers.viewport.v1";
const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

type NodeCenterPosition = { x: number; y: number };
type CreateEntityKind = "project" | "database" | "backup" | "automation";
type ServiceCardsPayload = {
  backupCards: BackupCardInfo[];
  automationCards: AutomationCardInfo[];
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildScopedStorageKey(baseKey: string, userId?: number | null) {
  if (typeof window === "undefined") {
    return `${baseKey}:server:unknown:user:${userId ?? "anonymous"}`;
  }

  return `${baseKey}:server:${window.location.host}:user:${userId ?? "anonymous"}`;
}

function normalizeServiceCardsPayload(
  payload: Partial<ServiceCardsPayload> | null | undefined,
): ServiceCardsPayload {
  return {
    backupCards: Array.isArray(payload?.backupCards) ? payload.backupCards : [],
    automationCards: Array.isArray(payload?.automationCards)
      ? payload.automationCards
      : [],
  };
}

function serializeServiceCardsPayload(payload: ServiceCardsPayload): string {
  return JSON.stringify({
    backupCards: payload.backupCards,
    automationCards: payload.automationCards,
  });
}

function loadStoredNodePositions(): Record<string, NodeCenterPosition> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(NODE_POSITION_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, NodeCenterPosition>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistNodePositions(positions: Record<string, NodeCenterPosition>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    NODE_POSITION_STORAGE_KEY,
    JSON.stringify(positions),
  );
}

function loadStoredViewport(storageKey: string): Viewport | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<Viewport>;
    if (
      typeof parsed?.x !== "number" ||
      typeof parsed?.y !== "number" ||
      typeof parsed?.zoom !== "number"
    ) {
      return null;
    }

    return {
      x: parsed.x,
      y: parsed.y,
      zoom: parsed.zoom,
    };
  } catch {
    return null;
  }
}

function persistViewport(storageKey: string, viewport: Viewport) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(viewport));
}

function clearStoredViewport(storageKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(storageKey);
}

function createDefaultBackupSettings(databaseId: number): BackupSettingsInfo {
  return {
    database_id: databaseId,
    enabled: false,
    provider: "s3",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    access_key: "",
    secret_key: "",
    has_access_key: false,
    has_secret_key: false,
    path_prefix: "/baseful/backups",
    automation_enabled: false,
    automation_frequency: "daily",
    encryption_enabled: false,
    encryption_public_key: "",
  };
}

function normalizeStoredServiceCards(
  payload: ServiceCardsPayload,
  backupSettingsByDatabaseId: Record<number, BackupSettingsInfo>,
  databases: DatabaseInfo[],
): ServiceCardsPayload {
  const databaseIds = new Set(databases.map((database) => database.id));
  const normalizedBackupCards: BackupCardInfo[] = [];
  const normalizedAutomationCards: AutomationCardInfo[] = [];
  const seenBackupIds = new Set<string>();
  const seenAutomationIds = new Set<string>();
  const attachedBackupDatabaseIds = new Set<number>();
  const attachedAutomationDatabaseIds = new Set<number>();

  payload.backupCards.forEach((card) => {
    if (!card?.id || seenBackupIds.has(card.id)) {
      return;
    }

    if (card.databaseId == null) {
      normalizedBackupCards.push(card);
      seenBackupIds.add(card.id);
      return;
    }

    if (
      !databaseIds.has(card.databaseId) ||
      !backupSettingsByDatabaseId[card.databaseId]?.enabled ||
      attachedBackupDatabaseIds.has(card.databaseId)
    ) {
      return;
    }

    normalizedBackupCards.push(card);
    seenBackupIds.add(card.id);
    attachedBackupDatabaseIds.add(card.databaseId);
  });

  const normalizedBackupIds = new Set(
    normalizedBackupCards.map((card) => card.id),
  );
  const attachedBackupCardIdByDatabaseId = normalizedBackupCards.reduce(
    (acc, card) => {
      if (card.databaseId != null) {
        acc[card.databaseId] = card.id;
      }
      return acc;
    },
    {} as Record<number, string>,
  );

  payload.automationCards.forEach((card) => {
    if (!card?.id || seenAutomationIds.has(card.id)) {
      return;
    }

    if (card.databaseId == null) {
      normalizedAutomationCards.push({
        ...card,
        backupCardId:
          card.backupCardId && normalizedBackupIds.has(card.backupCardId)
            ? card.backupCardId
            : null,
      });
      seenAutomationIds.add(card.id);
      return;
    }

    if (
      !databaseIds.has(card.databaseId) ||
      !backupSettingsByDatabaseId[card.databaseId]?.enabled ||
      !backupSettingsByDatabaseId[card.databaseId]?.automation_enabled ||
      attachedAutomationDatabaseIds.has(card.databaseId)
    ) {
      return;
    }

    normalizedAutomationCards.push({
      ...card,
      backupCardId:
        attachedBackupCardIdByDatabaseId[card.databaseId] ||
        card.backupCardId ||
        null,
    });
    seenAutomationIds.add(card.id);
    attachedAutomationDatabaseIds.add(card.databaseId);
  });

  return {
    backupCards: normalizedBackupCards,
    automationCards: normalizedAutomationCards,
  };
}

function deriveEffectiveBackupCards(
  storedBackupCards: BackupCardInfo[],
  backupSettingsByDatabaseId: Record<number, BackupSettingsInfo>,
  databases: DatabaseInfo[],
): BackupCardInfo[] {
  const databasesById = databases.reduce(
    (acc, database) => {
      acc[database.id] = database;
      return acc;
    },
    {} as Record<number, DatabaseInfo>,
  );
  const attachedDatabaseIds = new Set<number>();
  const effectiveBackupCards: BackupCardInfo[] = [];

  storedBackupCards.forEach((card) => {
    if (card.databaseId == null) {
      effectiveBackupCards.push(card);
      return;
    }

    const settings = backupSettingsByDatabaseId[card.databaseId];
    const database = databasesById[card.databaseId];
    if (
      !settings?.enabled ||
      !database ||
      attachedDatabaseIds.has(card.databaseId)
    ) {
      return;
    }

    effectiveBackupCards.push({
      ...card,
      label: card.label || `${database.name} Backup`,
      config: {
        ...settings,
        database_id: 0,
      },
    });
    attachedDatabaseIds.add(card.databaseId);
  });

  databases.forEach((database) => {
    const settings = backupSettingsByDatabaseId[database.id];
    if (!settings?.enabled || attachedDatabaseIds.has(database.id)) {
      return;
    }

    effectiveBackupCards.push({
      id: `database-backup:${database.id}`,
      label: `${database.name} Backup`,
      config: {
        ...settings,
        database_id: 0,
      },
      databaseId: database.id,
    });
  });

  return effectiveBackupCards;
}

function deriveEffectiveAutomationCards(
  storedAutomationCards: AutomationCardInfo[],
  effectiveBackupCards: BackupCardInfo[],
  backupSettingsByDatabaseId: Record<number, BackupSettingsInfo>,
  databases: DatabaseInfo[],
): AutomationCardInfo[] {
  const databasesById = databases.reduce(
    (acc, database) => {
      acc[database.id] = database;
      return acc;
    },
    {} as Record<number, DatabaseInfo>,
  );
  const attachedBackupCardIdByDatabaseId = effectiveBackupCards.reduce(
    (acc, card) => {
      if (card.databaseId != null) {
        acc[card.databaseId] = card.id;
      }
      return acc;
    },
    {} as Record<number, string>,
  );
  const attachedDatabaseIds = new Set<number>();
  const effectiveAutomationCards: AutomationCardInfo[] = [];

  storedAutomationCards.forEach((card) => {
    if (card.databaseId == null) {
      effectiveAutomationCards.push(card);
      return;
    }

    const settings = backupSettingsByDatabaseId[card.databaseId];
    const database = databasesById[card.databaseId];
    if (
      !settings?.enabled ||
      !settings.automation_enabled ||
      !database ||
      attachedDatabaseIds.has(card.databaseId)
    ) {
      return;
    }

    effectiveAutomationCards.push({
      ...card,
      label: card.label || `${database.name} Backup Automation`,
      automation_enabled: true,
      automation_frequency: settings.automation_frequency || "daily",
      backupCardId:
        attachedBackupCardIdByDatabaseId[card.databaseId] ||
        card.backupCardId ||
        null,
    });
    attachedDatabaseIds.add(card.databaseId);
  });

  databases.forEach((database) => {
    const settings = backupSettingsByDatabaseId[database.id];
    if (
      !settings?.enabled ||
      !settings.automation_enabled ||
      attachedDatabaseIds.has(database.id)
    ) {
      return;
    }

    effectiveAutomationCards.push({
      id: `database-automation:${database.id}`,
      label: `${database.name} Backup Automation`,
      automation_enabled: true,
      automation_frequency: settings.automation_frequency || "daily",
      databaseId: database.id,
      backupCardId: attachedBackupCardIdByDatabaseId[database.id] || null,
    });
  });

  return effectiveAutomationCards;
}

function getNodeCardDimensions(node: GraphNode) {
  return {
    width:
      node.kind === "internet"
        ? INTERNET_CARD_WIDTH
        : node.kind === "network"
          ? NETWORK_CARD_WIDTH
          : node.kind === "automation"
            ? AUTOMATION_CARD_WIDTH
            : node.kind === "backup"
              ? BACKUP_CARD_WIDTH
              : node.kind === "container"
                ? CONTAINER_CARD_WIDTH
                : DEFAULT_CARD_WIDTH,
    height:
      node.kind === "internet"
        ? INTERNET_CARD_HEIGHT
        : node.kind === "network"
          ? NETWORK_CARD_HEIGHT
          : node.kind === "automation"
            ? AUTOMATION_CARD_HEIGHT
            : node.kind === "backup"
              ? BACKUP_CARD_HEIGHT
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

function resolveContainerProjectName(
  container: ContainerInfo,
  projectsById: Record<string, ProjectInfo>,
  databasesByName: Record<string, DatabaseInfo>,
): string | null {
  const databaseName = container.labels?.["baseful.database"]?.trim();
  const isBranchContainer = Boolean(container.labels?.["baseful.branch"]);

  if (databaseName && !isBranchContainer) {
    const databaseRecord = databasesByName[databaseName.toLowerCase()];
    if (databaseRecord) {
      if (!databaseRecord.projectId) {
        return null;
      }

      return (
        projectsById[String(databaseRecord.projectId)]?.name ||
        `Project ${databaseRecord.projectId}`
      );
    }
  }

  const inferred = inferProjectName(container.labels, projectsById);
  return inferred.toLowerCase() === "unassigned" ? null : inferred;
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
  databases: DatabaseInfo[],
  backupCards: BackupCardInfo[],
  automationCards: AutomationCardInfo[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const projectSet = new Set<string>(
    Object.values(projectsById)
      .map((project) => project.name?.trim())
      .filter((name): name is string => Boolean(name)),
  );
  const networkSet = new Set<string>();
  const databasesByName = databases.reduce(
    (acc, database) => {
      acc[database.name.toLowerCase()] = database;
      return acc;
    },
    {} as Record<string, DatabaseInfo>,
  );

  containers.forEach((container) => {
    const project = resolveContainerProjectName(
      container,
      projectsById,
      databasesByName,
    );
    if (project) {
      projectSet.add(project);
    }

    if (container.ip) {
      networkSet.add(inferSubnet(container.ip));
    }
  });

  const projects = [...projectSet].sort();
  const networks = [...networkSet].sort();

  const containersPerNetwork: Record<string, number> = {};
  const containerNamesByNetwork: Record<string, string[]> = {};
  const projectsByNetwork: Record<string, Set<string>> = {};
  containers.forEach((c) => {
    if (c.ip) {
      const s = inferSubnet(c.ip);
      containersPerNetwork[s] = (containersPerNetwork[s] || 0) + 1;
      containerNamesByNetwork[s] = [
        ...(containerNamesByNetwork[s] || []),
        getContainerDisplayNames(c).clean,
      ];
      if (!projectsByNetwork[s]) {
        projectsByNetwork[s] = new Set<string>();
      }
      const project = resolveContainerProjectName(
        c,
        projectsById,
        databasesByName,
      );
      if (project) {
        projectsByNetwork[s].add(project);
      }
    }
  });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeCenterById = new Map<string, { x: number; y: number }>();

  const registerNode = (node: GraphNode) => {
    nodes.push(node);
    nodeCenterById.set(node.id, { x: node.x, y: node.y });
  };

  const xByKind: Record<GraphKind, number> = {
    internet: -140,
    project: 120,
    service: 400,
    container: 560,
    network: 920,
    automation: 1180,
    backup: 1490,
  };

  let currentY = 80;
  const yGap = 220;
  const databaseContainerNodeIds = new Map<number, string>();

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

    registerNode({
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

    registerNode({
      id: "internet:public",
      kind: "internet",
      label: "Client Access",
      detail: "ingress",
      color: "#1f2937",
      x: xByKind.internet,
      y: internetY,
    });

    registerNode({
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
    const projA =
      resolveContainerProjectName(a, projectsById, databasesByName) || "";
    const projB =
      resolveContainerProjectName(b, projectsById, databasesByName) || "";
    if (projA !== projB) return projA.localeCompare(projB);
    return getContainerName(a).localeCompare(getContainerName(b));
  });

  sortedContainers.forEach((container) => {
    const names = getContainerDisplayNames(container);
    const project = resolveContainerProjectName(
      container,
      projectsById,
      databasesByName,
    );

    const [imageNamePath, rawVersion = ""] = container.image.split(":");
    const imageName = imageNamePath.split("/").pop() || "";
    const imageNameLower = imageName.toLowerCase();
    const isDatabaseContainer =
      Boolean(container.labels?.["baseful.database"]) ||
      Boolean(container.labels?.["baseful.branch"]) ||
      imageNameLower.startsWith("postgres");
    const isBranchContainer = Boolean(container.labels?.["baseful.branch"]);
    // Hide version if it's a sha256 hash or is unusually long
    const isShaOrLong =
      rawVersion.startsWith("sha256") || rawVersion.length > 20;
    const versionStr =
      isShaOrLong || !rawVersion ? "" : `${imageName} ${rawVersion}`.trim();
    const databaseName = container.labels?.["baseful.database"]?.trim();
    const databaseRecord = databaseName
      ? databasesByName[databaseName.toLowerCase()]
      : undefined;

    registerNode({
      id: `container:${container.id}`,
      kind: "container",
      label: names.clean,
      detail: container.state,
      status: container.status,
      ip: container.ip,
      version: versionStr,
      color: container.state === "running" ? "#0f5132" : "#4b5563",
      containerId: container.id,
      databaseId: !isBranchContainer ? databaseRecord?.id : undefined,
      databaseName: !isBranchContainer ? databaseName : undefined,
      isSimulated: container.labels[BASEFUL_SIMULATED_LABEL] === "true",
      x: xByKind.container,
      y: currentY,
    });

    // Keep structural ownership link for all containers.
    if (project) {
      edges.push({
        id: `edge:project:${project}:container:${container.id}`,
        source: `project:${project}`,
        target: `container:${container.id}`,
        kind: "belongs",
      });
    }

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
    if (databaseRecord && !isBranchContainer) {
      databaseContainerNodeIds.set(
        databaseRecord.id,
        `container:${container.id}`,
      );
    }

    currentY += yGap;
  });

  const networkStartY = -520;
  const networkYGap = 220;
  currentY = networkStartY;
  networks.forEach((network) => {
    const projectCount = projectsByNetwork[network]?.size || 0;
    const connectedContainers = (containerNamesByNetwork[network] || []).sort();

    registerNode({
      id: `network:${network}`,
      kind: "network",
      label: "Internal Network",
      detail: "private traffic lane",
      version: network,
      count: containersPerNetwork[network] || 0,
      connectedContainers,
      projectCount,
      networkRole: projectCount > 1 ? "Shared bridge" : "Project bridge",
      color: "#4f3a1f",
      x: xByKind.network,
      y: currentY,
    });
    currentY += networkYGap;
  });

  const backupCountsByAnchor = new Map<string, number>();
  const unattachedBackupBaseY = Math.max(
    80,
    nodes.reduce((maxY, node) => Math.max(maxY, node.y), 80) + yGap,
  );

  backupCards.forEach((card, index) => {
    const databaseRecord =
      card.databaseId != null
        ? databases.find((database) => database.id === card.databaseId)
        : undefined;
    const providerLabel =
      card.config.provider?.toLowerCase() === "s3"
        ? card.config.endpoint?.toLowerCase().includes("r2")
          ? "R2 Object Storage"
          : "S3 Object Storage"
        : card.config.provider || "Object Storage";
    const endpointHost = card.config.endpoint
      ? card.config.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : "";

    const databaseNodeId =
      card.databaseId != null
        ? databaseContainerNodeIds.get(card.databaseId)
        : undefined;
    const backupAnchorId = databaseNodeId ?? `unattached-backup:${index}`;
    const backupAnchor = databaseNodeId
      ? nodeCenterById.get(databaseNodeId)
      : null;
    const backupAnchorCount = backupCountsByAnchor.get(backupAnchorId) || 0;
    backupCountsByAnchor.set(backupAnchorId, backupAnchorCount + 1);
    const backupY = backupAnchor
      ? backupAnchor.y + backupAnchorCount * 96
      : unattachedBackupBaseY + index * yGap;

    registerNode({
      id: `backup-card:${card.id}`,
      kind: "backup",
      label: card.label,
      detail: providerLabel,
      version: card.config.bucket || "bucket",
      color: "#0f3d4a",
      databaseId: card.databaseId || undefined,
      databaseName: databaseRecord?.name,
      backupProvider: providerLabel,
      backupBucket: card.config.bucket,
      backupEndpoint: endpointHost || "Managed endpoint",
      backupPathPrefix: card.config.path_prefix,
      backupEncryptionEnabled: card.config.encryption_enabled,
      x: xByKind.backup,
      y: backupY,
    });

    if (databaseNodeId) {
      edges.push({
        id: `edge:${databaseNodeId}:backup-card:${card.id}`,
        source: databaseNodeId,
        target: `backup-card:${card.id}`,
        kind: "backup",
      });
    }
  });

  const automationCountsByAnchor = new Map<string, number>();
  const unattachedAutomationBaseY = unattachedBackupBaseY;

  automationCards.forEach((card, index) => {
    const databaseRecord =
      card.databaseId != null
        ? databases.find((database) => database.id === card.databaseId)
        : undefined;
    const databaseNodeId =
      card.databaseId != null
        ? databaseContainerNodeIds.get(card.databaseId)
        : undefined;
    const automationAnchorId =
      card.backupCardId != null
        ? `backup-card:${card.backupCardId}`
        : databaseNodeId || `unattached-automation:${index}`;
    const automationAnchor = nodeCenterById.get(automationAnchorId);
    const automationAnchorCount =
      automationCountsByAnchor.get(automationAnchorId) || 0;
    automationCountsByAnchor.set(automationAnchorId, automationAnchorCount + 1);
    const automationY = automationAnchor
      ? automationAnchor.y - 100 + automationAnchorCount * 84
      : unattachedAutomationBaseY + index * yGap;

    registerNode({
      id: `automation-card:${card.id}`,
      kind: "automation",
      label: card.label,
      detail: "backup automation",
      color: "#24414a",
      databaseId: card.databaseId || undefined,
      databaseName: databaseRecord?.name,
      automationFrequency: card.automation_frequency || "daily",
      x: xByKind.automation,
      y: automationY,
    });

    if (card.backupCardId) {
      edges.push({
        id: `edge:automation-card:${card.id}:backup-card:${card.backupCardId}`,
        source: `automation-card:${card.id}`,
        target: `backup-card:${card.backupCardId}`,
        kind: "backup",
      });
    } else if (card.databaseId != null) {
      if (databaseNodeId) {
        edges.push({
          id: `edge:automation-card:${card.id}:${databaseNodeId}`,
          source: `automation-card:${card.id}`,
          target: databaseNodeId,
          kind: "backup",
        });
      }
    }
  });

  return { nodes, edges };
}

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

function TopologyNodeCard({ data }: NodeProps<TopologyFlowNode>) {
  const {
    node,
    isSelected,
    isRelated,
    outboundRouteCount,
    hasIncoming,
    hasOutgoing,
    hasIncomingRoute,
    hasOutgoingRoute,
    canAcceptIncomingConnection,
    canStartOutgoingConnection,
    canDelete,
    canOpenBackupPage,
    containerMatch,
    actionLoading,
    isAdmin,
    onSelect,
    onOpen,
    onOpenLogs,
    onContainerAction,
    onOpenProxyLogs,
    onOpenBackupPage,
    onRequestDelete,
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
    iconNode = <ShieldStarIcon className="w-4 h-4 text-neutral-400" />;
    nodeTypeStr = "Service";
  } else if (node.kind === "internet") {
    iconNode = <GlobeIcon className="w-4 h-4 text-blue-300" />;
    nodeTypeStr = "Internet";
  } else if (node.kind === "network") {
    iconNode = <NetworkIconSVG className="w-4 h-4 text-neutral-400" />;
    nodeTypeStr = "Network";
  } else if (node.kind === "automation") {
    iconNode = (
      <ClockCounterClockwiseIcon className="w-4 h-4 text-neutral-200" />
    );
    nodeTypeStr = "Backup Automation";
  } else if (node.kind === "backup") {
    iconNode = <UploadIcon className="w-4 h-4 text-neutral-200" />;
    nodeTypeStr = "Backup";
  } else if (isContainer) {
    iconNode = (
      <DitherAvatar
        value={node.databaseName || node.label || "database"}
        size={16}
      />
    );
    nodeTypeStr = "Container";
  }

  const actionsDisabled = node.isSimulated || Boolean(actionLoading);
  const actionButtonClass = `h-7 transition-colors duration-200 flex-1 min-w-0 px-2 py-0 border rounded-md flex items-center justify-center text-[10px] uppercase tracking-wider font-semibold border-border ${
    actionsDisabled
      ? "opacity-40 pointer-events-none"
      : "hover:bg-[color-mix(in_srgb,var(--card)_90%,white)] bg-muted cursor-pointer"
  }`;
  const openButtonClass =
    "h-7 flex-1 min-w-0 px-2 py-0 bg-muted hover:bg-[color-mix(in_srgb,var(--card)_90%,white)] border rounded-md flex items-center justify-center text-[10px] uppercase tracking-wider font-semibold border-border cursor-pointer";

  return (
    <div
      className={`rounded-[10px] border flex flex-col select-none transition-colors overflow-hidden ${
        isSelected
          ? "bg-neutral-800 border-neutral-500 shadow-xl"
          : isRelated
            ? "bg-[#181818] border-neutral-600 shadow-md"
            : "bg-[color-mix(in_srgb,var(--card)_97%,white)] border-[#2a2a2a] shadow-md hover:border-[#3e3e3e]"
      }`}
      style={{ width: cardWidth, height: cardHeight }}
      onClick={() => onSelect(node.id)}
    >
      {(hasIncoming || canAcceptIncomingConnection) && (
        <Handle
          type="target"
          position={Position.Left}
          id="target-main"
          isConnectable={canAcceptIncomingConnection}
          className={`!h-2.5 !w-2.5 !rounded-full !border !border-neutral-700 !bg-[#111111] !left-[-5px] ${canAcceptIncomingConnection ? "!cursor-crosshair" : "!cursor-default !pointer-events-none"}`}
        />
      )}
      {node.kind === "container" && hasIncomingRoute && (
        <Handle
          type="target"
          position={Position.Left}
          id="target-route"
          isConnectable={false}
          style={{ top: "38%" }}
          className="!h-2.5 !w-2.5 !rounded-full !border !border-neutral-700 !bg-[#111111] !left-[-5px] !cursor-default !pointer-events-none"
        />
      )}
      {((hasOutgoing && node.kind !== "service") ||
        canStartOutgoingConnection) && (
        <Handle
          type="source"
          position={Position.Right}
          id="source-main"
          isConnectable={canStartOutgoingConnection}
          className={`!h-2.5 !w-2.5 !rounded-full !border !border-neutral-700 !bg-[#111111] !right-[-5px] ${canStartOutgoingConnection ? "!cursor-crosshair" : "!cursor-default !pointer-events-none"}`}
        />
      )}
      {node.id === "service:proxy" && hasOutgoingRoute && (
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
          isContainer
            ? "h-[46px]"
            : node.kind === "backup"
              ? "h-[58px]"
              : "h-[34px]"
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
            {canDelete && (
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-sm border border-transparent text-neutral-500 transition-colors hover:border-white/10 hover:bg-white/5 hover:text-red-400"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestDelete(node);
                }}
                aria-label={`Delete ${node.label}`}
                title="Delete"
              >
                <TrashIcon size={14} />
              </button>
            )}
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
          <div className="space-y-2">
            <div className="rounded border border-cyan-500/20 bg-cyan-500/[0.08] px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-cyan-200 font-bold uppercase tracking-wider">
                  {node.networkRole || "Internal bridge"}
                </span>
                <span className="text-[10px] text-cyan-300 font-semibold">
                  Private
                </span>
              </div>
              <div className="mt-1 text-[10px] text-cyan-100/80 leading-tight">
                Carries container-to-container traffic inside Docker.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded border border-white/5 bg-neutral-900/40 px-2 py-1.5">
                <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">
                  Workloads
                </div>
                <div className="text-[10px] text-neutral-200 font-semibold">
                  {node.count || 0}{" "}
                  {node.count === 1 ? "Container" : "Containers"}
                </div>
              </div>
              <div className="rounded border border-white/5 bg-neutral-900/40 px-2 py-1.5">
                <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">
                  Scope
                </div>
                <div className="text-[10px] text-neutral-200 font-semibold">
                  {node.projectCount || 0}{" "}
                  {node.projectCount === 1 ? "Project" : "Projects"}
                </div>
              </div>
            </div>
            <div className="text-[9px] text-neutral-400 leading-tight">
              {node.connectedContainers?.length
                ? `Attached: ${node.connectedContainers.slice(0, 2).join(", ")}${node.connectedContainers.length > 2 ? ` +${node.connectedContainers.length - 2}` : ""}`
                : "No attached workloads"}
            </div>
          </div>
        ) : node.kind === "backup" ? (
          <div className="space-y-2">
            <div className="rounded border border-sky-500/20 bg-sky-500/[0.08] px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-sky-100 font-bold uppercase tracking-wider">
                  External snapshot target
                </span>
                <span className="text-[10px] text-sky-300 font-semibold">
                  Enabled
                </span>
              </div>
              <div className="mt-1 text-[10px] text-sky-100/80 leading-tight">
                Stores backups for {node.databaseName || "this database"}{" "}
                outside the local Docker network.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded border border-white/5 bg-neutral-900/40 px-2 py-1.5">
                <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">
                  Provider
                </div>
                <div className="text-[10px] text-neutral-200 font-semibold truncate">
                  {node.backupProvider || "Object storage"}
                </div>
              </div>
              <div className="rounded border border-white/5 bg-neutral-900/40 px-2 py-1.5">
                <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">
                  Encryption
                </div>
                <div className="text-[10px] text-neutral-200 font-semibold">
                  {node.backupEncryptionEnabled ? "On" : "Off"}
                </div>
              </div>
            </div>
            <div className="text-[9px] text-neutral-400 leading-tight">
              Bucket: {node.backupBucket || "Not configured"}
            </div>
          </div>
        ) : node.kind === "automation" ? (
          <div className="space-y-2">
            <div className="rounded border border-cyan-500/20 bg-cyan-500/[0.08] px-2 py-1.5">
              <div className="text-[9px] text-cyan-100 font-bold uppercase tracking-wider">
                Scheduled backup runner
              </div>
              <div className="mt-1 text-[10px] text-cyan-100/80 leading-tight">
                Prepares recurring snapshot jobs for this database.
              </div>
            </div>
            <div className="rounded border border-white/5 bg-neutral-900/40 px-2 py-1.5">
              <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">
                Frequency
              </div>
              <div className="text-[10px] text-neutral-200 font-semibold">
                {node.automationFrequency === "hourly"
                  ? "Every hour"
                  : node.automationFrequency === "weekly"
                    ? "Every week"
                    : "Every day"}
              </div>
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
      {(isContainer || node.kind === "project" || node.kind === "backup") && (
        <div
          className={`flex items-center px-3 border-t gap-1 ${
            isContainer
              ? "h-[48px]"
              : node.kind === "backup"
                ? "h-[52px]"
                : "h-[40px]"
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
                    node.databaseId,
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
                      node.databaseId,
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
                  onContainerAction(containerMatch, "restart", node.databaseId);
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !actionsDisabled
                  ) {
                    e.preventDefault();
                    onContainerAction(
                      containerMatch,
                      "restart",
                      node.databaseId,
                    );
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
              if (
                node.kind === "backup" &&
                node.databaseId &&
                canOpenBackupPage
              ) {
                onOpenBackupPage(node.databaseId);
                return;
              }
              onSelect(node.id);
              onOpen(node, containerMatch);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (
                  node.kind === "backup" &&
                  node.databaseId &&
                  canOpenBackupPage
                ) {
                  onOpenBackupPage(node.databaseId);
                  return;
                }
                onSelect(node.id);
              }
            }}
            className={openButtonClass}
          >
            {node.kind === "backup" && node.databaseId && canOpenBackupPage
              ? "Open Backup Page"
              : "Open"}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Containers() {
  const navigate = useNavigate();
  const { token, logout, user, hasPermission } = useAuth();
  const { refreshDatabases } = useDatabase();
  const { refreshProjects } = useProject();
  const canAccessServer = user?.isAdmin || hasPermission("server_access");
  const canManageBackups = user?.isAdmin || hasPermission("manage_backups");
  const canDeleteDatabases =
    user?.isAdmin ||
    hasPermission("delete_databases") ||
    hasPermission("create_databases");
  const canExecContainers = user?.isAdmin || hasPermission("container_exec");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createDatabaseOpen, setCreateDatabaseOpen] = useState(false);
  const [createBackupOpen, setCreateBackupOpen] = useState(false);
  const [createAutomationOpen, setCreateAutomationOpen] = useState(false);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectsById, setProjectsById] = useState<Record<string, ProjectInfo>>(
    {},
  );
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [backupSettingsByDatabaseId, setBackupSettingsByDatabaseId] = useState<
    Record<number, BackupSettingsInfo>
  >({});
  const [backupCards, setBackupCards] = useState<BackupCardInfo[]>([]);
  const [automationCards, setAutomationCards] = useState<AutomationCardInfo[]>(
    [],
  );
  const [serviceCardsHydrated, setServiceCardsHydrated] = useState(false);
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
  const [flowViewport, setFlowViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [viewportHydrated, setViewportHydrated] = useState(false);
  const [hasStoredViewport, setHasStoredViewport] = useState(false);
  const [customNodePositions, setCustomNodePositions] = useState<
    Record<string, NodeCenterPosition>
  >(() => loadStoredNodePositions());
  const [pendingCreationPosition, setPendingCreationPosition] =
    useState<NodeCenterPosition | null>(null);
  const [backupSubmitting, setBackupSubmitting] = useState(false);
  const [automationSubmitting, setAutomationSubmitting] = useState(false);
  const [backupCopySourceId, setBackupCopySourceId] = useState<string>("");
  const [backupForm, setBackupForm] = useState<BackupSettingsInfo>(
    createDefaultBackupSettings(0),
  );
  const [automationForm, setAutomationForm] = useState<{
    automationEnabled: boolean;
    automationFrequency: string;
  }>({
    automationEnabled: true,
    automationFrequency: "daily",
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
    databaseId?: number;
  } | null>(null);
  const [pendingBackupAssignment, setPendingBackupAssignment] = useState<{
    backupCardId: string;
    databaseId: number;
    databaseName: string;
  } | null>(null);
  const [backupAssignmentLoading, setBackupAssignmentLoading] = useState(false);
  const [pendingNodeDeletion, setPendingNodeDeletion] = useState<{
    node: GraphNode;
    title: string;
    description: string;
    confirmText: string;
  } | null>(null);
  const [nodeDeletionLoading, setNodeDeletionLoading] = useState(false);
  const [isMobileDrawer, setIsMobileDrawer] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const mapInitializedRef = useRef(false);
  const lastServiceCardsSnapshotRef = useRef(
    serializeServiceCardsPayload({
      backupCards: [],
      automationCards: [],
    }),
  );

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
  const viewportStorageKey = useMemo(
    () => buildScopedStorageKey(VIEWPORT_STORAGE_KEY, user?.id),
    [user?.id],
  );

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

  const persistServiceCards = useCallback(
    async (payload: ServiceCardsPayload) => {
      if (!canAccessServer || !canManageBackups) {
        return;
      }

      const nextSnapshot = serializeServiceCardsPayload(payload);
      if (nextSnapshot === lastServiceCardsSnapshotRef.current) {
        return;
      }

      const response = await authFetch(
        "/api/topology/service-cards",
        token,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        logout,
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || "Failed to save service cards");
      }

      lastServiceCardsSnapshotRef.current = nextSnapshot;
    },
    [canAccessServer, canManageBackups, logout, token],
  );

  useEffect(() => {
    if (!serviceCardsHydrated || !canAccessServer || !canManageBackups) {
      return;
    }

    const payload = {
      backupCards,
      automationCards,
    };
    const nextSnapshot = serializeServiceCardsPayload(payload);
    if (nextSnapshot === lastServiceCardsSnapshotRef.current) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await persistServiceCards(payload);
        if (!cancelled) {
          lastServiceCardsSnapshotRef.current = nextSnapshot;
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to save service cards",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    automationCards,
    backupCards,
    canAccessServer,
    canManageBackups,
    logout,
    persistServiceCards,
    serviceCardsHydrated,
    token,
  ]);

  useLayoutEffect(() => {
    setViewportHydrated(false);
    const storedViewport = loadStoredViewport(viewportStorageKey);
    setFlowViewport(storedViewport ?? DEFAULT_VIEWPORT);
    setHasStoredViewport(Boolean(storedViewport));
    setViewportHydrated(true);

    if (reactFlowInstance && storedViewport) {
      void reactFlowInstance.setViewport(storedViewport, { duration: 0 });
    }
  }, [reactFlowInstance, viewportStorageKey]);

  useEffect(() => {
    if (!viewportHydrated) {
      return;
    }

    persistViewport(viewportStorageKey, flowViewport);
  }, [flowViewport, viewportHydrated, viewportStorageKey]);

  const setNodePlacement = useCallback(
    (nodeId: string, position: NodeCenterPosition | null) => {
      setCustomNodePositions((prev) => {
        const next = { ...prev };

        if (position) {
          next[nodeId] = position;
        } else {
          delete next[nodeId];
        }

        persistNodePositions(next);
        return next;
      });
    },
    [],
  );

  const clearNodePlacements = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) {
      return;
    }

    setCustomNodePositions((prev) => {
      const next = { ...prev };
      nodeIds.forEach((nodeId) => {
        delete next[nodeId];
      });
      persistNodePositions(next);
      return next;
    });
  }, []);

  const saveBackupSettingsForDatabase = useCallback(
    async (databaseId: number, settings: BackupSettingsInfo) => {
      const response = await authFetch(
        `/api/databases/${databaseId}/backups/settings`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...settings,
            database_id: databaseId,
          }),
        },
        logout,
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save backup settings");
      }
    },
    [logout, token],
  );

  const resolveFlowPositionFromClient = useCallback(
    (clientX?: number, clientY?: number): NodeCenterPosition => {
      if (reactFlowInstance && clientX !== undefined && clientY !== undefined) {
        return reactFlowInstance.screenToFlowPosition({
          x: clientX,
          y: clientY,
        });
      }

      const rect = mapFrameRef.current?.getBoundingClientRect();
      if (reactFlowInstance && rect) {
        return reactFlowInstance.screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }

      return {
        x: (420 - flowViewport.x) / Math.max(flowViewport.zoom, 0.001),
        y: (280 - flowViewport.y) / Math.max(flowViewport.zoom, 0.001),
      };
    },
    [flowViewport.x, flowViewport.y, flowViewport.zoom, reactFlowInstance],
  );

  const openCreateDialog = useCallback(
    (
      kind: CreateEntityKind,
      position = pendingCreationPosition ?? resolveFlowPositionFromClient(),
    ) => {
      setPendingCreationPosition(position);

      if (kind === "project") {
        setCreateProjectOpen(true);
        return;
      }

      if (kind === "database") {
        setCreateDatabaseOpen(true);
        return;
      }

      if (kind === "backup") {
        setBackupCopySourceId("");
        setBackupForm(createDefaultBackupSettings(0));
        setCreateBackupOpen(true);
        return;
      }

      setAutomationForm({
        automationEnabled: true,
        automationFrequency: "daily",
      });
      setCreateAutomationOpen(true);
    },
    [pendingCreationPosition, resolveFlowPositionFromClient],
  );

  const fetchContainers = useCallback(async () => {
    try {
      setLoading(true);
      const [
        containersResponse,
        projectsResponse,
        usersResponse,
        proxyResponse,
        databasesResponse,
        serviceCardsResponse,
      ] = await Promise.all([
        authFetch("/api/docker/containers", token, {}, logout),
        authFetch("/api/projects", token, {}, logout),
        user?.isAdmin
          ? authFetch("/api/auth/users", token, {}, logout)
          : Promise.resolve(null),
        authFetch("/api/docker/proxy", token, {}, logout),
        authFetch("/api/databases", token, {}, logout),
        canAccessServer && canManageBackups
          ? authFetch("/api/topology/service-cards", token, {}, logout)
          : Promise.resolve(null),
      ]);

      if (!containersResponse.ok) throw new Error("Failed to fetch containers");
      const rawContainersPayload = await containersResponse.json();
      const rawContainerData: ContainerInfo[] = Array.isArray(
        rawContainersPayload,
      )
        ? rawContainersPayload
        : [];
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

      let databasesData: DatabaseInfo[] = [];
      let nextBackupSettingsByDatabaseId: Record<number, BackupSettingsInfo> =
        {};

      if (databasesResponse.ok) {
        databasesData = await databasesResponse.json();
        setDatabases(databasesData || []);

        if (canManageBackups) {
          const backupSettingsEntries = await Promise.all(
            (databasesData || []).map(async (database) => {
              const response = await authFetch(
                `/api/databases/${database.id}/backups/settings`,
                token,
                {},
                logout,
              );

              if (!response.ok) {
                return null;
              }

              const settings: BackupSettingsInfo = await response.json();
              return [database.id, settings] as const;
            }),
          );

          nextBackupSettingsByDatabaseId = backupSettingsEntries.reduce(
            (acc, entry) => {
              if (entry) {
                acc[entry[0]] = entry[1];
              }
              return acc;
            },
            {} as Record<number, BackupSettingsInfo>,
          );
          setBackupSettingsByDatabaseId(nextBackupSettingsByDatabaseId);
        } else {
          setBackupSettingsByDatabaseId({});
        }
      } else {
        setDatabases([]);
        setBackupSettingsByDatabaseId({});
      }

      if (serviceCardsResponse?.ok) {
        const rawServiceCards =
          (await serviceCardsResponse.json()) as Partial<ServiceCardsPayload>;
        const normalizedRawServiceCards =
          normalizeServiceCardsPayload(rawServiceCards);
        const nextServiceCards = normalizeStoredServiceCards(
          normalizedRawServiceCards,
          nextBackupSettingsByDatabaseId,
          databasesData,
        );
        const rawSnapshot = serializeServiceCardsPayload(
          normalizedRawServiceCards,
        );

        if (rawSnapshot !== lastServiceCardsSnapshotRef.current) {
          setBackupCards(nextServiceCards.backupCards);
          setAutomationCards(nextServiceCards.automationCards);
          lastServiceCardsSnapshotRef.current = rawSnapshot;
        }
        setServiceCardsHydrated(true);
      } else if (!canAccessServer || !canManageBackups) {
        const emptyServiceCards = {
          backupCards: [],
          automationCards: [],
        };
        setBackupCards(emptyServiceCards.backupCards);
        setAutomationCards(emptyServiceCards.automationCards);
        lastServiceCardsSnapshotRef.current =
          serializeServiceCardsPayload(emptyServiceCards);
        setServiceCardsHydrated(true);
      } else {
        throw new Error("Failed to fetch service cards");
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
  }, [canAccessServer, canManageBackups, token, logout, user?.isAdmin]);

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 30000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

  const refreshTopologyAndShared = useCallback(async () => {
    await Promise.all([
      fetchContainers(),
      refreshDatabases(),
      refreshProjects(),
    ]);
  }, [fetchContainers, refreshDatabases, refreshProjects]);

  const handleProjectCreated = useCallback(
    async (project?: { id: number; name: string }) => {
      if (project?.name && pendingCreationPosition) {
        setNodePlacement(`project:${project.name}`, pendingCreationPosition);
      }
      setPendingCreationPosition(null);
      await refreshTopologyAndShared();
    },
    [pendingCreationPosition, refreshTopologyAndShared, setNodePlacement],
  );

  const handleDatabaseCreated = useCallback(
    async (database?: { containerId?: string }) => {
      if (database?.containerId && pendingCreationPosition) {
        setNodePlacement(
          `container:${database.containerId}`,
          pendingCreationPosition,
        );
      }
      setPendingCreationPosition(null);
      await refreshTopologyAndShared();
    },
    [pendingCreationPosition, refreshTopologyAndShared, setNodePlacement],
  );

  const applyBackupCardToDatabase = useCallback(
    async (backupCard: BackupCardInfo, databaseId: number) => {
      const response = await authFetch(
        `/api/topology/backup-cards/${backupCard.id}/apply`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ databaseId }),
        },
        logout,
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to apply backup settings");
      }
    },
    [logout, token],
  );

  const applyAutomationCardToDatabase = useCallback(
    async (automationCard: AutomationCardInfo, databaseId: number) => {
      const existingSettings =
        backupSettingsByDatabaseId[databaseId] ||
        createDefaultBackupSettings(databaseId);

      if (!existingSettings.enabled) {
        throw new Error("Create or attach a backup card first");
      }

      await saveBackupSettingsForDatabase(databaseId, {
        ...existingSettings,
        database_id: databaseId,
        enabled: true,
        automation_enabled: automationCard.automation_enabled,
        automation_frequency: automationCard.automation_frequency,
      });
    },
    [backupSettingsByDatabaseId, saveBackupSettingsForDatabase],
  );

  const handleBackupSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      setBackupSubmitting(true);
      try {
        const newCardId = createId("backup-card");
        const nextLabel = `Backup Target ${backupCards.length + 1}`;
        const response = await authFetch(
          "/api/topology/backup-cards",
          token,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: newCardId,
              label: nextLabel,
              config: {
                ...backupForm,
                database_id: 0,
                enabled: true,
              },
              sourceDatabaseId: backupCopySourceId
                ? Number.parseInt(backupCopySourceId, 10)
                : 0,
            }),
          },
          logout,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to create backup target");
        }

        setBackupCards((prev) => [...prev, data as BackupCardInfo]);

        if (pendingCreationPosition) {
          setNodePlacement(`backup-card:${newCardId}`, pendingCreationPosition);
        }

        setCreateBackupOpen(false);
        setPendingCreationPosition(null);
        setBackupCopySourceId("");
        setBackupForm(createDefaultBackupSettings(0));
        toast.success("Backup target created");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create backup target",
        );
      } finally {
        setBackupSubmitting(false);
      }
    },
    [
      backupCards.length,
      backupCopySourceId,
      backupForm,
      logout,
      pendingCreationPosition,
      setNodePlacement,
      token,
    ],
  );

  const handleAutomationSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      setAutomationSubmitting(true);
      try {
        const newCardId = createId("automation-card");
        setAutomationCards((prev) => [
          ...prev,
          {
            id: newCardId,
            label: `Backup Automation ${prev.length + 1}`,
            automation_enabled: automationForm.automationEnabled,
            automation_frequency: automationForm.automationFrequency,
            databaseId: null,
            backupCardId: null,
          },
        ]);

        if (pendingCreationPosition) {
          setNodePlacement(
            `automation-card:${newCardId}`,
            pendingCreationPosition,
          );
        }

        setCreateAutomationOpen(false);
        setPendingCreationPosition(null);
        toast.success("Backup automation created");
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to create backup automation",
        );
      } finally {
        setAutomationSubmitting(false);
      }
    },
    [automationForm, pendingCreationPosition, setNodePlacement],
  );

  const removeServiceCardsForDatabases = useCallback(
    (databaseIds: number[]) => {
      if (databaseIds.length === 0) {
        return [];
      }

      const databaseIdSet = new Set(databaseIds);
      const removedBackupIds = backupCards
        .filter(
          (card) =>
            card.databaseId != null && databaseIdSet.has(card.databaseId),
        )
        .map((card) => card.id);
      const removedBackupIdSet = new Set(removedBackupIds);
      const removedNodeIds = [
        ...removedBackupIds.map((id) => `backup-card:${id}`),
        ...automationCards
          .filter(
            (card) =>
              (card.databaseId != null && databaseIdSet.has(card.databaseId)) ||
              (card.backupCardId != null &&
                removedBackupIdSet.has(card.backupCardId)),
          )
          .map((card) => `automation-card:${card.id}`),
      ];

      setBackupCards((prev) =>
        prev.filter(
          (card) =>
            !(card.databaseId != null && databaseIdSet.has(card.databaseId)),
        ),
      );
      setAutomationCards((prev) =>
        prev.filter(
          (card) =>
            !(
              (card.databaseId != null && databaseIdSet.has(card.databaseId)) ||
              (card.backupCardId != null &&
                removedBackupIdSet.has(card.backupCardId))
            ),
        ),
      );

      return removedNodeIds;
    },
    [automationCards, backupCards],
  );

  const visibleDatabaseIds = useMemo(
    () => new Set(databases.map((database) => database.id)),
    [databases],
  );
  const persistedBackupCardIds = useMemo(
    () => new Set(backupCards.map((card) => card.id)),
    [backupCards],
  );
  const persistedAutomationCardIds = useMemo(
    () => new Set(automationCards.map((card) => card.id)),
    [automationCards],
  );
  const effectiveBackupCards = useMemo(
    () =>
      deriveEffectiveBackupCards(
        backupCards,
        backupSettingsByDatabaseId,
        databases,
      ),
    [backupCards, backupSettingsByDatabaseId, databases],
  );
  const effectiveAutomationCards = useMemo(
    () =>
      deriveEffectiveAutomationCards(
        automationCards,
        effectiveBackupCards,
        backupSettingsByDatabaseId,
        databases,
      ),
    [
      automationCards,
      effectiveBackupCards,
      backupSettingsByDatabaseId,
      databases,
    ],
  );

  const requestNodeDeletion = useCallback(
    (node: GraphNode) => {
      if (node.kind === "project" && node.label.toLowerCase() !== "baseful") {
        const project = Object.values(projectsById).find(
          (entry) => entry.name.toLowerCase() === node.label.toLowerCase(),
        );
        const connectedDatabaseCount = project
          ? databases.filter((database) => database.projectId === project.id)
              .length
          : 0;
        setPendingNodeDeletion({
          node,
          title: `Delete ${node.label}?`,
          description:
            connectedDatabaseCount > 0
              ? `This will permanently delete the project and ${connectedDatabaseCount} connected database${connectedDatabaseCount === 1 ? "" : "s"}.`
              : "This will permanently delete the project.",
          confirmText: "Delete Project",
        });
        return;
      }

      if (node.kind === "container" && node.databaseId) {
        setPendingNodeDeletion({
          node,
          title: `Delete ${node.label}?`,
          description:
            "This will permanently delete the database container and remove it from the map.",
          confirmText: "Delete Database",
        });
        return;
      }

      if (node.kind === "backup") {
        setPendingNodeDeletion({
          node,
          title: `Delete ${node.label}?`,
          description:
            node.databaseId != null
              ? "This will remove the backup target card and clear the connected database backup configuration."
              : "This will remove the backup target card from the map.",
          confirmText: "Delete Backup Target",
        });
        return;
      }

      if (node.kind === "automation") {
        setPendingNodeDeletion({
          node,
          title: `Delete ${node.label}?`,
          description:
            node.databaseId != null
              ? "This will remove the backup automation card and disable automation for the connected backup target."
              : "This will remove the backup automation card from the map.",
          confirmText: "Delete Automation",
        });
      }
    },
    [databases, projectsById],
  );

  const confirmNodeDeletion = useCallback(async () => {
    if (!pendingNodeDeletion) {
      return;
    }

    const node = pendingNodeDeletion.node;
    setNodeDeletionLoading(true);
    try {
      if (node.kind === "project") {
        const project = Object.values(projectsById).find(
          (entry) => entry.name.toLowerCase() === node.label.toLowerCase(),
        );
        if (!project) {
          throw new Error("Project could not be resolved");
        }

        const projectDatabaseIds = databases
          .filter((database) => database.projectId === project.id)
          .map((database) => database.id);
        const response = await authFetch(
          `/api/projects/${project.id}`,
          token,
          { method: "DELETE" },
          logout,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to delete project");
        }

        const removedNodeIds =
          removeServiceCardsForDatabases(projectDatabaseIds);
        clearNodePlacements([node.id, ...removedNodeIds]);
        await refreshTopologyAndShared();
        toast.success("Project deleted");
      } else if (node.kind === "container" && node.databaseId) {
        const response = await authFetch(
          `/api/databases/${node.databaseId}/delete`,
          token,
          { method: "POST" },
          logout,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to delete database");
        }

        const removedNodeIds = removeServiceCardsForDatabases([
          node.databaseId,
        ]);
        clearNodePlacements([node.id, ...removedNodeIds]);
        await refreshTopologyAndShared();
        toast.success("Database deleted");
      } else if (node.kind === "backup") {
        const backupCardId = node.id.replace("backup-card:", "");
        const backupCard = effectiveBackupCards.find(
          (card) => card.id === backupCardId,
        );
        if (!backupCard) {
          throw new Error("Backup card could not be resolved");
        }
        const linkedAutomationIds = effectiveAutomationCards
          .filter(
            (card) =>
              card.backupCardId === backupCardId ||
              (backupCard.databaseId != null &&
                card.databaseId === backupCard.databaseId),
          )
          .map((card) => card.id);
        const isPersistedBackupCard = persistedBackupCardIds.has(backupCardId);

        if (backupCard.databaseId != null) {
          await saveBackupSettingsForDatabase(backupCard.databaseId, {
            ...createDefaultBackupSettings(backupCard.databaseId),
            enabled: false,
            automation_enabled: false,
          });
        }

        if (isPersistedBackupCard) {
          const deleteResponse = await authFetch(
            `/api/topology/backup-cards/${backupCardId}`,
            token,
            { method: "DELETE" },
            logout,
          );
          const deleteData = await deleteResponse.json().catch(() => ({}));
          if (!deleteResponse.ok && deleteResponse.status !== 404) {
            throw new Error(
              deleteData?.error || "Failed to delete backup card",
            );
          }
        }

        const nextBackupCards = isPersistedBackupCard
          ? backupCards.filter((card) => card.id !== backupCardId)
          : backupCards;
        const nextAutomationCards = automationCards.filter(
          (card) =>
            card.backupCardId !== backupCardId &&
            (backupCard.databaseId == null ||
              card.databaseId !== backupCard.databaseId),
        );
        if (isPersistedBackupCard) {
          setBackupCards(nextBackupCards);
        }
        if (nextAutomationCards.length !== automationCards.length) {
          setAutomationCards(nextAutomationCards);
        }
        if (
          isPersistedBackupCard ||
          nextAutomationCards.length !== automationCards.length
        ) {
          await persistServiceCards({
            backupCards: nextBackupCards,
            automationCards: nextAutomationCards,
          });
        }
        clearNodePlacements([
          node.id,
          ...linkedAutomationIds.map((id) => `automation-card:${id}`),
        ]);
        await refreshTopologyAndShared();
        toast.success("Backup target deleted");
      } else if (node.kind === "automation") {
        const automationCardId = node.id.replace("automation-card:", "");
        const automationCard = effectiveAutomationCards.find(
          (card) => card.id === automationCardId,
        );
        if (!automationCard) {
          throw new Error("Automation card could not be resolved");
        }
        const isPersistedAutomationCard =
          persistedAutomationCardIds.has(automationCardId);

        if (automationCard.databaseId != null) {
          const existingSettings =
            backupSettingsByDatabaseId[automationCard.databaseId] ||
            createDefaultBackupSettings(automationCard.databaseId);
          await saveBackupSettingsForDatabase(automationCard.databaseId, {
            ...existingSettings,
            database_id: automationCard.databaseId,
            automation_enabled: false,
          });
        }

        if (isPersistedAutomationCard) {
          const nextAutomationCards = automationCards.filter(
            (card) => card.id !== automationCardId,
          );
          setAutomationCards(nextAutomationCards);
          await persistServiceCards({
            backupCards,
            automationCards: nextAutomationCards,
          });
        }
        clearNodePlacements([node.id]);
        await refreshTopologyAndShared();
        toast.success("Backup automation deleted");
      }

      setPendingNodeDeletion(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete card",
      );
    } finally {
      setNodeDeletionLoading(false);
    }
  }, [
    automationCards,
    backupCards,
    backupSettingsByDatabaseId,
    clearNodePlacements,
    databases,
    effectiveAutomationCards,
    effectiveBackupCards,
    logout,
    persistedAutomationCardIds,
    persistedBackupCardIds,
    pendingNodeDeletion,
    persistServiceCards,
    projectsById,
    removeServiceCardsForDatabases,
    refreshTopologyAndShared,
    saveBackupSettingsForDatabase,
    token,
  ]);

  const confirmBackupAssignment = useCallback(async () => {
    if (!pendingBackupAssignment) {
      return;
    }

    const backupCard = effectiveBackupCards.find(
      (card) => card.id === pendingBackupAssignment.backupCardId,
    );
    if (!backupCard) {
      setPendingBackupAssignment(null);
      return;
    }

    setBackupAssignmentLoading(true);
    try {
      if (
        backupCard.databaseId != null &&
        backupCard.databaseId !== pendingBackupAssignment.databaseId
      ) {
        throw new Error(
          "This backup card is already attached to another database. Delete it or create another backup card instead of reusing it.",
        );
      }

      const existingTargetBackupCard = effectiveBackupCards.find(
        (card) =>
          card.id !== backupCard.id &&
          card.databaseId === pendingBackupAssignment.databaseId,
      );
      if (existingTargetBackupCard) {
        throw new Error(
          "This database already has a backup card attached. Remove the existing backup card first.",
        );
      }
      if (!persistedBackupCardIds.has(backupCard.id)) {
        throw new Error(
          "This backup card is already driven by another database. Create a new backup service or copy from an existing database instead of reusing an attached card.",
        );
      }

      await applyBackupCardToDatabase(
        backupCard,
        pendingBackupAssignment.databaseId,
      );

      const nextBackupCards = backupCards.map((card) =>
        card.id === backupCard.id
          ? { ...card, databaseId: pendingBackupAssignment.databaseId }
          : card,
      );
      setBackupCards(nextBackupCards);

      const linkedAutomations = automationCards.filter(
        (card) =>
          card.backupCardId === backupCard.id ||
          card.databaseId === pendingBackupAssignment.databaseId,
      );
      let nextAutomationCards = automationCards.map((card) =>
        linkedAutomations.some((linkedCard) => linkedCard.id === card.id)
          ? {
              ...card,
              databaseId: pendingBackupAssignment.databaseId,
            }
          : card,
      );
      for (const automationCard of linkedAutomations) {
        await applyAutomationCardToDatabase(
          automationCard,
          pendingBackupAssignment.databaseId,
        );
      }
      setAutomationCards(nextAutomationCards);
      await persistServiceCards({
        backupCards: nextBackupCards,
        automationCards: nextAutomationCards,
      });

      setPendingBackupAssignment(null);
      toast.success(
        `Backup config applied to ${pendingBackupAssignment.databaseName}`,
      );
      await refreshTopologyAndShared();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to apply backup config",
      );
    } finally {
      setBackupAssignmentLoading(false);
    }
  }, [
    applyAutomationCardToDatabase,
    applyBackupCardToDatabase,
    automationCards,
    backupCards,
    effectiveBackupCards,
    pendingBackupAssignment,
    persistedBackupCardIds,
    persistServiceCards,
    refreshTopologyAndShared,
  ]);

  const handleContainerAction = useCallback(
    async (
      container: ContainerInfo,
      action: "start" | "stop" | "restart",
      databaseId?: number,
    ) => {
      if (container.id === BASEFUL_SIMULATED_ID) return;
      setContainerActionLoading((prev) => ({
        ...prev,
        [container.id]: action,
      }));
      try {
        const response = await authFetch(
          databaseId
            ? `/api/databases/${databaseId}/${action}`
            : `/api/docker/containers/${container.id}/${action}`,
          token,
          { method: "POST" },
          logout,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || `Failed to ${action} container`);
        }
        toast.success(
          databaseId
            ? action === "restart"
              ? "Database restarted"
              : `Database ${action === "start" ? "started" : "stopped"}`
            : action === "restart"
              ? "Container restarted"
              : `Container ${action === "start" ? "started" : "stopped"}`,
        );
        await refreshTopologyAndShared();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed");
      } finally {
        setContainerActionLoading((prev) => ({
          ...prev,
          [container.id]: undefined,
        }));
      }
    },
    [logout, refreshTopologyAndShared, token],
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
      pendingContainerAction.databaseId,
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

  const visibleBackupCards = useMemo(
    () =>
      effectiveBackupCards.filter(
        (card) =>
          card.databaseId == null || visibleDatabaseIds.has(card.databaseId),
      ),
    [effectiveBackupCards, visibleDatabaseIds],
  );
  const visibleBackupCardIds = useMemo(
    () => new Set(visibleBackupCards.map((card) => card.id)),
    [visibleBackupCards],
  );
  const visibleAutomationCards = useMemo(
    () =>
      effectiveAutomationCards.filter((card) => {
        if (card.backupCardId) {
          return visibleBackupCardIds.has(card.backupCardId);
        }
        if (card.databaseId != null) {
          return visibleDatabaseIds.has(card.databaseId);
        }
        return true;
      }),
    [effectiveAutomationCards, visibleBackupCardIds, visibleDatabaseIds],
  );

  const topology = useMemo(
    () =>
      buildTopology(
        containers,
        projectsById,
        allUsers,
        proxyInfo,
        databases,
        visibleBackupCards,
        visibleAutomationCards,
      ),
    [
      containers,
      projectsById,
      allUsers,
      proxyInfo,
      databases,
      visibleBackupCards,
      visibleAutomationCards,
    ],
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

  const sortedDatabases = useMemo(
    () => [...databases].sort((a, b) => a.name.localeCompare(b.name)),
    [databases],
  );
  const copyableBackupDatabases = useMemo(
    () =>
      sortedDatabases.filter(
        (database) => backupSettingsByDatabaseId[database.id]?.enabled,
      ),
    [backupSettingsByDatabaseId, sortedDatabases],
  );

  const fitMapToViewport = useCallback(() => {
    if (!reactFlowInstance) return;
    void reactFlowInstance.fitView({
      padding: 0.18,
      duration: 400,
      minZoom: 0.85,
      maxZoom: MAX_SCALE,
    });
  }, [reactFlowInstance]);

  const resetNodePlacements = useCallback(() => {
    setCustomNodePositions({});
    persistNodePositions({});
    toast.success("Card placements reset");
  }, []);

  const resetMapView = useCallback(() => {
    clearStoredViewport(viewportStorageKey);
    setHasStoredViewport(false);
    requestAnimationFrame(() => {
      fitMapToViewport();
    });
  }, [fitMapToViewport, viewportStorageKey]);

  useEffect(() => {
    if (
      !reactFlowInstance ||
      mapInitializedRef.current ||
      topology.nodes.length === 0 ||
      !viewportHydrated
    ) {
      return;
    }
    if (!hasStoredViewport) {
      fitMapToViewport();
    }
    mapInitializedRef.current = true;
  }, [
    fitMapToViewport,
    hasStoredViewport,
    reactFlowInstance,
    topology.nodes.length,
    viewportHydrated,
  ]);

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

  const baseFlowNodes = useMemo<TopologyFlowNode[]>(
    () =>
      topology.nodes.map((node) => {
        const isContainer = node.kind === "container";
        const containerMatch =
          isContainer && node.containerId
            ? containers.find((c) => c.id === node.containerId)
            : undefined;
        const { width, height } = getNodeCardDimensions(node);
        const customPosition = customNodePositions[node.id];
        const nodeCenter = customPosition || { x: node.x, y: node.y };
        const hasIncoming = topology.edges.some(
          (edge) => edge.target === node.id,
        );
        const hasOutgoing = topology.edges.some(
          (edge) => edge.source === node.id,
        );
        const hasIncomingRoute = topology.edges.some(
          (edge) => edge.target === node.id && edge.kind === "route",
        );
        const hasOutgoingRoute = topology.edges.some(
          (edge) => edge.source === node.id && edge.kind === "route",
        );
        const canAcceptIncomingConnection =
          (node.kind === "container" && Boolean(node.databaseId)) ||
          node.kind === "backup";
        const canStartOutgoingConnection =
          node.kind === "project" ||
          (node.kind === "container" && Boolean(node.databaseId)) ||
          node.kind === "automation";
        const canDelete =
          (node.kind === "project" &&
            node.label.toLowerCase() !== "baseful" &&
            hasPermission("create_projects")) ||
          (node.kind === "container" &&
            Boolean(node.databaseId) &&
            canDeleteDatabases) ||
          ((node.kind === "backup" || node.kind === "automation") &&
            canManageBackups);

        return {
          id: node.id,
          type: "topologyNode",
          position: {
            x: nodeCenter.x - width / 2,
            y: nodeCenter.y - height / 2,
          },
          draggable: true,
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
            hasIncomingRoute,
            hasOutgoingRoute,
            canAttachProjectConnection: canStartOutgoingConnection,
            canAcceptIncomingConnection,
            canStartOutgoingConnection,
            canDelete,
            canOpenBackupPage: canManageBackups,
            containerMatch,
            actionLoading: containerActionLoading[node.containerId || node.id],
            isAdmin: Boolean(user?.isAdmin),
            onSelect: setSelectedNodeId,
            onOpen: handleNodeOpen,
            onOpenLogs: (container) => {
              void openContainerLogs(container);
            },
            onContainerAction: (container, action, databaseId) => {
              setPendingContainerAction({ container, action, databaseId });
            },
            onOpenProxyLogs: () => {
              void openProxyLogs();
            },
            onOpenBackupPage: (databaseId) => {
              navigate(`/db/${databaseId}/backup`);
            },
            onRequestDelete: requestNodeDeletion,
          },
        };
      }),
    [
      topology.nodes,
      topology.edges,
      containers,
      customNodePositions,
      selectedNodeId,
      highlightedGraph.nodeIds,
      hasPermission,
      canDeleteDatabases,
      canManageBackups,
      containerActionLoading,
      user?.isAdmin,
      handleNodeOpen,
      openContainerLogs,
      openProxyLogs,
      navigate,
      requestNodeDeletion,
    ],
  );
  const [flowNodes, setFlowNodes] = useState<TopologyFlowNode[]>(baseFlowNodes);

  useEffect(() => {
    setFlowNodes(baseFlowNodes);
  }, [baseFlowNodes]);

  const flowEdges = useMemo<TopologyFlowEdge[]>(
    () =>
      topology.edges.map((edge) => {
        const isRelated = highlightedGraph.edgeIds.has(edge.id);
        const isRoute = edge.kind === "route";
        const isBackupEdge = edge.kind === "backup";
        const neutralStroke = isBackupEdge
          ? isRelated
            ? "#38bdf8"
            : "#0f766e"
          : isRelated
            ? "#6b7280"
            : "#3f3f46";
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
          reconnectable: edge.kind === "belongs" || edge.kind === "backup",
          interactionWidth:
            edge.kind === "belongs" || edge.kind === "backup" ? 24 : 0,
          markerEnd: undefined,
          style: {
            stroke: neutralStroke,
            strokeOpacity: isRelated ? 1 : 0.4,
            strokeWidth: isBackupEdge
              ? isRelated
                ? 1.8
                : 1.3
              : isRoute
                ? isRelated
                  ? 1.6
                  : 1.2
                : isRelated
                  ? 2
                  : 1.5,
            strokeDasharray: isBackupEdge ? "3 5" : isRoute ? "4 6" : undefined,
          },
        };
      }),
    [highlightedGraph.edgeIds, topology.edges],
  );

  const nodeTypes = useMemo(() => ({ topologyNode: TopologyNodeCard }), []);
  const edgeTypes = useMemo(() => ({ proxyRoute: ProxyRouteEdge }), []);
  const handleNodesChange = useCallback(
    (changes: NodeChange<TopologyFlowNode>[]) => {
      setFlowNodes((nodes) => applyNodeChanges(changes, nodes));
    },
    [],
  );

  const isValidMapConnection = useCallback(
    (connectionLike: Connection | TopologyFlowEdge) => {
      const connection: Connection = {
        source: connectionLike.source,
        target: connectionLike.target,
        sourceHandle: connectionLike.sourceHandle ?? null,
        targetHandle: connectionLike.targetHandle ?? null,
      };
      const sourceNode = flowNodes.find(
        (node) => node.id === connection.source,
      );
      const targetNode = flowNodes.find(
        (node) => node.id === connection.target,
      );
      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
        return false;
      }

      const sourceGraphNode = sourceNode.data.node;
      const targetGraphNode = targetNode.data.node;

      const sourceIsProject = sourceGraphNode.kind === "project";
      const targetIsProject = targetGraphNode.kind === "project";
      const sourceIsDatabaseContainer =
        sourceGraphNode.kind === "container" &&
        Boolean(sourceGraphNode.databaseId);
      const targetIsDatabaseContainer =
        targetGraphNode.kind === "container" &&
        Boolean(targetGraphNode.databaseId);
      const sourceIsBackup = sourceGraphNode.kind === "backup";
      const targetIsBackup = targetGraphNode.kind === "backup";
      const sourceIsAutomation = sourceGraphNode.kind === "automation";
      const targetIsAutomation = targetGraphNode.kind === "automation";
      const automationNode = sourceIsAutomation
        ? sourceGraphNode
        : targetIsAutomation
          ? targetGraphNode
          : null;
      const backupNode = sourceIsBackup
        ? sourceGraphNode
        : targetIsBackup
          ? targetGraphNode
          : null;

      if (automationNode && backupNode) {
        const backupCardId = backupNode.id.replace("backup-card:", "");
        const automationCardId = automationNode.id.replace(
          "automation-card:",
          "",
        );
        const backupAlreadyLinked = visibleAutomationCards.some(
          (card) =>
            card.backupCardId === backupCardId && card.id !== automationCardId,
        );
        if (backupAlreadyLinked) {
          return false;
        }
      }

      return (
        (sourceIsProject && targetIsDatabaseContainer) ||
        (targetIsProject && sourceIsDatabaseContainer) ||
        (sourceIsBackup && targetIsDatabaseContainer) ||
        (targetIsBackup && sourceIsDatabaseContainer) ||
        (sourceIsAutomation && targetIsBackup) ||
        (targetIsAutomation && sourceIsBackup)
      );
    },
    [flowNodes, visibleAutomationCards],
  );

  const handleMapConnect = useCallback(
    async (connection: Connection) => {
      if (!isValidMapConnection(connection)) {
        return;
      }

      const sourceNode = flowNodes.find(
        (node) => node.id === connection.source,
      );
      const targetNode = flowNodes.find(
        (node) => node.id === connection.target,
      );
      if (!sourceNode || !targetNode) {
        return;
      }

      const sourceGraphNode = sourceNode.data.node;
      const targetGraphNode = targetNode.data.node;

      const projectNode =
        sourceGraphNode.kind === "project"
          ? sourceGraphNode
          : targetGraphNode.kind === "project"
            ? targetGraphNode
            : null;
      const databaseNode =
        sourceGraphNode.kind === "container" && sourceGraphNode.databaseId
          ? sourceGraphNode
          : targetGraphNode.kind === "container" && targetGraphNode.databaseId
            ? targetGraphNode
            : null;
      const backupNode =
        sourceGraphNode.kind === "backup"
          ? sourceGraphNode
          : targetGraphNode.kind === "backup"
            ? targetGraphNode
            : null;
      const automationNode =
        sourceGraphNode.kind === "automation"
          ? sourceGraphNode
          : targetGraphNode.kind === "automation"
            ? targetGraphNode
            : null;

      try {
        if (projectNode && databaseNode?.databaseId) {
          const project = Object.values(projectsById).find(
            (entry) =>
              entry.name.toLowerCase() === projectNode.label.toLowerCase(),
          );

          if (!project) {
            throw new Error("Unable to resolve target project");
          }

          const response = await authFetch(
            `/api/databases/${databaseNode.databaseId}/project`,
            token,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: project.id }),
            },
            logout,
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || "Failed to update project");
          }

          toast.success(`Moved ${databaseNode.label} to ${project.name}`);
          await refreshTopologyAndShared();
          return;
        }

        if (backupNode && databaseNode?.databaseId) {
          const backupCardId = backupNode.id.replace("backup-card:", "");
          setPendingBackupAssignment({
            backupCardId,
            databaseId: databaseNode.databaseId,
            databaseName: databaseNode.label,
          });
          return;
        }

        if (automationNode && backupNode) {
          const automationCardId = automationNode.id.replace(
            "automation-card:",
            "",
          );
          const backupCardId = backupNode.id.replace("backup-card:", "");
          const backupAlreadyLinked = effectiveAutomationCards.some(
            (card) =>
              card.backupCardId === backupCardId &&
              card.id !== automationCardId,
          );
          if (backupAlreadyLinked) {
            throw new Error(
              "This backup target already has an automation attached",
            );
          }
          const currentAutomationCard = effectiveAutomationCards.find(
            (card) => card.id === automationCardId,
          );
          if (!persistedAutomationCardIds.has(automationCardId)) {
            throw new Error(
              "This automation card is already managed by a connected database. Remove it from that database before reusing it.",
            );
          }
          if (
            currentAutomationCard?.backupCardId &&
            currentAutomationCard.backupCardId !== backupCardId
          ) {
            throw new Error(
              "This automation card is already attached to another backup target. Delete it or create a new automation card instead of reusing it.",
            );
          }
          const backupCard = effectiveBackupCards.find(
            (card) => card.id === backupCardId,
          );
          if (backupCard?.databaseId) {
            const databaseAlreadyAutomated = effectiveAutomationCards.some(
              (card) =>
                card.id !== automationCardId &&
                card.databaseId === backupCard.databaseId,
            );
            if (databaseAlreadyAutomated) {
              throw new Error(
                "This database already has an automation card attached. Remove the existing automation card first.",
              );
            }
          }
          const nextAutomationCards = automationCards.map((card) =>
            card.id === automationCardId
              ? {
                  ...card,
                  backupCardId,
                  databaseId: backupCard?.databaseId ?? null,
                }
              : card,
          );
          setAutomationCards(nextAutomationCards);
          await persistServiceCards({
            backupCards,
            automationCards: nextAutomationCards,
          });
          if (backupCard?.databaseId) {
            const automationCard = nextAutomationCards.find(
              (card) => card.id === automationCardId,
            );
            if (automationCard) {
              await applyAutomationCardToDatabase(
                automationCard,
                backupCard.databaseId,
              );
              await refreshTopologyAndShared();
            }
          }
          toast.success("Automation linked to backup target");
          return;
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update connection",
        );
      }
    },
    [
      applyAutomationCardToDatabase,
      automationCards,
      backupCards,
      effectiveAutomationCards,
      effectiveBackupCards,
      flowNodes,
      isValidMapConnection,
      logout,
      persistedAutomationCardIds,
      persistServiceCards,
      projectsById,
      refreshTopologyAndShared,
      token,
    ],
  );

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
  ) =>
    !canExecContainers ? null : (
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

  const handleMapContextMenuCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setPendingCreationPosition(
        resolveFlowPositionFromClient(event.clientX, event.clientY),
      );
    },
    [resolveFlowPositionFromClient],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-row items-center gap-2 border-b border-border p-4 w-full">
        <h1 className="text-2xl font-medium text-neutral-100">Topology</h1>
      </div>

      <div className="px-0 pb-0 flex-1 flex flex-col min-h-0">
        {!viewportHydrated || (loading && containers.length === 0) ? (
          <div className="flex flex-1 min-h-105 items-center justify-center border border-white/[0.05] bg-card/30">
            <div className="flex flex-col items-center gap-3 text-center">
              <ArrowClockwiseIcon
                size={28}
                className="animate-spin text-neutral-400"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium text-neutral-200">
                  Loading topology
                </p>
                <p className="text-xs text-neutral-500">
                  Fetching containers, projects, and service cards.
                </p>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed rounded-lg border-red-500/20 bg-red-500/5">
            <p className="text-red-500 font-medium mb-2">
              Error connecting to Docker
            </p>
            <p className="text-sm text-neutral-400 max-w-md">{error}</p>
          </div>
        ) : topology.nodes.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed rounded-lg border-neutral-800">
            <CubeIcon size={48} className="text-neutral-700 mb-4" />
            <p className="text-neutral-300 font-medium mb-1">
              No Topology Items Found
            </p>
            <p className="text-sm text-neutral-500 max-w-md">
              No projects, containers, or services managed by Baseful were
              detected on this server.
            </p>
          </div>
        ) : (
          <div className="relative w-full flex-1 min-h-0">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  ref={mapFrameRef}
                  className="relative h-full w-full overflow-hidden bg-transparent"
                  onContextMenuCapture={handleMapContextMenuCapture}
                >
                  <ReactFlow<TopologyFlowNode, TopologyFlowEdge>
                    nodes={flowNodes}
                    edges={flowEdges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    defaultViewport={flowViewport}
                    onInit={(instance) => setReactFlowInstance(instance)}
                    onNodesChange={handleNodesChange}
                    onConnect={(connection) => {
                      void handleMapConnect(connection);
                    }}
                    onReconnect={(_oldEdge, newConnection) => {
                      void handleMapConnect(newConnection);
                    }}
                    isValidConnection={isValidMapConnection}
                    onPaneClick={() => setSelectedNodeId(null)}
                    onNodeClick={
                      ((_event, node) => {
                        setSelectedNodeId(node.id);
                      }) as NodeMouseHandler<TopologyFlowNode>
                    }
                    onNodeDragStop={(_event, node) => {
                      const topologyNode = node.data?.node;
                      if (!topologyNode) {
                        return;
                      }

                      const { width, height } =
                        getNodeCardDimensions(topologyNode);
                      setNodePlacement(node.id, {
                        x: node.position.x + width / 2,
                        y: node.position.y + height / 2,
                      });

                      if (topologyNode.kind !== "backup") {
                        return;
                      }

                      const dragRect = {
                        left: node.position.x,
                        right: node.position.x + width,
                        top: node.position.y,
                        bottom: node.position.y + height,
                      };
                      const overlappingDatabaseNode = flowNodes.find(
                        (candidate) => {
                          if (
                            candidate.id === node.id ||
                            candidate.data.node.kind !== "container" ||
                            !candidate.data.node.databaseId
                          ) {
                            return false;
                          }

                          const dimensions = getNodeCardDimensions(
                            candidate.data.node,
                          );
                          const candidateRect = {
                            left: candidate.position.x,
                            right: candidate.position.x + dimensions.width,
                            top: candidate.position.y,
                            bottom: candidate.position.y + dimensions.height,
                          };

                          return !(
                            dragRect.right < candidateRect.left ||
                            dragRect.left > candidateRect.right ||
                            dragRect.bottom < candidateRect.top ||
                            dragRect.top > candidateRect.bottom
                          );
                        },
                      );

                      if (overlappingDatabaseNode?.data.node.databaseId) {
                        setPendingBackupAssignment({
                          backupCardId: topologyNode.id.replace(
                            "backup-card:",
                            "",
                          ),
                          databaseId:
                            overlappingDatabaseNode.data.node.databaseId,
                          databaseName: overlappingDatabaseNode.data.node.label,
                        });
                      }
                    }}
                    onViewportChange={setFlowViewport}
                    minZoom={MIN_SCALE}
                    maxZoom={MAX_SCALE}
                    nodesDraggable
                    nodesConnectable
                    edgesReconnectable
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

                  <div className="absolute top-3 left-3 z-20 rounded-md border border-white/10 bg-card/95 px-3 py-2 text-xs text-neutral-400 shadow-sm backdrop-blur">
                    Right-click anywhere on the map to create a card. Drag cards
                    to store custom placements locally.
                  </div>

                  <div className="absolute top-3 right-3 z-20 flex items-center gap-2 text-sm text-neutral-300 bg-card border border-white/10 rounded-md pl-2 pr-1 py-1">
                    <span>{Math.round(flowViewport.zoom * 100)}%</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetNodePlacements}
                      className="h-7"
                    >
                      Reset Placement
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetMapView}
                      className="h-7"
                    >
                      Reset View
                    </Button>
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-60">
                <ContextMenuLabel>Create On Map</ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => openCreateDialog("project")}>
                  <FolderPlusIcon size={16} />
                  New Project
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => openCreateDialog("database")}
                  disabled={Object.keys(projectsById).length === 0}
                >
                  <DatabaseIcon size={16} />
                  New Database
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => openCreateDialog("backup")}
                  disabled={!canManageBackups}
                >
                  <HardDrivesIcon size={16} />
                  New Backup Service
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => openCreateDialog("automation")}
                  disabled={!canManageBackups}
                >
                  <ClockCounterClockwiseIcon size={16} />
                  New Automation Service
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <ManageProjectDialog
              open={manageProjectDialogOpen}
              onOpenChange={setManageProjectDialogOpen}
              project={selectedManageProject}
              onProjectUpdated={fetchContainers}
            />

            <CreateProjectDialog
              open={createProjectOpen}
              onOpenChange={(open) => {
                setCreateProjectOpen(open);
                if (!open) {
                  setPendingCreationPosition(null);
                }
              }}
              onProjectCreated={(project) => {
                void handleProjectCreated(project);
              }}
            />

            <CreateDatabaseDialog
              open={createDatabaseOpen}
              onOpenChange={(open) => {
                setCreateDatabaseOpen(open);
                if (!open) {
                  setPendingCreationPosition(null);
                }
              }}
              navigateOnCreate={false}
              hideProjectSelector
              allowProjectless
              startStopped
              onDatabaseCreated={(database) => {
                void handleDatabaseCreated(database);
              }}
            />

            <Dialog
              open={createBackupOpen}
              onOpenChange={(open) => {
                setCreateBackupOpen(open);
                if (!open) {
                  setPendingCreationPosition(null);
                }
              }}
            >
              <DialogContent className="p-0 gap-0 bg-card">
                <DialogHeader className="border-b border-border p-4">
                  <DialogTitle>Create Backup Service</DialogTitle>
                  <DialogDescription>
                    Create a reusable backup config card. Attach it to a
                    database later on the map.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleBackupSubmit} className="p-4 space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="backup-copy-source">
                      Copy From Existing Backup (optional)
                    </Label>
                    <Select
                      value={backupCopySourceId || "__scratch__"}
                      onValueChange={(value) => {
                        const nextValue = value === "__scratch__" ? "" : value;
                        setBackupCopySourceId(nextValue);
                        const databaseId = Number.parseInt(nextValue, 10);
                        const nextSettings = nextValue
                          ? backupSettingsByDatabaseId[databaseId] ||
                            createDefaultBackupSettings(0)
                          : createDefaultBackupSettings(0);
                        setBackupForm({
                          ...nextSettings,
                          database_id: 0,
                          enabled: true,
                          provider: nextSettings.provider || "s3",
                        });
                      }}
                    >
                      <SelectTrigger id="backup-copy-source">
                        <SelectValue placeholder="Start from scratch" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__scratch__">
                          Start from scratch
                        </SelectItem>
                        {copyableBackupDatabases.map((database) => (
                          <SelectItem
                            key={database.id}
                            value={String(database.id)}
                          >
                            {database.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="backup-endpoint">Endpoint</Label>
                    <Input
                      id="backup-endpoint"
                      placeholder="https://s3.amazonaws.com"
                      value={backupForm.endpoint}
                      onChange={(event) =>
                        setBackupForm((prev) => ({
                          ...prev,
                          endpoint: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="backup-region">Region</Label>
                      <Input
                        id="backup-region"
                        value={backupForm.region}
                        onChange={(event) =>
                          setBackupForm((prev) => ({
                            ...prev,
                            region: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="backup-bucket">Bucket</Label>
                      <Input
                        id="backup-bucket"
                        value={backupForm.bucket}
                        onChange={(event) =>
                          setBackupForm((prev) => ({
                            ...prev,
                            bucket: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="backup-access-key">Access Key</Label>
                      <Input
                        id="backup-access-key"
                        value={backupForm.access_key}
                        onChange={(event) =>
                          setBackupForm((prev) => ({
                            ...prev,
                            access_key: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="backup-secret-key">Secret Key</Label>
                      <Input
                        id="backup-secret-key"
                        type="password"
                        value={backupForm.secret_key}
                        onChange={(event) =>
                          setBackupForm((prev) => ({
                            ...prev,
                            secret_key: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="backup-path-prefix">Path Prefix</Label>
                    <Input
                      id="backup-path-prefix"
                      value={backupForm.path_prefix}
                      onChange={(event) =>
                        setBackupForm((prev) => ({
                          ...prev,
                          path_prefix: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="backup-encryption">Encryption</Label>
                        <p className="text-xs text-neutral-500">
                          Encrypt snapshots before upload.
                        </p>
                      </div>
                      <Switch
                        id="backup-encryption"
                        checked={backupForm.encryption_enabled}
                        onCheckedChange={(checked) =>
                          setBackupForm((prev) => ({
                            ...prev,
                            encryption_enabled: checked,
                          }))
                        }
                      />
                    </div>
                    {backupForm.encryption_enabled && (
                      <div className="grid gap-2">
                        <Label htmlFor="backup-public-key">
                          Encryption Public Key
                        </Label>
                        <Input
                          id="backup-public-key"
                          value={backupForm.encryption_public_key}
                          onChange={(event) =>
                            setBackupForm((prev) => ({
                              ...prev,
                              encryption_public_key: event.target.value,
                            }))
                          }
                          required={backupForm.encryption_enabled}
                        />
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateBackupOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={backupSubmitting}>
                      {backupSubmitting ? "Saving..." : "Create Backup Service"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog
              open={createAutomationOpen}
              onOpenChange={(open) => {
                setCreateAutomationOpen(open);
                if (!open) {
                  setPendingCreationPosition(null);
                }
              }}
            >
              <DialogContent className="p-0 gap-0 bg-card">
                <DialogHeader className="border-b border-border p-4">
                  <DialogTitle>Create Automation Service</DialogTitle>
                  <DialogDescription>
                    Create a reusable automation card. Attach it to a backup or
                    database later on the map.
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={handleAutomationSubmit}
                  className="p-4 space-y-4"
                >
                  <div className="rounded-lg border border-border p-3 bg-muted/20">
                    <p className="text-sm font-medium text-neutral-200">
                      Backup automation
                    </p>
                    <p className="text-xs text-neutral-500">
                      This card schedules a connected backup target. Direct
                      database links are not supported.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="automation-enabled">Automation</Label>
                      <p className="text-xs text-neutral-500">
                        Keep scheduled backups enabled after creation.
                      </p>
                    </div>
                    <Switch
                      id="automation-enabled"
                      checked={automationForm.automationEnabled}
                      onCheckedChange={(checked) =>
                        setAutomationForm((prev) => ({
                          ...prev,
                          automationEnabled: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="automation-frequency">Frequency</Label>
                    <Select
                      value={automationForm.automationFrequency}
                      onValueChange={(value) =>
                        setAutomationForm((prev) => ({
                          ...prev,
                          automationFrequency: value,
                        }))
                      }
                    >
                      <SelectTrigger id="automation-frequency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly">Every hour</SelectItem>
                        <SelectItem value="daily">Every day</SelectItem>
                        <SelectItem value="weekly">Every week</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateAutomationOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={automationSubmitting}>
                      {automationSubmitting
                        ? "Saving..."
                        : "Create Automation Service"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

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

            <ConfirmDialog
              open={Boolean(pendingBackupAssignment)}
              onOpenChange={(open) => {
                if (!open) {
                  setPendingBackupAssignment(null);
                }
              }}
              title="Apply backup config to database?"
              description={
                pendingBackupAssignment
                  ? `This will overwrite the backup configuration for "${pendingBackupAssignment.databaseName}" with the dragged backup card settings.`
                  : "This will overwrite the target database backup configuration."
              }
              onConfirm={() => void confirmBackupAssignment()}
              confirmText="Apply Backup Config"
              loading={backupAssignmentLoading}
            />

            <ConfirmDialog
              open={Boolean(pendingNodeDeletion)}
              onOpenChange={(open) => {
                if (!open) {
                  setPendingNodeDeletion(null);
                }
              }}
              title={pendingNodeDeletion?.title || "Delete item?"}
              description={
                pendingNodeDeletion?.description ||
                "This will permanently delete the selected item."
              }
              onConfirm={() => void confirmNodeDeletion()}
              confirmText={pendingNodeDeletion?.confirmText || "Delete"}
              confirmVariant="destructive"
              loading={nodeDeletionLoading}
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
