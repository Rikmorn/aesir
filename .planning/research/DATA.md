# Data Layer Research: Agentic Development Platform

**Domain:** Data persistence for agentic development platform
**Researched:** 2026-01-19
**Confidence:** HIGH (based on official Temporal/LangGraph docs, current codebase analysis, industry patterns)

---

## 1. Executive Summary

PostgreSQL is the right foundation for Aesir v2.0. Temporal and LangGraph already handle the hard problems (durable execution state, agent checkpointing), leaving you with straightforward application data that fits naturally in a relational model.

**Key insight:** The complexity isn't in choosing databases — it's in understanding what each system already handles so you don't duplicate effort or fight the framework.

**Recommendation:** Start with PostgreSQL-only architecture with schema separation per layer. Add specialized stores (TimescaleDB extension, Redis) only when specific bottlenecks appear. The current file-based token storage is technical debt that should migrate to PostgreSQL.

---

## 2. Recommended Data Stores

| Technology | Purpose | Why | When to Add |
|------------|---------|-----|-------------|
| **PostgreSQL 15+** | Application data, credentials, configuration | Already running, well understood, JSONB for flexibility | Now (already in use) |
| **TimescaleDB extension** | Execution metrics, observability | 90% compression, 1000x faster time-range queries vs vanilla PG | When metrics retention > 30 days or query latency matters |
| **Redis** | Ephemeral caches, pub/sub | Session caches, webhook deduplication | When PG query latency becomes bottleneck |

### What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Separate vector DB** | Out of scope for v2.0 (codebase indexing deferred) | pgvector if/when needed |
| **Elasticsearch** | Overkill for observability at this scale | PostgreSQL full-text search or TimescaleDB |
| **InfluxDB/Prometheus backend** | Adds operational complexity | TimescaleDB extension (same Postgres stack) |
| **MongoDB/Document store** | PostgreSQL JSONB handles flexible schemas | JSONB columns where needed |

---

## 3. Core Entities

### Platform Layer

```typescript
// Credentials: OAuth tokens, API keys (encrypted at rest)
interface Credential {
  id: uuid;
  integration: 'linear' | 'github' | 'slack';
  scope: 'global' | 'user' | 'team';  // Who owns this credential
  scopeId?: string;                    // User ID, Team ID if scoped
  tokenData: encrypted_jsonb;          // { accessToken, refreshToken, expiresAt }
  createdAt: timestamp;
  updatedAt: timestamp;
}

// Agent definitions (code-defined, stored for runtime reference)
interface AgentDefinition {
  id: string;          // 'dev-agent', 'product-agent'
  version: string;     // Semantic version
  config: jsonb;       // Model, temperature, tools enabled
  status: 'active' | 'disabled';
  createdAt: timestamp;
}

// Webhook subscriptions (outbound from integrations)
interface WebhookSubscription {
  id: uuid;
  integration: string;
  externalId: string;        // Linear/GitHub webhook ID
  targetUrl: string;
  events: string[];          // ['issue.update', 'issue.create']
  status: 'active' | 'paused' | 'failed';
  lastDeliveryAt?: timestamp;
  createdAt: timestamp;
}
```

### Integrations Layer

```typescript
// Sync state for incremental fetching
interface SyncCursor {
  id: uuid;
  integration: string;
  resource: string;           // 'issues', 'pull_requests'
  cursor: string;             // Pagination cursor or timestamp
  lastSyncAt: timestamp;
  metadata: jsonb;            // Integration-specific sync state
}

// Webhook delivery tracking (idempotency)
interface WebhookDelivery {
  id: uuid;
  webhookId: string;          // External webhook ID (for deduplication)
  integration: string;
  payload: jsonb;
  status: 'received' | 'processing' | 'processed' | 'failed';
  processedAt?: timestamp;
  error?: text;
  receivedAt: timestamp;
}
```

### Agents Layer

**Note:** Most agent state is handled by LangGraph checkpointer. These entities are for correlation and observability only.

```typescript
// Agent execution records (for observability, not state)
interface AgentExecution {
  id: uuid;
  agentId: string;            // 'dev-agent'
  threadId: string;           // LangGraph thread ID (correlation)
  workflowId?: string;        // Temporal workflow ID (correlation)
  taskId: string;             // Linear task ID (business correlation)
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: timestamp;
  completedAt?: timestamp;
  metadata: jsonb;            // Input parameters, outcome summary
}
```

---

## 4. Data Ownership by Layer

### Platform Layer Owns

| Data | Rationale |
|------|-----------|
| **Credentials** | Cross-cutting concern; integrations request tokens from platform |
| **Agent definitions** | Configuration that agents read, platform manages |
| **System configuration** | Environment-specific settings |
| **User/team entities** | If multi-tenancy is added later |

### Integrations Layer Owns

| Data | Rationale |
|------|-----------|
| **Sync cursors** | Each integration tracks its own sync state |
| **Webhook subscriptions** | Managed per-integration |
| **Webhook delivery log** | Idempotency and debugging |
| **Integration-specific caches** | Linear issue snapshots, GitHub PR state |

### Agents Layer Owns (via LangGraph)

| Data | Rationale |
|------|-----------|
| **Conversation state** | LangGraph checkpointer handles this |
| **Agent memory** | Short-term (thread) and long-term (store) via LangGraph |
| **Execution traces** | Via LangGraph/LangSmith (external) |

### Temporal Owns

| Data | Rationale |
|------|-----------|
| **Workflow execution state** | Temporal's core value proposition |
| **Activity results** | Cached for replay |
| **Signal history** | Approval decisions, change requests |
| **Timer state** | Approval timeouts |

---

## 5. Data Sharing Patterns

### Recommended: Schema-per-Layer with Read APIs

```
┌─────────────────────────────────────────────────────────┐
│                    PostgreSQL                           │
├─────────────────────────────────────────────────────────┤
│  platform schema    │  integrations schema  │  agents   │
│  ─────────────────  │  ────────────────────  │  schema  │
│  credentials        │  sync_cursors         │  (empty)  │
│  agent_definitions  │  webhook_deliveries   │           │
│  webhook_subs       │  integration_caches   │           │
└─────────────────────────────────────────────────────────┘
         ↓                      ↓
    Platform API          Integration APIs
         ↓                      ↓
┌─────────────────────────────────────────────────────────┐
│                   Service Layer                         │
│  Platform Service ←→ Integration Services ←→ Agents    │
└─────────────────────────────────────────────────────────┘
```

**Pattern:** Services expose typed APIs; no direct cross-schema queries.

```typescript
// Platform exposes credential retrieval
interface CredentialService {
  getCredential(integration: string, scope: CredentialScope): Promise<Credential>;
  refreshIfNeeded(credential: Credential): Promise<Credential>;
}

// Integrations call platform for credentials
const linearClient = await credentialService.getCredential('linear', { type: 'global' });
```

### Anti-Pattern: Shared Database Tables

**Do not** let integrations write directly to platform tables or vice versa. This creates hidden coupling and makes it impossible to evolve schemas independently.

### Event-Driven Sharing (Future)

For v2.0, direct API calls are sufficient. If load increases or you need async decoupling:

```typescript
// Future: Platform emits credential refresh events
// Integrations subscribe if they cache credentials
await eventBus.publish('credential.refreshed', {
  integration: 'linear',
  scope: { type: 'global' },
});
```

---

## 6. What's Already Handled

### Temporal Handles

| Capability | What Temporal Stores | You Don't Need To |
|------------|---------------------|-------------------|
| **Workflow state** | Mutable state per workflow in `executions` table | Store workflow progress |
| **Event history** | Complete replay log in `history` table | Log workflow events |
| **Activity results** | Cached in execution state | Cache activity outputs |
| **Signals received** | Part of event history | Store approval decisions |
| **Timers** | Managed by Temporal server | Implement timeout logic |
| **Visibility** | Workflow search in `executions_visibility` | Build workflow listing |

**Source:** [Temporal Persistence Documentation](https://docs.temporal.io/temporal-service/persistence)

### LangGraph Handles

| Capability | What LangGraph Stores | You Don't Need To |
|------------|----------------------|-------------------|
| **Conversation history** | Messages array in checkpoint | Store chat messages |
| **Agent state** | Full state snapshot per superstep | Track agent progress |
| **Thread continuity** | Checkpoint per thread ID | Resume conversations |
| **Interrupt/resume** | Pending writes in checkpoint | Implement pause/resume |
| **Time-travel debugging** | Historical checkpoints | Build state history |

**LangGraph PostgresSaver creates 4 tables:**
1. `checkpoints` - State snapshots at each superstep
2. `checkpoint_blobs` - Large serialized state data
3. `checkpoint_writes` - Pending writes (fault tolerance)
4. `migrations` - Schema version tracking

**Important:** Every graph invocation creates ~100 rows. Plan for cleanup:

```sql
-- Periodic cleanup of old checkpoints (keep last 7 days)
DELETE FROM checkpoints
WHERE thread_ts < NOW() - INTERVAL '7 days'
  AND thread_id NOT IN (SELECT DISTINCT thread_id FROM active_executions);
```

**Sources:**
- [LangGraph Persistence Documentation](https://docs.langchain.com/oss/python/langgraph/persistence)
- [PostgresSaver Best Practices](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025)

---

## 7. What We Need to Add

### High Priority (v2.0)

| Need | Current State | Recommendation |
|------|---------------|----------------|
| **Credential storage** | File-based (`.tokens/linear.json`) | Migrate to `platform.credentials` table with encryption |
| **Webhook idempotency** | None | Add `integrations.webhook_deliveries` table |
| **Agent execution records** | In-memory `TraceStore` | Add `agents.executions` table for persistence |
| **Sync cursors** | Implicit in code | Add `integrations.sync_cursors` table |

### Medium Priority (Post v2.0)

| Need | Why Wait |
|------|----------|
| **TimescaleDB for metrics** | Current scale doesn't require it |
| **Long-term agent memory** | LangGraph Store API handles this; evaluate usage first |
| **Audit log** | Nice to have for compliance; not blocking |

### Low Priority (Feature Milestones)

| Need | When |
|------|------|
| **Vector storage (pgvector)** | Codebase indexing milestone |
| **Full-text search** | When agents need to search historical data |
| **Multi-tenant isolation** | If/when platform supports multiple teams |

---

## 8. PostgreSQL-First Strategy

### Schema Design for Extension

```sql
-- Use schemas for logical separation
CREATE SCHEMA platform;
CREATE SCHEMA integrations;
CREATE SCHEMA observability;

-- Platform layer
CREATE TABLE platform.credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration VARCHAR(50) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'global',
  scope_id VARCHAR(255),
  -- Encrypted with pgcrypto or application-level encryption
  token_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration, scope, scope_id)
);

CREATE TABLE platform.agent_definitions (
  id VARCHAR(100) PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integrations layer
CREATE TABLE integrations.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id VARCHAR(255) NOT NULL,
  integration VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  -- Prevent duplicate processing
  UNIQUE(integration, webhook_id)
);

CREATE TABLE integrations.sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration VARCHAR(50) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  cursor_value TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(integration, resource)
);

-- Observability (can migrate to TimescaleDB later)
CREATE TABLE observability.agent_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(100) NOT NULL,
  thread_id VARCHAR(255) NOT NULL,
  workflow_id VARCHAR(255),
  task_id VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

-- Index for common queries
CREATE INDEX idx_executions_task ON observability.agent_executions(task_id);
CREATE INDEX idx_executions_status ON observability.agent_executions(status, started_at DESC);
CREATE INDEX idx_webhook_status ON integrations.webhook_deliveries(status, received_at DESC);
```

### Extension Path to TimescaleDB

If metrics become a bottleneck:

```sql
-- 1. Install extension (same PostgreSQL instance)
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 2. Convert to hypertable
SELECT create_hypertable('observability.agent_executions', 'started_at');

-- 3. Add compression policy
ALTER TABLE observability.agent_executions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'agent_id'
);

SELECT add_compression_policy('observability.agent_executions', INTERVAL '7 days');
```

**No application code changes required** - TimescaleDB is a PostgreSQL extension, not a separate database.

### Credential Encryption

```typescript
// Application-level encryption (recommended for portability)
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY; // 32-byte key
const ALGORITHM = 'aes-256-gcm';

function encryptTokenData(data: LinearConfig): Buffer {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptTokenData(encrypted: Buffer): LinearConfig {
  const iv = encrypted.subarray(0, 16);
  const authTag = encrypted.subarray(16, 32);
  const data = encrypted.subarray(32);
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);
  return JSON.parse(decipher.update(data) + decipher.final('utf8'));
}
```

---

## 9. Anti-Patterns to Avoid

### 1. Duplicating Temporal/LangGraph State

**Bad:**
```typescript
// DON'T store workflow state in your own table
await db.updateWorkflowState(workflowId, { status: 'awaiting_approval' });
```

**Good:**
```typescript
// Query Temporal for workflow state
const handle = temporalClient.workflow.getHandle(workflowId);
const status = await handle.query(approvalStatusQuery);
```

### 2. Storing Conversation History Separately

**Bad:**
```typescript
// DON'T duplicate LangGraph's message history
await db.insertMessage(threadId, { role: 'user', content: '...' });
```

**Good:**
```typescript
// LangGraph checkpointer handles this
const result = await graph.invoke(
  { messages: [new HumanMessage(userInput)] },
  { configurable: { thread_id: threadId } }
);
```

### 3. File-Based Secrets

**Bad (current state):**
```typescript
// .tokens/linear.json - not encrypted, not scalable, hard to rotate
const tokens = await readFile('.tokens/linear.json', 'utf-8');
```

**Good:**
```typescript
// Encrypted in database, supports rotation
const credential = await credentialService.get('linear', { type: 'global' });
```

### 4. Shared Tables Across Layers

**Bad:**
```sql
-- Single table for all data types
CREATE TABLE entities (
  type VARCHAR(50),
  data JSONB
);
```

**Good:**
```sql
-- Separate schemas with typed tables
CREATE TABLE platform.credentials (...);
CREATE TABLE integrations.sync_cursors (...);
```

### 5. Ignoring Checkpoint Cleanup

**Bad:**
```typescript
// Let checkpoints accumulate forever
const checkpointer = PostgresSaver.fromConnString(dbUrl);
```

**Good:**
```typescript
// Schedule periodic cleanup
// In a cron job or Temporal scheduled workflow
await db.query(`
  DELETE FROM checkpoints
  WHERE thread_ts < NOW() - INTERVAL '7 days'
`);
```

### 6. Over-Engineering with Multiple Databases

**Bad:**
```yaml
# Separate databases for everything
services:
  postgres: ...      # Application data
  timescale: ...     # Metrics (separate instance)
  redis: ...         # Caching
  elasticsearch: ... # Search
```

**Good:**
```yaml
# Single PostgreSQL with extensions
services:
  postgres:
    image: timescale/timescaledb:latest-pg15
    # TimescaleDB is a PostgreSQL extension, not a separate DB
```

---

## 10. Sources

### Official Documentation

- [Temporal Persistence](https://docs.temporal.io/temporal-service/persistence) - What Temporal stores and why (HIGH confidence)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) - Checkpointer architecture (HIGH confidence)
- [LangGraph Memory](https://docs.langchain.com/oss/python/langgraph/add-memory) - Short-term vs long-term memory (HIGH confidence)
- [PostgreSQL Encryption Options](https://www.postgresql.org/docs/current/encryption-options.html) - Data protection strategies (HIGH confidence)

### Database Comparison

- [TimescaleDB vs PostgreSQL](https://www.tigerdata.com/blog/postgresql-timescaledb-1000x-faster-queries-90-data-compression-and-much-more) - Performance benchmarks (HIGH confidence)
- [Microservices Data Patterns](https://microservices.io/patterns/data/database-per-service.html) - Database-per-service rationale (HIGH confidence)
- [Agentic Postgres](https://www.tigerdata.com/agentic-postgres) - Modern patterns for agent workloads (MEDIUM confidence)

### Industry Patterns

- [AI Agent Observability](https://opentelemetry.io/blog/2025/ai-agent-observability/) - OpenTelemetry semantic conventions (HIGH confidence)
- [4 Data Architecture Decisions for Agentic Systems](https://thenewstack.io/4-data-architecture-decisions-that-make-or-break-agentic-systems/) - Isolation patterns (MEDIUM confidence)
- [LangGraph PostgresSaver Best Practices](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025) - Checkpoint management (MEDIUM confidence)

### Current Codebase Analysis

- `/Users/roberto.sousa/Documents/Projects/aesir/src/agents/dev-agent.ts` - Current PostgresSaver usage
- `/Users/roberto.sousa/Documents/Projects/aesir/src/integrations/linear/token-store.ts` - Current file-based token storage
- `/Users/roberto.sousa/Documents/Projects/aesir/src/temporal/workflows/approval-workflow.ts` - Temporal state patterns
- `/Users/roberto.sousa/Documents/Projects/aesir/docker-compose.yml` - Current PostgreSQL configuration

---

## Summary: Migration Path

### Phase 1: Foundation (v2.0)

1. **Create schema structure** - `platform`, `integrations`, `observability` schemas
2. **Migrate credentials** - Move from `.tokens/` files to encrypted database storage
3. **Add webhook idempotency** - `integrations.webhook_deliveries` table
4. **Add execution tracking** - `observability.agent_executions` table

### Phase 2: Optimization (Post v2.0, if needed)

1. **Install TimescaleDB** - Extension on existing PostgreSQL
2. **Convert metrics tables** - To hypertables with compression
3. **Add Redis** - For caching if query latency becomes an issue

### Phase 3: Scale (Future milestones)

1. **Add pgvector** - When codebase indexing milestone begins
2. **Consider multi-tenancy** - If platform supports multiple teams
3. **Evaluate long-term memory** - LangGraph Store vs custom solution

---

*Data layer research for: Aesir v2.0 Foundation*
*Researched: 2026-01-19*
