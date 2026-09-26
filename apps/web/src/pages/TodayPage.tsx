import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckSquare, Flame, MessageCircle, PhoneCall, Sun, Wallet } from "lucide-react";
import { Card, cn, EmptyState, StatTile, StatusBadge } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatDateTime, formatMoney, timeAgo } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";

export interface TodayData {
  generatedAt: string;
  allClear: boolean;
  counts: { waitingForReply: number; hotGoneQuiet: number; followUpsDue: number; paymentsToVerify: number; approvals: number; classesToday: number };
  waitingForReply: { conversationId: string; contactName: string | null; phone: string | null; lastMessage: string | null; waitingSince: string; leadId: string | null; score: number | null; drafts: number }[];
  hotGoneQuiet: { leadId: string; contactName: string | null; phone: string | null; score: number; status: string; lastActivity: string }[];
  followUpsDue: { leadId: string; contactName: string | null; phone: string | null; score: number; dueAt: string; overdue: boolean }[];
  paymentsToVerify: { paymentId: string; amountMinor: number; method: string; reference: string | null; studentName: string | null; studentId: string | null; course: string | null; createdAt: string }[];
  classesToday: { classId: string; title: string; startsAt: string; batchId: string; batch: string; course: string; meetingUrl: string | null }[];
  approvals: { pending: number; oldest: string | null; approvedNotSent: number; unknownOutcome: number };
}

const METHOD: Record<string, string> = { jazzcash: "JazzCash", easypaisa: "EasyPaisa", bank_transfer: "Bank transfer", cash: "Cash", card: "Card" };

function Row({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li>
      <Link to={to} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-surface-2">{children}</Link>
    </li>
  );
}

function Section({ title, icon, count, children, empty }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode; empty: string }) {
  return (
    <Card title={<span className="flex items-center gap-2">{title}<span className={cn("rounded-full px-2 py-0.5 text-[11px] tabular", count ? "bg-status-warning/15 text-status-warning" : "bg-surface-2 text-ink-3")}>{count}</span></span>} icon={icon}>
      {count ? <ul className="space-y-0.5">{children}</ul> : <p className="py-3 text-sm text-ink-3">{empty}</p>}
    </Card>
  );
}

export function TodayPage() {
  const q = useQuery({ queryKey: ["today"], queryFn: ({ signal }) => api<TodayData>("/api/analytics/today", { signal }), refetchInterval: 30_000 });
  const d = q.data;
  const c = d?.counts;

  return (
    <>
      <PageHeader
        eyebrow="Needs you"
        title={d?.allClear ? "Nothing needs you right now" : "What needs you today"}
        description="Only the things a person has to do: unanswered chats, hot leads going cold, follow-ups, payments to verify and approvals. Updated live."
      />
      {q.isError && <p role="alert" className="text-sm text-status-critical">{(q.error as Error).message}</p>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile tone="rose" loading={!d} label="Waiting for a reply" icon={<MessageCircle className="size-4" />} value={c?.waitingForReply ?? "—"} />
        <StatTile tone="amber" loading={!d} label="Hot, gone quiet" icon={<Flame className="size-4" />} value={c?.hotGoneQuiet ?? "—"} />
        <StatTile tone="cyan" loading={!d} label="Follow-ups due" icon={<PhoneCall className="size-4" />} value={c?.followUpsDue ?? "—"} />
        <StatTile tone="emerald" loading={!d} label="Payments to verify" icon={<Wallet className="size-4" />} value={c?.paymentsToVerify ?? "—"} />
        <StatTile tone="violet" loading={!d} label="Approvals" icon={<CheckSquare className="size-4" />} value={c?.approvals ?? "—"} />
      </div>

      {d?.allClear && (
        <Card className="mb-6">
          <EmptyState icon={<Sun className="size-5" />} title="All clear">Nobody is waiting on a reply, no payment proofs are pending, and no hot lead has gone quiet.</EmptyState>
        </Card>
      )}

      {d && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Waiting for a reply" icon={<MessageCircle className="size-4" />} count={c!.waitingForReply} empty="Everyone who wrote in the last 7 days has an answer.">
            {d.waitingForReply.map((w) => (
              <Row key={w.conversationId} to={`/conversations/${w.conversationId}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{w.contactName ?? w.phone}</span>
                  <span className="block truncate text-xs text-ink-3">{w.lastMessage ?? "[media]"}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {w.drafts > 0 && <StatusBadge status="pending" label="Draft ready" />}
                  <span className="text-xs text-status-warning">{timeAgo(w.waitingSince)}</span>
                </span>
              </Row>
            ))}
          </Section>

          <Section title="Hot leads gone quiet" icon={<Flame className="size-4" />} count={c!.hotGoneQuiet} empty="No hot lead has been silent for 2 days or more.">
            {d.hotGoneQuiet.map((l) => (
              <Row key={l.leadId} to={`/leads/${l.leadId}`}>
                <span className="min-w-0"><span className="block truncate font-medium text-ink">{l.contactName ?? l.phone}</span><span className="block text-xs text-ink-3 capitalize">{l.status} · score {l.score}</span></span>
                <span className="shrink-0 text-xs text-ink-3">quiet {timeAgo(l.lastActivity)}</span>
              </Row>
            ))}
          </Section>

          <Section title="Follow-ups due" icon={<PhoneCall className="size-4" />} count={c!.followUpsDue} empty="No follow-ups due today.">
            {d.followUpsDue.map((l) => (
              <Row key={l.leadId} to={`/leads/${l.leadId}`}>
                <span className="min-w-0"><span className="block truncate font-medium text-ink">{l.contactName ?? l.phone}</span><span className="block text-xs text-ink-3">score {l.score}</span></span>
                <span className={cn("shrink-0 text-xs", l.overdue ? "text-status-serious" : "text-ink-2")}>{l.overdue ? "overdue · " : ""}{formatDateTime(l.dueAt)}</span>
              </Row>
            ))}
          </Section>

          <Section title="Payments to verify" icon={<Wallet className="size-4" />} count={c!.paymentsToVerify} empty="No payment proofs waiting.">
            {d.paymentsToVerify.map((p) => (
              <Row key={p.paymentId} to={p.studentId ? `/students/${p.studentId}` : "/students"}>
                <span className="min-w-0"><span className="block truncate font-medium text-ink">{p.studentName ?? "Unlinked payment"}</span><span className="block truncate text-xs text-ink-3">{METHOD[p.method] ?? p.method}{p.reference ? ` · ref ${p.reference}` : ""}{p.course ? ` · ${p.course}` : ""}</span></span>
                <span className="tabular shrink-0 font-semibold text-ink">{formatMoney(p.amountMinor)}</span>
              </Row>
            ))}
          </Section>

          <Section title="Approvals" icon={<CheckSquare className="size-4" />} count={c!.approvals} empty="Nothing waiting in the Approval Center.">
            <Row to="/approvals">
              <span className="text-ink">{d.approvals.pending} waiting for your decision{d.approvals.approvedNotSent ? ` · ${d.approvals.approvedNotSent} approved but not sent` : ""}</span>
              {d.approvals.oldest && <span className="shrink-0 text-xs text-ink-3">oldest {timeAgo(d.approvals.oldest)}</span>}
            </Row>
          </Section>

          <Section title="Classes today" icon={<CalendarClock className="size-4" />} count={c!.classesToday} empty="No classes scheduled today.">
            {d.classesToday.map((k) => (
              <Row key={k.classId} to={`/batches/${k.batchId}`}>
                <span className="min-w-0"><span className="block truncate font-medium text-ink">{k.title}</span><span className="block truncate text-xs text-ink-3">{k.course} · {k.batch}</span></span>
                <span className="shrink-0 text-xs text-ink-2">{formatDateTime(k.startsAt)}</span>
              </Row>
            ))}
          </Section>
        </div>
      )}
    </>
  );
}
