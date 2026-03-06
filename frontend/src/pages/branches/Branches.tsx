import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  GitBranchIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
  PlusIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import { LetterAvatar } from "@/components/ui/letter-avatar";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Branch {
  id: number;
  database_id: number;
  name: string;
  container_id: string;
  port: number;
  status: string;
  is_default: boolean;
  created_at: string;
}

export default function Branches() {
  const { id } = useParams<{ id: string }>();
  const { token, logout } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [confirmDeleteBranchId, setConfirmDeleteBranchId] = useState<
    number | null
  >(null);

  const fetchBranches = async () => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/databases/${id}/branches`, token, {}, logout);
      if (!res.ok) {
        throw new Error("Failed to fetch branches");
      }
      const data: Branch[] = await res.json();
      setBranches(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleBranchAction = async (branchId: number, action: string) => {
    setActionLoading(`${branchId}-${action}`);
    try {
      const res = await authFetch(
        `/api/databases/${id}/branches/${branchId}/${action}`,
        token,
        {
          method: "POST",
        },
        logout
      );
      if (!res.ok) throw new Error(`Failed to ${action} branch`);

      await fetchBranches();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;

    setCreateLoading(true);
    try {
      const res = await authFetch(`/api/databases/${id}/branches`, token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newBranchName }),
      }, logout);

      if (!res.ok) {
        const data: { error?: string } = await res.json();
        throw new Error(data.error || "Failed to create branch");
      }

      setNewBranchName("");
      setCreateDialogOpen(false);
      await fetchBranches();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setCreateLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-green-600/10 text-green-300";
      case "stopped":
        return "bg-red-600/10 text-red-300";
      default:
        return "bg-gray-600/10 text-gray-300";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-400">Loading branches...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  if (!branches || branches.length === 0) {
    return (
      <div className="flex flex-col gap-6 h-full">
        <div className="flex flex-col items-center justify-between">
          <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
            <div className="flex flex-row items-center gap-3 flex-1">
              <GitBranchIcon size={24} className="text-neutral-400" />
              <h1 className="text-2xl font-medium text-neutral-100">
                Branches
              </h1>
              <span className="text-sm text-neutral-500">(0 total)</span>
            </div>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="cursor-pointer">
                  <PlusIcon size={16} className="mr-2" />
                  New Branch
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card">
                <DialogHeader>
                  <DialogTitle>Create New Branch</DialogTitle>
                  <DialogDescription>
                    Create a new branch from the current production database
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateBranch} className="mt-4 space-y-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-300 mb-2 block">
                      Branch Name
                    </label>
                    <input
                      type="text"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="e.g., staging, feature-x"
                      className="w-full bg-neutral-900 border border-border rounded-md px-3 py-2 text-sm"
                      disabled={createLoading}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCreateDialogOpen(false)}
                      disabled={createLoading}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createLoading || !newBranchName.trim()}
                    >
                      {createLoading ? "Creating..." : "Create Branch"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <div className="p-4 w-full">
            <div className="text-center py-12 text-neutral-500">
              <GitBranchIcon size={48} className="mx-auto mb-4 opacity-50" />
              <p>No branches yet</p>
              <p className="text-sm mt-2">
                Create your first branch to get started
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex flex-col items-center justify-between">
        <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
          <div className="flex flex-row items-center gap-3 flex-1">
            <GitBranchIcon size={24} className="text-neutral-400" />
            <h1 className="text-2xl font-medium text-neutral-100">Branches</h1>
            <span className="text-sm text-neutral-500">
              ({branches.length} total)
            </span>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="cursor-pointer">
                <PlusIcon size={16} className="mr-2" />
                New Branch
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card">
              <DialogHeader>
                <DialogTitle>Create New Branch</DialogTitle>
                <DialogDescription>
                  Create a new branch from the current production database
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateBranch} className="mt-4 space-y-4">
                <div>
                  <label className="text-sm font-medium text-neutral-300 mb-2 block">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="e.g., staging, feature-x"
                    className="w-full bg-neutral-900 border border-border rounded-md px-3 py-2 text-sm"
                    disabled={createLoading}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCreateDialogOpen(false)}
                    disabled={createLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createLoading || !newBranchName.trim()}
                  >
                    {createLoading ? "Creating..." : "Create Branch"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Branches List */}
        <div className="p-4 w-full">
          {branches.length === 0 ? (
            <div className="text-center py-12 text-neutral-500">
              <GitBranchIcon size={48} className="mx-auto mb-4 opacity-50" />
              <p>No branches yet</p>
              <p className="text-sm mt-2">
                Create your first branch to get started
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="bg-card border border-border rounded-lg p-4 hover:border-neutral-600 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <LetterAvatar
                        name={branch.name}
                        size={40}
                        className="rounded-sm"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-medium text-neutral-100">
                            {branch.name}
                          </h3>
                          {branch.is_default && (
                            <span className="bg-blue-600/20 text-blue-300 text-xs px-2 py-0.5 rounded-full">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-neutral-500">
                          <span>Port: {branch.port}</span>
                          <span>
                            Created:{" "}
                            {new Date(branch.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Status Badge */}
                      <div
                        className={`${getStatusColor(branch.status)} text-xs uppercase h-fit w-fit px-2 py-1 rounded-sm`}
                      >
                        {branch.status}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {branch.status === "stopped" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              handleBranchAction(branch.id, "start")
                            }
                            disabled={actionLoading !== null}
                            title="Start branch"
                          >
                            <PlayIcon size={16} />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              handleBranchAction(branch.id, "stop")
                            }
                            disabled={actionLoading !== null}
                            title="Stop branch"
                          >
                            <StopIcon size={16} />
                          </Button>
                        )}

                        {!branch.is_default && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              handleBranchAction(branch.id, "switch")
                            }
                            disabled={actionLoading !== null}
                            title="Switch to this branch"
                          >
                            <CheckIcon size={16} />
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setConfirmDeleteBranchId(branch.id)}
                          disabled={actionLoading !== null || branch.is_default}
                          title="Delete branch"
                        >
                          <TrashIcon size={16} />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDeleteBranchId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteBranchId(null);
        }}
        title="Delete Branch?"
        description="Are you sure you want to delete this branch? This will remove the container and all data."
        confirmText="Delete"
        confirmVariant="destructive"
        loading={Boolean(actionLoading && actionLoading.endsWith("-delete"))}
        onConfirm={async () => {
          if (confirmDeleteBranchId === null) return;
          await handleBranchAction(confirmDeleteBranchId, "delete");
          setConfirmDeleteBranchId(null);
        }}
      />
    </div>
  );
}
