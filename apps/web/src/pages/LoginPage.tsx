import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { Button, Field } from "@acc/ui";
import { useAuth } from "../lib/auth.js";
import { ApiError } from "../lib/api.js";

export function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get("email")), String(form.get("password")));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many attempts. Please wait 15 minutes and try again."
          : err instanceof ApiError && err.status === 401
            ? "Email or password is incorrect."
            : "Could not sign in. Is the API running?",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-12" />
          <h1 className="text-xl font-semibold text-ink">Aamir AI Command Center</h1>
          <p className="mt-1 text-sm text-ink-2">Sign in to continue</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-6">
          <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          {error && (
            <p role="alert" className="rounded-lg border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-3">There's no public sign-up. The owner creates accounts.</p>
      </div>
    </div>
  );
}
