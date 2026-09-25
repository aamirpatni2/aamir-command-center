import { Navigate, Route, Routes, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth.js";
import { Layout, PageHeader } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { ComingSoonPage } from "./pages/ComingSoonPage.js";
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
        <Route path="*" element={<PageHeader title="Page not found" description="That page doesn't exist." />} />
      </Route>
    </Routes>
  );
}
