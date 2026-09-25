import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, PauseCircle, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "./cn.js";

type Tone = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  good: "text-status-good bg-status-good/10 border-status-good/30",
  warning: "text-status-warning bg-status-warning/10 border-status-warning/30",
  serious: "text-status-serious bg-status-serious/10 border-status-serious/30",
  critical: "text-status-critical bg-status-critical/10 border-status-critical/40",
  info: "text-accent bg-accent/10 border-accent/30",
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
  draft: { tone: "neutral", icon: CircleDashed },
  write: { tone: "info", icon: CheckCircle2 },
  external: { tone: "warning", icon: AlertTriangle },
  destructive: { tone: "serious", icon: AlertOctagon },
  financial: { tone: "critical", icon: AlertOctagon },
  connected: { tone: "good", icon: CheckCircle2, label: "Configured" },
  not_configured: { tone: "neutral", icon: CircleDashed, label: "Not configured" },
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s: StatusDef = STATUS[status] ?? { tone: "neutral", icon: CircleDashed };
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", TONE[s.tone], className)}>
      <Icon className={cn("size-3.5", status === "RUNNING" && "animate-spin")} aria-hidden />
      {label ?? s.label ?? status}
    </span>
  );
}
