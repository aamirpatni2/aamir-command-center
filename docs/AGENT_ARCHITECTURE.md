# Agent Architecture

## 1. Runtime building blocks (`packages/agents`)

```ts
interface AgentDefinition {
  id: AgentId;                     // "sales" | "content" | ...
  description: string;             // used by the Orchestrator for routing
  systemPrompt: string;            // loaded from /agents/<id>/prompt.md
  model: ModelSelector;            // { provider: "anthropic", model: "claude-opus-5" } (default)
  tools: ToolName[];               // allow-list enforced by ToolRegistry
  maxSteps: number;                // hard cap on tool-use iterations
  outputSchema?: ZodSchema;        // structured result validation
}

interface Tool<I, O> {
  name: ToolName;                  // "crm.lead.search"
  risk: "read" | "draft" | "write" | "external" | "destructive" | "financial";
  input: ZodSchema<I>;
  run(input: I, ctx: ToolContext): Promise<O>;
}

interface ModelProvider {
  generate(req: ModelRequest): Promise<ModelResponse>;  // messages + tools → content/tool_calls + usage
}
```

- **AgentRunner** runs the tool-use loop: model call → validate tool calls → ToolRegistry → feed results back → repeat until `end_turn` or `maxSteps`. It records every step in `agent_runs` / `agent_messages`.
- **ToolRegistry** is the single gate. It checks the allow-list, validates input and applies the risk policy, which can create an approval instead of running the tool.
- **ModelProvider** adapters: `AnthropicProvider` (first), `OpenAIProvider` and `GoogleProvider` (later), and `MockProvider` (tests only, scripted responses).

### As built (Milestone 3)
- `packages/agents/src/model/` — `ModelProvider` interface; `AnthropicProvider` (Messages API, `claude-opus-5` default, adaptive thinking as the model default, `effort` per agent, server-side refusal fallback `fallbacks: "default"`, thinking blocks replayed unchanged inside the tool loop, tool names `a.b` ↔ `a__b`); `MockProvider` (dev/test only, every output labelled `[MOCK]`, runs stored with `model_provider = 'mock'`); `resolveModel()` refuses mocks in production.
- `packages/agents/src/tools/registry.ts` — allow-list → Zod input validation → risk policy → timeout (30 s default) → audit. `external/destructive/financial` tools create an `approvals` row (idempotency key `runId:toolCallId`) and are **never executed** by the runner. Denied calls write `tool.denied` audit rows.
- `packages/agents/src/runtime/runner.ts` — the loop. Persists every message to `agent_messages`, publishes `run.*` events, stops on refusal (`MODEL_REFUSAL`), output limit (`MAX_TOKENS`), `maxSteps` (`MAX_STEPS`) or cancellation (`CANCELLED`); provider errors map to stable codes (`PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, …) without leaking credentials. Structured results use an automatic `finish` tool validated against the agent's `outputSchema` (one retry on invalid output).
- `packages/agents/src/runtime/execute-task.ts` — claims a `QUEUED` task atomically (duplicate jobs are no-ops), runs the Orchestrator, and never overwrites a cancellation that happened mid-run.
- `apps/worker` — BullMQ consumer (concurrency 2, **no automatic retries** so side effects can't repeat), publishes events on Redis pub/sub; a crash marks the task `FAILED` rather than leaving it `RUNNING`.
- Internal tools so far: `kb.search` (approved knowledge only; keyword search until vectors land in M8) and `memory.propose` (stores `proposed` memory only).
- In M3 the Orchestrator answered directly with those tools; M4 added delegation (below).

### As built (Milestone 4): plan → delegate → verify → summarise
`packages/agents/src/orchestration/orchestrate.ts`. The model decides; code enforces the structure.
1. **Plan**: the Orchestrator (effort high, tools `kb.search`, `memory.propose`) receives the specialist catalogue (descriptions + current limitations) and must return a plan through `finish`, validated by `planSchema`: `intent`, output `language`, either `directAnswer` (no delegation, one model call) or 1–6 `steps` `{agent, instruction, acceptance, dependsOn}`. The agent enum only contains real specialists; `dependsOn` may only point to earlier steps, so cycles are impossible. Invalid plans are returned to the model to fix.
2. **Delegate**: steps run in order. A step receives its instruction, acceptance criteria, language, its own limitation, and only the outputs of the steps it depends on, wrapped in `<step_output>` tags and labelled as data. If a dependency failed, the step is skipped (`CANCELLED`) with the reason; independent steps still run. Cancellation is checked before every step. Each specialist returns `stepResultSchema` (`summary`, `output`, `sources`, `unverifiedClaims`, `blockers`).
3. **Verify + summarise**: a review run (`orchestratorReview`, effort medium) gets every step's instruction, acceptance, status and output, checks criteria and conflicts (with `kb.search`), and returns `answer`, `issues`, `nextSteps`. If the review fails, the raw step outputs are returned so work is never lost.
4. **Status**: `WAITING_APPROVAL` if any action awaits approval, `FAILED` if planning failed or no step produced a result, otherwise `COMPLETED` with issues listed.
Persistence: `agent_tasks.plan`, one `agent_steps` row per step (status tracked), specialist and review runs link to the planner run via `parent_run_id`, and specialist runs link to their step via `step_id`.

### As built (Milestone 5): Sales + WhatsApp
- Tools (`packages/agents/src/tools/crm.ts`): `conversation.read`, `crm.lead.search`, `crm.lead.get` (read), `crm.lead.update` (write: status except won/lost, append note, next follow-up, profile fit; rescored after), `whatsapp.send` (external → approval; a newer draft for the same conversation supersedes older pending ones via `supersedeKey`).
- Sales Agent: `kb.search`, `crm.lead.search`, `crm.lead.get`, `crm.lead.update`. WhatsApp Agent: `kb.search`, `conversation.read`, `crm.lead.update`, `whatsapp.send`.
- Inbound WhatsApp → webhook → `ingestInboundMessage` (contact/conversation/message/lead in one transaction, idempotent on provider message id) → debounced **triage job** → pre-planned task (`preset: true, skipReview: true`) that goes straight to the WhatsApp Agent. One model loop per burst of messages, no planner or review cost.
- Lead scoring is deterministic code (`packages/shared/src/lead-scoring.ts`), never model-generated; keyword signal detection covers English, Roman Urdu and Urdu script.

### As built (Milestone 6): Student + Course
- `course.catalog` (read) gives active courses and open batches with today's price (early-bird aware), dates, schedule and seats. It is granted to Sales, WhatsApp, Content, Marketing, Student and Course agents; draft courses are invisible to agents.
- Student Agent tools: `student.search`, `student.get` (attendance, assignments, verified vs pending payments, balance, certificate checks), `student.message` (external → approval, one pending per student), `certificate.request` (external → approval).
- Progress and eligibility are computed in code (`packages/database/src/education.ts`, `packages/shared/src/education.ts`), never by the model.

Specialists today: all eight exist with prompts in `agents/<id>/prompt.md` + `agents/_shared.md`. Until their data/tools arrive (CRM M5, students M6, web M8, analytics M12) each carries a `limitations` note that the planner sees and the agent must respect. For example, the Research Agent returns every time-sensitive claim as unverified because it has no web access yet.

Routing quality is measured with `pnpm eval:routing` (12 cases, planner only, real model). CI tests check the guard-rails (schema, dependencies, failure handling) with scripted mocks.

## 2. Orchestrator

The Orchestrator is an agent whose only tools are **delegation tools**:
`delegate(agentId, instruction, inputs)`, `request_approval(...)` and `finish(result)`.
It does **not** have CRM, messaging or publishing tools, so it can't do the specialist
work itself.

Flow:
1. **Classify**: intent + domain(s) + risk, as structured output.
2. **Plan**: an ordered list of steps with dependencies → `agent_steps`.
3. **Delegate**: each step becomes a child `agent_run` for a specialist.
4. **Verify**: checks each result against the step's acceptance criteria. Research claims need sources.
5. **Detect conflicts**: e.g. content cites a price that doesn't match the KB, so the step goes back to the agent.
6. **Approval**: any pending external action pauses the task (`WAITING_APPROVAL`).
7. **Summarise**: a short final answer for the operator.

Example: *"Find today's important AI developments and turn them into three Reel ideas."*
```
Task ─▶ Orchestrator plan
         1. research.find_developments(date=today)      → Research Agent
         2. research.verify(claims from 1)              → Research Agent (verification mode)
         3. content.reel_concepts(n=3, lang=ur, from=2) → Content Agent
         4. approval(content items)                     → Human
```

## 3. Specialist agents

| Agent | Responsibility | Tools (initial) | Never without approval |
|---|---|---|---|
| **Sales** | qualify + score leads, analyse conversations, recommend course, follow-ups, CRM notes | `crm.lead.*`, `kb.search`, `conversation.read`, `task.create` | sending messages, bulk status changes |
| **WhatsApp** | classify incoming messages, intent, draft replies, flag hot leads | `conversation.read`, `kb.search`, `message.draft`, `crm.lead.upsert`, `whatsapp.send` (external) | `whatsapp.send` |
| **Content** | ideas, hooks, scripts, captions, Reels, scene plans, image/video prompts, calendar | `kb.search`, `content.create_draft`, `calendar.read` | publishing |
| **Research** | AI tools/models/MCP/automation research, verification, sources, teaching material | `web.search`, `web.fetch`, `research.save` | none (read-only) |
| **Student** | profiles, enrollment, progress, attendance, assignments, recordings, certificates, support | `student.*`, `enrollment.*`, `class.*` | sending reminders, certificate issue |
| **Marketing** | campaign analysis, creatives, ad copy, audience hypotheses | `campaign.read`, `metrics.read`, `content.create_draft` | launching or changing campaigns or budgets (financial) |
| **Analytics** | revenue, leads, conversions, courses, content, campaigns, agent performance, reports | `analytics.query` (read-only SQL views) | none |
| **Course** | course structure, lessons, assignments, quizzes, docs | `course.*`, `kb.search`, `kb.propose_document` | publishing KB changes |

### Language rules (Content, WhatsApp, Course)
- Default language is set per request: `ur` (Urdu script), `ur-roman` (Roman Urdu) or `en`.
- Urdu: natural Pakistani Urdu, no needless English. Technical terms (AI, API, MCP, prompt, agent) stay in English.

### Research integrity
- Every claim carries `sources[]` (URL + retrieved_at). Anything without a source is labelled `unverified` and can't be presented as fact.

## 4. Memory layers

| Layer | Storage | Lifetime | Trust |
|---|---|---|---|
| 1. Short-term task memory | `agent_runs.state` JSON + Redis cache | one task | working scratch |
| 2. Conversation memory | `conversations` / `messages` | persistent | raw record |
| 3. Business knowledge | `knowledge_documents` / `knowledge_chunks` (pgvector) | persistent | **trusted only when `status = approved`** |
| 4. CRM / student data | `leads`, `students`, `enrollments` … | persistent | system of record |
| 5. Long-term structured memory | `memory_items` (kind: fact / preference / decision / event) | persistent | agent-proposed items start `status = proposed` |

Validation rule: agents can **propose** facts (`memory_items.status = 'proposed'`,
`knowledge_documents.status = 'draft'`) but only a human, or an owner-approved
policy, can promote them to `approved`. Retrieval for customer-facing answers
(prices, schedules, policies) reads **approved** knowledge only.

## 5. Statuses

Task / run status: `QUEUED → RUNNING → (WAITING_APPROVAL ↔ RUNNING) → COMPLETED | FAILED | CANCELLED`

## 6. Observability per run
`agent_runs` stores: agent, task, parent run, model provider + model, started/finished, latency ms, input/output tokens, cost estimate, tool calls count, error code/message, approval state, result JSON. The Agent Activity screen reads straight from this table.
