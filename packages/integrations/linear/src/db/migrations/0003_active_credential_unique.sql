-- Uniqueness must ignore soft-deleted rows.
--
-- store() soft-deletes the existing credential for a workspace and inserts a
-- new one, so two rows share a workspace_id with one of them deleted. A plain
-- UNIQUE counts the deleted row and rejects the insert, which meant a workspace
-- could never be re-authorised after its first credential.

ALTER TABLE "linear"."credentials" DROP CONSTRAINT IF EXISTS "credentials_workspace_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "credentials_workspace_active_unique"
  ON "linear"."credentials" ("workspace_id")
  WHERE "deleted_at" IS NULL;
