-- Add last_persisted_sequence to conversations for recovery context tracking.
-- Tracks the event log sequence number at the last message persistence point,
-- used by recovery context (Phase 76 Plan 03) to detect what was lost on crash.
-- No migration needed for event types -- agent_events.type is a TEXT column
-- with application-level enum validation only (not a Postgres ENUM type).

ALTER TABLE agents.conversations
  ADD COLUMN last_persisted_sequence INTEGER DEFAULT 0;
