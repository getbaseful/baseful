import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CubeIcon,
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
import { FacehashSVG } from "@/components/FacehashSVG";

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

interface ProjectInfo {
  id: number;
  name: string;
  users?: { id: number; email: string; avatarUrl?: string }[];
}

type GraphKind = "project" | "service" | "container" | "network";

interface GraphNode {
  id: string;
  kind: GraphKind;
  label: string;
  detail: string;
  version?: string;
  color: string;
  containerId?: string;
  users?: { id: number; email: string; avatarUrl?: string }[];
  ip?: string;
  status?: string;
  count?: number;
  x: number;
  y: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "belongs" | "exposes";
}

interface MapViewport {
  x: number;
  y: number;
  scale: number;
}

const NAME_FALLBACK = "unnamed";
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.2;

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

function inferSubnet(ip: string): string {
  const parts = ip.split(".");
  if (parts.length !== 4) return "unknown-network";
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

// A Safari-safe Facehash component for inside SVG foreignObject.
// Replicates the Facehash aesthetic using pure SVG elements to avoid positioning bugs.
// A Safari-safe Facehash component for inside SVG foreignObject.
// Replicates the Facehash aesthetic using pure SVG elements to avoid positioning bugs.
function FacehashSVG({ name, size = 24 }: { name: string; size?: number }) {
  // Simple deterministic hash
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const absHash = Math.abs(hash);

  // Match the sidebars' bg colors
  const colorHexes = ["#ea580c", "#2563eb", "#65a30d", "#9333ea"];
  const bgColor = colorHexes[absHash % colorHexes.length];
  const initial = name.charAt(0).toUpperCase();

  // Face picking
  const eyePaths = [
    // RoundFace
    {
      viewBox: "0 0 63 15",
      paths: [
        "M14.4 7.2C14.4 11.1765 11.1765 14.4 7.2 14.4C3.22355 14.4 0 11.1765 0 7.2C0 3.22355 3.22355 0 7.2 0C11.1765 0 14.4 3.22355 14.4 7.2Z",
        "M62.4 7.2C62.4 11.1765 59.1765 14.4 55.2 14.4C51.2236 14.4 48 11.1765 48 7.2C48 3.22355 51.2236 0 55.2 0C59.1765 0 62.4 3.22355 62.4 7.2Z",
      ],
    },
    // CrossFace
    {
      viewBox: "0 0 71 23",
      paths: [
        "M11.5 0C12.9411 0 13.6619 0.000460386 14.1748 0.354492C14.3742 0.49213 14.547 0.664882 14.6846 0.864258C15.0384 1.37711 15.0391 2.09739 15.0391 3.53809V7.96094H19.4619C20.9027 7.96094 21.6229 7.9615 22.1357 8.31543C22.3352 8.45308 22.5079 8.62578 22.6455 8.8252C22.9995 9.3381 23 10.0589 23 11.5C23 12.9408 22.9995 13.661 22.6455 14.1738C22.5079 14.3733 22.3352 14.5459 22.1357 14.6836C21.6229 15.0375 20.9027 15.0381 19.4619 15.0381H15.0391V19.4619C15.0391 20.9026 15.0384 21.6229 14.6846 22.1357C14.547 22.3351 14.3742 22.5079 14.1748 22.6455C13.6619 22.9995 12.9411 23 11.5 23C10.0592 23 9.33903 22.9994 8.82617 22.6455C8.62674 22.5079 8.45309 22.3352 8.31543 22.1357C7.96175 21.6229 7.96191 20.9024 7.96191 19.4619V15.0381H3.53809C2.0973 15.0381 1.37711 15.0375 0.864258 14.6836C0.664834 14.5459 0.492147 14.3733 0.354492 14.1738C0.000498831 13.661 -5.88036e-08 12.9408 0 11.5C6.2999e-08 10.0589 0.000460356 9.3381 0.354492 8.8252C0.492144 8.62578 0.664842 8.45308 0.864258 8.31543C1.37711 7.9615 2.09731 7.96094 3.53809 7.96094H7.96191V3.53809C7.96191 2.09765 7.96175 1.37709 8.31543 0.864258C8.45309 0.664828 8.62674 0.492149 8.82617 0.354492C9.33903 0.000555366 10.0592 1.62347e-09 11.5 0Z",
        "M58.7695 0C60.2107 0 60.9314 0.000460386 61.4443 0.354492C61.6437 0.49213 61.8165 0.664882 61.9541 0.864258C62.308 1.37711 62.3086 2.09739 62.3086 3.53809V7.96094H66.7314C68.1722 7.96094 68.8924 7.9615 69.4053 8.31543C69.6047 8.45308 69.7774 8.62578 69.915 8.8252C70.2691 9.3381 70.2695 10.0589 70.2695 11.5C70.2695 12.9408 70.269 13.661 69.915 14.1738C69.7774 14.3733 69.6047 14.5459 69.4053 14.6836C68.8924 15.0375 68.1722 15.0381 66.7314 15.0381H62.3086V19.4619C62.3086 20.9026 62.308 21.6229 61.9541 22.1357C61.8165 22.3351 61.6437 22.5079 61.4443 22.6455C60.9314 22.9995 60.2107 23 58.7695 23C57.3287 23 56.6086 22.9994 56.0957 22.6455C55.8963 22.5079 55.7226 22.3352 55.585 22.1357C55.2313 21.6229 55.2314 20.9024 55.2314 19.4619V15.0381H50.8076C49.3668 15.0381 48.6466 15.0375 48.1338 14.6836C47.9344 14.5459 47.7617 14.3733 47.624 14.1738C47.27 13.661 47.2695 12.9408 47.2695 11.5C47.2695 10.0589 47.27 9.3381 47.624 8.8252C47.7617 8.62578 47.9344 8.45308 48.1338 8.31543C48.6466 7.9615 49.3668 7.96094 50.8076 7.96094H55.2314V3.53809C55.2314 2.09765 55.2313 1.37709 55.585 0.864258C55.7226 0.664828 55.8963 0.492149 56.0957 0.354492C56.6086 0.000555366 57.3287 1.62347e-09 58.7695 0Z",
      ],
    },
    // LineFace
    {
      viewBox: "0 0 82 8",
      paths: [
        "M3.53125 0.164063C4.90133 0.164063 5.58673 0.163893 6.08301 0.485352C6.31917 0.638428 6.52075 0.840012 6.67383 1.07617C6.99555 1.57252 6.99512 2.25826 6.99512 3.62891C6.99512 4.99911 6.99536 5.68438 6.67383 6.18066C6.52075 6.41682 6.31917 6.61841 6.08301 6.77148C5.58672 7.09305 4.90147 7.09277 3.53125 7.09277C2.16062 7.09277 1.47486 7.09319 0.978516 6.77148C0.742356 6.61841 0.540772 6.41682 0.387695 6.18066C0.0662401 5.68439 0.0664063 4.999 0.0664063 3.62891C0.0664063 2.25838 0.0660571 1.57251 0.387695 1.07617C0.540772 0.840012 0.742356 0.638428 0.978516 0.485352C1.47485 0.163744 2.16076 0.164063 3.53125 0.164063Z M25.1836 0.164063C26.5542 0.164063 27.24 0.163638 27.7363 0.485352C27.9724 0.638384 28.1731 0.8401 28.3262 1.07617C28.6479 1.57252 28.6484 2.25825 28.6484 3.62891C28.6484 4.99931 28.6478 5.68436 28.3262 6.18066C28.1731 6.41678 27.9724 6.61842 27.7363 6.77148C27.24 7.09321 26.5542 7.09277 25.1836 7.09277H11.3262C9.95557 7.09277 9.26978 7.09317 8.77344 6.77148C8.53728 6.61841 8.33569 6.41682 8.18262 6.18066C7.86115 5.68438 7.86133 4.99902 7.86133 3.62891C7.86133 2.25835 7.86096 1.57251 8.18262 1.07617C8.33569 0.840012 8.53728 0.638428 8.77344 0.485352C9.26977 0.163768 9.95572 0.164063 11.3262 0.164063H25.1836Z",
        "M78.2034 7.09325C76.8333 7.09325 76.1479 7.09342 75.6516 6.77197C75.4155 6.61889 75.2139 6.4173 75.0608 6.18114C74.7391 5.6848 74.7395 4.99905 74.7395 3.62841C74.7395 2.2582 74.7393 1.57294 75.0608 1.07665C75.2139 0.840493 75.4155 0.638909 75.6516 0.485832C76.1479 0.164271 76.8332 0.164543 78.2034 0.164543C79.574 0.164543 80.2598 0.164122 80.7561 0.485832C80.9923 0.638909 81.1939 0.840493 81.347 1.07665C81.6684 1.57293 81.6682 2.25831 81.6682 3.62841C81.6682 4.99894 81.6686 5.68481 81.347 6.18114C81.1939 6.4173 80.9923 6.61889 80.7561 6.77197C80.2598 7.09357 79.5739 7.09325 78.2034 7.09325Z M56.5511 7.09325C55.1804 7.09325 54.4947 7.09368 53.9983 6.77197C53.7622 6.61893 53.5615 6.41722 53.4085 6.18114C53.0868 5.6848 53.0862 4.99907 53.0862 3.62841C53.0862 2.258 53.0868 1.57296 53.4085 1.07665C53.5615 0.840539 53.7622 0.638898 53.9983 0.485832C54.4947 0.164105 55.1804 0.164543 56.5511 0.164543H70.4085C71.7791 0.164543 72.4649 0.164146 72.9612 0.485832C73.1974 0.638909 73.399 0.840493 73.552 1.07665C73.8735 1.57293 73.8733 2.25829 73.8733 3.62841C73.8733 4.99896 73.8737 5.68481 73.552 6.18114C73.399 6.4173 73.1974 6.61889 72.9612 6.77197C72.4649 7.09355 71.7789 7.09325 70.4085 7.09325H56.5511Z",
      ],
    },
    // CurvedFace
    {
      viewBox: "0 0 63 9",
      paths: [
        "M0 5.06511C0 4.94513 0 4.88513 0.00771184 4.79757C0.0483059 4.33665 0.341025 3.76395 0.690821 3.46107C0.757274 3.40353 0.783996 3.38422 0.837439 3.34559C2.40699 2.21129 6.03888 0 10.5 0C14.9611 0 18.593 2.21129 20.1626 3.34559C20.216 3.38422 20.2427 3.40353 20.3092 3.46107C20.659 3.76395 20.9517 4.33665 20.9923 4.79757C21 4.88513 21 4.94513 21 5.06511C21 6.01683 21 6.4927 20.9657 6.6754C20.7241 7.96423 19.8033 8.55941 18.5289 8.25054C18.3483 8.20676 17.8198 7.96876 16.7627 7.49275C14.975 6.68767 12.7805 6 10.5 6C8.21954 6 6.02504 6.68767 4.23727 7.49275C3.18025 7.96876 2.65174 8.20676 2.47108 8.25054C1.19668 8.55941 0.275917 7.96423 0.0342566 6.6754C0 6.4927 0 6.01683 0 5.06511Z",
        "M42 5.06511C42 4.94513 42 4.88513 42.0077 4.79757C42.0483 4.33665 42.341 3.76395 42.6908 3.46107C42.7573 3.40353 42.784 3.38422 42.8374 3.34559C44.407 2.21129 48.0389 0 52.5 0C56.9611 0 60.593 2.21129 62.1626 3.34559C62.216 3.38422 62.2427 3.40353 62.3092 3.46107C62.659 3.76395 62.9517 4.33665 62.9923 4.79757C63 4.88513 63 4.94513 63 5.06511C63 6.01683 63 6.4927 62.9657 6.6754C62.7241 7.96423 61.8033 8.55941 60.5289 8.25054C60.3483 8.20676 59.8198 7.96876 58.7627 7.49275C56.975 6.68767 54.7805 6 52.5 6C50.2195 6 48.025 6.68767 46.2373 7.49275C45.1802 7.96876 44.6517 8.20676 44.4711 8.25054C43.1967 8.55941 42.2759 7.96423 42.0343 6.6754C42 6.4927 42 6.01683 42 5.06511Z",
      ],
    },
  ];
  const face = eyePaths[absHash % eyePaths.length];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}
    >
      <defs>
        <radialGradient
          id={`grad-${absHash}`}
          cx="50%"
          cy="50%"
          r="50%"
          fx="50%"
          fy="50%"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.15" />
          <stop offset="60%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Background */}
      <rect width={size} height={size} fill={bgColor} rx={4} />
      {/* Gradient Overlay */}
      <rect width={size} height={size} fill={`url(#grad-${absHash})`} rx={4} />

      {/* Face Content */}
      <g
        transform={`translate(${size * 0.2}, ${size * 0.25}) scale(${(size * 0.6) / parseInt(face.viewBox.split(" ")[2])})`}
      >
        {face.paths.map((d, i) => (
          <path key={i} d={d} fill="white" />
        ))}
      </g>

      {/* Initial */}
      <text
        x="50%"
        y="75%"
        textAnchor="middle"
        fill="white"
        fontSize={size * 0.26}
        fontFamily="system-ui, sans-serif"
        fontWeight="bold"
        style={{ pointerEvents: "none" }}
      >
        {initial}
      </text>
    </svg>
  );
}

function buildTopology(
  containers: ContainerInfo[],
  projectsById: Record<string, ProjectInfo>,
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
    project: 120,
    service: 400, // Kept in interface but not used in layout
    container: 560,
    network: 920,
  };

  let currentY = 80;
  const yGap = 160;

  const projectY = new Map<string, number>();
  projects.forEach((project) => {
    projectY.set(project, currentY);

    // Find the project info to get the users
    const projectInfo = Object.entries(projectsById).find(
      ([_, p]) => p.name === project,
    );
    const users = projectInfo ? projectInfo[1].users : undefined;

    let label = project;
    let finalUsers = users;

    if (project.toLowerCase() === "baseful") {
      label = "Baseful";
      // Specific single user for baseful project avatar
      finalUsers = [{ id: 0, email: "baseful@system", avatarUrl: "/logo.png" }];
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
      x: xByKind.container,
      y: currentY,
    });

    edges.push({
      id: `edge:project:${project}:container:${container.id}`,
      source: `project:${project}`,
      target: `container:${container.id}`,
      kind: "belongs",
    });

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
  const { token, logout } = useAuth();
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectsById, setProjectsById] = useState<Record<string, ProjectInfo>>(
    {},
  );
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
  const [selectedManageProject, setSelectedManageProject] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  const fetchContainers = useCallback(async () => {
    try {
      setLoading(true);
      const [containersResponse, projectsResponse] = await Promise.all([
        authFetch("/api/docker/containers", token, {}, logout),
        authFetch("/api/projects", token, {}, logout),
      ]);

      if (!containersResponse.ok) throw new Error("Failed to fetch containers");
      const containerData = await containersResponse.json();
      setContainers(containerData);

      if (projectsResponse.ok) {
        const projectsData: ProjectInfo[] = await projectsResponse.json();
        const projectMap = projectsData.reduce(
          (acc, project) => {
            acc[String(project.id)] = project;
            return acc;
          },
          {} as Record<string, ProjectInfo>,
        );
        setProjectsById(projectMap);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 30000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

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
    () => buildTopology(containers, projectsById),
    [containers, projectsById],
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

                    const isRelated = highlightedGraph.edgeIds.has(edge.id);

                    return (
                      <line
                        key={edge.id}
                        x1={source.x + 110}
                        y1={source.y}
                        x2={target.x - 110}
                        y2={target.y}
                        stroke={isRelated ? "#6b7280" : "#3f3f46"}
                        strokeOpacity={isRelated ? 1 : 0.4}
                        strokeWidth={isRelated ? 2 : 1.5}
                      />
                    );
                  })}

                  {topology.nodes.map((node) => {
                    const isContainer = node.kind === "container";
                    const isSelected = selectedNodeId === node.id;
                    const isRelated = highlightedGraph.nodeIds.has(node.id);

                    let iconNode = (
                      <CubeIcon className="w-4 h-4 text-neutral-400" />
                    );
                    let nodeTypeStr = "Node";

                    if (node.kind === "project") {
                      iconNode = <DitherAvatar value={node.label} size={16} />;
                      nodeTypeStr = "Project";
                    } else if (node.kind === "service") {
                      iconNode = (
                        <ServiceIconSVG className="w-4 h-4 text-neutral-400" />
                      );
                      nodeTypeStr = "Service";
                    } else if (node.kind === "network") {
                      iconNode = (
                        <NetworkIconSVG className="w-4 h-4 text-neutral-400" />
                      );
                      nodeTypeStr = "Network";
                    } else if (isContainer) {
                      iconNode = (
                        <DockerLogoSVG className="w-4 h-4 text-neutral-300" />
                      );
                      nodeTypeStr = "Container";
                    }

                    return (
                      <g key={node.id} style={{ cursor: "default" }}>
                        <foreignObject
                          x={node.x - 120}
                          y={node.y - 85}
                          width={240}
                          height={170}
                        >
                          <div className="w-full h-full p-2.5 flex items-center justify-center">
                            <div
                              className={`w-[220px] h-[150px] rounded-[10px] border flex flex-col select-none transition-colors overflow-hidden ${isSelected
                                ? "bg-neutral-800 border-neutral-500 shadow-xl"
                                : isRelated
                                  ? "bg-[#181818] border-neutral-600 shadow-md"
                                  : "bg-[#121212] border-[#2a2a2a] shadow-md hover:border-[#3e3e3e]"
                                }`}
                              onClick={() => {
                                if (panStateRef.current.moved) return;
                                setSelectedNodeId(node.id);
                              }}
                            >
                              <div
                                className={`flex items-center gap-2.5 px-3 h-[34px] border-b ${isSelected
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
                                    {node.version && (
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
                                      {node.users?.map((u, i) => (
                                        <div
                                          key={i}
                                          className="inline-block h-6 w-6 rounded-full border-2 border-[#121212] flex items-center justify-center overflow-hidden bg-muted"
                                        >
                                          {u.avatarUrl ? (
                                            <img
                                              src={u.avatarUrl}
                                              className="size-full object-cover"
                                              alt=""
                                            />
                                          ) : (
                                            <FacehashSVG
                                              name={u.email}
                                              size={24}
                                            />
                                          )}
                                        </div>
                                      ))}
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
                                  className={`flex items-center justify-end px-3 h-[40px] border-t ${isSelected
                                    ? "border-neutral-600"
                                    : "border-[#2a2a2a]"
                                    }`}
                                >
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedNodeId(node.id); // Also highlight when opening drawer
                                      if (panStateRef.current.moved) return;
                                      if (isContainer && node.containerId) {
                                        const match = containers.find(
                                          (c) => c.id === node.containerId,
                                        );
                                        if (match) setSelectedContainer(match);
                                      } else if (node.kind === "project") {
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
                                    className="h-6 text-[10px] px-2 py-0 uppercase tracking-wider font-bold border-neutral-700 hover:bg-neutral-800"
                                  >
                                    Open
                                  </Button>
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

              <div className="absolute top-3 right-3 flex items-center gap-2 text-[11px] text-neutral-300 bg-black/45 border border-white/10 rounded-md px-2 py-1">
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
                direction="right"
              >
                <DrawerContent className="h-full bg-card border-l border-border rounded-none">
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
                      <div className="flex-1 overflow-y-auto space-y-6 p-4">
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
