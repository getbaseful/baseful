import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login, user, isInitialized } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, firstName, lastName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Registration failed");
      }

      login(data.token, data.user);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium tracking-tight text-foreground">
          {!isInitialized ? "Admin Setup" : "Sign Up"}
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">
          {!isInitialized
            ? "Create the first account to become the system Admin"
            : "Register your account to manage your databases"}
        </p>
      </div>

      <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="firstName"
                className="block text-sm font-medium text-muted-foreground"
              >
                First Name
              </label>
              <input
                id="firstName"
                type="text"
                required
                className="mt-1 bg-card md:bg-background block w-full rounded-md border border-border px-3 py-2 text-foreground shadow-sm focus:ring-0 focus:outline-none sm:text-sm"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="lastName"
                className="block text-sm font-medium text-muted-foreground"
              >
                Last Name
              </label>
              <input
                id="lastName"
                type="text"
                required
                className="mt-1 block w-full rounded-md border border-border bg-card md:bg-background px-3 py-2 text-foreground shadow-sm focus:ring-0 focus:outline-none sm:text-sm"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-muted-foreground"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              className="mt-1 block w-full rounded-md border border-border bg-card md:bg-background px-3 py-2 text-foreground shadow-sm focus:ring-0 focus:outline-none sm:text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-muted-foreground"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              className="mt-1 block w-full rounded-md border border-border bg-card md:bg-background px-3 py-2 text-foreground shadow-sm focus:ring-0 focus:outline-none sm:text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!isInitialized && (
              <p className="mt-2 text-xs text-muted-foreground italic">
                Keep this password safe, this will be your admin account.
              </p>
            )}
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center rounded-md border border-transparent bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50"
          >
            {loading
              ? "Creating account..."
              : !isInitialized
                ? "Create Admin account"
                : "Get started"}
          </button>
        </div>
      </form>

      {isInitialized && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-semibold text-primary hover:text-primary/80"
          >
            Log in
          </Link>
        </p>
      )}
    </div>
  );
}
