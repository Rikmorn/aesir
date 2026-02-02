-- Executor Columns Migration
-- Adds retry tracking, signal deduplication, parent conversation, and LZ4 compression
-- to the agents.conversations table for Phase 40 (ConversationExecutor).
-- This migration is idempotent and can be run multiple times safely.

-- Retry tracking columns
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 2;
--> statement-breakpoint
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS error_message text;
--> statement-breakpoint

-- Signal deduplication: tracks which signal IDs have already been delivered
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS delivered_signal_ids jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint

-- Sub-agent tracking: links child conversations to their parent
ALTER TABLE agents.conversations ADD COLUMN IF NOT EXISTS parent_conversation_id text;
--> statement-breakpoint

-- Partial index for parent conversation lookups (only indexes non-null values)
CREATE INDEX IF NOT EXISTS idx_conversations_parent ON agents.conversations (parent_conversation_id) WHERE parent_conversation_id IS NOT NULL;
--> statement-breakpoint

-- Enable LZ4 compression on messages JSONB column (PostgreSQL 14+).
-- Only affects new writes; existing data keeps original compression.
-- Since the table is new (Phase 37), all data will use LZ4.
ALTER TABLE agents.conversations ALTER COLUMN messages SET COMPRESSION lz4;
