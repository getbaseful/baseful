import {
  CaretDownIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  FolderPlusIcon,
  GearSixIcon,
  GitBranchIcon,
  GraphIcon,
  HouseIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PuzzlePieceIcon,
  TableIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Facehash } from "facehash";
import CreateDatabaseDialog from "@/components/database/CreateDatabaseDialog";
import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import { useDatabase } from "@/context/DatabaseContext";
import { useProject } from "@/context/ProjectContext";

export default function Sidebar() {
  const { selectedDatabase, setSelectedDatabase, databases, refreshDatabases } =
    useDatabase();
  const { projects, refreshProjects } = useProject();
  const location = useLocation();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  useEffect(() => {
    const pathParts = location.pathname.split("/");
    const dbIdIndex = pathParts.indexOf("db");

    if (dbIdIndex !== -1 && pathParts[dbIdIndex + 1]) {
      const dbId = parseInt(pathParts[dbIdIndex + 1]);
      const db = databases.find((d) => d.id === dbId);
      if (db && (!selectedDatabase || selectedDatabase.id !== db.id)) {
        setSelectedDatabase(db);
      }
    }
  }, [location.pathname, databases, selectedDatabase, setSelectedDatabase]);

  // Group databases by project
  const databasesByProject = databases.reduce(
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
    let projectName = getProjectName(selectedDatabase.projectId);
    if (projectName.length > 15) {
      projectName = `${projectName.slice(0, 12)}...`;
    }
    return `${projectName}/${selectedDatabase.name}`;
  };

  return (
    <div className="w-72 p-2">
      <div className="mb-6 flex flex-col gap-3">
        {/* Combined Project/Database Selector */}
        <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
          <PopoverTrigger asChild>
            <div className="flex flex-row items-center gap-2 cursor-pointer p-2.5 rounded-md hover:bg-accent transition-colors">
              <Facehash
                name={selectedDatabase?.name || "database"}
                className="rounded-sm"
                colorClasses={[
                  "bg-blue-500",
                  "bg-orange-500",
                  "bg-purple-500",
                  "bg-lime-500",
                  "bg-indigo-500",
                  "bg-pink-500",
                  "bg-teal-500",
                  "bg-yellow-500",
                  "bg-sky-500",
                  "bg-fuchsia-500",
                  "bg-rose-500",
                ]}
                size={22}
              />
              <div className="flex flex-col">
                <h2 className="text-sm font-medium">
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
          <PopoverContent className="w-64 p-2 pb-0 pt-4 ml-2">
            <div className="flex flex-col gap-2">
              {databases.length === 0 ? (
                <div className="text-sm text-neutral-500">
                  No databases yet. Create one to get started.
                </div>
              ) : (
                Object.entries(databasesByProject).map(([projectId, dbs]) => (
                  <div key={projectId} className="mb-2">
                    {dbs.length > 0 && (
                      <>
                        <div className="flex flex-row items-center">
                          <p className="text-xs text-neutral-400 px-2 font-normal">
                            {getProjectName(parseInt(projectId) || undefined)}
                          </p>
                        </div>
                        {dbs.map((db) => (
                          <Link
                            key={db.id}
                            to={`/db/${db.id}/dashboard`}
                            onClick={() => setSelectorOpen(false)}
                            className={`flex flex-row items-center gap-2 p-2 rounded-md transition-colors ${
                              selectedDatabase?.id === db.id
                                ? "bg-accent"
                                : "hover:bg-accent"
                            }`}
                          >
                            <Facehash
                              name={db.name}
                              className="rounded-sm"
                              colorClasses={[
                                "bg-blue-500",
                                "bg-orange-500",
                                "bg-purple-500",
                                "bg-lime-500",
                                "bg-indigo-500",
                                "bg-pink-500",
                                "bg-teal-500",
                                "bg-yellow-500",
                                "bg-sky-500",
                                "bg-fuchsia-500",
                                "bg-rose-500",
                              ]}
                              size={20}
                            />
                            <span className="text-sm text-neutral-200">
                              {db.name}
                            </span>
                          </Link>
                        ))}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Actions */}
        <div className="flex flex-row gap-1 px-1">
          <div className="bg-card p-1.5 rounded-sm text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer">
            <MagnifyingGlassIcon size={16} />
          </div>
          <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
            <PopoverTrigger asChild>
              <div className="bg-card p-1.5 rounded-sm text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer">
                <PlusIcon size={16} />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-48" align="end">
              <div className="flex flex-col gap-1">
                <CreateProjectDialog
                  onProjectCreated={() => {
                    refreshProjects();
                    setCreateMenuOpen(false);
                  }}
                >
                  <button className="flex flex-row items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors text-left w-full">
                    <FolderPlusIcon size={18} className="text-indigo-400" />
                    <span className="text-sm">New Project</span>
                  </button>
                </CreateProjectDialog>
                <CreateDatabaseDialog
                  onDatabaseCreated={() => {
                    refreshDatabases();
                    setCreateMenuOpen(false);
                  }}
                >
                  <button className="flex flex-row items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors text-left w-full">
                    <DatabaseIcon size={18} className="text-green-400" />
                    <span className="text-sm">New Database</span>
                  </button>
                </CreateDatabaseDialog>
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
                  <span>Dashboard</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/branches`
                    : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/branches`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <GitBranchIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Branches</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/integrations`
                    : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/integrations`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <PuzzlePieceIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Integrations</span>
                </Link>
              </li>
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

        {selectedDatabase && (
          <div>
            <h2 className="text-xs font-medium text-neutral-400 mb-3 px-2.5">
              BRANCH
            </h2>
            <ul className="flex flex-col gap-1">
              <li
                className={`py-1.5 px-2.5 rounded-md ${
                  location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/overview`
                    : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/overview`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <KanbanIcon
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
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/monitoring`
                    : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/monitoring`
                      : "/"
                  }
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
                  (selectedDatabase ? `/db/${selectedDatabase.id}/backup` : "/")
                    ? "bg-muted/50"
                    : ""
                }`}
              >
                <Link
                  to={
                    selectedDatabase ? `/db/${selectedDatabase.id}/backup` : "/"
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
            </ul>
          </div>
        )}
      </nav>
    </div>
  );
}
