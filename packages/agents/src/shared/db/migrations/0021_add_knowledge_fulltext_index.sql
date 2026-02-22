-- Migration: Add GIN full-text search index on knowledge_entries
-- Phase 87: Knowledge Retrieval Enhancement
-- Purpose: Support keyword retrieval strategy using tsvector/tsquery
--
-- Expression index on (topic || ' ' || content) avoids adding a generated
-- tsvector column to the schema. PostgreSQL will use this index automatically
-- when queries match the indexed expression.

CREATE INDEX IF NOT EXISTS idx_knowledge_fulltext
  ON agents.knowledge_entries
  USING GIN (to_tsvector('english', topic || ' ' || content));
