import {
    createContext,
    useContext,
    useState,
    useEffect,
    type ReactNode,
} from "react";

interface User {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
    isAdmin: boolean;
    avatarUrl?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    isInitialized: boolean;
    login: (token: string, user: User) => void;
    logout: () => void;
    updateUser: (user: User) => void;
    refreshStatus: () => Promise<void>;
    resetAdmin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        const storedToken = localStorage.getItem("baseful_token");
        const storedUser = localStorage.getItem("baseful_user");

        if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
        }

        refreshStatus().finally(() => setIsLoading(false));
    }, []);

    const refreshStatus = async () => {
        try {
            const response = await fetch("/api/auth/status");
            const data = await response.json();
            setIsInitialized(data.initialized);
        } catch (error) {
            console.error("Failed to fetch auth status:", error);
        }
    };

    const login = (newToken: string, newUser: User) => {
        setToken(newToken);
        setUser(newUser);
        localStorage.setItem("baseful_token", newToken);
        localStorage.setItem("baseful_user", JSON.stringify(newUser));
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem("baseful_token");
        localStorage.removeItem("baseful_user");
    };

    const updateUser = (newUser: User) => {
        setUser(newUser);
        localStorage.setItem("baseful_user", JSON.stringify(newUser));
    };

    const resetAdmin = async () => {
        try {
            await fetch("/api/debug/reset-admin", { method: "POST" });
            logout();
            await refreshStatus();
        } catch (error) {
            console.error("Failed to reset admin:", error);
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                isLoading,
                isInitialized,
                login,
                logout,
                updateUser,
                refreshStatus,
                resetAdmin,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
