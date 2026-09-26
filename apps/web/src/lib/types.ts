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
  stepId: string | null;
  parentRunId: string | null;
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

export interface PlanStep {
  id: string;
  position: number;
  agentId: string;
  instruction: string;
  dependsOn: number[];
  status: TaskStatus;
}

export interface TaskPlan {
  intent: string;
  language: "ur" | "ur-roman" | "en";
  directAnswer?: string;
  steps: { agent: string; instruction: string; acceptance: string; dependsOn: number[] }[];
}

export interface TaskDetail {
  task: TaskListItem & {
    input: string;
    plan: TaskPlan | null;
    result: { text?: string; mock?: boolean; approvalIds?: string[]; issues?: string[]; nextSteps?: string[] } | null;
  };
  steps: PlanStep[];
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
