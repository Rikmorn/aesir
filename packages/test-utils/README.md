# @aesir/test-utils

Shared test infrastructure for the Aesir monorepo.

## What belongs here

- **Testcontainers** - PostgreSQL container setup for integration tests
- **Migrations** - reads a package's real migration files for a test database
- **Mocks** - `createMockLogger`, the one test double more than one package uses

Something earns a place here once a second package needs it. Factories, MSW handlers, a credential-store double and transaction helpers all lived here with no importer at all, while `.claude/rules/testing.md` presented them as the house pattern, so anyone following the rule was sent to code nothing ran (#44). A helper with one consumer belongs in that package.

## What does NOT belong here

- Package-specific test helpers (keep those in the package)
- Production code
- Business logic
- Helpers added before a second package needs them

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
- `@testcontainers/postgresql` - Docker container management
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
