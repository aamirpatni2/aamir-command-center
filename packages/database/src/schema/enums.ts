import { pgEnum } from "drizzle-orm/pg-core";
import {
  AGENT_IDS,
  APPROVAL_STATUSES,
  CONTENT_LANGUAGES,
  LEAD_STATUSES,
  ROLES,
  TASK_STATUSES,
  TOOL_RISKS,
} from "@acc/shared";

export const userRole = pgEnum("user_role", ROLES);
export const actorType = pgEnum("actor_type", ["user", "agent", "system"]);

export const leadStatus = pgEnum("lead_status", LEAD_STATUSES);
export const channel = pgEnum("channel", ["whatsapp", "instagram", "facebook", "email", "web", "phone"]);
export const conversationStatus = pgEnum("conversation_status", ["open", "pending", "closed"]);
export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageStatus = pgEnum("message_status", [
  "received", "draft", "pending_approval", "sent", "delivered", "read", "failed",
]);
export const messageSender = pgEnum("message_sender", ["contact", "user", "agent"]);

export const courseStatus = pgEnum("course_status", ["draft", "active", "archived"]);
export const batchStatus = pgEnum("batch_status", ["planned", "enrolling", "running", "completed", "cancelled"]);
export const studentStatus = pgEnum("student_status", ["active", "paused", "completed", "dropped"]);
export const enrollmentStatus = pgEnum("enrollment_status", ["pending", "active", "completed", "dropped", "refunded"]);
export const certificateStatus = pgEnum("certificate_status", ["not_eligible", "eligible", "issued"]);
export const recordingStatus = pgEnum("recording_status", ["none", "processing", "available"]);
export const submissionStatus = pgEnum("submission_status", ["pending", "submitted", "late", "graded", "missing"]);
export const paymentMethod = pgEnum("payment_method", ["bank_transfer", "jazzcash", "easypaisa", "card", "cash", "other"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "verified", "refunded", "failed"]);

export const contentType = pgEnum("content_type", [
  "idea", "hook", "script", "caption", "post", "reel", "carousel", "image_prompt", "video_prompt",
]);
export const contentStatus = pgEnum("content_status", ["draft", "in_review", "approved", "scheduled", "published", "rejected"]);
export const contentLanguage = pgEnum("content_language", CONTENT_LANGUAGES);
export const campaignPlatform = pgEnum("campaign_platform", ["meta", "google", "tiktok", "youtube", "other"]);
export const campaignStatus = pgEnum("campaign_status", ["draft", "active", "paused", "completed", "archived"]);

export const taskStatus = pgEnum("task_status", TASK_STATUSES);
export const taskSource = pgEnum("task_source", ["user", "automation", "webhook"]);
export const agentId = pgEnum("agent_id", AGENT_IDS);
export const agentMessageRole = pgEnum("agent_message_role", ["system", "user", "assistant", "tool"]);
export const toolRisk = pgEnum("tool_risk", TOOL_RISKS);
export const approvalStatus = pgEnum("approval_status", APPROVAL_STATUSES);
export const automationTrigger = pgEnum("automation_trigger", ["event", "schedule", "webhook"]);
export const memoryKind = pgEnum("memory_kind", ["fact", "preference", "decision", "event"]);
export const memoryStatus = pgEnum("memory_status", ["proposed", "approved", "rejected"]);

export const knowledgeCategory = pgEnum("knowledge_category", [
  "course", "pricing", "schedule", "policy", "faq", "teaching", "business", "marketing", "brand",
]);
export const knowledgeStatus = pgEnum("knowledge_status", ["draft", "approved", "archived"]);
