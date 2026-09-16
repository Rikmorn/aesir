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
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupPostgresContainer,
  cleanupPostgresContainer,
  readJournalMigrations,
  createMockLogger,
} from "@aesir/test-utils";

describe("MyService Integration", () => {
  let containerCtx: PostgresContainerContext;

  beforeAll(async () => {
    containerCtx = await setupPostgresContainer();
    await containerCtx.sql.unsafe(
      await readJournalMigrations(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
      ),
    );
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

### Database Transaction Isolation

For tests that need rollback isolation without full container setup:

```typescript
import { withTestTransaction } from "@aesir/test-utils";

it("should rollback changes", async () => {
  await withTestTransaction(db, async (tx) => {
    await tx.insert(myTable).values({ ... });
    // assertions here
  }); // automatically rolled back
});
```

### Migrations

`readJournalMigrations(migrationsDir)` returns a package's migrations concatenated in the order `meta/_journal.json` lists, which is the order drizzle itself applies. Point it at the package's own `migrations` directory.

There are no per-schema SQL exports. test-utils used to carry a hand-written copy of each schema, and the agents copy stopped at migration 0002 while the package reached 0022, so suites ran against tables that no longer matched production (#42). Reading the real files removes that drift rather than re-syncing a copy.

Because the agents migrations open with `CREATE EXTENSION vector`, `setupPostgresContainer` defaults to `pgvector/pgvector:pg16`. Override with the `image` option if a suite needs something else.

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
