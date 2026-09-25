export const TASK_STATUSES = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const AGENT_IDS = [
  "orchestrator",
  "sales",
  "whatsapp",
  "content",
  "research",
  "student",
  "marketing",
  "analytics",
  "course",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const TOOL_RISKS = ["read", "draft", "write", "external", "destructive", "financial"] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

/** Risks that always stop at the Approval Center unless an owner policy says otherwise. */
export const APPROVAL_REQUIRED_RISKS: readonly ToolRisk[] = ["external", "destructive", "financial"];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "executed", "failed"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const LEAD_STATUSES = ["new", "contacted", "qualified", "interested", "negotiating", "won", "lost", "nurture"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CONTENT_LANGUAGES = ["ur", "ur-roman", "en"] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];
