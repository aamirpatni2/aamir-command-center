import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Bolt, CalendarClock, CheckSquare, Clock, FlaskConical, Hourglass, MessageCircle, Pencil, Play, Plus, Trash2, UserPlus, Wallet, Workflow, X,
} from "lucide-react";
import { Button, Card, cn, EmptyState, fieldClass, StatTile, StatusBadge, Switch } from "@acc/ui";
import {
  ACTION_LABEL, AUTOMATION_EVENTS, CONDITION_OP_LABEL, CONDITION_OPS, describeTrigger,
  type AutomationAction, type AutomationCondition, type AutomationEvent, type AutomationTrigger, type RuleDefinition,
} from "@acc/shared";
import { api, ApiError } from "../lib/api.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import { agentMeta } from "../lib/agents.js";
import { PageHeader } from "../components/Layout.js";
import { AgentChip } from "../components/AgentChip.js";

interface Rule extends RuleDefinition {
  id: string;
  summary: string;
  runCount: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  runs24h: number;
  nextRuns: string[];
}
interface AutomationsResponse {
  rules: Rule[];
  canManage: boolean;
  catalog: { agents: { id: string; description: string }[]; templates: { id: string; definition: RuleDefinition }[] };
}
interface Run {
  id: string;
  ruleId: string;
  ruleName: string;
  event: string;
  status: string;
  context: Record<string, unknown>;
  actions: { type: string; status: string; message: string; taskId?: string; approvalId?: string }[];
  error: string | null;
  createdAt: string;
}
interface DryRunResult {
  sample: string;
  context: Record<string, unknown> | null;
  matched: boolean;
  conditions: { condition: AutomationCondition; actual: unknown; ok: boolean }[];
  actions: { type: string; preview: string }[];
  nextRuns?: string[];
}

const TRIGGER_ICON: Record<AutomationEvent, typeof Bolt> = {
  "whatsapp.message_received": MessageCircle,
  "lead.created": UserPlus,
  "payment.verified": Wallet,
  "lead.no_reply": Hourglass,
  "lead.inactive": Clock,
  schedule: CalendarClock,
};
const CRON_PRESETS = [
  { label: "Every day 7:45", cron: "45 7 * * *" },
  { label: "Weekdays 9:00", cron: "0 9 * * 1-5" },
  { label: "Mondays 10:00", cron: "0 10 * * 1" },
  { label: "Every 2 hours (9–21)", cron: "0 9-21/2 * * *" },
];

const errorText = (e: unknown) =>
  e instanceof ApiError ? [e.message, ...(Array.isArray(e.details) ? (e.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`) : [])].join(" · ") : "Something went wrong";

function defaultTrigger(event: AutomationEvent): AutomationTrigger {
  if (event === "lead.no_reply") return { event, hours: 20 };
  if (event === "lead.inactive") return { event, days: 7 };
  if (event === "schedule") return { event, cron: "45 7 * * *", tz: "Asia/Karachi" };
  return { event } as AutomationTrigger;
}

function defaultAction(type: AutomationAction["type"]): AutomationAction {
  if (type === "agent_task") return { type, agent: "sales", instruction: "" };
  if (type === "whatsapp.draft") return { type, text: "" };
  if (type === "whatsapp.template") return { type, template: "", language: "en", params: [] };
  return { type: "lead.update", followUpInHours: 2 };
}

// ── Read-only flow: IF → AND → THEN ──────────────────────────────────────

function Chip({ children, tone }: { children: React.ReactNode; tone: "if" | "and" | "then" }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
        tone === "if" && "border-viz-cyan/25 bg-viz-cyan/8 text-ink",
        tone === "and" && "border-line bg-surface-2 text-ink-2",
        tone === "then" && "border-viz-violet/25 bg-viz-violet/8 text-ink",
      )}
    >
      {children}
    </span>
  );
}

function actionSummary(a: AutomationAction) {
  if (a.type === "agent_task") return <><AgentChip id={a.agent} withLabel={false} className="[&>span]:size-5 [&>span>svg]:size-3" />{agentMeta(a.agent).label} agent: task</>;
  if (a.type === "whatsapp.draft") return <><CheckSquare className="size-3.5 text-status-warning" aria-hidden />WhatsApp draft → approval</>;
  if (a.type === "whatsapp.template") return <><CheckSquare className="size-3.5 text-status-warning" aria-hidden />Template “{a.template}” → approval</>;
  const parts = [a.status && `status → ${a.status}`, a.appendNote && "add note", a.followUpInHours !== undefined && `follow-up in ${a.followUpInHours}h`].filter(Boolean);
  return <>Update lead: {parts.join(", ")}</>;
}

function Flow({ def }: { def: RuleDefinition }) {
  const Icon = TRIGGER_ICON[def.trigger.event];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold tracking-widest text-viz-cyan">IF</span>
      <Chip tone="if"><Icon className="size-3.5 text-viz-cyan" aria-hidden />{describeTrigger(def.trigger)}</Chip>
      {def.conditions.map((c, i) => (
        <Chip key={i} tone="and">
          <span className="text-ink-3">and</span> {c.field} <span className="text-ink-3">{CONDITION_OP_LABEL[c.op]}</span> {c.value !== undefined && String(c.value)}
        </Chip>
      ))}
      <ArrowRight className="mx-0.5 size-3.5 text-ink-3" aria-hidden />
      <span className="text-[10px] font-bold tracking-widest text-viz-violet">THEN</span>
      {def.actions.map((a, i) => <Chip key={i} tone="then">{actionSummary(a)}</Chip>)}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────

function FieldInsert({ event, onInsert }: { event: AutomationEvent; onInsert: (s: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {AUTOMATION_EVENTS[event].fields.map((f) => (
        <button key={f} type="button" onClick={() => onInsert(`{{${f}}}`)} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 transition hover:border-accent/40 hover:text-ink">
          {`{{${f}}}`}
        </button>
      ))}
    </div>
  );
}

interface SyncedTemplate { name: string; language: string; status: string; body: string | null; bodyParams: number }

function Editor({ initial, id, agents, onDone }: { initial: RuleDefinition; id: string | null; agents: { id: string }[]; onDone: () => void }) {
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ["integrations"],
    queryFn: ({ signal }) => api<{ whatsappTemplates: SyncedTemplate[] }>("/api/integrations", { signal }),
    select: (d) => d.whatsappTemplates.filter((t) => t.status === "APPROVED"),
  });
  const [def, setDef] = useState<RuleDefinition>(initial);
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const event = def.trigger.event;
  const fields = AUTOMATION_EVENTS[event].fields as readonly string[];
  const set = (patch: Partial<RuleDefinition>) => setDef((d) => ({ ...d, ...patch }));
  const setCondition = (i: number, patch: Partial<AutomationCondition>) => set({ conditions: def.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setAction = (i: number, a: AutomationAction) => set({ actions: def.actions.map((x, j) => (j === i ? a : x)) });

  const save = useMutation({
    mutationFn: () => api<{ warning?: string }>(id ? `/api/automations/${id}` : "/api/automations", { method: id ? "PUT" : "POST", body: def }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["automations"] });
      onDone();
    },
  });
  const dry = useMutation({
    mutationFn: () => api<{ result: DryRunResult }>("/api/automations/dry-run", { method: "POST", body: def }),
    onSuccess: (r) => setPreview(r.result),
  });

  return (
    <Card title={id ? "Edit automation" : "New automation"} icon={<Workflow className="size-4" />} className="mb-6 border-accent/30 shadow-glow" action={<button onClick={onDone} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close editor"><X className="size-4" /></button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="auto-name" className="block text-sm font-medium text-ink-2">Name</label>
          <input id="auto-name" className={fieldClass} value={def.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Follow up hot leads who went quiet" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="auto-desc" className="block text-sm font-medium text-ink-2">Description (optional)</label>
          <input id="auto-desc" className={fieldClass} value={def.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
        </div>
      </div>

      {/* IF */}
      <section className="mt-5 rounded-2xl border border-viz-cyan/20 bg-viz-cyan/[0.03] p-4">
        <h3 className="mb-3 text-xs font-bold tracking-widest text-viz-cyan">IF · TRIGGER</h3>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <label htmlFor="auto-trigger" className="sr-only">Trigger</label>
            <select id="auto-trigger" className={fieldClass} value={event} onChange={(e) => set({ trigger: defaultTrigger(e.target.value as AutomationEvent), conditions: [] })}>
              {Object.entries(AUTOMATION_EVENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <p className="text-xs text-ink-3">{AUTOMATION_EVENTS[event].description}</p>
          </div>
          {def.trigger.event === "lead.no_reply" && (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              after <input type="number" min={1} max={720} className={cn(fieldClass, "w-24")} value={def.trigger.hours} onChange={(e) => set({ trigger: { event: "lead.no_reply", hours: Number(e.target.value) } })} /> hours
            </label>
          )}
          {def.trigger.event === "lead.inactive" && (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              after <input type="number" min={1} max={90} className={cn(fieldClass, "w-24")} value={def.trigger.days} onChange={(e) => set({ trigger: { event: "lead.inactive", days: Number(e.target.value) } })} /> days
            </label>
          )}
        </div>
        {def.trigger.event === "lead.no_reply" && def.trigger.hours >= 24 && (
          <p className="mt-2 text-xs text-status-warning">Heads-up: after 24 hours of silence WhatsApp won't deliver free-text messages; follow-ups then need approved templates (Milestone 11).</p>
        )}
        {def.trigger.event === "schedule" && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((p) => (
                <button key={p.cron} type="button" onClick={() => set({ trigger: { event: "schedule", cron: p.cron, tz: "Asia/Karachi" } })}
                  className={cn("rounded-full border px-2.5 py-1 text-xs transition", def.trigger.event === "schedule" && def.trigger.cron === p.cron ? "border-accent/50 bg-accent/15 text-ink" : "border-line bg-surface-2 text-ink-2 hover:text-ink")}>
                  {p.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              Cron (Pakistan time)
              <input className={cn(fieldClass, "w-48 font-mono")} value={def.trigger.cron} onChange={(e) => set({ trigger: { event: "schedule", cron: e.target.value, tz: "Asia/Karachi" } })} />
            </label>
          </div>
        )}

        <h3 className="mt-4 mb-2 text-xs font-bold tracking-widest text-ink-3">AND · CONDITIONS {def.conditions.length === 0 && <span className="font-normal tracking-normal normal-case">(none: runs every time)</span>}</h3>
        <ul className="space-y-2">
          {def.conditions.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <select aria-label="Field" className={cn(fieldClass, "w-auto")} value={c.field} onChange={(e) => setCondition(i, { field: e.target.value })}>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select aria-label="Comparison" className={cn(fieldClass, "w-auto")} value={c.op} onChange={(e) => setCondition(i, { op: e.target.value as AutomationCondition["op"] })}>
                {CONDITION_OPS.map((op) => <option key={op} value={op}>{CONDITION_OP_LABEL[op]}</option>)}
              </select>
              {!["exists", "not_exists"].includes(c.op) && (
                <input aria-label="Value" className={cn(fieldClass, "w-48")} placeholder={c.op === "in" ? "hot, warm" : "value"}
                  value={Array.isArray(c.value) ? c.value.join(", ") : c.value === undefined ? "" : String(c.value)}
                  onChange={(e) => setCondition(i, { value: c.op === "in" ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : ["gt", "gte", "lt", "lte"].includes(c.op) && e.target.value !== "" && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value })} />
              )}
              <button type="button" onClick={() => set({ conditions: def.conditions.filter((_, j) => j !== i) })} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-status-critical" aria-label="Remove condition"><X className="size-4" /></button>
            </li>
          ))}
        </ul>
        {def.conditions.length < 8 && (
          <button type="button" onClick={() => set({ conditions: [...def.conditions, { field: fields.includes("lead.band") ? "lead.band" : fields[0]!, op: "eq", value: "hot" }] })} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <Plus className="size-3.5" aria-hidden /> Add condition
          </button>
        )}
      </section>

      {/* THEN */}
      <section className="mt-4 rounded-2xl border border-viz-violet/20 bg-viz-violet/[0.03] p-4">
        <h3 className="mb-3 text-xs font-bold tracking-widest text-viz-violet">THEN · ACTIONS</h3>
        <ol className="space-y-3">
          {def.actions.map((a, i) => (
            <li key={i} className="rounded-xl border border-line bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-viz-violet/15 text-xs font-semibold text-viz-violet">{i + 1}</span>
                <select aria-label="Action" className={cn(fieldClass, "w-auto")} value={a.type} onChange={(e) => setAction(i, defaultAction(e.target.value as AutomationAction["type"]))}>
                  {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {a.type === "agent_task" && (
                  <select aria-label="Agent" className={cn(fieldClass, "w-auto")} value={a.agent} onChange={(e) => setAction(i, { ...a, agent: e.target.value as typeof a.agent })}>
                    {agents.map((g) => <option key={g.id} value={g.id}>{agentMeta(g.id).label}{g.id === "orchestrator" ? " (plans across agents)" : ""}</option>)}
                  </select>
                )}
                {def.actions.length > 1 && (
                  <button type="button" onClick={() => set({ actions: def.actions.filter((_, j) => j !== i) })} className="ml-auto rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-status-critical" aria-label="Remove action"><X className="size-4" /></button>
                )}
              </div>
              {a.type === "agent_task" && (
                <div className="mt-2">
                  <textarea aria-label="Instruction for the agent" rows={3} className={fieldClass} value={a.instruction} placeholder="What should the agent do? Use {{fields}} from the event." onChange={(e) => setAction(i, { ...a, instruction: e.target.value })} />
                  <FieldInsert event={event} onInsert={(s) => setAction(i, { ...a, instruction: `${a.instruction}${s}` })} />
                </div>
              )}
              {a.type === "whatsapp.draft" && (
                <div className="mt-2">
                  <textarea aria-label="Message text" rows={3} className={fieldClass} value={a.text} placeholder="Assalam o Alaikum {{contact.name}}! …" onChange={(e) => setAction(i, { ...a, text: e.target.value })} />
                  <FieldInsert event={event} onInsert={(s) => setAction(i, { ...a, text: `${a.text}${s}` })} />
                  <p className="mt-1.5 text-xs text-status-warning">Never sent automatically: every draft waits in the Approval Center.</p>
                </div>
              )}
              {a.type === "whatsapp.template" && (
                <div className="mt-2 space-y-2">
                  {templates.data?.length ? (
                    <select aria-label="Template" className={fieldClass} value={`${a.template}|${a.language}`} onChange={(e) => {
                      const [template, language] = e.target.value.split("|") as [string, string];
                      const t = templates.data!.find((x) => x.name === template && x.language === language);
                      setAction(i, { ...a, template, language, params: Array.from({ length: t?.bodyParams ?? 0 }, (_, k) => a.params[k] ?? "") });
                    }}>
                      <option value="|">Choose an approved template…</option>
                      {templates.data.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) · {t.bodyParams} param{t.bodyParams === 1 ? "" : "s"}</option>)}
                    </select>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-[1fr_8rem]">
                      <input aria-label="Template name" className={fieldClass} placeholder="Template name (as in WhatsApp Manager)" value={a.template} onChange={(e) => setAction(i, { ...a, template: e.target.value })} />
                      <input aria-label="Template language" className={fieldClass} placeholder="en" value={a.language} onChange={(e) => setAction(i, { ...a, language: e.target.value })} />
                    </div>
                  )}
                  {(() => {
                    const t = templates.data?.find((x) => x.name === a.template && x.language === a.language);
                    return t?.body ? <p className="rounded-lg bg-surface-3 px-3 py-2 text-xs text-ink-2">{t.body}</p> : null;
                  })()}
                  {a.params.map((p, k) => (
                    <input key={k} aria-label={`Parameter ${k + 1}`} className={fieldClass} placeholder={`{{${k + 1}}}`} value={p} onChange={(e) => setAction(i, { ...a, params: a.params.map((x, j) => (j === k ? e.target.value : x)) })} />
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    {a.params.length < 10 && <button type="button" onClick={() => setAction(i, { ...a, params: [...a.params, ""] })} className="text-xs font-medium text-accent hover:underline">+ Parameter</button>}
                    {a.params.length > 0 && <button type="button" onClick={() => setAction(i, { ...a, params: a.params.slice(0, -1) })} className="text-xs text-ink-3 hover:text-ink">− Remove last</button>}
                  </div>
                  <FieldInsert event={event} onInsert={(s) => a.params.length && setAction(i, { ...a, params: a.params.map((x, j) => (j === a.params.length - 1 ? `${x}${s}` : x)) })} />
                  <p className="text-xs text-status-warning">Templates work outside WhatsApp's 24-hour window. Still never sent without your approval.{!templates.data?.length && " No approved templates synced yet (Integrations page)."}</p>
                </div>
              )}
              {a.type === "lead.update" && (
                <div className="mt-2 grid gap-2 md:grid-cols-[auto_1fr_auto]">
                  <select aria-label="New status" className={fieldClass} value={a.status ?? ""} onChange={(e) => setAction(i, { ...a, status: (e.target.value || undefined) as typeof a.status })}>
                    <option value="">Keep status</option>
                    {["new", "contacted", "qualified", "interested", "negotiating", "nurture"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input aria-label="Note to add" className={fieldClass} placeholder="Note to add (optional)" value={a.appendNote ?? ""} onChange={(e) => setAction(i, { ...a, appendNote: e.target.value || undefined })} />
                  <label className="flex items-center gap-2 text-sm whitespace-nowrap text-ink-2">
                    follow-up in
                    <input type="number" min={0} className={cn(fieldClass, "w-20")} value={a.followUpInHours ?? ""} onChange={(e) => setAction(i, { ...a, followUpInHours: e.target.value === "" ? undefined : Number(e.target.value) })} /> h
                  </label>
                </div>
              )}
            </li>
          ))}
        </ol>
        {def.actions.length < 5 && (
          <button type="button" onClick={() => set({ actions: [...def.actions, defaultAction("lead.update")] })} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <Plus className="size-3.5" aria-hidden /> Add action
          </button>
        )}
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          At most <input type="number" min={1} max={200} className={cn(fieldClass, "w-20")} value={def.maxRunsPerHour} onChange={(e) => set({ maxRunsPerHour: Number(e.target.value) })} /> runs per hour
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <Switch checked={def.enabled} onChange={(v) => set({ enabled: v })} label="Switched on" /> {def.enabled ? "On" : "Off (save and try a dry run first)"}
        </label>
      </div>

      {preview && (
        <div role="status" className="mt-4 rounded-2xl border border-line bg-surface-2 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-ink"><FlaskConical className="size-4 text-accent" aria-hidden /> Dry run · {preview.sample}{preview.context && <StatusBadge status={preview.matched ? "completed" : "disabled"} label={preview.matched ? "Would run" : "Wouldn't run"} />}</p>
          {preview.conditions.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {preview.conditions.map((c, i) => (
                <li key={i} className={c.ok ? "text-status-good" : "text-status-critical"}>
                  {c.ok ? "✓" : "✗"} {c.condition.field} {CONDITION_OP_LABEL[c.condition.op]} {String(c.condition.value ?? "")} <span className="text-ink-3">(actual: {String(c.actual ?? "empty")})</span>
                </li>
              ))}
            </ul>
          )}
          {preview.actions.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-2">{preview.actions.map((a, i) => <li key={i} className="whitespace-pre-wrap">{a.preview}</li>)}</ol>
          )}
          {preview.nextRuns && <p className="mt-2 text-xs text-ink-3">Next runs: {preview.nextRuns.map((d) => formatDateTime(d)).join(" · ")}</p>}
          <p className="mt-2 text-[11px] text-ink-3">Nothing was saved, sent or queued.</p>
        </div>
      )}
      {(save.isError || dry.isError) && <p role="alert" className="mt-3 text-sm text-status-critical">{errorText(save.error ?? dry.error)}</p>}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{id ? "Save changes" : "Create automation"}</Button>
        <Button variant="secondary" onClick={() => dry.mutate()} disabled={dry.isPending}><FlaskConical className="size-4" aria-hidden /> Dry run</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

function RuleCard({ rule, canManage, onEdit }: { rule: Rule; canManage: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["automations"] });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api(`/api/automations/${rule.id}/enabled`, { method: "POST", body: { enabled } }), onSettled: refresh });
  const runNow = useMutation({ mutationFn: () => api(`/api/automations/${rule.id}/run`, { method: "POST" }), onSuccess: () => setTimeout(refresh, 1500) });
  const remove = useMutation({ mutationFn: () => api(`/api/automations/${rule.id}`, { method: "DELETE" }), onSuccess: refresh });
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <li>
      <Card className={cn("transition duration-300", !rule.enabled && "opacity-80")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold text-ink">{rule.name}</h2>
            {rule.description && <p className="mt-0.5 text-sm text-ink-2">{rule.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={rule.enabled ? "enabled" : "disabled"} />
            {canManage && <Switch checked={rule.enabled} onChange={(v) => toggle.mutate(v)} disabled={toggle.isPending} label={rule.enabled ? `Switch off ${rule.name}` : `Switch on ${rule.name}`} />}
          </div>
        </div>
        <div className="mt-4"><Flow def={rule} /></div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-ink-3">
          <span className="tabular">{rule.runCount} run{rule.runCount === 1 ? "" : "s"} · {rule.runs24h} in 24 h</span>
          {rule.lastRunAt && <span className="flex items-center gap-1.5">last {timeAgo(rule.lastRunAt)} {rule.lastStatus && <StatusBadge status={rule.lastStatus} />}</span>}
          {rule.nextRuns[0] && <span>next {formatDateTime(rule.nextRuns[0])}</span>}
          <span>max {rule.maxRunsPerHour}/h</span>
          {canManage && (
            <span className="ml-auto flex items-center gap-1">
              {rule.trigger.event === "schedule" && (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => runNow.mutate()} disabled={runNow.isPending}><Play className="size-3.5" aria-hidden />{runNow.isSuccess ? "Queued" : "Run now"}</Button>
              )}
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onEdit}><Pencil className="size-3.5" aria-hidden />Edit</Button>
              {confirmDelete ? (
                <>
                  <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => remove.mutate()} disabled={remove.isPending}>Delete</Button>
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirmDelete(false)}>Keep</Button>
                </>
              ) : (
                <Button variant="ghost" className="px-2 py-1 text-xs text-status-critical" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${rule.name}`}><Trash2 className="size-3.5" aria-hidden /></Button>
              )}
            </span>
          )}
        </div>
        {(toggle.isError || runNow.isError || remove.isError) && <p role="alert" className="mt-2 text-xs text-status-critical">{errorText(toggle.error ?? runNow.error ?? remove.error)}</p>}
      </Card>
    </li>
  );
}

const BLANK: RuleDefinition = { name: "", trigger: { event: "whatsapp.message_received" }, conditions: [], actions: [{ type: "lead.update", followUpInHours: 2 }], maxRunsPerHour: 30, enabled: false };

export function AutomationsPage() {
  const q = useQuery({ queryKey: ["automations"], queryFn: ({ signal }) => api<AutomationsResponse>("/api/automations", { signal }), refetchInterval: 20_000 });
  const runs = useQuery({ queryKey: ["automations", "runs"], queryFn: ({ signal }) => api<{ runs: Run[] }>("/api/automations/runs?limit=30", { signal }), refetchInterval: 20_000 });
  const [editing, setEditing] = useState<{ id: string | null; def: RuleDefinition } | null>(null);
  const data = q.data;
  const rules = data?.rules ?? [];
  const active = rules.filter((r) => r.enabled).length;

  const open = (id: string | null, def: RuleDefinition) => {
    setEditing({ id, def: structuredClone(def) });
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <PageHeader
        title="Automations"
        description="IF something happens, THEN agents act. Messages always wait for your approval, every run is logged, and each event fires a rule only once."
        action={data?.canManage && !editing ? <Button onClick={() => open(null, BLANK)}><Plus className="size-4" aria-hidden /> New automation</Button> : undefined}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile tone="emerald" label="Switched on" icon={<Bolt className="size-4" />} value={data ? active : "—"} loading={q.isLoading} />
        <StatTile tone="indigo" label="Rules" icon={<Workflow className="size-4" />} value={data ? rules.length : "—"} loading={q.isLoading} />
        <StatTile tone="cyan" label="Runs in 24 h" icon={<Play className="size-4" />} value={data ? rules.reduce((t, r) => t + r.runs24h, 0) : "—"} loading={q.isLoading} />
        <StatTile tone="violet" label="Runs all time" icon={<Clock className="size-4" />} value={data ? rules.reduce((t, r) => t + r.runCount, 0) : "—"} loading={q.isLoading} />
      </div>

      {editing && data && <Editor key={editing.id ?? "new"} initial={editing.def} id={editing.id} agents={data.catalog.agents} onDone={() => setEditing(null)} />}

      {data?.canManage && !editing && (
        <section className="mb-6" aria-labelledby="templates-h">
          <h2 id="templates-h" className="mb-3 text-sm font-semibold text-ink">Start from a template <span className="font-normal text-ink-3">· created switched off, so you can review and dry-run first</span></h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.catalog.templates.map((t) => {
              const Icon = TRIGGER_ICON[t.definition.trigger.event];
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => open(null, t.definition)} className="glass group h-full w-full rounded-2xl p-4 text-left transition duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-glow">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="size-4 text-viz-cyan" aria-hidden />{t.definition.name}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-3">{t.definition.description}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent opacity-80 group-hover:opacity-100">Use template <ArrowRight className="size-3" aria-hidden /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {q.isError ? (
        <p role="alert" className="text-sm text-status-critical">{errorText(q.error)}</p>
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState icon={<Workflow className="size-5" />} title={q.isLoading ? "Loading…" : "No automations yet"}>
            {data?.canManage ? "Start from a template above, or build your own rule." : "The owner hasn't set up any automations yet."}
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-4">{rules.map((r) => <RuleCard key={r.id} rule={r} canManage={!!data?.canManage} onEdit={() => open(r.id, r)} />)}</ul>
      )}

      <Card title="Recent runs" icon={<Clock className="size-4" />} className="mt-6 p-0 [&>header]:px-5 [&>header]:pt-5">
        {runs.data?.runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line"><tr>{["When", "Rule", "Status", "What happened"].map((h) => <th key={h} className="px-5 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {runs.data.runs.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-5 py-2.5 whitespace-nowrap text-ink-2" title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</td>
                    <td className="px-5 py-2.5 text-ink">{r.ruleName}<span className="block text-xs text-ink-3">{AUTOMATION_EVENTS[r.event as AutomationEvent]?.label ?? r.event}{typeof r.context["contact.name"] === "string" ? ` · ${r.context["contact.name"]}` : ""}</span></td>
                    <td className="px-5 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-5 py-2.5 text-xs text-ink-2">
                      {r.error && <p className="text-status-warning">{r.error}</p>}
                      <ul className="space-y-0.5">
                        {r.actions.map((a, i) => (
                          <li key={i} className={a.status === "error" ? "text-status-critical" : a.status === "skipped" ? "text-ink-3" : ""}>
                            {a.message}
                            {a.taskId && <> · <Link to={`/tasks/${a.taskId}`} className="text-accent hover:underline">task</Link></>}
                            {a.approvalId && <> · <Link to="/approvals" className="text-accent hover:underline">approval</Link></>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Clock className="size-5" />} title="No runs yet">When a switched-on rule fires, each run and what it did is listed here.</EmptyState>
        )}
      </Card>
    </>
  );
}
