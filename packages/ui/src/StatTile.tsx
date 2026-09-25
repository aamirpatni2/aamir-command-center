import type { ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * Label · value · optional note. No delta/trend until there is real history to compare against.
 * `hero` renders the one headline figure a view leads with. Wrap in a router link to make it clickable.
 */
export function StatTile({
  label,
  value,
  note,
  icon,
  hero = false,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("h-full rounded-xl border border-line bg-surface p-4 transition-colors", className)}>
      <div className="flex items-center gap-2 text-sm text-ink-2">
        {icon && <span className="text-ink-3" aria-hidden>{icon}</span>}
        <span>{label}</span>
      </div>
      <div className={cn("mt-2 font-semibold text-ink", hero ? "text-5xl tracking-tight" : "text-3xl")}>{value}</div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}
