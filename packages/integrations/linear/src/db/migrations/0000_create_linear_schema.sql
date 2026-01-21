-- Linear Schema Migration
-- Creates the linear.* PostgreSQL schema namespace for Linear-specific data.
-- This migration is idempotent and can be run multiple times safely.

CREATE SCHEMA IF NOT EXISTS "linear";
--> statement-breakpoint

-- Credentials table
-- Stores OAuth tokens for Linear workspaces.
-- Tokens are encrypted at application level before storage.
-- Unlike integrations.credentials, this is Linear-specific (no provider field).
CREATE TABLE IF NOT EXISTS "linear"."credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_type" text DEFAULT 'Bearer',
	"scope" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "credentials_workspace_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint

-- Webhook deliveries table
-- Tracks webhook delivery attempts for idempotency.
CREATE TABLE IF NOT EXISTS "linear"."webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL UNIQUE,
	"event_type" text NOT NULL,
	"payload_hash" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Updated_at trigger function
-- Creates a trigger function if it doesn't already exist in the linear schema.
CREATE OR REPLACE FUNCTION linear.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS update_credentials_updated_at ON linear.credentials;
--> statement-breakpoint

-- Create trigger for credentials updated_at
CREATE TRIGGER update_credentials_updated_at
  BEFORE UPDATE ON linear.credentials
  FOR EACH ROW
  EXECUTE FUNCTION linear.update_updated_at_column();
--> statement-breakpoint

-- Drizzle migration tracking table
-- Tracks which migrations have been applied to the linear schema.
CREATE TABLE IF NOT EXISTS "linear"."__drizzle_linear_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"created_at" bigint
);
