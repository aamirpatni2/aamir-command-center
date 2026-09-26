import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Clock, Flame, Loader2, PauseCircle, Snowflake, Thermometer, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "./cn.js";

type Tone = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  good: "text-status-good bg-status-good/10 border-status-good/25",
  warning: "text-status-warning bg-status-warning/10 border-status-warning/25",
  serious: "text-status-serious bg-status-serious/10 border-status-serious/25",
  critical: "text-status-critical bg-status-critical/10 border-status-critical/30",
  info: "text-accent bg-accent/10 border-accent/25",
  neutral: "text-ink-2 bg-surface-2 border-line",
};

/** Known statuses → tone + icon. Status is never shown by colour alone: icon + label always. */
type StatusDef = { tone: Tone; icon: ComponentType<{ className?: string }>; label?: string };
const STATUS: Record<string, StatusDef> = {
  QUEUED: { tone: "neutral", icon: Clock, label: "Queued" },
  RUNNING: { tone: "info", icon: Loader2, label: "Running" },
  WAITING_APPROVAL: { tone: "warning", icon: PauseCircle, label: "Waiting approval" },
  COMPLETED: { tone: "good", icon: CheckCircle2, label: "Completed" },
  FAILED: { tone: "critical", icon: XCircle, label: "Failed" },
  CANCELLED: { tone: "neutral", icon: CircleDashed, label: "Cancelled" },
  read: { tone: "neutral", icon: CheckCircle2 },
  draft: { tone: "neutral", icon: CircleDashed, label: "Draft" },
  in_review: { tone: "warning", icon: PauseCircle, label: "In review" },
  approved: { tone: "good", icon: CheckCircle2, label: "Approved" },
  verified_claim: { tone: "good", icon: CheckCircle2, label: "Verified" },
  scheduled: { tone: "info", icon: Clock, label: "Scheduled" },
  published: { tone: "good", icon: CheckCircle2, label: "Published" },
  rejected: { tone: "critical", icon: XCircle, label: "Rejected" },
  write: { tone: "info", icon: CheckCircle2 },
  external: { tone: "warning", icon: AlertTriangle },
  destructive: { tone: "serious", icon: AlertOctagon },
  financial: { tone: "critical", icon: AlertOctagon },
  unverified: { tone: "neutral", icon: CircleDashed, label: "Unverified" },
  contradicted: { tone: "serious", icon: AlertTriangle, label: "Contradicted" },
  archived: { tone: "neutral", icon: CircleDashed, label: "Archived" },
  proposed: { tone: "warning", icon: PauseCircle, label: "Proposed" },
  hot: { tone: "serious", icon: Flame, label: "Hot" },
  warm: { tone: "warning", icon: Thermometer, label: "Warm" },
  cold: { tone: "neutral", icon: Snowflake, label: "Cold" },
  pending: { tone: "warning", icon: PauseCircle, label: "Pending" },
  executing: { tone: "info", icon: Loader2, label: "Executing" },
  executed: { tone: "good", icon: CheckCircle2, label: "Executed" },
  expired: { tone: "neutral", icon: CircleDashed, label: "Expired" },
  failed: { tone: "critical", icon: XCircle, label: "Failed" },
  partial: { tone: "serious", icon: AlertTriangle, label: "Partly done" },
  rate_limited: { tone: "warning", icon: PauseCircle, label: "Rate limited" },
  running: { tone: "info", icon: Loader2, label: "Running" },
  enabled: { tone: "good", icon: CheckCircle2, label: "On" },
  disabled: { tone: "neutral", icon: CircleDashed, label: "Off" },
  verified: { tone: "good", icon: CheckCircle2, label: "Verified" },
  active: { tone: "info", icon: CheckCircle2, label: "Active" },
  completed: { tone: "good", icon: CheckCircle2, label: "Completed" },
  dropped: { tone: "neutral", icon: CircleDashed, label: "Dropped" },
  refunded: { tone: "neutral", icon: CircleDashed, label: "Refunded" },
  eligible: { tone: "good", icon: CheckCircle2, label: "Eligible" },
  not_eligible: { tone: "neutral", icon: CircleDashed, label: "Not eligible" },
  issued: { tone: "good", icon: CheckCircle2, label: "Certificate issued" },
  connected: { tone: "good", icon: CheckCircle2, label: "Configured" },
  not_configured: { tone: "neutral", icon: CircleDashed, label: "Not configured" },
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s: StatusDef = STATUS[status] ?? { tone: "neutral", icon: CircleDashed };
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap backdrop-blur-sm", TONE[s.tone], className)}>
      <Icon className={cn("size-3.5", status === "RUNNING" && "animate-spin")} aria-hidden />
      {label ?? s.label ?? status}
    </span>
  );
}
