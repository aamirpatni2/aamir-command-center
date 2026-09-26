import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "@acc/ui";
import { NAV } from "../nav.js";
import { useAuth } from "../lib/auth.js";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", className)} aria-hidden>
      <span className="absolute inset-0 rounded-[30%] bg-brand-1/60 blur-md" />
      <img src="/favicon.svg" alt="" className="relative size-full" />
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, session, logout } = useAuth();
  const name = session?.user.name ?? "";
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <BrandMark className="size-9" />
        <div className="leading-tight">
          <div className="font-display text-[15px] font-bold tracking-tight text-ink">Aamir AI</div>
          <div className="text-[11px] font-medium tracking-wide text-ink-3">Command Center</div>
        </div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pt-2 pb-4" aria-label="Main">
        {NAV.map((section) => {
          const items = section.items.filter((i) => !i.permission || can(i.permission));
          if (!items.length) return null;
          return (
            <div key={section.title}>
              <div className="px-3 pb-2 text-[10.5px] font-semibold tracking-[0.14em] text-ink-3/80 uppercase">{section.title}</div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition duration-200",
                          isActive
                            ? "bg-linear-to-r from-accent/20 via-accent/[0.07] to-transparent font-medium text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
                            : item.ready
                              ? "text-ink-2 hover:bg-surface-2 hover:text-ink"
                              : "text-ink-3 hover:bg-surface-2 hover:text-ink-2",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_12px_2px_rgb(139_147_255/0.7)]" />}
                          <item.icon className={cn("size-[17px] shrink-0 transition-colors", isActive ? "text-accent" : "text-ink-3 group-hover:text-ink-2")} aria-hidden />
                          <span className="flex-1 truncate">{item.label}</span>
                          {!item.ready && <span className="rounded-md bg-surface-2 px-1.5 py-px text-[10px] font-medium text-ink-3 ring-1 ring-line ring-inset">M{item.milestone}</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="p-3">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-1 to-brand-2 font-display text-sm font-bold text-white shadow-[0_6px_18px_-6px_rgb(124_58_237/0.8)]" aria-hidden>
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-ink">{name}</div>
            <div className="text-xs text-ink-3 capitalize">{session?.user.role}</div>
          </div>
          <button onClick={() => void logout()} className="rounded-lg p-2 text-ink-3 transition hover:bg-surface-3 hover:text-ink" title="Sign out" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const PANEL = "border-line bg-[rgb(9_10_18/0.72)] backdrop-blur-2xl";

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  // Re-run the entrance animation per section, not when a detail pane inside it changes.
  const section = location.pathname.split("/")[1] ?? "";

  return (
    <div className="flex h-full">
      <aside className={cn("hidden w-64 shrink-0 border-r lg:block", PANEL)}>
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className={cn("absolute inset-y-0 left-0 w-72 animate-fade-in border-r shadow-pop", PANEL)}>
            <button className="absolute top-4 right-3 rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={cn("sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 lg:hidden", PANEL)}>
          <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <BrandMark className="size-7" />
          <span className="font-display text-sm font-semibold">Aamir AI Command Center</span>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div key={section} className="mx-auto max-w-7xl animate-fade-up px-4 py-7 sm:px-8 lg:py-9">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action, eyebrow }: { title: string; description?: string; action?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-xs font-semibold tracking-[0.12em] text-accent uppercase">{eyebrow}</div>}
        <h1 className="text-gradient font-display text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-[2rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}
