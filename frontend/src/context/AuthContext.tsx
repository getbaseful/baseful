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
    permissions?: string[];
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
    hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const COOKIE_SESSION_TOKEN = "__cookie_session__";

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
        const init = async () => {
            const storedToken = localStorage.getItem("baseful_token");
            const storedUser = localStorage.getItem("baseful_user");
            if (storedUser) {
                try {
                    const parsedUser = JSON.parse(storedUser) as User;
                    setUser({
                        ...parsedUser,
                        permissions: parsedUser.permissions || [],
                    });
                } catch {
                    localStorage.removeItem("baseful_user");
                }
            }

            try {
                const meHeaders: HeadersInit = {};
                if (storedToken) {
                    meHeaders["Authorization"] = `Bearer ${storedToken}`;
                }
                const meRes = await fetch("/api/auth/me", {
                    headers: meHeaders,
                    credentials: "include",
                });
                if (!meRes.ok) {
                    throw new Error("Session no longer valid");
                }
                const freshUser = await meRes.json();
                const normalized = {
                    ...freshUser,
                    permissions: freshUser.permissions || [],
                };
                setToken(COOKIE_SESSION_TOKEN);
                setUser(normalized);
                // Clear legacy persisted token once cookie auth is confirmed.
                localStorage.removeItem("baseful_token");
                localStorage.setItem("baseful_user", JSON.stringify(normalized));
            } catch {
                setToken(null);
                setUser(null);
                localStorage.removeItem("baseful_token");
                localStorage.removeItem("baseful_user");
            }

            await refreshStatus();
            setIsLoading(false);
        };

        void init();
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
        void newToken;
        const normalizedUser = {
            ...newUser,
            permissions: newUser.permissions || [],
        };
        setToken(COOKIE_SESSION_TOKEN);
        setUser(normalizedUser);
        // Persist profile only; session token is stored in HttpOnly cookie.
        localStorage.setItem("baseful_user", JSON.stringify(normalizedUser));
    };

    const logout = () => {
        void fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include",
        }).catch(() => {
            // Ignore network errors during logout cleanup.
        });
        setToken(null);
        setUser(null);
        localStorage.removeItem("baseful_token");
        localStorage.removeItem("baseful_user");
    };

    const updateUser = (newUser: User) => {
        const normalizedUser = {
            ...newUser,
            permissions: newUser.permissions || [],
        };
        setUser(normalizedUser);
        localStorage.setItem("baseful_user", JSON.stringify(normalizedUser));
    };

    const hasPermission = (permission: string) => {
        if (user?.isAdmin) return true;
        return Boolean(user?.permissions?.includes(permission));
    };

    const resetAdmin = async () => {
        try {
            await fetch("/api/debug/reset-admin", { method: "POST", credentials: "include" });
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
                hasPermission,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
