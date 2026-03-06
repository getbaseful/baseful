import { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { authFetch } from "../lib/api";
import { Camera, Lock, User, At, ArrowLeft, SignOut } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { LetterAvatar } from "@/components/ui/letter-avatar";

export default function Profile() {
    const { user, token, updateUser, logout } = useAuth();
    const [firstName, setFirstName] = useState(user?.firstName || "");
    const [lastName, setLastName] = useState(user?.lastName || "");
    const [email, setEmail] = useState(user?.email || "");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [profileLoading, setProfileLoading] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [avatarLoading, setAvatarLoading] = useState(false);
    const [openRouterApiKey, setOpenRouterApiKey] = useState("");
    const [openRouterConfigured, setOpenRouterConfigured] = useState(false);
    const [openRouterMaskedKey, setOpenRouterMaskedKey] = useState("");
    const [openRouterLoading, setOpenRouterLoading] = useState(false);
    const [openRouterSaving, setOpenRouterSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const loadOpenRouterStatus = async () => {
            if (!token) return;
            setOpenRouterLoading(true);
            try {
                const res = await authFetch("/api/auth/openrouter-key", token, {}, logout);
                if (!res.ok) {
                    throw new Error("Failed to load OpenRouter key status");
                }
                const data = await res.json();
                setOpenRouterConfigured(Boolean(data.configured));
                setOpenRouterMaskedKey(data.maskedKey || "");
            } catch {
                // Keep the profile usable even if this fails.
            } finally {
                setOpenRouterLoading(false);
            }
        };
        loadOpenRouterStatus();
    }, [token, logout]);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setProfileLoading(true);
        setMessage(null);

        try {
            const res = await authFetch("/api/auth/profile", token, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, firstName, lastName }),
            }, logout);

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to update profile");
            }

            if (user) {
                updateUser({ ...user, email, firstName, lastName });
            }
            setMessage({ type: "success", text: "Profile updated successfully" });
        } catch (err: any) {
            setMessage({ type: "error", text: err.message });
        } finally {
            setProfileLoading(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;
        if (newPassword !== confirmPassword) {
            setMessage({ type: "error", text: "New passwords do not match" });
            return;
        }

        setPasswordLoading(true);
        setMessage(null);

        try {
            const res = await authFetch("/api/auth/password", token, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            }, logout);

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to change password");
            }

            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setMessage({ type: "success", text: "Password updated successfully" });
        } catch (err: any) {
            setMessage({ type: "error", text: err.message });
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !token) return;

        setAvatarLoading(true);
        setMessage(null);

        const formData = new FormData();
        formData.append("avatar", file);

        try {
            const res = await authFetch("/api/auth/avatar", token, {
                method: "POST",
                body: formData,
            }, logout);

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to upload avatar");
            }

            const data = await res.json();
            if (user) {
                updateUser({ ...user, avatarUrl: data.avatarUrl });
            }
            setMessage({ type: "success", text: "Profile picture updated" });
        } catch (err: any) {
            setMessage({ type: "error", text: err.message });
        } finally {
            setAvatarLoading(false);
        }
    };

    const saveOpenRouterKey = async (apiKeyValue: string) => {
        if (!token) return;
        setOpenRouterSaving(true);
        setMessage(null);
        try {
            const res = await authFetch("/api/auth/openrouter-key", token, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: apiKeyValue.trim() }),
            }, logout);

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to save OpenRouter key");
            }

            setOpenRouterConfigured(Boolean(data.configured));
            setOpenRouterMaskedKey(data.maskedKey || "");
            setOpenRouterApiKey("");
            setMessage({
                type: "success",
                text: data.configured
                    ? "OpenRouter API key saved"
                    : "OpenRouter API key removed",
            });
        } catch (err: any) {
            setMessage({ type: "error", text: err.message });
        } finally {
            setOpenRouterSaving(false);
        }
    };

    const handleSaveOpenRouterKey = async (e: React.FormEvent) => {
        e.preventDefault();
        await saveOpenRouterKey(openRouterApiKey);
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/" className="p-2 hover:bg-card rounded-full transition-colors text-muted-foreground hover:text-foreground">
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Profile Settings</h1>
                        <p className="text-muted-foreground text-sm">Manage your account information and security</p>
                    </div>
                </div>
            </header>

            {message && (
                <div className={`p-4 rounded-lg text-sm ${message.type === "success"
                    ? "bg-green-500/10 text-green-500 border border-green-500/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                    }`}>
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Profile Stats / Avatar Sidebar */}
                <div className="space-y-6">
                    <div className="bg-card border border-border rounded-xl p-6 text-center shadow-sm">
                        <div className="relative inline-block group">
                            <div className="size-24 rounded-full overflow-hidden border-2 border-primary/20 bg-muted flex items-center justify-center">
                                {avatarLoading ? (
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                                ) : user?.avatarUrl ? (
                                    <img src={user.avatarUrl} className="size-full object-cover" alt="" />
                                ) : (
                                    <LetterAvatar
                                        name={user?.email || ""}
                                        size={96}
                                        className="rounded-full"
                                    />
                                )}
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="absolute bottom-0 right-0 p-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:scale-110 active:scale-95 transition-all"
                            >
                                <Camera size={16} weight="bold" />
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleAvatarUpload}
                                className="hidden"
                                accept="image/*"
                            />
                        </div>
                        <div className="mt-4">
                            <h3 className="font-semibold text-lg">{user?.firstName} {user?.lastName}</h3>
                            <p className="text-sm text-muted-foreground">{user?.email}</p>
                        </div>
                        <div className="mt-6 pt-6 border-t border-border/50">
                            <div className="flex justify-between text-xs px-2">
                                <span className="text-muted-foreground">Role</span>
                                <span className="font-medium text-blue-400 capitalize">{user?.isAdmin ? "Admin" : "User"}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <button
                    onClick={logout}
                    className="flex-1 flex items-center justify-center gap-2 h-8 rounded-md bg-secondary hover:bg-secondary/80 text-xs font-medium transition-colors"
                    title="Sign Out"
                >
                    <SignOut size={14} />
                    <span>Sign Out</span>
                </button>
                {/* Forms Area */}
                <div className="md:col-span-2 space-y-8">
                    {/* General Information */}
                    <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-6 text-foreground font-semibold">
                            <User size={18} weight="bold" className="text-primary" />
                            <h2>General Information</h2>
                        </div>
                        <form onSubmit={handleUpdateProfile} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">First Name</label>
                                    <input
                                        type="text"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        className="w-full h-10 px-3 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Last Name</label>
                                    <input
                                        type="text"
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        className="w-full h-10 px-3 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">Email Address</label>
                                <div className="relative">
                                    <At size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full h-10 pl-9 pr-3 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={profileLoading}
                                className="mt-2 px-4 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                            >
                                {profileLoading ? "Saving..." : "Save Changes"}
                            </button>
                        </form>
                    </section>

                    {/* Change Password */}
                    <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-6 text-foreground font-semibold">
                            <Lock size={18} weight="bold" className="text-primary" />
                            <h2>Change Password</h2>
                        </div>
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">Current Password</label>
                                <input
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className="w-full h-10 px-3 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">New Password</label>
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full h-10 px-3 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
                                        required
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Confirm Password</label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full h-10 px-3 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
                                        required
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={passwordLoading}
                                className="mt-2 px-4 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                            >
                                {passwordLoading ? "Updating..." : "Update Password"}
                            </button>
                        </form>
                    </section>

                    <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-6 text-foreground font-semibold">
                            <Lock size={18} weight="bold" className="text-primary" />
                            <h2>AI Assistant (OpenRouter)</h2>
                        </div>
                        <form onSubmit={handleSaveOpenRouterKey} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">OpenRouter API Key</label>
                                <input
                                    type="password"
                                    value={openRouterApiKey}
                                    onChange={(e) => setOpenRouterApiKey(e.target.value)}
                                    className="w-full h-10 px-3 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
                                    placeholder={openRouterConfigured ? `Configured: ${openRouterMaskedKey}` : "sk-or-v1-..."}
                                    autoComplete="off"
                                />
                                <p className="text-xs text-muted-foreground">
                                    {openRouterLoading
                                        ? "Checking key status..."
                                        : openRouterConfigured
                                            ? "A key is currently configured for your account."
                                            : "No key configured yet."}
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="submit"
                                    disabled={openRouterSaving}
                                    className="mt-1 px-4 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                                >
                                    {openRouterSaving ? "Saving..." : "Save Key"}
                                </button>
                                {openRouterConfigured && (
                                    <button
                                        type="button"
                                        disabled={openRouterSaving}
                                        onClick={async () => {
                                            setOpenRouterApiKey("");
                                            await saveOpenRouterKey("");
                                        }}
                                        className="mt-1 px-4 h-10 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50"
                                    >
                                        Remove Key
                                    </button>
                                )}
                            </div>
                        </form>
                    </section>
                </div>
            </div>
        </div>
    );
}
