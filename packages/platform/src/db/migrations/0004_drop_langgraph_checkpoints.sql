-- Drop LangGraph checkpoint tables
-- These tables were used by @langchain/langgraph-checkpoint-postgres for
-- persisting LangGraph state machine checkpoints. Replaced by
-- agents.context_snapshots (Phase 29) for the v2.2 agentic architecture.

DROP TABLE IF EXISTS checkpoint_writes;
DROP TABLE IF EXISTS checkpoint_blobs;
DROP TABLE IF EXISTS checkpoints;
