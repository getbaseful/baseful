import { useState, useEffect } from "react";
import {
    UsersIcon,
    PlusIcon,
    TrashIcon,
    EnvelopeIcon,
    CheckCircle,
    WarningCircle,
    ShieldCheckIcon
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface WhitelistedEmail {
    email: string;
}

export default function Users() {
    const { token, logout, user } = useAuth();
    const [whitelist, setWhitelist] = useState<WhitelistedEmail[]>([]);
    const [newEmail, setNewEmail] = useState("");
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [deletingEmail, setDeletingEmail] = useState<string | null>(null);

    const fetchWhitelist = async () => {
        if (!token) return;
        try {
            const res = await authFetch("/api/auth/whitelist", token, {}, logout);
            if (res.ok) {
                const data = await res.json();
                const formatted = (data || []).map((email: string) => ({ email }));
                setWhitelist(formatted);
            }
        } catch (err) {
            console.error("Failed to fetch whitelist:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWhitelist();
    }, [token]);

    const handleAddEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmail.trim()) return;

        setAdding(true);
        setError(null);
        setSuccess(null);

        try {
            const res = await authFetch("/api/auth/whitelist", token, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: newEmail.trim() }),
            }, logout);

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to add email");
            }

            setSuccess(`Email ${newEmail} whitelisted successfully`);
            setNewEmail("");
            await fetchWhitelist();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setAdding(false);
        }
    };

    const handleDeleteEmail = async (email: string) => {
        if (!confirm(`Are you sure you want to remove ${email} from the whitelist?`)) return;

        setDeletingEmail(email);
        try {
            const res = await authFetch(`/api/auth/whitelist/${email}`, token, {
                method: "DELETE",
            }, logout);

            if (!res.ok) {
                throw new Error("Failed to remove email");
            }

            await fetchWhitelist();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDeletingEmail(null);
        }
    };

    if (!user?.isAdmin) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <ShieldCheckIcon size={48} className="text-red-500/50 mb-4" />
                <h2 className="text-xl font-medium text-neutral-200 mb-2">Access Denied</h2>
                <p className="text-sm text-neutral-500 max-w-sm">
                    You must be an administrator to manage the user whitelist.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex flex-row border-b border-border p-4 items-center gap-4">
                <div className="flex flex-row items-center gap-3 flex-1">
                    <UsersIcon size={24} weight="bold" className="text-blue-400" />
                    <h1 className="text-2xl font-medium text-neutral-100">
                        Users & Whitelist
                    </h1>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto space-y-8">
                    {/* Add Email Section */}
                    <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
                        <h2 className="text-sm font-medium text-neutral-200 mb-4">
                            Whitelisted Registration
                        </h2>
                        <p className="text-sm text-neutral-500 mb-6 leading-relaxed">
                            Baseful is set to admin-only registration. Subsequent users must have their email whitelisted
                            here before they can create an account.
                        </p>

                        <form onSubmit={handleAddEmail} className="flex gap-2">
                            <div className="relative flex-1">
                                <EnvelopeIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                <Input
                                    type="email"
                                    placeholder="colleague@example.com"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    className="pl-10 bg-neutral-900 border-border"
                                    required
                                />
                            </div>
                            <Button type="submit" disabled={adding || !newEmail.trim()} className="gap-2">
                                {adding ? "Adding..." : (
                                    <>
                                        <PlusIcon size={16} weight="bold" />
                                        Whitelist Email
                                    </>
                                )}
                            </Button>
                        </form>

                        {error && (
                            <p className="text-xs text-red-500 mt-3 flex items-center gap-1.5">
                                <WarningCircle size={14} />
                                {error}
                            </p>
                        )}
                        {success && (
                            <p className="text-xs text-green-500 mt-3 flex items-center gap-1.5">
                                <CheckCircle size={14} />
                                {success}
                            </p>
                        )}
                    </div>

                    {/* Whitelist List */}
                    <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-neutral-900/30">
                            <h3 className="text-sm font-medium text-neutral-200">
                                Whitelisted Emails
                            </h3>
                        </div>

                        <div className="divide-y divide-border">
                            {loading ? (
                                <div className="p-8 text-center text-sm text-neutral-500">
                                    Loading whitelist...
                                </div>
                            ) : whitelist.length === 0 ? (
                                <div className="p-12 text-center">
                                    <EnvelopeIcon size={32} className="mx-auto text-neutral-700 mb-3" />
                                    <p className="text-sm text-neutral-500">No emails whitelisted yet.</p>
                                </div>
                            ) : (
                                whitelist.map((item, idx) => (
                                    <div key={idx} className="px-6 py-4 flex items-center justify-between group hover:bg-neutral-800/10 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                                                <span className="text-xs font-bold uppercase">{item.email[0]}</span>
                                            </div>
                                            <span className="text-sm text-neutral-300 font-mono">{item.email}</span>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteEmail(item.email)}
                                            disabled={deletingEmail === item.email}
                                            className="p-2 text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                                            title="Remove from whitelist"
                                        >
                                            <TrashIcon size={16} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
