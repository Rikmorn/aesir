---
paths:
  - "packages/**/*.test.ts"
  - "packages/**/vitest.config.ts"
  - "packages/test-utils/**"
  - "packages/agents/scripts/agent-tests/**"
---

# Unit Test Patterns

## Make it fail once

A passing check is evidence only when you know what would make it fail. Before trusting green, make a new test or guard fail on purpose: revert the fix and watch it go red, or feed the guard the thing it exists to catch.

The false greens to expect here (#46, #42 and #62 are the cases):

- A guard whose pattern never matches the code it protects, so it can never fire.
- A test schema that differs from production, so a test passes against constraints production lacks.
- A fixture that leaves a nullable column NULL, so a `UNIQUE` constraint under test is never reached, because PostgreSQL treats NULLs as distinct.

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

Vitest hoists `vi.mock()` above the file's imports, so the mock applies wherever the call sits. The factory runs before the file's own variables exist; share values with it through `vi.hoisted()`.

```typescript
vi.mock("../../shared/mcp/client.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({ success: true }),
}));

import { myHandler } from "./handler.js";
```

# Integration Test Patterns

## Setup

Env that the framework validates at load comes from the integration project's `setupFiles` entry, `packages/agents/src/framework/__integration__/env.setup.ts`. An assignment in the test file runs too late, because the file's imports are evaluated first; add a new required variable to `env.setup.ts` instead.

Start the container in `beforeAll` with a long timeout, clean tables in `afterEach`, and stop the container in `afterAll`:

```typescript
vi.mock("../../shared/agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

import { createConversationExecutor } from "../../framework/index.js";
import {
  cleanupTables,
  type IntegrationTestContext,
  setupTestContext,
  teardownTestContext,
} from "./setup.js";

let ctx: IntegrationTestContext;

beforeAll(async () => {
  ctx = await setupTestContext(); // Starts container + runs migrations
}, 60000);

afterEach(async () => {
  await cleanupTables(ctx);
});

afterAll(async () => {
  await teardownTestContext(ctx);
});
```

## Testcontainers

Build the schema from the package's real migrations: a hand-copied snapshot drifts from production, and nothing fails when it does.

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readJournalMigrations,
  runTestMigrations,
  setupPostgresContainer,
} from "@aesir/test-utils";

const container = await setupPostgresContainer(); // pgvector image; tag set in packages/test-utils/src/containers/postgres.ts
const pool = new Pool({ connectionString: container.connectionUri });
const db = drizzle(pool, { schema });

await runTestMigrations(
  container.sql,
  await readJournalMigrations(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
  ),
);
```

`readJournalMigrations` applies the order in `meta/_journal.json`, which is what drizzle applies -- not the directory listing. The default image carries pgvector because the agents migrations open with `CREATE EXTENSION vector`.

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
pnpm --filter @aesir/agents test:agents                    # All scenarios
pnpm --filter @aesir/agents test:agents -- my-scenario     # One or more scenario IDs (positional)
pnpm --filter @aesir/agents test:agents -- --tag handoff   # Every scenario carrying a tag
```

Requires `docker compose up` (full stack running).
