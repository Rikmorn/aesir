-- v2.3 Agents Schema
-- Creates the agents.* PostgreSQL schema namespace and all v2.3 tables.
-- Tables: conversations, agent_events, agent_sessions
-- This migration is idempotent and can be run multiple times safely.

CREATE SCHEMA IF NOT EXISTS "agents";
--> statement-breakpoint

-- Updated_at trigger function for agents schema
CREATE OR REPLACE FUNCTION agents.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Conversations table (executor state for agent conversations)
CREATE TABLE IF NOT EXISTS "agents"."conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_definition_id" text NOT NULL,
	"agent_definition_version" text NOT NULL,
	"messages" jsonb NOT NULL DEFAULT '[]',
	"status" text NOT NULL DEFAULT 'queued',
	"pending_wait" jsonb,
	"queued_signals" jsonb NOT NULL DEFAULT '[]',
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_status" ON "agents"."conversations" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_definition" ON "agents"."conversations" ("agent_definition_id");
--> statement-breakpoint

-- Agent events table (append-only event log)
CREATE TABLE IF NOT EXISTS "agents"."agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"agent_definition_id" text NOT NULL,
	"agent_definition_version" text NOT NULL,
	"agent_instance_id" text NOT NULL,
	"parent_instance_id" text,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL DEFAULT '{}',
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"token_count_input" integer,
	"token_count_output" integer,
	"duration_ms" integer,
	CONSTRAINT "uq_agent_events_conv_seq" UNIQUE("conversation_id", "sequence")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_events_conversation" ON "agents"."agent_events" ("conversation_id", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_events_type" ON "agents"."agent_events" ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_events_instance" ON "agents"."agent_events" ("agent_instance_id");
--> statement-breakpoint

-- Agent sessions table (materialized projection from events)
CREATE TABLE IF NOT EXISTS "agents"."agent_sessions" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"agent_definition_id" text NOT NULL,
	"status" text NOT NULL,
	"last_event_type" text NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"artifacts" jsonb NOT NULL DEFAULT '{}',
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Updated_at triggers for conversations and agent_sessions
-- (agent_events is append-only, no trigger needed)
DROP TRIGGER IF EXISTS update_conversations_updated_at ON agents.conversations;
--> statement-breakpoint
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON agents.conversations
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();
--> statement-breakpoint

DROP TRIGGER IF EXISTS update_agent_sessions_updated_at ON agents.agent_sessions;
--> statement-breakpoint
CREATE TRIGGER update_agent_sessions_updated_at
  BEFORE UPDATE ON agents.agent_sessions
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();
