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
const executionId = await tracker.start({
  agentType: "dev-agent",
  taskId: "TASK-123",
  sessionId: "session_abc",
});

// Mark as completed
await tracker.complete(executionId, {
  result: "success",
  metadata: { prNumber: 42 },
});

// Or mark as failed
await tracker.fail(executionId, {
  error: "Test failures exceeded max attempts",
  metadata: { attempts: 5 },
});
```

### Health Check

```typescript
const health = await tracker.health();
// { healthy: true, latencyMs: 2 }
```

## Database Schema

The package uses its own PostgreSQL schema namespace: `observability.*`

```sql
CREATE TABLE observability.agent_executions (
  id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL,
  task_id TEXT,
  session_id TEXT,
  status TEXT NOT NULL,  -- 'running' | 'completed' | 'failed'
  result JSONB,
  error TEXT,
  metadata JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Run migrations:

```bash
pnpm db:migrate:observability
```

## Architecture

```
@aesir/agents
    ↓ uses
@aesir/observability
    ↓ uses
@aesir/platform (db, logging)
```

The observability package sits between agents and platform, providing execution lifecycle tracking without coupling agents to database details.
