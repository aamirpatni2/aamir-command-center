import type { ReactNode } from "react";
import { cn } from "./cn.js";

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-4", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-medium text-ink-2">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
