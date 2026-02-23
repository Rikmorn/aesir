-- Migration: Add tree-level token budget tracking + fix task status constraint
-- Phase 83: Tree-Level Token Budgets

-- Tree budget columns on conversations
ALTER TABLE agents.conversations
  ADD COLUMN IF NOT EXISTS subtree_allocation INTEGER,
  ADD COLUMN IF NOT EXISTS subtree_consumed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tree_budget_warning_delivered BOOLEAN NOT NULL DEFAULT false;

-- Index for descendant queries (budget propagation and tree_budget tool)
CREATE INDEX IF NOT EXISTS idx_conversations_parent_budget
  ON agents.conversations (parent_conversation_id)
  WHERE subtree_allocation IS NOT NULL;

-- Fix tasks.status CHECK constraint (tech debt)
-- Original constraint from 0005: CHECK (status IN ('created', 'active', 'paused', 'completed', 'cancelled'))
-- Phase 80 added 'counter_proposed' to Drizzle schema but never updated the SQL constraint
-- Phase 83 adds 'failed'
ALTER TABLE agents.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE agents.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('created', 'counter_proposed', 'active', 'paused', 'completed', 'failed', 'cancelled'));
