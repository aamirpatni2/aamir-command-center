import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { Button, Field } from "@acc/ui";
import { useAuth } from "../lib/auth.js";
import { ApiError } from "../lib/api.js";
import { BrandMark } from "../components/Layout.js";

export function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const done = params.get("done"); // arriving from an invite / reset link
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
    <div className="relative grid min-h-full place-items-center overflow-hidden px-4 py-10">
      {/* Ambient orbs behind the sign-in card. */}
      <div aria-hidden className="pointer-events-none absolute top-[12%] left-1/2 size-[520px] -translate-x-[70%] rounded-full bg-brand-1/25 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute top-[30%] left-1/2 size-[420px] -translate-x-[10%] rounded-full bg-viz-cyan/10 blur-[120px]" />

      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto mb-5 size-14" />
          <h1 className="text-gradient font-display text-2xl font-semibold tracking-tight">Aamir AI Command Center</h1>
          <p className="mt-1.5 text-sm text-ink-2">Sign in to your agents, approvals and pipeline</p>
        </div>
        <form onSubmit={onSubmit} className="glass space-y-4 rounded-3xl p-7 shadow-pop">
          {done && (
            <p role="status" className="rounded-xl border border-status-good/30 bg-status-good/10 px-3 py-2 text-sm text-status-good">
              {done === "reset" ? "Password changed." : "Your password is set."} Sign in to continue.
            </p>
          )}
          <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus={!done} defaultValue={params.get("email") ?? undefined} />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required autoFocus={!!done} />
          {error && (
            <p role="alert" className="rounded-xl border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full py-2.5" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-ink-3">There's no public sign-up. The owner creates accounts.</p>
      </div>
    </div>
  );
}
