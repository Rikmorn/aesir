-- Agents Schema Migration
-- Creates the agents.* PostgreSQL schema namespace for agent-specific data.
-- This migration is idempotent and can be run multiple times safely.

CREATE SCHEMA IF NOT EXISTS "agents";
--> statement-breakpoint

-- Context snapshots table
-- Stores semantic context at Temporal activity boundaries.
-- Written at the end of each activity, read at the start of the next.
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_snapshots_task_idx" ON "agents"."context_snapshots" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_snapshots_workflow_idx" ON "agents"."context_snapshots" ("workflow_id");
--> statement-breakpoint

-- Tasks table
-- Tracks agent task lifecycle and critical structured data.
-- One row per external task (e.g., Linear issue).
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_workflow_idx" ON "agents"."tasks" ("workflow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "agents"."tasks" ("status");
--> statement-breakpoint

-- Execution traces table
-- Records per-step execution traces for debugging and observability.
-- Supports parent/child correlation for orchestrator + sub-agent hierarchies.
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_traces_task_idx" ON "agents"."execution_traces" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_traces_instance_idx" ON "agents"."execution_traces" ("agent_instance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_traces_parent_idx" ON "agents"."execution_traces" ("parent_agent_instance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_traces_workflow_idx" ON "agents"."execution_traces" ("workflow_id");
--> statement-breakpoint

-- Updated_at trigger function for agents schema
-- Creates a trigger function if it doesn't already exist in the agents schema.
CREATE OR REPLACE FUNCTION agents.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Triggers for updated_at columns
DROP TRIGGER IF EXISTS update_context_snapshots_updated_at ON agents.context_snapshots;
--> statement-breakpoint
CREATE TRIGGER update_context_snapshots_updated_at
  BEFORE UPDATE ON agents.context_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();
--> statement-breakpoint

DROP TRIGGER IF EXISTS update_tasks_updated_at ON agents.tasks;
--> statement-breakpoint
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON agents.tasks
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();
