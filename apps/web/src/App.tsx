import { Navigate, Route, Routes, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth.js";
import { Layout, PageHeader } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { InvitePage } from "./pages/InvitePage.js";
import { ComingSoonPage } from "./pages/ComingSoonPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { TaskDetailPage } from "./pages/TaskDetailPage.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { LeadsPage } from "./pages/LeadsPage.js";
import { LeadDetailPage } from "./pages/LeadDetailPage.js";
import { ConversationsPage } from "./pages/ConversationsPage.js";
import { CoursesPage } from "./pages/CoursesPage.js";
import { BatchPage } from "./pages/BatchPage.js";
import { StudentsPage } from "./pages/StudentsPage.js";
import { StudentDetailPage } from "./pages/StudentDetailPage.js";
import { ClassesPage } from "./pages/ClassesPage.js";
import { ContentPage, CreativesPage, ReelsPage } from "./pages/ContentPage.js";
import { ContentDetailPage } from "./pages/ContentDetailPage.js";
import { CalendarPage } from "./pages/CalendarPage.js";
import { KnowledgePage } from "./pages/KnowledgePage.js";
import { ResearchPage } from "./pages/ResearchPage.js";
import { ApprovalsPage } from "./pages/ApprovalsPage.js";
import { AutomationsPage } from "./pages/AutomationsPage.js";
import { IntegrationsPage } from "./pages/IntegrationsPage.js";
import { TodayPage } from "./pages/TodayPage.js";
import { AnalyticsPage } from "./pages/AnalyticsPage.js";
import { InsightsPage } from "./pages/InsightsPage.js";
import { ReportsPage } from "./pages/ReportsPage.js";
import { AdsPage } from "./pages/AdsPage.js";
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
  "/team": <TeamPage />,
  "/tasks": <TasksPage />,
  "/agents": <AgentsPage />,
  "/leads": <LeadsPage />,
  "/conversations": <ConversationsPage />,
  "/courses": <CoursesPage />,
  "/students": <StudentsPage />,
  "/classes": <ClassesPage />,
  "/content": <ContentPage />,
  "/reels": <ReelsPage />,
  "/creatives": <CreativesPage />,
  "/calendar": <CalendarPage />,
  "/knowledge": <KnowledgePage />,
  "/research": <ResearchPage />,
  "/approvals": <ApprovalsPage />,
  "/automations": <AutomationsPage />,
  "/mcp": <IntegrationsPage />,
  "/today": <TodayPage />,
  "/analytics": <AnalyticsPage />,
  "/insights": <InsightsPage />,
  "/reports": <ReportsPage />,
  "/ads": <AdsPage />,
};

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite" element={<InvitePage />} />
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
        <Route path="/batches/:id" element={<Guard permission="courses:read"><BatchPage /></Guard>} />
        <Route path="/students/:id" element={<Guard permission="students:read"><StudentDetailPage /></Guard>} />
        <Route path="/content/:id" element={<Guard permission="content:read"><ContentDetailPage /></Guard>} />
        <Route path="/reports/:id" element={<Guard permission="analytics:read"><ReportsPage /></Guard>} />
        <Route path="/research/:id" element={<Guard permission="knowledge:read"><ResearchPage /></Guard>} />
        <Route path="*" element={<PageHeader title="Page not found" description="That page doesn't exist." />} />
      </Route>
    </Routes>
  );
}
