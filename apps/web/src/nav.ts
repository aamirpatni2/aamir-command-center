import {
  Activity, BarChart3, BookOpen, Bot, Brain, CalendarDays, CheckSquare, Clapperboard, FileText, Film, GraduationCap,
  LayoutDashboard, ListChecks, Megaphone, MessagesSquare, Palette, PenSquare, Plug, ScrollText, Settings,
  ShieldCheck, Sparkles, Telescope, Users, Workflow, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@acc/shared";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Milestone that delivers the page. Pages without `ready` render an honest "coming in M#" screen. */
  milestone: number;
  ready?: boolean;
  permission?: Permission;
  description: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Today",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard, milestone: 2, ready: true, permission: "analytics:read", description: "Today at a glance" },
      { path: "/leads", label: "Leads", icon: Users, milestone: 5, ready: true, permission: "leads:read", description: "Lead pipeline, scoring and follow-ups managed with the Sales Agent" },
      { path: "/conversations", label: "Conversations", icon: MessagesSquare, milestone: 5, ready: true, permission: "leads:read", description: "WhatsApp inbox with AI-drafted replies waiting for your approval" },
      { path: "/insights", label: "AI Insights", icon: Sparkles, milestone: 12, permission: "analytics:read", description: "Patterns and recommendations from the Analytics Agent" },
      { path: "/ads", label: "Ads", icon: Megaphone, milestone: 12, permission: "campaigns:read", description: "Read-only Meta Ads performance and Marketing Agent analysis" },
      { path: "/analytics", label: "Analytics", icon: BarChart3, milestone: 12, permission: "analytics:read", description: "Revenue, lead, conversion, content and campaign analytics" },
    ],
  },
  {
    title: "Education",
    items: [
      { path: "/students", ready: true, label: "Students", icon: GraduationCap, milestone: 6, permission: "students:read", description: "Student profiles, progress, attendance and certificates" },
      { path: "/courses", ready: true, label: "Courses", icon: BookOpen, milestone: 6, permission: "courses:read", description: "Courses, batches, pricing and schedules" },
      { path: "/classes", ready: true, label: "Classes", icon: CalendarDays, milestone: 6, permission: "students:read", description: "Class schedule, recordings and attendance" },
      { path: "/reports", label: "Reports", icon: FileText, milestone: 12, permission: "analytics:read", description: "Daily and weekly business reports" },
    ],
  },
  {
    title: "Content",
    items: [
      { path: "/content", ready: true, label: "Content", icon: PenSquare, milestone: 7, permission: "content:read", description: "Hooks, scripts, captions and posts in Urdu and English" },
      { path: "/reels", ready: true, label: "Reels", icon: Film, milestone: 7, permission: "content:read", description: "Reel concepts, scene plans and scripts" },
      { path: "/creatives", ready: true, label: "Creatives", icon: Palette, milestone: 7, permission: "content:read", description: "Image/video prompts and Canva designs" },
      { path: "/calendar", ready: true, label: "Calendar", icon: Clapperboard, milestone: 7, permission: "content:read", description: "Content calendar and publishing schedule" },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { path: "/research", ready: true, label: "AI Research", icon: Telescope, milestone: 8, permission: "knowledge:read", description: "Source-backed AI research from the Research Agent" },
      { path: "/agents", label: "Agents", icon: Bot, milestone: 3, ready: true, permission: "tasks:read", description: "Agent activity: runs, tools used, duration, results and errors" },
      { path: "/tasks", label: "Tasks", icon: ListChecks, milestone: 3, ready: true, permission: "tasks:read", description: "Give the Orchestrator a task and follow its plan" },
      { path: "/knowledge", ready: true, label: "Knowledge", icon: Brain, milestone: 8, permission: "knowledge:read", description: "Approved business knowledge used by agents (RAG)" },
      { path: "/mcp", label: "Integrations", icon: Plug, milestone: 11, ready: true, permission: "mcp:read", description: "WhatsApp, Google, Canva, web search and MCP servers: status, connections and tool permissions" },
    ],
  },
  {
    title: "System",
    items: [
      { path: "/automations", label: "Automations", icon: Workflow, milestone: 10, ready: true, permission: "automations:read", description: "Trigger → condition → agent → approval → action workflows" },
      { path: "/approvals", label: "Approvals", icon: CheckSquare, milestone: 9, ready: true, permission: "approvals:read", description: "Approve, reject or edit actions agents want to take" },
      { path: "/logs", label: "Logs", icon: ScrollText, milestone: 2, ready: true, permission: "audit:read", description: "Audit log of sign-ins, changes and agent actions" },
      { path: "/settings", label: "Settings", icon: Settings, milestone: 2, ready: true, description: "Your account, sessions and integration status" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((s) => s.items);
export { Activity, ShieldCheck };
