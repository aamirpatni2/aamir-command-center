CREATE TABLE "analytics_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"title" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"narrative" text,
	"source" text DEFAULT 'user' NOT NULL,
	"created_by" uuid,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_reports" ADD CONSTRAINT "analytics_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_reports_created_idx" ON "analytics_reports" USING btree ("created_at");