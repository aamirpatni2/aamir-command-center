import { Navigate, Route, Routes, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth.js";
import { Layout, PageHeader } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { ComingSoonPage } from "./pages/ComingSoonPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { TaskDetailPage } from "./pages/TaskDetailPage.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { LeadsPage } from "./pages/LeadsPage.js";
import { LeadDetailPage } from "./pages/LeadDetailPage.js";
import { ConversationsPage } from "./pages/ConversationsPage.js";
import { ALL_NAV_ITEMS } from "./nav.js";
import type { Permission } from "@acc/shared";

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return <div className="grid h-full place-items-center text-sm text-ink-3">Loading…</div>;
  }
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Guard({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (permission && !can(permission)) {
    return <PageHeader title="No access" description="Your role doesn't include this area. Ask the owner if you need it." />;
  }
  return <>{children}</>;
}

const READY: Record<string, ReactNode> = {
  "/": <DashboardPage />,
  "/logs": <LogsPage />,
  "/settings": <SettingsPage />,
  "/tasks": <TasksPage />,
  "/agents": <AgentsPage />,
  "/leads": <LeadsPage />,
  "/conversations": <ConversationsPage />,
};

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        {ALL_NAV_ITEMS.map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={<Guard permission={item.permission}>{READY[item.path] ?? <ComingSoonPage item={item} />}</Guard>}
          />
        ))}
        <Route path="/tasks/:id" element={<Guard permission="tasks:read"><TaskDetailPage /></Guard>} />
        <Route path="/leads/:id" element={<Guard permission="leads:read"><LeadDetailPage /></Guard>} />
        <Route path="/conversations/:id" element={<Guard permission="leads:read"><ConversationsPage /></Guard>} />
        <Route path="*" element={<PageHeader title="Page not found" description="That page doesn't exist." />} />
      </Route>
    </Routes>
  );
}
