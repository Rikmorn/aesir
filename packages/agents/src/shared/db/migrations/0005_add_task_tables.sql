-- Phase 58.1: Task Schema and Service
-- Drop legacy tables, create tasks + task_handoffs, add task_id to conversations

-- 1. Drop legacy tables (v1/v2 schema, no longer used)
DROP TABLE IF EXISTS agents.execution_traces;

--> statement-breakpoint

DROP TABLE IF EXISTS agents.context_snapshots;

--> statement-breakpoint

DROP TABLE IF EXISTS agents.tasks;

--> statement-breakpoint

-- 2. Create new tasks table (v2.5 task primitive)
CREATE TABLE agents.tasks (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES agents.tasks(id),

  creator_type  TEXT NOT NULL CHECK (creator_type IN ('agent', 'human')),
  creator_id    TEXT NOT NULL,
  assignee_type TEXT NOT NULL CHECK (assignee_type IN ('agent', 'human')),
  assignee_id   TEXT NOT NULL,

  status        TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN ('created', 'active', 'paused', 'completed', 'cancelled')),

  title         TEXT NOT NULL,
  objective     TEXT,
  metadata      JSONB DEFAULT '{}',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

--> statement-breakpoint

CREATE INDEX idx_tasks_assignee ON agents.tasks(assignee_type, assignee_id, status);

--> statement-breakpoint

CREATE INDEX idx_tasks_parent ON agents.tasks(parent_id) WHERE parent_id IS NOT NULL;

--> statement-breakpoint

CREATE INDEX idx_tasks_status ON agents.tasks(status) WHERE status IN ('created', 'active', 'paused');

--> statement-breakpoint

-- 3. Create task_handoffs table
CREATE TABLE agents.task_handoffs (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES agents.tasks(id),
  conversation_id   TEXT NOT NULL REFERENCES agents.conversations(id),

  handoff_type      TEXT NOT NULL CHECK (handoff_type IN ('completion', 'pause', 'delegation', 'escalation')),
  context           JSONB NOT NULL,

  author_type       TEXT NOT NULL CHECK (author_type IN ('agent', 'human')),
  author_id         TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX idx_handoffs_task ON agents.task_handoffs(task_id, created_at);

--> statement-breakpoint

-- 4. Add task_id column to conversations
ALTER TABLE agents.conversations
  ADD COLUMN task_id TEXT REFERENCES agents.tasks(id);

--> statement-breakpoint

CREATE INDEX idx_conversations_task ON agents.conversations(task_id) WHERE task_id IS NOT NULL;
