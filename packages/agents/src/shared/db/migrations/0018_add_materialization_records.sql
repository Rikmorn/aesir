-- Phase 82: Transparent Materialization
-- Create materialization_records table for tracking tasks materialized as external artifacts.
-- Links agent tasks to their external representations (e.g., Linear issues) for bidirectional sync.

CREATE TABLE agents.materialization_records (
  task_id TEXT NOT NULL PRIMARY KEY,
  target TEXT NOT NULL,                -- "linear" (extensible for future targets)
  external_id TEXT NOT NULL,           -- Linear issue UUID
  external_url TEXT,                   -- Linear issue URL
  conversation_id TEXT NOT NULL,       -- Owning conversation
  agent_id TEXT NOT NULL,              -- Agent that requested materialization
  config JSONB NOT NULL DEFAULT '{}',  -- Full MaterializationConfig snapshot
  sync_status TEXT NOT NULL DEFAULT 'active', -- active, completed, failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_materialization_external ON agents.materialization_records (target, external_id);
CREATE INDEX idx_materialization_conversation ON agents.materialization_records (conversation_id);
