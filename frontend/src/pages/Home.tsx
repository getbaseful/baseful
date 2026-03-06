import { useAuth } from "@/context/AuthContext";
import { useDatabase } from "@/context/DatabaseContext";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { PlusIcon, DatabaseIcon } from "@phosphor-icons/react";
import CreateDatabaseDialog from "@/components/database/CreateDatabaseDialog";

export default function Home() {
  const { databases, refreshDatabases } = useDatabase();
  const { user, hasPermission } = useAuth();
  const canCreateDatabases = hasPermission("create_databases");
  const createGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    if (hour < 23) return "Good evening";
    return "Up late";
  };
  return (
    <div className="p-6 md:p-12 flex flex-col gap-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-bold text-neutral-100 tracking-tight">
            {createGreeting()}, {user?.firstName || "there"}{createGreeting() === "Up late" && "?"}
          </h1>
          <p className="text-neutral-500 text-sm md:text-base">
            Select a database to manage or create a new one to get started.
          </p>
        </div>
        {canCreateDatabases && (
          <CreateDatabaseDialog onDatabaseCreated={refreshDatabases}>
            <Button className="w-full md:w-auto gap-2 bg-blue-600 hover:bg-blue-500 text-white border-0">
              <PlusIcon weight="bold" />
              New Database
            </Button>
          </CreateDatabaseDialog>
        )}
      </div>

      {databases && databases.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {databases.map((db) => (
            <Link key={db.id} to={`/db/${db.id}/dashboard`} className="group">
              <Card className="h-full bg-card/40 border-border hover:border-blue-500/50 hover:bg-card/60 transition-all duration-300 overflow-hidden cursor-pointer relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <CardHeader className="flex flex-row items-center gap-4 pb-4">
                  <div className="relative">
                    <DitherAvatar value={db.name} size={48} className="rounded-xl shadow-lg" />
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-background ${db.status === 'active' ? 'bg-green-500' : 'bg-neutral-500'}`} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <CardTitle className="text-lg font-semibold text-neutral-100 truncate group-hover:text-blue-400 transition-colors">
                      {db.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] py-0 px-2 uppercase border-neutral-700 text-neutral-400">
                        {db.type}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="bg-card/40 border-dashed border-2 border-border/50 py-20">
          <CardContent className="flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-16 h-16 bg-neutral-800/50 rounded-full flex items-center justify-center mb-2">
              <DatabaseIcon size={32} weight="duotone" className="text-neutral-600" />
            </div>
            <div className="flex flex-col gap-1 max-w-sm">
              <h3 className="text-xl font-semibold text-neutral-200">No databases found</h3>
              <p className="text-neutral-500 text-sm">
                You haven't added any databases yet. Create your first database to start managing your data.
              </p>
            </div>
            {canCreateDatabases && (
              <CreateDatabaseDialog onDatabaseCreated={refreshDatabases}>
                <Button variant="outline" className="mt-4 gap-2 hover:bg-neutral-800">
                  <PlusIcon weight="bold" />
                  Add First Database
                </Button>
              </CreateDatabaseDialog>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
