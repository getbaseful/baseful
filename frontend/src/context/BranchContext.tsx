import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export interface Branch {
  id: number;
  database_id: number;
  name: string;
  container_id: string;
  port: number;
  status: string;
  is_default: boolean;
  created_at: string;
}

interface BranchContextType {
  selectedBranch: Branch | null;
  setSelectedBranch: (branch: Branch | null) => void;
  branches: Branch[];
  refreshBranches: () => Promise<void>;
  currentDatabaseId: number | null;
  setCurrentDatabaseId: (id: number | null) => void;
}

const BranchContext = createContext<BranchContextType | null>(null);

export function useBranch() {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error("useBranch must be used within a BranchProvider");
  }
  return context;
}

interface BranchProviderProps {
  children: ReactNode;
}

export function BranchProvider({ children }: BranchProviderProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [currentDatabaseId, setCurrentDatabaseId] = useState<number | null>(null);

  const fetchBranches = async (databaseId: number | null) => {
    if (!databaseId) {
      setBranches([]);
      setSelectedBranch(null);
      return;
    }

    try {
      const response = await fetch(`/api/databases/${databaseId}/branches`);
      const data: Branch[] = await response.json();
      setBranches(data || []);

      // Auto-select the default branch
      const defaultBranch = data.find((b) => b.is_default);
      if (defaultBranch) {
        setSelectedBranch(defaultBranch);
      } else if (data.length > 0) {
        setSelectedBranch(data[0]);
      } else {
        setSelectedBranch(null);
      }
    } catch (error) {
      console.error("Failed to fetch branches:", error);
      setBranches([]);
      setSelectedBranch(null);
    }
  };

  const refreshBranches = async () => {
    await fetchBranches(currentDatabaseId);
  };

  // Fetch branches when database ID changes
  useEffect(() => {
    fetchBranches(currentDatabaseId);
  }, [currentDatabaseId]);

  return (
    <BranchContext.Provider
      value={{
        selectedBranch,
        setSelectedBranch,
        branches,
        refreshBranches,
        currentDatabaseId,
        setCurrentDatabaseId,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}
