import type { ReactNode } from "react";

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      {icon && (
        <div className="relative mb-4" aria-hidden>
          <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" />
          <div className="relative grid size-12 place-items-center rounded-2xl bg-linear-to-b from-white/10 to-white/[0.02] text-ink-2 ring-1 ring-line ring-inset">
            {icon}
          </div>
        </div>
      )}
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-3">{children}</div>}
    </div>
  );
}
