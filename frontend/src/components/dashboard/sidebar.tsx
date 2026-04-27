import {
  CheckIcon,
  CaretDownIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  GlobeIcon,
  GraphIcon,
  HouseIcon,
  PlusIcon,
  TableIcon,
  TerminalIcon,
  LockIcon,
  UsersIcon,
  XIcon,
  NotePencilIcon,
  BellSimpleIcon,
  SirenIcon,
  CubeTransparentIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Link, useLocation } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import CreateDatabaseDialog from "@/components/database/CreateDatabaseDialog";
import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import { useDatabase } from "@/context/DatabaseContext";
import { useProject } from "@/context/ProjectContext";
import { DitherAvatar } from "../ui/hash-avatar";
import { LetterAvatar } from "../ui/letter-avatar";

export default function Sidebar() {
  const { selectedDatabase, setSelectedDatabase, databases, refreshDatabases } =
    useDatabase();
  const { projects, refreshProjects, updateProjectName } = useProject();
  const { user, hasPermission } = useAuth();
  const location = useLocation();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [isSavingProjectName, setIsSavingProjectName] = useState(false);
  const canCreateProjects = hasPermission("create_projects");
  const canCreateDatabases = hasPermission("create_databases");
  const canEditProjects = hasPermission("edit_projects");
  const canAccessServer = hasPermission("server_access");
  const canManageBackups = hasPermission("manage_backups");
  const canManageNotifications = hasPermission("manage_notifications");

  const startProjectEdit = (projectId: number, currentName: string) => {
    if (!canEditProjects) return;
    setEditingProjectId(projectId);
    setEditingProjectName(currentName);
  };

  const cancelProjectEdit = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const saveProjectEdit = async () => {
    if (!canEditProjects) return;
    if (!editingProjectId || isSavingProjectName) return;

    const trimmedName = editingProjectName.trim();
    const existingProject = projects.find((p) => p.id === editingProjectId);

    if (!trimmedName || trimmedName === existingProject?.name) {
      cancelProjectEdit();
      return;
    }

    setIsSavingProjectName(true);
    const success = await updateProjectName(editingProjectId, trimmedName);
    setIsSavingProjectName(false);

    if (success) {
      cancelProjectEdit();
    }
  };

  useEffect(() => {
    const pathParts = location.pathname.split("/");
    const dbIdIndex = pathParts.indexOf("db");

    if (dbIdIndex !== -1 && pathParts[dbIdIndex + 1]) {
      const dbId = parseInt(pathParts[dbIdIndex + 1]);
      const db = (databases || []).find((d) => d.id === dbId);
      if (db && (!selectedDatabase || selectedDatabase.id !== db.id)) {
        setSelectedDatabase(db);
      }
    }
  }, [location.pathname, databases, selectedDatabase, setSelectedDatabase]);

  // Group databases by project
  const databasesByProject = (databases || []).reduce(
    (acc, db) => {
      const projectId = db.projectId || 0;
      if (!acc[projectId]) {
        acc[projectId] = [];
      }
      acc[projectId].push(db);
      return acc;
    },
    {} as Record<number, typeof databases>,
  );

  const getProjectName = (projectId: number | undefined) => {
    if (!projectId || projectId === 0) return "No Project";
    const project = projects.find((p) => p.id === projectId);
    return project?.name || "Unknown Project";
  };

  // Get display text for selector trigger
  const getSelectorDisplayText = () => {
    if (!selectedDatabase) return "Select Database";
    let text = selectedDatabase.name;
    if (text.length > 15) {
      text = `${text.slice(0, 12)}...`;
    }

    return text;
  };

  const getDatabaseSwitchPath = (nextDatabaseId: number) => {
    const pathParts = location.pathname.split("/");
    const dbIdIndex = pathParts.indexOf("db");

    if (dbIdIndex !== -1 && pathParts[dbIdIndex + 1]) {
      pathParts[dbIdIndex + 1] = String(nextDatabaseId);
      return `${pathParts.join("/")}${location.search}${location.hash}`;
    }

    return `/db/${nextDatabaseId}/dashboard`;
  };

  return (
    <div className="w-72 max-h-screen overflow-y-auto p-2 flex flex-col h-full">
      <div className="mb-8 flex flex-row items-center justify-between">
        {/* Combined Project/Database Selector */}
        <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
          <PopoverTrigger asChild>
            <div className="flex flex-row items-center gap-2 cursor-pointer pr-2 pl-1 py-1 rounded-md hover:bg-card transition-colors">
              <DitherAvatar
                value={selectedDatabase?.name || "database"}
                size={22}
              />
              <div className="flex flex-col">
                <h2 className="text-sm font-medium text-nowrap">
                  {getSelectorDisplayText()}
                </h2>
              </div>
              <CaretDownIcon
                weight="bold"
                size={12}
                className="text-neutral-400 ml-auto"
              />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-64 max-h-96 overflow-y-auto p-2 pb-0 pt-4 ml-2">
            <div className="flex flex-col gap-2">
              {(databases || []).length === 0 ? (
                <div className="text-sm text-neutral-500 px-2 pb-4">
                  No databases yet. Create one to get started.
                </div>
              ) : (
                Object.entries(databasesByProject).map(([projectId, dbs]) => (
                  <div key={projectId} className="mb-2">
                    {dbs.length > 0 && (
                      <>
                        <div className="flex flex-row items-center mb-1">
                          {parseInt(projectId) > 0 &&
                          editingProjectId === parseInt(projectId) ? (
                            <div className="flex items-center gap-1 w-full px-1">
                              <input
                                value={editingProjectName}
                                onChange={(e) =>
                                  setEditingProjectName(e.target.value)
                                }
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void saveProjectEdit();
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelProjectEdit();
                                  }
                                }}
                                className="h-4 w-full rounded-sm focus:ring-0 border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-100 outline-none focus:border-neutral-700"
                                autoFocus
                                disabled={isSavingProjectName}
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void saveProjectEdit();
                                }}
                                className="text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50"
                                disabled={isSavingProjectName}
                                aria-label="Save project name"
                              >
                                <CheckIcon size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelProjectEdit();
                                }}
                                className="text-neutral-400 hover:text-neutral-200 transition-colors"
                                aria-label="Cancel project name edit"
                              >
                                <XIcon size={14} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-xs text-neutral-400 px-2 font-normal">
                                {getProjectName(
                                  parseInt(projectId) || undefined,
                                )}
                              </p>
                              {parseInt(projectId) > 0 && canEditProjects && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startProjectEdit(
                                      parseInt(projectId),
                                      getProjectName(parseInt(projectId)),
                                    );
                                  }}
                                  className="ml-1 -translate-y-px text-neutral-500 hover:text-neutral-300 transition-colors"
                                  aria-label="Edit project name"
                                >
                                  <NotePencilIcon size={12} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        <ul className="flex flex-col gap-1">
                          {dbs.map((db) => (
                            <li>
                              <Link
                                key={db.id}
                                to={getDatabaseSwitchPath(db.id)}
                                onClick={() => {
                                  setSelectedDatabase(db);
                                  setSelectorOpen(false);
                                }}
                                className={`flex flex-row items-center gap-2 p-2 rounded-md transition-colors ${
                                  selectedDatabase?.id === db.id
                                    ? "bg-accent"
                                    : "hover:bg-accent"
                                }`}
                              >
                                <DitherAvatar
                                  value={db?.name || "database"}
                                  size={22}
                                />

                                <span className="text-sm text-neutral-200">
                                  {db.name}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Branch Selector */}

        {/* Actions */}
        <div className="flex flex-row gap-1 px-1">
          <Link to="/">
            <div
              className={`size-6 flex items-center justify-center rounded-sm  hover:text-neutral-300 transition-colors duration-200 cursor-pointer ${location.pathname === "/" ? "text-neutral-300 bg-neutral-800" : "text-neutral-400 bg-card"}`}
            >
              <HouseIcon size={16} />
            </div>
          </Link>
          <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
            <PopoverTrigger asChild>
              <div
                className={`bg-card size-6 flex items-center justify-center rounded-sm  hover:text-neutral-300 transition-colors duration-200 cursor-pointer ${createMenuOpen ? "text-neutral-300 bg-neutral-800" : "text-neutral-400 bg-card"} ${!canCreateProjects && !canCreateDatabases ? "opacity-50 pointer-events-none" : ""}`}
              >
                <PlusIcon size={16} />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-fit p-2" align="end">
              <div className="flex flex-col gap-1">
                {canCreateProjects && (
                  <CreateProjectDialog
                    onProjectCreated={() => {
                      refreshProjects();
                      setCreateMenuOpen(false);
                    }}
                  >
                    <button className="flex focus:ring-0 flex-row items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors text-left w-full">
                      <span className="text-sm">New Project</span>
                    </button>
                  </CreateProjectDialog>
                )}
                {canCreateDatabases && (
                  <CreateDatabaseDialog
                    onDatabaseCreated={() => {
                      refreshDatabases();
                      setCreateMenuOpen(false);
                    }}
                  >
                    <button className="flex flex-row items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors text-left w-full">
                      <span className="text-sm">New Database</span>
                    </button>
                  </CreateDatabaseDialog>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-8">
        {selectedDatabase && (
          <div>
            <h2 className="text-xs font-medium text-neutral-400 mb-3 px-2.5">
              DATABASE
            </h2>

            <ul className="flex flex-col gap-1">
              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/dashboard`
                    : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/dashboard`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <HouseIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Overview</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname ===
                  (selectedDatabase ? `/db/${selectedDatabase.id}/tables` : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase ? `/db/${selectedDatabase.id}/tables` : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <TableIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Tables</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/sql-editor`
                    : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/sql-editor`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <TerminalIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>SQL Editor</span>
                </Link>
              </li>

              {canManageBackups && (
                <li
                  className={`py-1.5 px-2.5 rounded-md ${
                    location.pathname ===
                    (selectedDatabase
                      ? `/db/${selectedDatabase.id}/backup`
                      : "/")
                      ? "bg-muted/50"
                      : ""
                  }`}
                >
                  <Link
                    to={
                      selectedDatabase
                        ? `/db/${selectedDatabase.id}/backup`
                        : "/"
                    }
                    className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                  >
                    <ClockCounterClockwiseIcon
                      size={18}
                      weight="bold"
                      className="text-neutral-400"
                    />
                    <span>Backup</span>
                  </Link>
                </li>
              )}

              {canManageNotifications && (
                <li
                  className={`py-1.5 px-2.5 rounded-md ${
                    location.pathname ===
                    (selectedDatabase
                      ? `/db/${selectedDatabase.id}/notifications`
                      : "/")
                      ? "bg-muted/50"
                      : ""
                  }`}
                >
                  <Link
                    to={
                      selectedDatabase
                        ? `/db/${selectedDatabase.id}/notifications`
                        : "/"
                    }
                    className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                  >
                    <SirenIcon
                      size={18}
                      weight="bold"
                      className="text-neutral-400"
                    />
                    <span>Alerts</span>
                  </Link>
                </li>
              )}

              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/settings`
                    : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/settings`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <GearSixIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Settings</span>
                </Link>
              </li>
            </ul>
          </div>
        )}

        {(canAccessServer || canManageNotifications) && (
          <div>
            <h2 className="text-xs font-medium text-neutral-400 mb-3 px-2.5">
              SERVER
            </h2>
            <ul className="flex flex-col gap-1">
              {canAccessServer && (
                <li
                  className={`py-1.5 px-2.5 rounded-md ${
                    location.pathname === "/monitoring" ? "bg-muted/50" : ""
                  }`}
                >
                  <Link
                    to="/monitoring"
                    className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                  >
                    <GraphIcon
                      size={18}
                      weight="bold"
                      className="text-neutral-400"
                    />
                    <span>Monitoring</span>
                  </Link>
                </li>
              )}
              {canAccessServer && (
                <li
                  className={`py-1.5 px-2.5 rounded-md ${
                    location.pathname === "/containers" ? "bg-muted/50" : ""
                  }`}
                >
                  <Link
                    to="/containers"
                    className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                  >
                    <CubeTransparentIcon
                      size={18}
                      weight="bold"
                      className="text-neutral-400"
                    />
                    <span>Topology</span>
                  </Link>
                </li>
              )}
              {canAccessServer && (
                <li
                  className={`py-1.5 px-2.5 rounded-md ${
                    location.pathname === "/web-server" ? "bg-muted/50" : ""
                  }`}
                >
                  <Link
                    to="/web-server"
                    className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                  >
                    <GlobeIcon
                      size={18}
                      weight="bold"
                      className="text-neutral-400"
                    />
                    <span>Web Server</span>
                  </Link>
                </li>
              )}
              {canManageNotifications && (
                <li
                  className={`py-1.5 px-2.5 rounded-md ${
                    location.pathname === "/notifications" ? "bg-muted/50" : ""
                  }`}
                >
                  <Link
                    to="/notifications"
                    className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                  >
                    <BellSimpleIcon
                      size={18}
                      weight="bold"
                      className="text-neutral-400"
                    />
                    <span>Notification Center</span>
                  </Link>
                </li>
              )}
              {canAccessServer && (
                <li
                  className={`py-1.5 px-2.5 rounded-md ${
                    location.pathname === "/security" ? "bg-muted/50" : ""
                  }`}
                >
                  <Link
                    to="/security"
                    className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                  >
                    <LockIcon
                      size={18}
                      weight="bold"
                      className="text-neutral-400"
                    />
                    <span>Security</span>
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}

        {user?.isAdmin && (
          <div>
            <h2 className="text-xs font-medium text-neutral-400 mb-3 px-2.5">
              ADMIN
            </h2>
            <ul className="flex flex-col gap-1">
              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname === "/users" ? "bg-muted/50" : ""
                }`}
              >
                <Link
                  to="/users"
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <UsersIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Users & Whitelist</span>
                </Link>
              </li>
            </ul>
          </div>
        )}
      </nav>

      <div className="mt-auto pt-4 flex flex-col gap-4">
        {/* User Profile Section */}
        {user && (
          <div className="px-2 py-3 mt-4 flex flex-col gap-2">
            <Link
              to="/settings/profile"
              className="flex items-center gap-3 hover:bg-muted/30 p-1 -m-1 rounded-full transition-colors"
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  className="size-8 rounded-full object-cover bg-muted"
                  alt=""
                />
              ) : (
                <LetterAvatar
                  name={user.email}
                  size={32}
                  className="rounded-full"
                />
              )}
              <div className="flex flex-col min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
