export type ApprovalStatus = "pending" | "approved" | "executing" | "executed" | "rejected" | "expired" | "failed";

export interface ExecutionResult {
  status: "executed" | "not_executed" | "unknown";
  at: string;
  code?: string;
  message?: string;
  retryable?: boolean;
  providerMessageId?: string;
  [k: string]: unknown;
}

export interface Approval {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  agent: string | null;
  tool: string;
  risk: "external" | "destructive" | "financial" | string;
  title: string;
  summary: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  originalPayload: Record<string, unknown>;
  edited: boolean;
  editableFields: string[];
  decidedBy: { id: string; name: string | null } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executionResult: ExecutionResult | null;
  executionAttempts: number;
  executedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  context: {
    contactName?: string | null;
    contactPhone?: string | null;
    conversationId?: string | null;
    studentId?: string | null;
    course?: string | null;
    lastInboundAt?: string | null;
    lastInboundText?: string | null;
  };
  canDecide: boolean;
}

export interface ApprovalList {
  approvals: Approval[];
  counts: { pending: number; approvedNotExecuted: number; executing: number; failed: number };
}

export interface DecisionResponse {
  approval: Approval;
  outcome?: { status: "executed" | "not_executed" | "unknown"; code?: string; message?: string };
}
