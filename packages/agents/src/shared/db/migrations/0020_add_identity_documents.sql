-- Phase 86: Identity documents for persistent agent identity
CREATE TABLE agents.identity_documents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  conversation_id TEXT REFERENCES agents.conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for getCurrentDocuments (latest version per document_type for an agent)
CREATE INDEX idx_identity_agent_type ON agents.identity_documents (agent_id, document_type);
CREATE INDEX idx_identity_agent_type_version ON agents.identity_documents (agent_id, document_type, version DESC);

-- Prevent duplicate versions for the same agent + document_type
ALTER TABLE agents.identity_documents
  ADD CONSTRAINT uq_identity_agent_type_version UNIQUE (agent_id, document_type, version);
