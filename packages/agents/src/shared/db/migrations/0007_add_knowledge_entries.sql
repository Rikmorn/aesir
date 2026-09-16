-- Phase 68: Shared Memory - Knowledge Entries
-- Creates pgvector extension and agents.knowledge_entries table for shared agent knowledge

-- 1. Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

--> statement-breakpoint

-- 2. Create knowledge_entries table
CREATE TABLE agents.knowledge_entries (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN ('discovery', 'constraint', 'architecture_decision', 'thought', 'preference', 'test_result')),
  topic               TEXT NOT NULL,
  content             TEXT NOT NULL,
  author              TEXT NOT NULL,
  scope               TEXT NOT NULL CHECK (scope IN ('shared', 'private')),
  tags                JSONB NOT NULL DEFAULT '[]',
  embedding           vector,
  superseded_by       TEXT REFERENCES agents.knowledge_entries(id),
  invalidated         BOOLEAN NOT NULL DEFAULT false,
  invalidation_reason TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

-- 3. Indexes

-- Dedup matching: find existing entries by type + normalized topic
CREATE INDEX idx_knowledge_type_topic ON agents.knowledge_entries(type, LOWER(TRIM(topic)));

--> statement-breakpoint

-- Visibility filtering: scope + author for query-time access control
CREATE INDEX idx_knowledge_scope_author ON agents.knowledge_entries(scope, author);

--> statement-breakpoint

-- Expiry filter. NOW() is STABLE, not IMMUTABLE, so PostgreSQL rejects it in a
-- partial index predicate and this statement could never run. The live schema
-- has the unfiltered index, so that is what this creates.
CREATE INDEX idx_knowledge_expires ON agents.knowledge_entries(expires_at);

--> statement-breakpoint

-- Active entries: only non-superseded, non-invalidated entries
CREATE INDEX idx_knowledge_not_superseded ON agents.knowledge_entries(id) WHERE superseded_by IS NULL AND invalidated = false;

--> statement-breakpoint

-- HNSW cosine similarity index for semantic search
-- An hnsw index needs a fixed dimension, and embedding is deliberately
-- dimensionless so different models can share the table, so pgvector rejects
-- this with "column does not have dimensions". The live schema has no such
-- index; cosine search falls back to a sequential scan.
-- CREATE INDEX idx_knowledge_embedding_cosine ON agents.knowledge_entries USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
