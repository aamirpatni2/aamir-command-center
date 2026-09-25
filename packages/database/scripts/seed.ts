/**
 * Development seed data. Refuses to run in production.
 * Contains sample records only — no real people or prices. Replace via the UI/KB.
 */
import { loadEnv } from "@acc/config";
import { createDb } from "../src/client.js";
import { courses, knowledgeDocuments } from "../src/schema/index.js";

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("✖ seed is disabled in production");
  process.exit(1);
}

const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
try {
  await db
    .insert(courses)
    .values([
      { slug: "sample-practical-ai", title: "[SAMPLE] Practical AI Training", language: "ur", status: "draft" },
      { slug: "sample-ai-agents", title: "[SAMPLE] AI Agents & Automation", language: "ur", status: "draft" },
    ])
    .onConflictDoNothing();
  await db
    .insert(knowledgeDocuments)
    .values({
      title: "[SAMPLE] FAQ placeholder",
      category: "faq",
      body: "Replace with approved FAQ content. Draft documents are never used for customer-facing answers.",
      status: "draft",
    });
  console.log("✔ dev seed inserted (sample records are marked [SAMPLE] and left as draft)");
} finally {
  await close();
}
