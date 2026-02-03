/**
 * Agents Schema Migration SQL
 *
 * SQL to create the agents.* schema for integration tests.
 * This mirrors the production schema from @aesir/agents.
 * Concatenates all 3 migration files (0000, 0001, 0002).
 */

export const agentsMigrationSql = `
-- 0000_create_agents_schema.sql
-- Creates the agents.* PostgreSQL schema namespace for agent-specific data.

CREATE SCHEMA IF NOT EXISTS "agents";

-- Context snapshots table
CREATE TABLE IF NOT EXISTS "agents"."context_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"stage" text NOT NULL,
	"summary" text NOT NULL,
	"completed_actions" jsonb DEFAULT '[]',
	"pending_intent" text,
	"known_issues" jsonb DEFAULT '[]',
	"project_context" jsonb DEFAULT '{}',
	"key_files" jsonb DEFAULT '[]',
	"research_findings" jsonb,
	"plan" jsonb,
	"tool_call_count" integer NOT NULL DEFAULT 0,
	"token_count" jsonb DEFAULT '{"input":0,"output":0}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "context_snapshots_task_idx" ON "agents"."context_snapshots" ("task_id");

CREATE INDEX IF NOT EXISTS "context_snapshots_workflow_idx" ON "agents"."context_snapshots" ("workflow_id");

-- Tasks table
CREATE TABLE IF NOT EXISTS "agents"."tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL UNIQUE,
	"issue_id" text,
	"issue_identifier" text,
	"agent_type" text NOT NULL,
	"workflow_id" text,
	"status" text NOT NULL DEFAULT 'pending',
	"container_id" text,
	"branch_name" text,
	"pr_number" integer,
	"pr_url" text,
	"approval_status" text DEFAULT 'pending',
	"approval_feedback" text,
	"error" text,
	"escalation_reason" text,
	"slack_channel" text,
	"slack_message_ts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tasks_workflow_idx" ON "agents"."tasks" ("workflow_id");

CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "agents"."tasks" ("status");

-- Execution traces table
CREATE TABLE IF NOT EXISTS "agents"."execution_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"agent_instance_id" text NOT NULL,
	"parent_agent_instance_id" text,
	"step_number" integer NOT NULL,
	"type" text NOT NULL,
	"tool_name" text,
	"input" jsonb,
	"output" jsonb,
	"token_count_input" integer,
	"token_count_output" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "execution_traces_task_idx" ON "agents"."execution_traces" ("task_id");

CREATE INDEX IF NOT EXISTS "execution_traces_instance_idx" ON "agents"."execution_traces" ("agent_instance_id");

CREATE INDEX IF NOT EXISTS "execution_traces_parent_idx" ON "agents"."execution_traces" ("parent_agent_instance_id");

CREATE INDEX IF NOT EXISTS "execution_traces_workflow_idx" ON "agents"."execution_traces" ("workflow_id");

-- Updated_at trigger function for agents schema
CREATE OR REPLACE FUNCTION agents.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at columns
DROP TRIGGER IF EXISTS update_context_snapshots_updated_at ON agents.context_snapshots;

CREATE TRIGGER update_context_snapshots_updated_at
  BEFORE UPDATE ON agents.context_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON agents.tasks;

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON agents.tasks
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();

-- 0001_add_v23_tables.sql
-- Adds conversations, agent_events, and agent_sessions tables.

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

CREATE INDEX IF NOT EXISTS "idx_conversations_status" ON "agents"."conversations" ("status");

CREATE INDEX IF NOT EXISTS "idx_conversations_definition" ON "agents"."conversations" ("agent_definition_id");

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

CREATE INDEX IF NOT EXISTS "idx_agent_events_conversation" ON "agents"."agent_events" ("conversation_id", "sequence");

CREATE INDEX IF NOT EXISTS "idx_agent_events_type" ON "agents"."agent_events" ("type");

CREATE INDEX IF NOT EXISTS "idx_agent_events_instance" ON "agents"."agent_events" ("agent_instance_id");

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

-- Updated_at triggers for new tables
DROP TRIGGER IF EXISTS update_conversations_updated_at ON agents.conversations;

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON agents.conversations
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_sessions_updated_at ON agents.agent_sessions;

CREATE TRIGGER update_agent_sessions_updated_at
  BEFORE UPDATE ON agents.agent_sessions
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();

-- 0002_add_executor_columns.sql
-- Adds retry tracking, signal deduplication, parent conversation, and LZ4 compression.

-- Retry tracking columns
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 2;

ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS error_message text;

-- Signal deduplication
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS delivered_signal_ids jsonb NOT NULL DEFAULT '[]';

-- Sub-agent tracking
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS parent_conversation_id text;

-- Partial index for parent conversation lookups
CREATE INDEX IF NOT EXISTS idx_conversations_parent ON agents.conversations (parent_conversation_id) WHERE parent_conversation_id IS NOT NULL;

-- Enable LZ4 compression on messages JSONB column (PostgreSQL 14+)
ALTER TABLE agents.conversations ALTER COLUMN messages SET COMPRESSION lz4;
`;
