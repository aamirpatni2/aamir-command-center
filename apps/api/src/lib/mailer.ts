/**
 * Outgoing email for invites and reset links.
 * - "smtp": SMTP_URL + EMAIL_FROM are set (Gmail app password, Zoho, Brevo, Resend, your host…).
 * - "mock": development only (ACC_ENABLE_MOCKS), no SMTP: each email is written to data/outbox/
 *   as JSON, clearly marked mock. Nothing leaves the machine.
 * - "off": not configured. Callers say so; nothing pretends to have been sent.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Env } from "@acc/config";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export type MailMode = "smtp" | "mock" | "off";
export type SendResult = { status: "sent" } | { status: "mock"; file: string } | { status: "not_configured" } | { status: "failed"; error: string };

export interface Mailer {
  readonly mode: MailMode;
  send(mail: Mail): Promise<SendResult>;
}

/** Never echo the SMTP URL (it carries the password) in an error shown to people or logs. */
function cleanError(err: unknown, smtpUrl?: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (smtpUrl) msg = msg.split(smtpUrl).join("[SMTP_URL]");
  msg = msg.replace(/smtps?:\/\/[^\s]+/g, "[SMTP_URL]");
  return msg.slice(0, 300);
}

export function createMailer(env: Pick<Env, "SMTP_URL" | "EMAIL_FROM" | "ACC_ENABLE_MOCKS" | "NODE_ENV">, opts: { outboxDir: string }): Mailer {
  if (env.SMTP_URL && env.EMAIL_FROM) {
    const transport = nodemailer.createTransport(env.SMTP_URL);
    const from = env.EMAIL_FROM;
    return {
      mode: "smtp",
      async send(mail) {
        try {
          await transport.sendMail({ from, ...mail });
          return { status: "sent" };
        } catch (err) {
          return { status: "failed", error: cleanError(err, env.SMTP_URL) };
        }
      },
    };
  }
  if (env.ACC_ENABLE_MOCKS && env.NODE_ENV !== "production") {
    return {
      mode: "mock",
      async send(mail) {
        await mkdir(opts.outboxDir, { recursive: true });
        const file = join(opts.outboxDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`);
        await writeFile(file, JSON.stringify({ mock: true, ...mail }, null, 2), { mode: 0o600 });
        return { status: "mock", file };
      },
    };
  }
  return { mode: "off", send: async () => ({ status: "not_configured" }) };
}

/** Test double: keeps sent mail in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  constructor(
    readonly mode: MailMode = "smtp",
    private readonly fail = false,
  ) {}
  async send(mail: Mail): Promise<SendResult> {
    if (this.mode === "off") return { status: "not_configured" };
    if (this.fail) return { status: "failed", error: "connection refused" };
    this.sent.push(mail);
    return { status: "sent" };
  }
}
