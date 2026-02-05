-- Agent Event Content Table
--
-- Stores full LLM response content separately from the lean event log.
-- One-to-one relationship with agent_events via event_id FK.
-- Cascade delete ensures content is removed when events are purged.

CREATE TABLE IF NOT EXISTS agents.agent_event_content (
  event_id TEXT PRIMARY KEY REFERENCES agents.agent_events(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups (though PK already provides this for event_id)
-- No additional indexes needed since we only query by event_id (PK)
