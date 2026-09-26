ALTER TABLE "approvals" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."approval_status";--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'executing', 'executed', 'rejected', 'expired', 'failed');--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."approval_status";--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "status" SET DATA TYPE "public"."approval_status" USING "status"::"public"."approval_status";--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "execution_attempts" integer DEFAULT 0 NOT NULL;