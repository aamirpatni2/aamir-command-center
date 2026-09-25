import type { ReactNode } from "react";

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      {icon && <div className="mb-3 text-ink-3" aria-hidden>{icon}</div>}
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-3">{children}</div>}
    </div>
  );
}
