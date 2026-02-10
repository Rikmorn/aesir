-- Phase 69: Entity Directory - Schema foundation for agent discovery
-- Creates agents.entity_directory table with pgvector embedding column and HNSW index

-- 1. Create entity_directory table
CREATE TABLE agents.entity_directory (
  id                      TEXT PRIMARY KEY,
  type                    TEXT NOT NULL CHECK (type IN ('agent', 'human')),
  name                    TEXT NOT NULL,
  description             TEXT,
  capabilities            JSONB NOT NULL DEFAULT '[]',
  capabilities_embedding  vector,
  reach_via               JSONB,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  metadata                JSONB NOT NULL DEFAULT '{}',
  last_seeded_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

-- 2. Indexes

-- Type + status filtering for directory lookups
CREATE INDEX idx_directory_type_status ON agents.entity_directory(type, status);

--> statement-breakpoint

-- Name lookup for exact or prefix matching
CREATE INDEX idx_directory_name ON agents.entity_directory(name);

--> statement-breakpoint

-- HNSW cosine similarity index for semantic capability matching
CREATE INDEX idx_directory_embedding_cosine ON agents.entity_directory USING hnsw (capabilities_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
