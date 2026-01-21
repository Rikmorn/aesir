-- GitHub Schema Migration
-- Creates the github.* PostgreSQL schema namespace for GitHub-specific data.
-- This migration is idempotent and can be run multiple times safely.

CREATE SCHEMA IF NOT EXISTS "github";
--> statement-breakpoint

-- Credentials table
-- Stores OAuth tokens for GitHub organizations/users.
-- Tokens are encrypted at application level before storage.
-- Unlike integrations.credentials, this is GitHub-specific (no provider field).
CREATE TABLE IF NOT EXISTS "github"."credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"installation_id" text,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_type" text DEFAULT 'Bearer',
	"scope" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "credentials_owner_unique" UNIQUE("owner")
);
--> statement-breakpoint

-- Webhook deliveries table
-- Tracks webhook delivery attempts for idempotency.
CREATE TABLE IF NOT EXISTS "github"."webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL UNIQUE,
	"event_type" text NOT NULL,
	"payload_hash" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Updated_at trigger function
-- Creates a trigger function if it doesn't already exist in the github schema.
CREATE OR REPLACE FUNCTION github.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS update_credentials_updated_at ON github.credentials;
--> statement-breakpoint

-- Create trigger for credentials updated_at
CREATE TRIGGER update_credentials_updated_at
  BEFORE UPDATE ON github.credentials
  FOR EACH ROW
  EXECUTE FUNCTION github.update_updated_at_column();
--> statement-breakpoint

-- Drizzle migration tracking table
-- Tracks which migrations have been applied to the github schema.
CREATE TABLE IF NOT EXISTS "github"."__drizzle_github_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"created_at" bigint
);
