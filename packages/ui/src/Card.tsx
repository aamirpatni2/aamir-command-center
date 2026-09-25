import type { ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * Frosted-glass panel. `interactive` adds the hover lift + glow for cards that are links or buttons.
 */
export function Card({
  title,
  icon,
  action,
  children,
  className,
  interactive = false,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <section
      className={cn(
        "glass relative rounded-2xl p-5",
        interactive && "transition duration-300 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-glow",
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
              {icon && <span className="shrink-0 text-ink-3" aria-hidden>{icon}</span>}
              <span className="truncate">{title}</span>
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
