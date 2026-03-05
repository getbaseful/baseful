import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { authFetch } from "@/lib/api";

interface Project {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

interface ProjectContextType {
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  projects: Project[];
  refreshProjects: () => Promise<void>;
  createProject: (name: string, description: string) => Promise<Project | null>;
  updateProjectName: (projectId: number, name: string) => Promise<boolean>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}

interface ProjectProviderProps {
  children: ReactNode;
}

export function ProjectProvider({ children }: ProjectProviderProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const { id: urlProjectId } = useParams<{ id: string }>();
  const { token, logout } = useAuth();

  const fetchProjects = async () => {
    if (!token) return;
    try {
      const response = await authFetch("/api/projects", token, {}, logout);

      if (response.status === 401) {
        logout();
        return;
      }

      const data = await response.json();
      setProjects(data || []);

      // Sync selected project with URL
      const projectsList = data || [];
      if (urlProjectId) {
        const projectFromUrl = projectsList.find(
          (p: Project) => p.id === parseInt(urlProjectId),
        );
        if (projectFromUrl) {
          setSelectedProject(projectFromUrl);
        }
      } else if (projectsList.length > 0 && !selectedProject) {
        setSelectedProject(projectsList[0]);
      }
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    }
  };

  const createProject = async (
    name: string,
    description: string,
  ): Promise<Project | null> => {
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

      const newProject = await response.json();
      await fetchProjects();
      return newProject;
    } catch (error) {
      console.error("Error creating project:", error);
      return null;
    }
  };

  const updateProjectName = async (
    projectId: number,
    name: string,
  ): Promise<boolean> => {
    try {
      const response = await authFetch(`/api/projects/${projectId}`, token, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      }, logout);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update project");
      }

      await fetchProjects();
      return true;
    } catch (error) {
      console.error("Error updating project:", error);
      return false;
    }
  };

  useEffect(() => {
    if (token) {
      fetchProjects();
    }
  }, [urlProjectId, token]);

  return (
    <ProjectContext.Provider
      value={{
        selectedProject,
        setSelectedProject,
        projects,
        refreshProjects: fetchProjects,
        createProject,
        updateProjectName,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
