import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Copy, Crown, Eye, KeyRound, RefreshCw, ShieldCheck, UserPlus, UsersRound, Wrench } from "lucide-react";
import { Button, Card, cn, EmptyState, Field, StatusBadge } from "@acc/ui";
import { ROLES, type Role } from "@acc/shared";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";
import { Select } from "../components/Form.js";

interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Plain-language summary of what each role can do (the rules live in packages/shared/src/roles.ts). */
const ROLE_INFO: Record<Role, { label: string; icon: typeof Crown; can: string; cannot: string }> = {
  owner: { label: "Owner", icon: Crown, can: "Everything, including team members, automations, integrations and payment approvals.", cannot: "—" },
  admin: { label: "Admin", icon: ShieldCheck, can: "Approve messages and content, verify payments, issue certificates, see logs and integrations.", cannot: "Manage the team, automations or integrations; approve money-related actions." },
  operator: { label: "Operator", icon: Wrench, can: "Day-to-day work: leads, students, content drafts, running agent tasks.", cannot: "Approve anything, verify payments, see logs." },
  viewer: { label: "Viewer", icon: Eye, can: "Look at everything in the dashboard.", cannot: "Change anything." },
};

/** 18 characters from an unambiguous alphabet (no 0/O, 1/l/I), from the browser's secure generator. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 6)}-${chars.slice(6, 12)}-${chars.slice(12)}`;
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

function PasswordReveal({ email, password, onDone }: { email: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded-xl border border-status-good/30 bg-status-good/10 p-3 text-sm">
      <p className="text-ink">
        Temporary password for <strong>{email}</strong>. It is shown only once: send it to them privately (not in a group chat) and ask them to change it in Settings after signing in.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg border border-line bg-surface-1 px-2.5 py-1 font-mono text-ink select-all" data-testid="temp-password">{password}</code>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function AddMember({ onAdded }: { onAdded: () => void }) {
  const [password, setPassword] = useState(generatePassword);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const m = useMutation({
    mutationFn: (body: { name: string; email: string; role: Role; password: string }) => api<{ user: Member }>("/api/users", { method: "POST", body }),
    onSuccess: (res, body) => {
      setCreated({ email: res.user.email, password: body.password });
      setPassword(generatePassword());
      onAdded();
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    m.mutate(
      { name: String(f.get("name")), email: String(f.get("email")), role: String(f.get("role")) as Role, password },
      { onSuccess: () => (e.target as HTMLFormElement).reset() },
    );
  }

  return (
    <Card title="Add a team member" icon={<UserPlus className="size-4" />}>
      {created ? (
        <PasswordReveal email={created.email} password={created.password} onDone={() => setCreated(null)} />
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Name" name="name" required maxLength={120} autoComplete="off" />
          <Field label="Email" name="email" type="email" required maxLength={254} autoComplete="off" />
          <Select label="Role" name="role" defaultValue="operator">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
          </Select>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-ink-2">Temporary password</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl border border-line bg-surface-1 px-3 py-2 font-mono text-sm text-ink">{password}</code>
              <Button type="button" variant="ghost" onClick={() => setPassword(generatePassword())} aria-label="Generate another password">
                <RefreshCw className="size-4" aria-hidden />
              </Button>
            </div>
            <p className="text-xs text-ink-3">Generated here in your browser. You'll see it once more after adding, to pass on.</p>
          </div>
          {m.isError && <p role="alert" className="text-sm text-status-critical">{errorText(m.error)}</p>}
          <Button type="submit" disabled={m.isPending}>Add member</Button>
        </form>
      )}
    </Card>
  );
}

function MemberRow({ member, isYou, canManage, onChanged }: { member: Member; isYou: boolean; canManage: boolean; onChanged: () => void }) {
  const [reset, setReset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (body: { role?: Role; isActive?: boolean }) => api(`/api/users/${member.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (e) => setError(errorText(e)),
  });
  const resetPassword = useMutation({
    mutationFn: (password: string) => api(`/api/users/${member.id}/password`, { method: "POST", body: { password } }),
    onSuccess: (_r, password) => {
      setError(null);
      setReset(password);
    },
    onError: (e) => setError(errorText(e)),
  });
  const editable = canManage && !isYou;
  const Icon = ROLE_INFO[member.role].icon;

  return (
    <li className={cn("space-y-3 px-5 py-3.5", !member.isActive && "opacity-70")} aria-label={member.name}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-48 flex-1">
          <p className="font-medium text-ink">
            {member.name} {isYou && <span className="ml-1 rounded-full border border-line px-1.5 py-0.5 text-[11px] text-ink-3">You</span>}
          </p>
          <p className="text-sm text-ink-3">{member.email}</p>
        </div>
        <div className="w-40">
          {editable ? (
            <select
              aria-label={`Role for ${member.name}`}
              className="w-full rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink"
              value={member.role}
              disabled={update.isPending}
              onChange={(e) => {
                const role = e.target.value as Role;
                if (confirm(`Change ${member.name}'s role to ${ROLE_INFO[role].label}? They'll be signed out and see the new permissions when they sign in again.`)) {
                  update.mutate({ role });
                }
              }}
            >
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
            </select>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-2"><Icon className="size-4" aria-hidden /> {ROLE_INFO[member.role].label}</span>
          )}
        </div>
        <div className="w-32"><StatusBadge status={member.isActive ? "active" : "disabled"} label={member.isActive ? "Active" : "Deactivated"} /></div>
        <p className="w-36 text-sm text-ink-3" title={member.lastLoginAt ? formatDateTime(member.lastLoginAt) : undefined}>
          {member.lastLoginAt ? `Signed in ${timeAgo(member.lastLoginAt)}` : "Never signed in"}
        </p>
        {editable && (
          <div className="flex gap-2">
            {member.isActive && (
              <Button
                variant="ghost"
                disabled={resetPassword.isPending}
                onClick={() => {
                  if (confirm(`Set a new temporary password for ${member.name}? They'll be signed out everywhere.`)) resetPassword.mutate(generatePassword());
                }}
              >
                <KeyRound className="size-4" aria-hidden /> Reset password
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={update.isPending}
              onClick={() => {
                const next = !member.isActive;
                if (next || confirm(`Deactivate ${member.name}? They're signed out at once and can't sign in until reactivated. Their history stays.`)) {
                  update.mutate({ isActive: next });
                }
              }}
            >
              {member.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-status-critical">{error}</p>}
      {reset && <PasswordReveal email={member.email} password={reset} onDone={() => setReset(null)} />}
    </li>
  );
}

const sortMembers = (list: Member[]) => [...list].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name));

export function TeamPage() {
  const { session, can } = useAuth();
  const qc = useQueryClient();
  const canManage = can("users:manage");
  const q = useQuery({ queryKey: ["users"], queryFn: ({ signal }) => api<{ users: Member[] }>("/api/users", { signal }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["users"] });
  const members = q.data?.users ?? [];
  const active = members.filter((m) => m.isActive);
  const inactive = members.filter((m) => !m.isActive);
  const [showInactive, setShowInactive] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Team"
        description="Who can sign in, and what each person is allowed to do. Everyone gets their own account; changes are logged."
      />
      {!canManage && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
          <ShieldCheck className="size-4" aria-hidden /> Read-only: only the owner can add people or change roles.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title={`Members · ${active.length} active`} icon={<UsersRound className="size-4" />} className="self-start">
          {q.isLoading ? (
            <p className="py-6 text-sm text-ink-3">Loading…</p>
          ) : q.isError ? (
            <p role="alert" className="py-6 text-sm text-status-critical">{errorText(q.error)}</p>
          ) : members.length === 0 ? (
            <EmptyState title="No team members yet">Add someone with the form on the right.</EmptyState>
          ) : (
            <>
              <ul className="-mx-5 divide-y divide-line border-t border-line" aria-label="Active members">
                {sortMembers(active).map((m) => <MemberRow key={m.id} member={m} isYou={m.id === session?.user.id} canManage={canManage} onChanged={refresh} />)}
              </ul>
              {inactive.length > 0 && (
                <div className="-mx-5 -mb-5 border-t border-line">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm text-ink-3 hover:text-ink"
                    aria-expanded={showInactive}
                    onClick={() => setShowInactive((v) => !v)}
                  >
                    <ChevronRight className={cn("size-4 transition", showInactive && "rotate-90")} aria-hidden />
                    Deactivated ({inactive.length})
                  </button>
                  {showInactive && (
                    <ul className="divide-y divide-line border-t border-line" aria-label="Deactivated members">
                      {sortMembers(inactive).map((m) => <MemberRow key={m.id} member={m} isYou={m.id === session?.user.id} canManage={canManage} onChanged={refresh} />)}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
        <div className="space-y-4">
          {canManage && <AddMember onAdded={refresh} />}
          <Card title="What each role can do" icon={<ShieldCheck className="size-4" />}>
            <dl className="space-y-3 text-sm">
              {ROLES.map((r) => {
                const info = ROLE_INFO[r];
                return (
                  <div key={r}>
                    <dt className="flex items-center gap-1.5 font-medium text-ink"><info.icon className="size-4" aria-hidden /> {info.label}</dt>
                    <dd className="mt-0.5 text-ink-2">{info.can}</dd>
                    {info.cannot !== "—" && <dd className="text-ink-3">Can't: {info.cannot}</dd>}
                  </div>
                );
              })}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
