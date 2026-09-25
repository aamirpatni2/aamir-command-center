-- Extensions must exist before tables that use their types.
-- `vector` is not a trusted extension: on managed Postgres enable it once as an admin
-- (see docs/DATABASE_DESIGN.md). IF NOT EXISTS makes this a no-op when already present.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
