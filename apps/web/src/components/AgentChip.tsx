import { cn, TONE_CLASS } from "@acc/ui";
import { agentMeta } from "../lib/agents.js";

/** Coloured agent icon, optionally with the agent's name. */
export function AgentChip({ id, withLabel = true, suffix = " agent", className }: { id: string | null | undefined; withLabel?: boolean; suffix?: string; className?: string }) {
  const m = agentMeta(id);
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset", TONE_CLASS[m.tone].chip)} aria-hidden>
        <Icon className="size-3.5" />
      </span>
      {withLabel && <span className="truncate text-ink">{m.label}{suffix}</span>}
    </span>
  );
}
