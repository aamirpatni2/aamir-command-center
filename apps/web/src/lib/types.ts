export type TaskStatus = "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface TaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  source: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestedBy: string | null;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: TaskStatus;
  modelProvider: string | null;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicroUsd: number | null;
  toolCallCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  output: { text?: string; result?: unknown; approvalIds?: string[] } | null;
}

export interface TimelineMessage {
  runId: string;
  seq: number;
  role: "system" | "user" | "assistant" | "tool";
  toolName: string | null;
  toolRisk: string | null;
  isError: boolean;
  latencyMs: number | null;
  content: Record<string, unknown>;
  createdAt: string;
}

export interface TaskDetail {
  task: TaskListItem & { input: string; result: { text?: string; mock?: boolean; approvalIds?: string[] } | null };
  runs: AgentRun[];
  messages: TimelineMessage[];
  approvals: { id: string; title: string; risk: string; status: string }[];
}

export interface ActivityRun {
  id: string;
  agentId: string;
  status: TaskStatus;
  taskId: string;
  taskTitle: string;
  model: string | null;
  mock: boolean;
  startedAt: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicroUsd: number | null;
  toolCallCount: number;
  toolsUsed: string[];
  resultText: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}
