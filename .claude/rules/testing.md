---
paths:
  - "packages/**/*.test.ts"
  - "packages/**/vitest.config.ts"
  - "packages/test-utils/**"
  - "packages/agents/scripts/agent-tests/**"
---

# Unit Test Patterns

## Structure

Tests are co-located: `myModule.ts` → `myModule.test.ts` in the same directory.

```typescript
import { describe, expect, it } from "vitest";
import { myFunction } from "./myModule.js";

describe("myFunction", () => {
  it("should do the expected thing", () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });
});
```

## Factories (Deterministic Test Data)

Use `@aesir/test-utils` factories. Always reset counters:

```typescript
import { createTestAgent, resetAllCounters } from "@aesir/test-utils";

beforeEach(() => {
  resetAllCounters();
});

it("creates predictable data", () => {
  const agent1 = createTestAgent(); // "Test task 0"
  const agent2 = createTestAgent(); // "Test task 1"
});
```

Available: `createTestAgent()`, `createTestCredential()`, `createTestIssue()`, `createTestPR()`, `createTestDevWorkflowState()`.

## Mock Logger

```typescript
import { createMockLogger } from "@aesir/test-utils";

const logger = createMockLogger();
// After calling code:
expect(logger.hasLoggedAt("error", /failed/)).toBe(true);
expect(logger.getCallsAt("info")).toHaveLength(2);
logger.clear(); // Reset between tests
```

Child loggers share the parent's calls array.

## Mocking Drizzle Query Chains

Build mocks by chaining `vi.fn().mockReturnValue()`:

```typescript
function createMockDb() {
  const whereFn = vi.fn().mockResolvedValue([]);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn, insert: vi.fn().mockReturnValue({ values: vi.fn() }) };
}
```

## Module Mocking

`vi.mock()` must come BEFORE imports that use the mocked module:

```typescript
vi.mock("../../shared/mcp/client.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({ success: true }),
}));

// NOW import the module that uses callMcpTool
import { myHandler } from "./handler.js";
```

# Integration Test Patterns

## Setup Order (Critical)

1. `vi.mock()` calls — BEFORE any framework imports
2. Set env vars — BEFORE framework modules trigger Zod validation
3. Import framework modules — AFTER mocks and env are ready
4. Start containers — in `beforeAll` with long timeout (60s)
5. Clean up — `afterEach` (rollback/table cleanup), `afterAll` (stop containers)

```typescript
// 1. Mocks first
vi.mock("../../shared/agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

// 2. Env vars
process.env.ANTHROPIC_API_KEY = "test-key";

// 3. Now import
import { createConversationExecutor } from "./executor.js";

let ctx: IntegrationTestContext;

beforeAll(async () => {
  ctx = await setupTestContext(); // Starts container + runs migrations
}, 60000);

afterEach(async () => {
  await txCtx.rollback(); // Or cleanupTables(ctx)
});

afterAll(async () => {
  await teardownTestContext(ctx);
});
```

## Testcontainers

```typescript
import { setupPostgresContainer } from "@aesir/test-utils";

const container = await setupPostgresContainer(); // postgres:16-alpine
const pool = new Pool({ connectionString: container.connectionUri });
const db = drizzle(pool, { schema });
await runTestMigrations(container.sql, migrationSql);
```

## Transaction Isolation (~300ms vs 1500ms container restart)

```typescript
import { startTestTransaction } from "@aesir/test-utils";

let txCtx: TransactionContext;
beforeEach(async () => { txCtx = await startTestTransaction(sql); });
afterEach(async () => { await txCtx.rollback(); });
```

## MSW (HTTP boundary mocking)

```typescript
import { setupMSW } from "@aesir/test-utils";
setupMSW({ beforeAll, afterEach, afterAll }, { onUnhandledRequest: "error" });
```

Pre-built handlers for Linear (GraphQL), GitHub (REST), Slack (REST).

# Agent Integration Test Patterns

## Overview

Agent tests are scenario-driven and LLM-evaluated. They test emergent agent behavior, not unit logic.

Flow: fire event → poll DB for settlement → collect evidence → Haiku judges pass/fail.

## Scenario Format

```typescript
export const myScenario: AgentTestScenario = {
  id: "my-scenario",
  name: "Human-Readable Name",
  description: "What this tests",
  trigger: { eventType: "testing.my_scenario.start" },
  timeoutMs: 60_000,
  expect: `
    - Expected conversation count and statuses
    - Expected tool call sequences
    - Expected task/handoff artifacts
    - No error events
    - No conversations stuck in waiting/running
  `,
  tags: ["delegation", "tools"],
};
```

Register in `packages/agents/scripts/agent-tests/scenarios/index.ts`.

## Test Agent Conventions

- Directory: `definitions/test-{name}/`
- Trigger: `testing.*` events only
- Model: Haiku (cheap, fast)
- Token budget: 15k-25k (low, focused)
- The `id` field in definition.yaml MUST match the directory name

## Evidence Collection

The runner collects from the database using the correlationId:
- All conversations (status, messages, definition)
- All tasks (status, assignee, completion_result)
- All handoffs (type, context)
- All events from event log (tool calls, signals, errors)

## Evaluation

Haiku receives the scenario's `expect` criteria + formatted evidence and returns pass/fail with reasoning. The `expect` field is natural language — describe observable outcomes, not implementation details.

## Running

```bash
pnpm --filter @aesir/agents test:agents          # All scenarios
pnpm --filter @aesir/agents test:agents -- --scenario my-scenario  # Single
```

Requires `docker compose up` (full stack running).
