import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "@acc/ui";
import { NAV } from "../nav.js";
import { useAuth } from "../lib/auth.js";

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, session, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/favicon.svg" alt="" className="size-7" />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">Aamir AI</div>
          <div className="text-xs text-ink-3">Command Center</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4" aria-label="Main">
        {NAV.map((section) => {
          const items = section.items.filter((i) => !i.permission || can(i.permission));
          if (!items.length) return null;
          return (
            <div key={section.title}>
              <div className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{section.title}</div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                          isActive ? "bg-accent/15 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                        )
                      }
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {!item.ready && <span className="text-[10px] text-ink-3">M{item.milestone}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-full bg-surface-2 text-sm font-medium text-ink" aria-hidden>
            {session?.user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm text-ink">{session?.user.name}</div>
            <div className="text-xs text-ink-3 capitalize">{session?.user.role}</div>
          </div>
          <button onClick={() => void logout()} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title="Sign out" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface">
            <button className="absolute top-3 right-3 rounded-md p-1.5 text-ink-2 hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold">Aamir AI Command Center</span>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}
