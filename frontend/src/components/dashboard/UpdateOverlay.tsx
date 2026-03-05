import { useState, useEffect } from "react";
import { SpinnerIcon } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

const AuroraOverlayContent = () => (
    <div className="fixed inset-0 z-[9999] pointer-events-auto flex items-center justify-center overflow-hidden">
        {/* Full screen backdrop */}
        <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-6 text-center px-6">
            <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight text-white">
                    System Update in Progress
                </h2>
                <p className="text-neutral-400 max-w-md mx-auto text-lg">
                    Installing the latest features and security patches. This will take a
                    moment.
                </p>
            </div>
            <SpinnerIcon size={32} className="animate-spin text-blue-500" />
        </div>
    </div>
);

export default function UpdateOverlay() {
    const { token, logout } = useAuth();
    const [isUpdating, setIsUpdating] = useState(false);
    const [currentHash, setCurrentHash] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;

        const checkStatus = async () => {
            try {
                const res = await authFetch("/api/system/update-status", token, {}, logout);
                if (!res.ok) throw new Error("Status failed");
                const data = await res.json();

                // If we just finished an update (hash changed)
                if (currentHash && data.currentHash !== currentHash) {
                    setIsUpdating(false);
                    setTimeout(() => window.location.reload(), 500);
                    return;
                }

                setCurrentHash(data.currentHash);
                setIsUpdating(data.updatingStatus);
            } catch (e) {
                // If system is unreachable, it might be restarting
                console.log("System unreachable, likely restarting...");
            }
        };

        // Initial check
        checkStatus();

        // Poll frequently during update, otherwise slower
        const interval = setInterval(checkStatus, isUpdating ? 2000 : 10000);

        return () => clearInterval(interval);
    }, [token, isUpdating, currentHash]);

    if (!isUpdating) return null;

    return <AuroraOverlayContent />;
}
