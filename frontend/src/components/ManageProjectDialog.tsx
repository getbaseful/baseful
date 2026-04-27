import { useState, useEffect } from "react";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import { toast } from "sonner";
import { LetterAvatar } from "@/components/ui/letter-avatar";

interface User {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
}

interface ManageProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: { id: number; name: string } | null;
    onProjectUpdated: () => void;
}

export function ManageProjectDialog({
    open,
    onOpenChange,
    project,
    onProjectUpdated,
}: ManageProjectDialogProps) {
    const { token, logout, user: currentUser, hasPermission } = useAuth();
    const canEditProject = currentUser?.isAdmin || hasPermission("edit_projects");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [projectUsers, setProjectUsers] = useState<number[]>([]);
    const [projectMembers, setProjectMembers] = useState<User[]>([]); // full objects for read-only view
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [isMobileDrawer, setIsMobileDrawer] = useState(false);

    useEffect(() => {
        const updateMobileDrawer = () => {
            if (typeof window === "undefined") return;
            setIsMobileDrawer(window.innerWidth < 768);
        };
        updateMobileDrawer();
        window.addEventListener("resize", updateMobileDrawer);
        return () => window.removeEventListener("resize", updateMobileDrawer);
    }, []);

    useEffect(() => {
        if (project) {
            setName(project.name);
            fetchProjectData();
        } else {
            setName("");
            setProjectUsers([]);
        }
    }, [project, open]);

    const fetchProjectData = async () => {
        if (!project || !token) return;
        setLoadingUsers(true);
        try {
            const [usersRes, accessRes] = await Promise.all([
                authFetch("/api/auth/users", token, {}, logout),
                authFetch(`/api/projects/${project.id}/users`, token, {}, logout)
            ]);

            if (usersRes.ok) {
                setAllUsers(await usersRes.json());
            }
            if (accessRes.ok) {
                const access: any[] = await accessRes.json() || [];
                setProjectMembers(access); // full user objects
                setProjectUsers(access.map((u) => u.id)); // just IDs for checkboxes
            }
        } catch (err) {
            console.error("Failed to load project details:", err);
            toast.error("Failed to load project details");
        } finally {
            setLoadingUsers(false);
        }
    };

    const handleSave = async () => {
        if (!project || !token || !name.trim()) return;
        setLoading(true);
        try {
            // Update Name (only if user has permission)
            if (canEditProject) {
                const updateRes = await authFetch(
                    `/api/projects/${project.id}`,
                    token,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: name.trim() }),
                    },
                    logout
                );

                if (!updateRes.ok) {
                    throw new Error("Failed to update project name");
                }
            }

            // Update Users
            // Only attempt if admin (or have permissions - backend enforces this)
            if (currentUser?.isAdmin) {
                const accessRes = await authFetch(
                    `/api/projects/${project.id}/users`,
                    token,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userIds: projectUsers }),
                    },
                    logout
                );

                if (!accessRes.ok) {
                    throw new Error("Failed to update project users");
                }
            }

            toast.success("Project updated");
            onProjectUpdated();
            onOpenChange(false);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleUserAccess = (userId: number) => {
        if (currentUser?.isAdmin && currentUser.id === userId) {
            return;
        }

        setProjectUsers((prev) =>
            prev.includes(userId)
                ? prev.filter((id) => id !== userId)
                : [...prev, userId]
        );
    };

    if (!project) return null;

    return (
        <Drawer
            open={open}
            onOpenChange={onOpenChange}
            direction={isMobileDrawer ? "bottom" : "right"}
        >
            <DrawerContent
                className={
                    isMobileDrawer
                        ? "h-[88vh] !max-h-none w-full bg-card border-t border-border rounded-none"
                        : "h-full bg-card border-l border-border rounded-none"
                }
            >
                <DrawerHeader>
                    <DrawerTitle>{project.name}</DrawerTitle>
                </DrawerHeader>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-6 p-4">
                    {canEditProject && (
                        <div className="space-y-2">
                            <label className="text-xs uppercase tracking-wider text-neutral-500">
                                Project Name
                            </label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. My Custom Analytics"
                                className="bg-neutral-900 border-neutral-800"
                            />
                        </div>
                    )}

                    {currentUser?.isAdmin && (
                        <div className="space-y-2">
                            <label className="text-xs uppercase tracking-wider text-neutral-500">
                                User Access
                            </label>
                            {loadingUsers ? (
                                <p className="text-sm text-neutral-500">Loading users...</p>
                            ) : allUsers.length === 0 ? (
                                <p className="text-sm text-neutral-500">No users found.</p>
                            ) : (
                                <div className="max-h-60 overflow-y-auto space-y-2 rounded-md border border-neutral-800 p-3 bg-neutral-900/50">
                                    {allUsers.map((u) => {
                                        const isCurrentAdmin = currentUser?.isAdmin && currentUser.id === u.id;

                                        return (
                                            <label
                                                key={u.id}
                                                className={`flex items-center gap-3 text-sm text-neutral-300 ${isCurrentAdmin ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:text-white"}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={projectUsers.includes(u.id)}
                                                    disabled={Boolean(isCurrentAdmin)}
                                                    onChange={() => toggleUserAccess(u.id)}
                                                    className="accent-blue-500 w-4 h-4 rounded bg-neutral-800 border-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                />
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full flex items-center justify-center overflow-hidden bg-muted bg-blue-500/10 text-blue-400">
                                                        {u.avatarUrl ? (
                                                            <img src={u.avatarUrl} className="size-full object-cover" alt="" />
                                                        ) : (
                                                            <LetterAvatar
                                                                name={u.email}
                                                                size={24}
                                                            />
                                                        )}
                                                    </div>
                                                    <span className="font-medium text-xs">{u.email}</span>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {!currentUser?.isAdmin && (
                        <div className="space-y-2">
                            <label className="text-xs uppercase tracking-wider text-neutral-500">
                                Team Members
                            </label>
                            {loadingUsers ? (
                                <p className="text-sm text-neutral-500">Loading...</p>
                            ) : (
                                <div className="space-y-2 rounded-md border border-neutral-800 p-3 bg-neutral-900/50">
                                    {projectMembers.map((u) => (
                                        <div key={u.id} className="flex items-center gap-2.5 text-sm text-neutral-300">
                                            <div className="w-6 h-6 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0">
                                                {u.avatarUrl ? (
                                                    <img src={u.avatarUrl} className="size-full object-cover" alt="" />
                                                ) : (
                                                    <LetterAvatar
                                                        name={u.email}
                                                        size={24}
                                                    />
                                                )}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-xs font-medium truncate">
                                                    {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}
                                                </span>
                                                {u.firstName && <span className="text-[10px] text-neutral-500 truncate">{u.email}</span>}
                                            </div>
                                        </div>
                                    ))}
                                    {projectMembers.length === 0 && (
                                        <p className="text-xs text-neutral-500">No members assigned.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {(canEditProject || currentUser?.isAdmin) && (
                    <div className="p-4 border-t border-border">
                        <Button onClick={handleSave} disabled={loading || (canEditProject && !name.trim())} className="w-full">
                            {loading ? "Saving..." : "Save Changes"}
                        </Button>
                    </div>
                )}
            </DrawerContent>
        </Drawer>
    );
}
