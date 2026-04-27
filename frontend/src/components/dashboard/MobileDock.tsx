import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  HouseIcon,
  TableIcon,
  TerminalIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  GraphIcon,
  CubeTransparentIcon,
  ListIcon,
  XIcon,
  CaretDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  Globe,
  BellSimpleIcon,
  CaretUpIcon,
  SirenIcon,
  LockIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useDatabase } from "@/context/DatabaseContext";
import { useProject } from "@/context/ProjectContext";
import CreateDatabaseDialog from "../database/CreateDatabaseDialog";
import CreateProjectDialog from "../project/CreateProjectDialog";
import { DitherAvatar } from "../ui/hash-avatar";
import { useAuth } from "@/context/AuthContext";

export default function MobileDock() {
  const { selectedDatabase, setSelectedDatabase, databases, refreshDatabases } =
    useDatabase();
  const { projects, refreshProjects } = useProject();
  const { user, hasPermission } = useAuth();
  const location = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [isDockVisible, setIsDockVisible] = useState(true);
  const canCreateProjects = hasPermission("create_projects");
  const canCreateDatabases = hasPermission("create_databases");
  const canAccessServer = hasPermission("server_access");
  const canManageBackups = hasPermission("manage_backups");
  const canManageNotifications = hasPermission("manage_notifications");
  // Handle scroll to hide/show dock
  const lastScrollY = useRef(0);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset scroll position when location changes
    lastScrollY.current = 0;
    setIsDockVisible(true);
  }, [location.pathname]);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      // Get the element that actually scrolled
      const target = e.target as HTMLElement;
      if (!target || typeof target.scrollTop === "undefined") return;

      // Ignore scroll events originating from inside the dock's own menu
      if (expandedMenuRef.current?.contains(target)) return;

      // Only respond to vertical scrolling on elements that are intended to be scrollable
      const currentScrollY = target.scrollTop;
      const scrollDifference = currentScrollY - lastScrollY.current;

      // Only hide if scrolled down significantly and we're not at the very top
      if (scrollDifference > 10 && currentScrollY > 20) {
        // Don't hide if the menu is expanded
        if (!isExpanded) {
          setIsDockVisible(false);
        }
      }
      // Show when scrolling up significantly or at the top
      else if (scrollDifference < -10 || currentScrollY < 20) {
        setIsDockVisible(true);
      }

      lastScrollY.current = currentScrollY;
    };

    // Use capture: true to catch scroll events from ANY nested element
    // since scroll events do not bubble.
    window.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, [isExpanded]);

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

  const getSelectorDisplayText = () => {
    if (!selectedDatabase) return "Select Database";
    let text = selectedDatabase.name;
    if (text.length > 20) {
      text = `${text.slice(0, 17)}...`;
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

  const navItems = selectedDatabase
    ? [
        {
          section: "DATABASE",
          items: [
            {
              name: "Overview",
              icon: HouseIcon,
              path: `/db/${selectedDatabase.id}/dashboard`,
            },
            {
              name: "Tables",
              icon: TableIcon,
              path: `/db/${selectedDatabase.id}/tables`,
            },
            {
              name: "SQL Editor",
              icon: TerminalIcon,
              path: `/db/${selectedDatabase.id}/sql-editor`,
            },
            ...(canManageBackups
              ? [
                  {
                    name: "Backup",
                    icon: ClockCounterClockwiseIcon,
                    path: `/db/${selectedDatabase.id}/backup`,
                  },
                ]
              : []),
            ...(canManageNotifications
              ? [
                  {
                    name: "Alerts",
                    icon: SirenIcon,
                    path: `/db/${selectedDatabase.id}/notifications`,
                  },
                ]
              : []),
            {
              name: "Settings",
              icon: GearSixIcon,
              path: `/db/${selectedDatabase.id}/settings`,
            },
          ],
        },
        ...(canAccessServer || canManageNotifications
          ? [
              {
                section: "SERVER",
                items: [
                  ...(canAccessServer
                    ? [
                        {
                          name: "Monitoring",
                          icon: GraphIcon,
                          path: `/monitoring`,
                        },
                        {
                          name: "Topology",
                          icon: CubeTransparentIcon,
                          path: `/containers`,
                        },
                        {
                          name: "Web Server",
                          icon: Globe,
                          path: `/web-server`,
                        },
                        {
                          name: "Security",
                          icon: LockIcon,
                          path: `/security`,
                        },
                      ]
                    : []),
                  ...(canManageNotifications
                    ? [
                        {
                          name: "Notification Center",
                          icon: BellSimpleIcon,
                          path: `/notifications`,
                        },
                      ]
                    : []),
                ],
              },
            ]
          : []),
        ...(user?.isAdmin
          ? [
              {
                section: "ADMIN",
                items: [
                  {
                    name: "Users & Whitelist",
                    icon: UsersIcon,
                    path: `/users`,
                  },
                ],
              },
            ]
          : []),
      ]
    : [];

  const isActivePath = (path: string) => location.pathname === path;

  return (
    <>
      {/* Backdrop */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/50 z-40 animate-in fade-in duration-200 md:hidden"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Expanded Menu */}
      {isExpanded && (
        <div
          ref={expandedMenuRef}
          className="fixed bottom-16 left-2 right-2 z-50 bg-card border border-border rounded-xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300 md:hidden max-h-[70vh] overflow-hidden flex flex-col"
        >
          {/* Quick Actions */}
          <div className="flex flex-row gap-2 p-3 border-b border-border">
            <div className="flex-1 bg-muted/50 size-10 text-sm flex items-center gap-2 justify-center rounded-lg text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer active:scale-95">
              <MagnifyingGlassIcon size={16} /> Search
            </div>
            <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
              <PopoverTrigger asChild>
                <div
                  className={`flex-1 bg-muted/50 text-sm  flex items-center gap-2 justify-center rounded-lg text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer active:scale-95 ${!canCreateProjects && !canCreateDatabases ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <PlusIcon size={16} /> Create
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-fit p-2" align="end">
                <div className="flex flex-col gap-1">
                  {canCreateProjects && (
                    <CreateProjectDialog
                      onProjectCreated={() => {
                        refreshProjects();
                        setCreateMenuOpen(false);
                        setIsExpanded(false);
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
                        setIsExpanded(false);
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

          {/* Navigation Links */}
          <nav className="flex-1 overflow-y-auto p-3">
            {navItems.map((section) => (
              <div key={section.section} className="mb-4">
                <h2 className="text-xs font-medium text-neutral-400 mb-2 px-2">
                  {section.section}
                </h2>
                <ul className="flex flex-col gap-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.path}>
                        <Link
                          to={item.path}
                          onClick={() => setIsExpanded(false)}
                          className={`flex flex-row items-center gap-3 p-2.5 rounded-lg transition-colors ${
                            isActivePath(item.path)
                              ? "bg-accent text-white"
                              : "text-neutral-300 hover:bg-muted/50"
                          }`}
                        >
                          <Icon
                            size={20}
                            weight="bold"
                            className={
                              isActivePath(item.path)
                                ? "text-white"
                                : "text-neutral-400"
                            }
                          />
                          <span className="text-sm font-medium">
                            {item.name}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {!selectedDatabase && (
              <div className="text-center py-8 text-neutral-500 text-sm">
                Select or create a database to get started
              </div>
            )}
          </nav>
        </div>
      )}

      {/* Floating Dock */}
      <div
        className={`fixed -translate-x-1/2 w-fit transition-all duration-300 left-1/2 right-0 z-50 md:hidden ${
          isDockVisible ? "bottom-4 translate-y-0" : "bottom-0 translate-y-full"
        }`}
      >
        <div className="mx-2 mb-2 bg-card border border-border rounded-2xl shadow-2xl">
          <div className="flex flex-row justify-between items-center h-14 px-2 gap-2">
            {/* Database Selector */}
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <div className="flex flex-row items-center gap-2 cursor-pointer p-2 rounded-xl bg-transparent hover:bg-muted transition-colors min-w-0">
                  <DitherAvatar
                    value={selectedDatabase?.name || "database"}
                    size={32}
                  />

                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">
                      {getSelectorDisplayText()}
                    </span>
                  </div>
                  {selectorOpen ? (
                    <CaretDownIcon
                      weight="bold"
                      size={12}
                      className="text-neutral-400 flex-shrink-0"
                    />
                  ) : (
                    <CaretUpIcon
                      weight="bold"
                      size={12}
                      className="text-neutral-400 flex-shrink-0"
                    />
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-72 max-h-80 overflow-y-auto p-2 pb-0 pt-4 ml-2">
                <div className="flex flex-col gap-2">
                  {(databases || []).length === 0 ? (
                    <div className="text-sm text-neutral-500 px-2 pb-4">
                      No databases yet. Create one to get started.
                    </div>
                  ) : (
                    Object.entries(databasesByProject).map(
                      ([projectId, dbs]) => (
                        <div key={projectId} className="mb-2">
                          {dbs.length > 0 && (
                            <>
                              <div className="flex flex-row items-center">
                                <p className="text-xs mb-1 text-neutral-400 px-2 font-normal">
                                  {getProjectName(
                                    parseInt(projectId) || undefined,
                                  )}
                                </p>
                              </div>
                              <ul className="flex flex-col gap-1">
                                {dbs.map((db) => (
                                  <li key={db.id}>
                                    <Link
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
                                        size={32}
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
                      ),
                    )
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* Menu Button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-xl transition-all`}
            >
              {isExpanded ? (
                <XIcon size={22} weight="regular" />
              ) : (
                <ListIcon size={22} weight="regular" />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
