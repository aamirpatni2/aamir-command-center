CREATE TABLE "research_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"teaching_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
CREATE INDEX "research_reports_created_idx" ON "research_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_hnsw" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- Full-text search over chunks ('simple' config: works for English, Roman Urdu and Urdu script tokens).
ALTER TABLE "knowledge_chunks" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tsv_gin" ON "knowledge_chunks" USING gin ("tsv");
