-- Webhook delivery deduplication table
-- Used by the webhook filter (Layer 1) to reject duplicate webhook deliveries.
-- Each event_id is namespaced by source prefix (e.g., "linear:{deliveryId}").
-- The received_at index supports TTL cleanup of old entries.

CREATE TABLE agents.processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_dedup_received_at ON agents.processed_webhook_events (received_at);
