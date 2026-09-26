import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Button, Card, Field, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { PageHeader } from "../components/Layout.js";

const INTEGRATION_LABELS: Record<string, { label: string; milestone: number }> = {
  anthropic: { label: "Anthropic (Claude)", milestone: 3 },
  openai: { label: "OpenAI", milestone: 3 },
  google_ai: { label: "Google AI", milestone: 3 },
  whatsapp: { label: "WhatsApp Cloud API", milestone: 5 },
  web_search: { label: "Web search (Brave / Tavily)", milestone: 8 },
  embeddings: { label: "Semantic search (Voyage AI)", milestone: 8 },
  google_workspace: { label: "Google Workspace", milestone: 11 },
  canva: { label: "Canva", milestone: 11 },
  meta_ads: { label: "Meta Ads (read-only)", milestone: 12 },
  notion: { label: "Notion", milestone: 11 },
  email: { label: "Email (SMTP) for invites and reset links", milestone: 15 },
};

function ChangePassword() {
  const m = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api<{ otherSessionsRevoked: number }>("/api/auth/password", { method: "POST", body }),
  });
  const [mismatch, setMismatch] = useState(false);
  return (
    <Card title="Change password" icon={<KeyRound className="size-4" />}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const next = String(f.get("newPassword"));
          if (next !== String(f.get("confirm"))) return setMismatch(true);
          setMismatch(false);
          m.mutate({ currentPassword: String(f.get("currentPassword")), newPassword: next }, { onSuccess: () => (e.target as HTMLFormElement).reset() });
        }}
      >
        <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
        <Field label="New password (12+ characters)" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
        <Field label="Repeat new password" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        {mismatch && <p role="alert" className="text-sm text-status-critical">The new passwords don't match.</p>}
        {m.isError && <p role="alert" className="text-sm text-status-critical">{m.error instanceof ApiError ? m.error.message : "Failed"}</p>}
        {m.isSuccess && <p role="status" className="text-sm text-status-good">Password changed. {m.data.otherSessionsRevoked} other session(s) were signed out.</p>}
        <Button type="submit" disabled={m.isPending}>Change password</Button>
      </form>
    </Card>
  );
}

export function SettingsPage() {
  const { session, can } = useAuth();
  const [busy, setBusy] = useState(false);
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: ({ signal }) => api<{ integrations: Record<string, boolean> }>("/api/health/integrations", { signal }),
    enabled: can("mcp:read"),
  });

  async function logoutAll() {
    if (!confirm("Sign out of every device, including this one?")) return;
    setBusy(true);
    try {
      await api("/api/auth/logout-all", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Your account and which integrations have credentials." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Account">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-ink-3">Name</dt><dd className="text-ink">{session?.user.name}</dd>
            <dt className="text-ink-3">Email</dt><dd className="text-ink">{session?.user.email}</dd>
            <dt className="text-ink-3">Role</dt><dd className="text-ink capitalize">{session?.user.role}</dd>
          </dl>
          <div className="mt-4 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => void logoutAll()} disabled={busy}>Sign out of all devices</Button>
          </div>
        </Card>

        <ChangePassword />

        {can("mcp:read") && (
          <Card title="Integrations">
            <p className="mb-3 text-xs text-ink-3">
              Credentials live in the server's environment and never reach the browser. This only shows whether each one is set.
            </p>
            <ul className="divide-y divide-line">
              {Object.entries(integrations.data?.integrations ?? {}).map(([key, ok]) => (
                <li key={key} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink">
                    {INTEGRATION_LABELS[key]?.label ?? key}
                    {INTEGRATION_LABELS[key] && <span className="ml-2 text-xs text-ink-3">M{INTEGRATION_LABELS[key]!.milestone}</span>}
                  </span>
                  <StatusBadge status={ok ? "connected" : "not_configured"} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
