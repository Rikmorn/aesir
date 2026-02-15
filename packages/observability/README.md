# @aesir/observability

Execution tracking and observability services for Aesir agents. Provides structured storage of agent execution lifecycle events.

## What belongs here

- **ExecutionTracker** - Records agent execution start, completion, and failure
- **Database schema** - `observability.agent_executions` table
- **Custom errors** - Observability-specific error types

## What does NOT belong here

- Logging implementation (that's in `@aesir/platform`)
- Metrics/tracing exporters (future: OpenTelemetry integration)
- Business logic

## Usage

### Tracking Agent Executions

```typescript
import { createExecutionTracker } from "@aesir/observability";

const tracker = createExecutionTracker({ db, logger });

// Start tracking an execution
const result = await tracker.start({
  agentType: "dev-agent",
  issueId: "ABC-123",
  workspaceId: "ws_abc",
});
// result: ResultAsync<string, ExecutionTrackerError> — returns exec_xxx ID

// Mark as completed (calculates duration_ms automatically)
await tracker.complete(executionId);

// Or mark as failed with last known state for debugging
await tracker.fail(executionId, "JSON state captured at failure point");
```

All methods return `ResultAsync` (from `neverthrow`). `complete()` and `fail()` are defensive — they return ok even if the execution is not found (handles race conditions).

### Health Check

```typescript
const health = await tracker.health();
// { healthy: true, latencyMs: 2 }
```

## Database Schema

The package uses its own PostgreSQL schema namespace: `observability.*`

```sql
CREATE TABLE observability.agent_executions (
  id TEXT PRIMARY KEY,              -- exec_xxx format
  workspace_id TEXT NOT NULL,       -- multi-tenant filtering
  agent_type TEXT NOT NULL,         -- 'dev-agent' | 'product-agent'
  issue_id TEXT NOT NULL,           -- Linear issue ID
  status TEXT NOT NULL,             -- 'started' | 'completed' | 'failed'
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,            -- set on complete/fail
  duration_ms INTEGER,             -- calculated from started_at to ended_at
  last_known_state TEXT,           -- JSON state captured on failure
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Indexes: `(status, started_at)` for status queries, `(workspace_id)` for tenant filtering.

Run migrations:

```bash
pnpm --filter @aesir/observability db:migrate
```

## Error Codes

| Code | When |
|------|------|
| `OBS_TRACKER_START` | Failed to insert execution row |
| `OBS_TRACKER_COMPLETE` | Failed to mark execution completed |
| `OBS_TRACKER_FAIL` | Failed to record execution failure |
| `OBS_TRACKER_QUERY` | Failed to query executions |

## Architecture

```
@aesir/agents
    ↓ uses
@aesir/observability
    ↓ uses
@aesir/platform (db, logging)
```

The observability package sits between agents and platform, providing execution lifecycle tracking without coupling agents to database details.
