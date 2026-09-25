CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_id" AS ENUM('orchestrator', 'sales', 'whatsapp', 'content', 'research', 'student', 'marketing', 'analytics', 'course');--> statement-breakpoint
CREATE TYPE "public"."agent_message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."automation_trigger" AS ENUM('event', 'schedule', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('planned', 'enrolling', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."campaign_platform" AS ENUM('meta', 'google', 'tiktok', 'youtube', 'other');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."certificate_status" AS ENUM('not_eligible', 'eligible', 'issued');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'instagram', 'facebook', 'email', 'web', 'phone');--> statement-breakpoint
CREATE TYPE "public"."content_language" AS ENUM('ur', 'ur-roman', 'en');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('idea', 'hook', 'script', 'caption', 'post', 'reel', 'carousel', 'image_prompt', 'video_prompt');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'pending', 'closed');--> statement-breakpoint
CREATE TYPE "public"."course_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('pending', 'active', 'completed', 'dropped', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."knowledge_category" AS ENUM('course', 'pricing', 'schedule', 'policy', 'faq', 'teaching', 'business', 'marketing', 'brand');--> statement-breakpoint
CREATE TYPE "public"."knowledge_status" AS ENUM('draft', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'interested', 'negotiating', 'won', 'lost', 'nurture');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('fact', 'preference', 'decision', 'event');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('contact', 'user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'draft', 'pending_approval', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'jazzcash', 'easypaisa', 'card', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'verified', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('none', 'processing', 'available');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'paused', 'completed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'submitted', 'late', 'graded', 'missing');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('user', 'automation', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tool_risk" AS ENUM('read', 'draft', 'write', 'external', 'destructive', 'financial');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"phone" text,
	"email" "citext",
	"whatsapp_id" text,
	"locale" text DEFAULT 'ur-PK',
	"city" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_thread_id" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"intent" text,
	"assigned_agent" text,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" text DEFAULT 'unknown' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"score_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interested_course_id" uuid,
	"owner_user_id" uuid,
	"next_follow_up_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"provider_message_id" text,
	"body" text,
	"media" jsonb,
	"status" "message_status" NOT NULL,
	"sent_by" "message_sender" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"submission_url" text,
	"score" integer,
	"feedback" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"class_id" uuid,
	"title" text NOT NULL,
	"instructions" text,
	"due_at" timestamp with time zone,
	"max_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 90 NOT NULL,
	"meeting_url" text,
	"recording_url" text,
	"recording_status" "recording_status" DEFAULT 'none' NOT NULL,
	"attendance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"schedule" jsonb,
	"capacity" integer,
	"status" "batch_status" DEFAULT 'planned' NOT NULL,
	"price_minor" bigint,
	"early_bird_price_minor" bigint,
	"early_bird_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"level" text,
	"language" "content_language" DEFAULT 'ur' NOT NULL,
	"price_minor" bigint,
	"currency" char(3) DEFAULT 'PKR' NOT NULL,
	"duration_weeks" integer,
	"status" "course_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'pending' NOT NULL,
	"enrolled_at" timestamp with time zone,
	"certificate_status" "certificate_status" DEFAULT 'not_eligible' NOT NULL,
	"certificate_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid,
	"lead_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'PKR' NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"reference" text,
	"verified_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"user_id" uuid,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "campaign_platform" NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"objective" text,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"budget_minor" bigint,
	"currency" char(3) DEFAULT 'PKR' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"course_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "content_type" NOT NULL,
	"platform" text,
	"language" "content_language" DEFAULT 'ur' NOT NULL,
	"title" text,
	"body" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"source_task_id" uuid,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "agent_message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"tool_name" text,
	"tool_call_id" text,
	"tool_risk" "tool_risk",
	"latency_ms" integer,
	"is_error" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"step_id" uuid,
	"parent_run_id" uuid,
	"agent_id" "agent_id" NOT NULL,
	"status" "task_status" DEFAULT 'QUEUED' NOT NULL,
	"model_provider" text,
	"model" text,
	"input" jsonb,
	"output" jsonb,
	"state" jsonb,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micro_usd" bigint,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"agent_id" "agent_id" NOT NULL,
	"instruction" text NOT NULL,
	"depends_on" integer[] DEFAULT '{}' NOT NULL,
	"status" "task_status" DEFAULT 'QUEUED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"input" text NOT NULL,
	"requested_by" uuid,
	"source" "task_source" DEFAULT 'user' NOT NULL,
	"automation_rule_id" uuid,
	"status" "task_status" DEFAULT 'QUEUED' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"plan" jsonb,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"action_type" text NOT NULL,
	"tool_name" text NOT NULL,
	"risk" "tool_risk" NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"payload" jsonb NOT NULL,
	"edited_payload" jsonb,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by_agent" "agent_id",
	"requested_by_user" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"execution_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" "automation_trigger" NOT NULL,
	"trigger_config" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"subject" text NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"status" "memory_status" DEFAULT 'proposed' NOT NULL,
	"confidence" real,
	"source_run_id" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"token_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" "knowledge_category" NOT NULL,
	"language" "content_language" DEFAULT 'en' NOT NULL,
	"body" text NOT NULL,
	"status" "knowledge_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_interested_course_id_courses_id_fk" FOREIGN KEY ("interested_course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_batch_id_course_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."course_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_batch_id_course_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."course_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_batches" ADD CONSTRAINT "course_batches_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_batch_id_course_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."course_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "campaign_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_course_batch_id_course_batches_id_fk" FOREIGN KEY ("course_batch_id") REFERENCES "public"."course_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_source_task_id_agent_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_step_id_agent_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_parent_run_id_agent_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_automation_rule_id_automation_rules_id_fk" FOREIGN KEY ("automation_rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_user_users_id_fk" FOREIGN KEY ("requested_by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_phone_unique" ON "contacts" USING btree ("phone") WHERE "contacts"."deleted_at" IS NULL AND "contacts"."phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_channel_thread_unique" ON "conversations" USING btree ("channel","external_thread_id");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "conversations_last_message_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX "leads_contact_idx" ON "leads" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_one_open_per_contact" ON "leads" USING btree ("contact_id") WHERE "leads"."deleted_at" IS NULL AND "leads"."status" NOT IN ('won', 'lost');--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_id_unique" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_assignment_enrollment_unique" ON "assignment_submissions" USING btree ("assignment_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "assignments_batch_idx" ON "assignments" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "classes_batch_idx" ON "classes" USING btree ("batch_id","starts_at");--> statement-breakpoint
CREATE INDEX "course_batches_course_idx" ON "course_batches" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "course_batches_status_idx" ON "course_batches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_slug_unique" ON "courses" USING btree ("slug") WHERE "courses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_student_batch_unique" ON "enrollments" USING btree ("student_id","batch_id");--> statement-breakpoint
CREATE INDEX "enrollments_batch_idx" ON "enrollments" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_method_reference_unique" ON "payments" USING btree ("method","reference") WHERE "payments"."reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_enrollment_idx" ON "payments" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "students_contact_unique" ON "students" USING btree ("contact_id") WHERE "students"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_metrics_campaign_date_unique" ON "campaign_metrics" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_platform_external_unique" ON "campaigns" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "content_items_status_idx" ON "content_items" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "content_items_type_idx" ON "content_items" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_messages_run_seq_unique" ON "agent_messages" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "agent_runs_task_idx" ON "agent_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_status_idx" ON "agent_runs" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "agent_runs_created_idx" ON "agent_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_task_position_unique" ON "agent_steps" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_idempotency_unique" ON "approvals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approvals_task_idx" ON "approvals" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "memory_items_kind_status_idx" ON "memory_items" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "memory_items_subject_idx" ON "memory_items" USING btree ("subject");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_doc_index_unique" ON "knowledge_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_documents_category_status_idx" ON "knowledge_documents" USING btree ("category","status");