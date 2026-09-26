-- Audit logs are append-only, enforced by the database itself: no role, not even the app's own,
-- can change or remove an entry through UPDATE or DELETE. (A table owner could still drop the
-- trigger; in production the app connects as a non-owner role, see docs/SECURITY_CHECKLIST.md.)
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% is not allowed)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
