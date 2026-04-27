import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderPlusIcon } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface CreateProjectDialogProps {
  onProjectCreated: (project?: {
    id: number;
    name: string;
    description?: string;
  }) => void;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function CreateProjectDialog({
  onProjectCreated,
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: CreateProjectDialogProps) {
  const { token, logout } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const shouldRenderTrigger = Boolean(children) || controlledOpen === undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await authFetch("/api/projects", token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, description }),
      }, logout);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create project");
      }

      const createdProject = await response.json();
      setName("");
      setDescription("");
      setOpen(false);
      onProjectCreated(createdProject);
    } catch (error: any) {
      setError(error.message);
      console.error("Error creating project:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {shouldRenderTrigger ? (
        <DialogTrigger asChild>
          {children || (
            <Button variant="ghost" size="sm" className="cursor-pointer">
              <FolderPlusIcon size={16} />
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent className="p-0 gap-0! bg-card">
        <DialogHeader className="border-b border-border p-4 mb-0! gap-0">
          <DialogTitle className="text-xl font-medium">Create Project</DialogTitle>
          <DialogDescription>
            Create a new project to organize your databases. Projects help you
            group related databases together.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-4">
          <div className="grid gap-4 py-4">
            {error && (
              <div className="p-3 text-sm bg-red-500/10 border border-red-500/20 text-red-400 rounded-md">
                {error}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="name" className="text-neutral-400 uppercase tracking-wider text-xs font-medium">
                Project Name
              </Label>
              <Input
                id="name"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description" className="text-neutral-400 uppercase tracking-wider text-xs font-medium">
                Description (optional)
              </Label>
              <Input
                id="description"
                placeholder="A brief description of this project"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
