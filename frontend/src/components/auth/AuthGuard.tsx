import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const { user, isLoading, isInitialized } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (isLoading) return;

        if (!isInitialized) {
            // System not setup yet, send to register
            if (location.pathname !== "/register") {
                navigate("/register");
            }
        } else if (!user) {
            // User not logged in, send to login
            if (location.pathname !== "/login" && location.pathname !== "/register") {
                navigate("/login");
            }
        }
    }, [user, isLoading, isInitialized, navigate, location.pathname]);

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return <>{children}</>;
}
