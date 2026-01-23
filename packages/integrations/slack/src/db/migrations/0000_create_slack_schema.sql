-- Slack Schema Migration
-- Creates the slack.* PostgreSQL schema namespace for Slack-specific data.
-- This migration is idempotent and can be run multiple times safely.

CREATE SCHEMA IF NOT EXISTS "slack";
--> statement-breakpoint

-- Installations table
-- Stores OAuth installations in Bolt's Installation format.
-- Tokens are encrypted at application level before storage.
-- Maps to Bolt's installationStore interface for OAuth token management.
CREATE TABLE IF NOT EXISTS "slack"."installations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"enterprise_id" text,
	"user_id" text,
	"is_enterprise_install" boolean DEFAULT false NOT NULL,
	"encrypted_bot_token" text NOT NULL,
	"encrypted_user_token" text,
	"bot_id" text,
	"bot_user_id" text,
	"bot_scopes" text,
	"app_id" text,
	"token_type" text DEFAULT 'bot' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "installations_team_enterprise_unique" UNIQUE("team_id", "enterprise_id")
);
--> statement-breakpoint

-- Event deliveries table
-- Tracks Slack events for deduplication via event_id.
-- Slack sends the same event multiple times if we don't respond quickly.
CREATE TABLE IF NOT EXISTS "slack"."event_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL UNIQUE,
	"event_type" text NOT NULL,
	"team_id" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Index for event_id lookups (primary deduplication key)
CREATE INDEX IF NOT EXISTS "event_deliveries_event_id_idx" ON "slack"."event_deliveries" ("event_id");
--> statement-breakpoint

-- Index for cleanup queries (by created_at)
CREATE INDEX IF NOT EXISTS "event_deliveries_created_at_idx" ON "slack"."event_deliveries" ("created_at");
--> statement-breakpoint

-- Updated_at trigger function
-- Creates a trigger function if it doesn't already exist in the slack schema.
CREATE OR REPLACE FUNCTION slack.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS update_installations_updated_at ON slack.installations;
--> statement-breakpoint

-- Create trigger for installations updated_at
CREATE TRIGGER update_installations_updated_at
  BEFORE UPDATE ON slack.installations
  FOR EACH ROW
  EXECUTE FUNCTION slack.update_updated_at_column();
--> statement-breakpoint

-- Drizzle migration tracking table
-- Tracks which migrations have been applied to the slack schema.
CREATE TABLE IF NOT EXISTS "slack"."__drizzle_slack_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"created_at" bigint
);
