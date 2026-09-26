import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Field } from "@acc/ui";
import type { LinkInfo } from "@acc/shared";
import { api, ApiError } from "../lib/api.js";
import { BrandMark } from "../components/Layout.js";

/**
 * Opened from an emailed invite or reset link: /invite#<token>. The token is in the fragment, so
 * it never reaches any server log; it's removed from the address bar as soon as it's read.
 */
export function InvitePage() {
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return setState("invalid");
    api<LinkInfo>("/api/invites/lookup", { method: "POST", body: { token } })
      .then((i) => {
        setInfo(i);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password !== String(f.get("confirm"))) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ email: string }>("/api/invites/accept", { method: "POST", body: { token, password } });
      navigate(`/login?email=${encodeURIComponent(res.email)}&done=${info?.purpose ?? "invite"}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_LINK") setState("invalid");
      else setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const invite = info?.purpose === "invite";
  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute top-[12%] left-1/2 size-[520px] -translate-x-[70%] rounded-full bg-brand-1/25 blur-[120px]" />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto mb-5 size-14" />
          <h1 className="text-gradient font-display text-2xl font-semibold tracking-tight">
            {state === "ready" ? (invite ? `Welcome, ${info!.name}` : "Choose a new password") : "Aamir AI Command Center"}
          </h1>
          {state === "ready" && (
            <p className="mt-1.5 text-sm text-ink-2">
              {invite ? "Choose a password to finish setting up your account." : "After this, you'll be signed out on your other devices."}
            </p>
          )}
        </div>
        {state === "checking" && <p className="text-center text-sm text-ink-3">Checking your link…</p>}
        {state === "invalid" && (
          <div role="alert" className="glass space-y-3 rounded-3xl p-7 text-sm text-ink-2 shadow-pop">
            <p className="font-medium text-ink">This link doesn't work any more.</p>
            <p>It may have expired or already been used. Ask the owner to send you a new one.</p>
            <Button variant="secondary" onClick={() => navigate("/login")}>Go to sign in</Button>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={onSubmit} className="glass space-y-4 rounded-3xl p-7 shadow-pop">
            <Field label="Email" name="email" type="email" autoComplete="username" value={info!.email} readOnly />
            <Field label="New password (12+ characters)" name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus />
            <Field label="Repeat password" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
            {error && <p role="alert" className="rounded-xl border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">{error}</p>}
            <Button type="submit" className="w-full py-2.5" disabled={busy}>{busy ? "Saving…" : invite ? "Set password" : "Save new password"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
