-- Phase 78: Work Correlation
-- Add metadata JSONB column to knowledge_entries for entity-scoped knowledge tagging.

ALTER TABLE agents.knowledge_entries
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX idx_knowledge_metadata ON agents.knowledge_entries USING GIN (metadata);
