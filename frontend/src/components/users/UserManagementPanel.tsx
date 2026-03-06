import { useEffect, useState } from "react";
import {
  UsersIcon,
  PlusIcon,
  TrashIcon,
  EnvelopeIcon,
  ShieldCheckIcon,
  GearSixIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { LetterAvatar } from "@/components/ui/letter-avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface WhitelistedEmail {
  email: string;
}

interface UserAccount {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
  avatarUrl?: string;
}

interface Project {
  id: number;
  name: string;
}

interface UserManagementPanelProps {
  showHeader?: boolean;
}

const PERMISSION_LABELS: Record<string, string> = {
  server_access: "Server Access",
  manage_notifications: "Manage Notifications",
  create_projects: "Create Projects",
  edit_projects: "Edit Project Names",
  create_databases: "Create Databases",
};

export function UserManagementPanel({ showHeader = true }: UserManagementPanelProps) {
  const { token, logout, user } = useAuth();

  const [whitelist, setWhitelist] = useState<WhitelistedEmail[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loadingWhitelist, setLoadingWhitelist] = useState(true);
  const [adding, setAdding] = useState(false);
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<string[]>([]);
  const [kickingUserId, setKickingUserId] = useState<number | null>(null);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(
    null,
  );
  const [confirmKickUser, setConfirmKickUser] = useState<UserAccount | null>(
    null,
  );

  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [activeUser, setActiveUser] = useState<UserAccount | null>(null);
  const [loadingDialogData, setLoadingDialogData] = useState(false);
  const [savingDialogData, setSavingDialogData] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const fetchWhitelist = async () => {
    if (!token) return;
    try {
      const res = await authFetch("/api/auth/whitelist", token, {}, logout);
      if (res.ok) {
        const data = await res.json();
        const formatted = (data || []).map((email: string) => ({ email }));
        setWhitelist(formatted);
      }
    } catch (err) {
      console.error("Failed to fetch whitelist:", err);
    } finally {
      setLoadingWhitelist(false);
    }
  };

  const fetchUsersAndProjects = async () => {
    if (!token) return;
    try {
      const [usersRes, projectsRes, permissionsRes] = await Promise.all([
        authFetch("/api/auth/users", token, {}, logout),
        authFetch("/api/projects", token, {}, logout),
        authFetch("/api/auth/permissions", token, {}, logout),
      ]);

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData || []);
      }
      if (projectsRes.ok) {
        const projectsData = await projectsRes.json();
        setProjects(projectsData || []);
      }
      if (permissionsRes.ok) {
        const permissionsData = await permissionsRes.json();
        setAvailablePermissions(permissionsData?.permissions || []);
      }
    } catch (err) {
      console.error("Failed to fetch users/projects:", err);
    }
  };

  useEffect(() => {
    fetchWhitelist();
    fetchUsersAndProjects();
  }, [token]);

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    setAdding(true);

    try {
      const res = await authFetch(
        "/api/auth/whitelist",
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: newEmail.trim() }),
        },
        logout,
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add email");
      }

      toast.success(`Email ${newEmail} whitelisted successfully`);
      setNewEmail("");
      await fetchWhitelist();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteEmail = async (email: string) => {
    setDeletingEmail(email);
    try {
      const res = await authFetch(
        `/api/auth/whitelist/${email}`,
        token,
        {
          method: "DELETE",
        },
        logout,
      );

      if (!res.ok) {
        throw new Error("Failed to remove email");
      }

      toast.success(`Removed ${email} from whitelist`);
      await fetchWhitelist();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeletingEmail(null);
      setConfirmDeleteEmail(null);
    }
  };

  const openPermissionsDialog = async (targetUser: UserAccount) => {
    setActiveUser(targetUser);
    setPermissionsDialogOpen(true);
    setLoadingDialogData(true);
    try {
      const [projectAccessRes, permissionsRes] = await Promise.all([
        authFetch(`/api/auth/users/${targetUser.id}/project-access`, token, {}, logout),
        authFetch(`/api/auth/users/${targetUser.id}/permissions`, token, {}, logout),
      ]);

      if (projectAccessRes.ok) {
        const data = await projectAccessRes.json();
        setSelectedProjectIds(data?.projectIds || []);
      } else {
        setSelectedProjectIds([]);
      }

      if (permissionsRes.ok) {
        const data = await permissionsRes.json();
        setSelectedPermissions(data?.permissions || []);
      } else {
        setSelectedPermissions([]);
      }
    } catch (err) {
      console.error("Failed to load user permissions/access:", err);
      setSelectedProjectIds([]);
      setSelectedPermissions([]);
      toast.error("Failed to load user access details");
    } finally {
      setLoadingDialogData(false);
    }
  };

  const handleSaveUserAccessAndPermissions = async () => {
    if (!activeUser) return;
    setSavingDialogData(true);
    try {
      const projectRes = await authFetch(
        `/api/auth/users/${activeUser.id}/project-access`,
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectIds: selectedProjectIds }),
        },
        logout,
      );

      if (!projectRes.ok) {
        const data = await projectRes.json();
        throw new Error(data.error || "Failed to update project access");
      }

      const permissionRes = await authFetch(
        `/api/auth/users/${activeUser.id}/permissions`,
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: selectedPermissions }),
        },
        logout,
      );
      if (!permissionRes.ok) {
        const data = await permissionRes.json();
        throw new Error(data.error || "Failed to update permissions");
      }

      toast.success(`Updated access for ${activeUser.email}`);
      setPermissionsDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingDialogData(false);
    }
  };

  const handleKickUser = async (targetUser: UserAccount) => {
    setKickingUserId(targetUser.id);
    try {
      const res = await authFetch(
        `/api/auth/users/${targetUser.id}`,
        token,
        { method: "DELETE" },
        logout,
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to kick user");
      }

      toast.success(`Removed user ${targetUser.email}`);
      await fetchUsersAndProjects();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setKickingUserId(null);
      setConfirmKickUser(null);
    }
  };

  const toggleProjectSelection = (projectId: number) => {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  };

  const togglePermissionSelection = (permission: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission],
    );
  };

  if (!user?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <ShieldCheckIcon size={48} className="text-red-500/50 mb-4" />
        <h2 className="text-xl font-medium text-neutral-200 mb-2">Access Denied</h2>
        <p className="text-sm text-neutral-500 max-w-sm">
          You must be an administrator to manage users and whitelist.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {showHeader && (
        <div className="flex flex-row border-b border-border p-4 items-center gap-4">
          <div className="flex flex-row items-center gap-3 flex-1">
            <UsersIcon size={24} weight="bold" className="text-blue-400" />
            <h1 className="text-2xl font-medium text-neutral-100">Users & Whitelist</h1>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
            <h2 className="text-sm font-medium text-neutral-200 mb-4">
              Whitelisted Registration
            </h2>
            <p className="text-sm text-neutral-500 mb-6 leading-relaxed">
              Baseful is set to admin-only registration. Subsequent users must have
              their email whitelisted here before they can create an account.
            </p>

            <form onSubmit={handleAddEmail} className="flex gap-2">
              <div className="relative flex-1">
                <EnvelopeIcon
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                />
                <Input
                  type="email"
                  placeholder="colleague@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="pl-10 bg-neutral-900 border-border"
                  required
                />
              </div>
              <Button type="submit" disabled={adding || !newEmail.trim()} className="gap-2">
                {adding ? (
                  "Adding..."
                ) : (
                  <>
                    <PlusIcon size={16} weight="bold" />
                    Whitelist Email
                  </>
                )}
              </Button>
            </form>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border bg-neutral-900/30">
              <h3 className="text-sm font-medium text-neutral-200">Registered Users</h3>
            </div>
            <div className="divide-y divide-border">
              {users.length === 0 ? (
                <div className="p-12 text-center">
                  <UsersIcon size={32} className="mx-auto text-neutral-700 mb-3" />
                  <p className="text-sm text-neutral-500">No registered users yet.</p>
                </div>
              ) : (
                users.map((account) => (
                  <div
                    key={account.id}
                    className="px-6 py-4 flex items-center justify-between gap-3 hover:bg-neutral-800/10 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-blue-400 overflow-hidden bg-blue-500/10">
                        {account.avatarUrl ? (
                          <img
                            src={account.avatarUrl}
                            className="size-full object-cover"
                            alt=""
                          />
                        ) : (
                          <LetterAvatar
                            name={account.email}
                            size={32}
                            className="rounded-full"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-neutral-300 font-mono truncate">
                          {account.email}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {account.isAdmin ? "Admin" : "User"}
                          {account.id === user.id ? " • You" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => openPermissionsDialog(account)}
                      >
                        <GearSixIcon size={14} />
                        Permissions
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setConfirmKickUser(account)}
                        disabled={account.id === user.id || kickingUserId === account.id}
                      >
                        <SignOutIcon size={14} />
                        {kickingUserId === account.id ? "Kicking..." : "Kick"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border bg-neutral-900/30">
              <h3 className="text-sm font-medium text-neutral-200">Whitelisted Emails</h3>
            </div>
            <div className="divide-y divide-border">
              {loadingWhitelist ? (
                <div className="p-8 text-center text-sm text-neutral-500">
                  Loading whitelist...
                </div>
              ) : whitelist.length === 0 ? (
                <div className="p-12 text-center">
                  <EnvelopeIcon size={32} className="mx-auto text-neutral-700 mb-3" />
                  <p className="text-sm text-neutral-500">No emails whitelisted yet.</p>
                </div>
              ) : (
                whitelist.map((item, idx) => (
                  <div
                    key={idx}
                    className="px-6 py-4 flex items-center justify-between group hover:bg-neutral-800/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                        <span className="text-xs font-bold uppercase">{item.email[0]}</span>
                      </div>
                      <span className="text-sm text-neutral-300 font-mono">{item.email}</span>
                    </div>
                    <button
                      onClick={() => setConfirmDeleteEmail(item.email)}
                      disabled={deletingEmail === item.email}
                      className="p-2 text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      title="Remove from whitelist"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteEmail !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteEmail(null);
        }}
        title="Remove Whitelisted Email?"
        description={
          confirmDeleteEmail
            ? `Are you sure you want to remove ${confirmDeleteEmail} from the whitelist?`
            : ""
        }
        confirmText="Remove"
        confirmVariant="destructive"
        loading={deletingEmail !== null}
        onConfirm={async () => {
          if (!confirmDeleteEmail) return;
          await handleDeleteEmail(confirmDeleteEmail);
        }}
      />
      <ConfirmDialog
        open={confirmKickUser !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmKickUser(null);
        }}
        title="Kick User?"
        description={
          confirmKickUser
            ? `Kick ${confirmKickUser.email}? This removes the account completely and they will be signed out on their next request.`
            : ""
        }
        confirmText="Kick User"
        confirmVariant="destructive"
        loading={kickingUserId !== null}
        onConfirm={async () => {
          if (!confirmKickUser) return;
          await handleKickUser(confirmKickUser);
        }}
      />
      <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
        <DialogContent className="max-w-xl bg-card">
          <DialogHeader>
            <DialogTitle>Manage User Access</DialogTitle>
            <DialogDescription>
              {activeUser
                ? `Edit project access and permissions for ${activeUser.email}.`
                : "Edit access and permissions."}
            </DialogDescription>
          </DialogHeader>

          {loadingDialogData ? (
            <p className="text-sm text-neutral-500">Loading...</p>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="text-xs uppercase tracking-wider text-neutral-500 block mb-2">
                  Allowed Projects
                </label>
                {projects.length === 0 ? (
                  <p className="text-sm text-neutral-500">No projects available.</p>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-2 rounded-md border border-border p-3">
                    {projects.map((project) => (
                      <label
                        key={project.id}
                        className="flex items-center gap-2 text-sm text-neutral-300"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProjectIds.includes(project.id)}
                          onChange={() => toggleProjectSelection(project.id)}
                          className="accent-blue-500"
                        />
                        <span>{project.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-neutral-500 block mb-2">
                  Permissions
                </label>
                {availablePermissions.length === 0 ? (
                  <p className="text-sm text-neutral-500">No permissions configured.</p>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-2 rounded-md border border-border p-3">
                    {availablePermissions.map((permission) => (
                      <label
                        key={permission}
                        className="flex items-center gap-2 text-sm text-neutral-300"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(permission)}
                          onChange={() => togglePermissionSelection(permission)}
                          className="accent-blue-500"
                        />
                        <span>{PERMISSION_LABELS[permission] || permission}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveUserAccessAndPermissions} disabled={savingDialogData}>
                  {savingDialogData ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
