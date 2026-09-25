/**
 * DEV TOOL: sends a correctly signed, Cloud-API-shaped inbound message to the local webhook,
 * exercising the real verification → storage → scoring → triage path without a Meta account.
 *
 *   pnpm whatsapp:simulate --from 923001234567 --name "Ali Khan" "Salam, fee kitni hai?"
 *
 * Uses WHATSAPP_APP_SECRET from .env. Refuses to run with NODE_ENV=production.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { buildWhatsappTextPayload, signWhatsappBody } from "@acc/agents";
import { loadEnv } from "@acc/config";

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("✖ simulator is disabled in production");
  process.exit(1);
}
if (!env.WHATSAPP_APP_SECRET) {
  console.error("✖ set WHATSAPP_APP_SECRET in .env (any value for local testing)");
  process.exit(1);
}
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { from: { type: "string", default: "923001234567" }, name: { type: "string", default: "Test Customer" }, url: { type: "string", default: `http://localhost:${env.API_PORT}` } },
});
const text = positionals.join(" ") || "Salam! Course ki fee kitni hai?";
const raw = JSON.stringify(buildWhatsappTextPayload({ from: values.from!, name: values.name!, id: `wamid.SIM_${randomUUID()}`, text }));
const res = await fetch(`${values.url}/api/webhooks/whatsapp`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": signWhatsappBody(raw, env.WHATSAPP_APP_SECRET) },
  body: raw,
});
console.log(res.status, await res.text());
