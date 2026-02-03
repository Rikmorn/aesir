# Phase 45: Integration Testing + Validation - Research

**Researched:** 2026-02-03
**Domain:** Integration testing for v2.3 unified agent framework (testcontainers, Vitest, Express HTTP, pg-boss)
**Confidence:** HIGH

## Summary

Phase 45 validates the complete v2.3 framework built across Phases 37-44. The testing target is well-defined: 8 lifecycle flows at two layers (framework and HTTP), plus a manual E2E checklist. The codebase already has a comprehensive testcontainers + Vitest infrastructure in `@aesir/test-utils`, making the technical foundation solid.

The primary challenge is **test isolation when using real PostgreSQL**. The existing `setupPostgresContainer()` and `startTestTransaction()` utilities handle container lifecycle and per-test rollback. However, integration tests that involve the worker loop (poll + claim + execute) span multiple transactions and cannot use rollback isolation -- they need per-test database cleanup or per-test database templates. Additionally, pg-boss creates its own `pgboss` schema with auto-migration, which needs to happen once per container, not per test.

The key architectural insight is that integration tests must **mock only the LLM boundary** (Anthropic SDK) while using real implementations of everything else: real PostgreSQL, real Drizzle ORM, real pg-boss, real EventLog, real SessionProjection, real ConversationExecutor. This is the definition of integration testing for this codebase -- proving the wiring works end-to-end with only the external AI service faked.

**Primary recommendation:** Use a single testcontainer per test file with `TRUNCATE` cleanup between tests. Mock `runAgentLoop` at module level to control conversation outcomes. Test both framework layer (direct executor calls) and HTTP layer (supertest against Express app) for each of the 8 lifecycle flows.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vitest` | 4.0.18 | Test runner | Already in use across monorepo, fast ESM support |
| `@testcontainers/postgresql` | ^11.11.0 | Real PostgreSQL containers | Already in `@aesir/test-utils`, proven pattern |
| `supertest` | ^7.0.0 | HTTP assertion library | Standard for Express integration tests, no server startup needed |
| `drizzle-orm` | ^0.45.1 | ORM for database assertions | Same ORM as production code, direct schema queries |
| `pg` (Pool/Client) | ^8.17.2 | PostgreSQL driver | Same driver as production, needed for pg-boss adapter |
| `pg-boss` | ^12.8.0 | Timeout scheduling | Used in production, must be tested with real Postgres |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aesir/test-utils` | workspace | Container setup, migrations, mocks | Every integration test |
| `postgres` (postgres.js) | ^3.4.7 | Raw SQL for test setup/teardown | Running migration SQL, cleanup |
| `msw` | ^2.12.7 | Mock Service Worker | If testing MCP HTTP calls in HTTP layer tests |

### New Dependency Required
| Library | Version | Purpose | Why Needed |
|---------|---------|---------|------------|
| `supertest` | ^7.0.0 | Express HTTP testing | Not currently in any package.json; needed for HTTP layer tests |
| `@types/supertest` | ^6.0.0 | TypeScript types | Type definitions for supertest |

**Installation:**
```bash
pnpm --filter @aesir/agents add -D supertest @types/supertest
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| supertest | Native `fetch` against running server | Supertest avoids ephemeral port management, handles server lifecycle automatically |
| @testcontainers/postgresql | PGlite (WASM Postgres) | PGlite is faster (~0 startup) but does NOT support pg-boss (requires LISTEN/NOTIFY, advisory locks). Real Postgres required. |
| Per-test rollback | TRUNCATE between tests | Worker loop spans multiple transactions, making rollback isolation impossible. TRUNCATE is ~5ms per table. |

## Architecture Patterns

### Recommended Test File Organization
```
packages/agents/src/
├── framework/
│   ├── __integration__/             # NEW: Integration test directory
│   │   ├── setup.ts                 # Shared container + DB setup
│   │   ├── helpers.ts               # Test factories, mock agent loop, assertions
│   │   ├── lifecycle-flows.integration.test.ts   # 8 lifecycle flows (framework layer)
│   │   └── http-layer.integration.test.ts        # HTTP layer tests via supertest
│   ├── conversation-executor.test.ts  # Existing unit tests (unchanged)
│   ├── worker-loop.test.ts            # Existing unit tests (unchanged)
│   └── ...
├── shared/temporal/
│   ├── activities/
│   │   ├── orchestrator-activities.test.ts  # Mark as legacy + skip
│   │   ├── linear-activities.test.ts        # Mark as legacy + skip
│   │   ├── slack-activities.test.ts         # Mark as legacy + skip
│   │   └── product-agent-activity.test.ts   # Mark as legacy + skip
│   └── workflows/
│       ├── orchestrator-workflow.test.ts     # Mark as legacy + skip
│       └── product-agent-workflow.test.ts    # Mark as legacy + skip
└── dev-agent/
    ├── integration.test.ts            # Existing placeholder -- repurpose or delete
    └── orchestrator/
        └── e2e-validation.test.ts     # Evaluate: keep if testing live code, skip if Temporal-only
```

### Pattern 1: Shared Container Setup (setup.ts)

**What:** Single PostgreSQL testcontainer per test file, shared across all tests in that file. Migrations run once. Tables truncated between tests.

**When to use:** Every integration test file.

**Example:**
```typescript
// framework/__integration__/setup.ts
import {
  setupPostgresContainer,
  cleanupPostgresContainer,
  type PostgresContainerContext,
} from "@aesir/test-utils";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../shared/db/schema.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface IntegrationTestContext {
  container: PostgresContainerContext;
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
  connectionUri: string;
}

/**
 * All 3 migration files concatenated (without statement-breakpoint markers).
 * These must be applied to the test container to create the agents schema.
 */
const AGENTS_MIGRATION_SQL = `
  -- 0000_create_agents_schema.sql content
  -- 0001_add_v23_tables.sql content
  -- 0002_add_executor_columns.sql content
`;

export async function setupTestContext(): Promise<IntegrationTestContext> {
  const container = await setupPostgresContainer({ image: "postgres:16-alpine" });

  // Run migrations via postgres.js (raw SQL)
  await container.sql.unsafe(AGENTS_MIGRATION_SQL);

  // Create pg Pool for drizzle-orm/node-postgres (production driver)
  const pool = new Pool({
    connectionString: container.connectionUri,
    max: 10,
  });

  const db = drizzle(pool, { schema });

  return { container, pool, db, connectionUri: container.connectionUri };
}

export async function teardownTestContext(ctx: IntegrationTestContext): Promise<void> {
  await ctx.pool.end();
  await cleanupPostgresContainer(ctx.container);
}

/**
 * Truncate all agents.* tables between tests.
 * Order matters for foreign key constraints (truncate children first).
 * CASCADE handles it but explicit ordering is clearer.
 */
export async function cleanupTables(ctx: IntegrationTestContext): Promise<void> {
  await ctx.container.sql`
    TRUNCATE agents.agent_events, agents.agent_sessions,
             agents.conversations, agents.execution_traces,
             agents.context_snapshots, agents.tasks CASCADE
  `;
}
```

### Pattern 2: Mocking the Agent Loop

**What:** Mock `runAgentLoop` at module level to control conversation outcomes without calling the Anthropic API. The mock returns controlled `AgentLoopResult` objects.

**When to use:** Every integration test that exercises the worker loop.

**Why:** The agent loop is the boundary between the framework (what we test) and the LLM (external service). Mocking it lets us test all framework wiring -- claiming, executing, transitioning, event recording -- without API calls.

**Example:**
```typescript
// framework/__integration__/helpers.ts
import { vi } from "vitest";
import type { AgentLoopResult } from "../../shared/agent-loop/types.js";

// Mock runAgentLoop before importing modules that use it
vi.mock("../../shared/agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

import { runAgentLoop } from "../../shared/agent-loop/run-agent-loop.js";

const mockRunAgentLoop = runAgentLoop as ReturnType<typeof vi.fn>;

/** Configure agent loop to return "completed" immediately */
export function mockAgentLoopCompletes(output = "Task completed successfully"): void {
  mockRunAgentLoop.mockResolvedValue({
    status: "completed",
    output,
    toolCallCount: 3,
    tokenCount: { input: 1000, output: 500 },
    trace: [],
  } satisfies AgentLoopResult);
}

/** Configure agent loop to trigger wait_for by mutating the WaitForState */
export function mockAgentLoopPauses(
  waitType = "approval",
  reason = "Awaiting approval",
  timeout: string | null = "72h",
): void {
  mockRunAgentLoop.mockImplementation(async (options: unknown) => {
    // The wait_for tool is wired by the worker loop; we need to
    // find it in the tools array and call it to trigger the state mutation.
    const opts = options as { tools: Array<{ name: string; execute: (input: unknown) => Promise<unknown> }> };
    const waitForTool = opts.tools.find(t => t.name === "wait_for");
    if (waitForTool) {
      await waitForTool.execute({ type: waitType, reason, timeout });
    }
    return {
      status: "completed",
      output: `Waiting for ${waitType}`,
      toolCallCount: 1,
      tokenCount: { input: 500, output: 200 },
      trace: [],
    } satisfies AgentLoopResult;
  });
}

/** Configure agent loop to return an error */
export function mockAgentLoopErrors(errorMessage = "Something went wrong"): void {
  mockRunAgentLoop.mockResolvedValue({
    status: "error",
    output: errorMessage,
    toolCallCount: 0,
    tokenCount: { input: 100, output: 50 },
    trace: [],
  } satisfies AgentLoopResult);
}
```

### Pattern 3: HTTP Layer Testing with Supertest

**What:** Use supertest to test Express routes without starting a real HTTP server. Supertest binds to an ephemeral port internally.

**When to use:** HTTP layer integration tests.

**Example:**
```typescript
import request from "supertest";
import express from "express";
import { NormalizedEventSchema } from "@aesir/types";

// Build the Express app the same way as service/main.ts but with test dependencies
function createTestApp(executor, eventRouter, logger) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/events", async (req, res) => {
    const parsed = NormalizedEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed" });
      return;
    }
    const result = await routeEvent(parsed.data, { executor, eventRouter, logger });
    res.json(result);
  });

  app.get("/conversations/:id", async (req, res) => {
    const info = await executor.get(req.params.id);
    if (!info) { res.status(404).json({ error: "Not found" }); return; }
    res.json(info);
  });

  return app;
}

// Test
it("POST /events with valid start event creates conversation", async () => {
  const app = createTestApp(executor, eventRouter, logger);

  const res = await request(app)
    .post("/events")
    .send({
      id: "evt_test123",
      type: "linear.agent_session.created",
      source: "linear",
      timestamp: new Date().toISOString(),
      correlationId: "corr_123",
      payload: { issueId: "AES-42", issueIdentifier: "AES-42" },
    })
    .expect(200);

  expect(res.body.action).toBe("started");
  expect(res.body.conversationId).toBe("dev-agent-AES-42");
});
```

### Pattern 4: Agent Definition Fixtures

**What:** Instead of loading YAML from disk (which requires correct relative paths), create in-memory agent definitions for tests.

**When to use:** All integration tests that need an AgentRegistry.

**Example:**
```typescript
function createTestAgentRegistry(): AgentRegistry {
  const definitions: Map<string, AgentDefinition> = new Map([
    ["dev-agent", {
      id: "dev-agent",
      name: "Test Dev Agent",
      description: "Test agent for integration tests",
      version: "1",
      model: "claude-sonnet-4-20250514",
      tools: ["coordination:wait_for"],  // Minimal tools for testing
      maxIterations: 10,
      tokenBudget: 50000,
      history: {
        pruneThreshold: 80000,
        protectedMessages: 20,
        summaryThreshold: 120000,
        summaryModel: "claude-haiku-4-5-20251001",
      },
      triggers: [{ event: "linear.agent_session.created" }],
      systemPrompt: "You are a test agent.",
    }],
    ["product-agent", {
      id: "product-agent",
      name: "Test Product Agent",
      description: "Test product agent for integration tests",
      version: "1",
      model: "claude-sonnet-4-20250514",
      tools: ["coordination:wait_for"],
      maxIterations: 5,
      tokenBudget: 10000,
      history: {
        pruneThreshold: 30000,
        protectedMessages: 10,
        summaryThreshold: 50000,
        summaryModel: "claude-haiku-4-5-20251001",
      },
      triggers: [{ event: "slack.app_mention.created" }],
      systemPrompt: "You are a test product agent.",
    }],
  ]);

  return {
    async get(id: string): Promise<AgentDefinition | null> {
      return definitions.get(id) ?? null;
    },
    async list(): Promise<AgentDefinition[]> {
      return Array.from(definitions.values());
    },
  };
}
```

### Anti-Patterns to Avoid
- **Mocking the database in integration tests:** The entire point is testing real DB interactions. Never mock Drizzle/pg in integration tests.
- **Transaction rollback isolation for worker loop tests:** The worker loop uses its own transactions (SKIP LOCKED CTE). Wrapping in a test transaction would deadlock or prevent claiming.
- **Starting the actual HTTP server in tests:** Use supertest's app binding instead. Avoids port conflicts and cleanup issues.
- **Testing with real Anthropic API calls:** Extremely slow, expensive, and non-deterministic. Mock `runAgentLoop` at module level.
- **Running all 8 lifecycle tests in a single `describe` block sequentially relying on shared state:** Each test must be independent. Use `cleanupTables()` in `beforeEach` or `afterEach`.
- **Loading agent definitions from disk in tests:** Fragile path resolution depending on whether running from source or compiled. Use in-memory test fixtures.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PostgreSQL test container | Manual Docker commands | `@testcontainers/postgresql` (already in test-utils) | Dynamic ports, cleanup, wait strategies handled |
| HTTP request testing | `fetch` + manual port management | `supertest` | Ephemeral port binding, chainable assertions, no server.listen() |
| Test database cleanup | Custom DROP/CREATE scripts | `TRUNCATE ... CASCADE` on known tables | Fast (~5ms), handles FK constraints, reuses schema |
| Agent definition fixtures | Loading YAML from disk in tests | In-memory test AgentRegistry | No path resolution issues, fully controlled |
| Mock logger | Custom mock object | `@aesir/test-utils` `createMockLogger()` | Already exists, matches PinoLogger interface |
| Migration SQL for tests | Running drizzle-kit migrate | Inline SQL from migration files | Test-utils pattern already established; avoids drizzle-kit binary dependency |
| Worker loop polling control | setTimeout/setInterval manipulation | Short pollIntervalMs (10-50ms) + `close()` for drain | Existing pattern from worker-loop.test.ts |

**Key insight:** The existing `@aesir/test-utils` package provides 80% of the infrastructure. The gap is: (1) agents schema migration SQL (only linear/github/slack are in test-utils currently), (2) supertest for HTTP testing, and (3) test helpers specific to the v2.3 framework.

## Common Pitfalls

### Pitfall 1: Environment Validation Blocks Test Startup
**What goes wrong:** Importing any module that transitively imports `shared/env/config.ts` triggers Zod environment validation, which calls `process.exit(1)` on missing env vars.
**Why it happens:** `config.ts` validates at import time with `dotenv-flow.config()`. Integration tests do not have `.env` files with `ANTHROPIC_API_KEY`, `LINEAR_TEAM_ID`, etc.
**How to avoid:** Either (a) set required env vars in the test setup before importing, (b) mock the config module via `vi.mock()`, or (c) structure imports so the config module is not loaded (preferred: pass config values directly to factories).
**Warning signs:** `process.exit` during test startup with "environment validation failed" messages.

### Pitfall 2: pg-boss Auto-Migration Timing
**What goes wrong:** pg-boss creates its `pgboss` schema on `start()`. If `TRUNCATE` cleanup includes pgboss tables, the next test's pg-boss instance may fail.
**Why it happens:** pg-boss does internal schema management separate from the application schema.
**How to avoid:** Do NOT truncate pgboss.* tables between tests. Only truncate agents.* tables. Let pg-boss manage its own lifecycle. For timeout tests, use `schedule()` + `cancel()` and verify via the executor, not by inspecting pgboss internals.
**Warning signs:** "relation pgboss.job does not exist" errors after the first test.

### Pitfall 3: Worker Loop Async Fire-and-Forget
**What goes wrong:** Tests assert before the worker loop has finished processing. The worker loop claims and executes conversations asynchronously -- `start()` returns immediately but execution happens on the next poll cycle.
**Why it happens:** The poll-claim-execute cycle is async with configurable interval.
**How to avoid:** Use short `pollIntervalMs` (10-50ms) and poll for the expected state with a retry loop (e.g., poll `executor.get()` until status matches expected). The existing worker-loop unit tests use `tick(50)` helper -- integration tests need similar wait-for-state patterns.
**Warning signs:** Flaky tests that pass sometimes (when the event loop aligns) and fail other times.

### Pitfall 4: SKIP LOCKED Requires Committed Rows
**What goes wrong:** If conversation rows are inserted within a test transaction that hasn't committed, the worker loop's SKIP LOCKED query (running in a separate connection) cannot see them.
**Why it happens:** SKIP LOCKED operates on committed, unlocked rows. Uncommitted inserts from another connection are invisible.
**How to avoid:** Do NOT wrap the entire test in a transaction. Use `executor.start()` which commits within its own transaction, then let the worker loop pick it up naturally. Clean up with TRUNCATE after.
**Warning signs:** Worker loop polls indefinitely, never claims the conversation.

### Pitfall 5: History Compaction Requires Anthropic Client
**What goes wrong:** History compaction's structured summary phase calls the Anthropic API to generate summaries. If the test conversation has enough messages to trigger summarization, it will fail without API access.
**Why it happens:** The `HistoryManager.compact()` method calls `Anthropic.messages.create()` when token count exceeds summaryThreshold.
**How to avoid:** Keep test messages well below `pruneThreshold` (which is 80,000 tokens for dev-agent). For the "History Compaction" test flow specifically, either (a) set a very low pruneThreshold in the test agent definition, or (b) mock the Anthropic SDK at the module level for that specific test. Phase 1 pruning (tool output trimming) does NOT require LLM calls and is the most important compaction path to test.
**Warning signs:** "ANTHROPIC_API_KEY is required" errors or 401 responses during history compaction tests.

### Pitfall 6: Duplicate EventLog Sequence on Fast Re-runs
**What goes wrong:** EventLog's `initSequence()` loads `MAX(sequence)` from the database. If a prior test's events are not flushed or truncated, the sequence counter may be stale.
**Why it happens:** EventLog buffers events in memory and flushes periodically. If a test ends before flush, events are lost but the DB sequence counter was never updated.
**How to avoid:** Always call `eventLog.flush()` in `afterEach`. Always TRUNCATE `agent_events` between tests. The `initSequence()` call in the worker loop handles fresh conversations correctly.
**Warning signs:** "unique constraint uq_agent_events_conv_seq violated" errors.

## Code Examples

### Complete Framework Layer Test: Start -> Run -> Complete

```typescript
// Source: Derived from codebase analysis of conversation-executor.ts, worker-loop.ts, event-log.ts
describe("Flow 1: Start -> Run -> Complete", () => {
  it("should create conversation, execute agent loop, transition to completed, record events", async () => {
    // Arrange: mock agent loop to complete immediately
    mockAgentLoopCompletes("Done!");

    // Act: start conversation via executor
    const convId = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth module",
    });

    // Assert: conversation created as queued
    expect(convId).toBe("dev-agent-AES-42");
    const info = await executor.get(convId);
    expect(info?.status).toBe("queued");

    // Act: start worker loop, wait for execution
    executor.startWorker();
    await waitForStatus(executor, convId, "completed", 5000);

    // Assert: final state
    const completed = await executor.get(convId);
    expect(completed?.status).toBe("completed");

    // Assert: events recorded
    const events = await eventLog.query(convId);
    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain("agent.started");
    expect(eventTypes).toContain("agent.completed");

    // Assert: session projection updated
    const session = await sessionProjection.getSession(convId);
    expect(session?.status).toBe("completed");
  });
});
```

### Wait-for-State Helper

```typescript
/**
 * Poll executor.get() until conversation reaches expected status or timeout.
 * Essential for integration tests where the worker loop runs asynchronously.
 */
async function waitForStatus(
  executor: ConversationExecutor,
  conversationId: string,
  expectedStatus: ConversationStatus,
  timeoutMs = 5000,
  pollMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await executor.get(conversationId);
    if (info?.status === expectedStatus) return;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `Timed out waiting for conversation ${conversationId} to reach status "${expectedStatus}" after ${timeoutMs}ms`
  );
}
```

### Agents Schema Migration SQL for Test-Utils

```typescript
/**
 * Combined migration SQL for agents schema (test-utils compatible).
 * Concatenates all 3 migration files with statement-breakpoints removed.
 */
export const agentsMigrationSql = `
  CREATE SCHEMA IF NOT EXISTS "agents";
  -- [full content of 0000 + 0001 + 0002 migrations, without --> statement-breakpoint lines]
`;
```

### HTTP Layer Test: POST /events -> Conversation Created

```typescript
describe("HTTP Layer: POST /events", () => {
  it("should create conversation from valid start event", async () => {
    mockAgentLoopCompletes();

    const res = await request(testApp)
      .post("/events")
      .send({
        id: "evt_test001",
        type: "linear.agent_session.created",
        source: "linear",
        timestamp: new Date().toISOString(),
        correlationId: "corr_001",
        payload: {
          issueId: "AES-42",
          issueIdentifier: "AES-42",
        },
      })
      .expect(200);

    expect(res.body).toMatchObject({
      received: true,
      action: "started",
      conversationId: "dev-agent-AES-42",
    });

    // Verify conversation exists in DB
    const info = await executor.get("dev-agent-AES-42");
    expect(info).not.toBeNull();
    expect(info?.status).toBe("queued");
  });

  it("should reject invalid event payload with 400", async () => {
    const res = await request(testApp)
      .post("/events")
      .send({ invalid: true })
      .expect(400);

    expect(res.body.error).toBe("Validation failed");
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Temporal workflow tests with mocked `@temporalio/workflow` | Framework integration tests with real Postgres | v2.3 (Phases 37-44) | Tests validate actual DB operations, not mock chains |
| `integration.test.ts` placeholder (skipped in CI) | Real testcontainer-backed lifecycle tests | Phase 45 | Automated coverage of all 8 lifecycle flows |
| Per-agent service testing (dev-agent, product-agent separately) | Single service testing via unified `/events` endpoint | Phase 44 (single service consolidation) | One test suite covers all agent types |
| LangGraph state machine tests | Agent loop mock + conversation lifecycle tests | v2.2 -> v2.3 | No LangGraph dependency in tests |
| Transaction rollback isolation for all tests | TRUNCATE between tests for integration tests | Phase 45 | Supports SKIP LOCKED and multi-transaction workflows |

**Deprecated/outdated:**
- `dev-agent/integration.test.ts`: Placeholder with Temporal imports -- should be replaced entirely, not extended
- Temporal workflow tests (`orchestrator-workflow.test.ts`, `product-agent-workflow.test.ts`): Mark as legacy with `describe.skip`
- Temporal activity tests (`orchestrator-activities.test.ts`, `linear-activities.test.ts`, `slack-activities.test.ts`, `product-agent-activity.test.ts`): Mark as legacy with `describe.skip`

## Test Inventory: What to Mark as Legacy

These test files reference `@temporalio/*` and test Temporal-specific code. They should be marked with `describe.skip("LEGACY: Phase 47 cleanup")`:

| File | Lines | Reason |
|------|-------|--------|
| `shared/temporal/activities/orchestrator-activities.test.ts` | ~400 | Tests Temporal activities, not v2.3 framework |
| `shared/temporal/activities/linear-activities.test.ts` | ~150 | Tests Temporal linear activities |
| `shared/temporal/activities/slack-activities.test.ts` | ~150 | Tests Temporal slack activities |
| `shared/temporal/activities/product-agent-activity.test.ts` | ~200 | Tests Temporal product agent activity |
| `shared/temporal/workflows/orchestrator-workflow.test.ts` | ~500 | Tests Temporal orchestrator workflow |
| `shared/temporal/workflows/product-agent-workflow.test.ts` | ~300 | Tests Temporal product agent workflow |

**Tests to evaluate (may reference live code):**
| File | Decision Criteria |
|------|-------------------|
| `dev-agent/orchestrator/orchestrator.test.ts` | Check if it tests Temporal orchestrator or agent loop -- skip if Temporal |
| `dev-agent/orchestrator/e2e-validation.test.ts` | Check if it tests Temporal orchestrator or agent loop -- skip if Temporal |
| `product-agent/orchestrator/orchestrator.test.ts` | Same criteria |
| `product-agent/orchestrator/e2e-validation.test.ts` | Same criteria |
| `dev-agent/integration.test.ts` | Replace entirely with new integration tests |

**Tests to keep untouched (testing live code):**
- `shared/agent-loop/run-agent-loop.test.ts`
- `shared/agent-loop/token-budget.test.ts`
- `shared/mcp/client.test.ts`
- `shared/tools/**/*.test.ts`
- `framework/**/*.test.ts` (all existing unit tests)
- `adapters/**/*.test.ts`
- `router/**/*.test.ts`

## The 8 Lifecycle Flows: Implementation Notes

### Flow 1: Start -> Run -> Complete
- **Framework:** `executor.start()` -> `startWorker()` -> poll until `completed`
- **Assertions:** Conversation status transitions `queued -> running -> completed`. Event log contains `agent.started` + `agent.completed`. Session projection shows `completed`.
- **Mock:** `mockAgentLoopCompletes()`

### Flow 2: Start -> Pause -> Signal -> Resume -> Complete
- **Framework:** `executor.start()` -> worker picks up -> agent calls `wait_for` -> status becomes `waiting` -> `executor.signal()` -> status becomes `queued` -> worker picks up again -> completes
- **Assertions:** Status transitions `queued -> running -> waiting -> queued -> running -> completed`. Event log contains `agent.started`, `agent.paused`, `signal.received`, `agent.resumed`, `agent.completed`. Pending wait is cleared on signal.
- **Mock:** First call: `mockAgentLoopPauses("approval")`. Second call: `mockAgentLoopCompletes()`.
- **High-risk timing:** Test signal delivery immediately after wait transition (MAJOR-1 from context).

### Flow 3: Start -> Pause -> Timeout -> Resume
- **Framework:** Same as Flow 2 but the signal comes from pg-boss timeout, not external.
- **Assertions:** pg-boss fires `wait_timeout` signal after duration. Conversation resumes.
- **Mock:** Use very short timeout duration ("1s" or similar). Need `timeoutScheduler` wired to real pg-boss.
- **Note:** This flow requires pg-boss to actually fire the job. Use `pollIntervalMs` of 100ms for pg-boss worker.

### Flow 4: Start -> Pause -> Queue Signal -> Resume
- **Framework:** `executor.start()` -> immediately `executor.signal()` (before worker picks up) -> signal gets queued in `queued_signals` -> worker picks up, detects queued signal matching `pending_wait.type` -> consumes signal, runs without pausing
- **Assertions:** Signal action is `queued`. When worker eventually runs, it finds matching signal, appends it as message, clears pending_wait, and continues.
- **Timing detail:** Signal arrives while conversation is in `queued` or `running` status (before `wait_for` is called). The worker loop checks `queued_signals` against `pending_wait.type` before running the agent.

### Flow 5: Duplicate Start
- **Framework:** Call `executor.start()` twice with same `agentDefinitionId + correlationKey`.
- **Assertions:** Second call returns same conversation ID. Only one row in conversations table. Status unchanged.
- **Note:** Also test re-trigger: call `start()` after conversation completed -> should create `-r2` suffixed ID.

### Flow 6: Duplicate Signal
- **Framework:** Call `executor.signal()` twice with same `deduplicationId`.
- **Assertions:** First signal returns `resumed` or `queued`. Second signal returns `deduplicated`. `delivered_signal_ids` contains the dedup key.

### Flow 7: Sub-agent Spawn
- **Framework:** Parent conversation calls `spawn_agent` tool -> creates child conversation with `parentConversationId`. Child completes -> parent sees result.
- **Mock:** The `spawn_agent` tool factory needs to call `executor.start()` with `parentConversationId`. Mock both parent and child agent loops.
- **Assertions:** Child conversation has `parent_conversation_id` set. Both conversations complete independently.
- **Note:** Most complex flow. The `spawn_agent` tool in `tool-factories.ts` needs to be wired to the real executor for this test.

### Flow 8: History Compaction
- **Framework:** Create a conversation with many messages (above `pruneThreshold`). Worker picks up, history manager compacts, agent loop runs with compacted messages.
- **Mock:** Set very low `pruneThreshold` (e.g., 100 tokens) in test agent definition. Mock agent loop. Verify that the `initialMessage` or `context` passed to `runAgentLoop` is compacted.
- **Assertions:** Agent loop receives compacted messages (fewer than original). Conversation completes successfully despite compaction.
- **Note:** Phase 1 pruning (tool output trimming) does not need LLM. Only phase 2 (structured summary) needs LLM. Keep test below summary threshold to avoid needing Anthropic mock.

## Recommendations (Claude's Discretion Areas)

### Mock Strategy for LLM Calls
**Recommendation:** Mock `runAgentLoop` at the module level using `vi.mock()`. This is the cleanest boundary -- it mocks at the exact point where the framework hands off to the Anthropic SDK. The mock controls the `AgentLoopResult` return value and the `WaitForState` mutation (for pause scenarios).

Do NOT mock the Anthropic SDK directly. The `runAgentLoop` function handles API call mechanics; mocking it gives control over the framework-relevant outcomes (completed, error, wait_for triggered) without leaking API implementation details into tests.

### Testcontainers Configuration
**Recommendation:** Use `postgres:16-alpine` (matches existing `@aesir/test-utils` default). One container per test file (the `beforeAll`/`afterAll` pattern). Do NOT use global setup -- each integration test file should be independently runnable. Container startup is ~1.5s, acceptable for integration tests.

### Database Isolation Strategy
**Recommendation:** Use `TRUNCATE ... CASCADE` in `afterEach` for all `agents.*` tables. This is 5-10ms per cleanup, simpler than database templates, and provides full isolation. Do NOT use transaction rollback (incompatible with SKIP LOCKED). Do NOT create separate databases per test (too slow, no benefit over TRUNCATE).

### Assertions Per Test
**Recommendation:** Verify at 3 layers for each lifecycle flow:
1. **Conversation status** -- `executor.get()` returns correct status
2. **Event log** -- `eventLog.query()` contains expected event types in correct order
3. **Session projection** -- `sessionProjection.getSession()` reflects final state

For HTTP layer tests, also verify:
4. **HTTP response** -- correct status code and response body
5. **DB state** -- conversation exists with correct attributes

### How to Simulate Agent Loop
**Recommendation:** Use `runAgentLoop` mock with `WaitForState` mutation for pause scenarios (described in Pattern 2 above). This is the real mechanism -- the worker loop creates a `WaitForState`, passes it to the `wait_for` tool, and checks `triggered` after the loop. By mocking `runAgentLoop` to call the actual `wait_for` tool in the tools array, we test the real wiring without the LLM.

## Open Questions

1. **Express app factory for HTTP tests**
   - What we know: `service/main.ts` does bootstrap inline (pool, registries, executor all in one function). There is no exported `createApp()` factory.
   - What's unclear: Whether to extract an `createApp()` factory for testability or build the Express app from scratch in tests.
   - Recommendation: Build a minimal Express app in the test setup using the same route handlers as `service/main.ts` but with test-controlled dependencies. This avoids modifying production code. If the team later wants a reusable `createApp()`, that can be a follow-up refactor.

2. **Spawn Agent Tool Wiring in Integration Tests**
   - What we know: `spawn_agent` in `tool-factories.ts` creates a tool that needs access to the executor. The existing factory creates a placeholder that calls `executor.start()`.
   - What's unclear: Exact wiring needed to test Flow 7 (sub-agent spawn) end-to-end. Need to verify how the spawn_agent tool factory receives the executor reference.
   - Recommendation: Investigate `tool-factories.ts` `registerAllTools()` during planning. If spawn_agent needs executor injection, provide it via the test setup.

3. **Environment Validation Workaround**
   - What we know: `shared/env/config.ts` calls `process.exit(1)` on missing env vars at import time.
   - What's unclear: Whether integration tests can avoid importing this module entirely, or if they need to set env vars.
   - Recommendation: Set minimal env vars in the test setup file (`ANTHROPIC_API_KEY=test-key`, `LINEAR_TEAM_ID=test`, etc.) before any module imports. This is the simplest approach and avoids fragile `vi.mock()` chains for environment.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/agents/src/framework/` (all framework modules and tests)
- Codebase analysis: `packages/agents/src/service/main.ts` (service entry point)
- Codebase analysis: `packages/agents/src/shared/db/schema.ts` (database schema)
- Codebase analysis: `packages/agents/src/shared/db/migrations/` (all 3 migration files)
- Codebase analysis: `packages/test-utils/src/` (existing test infrastructure)
- Codebase analysis: `vitest.config.ts`, `vitest.integration.config.ts` (test configuration)
- Codebase analysis: `packages/agents/src/framework/worker-loop.test.ts` (established test patterns)
- `2.3-spec.md` Testing Strategy section (8 lifecycle flows definition)

### Secondary (MEDIUM confidence)
- [Testcontainers Node.js PostgreSQL Module](https://node.testcontainers.org/modules/postgresql/)
- [Testcontainers Best Practices](https://www.docker.com/blog/testcontainers-best-practices/)
- [Integration Testing Node.js Postgres with Vitest & Testcontainers](https://nikolamilovic.com/posts/2025-4-15-integration-testing-node-vitest-testcontainers/)
- [Using TestContainers with Vitest](https://dev.to/jcteague/using-testconatiners-with-vitest-499f)
- [supertest npm](https://www.npmjs.com/package/supertest)

### Tertiary (LOW confidence)
- pg-boss integration testing patterns -- no authoritative sources found; recommendations based on understanding pg-boss's PostgreSQL requirements and general testcontainers patterns.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use except supertest; versions verified from package.json
- Architecture: HIGH -- patterns derived from existing codebase, spec, and test infrastructure
- Pitfalls: HIGH -- identified from code analysis (env validation, SKIP LOCKED mechanics, pg-boss schema management)
- Lifecycle flow details: HIGH -- directly mapped from spec + executor/worker-loop source code

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (stable -- no fast-moving dependencies)
