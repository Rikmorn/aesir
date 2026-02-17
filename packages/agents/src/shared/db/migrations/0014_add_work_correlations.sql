-- Phase 78: Work Correlation
-- Create the work_correlations table for mapping external entities to conversations.
-- Composite PK on (entity_type, entity_id, conversation_id).

CREATE TABLE agents.work_correlations (
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES agents.conversations(id),
  agent_id      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'waiting', 'completed', 'failed', 'superseded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, conversation_id)
);

CREATE INDEX idx_correlations_entity ON agents.work_correlations (entity_type, entity_id);
CREATE INDEX idx_correlations_conversation ON agents.work_correlations (conversation_id);
CREATE INDEX idx_correlations_status ON agents.work_correlations (entity_type, entity_id, status);
