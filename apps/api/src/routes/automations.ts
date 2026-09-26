import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AGENTS, dryRun, nextRuns, ruleFromRow, ruleToRow, validateSchedule, type AutomationQueue, type RuleRow } from "@acc/agents";
import { and, desc, eq, inArray, isNull, schema, sql, writeAudit, type Database } from "@acc/database";
import {
  ACTION_LABEL, AUTOMATION_EVENTS, AUTOMATION_TEMPLATES, CONDITION_OP_LABEL, CONDITION_OPS, describeTrigger, hasPermission, ruleDefinitionSchema,
  type RuleDefinition,
} from "@acc/shared";
import { HttpError, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });

export async function automationRoutes(app: FastifyInstance, opts: { db: Database; automations: AutomationQueue }) {
  const { db, automations } = opts;

  const validate = (body: unknown): RuleDefinition => {
    const def = parse(ruleDefinitionSchema, body);
    if (def.trigger.event === "schedule") {
      const err = validateSchedule(def.trigger.cron);
      if (err) throw new HttpError(400, "VALIDATION_ERROR", err, [{ path: "trigger.cron", message: err }]);
    }
    return def;
  };

  /** Keeps the repeatable job in step with the rule. Redis being down never loses the rule: the worker re-syncs on start. */
  const sync = async (row: RuleRow): Promise<string | null> => {
    const def = ruleFromRow(row);
    if (def.trigger.event !== "schedule") return null;
    try {
      await automations.syncSchedule({ id: row.id, active: row.enabled && !row.deletedAt, cron: def.trigger.cron, tz: def.trigger.tz });
      return null;
    } catch {
      return "Saved, but the schedule couldn't be registered because Redis is unavailable. It will be registered when the worker restarts.";
    }
  };

  const load = async (id: string) => {
    const [row] = await db.select().from(schema.automationRules).where(and(eq(schema.automationRules.id, id), isNull(schema.automationRules.deletedAt)));
    if (!row) throw notFound("Automation");
    return row;
  };

  const present = async (rows: RuleRow[]) => {
    const ids = rows.map((r) => r.id);
    // Correlated sub-queries use the fully qualified outer column (see CLAUDE.md).
    const stats = ids.length
      ? await db
          .select({
            ruleId: schema.automationRules.id,
            runs24h: sql<number>`(select count(*)::int from automation_runs a where a.rule_id = "automation_rules"."id" and a.created_at > now() - interval '24 hours')`,
            lastStatus: sql<string | null>`(select a.status from automation_runs a where a.rule_id = "automation_rules"."id" order by a.created_at desc limit 1)`,
          })
          .from(schema.automationRules)
          .where(inArray(schema.automationRules.id, ids))
      : [];
    return rows.map((r) => {
      const def = ruleFromRow(r);
      const s = stats.find((x) => x.ruleId === r.id);
      return {
        id: r.id,
        ...def,
        summary: describeTrigger(def.trigger),
        runCount: r.runCount,
        lastRunAt: r.lastRunAt,
        lastStatus: s?.lastStatus ?? null,
        runs24h: s?.runs24h ?? 0,
        nextRuns: def.trigger.event === "schedule" && r.enabled ? nextRuns(def.trigger.cron, 3).map((d) => d.toISOString()) : [],
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  };

  app.get("/api/automations", { preHandler: requireAuth("automations:read") }, async (req) => {
    const rows = await db.select().from(schema.automationRules).where(isNull(schema.automationRules.deletedAt)).orderBy(desc(schema.automationRules.createdAt));
    return {
      rules: await present(rows),
      canManage: hasPermission(req.auth!.user.role, "automations:manage"),
      catalog: {
        events: AUTOMATION_EVENTS,
        ops: CONDITION_OPS.map((op) => ({ op, label: CONDITION_OP_LABEL[op] })),
        actions: ACTION_LABEL,
        agents: Object.values(AGENTS).map((a) => ({ id: a!.id, description: a!.description })),
        templates: AUTOMATION_TEMPLATES,
      },
    };
  });

  app.get("/api/automations/runs", { preHandler: requireAuth("automations:read") }, async (req) => {
    const q = parse(z.object({ ruleId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const runs = await db
      .select({
        id: schema.automationRuns.id, ruleId: schema.automationRuns.ruleId, ruleName: schema.automationRules.name, event: schema.automationRuns.event,
        status: schema.automationRuns.status, context: schema.automationRuns.context, actions: schema.automationRuns.actions,
        error: schema.automationRuns.error, createdAt: schema.automationRuns.createdAt, finishedAt: schema.automationRuns.finishedAt,
      })
      .from(schema.automationRuns)
      .innerJoin(schema.automationRules, eq(schema.automationRules.id, schema.automationRuns.ruleId))
      .where(q.ruleId ? eq(schema.automationRuns.ruleId, q.ruleId) : undefined)
      .orderBy(desc(schema.automationRuns.createdAt))
      .limit(q.limit);
    return { runs };
  });

  app.post("/api/automations/dry-run", { preHandler: requireAuth("automations:manage") }, async (req) => {
    const def = validate(req.body);
    return { result: await dryRun(db, def) };
  });

  app.post("/api/automations", { preHandler: requireAuth("automations:manage") }, async (req, reply) => {
    const def = validate(req.body);
    const [row] = await db.insert(schema.automationRules).values({ ...ruleToRow(def), createdBy: req.auth!.user.id }).returning();
    await writeAudit(db, { ...auditMeta(req), action: "automation.create", entityType: "automation_rule", entityId: row!.id, metadata: { trigger: def.trigger.event, enabled: def.enabled } });
    const warning = await sync(row!);
    const [rule] = await present([row!]);
    return reply.code(201).send({ rule, warning });
  });

  app.put("/api/automations/:id", { preHandler: requireAuth("automations:manage") }, async (req) => {
    const { id } = parse(idParam, req.params);
    await load(id);
    const def = validate(req.body);
    const [row] = await db.update(schema.automationRules).set(ruleToRow(def)).where(eq(schema.automationRules.id, id)).returning();
    await writeAudit(db, { ...auditMeta(req), action: "automation.update", entityType: "automation_rule", entityId: id, metadata: { trigger: def.trigger.event, enabled: def.enabled } });
    const warning = await sync(row!);
    const [rule] = await present([row!]);
    return { rule, warning };
  });

  app.post("/api/automations/:id/enabled", { preHandler: requireAuth("automations:manage") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    await load(id);
    const [row] = await db.update(schema.automationRules).set({ enabled }).where(eq(schema.automationRules.id, id)).returning();
    await writeAudit(db, { ...auditMeta(req), action: enabled ? "automation.enable" : "automation.disable", entityType: "automation_rule", entityId: id });
    const warning = await sync(row!);
    const [rule] = await present([row!]);
    return { rule, warning };
  });

  /** Runs a schedule rule once now (even while switched off, so it can be tried safely first). */
  app.post("/api/automations/:id/run", { preHandler: requireAuth("automations:manage") }, async (req: FastifyRequest, reply) => {
    const { id } = parse(idParam, req.params);
    const row = await load(id);
    if (ruleFromRow(row).trigger.event !== "schedule") {
      throw new HttpError(400, "NOT_SCHEDULED", "Only scheduled automations can be run by hand; event rules run when their event happens");
    }
    try {
      await automations.runNow(id);
    } catch {
      throw new HttpError(503, "QUEUE_UNAVAILABLE", "The automation queue is unavailable. Is Redis running?");
    }
    await writeAudit(db, { ...auditMeta(req), action: "automation.run_now", entityType: "automation_rule", entityId: id });
    return reply.code(202).send({ queued: true });
  });

  app.delete("/api/automations/:id", { preHandler: requireAuth("automations:manage") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await load(id);
    const [row] = await db.update(schema.automationRules).set({ deletedAt: new Date(), enabled: false }).where(eq(schema.automationRules.id, id)).returning();
    await sync(row!);
    await writeAudit(db, { ...auditMeta(req), action: "automation.delete", entityType: "automation_rule", entityId: id });
    return reply.code(204).send();
  });
}
