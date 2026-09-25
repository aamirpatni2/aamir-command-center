import { eq, schema, type Database } from "@acc/database";
import type { PresetPlan } from "../orchestration/orchestrate.js";

/**
 * Creates a pre-planned task that sends one WhatsApp conversation straight to the WhatsApp Agent
 * (no planner call, no review) — the cheap path for every inbound message.
 */
export async function createWhatsappTriageTask(db: Database, conversationId: string, requestedBy?: string) {
  const [row] = await db
    .select({ name: schema.contacts.name, phone: schema.contacts.phone })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(eq(schema.conversations.id, conversationId));
  if (!row) return null;
  const who = row.name ? `${row.name} (${row.phone})` : row.phone;
  const plan: PresetPlan = {
    preset: true,
    skipReview: true,
    intent: "Triage an inbound WhatsApp conversation",
    language: "ur-roman",
    steps: [
      {
        agent: "whatsapp",
        instruction:
          `Triage WhatsApp conversation ${conversationId} with ${who}: read it with conversation.read, classify the intent, ` +
          `submit a reply with whatsapp.send if one is appropriate (it goes to approval), and update the lead (status, note, next follow-up).`,
        acceptance: "Intent classified; a reply submitted for approval or a stated reason for not replying; lead updated.",
        dependsOn: [],
      },
    ],
  };
  const [task] = await db
    .insert(schema.agentTasks)
    .values({
      title: `WhatsApp triage · ${row.name ?? row.phone}`,
      input: `New WhatsApp activity from ${who} (conversation ${conversationId}). Triage it.`,
      source: requestedBy ? "user" : "webhook",
      requestedBy: requestedBy ?? null,
      plan: plan as unknown as Record<string, unknown>,
    })
    .returning();
  return task!;
}
