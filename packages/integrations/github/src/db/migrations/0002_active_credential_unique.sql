-- Uniqueness must ignore soft-deleted rows. See the linear migration of the
-- same name; github keys on owner rather than workspace_id.

ALTER TABLE "github"."credentials" DROP CONSTRAINT IF EXISTS "credentials_owner_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "credentials_owner_active_unique"
  ON "github"."credentials" ("owner")
  WHERE "deleted_at" IS NULL;
