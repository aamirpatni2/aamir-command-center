import type { ReactNode } from "react";
import { cn } from "./cn.js";
import { TONE_CLASS, type VizTone } from "./tones.js";

/**
 * Label · value · optional note. No delta/trend until there is real history to compare against.
 * `hero` renders the one headline figure a view leads with. Wrap in a link with the `group` class
 * to get the hover lift; `loading` shows a shimmer instead of a placeholder number.
 */
export function StatTile({
  label,
  value,
  note,
  icon,
  tone = "indigo",
  hero = false,
  loading = false,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  tone?: VizTone;
  hero?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const t = TONE_CLASS[tone];
  return (
    <div
      className={cn(
        "glass relative isolate h-full overflow-hidden rounded-2xl p-5 transition duration-300 ease-out",
        "group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-glow",
        hero && "flex flex-col p-6",
        className,
      )}
    >
      {/* Ambient tone glow + a thin lit top edge. */}
      <div aria-hidden className={cn("pointer-events-none absolute -z-10 rounded-full blur-3xl transition-opacity duration-500", t.glow, hero ? "-top-24 -right-16 size-72 opacity-70" : "-top-16 -right-14 size-40 opacity-50 group-hover:opacity-90")} />
      <div aria-hidden className={cn("pointer-events-none absolute inset-x-6 top-0 h-px bg-linear-to-r from-transparent to-transparent", t.edge)} />

      <div className="flex items-center gap-2.5 text-sm text-ink-2">
        {icon && <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset", t.chip)} aria-hidden>{icon}</span>}
        <span className="font-medium">{label}</span>
      </div>
      <div className={cn(hero && "mt-auto")}>
        {loading ? (
          <div className={cn("shimmer rounded-lg", hero ? "mt-6 h-12 w-3/4" : "mt-4 h-8 w-16")} aria-label="Loading" />
        ) : (
          <div className={cn("tabular font-display font-semibold tracking-tight text-ink", hero ? "mt-6 text-5xl leading-none sm:text-[3.4rem]" : "mt-3.5 text-[2rem] leading-none")}>
            {value}
          </div>
        )}
        {note && <div className={cn("text-xs text-ink-3", hero ? "mt-3 text-sm" : "mt-2")}>{note}</div>}
      </div>
    </div>
  );
}
