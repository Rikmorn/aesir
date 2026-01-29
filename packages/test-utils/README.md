# @aesir/test-utils

Shared test infrastructure for the Aesir monorepo. Provides containers, mocks, factories, and utilities for consistent, isolated testing across packages.

## What belongs here

- **Testcontainers** - PostgreSQL container setup for integration tests
- **Mocks** - Test doubles for common services (logger, credential stores)
- **Factories** - Deterministic test data generators with counters
- **Migrations** - SQL schemas for test databases (linear, github, slack)
- **MSW handlers** - HTTP API mocks for external services

## What does NOT belong here

- Package-specific test helpers (keep those in the package)
- Production code
- Business logic

## Usage

### Integration Tests with Testcontainers

```typescript
import {
  setupPostgresContainer,
  cleanupPostgresContainer,
  githubMigrationSql,
  createMockLogger,
} from "@aesir/test-utils";

describe("MyService Integration", () => {
  let containerCtx: PostgresContainerContext;

  beforeAll(async () => {
    containerCtx = await setupPostgresContainer();
    await containerCtx.sql.unsafe(githubMigrationSql);
  }, 60000);

  afterAll(async () => {
    await cleanupPostgresContainer(containerCtx);
  });

  it("should work with real database", async () => {
    const service = createMyService({
      db: drizzle(postgres(containerCtx.connectionUri)),
      logger: createMockLogger(),
    });
    // ...
  });
});
```

### Mock Logger

```typescript
import { createMockLogger } from "@aesir/test-utils";

const logger = createMockLogger();

// Use in tests
myFunction({ logger });

// Assert on logs
expect(logger.hasLoggedAt("error")).toBe(true);
expect(logger.hasLoggedAt("info", "Created user")).toBe(true);
expect(logger.getCallsAt("warn")).toHaveLength(2);

// Clear between tests
logger.clear();
```

Child loggers share the same `calls` array with parents, so you can assert on logs from nested loggers.

### Factories

```typescript
import {
  createTestCredential,
  createTestIssue,
  resetAllCounters,
} from "@aesir/test-utils";

beforeEach(() => {
  resetAllCounters(); // Ensures deterministic IDs
});

it("should process credential", () => {
  const cred = createTestCredential({ owner: "my-org" });
  // cred.id is "cred_0", next would be "cred_1", etc.
});
```

### Available Migrations

| Export | Schema | Tables |
|--------|--------|--------|
| `linearMigrationSql` | `linear.*` | credentials, webhook_deliveries, mcp_tool_permissions |
| `githubMigrationSql` | `github.*` | credentials, webhook_deliveries, mcp_tool_permissions |
| `slackMigrationSql` | `slack.*` | installations, event_deliveries, mcp_tool_permissions |

## File Naming Convention

Integration tests should be named `*.integration.test.ts` to be excluded from fast test runs:

```bash
pnpm test:fast  # Excludes *.integration.test.ts
pnpm test:integration  # Only runs *.integration.test.ts
```

## Dependencies

This package depends on:
- `testcontainers` - Docker container management
- `msw` - HTTP request mocking
- `postgres` - PostgreSQL client for migrations

Packages using test-utils should add it as a devDependency:

```json
{
  "devDependencies": {
    "@aesir/test-utils": "workspace:^",
    "postgres": "^3.4.7"
  }
}
```
