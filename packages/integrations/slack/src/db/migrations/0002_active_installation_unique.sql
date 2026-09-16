-- Uniqueness must ignore soft-deleted rows.
--
-- Slack keys on (team_id, enterprise_id). The plain constraint never fired for
-- an ordinary install because enterprise_id is NULL there and PostgreSQL treats
-- NULLs as distinct, so the bug only reached enterprise installs -- and the
-- test covering it passed for that reason rather than on merit.
--
-- NULLS are left distinct here, matching the old constraint's behaviour. That
-- means active uniqueness is still unenforced for ordinary installs; changing
-- it needs NULLS NOT DISTINCT and its own decision.

ALTER TABLE "slack"."installations" DROP CONSTRAINT IF EXISTS "installations_team_enterprise_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "installations_team_enterprise_active_unique"
  ON "slack"."installations" ("team_id", "enterprise_id")
  WHERE "deleted_at" IS NULL;
