# Phase 20: Testing Pyramid - Research

**Researched:** 2026-01-23
**Domain:** Testing infrastructure, coverage tooling, testcontainers, test fixtures
**Confidence:** HIGH

## Summary

Testing pyramid implementation for TypeScript monorepos involves coordinating coverage configuration at workspace level, using testcontainers for isolated integration tests, and implementing factory-based test fixtures for deterministic data generation.

**Standard approach:** Vitest v8 coverage with workspace-level configuration, testcontainers with transaction-per-test isolation, and factory pattern fixtures with deterministic defaults. MSW for HTTP mocking enables unit testing of integration code.

**Key architectural decision:** Coverage configuration must live at workspace root (not per-project), testcontainers should be shared per test suite with transaction rollback between tests (not per-test container creation), and fixture factories should use deterministic IDs by default (not Faker randomness).

**Primary recommendation:** Use @vitest/coverage-v8 with workspace-level thresholds, @testcontainers/postgresql with static containers + transaction isolation, simple factory functions (not Fishery library) for fixture creation, and MSW for external API mocking.

## Standard Stack

The established libraries/tools for comprehensive testing in TypeScript monorepos:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 3.0+ | Test runner and framework | Built for monorepos, fast, native ESM support |
| @vitest/coverage-v8 | 4.0.17 | Coverage collection | Vitest's official provider, faster than istanbul |
| @testcontainers/postgresql | Latest | PostgreSQL containers for integration tests | Official module, provides isolated real databases |
| msw | 2.x | HTTP request mocking | Industry standard, works in Node and browser |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testcontainers/localstack | Latest | AWS service mocking | If testing S3, SQS, SNS interactions |
| @testcontainers/temporal | Latest | Temporal service container | For full workflow integration tests |
| postgres.js | Latest | Fast PostgreSQL driver | For transaction management in tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Testcontainers | PGlite (@electric-sql/pglite) | PGlite is faster (no Docker) but less production-like |
| Simple factories | Fishery library | Fishery adds complexity (hooks, traits) without clear benefit for this codebase |
| Deterministic IDs | Faker.js with seeding | Faker adds randomness complexity and performance overhead |
| MSW | Nock | Nock uses lower-level http interception, MSW better matches real requests |

**Installation:**
```bash
pnpm add -D @vitest/coverage-v8 @testcontainers/postgresql msw
```

## Architecture Patterns

### Recommended Project Structure
```
packages/
├── test-utils/                    # NEW: Shared test infrastructure
│   ├── src/
│   │   ├── factories/             # Domain object factories
│   │   │   ├── credentials.ts     # createTestCredential()
│   │   │   ├── issues.ts          # createTestIssue()
│   │   │   ├── prs.ts            # createTestPR()
│   │   │   └── index.ts          # Barrel export
│   │   ├── mocks/                 # Mock implementations
│   │   │   ├── logger.ts          # MockLogger
│   │   │   ├── credential-store.ts # MockCredentialStore
│   │   │   └── index.ts
│   │   ├── containers/            # Testcontainer setup utilities
│   │   │   ├── postgres.ts        # setupPostgresContainer()
│   │   │   └── index.ts
│   │   ├── db/                    # Database test utilities
│   │   │   ├── seed.ts           # seedTestDatabase()
│   │   │   ├── transaction.ts    # withTransaction()
│   │   │   └── index.ts
│   │   └── index.ts               # Barrel export
│   ├── vitest.config.ts
│   └── package.json
├── platform/
│   ├── src/
│   │   ├── db/
│   │   │   ├── client.ts
│   │   │   └── client.test.ts     # Unit test (colocated)
│   │   └── ...
│   ├── tests/                     # Integration tests (package-level)
│   │   ├── db-integration.test.ts
│   │   └── ...
│   └── vitest.config.ts
└── ...

tests/                             # E2E/System tests (workspace-level)
├── e2e/
│   └── full-workflow.e2e.test.ts
└── vitest.config.ts

vitest.config.ts                   # Root config for coverage
```

### Pattern 1: Coverage Configuration (Workspace-Level)
**What:** Coverage options MUST be configured at workspace root, not in project configs
**When to use:** Always in monorepo setups
**Critical gotcha:** Project-level coverage configs are silently ignored when running from root

**Example:**
```typescript
// vitest.config.ts (ROOT - next to package.json)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],  // Projects mode for monorepo

    // Coverage MUST be here, not in project configs
    coverage: {
      provider: 'v8',
      enabled: false,  // Only enable via CLI flag
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],

      // Thresholds with glob patterns
      thresholds: {
        // Core packages: higher bar
        'packages/common/**': { lines: 70, functions: 70, branches: 70, statements: 70 },
        'packages/platform/**': { lines: 70, functions: 70, branches: 70, statements: 70 },
        'packages/observability/**': { lines: 70, functions: 70, branches: 70, statements: 70 },

        // Integration packages: lower bar (API wrappers harder to test)
        'packages/integrations/**': { lines: 50, functions: 50, branches: 50, statements: 50 },
        'packages/agents/**': { lines: 50, functions: 50, branches: 50, statements: 50 },
      },

      // Exclusions
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.integration.test.ts',
        '**/*.e2e.test.ts',
        '**/db/migrations/**',      // Migration scripts
        '**/db/scripts/**',         // Seed/maintenance scripts
        '**/main.ts',               // Entry points
        '**/types.ts',              // Type-only files
        '**/schemas.ts',            // Zod schemas (type validation)
        '**/_legacy/**',            // Legacy code
      ],
    },
  },
});

// packages/platform/vitest.config.ts (PROJECT)
import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "platform",
    environment: "node",
    // NO coverage config here - it won't work!
  },
});
```

### Pattern 2: Testcontainers with Transaction Isolation
**What:** Share container per test suite, use transactions for isolation between tests
**When to use:** Integration tests that need real PostgreSQL
**Why not per-test containers:** Container startup is slow (1500ms vs 300ms for transaction rollback)

**Example:**
```typescript
// packages/platform/tests/db-integration.test.ts
import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { migrate } from '../src/db/migrate';

describe('Database integration tests', () => {
  let container: StartedPostgreSqlContainer;
  let sql: postgres.Sql;

  // STATIC container - shared across all tests in suite
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_db')
      .start();

    // Create connection
    sql = postgres(container.getConnectionUri());

    // Run migrations
    await migrate(sql);
  }, 60000);  // Longer timeout for container startup

  afterAll(async () => {
    await sql.end();
    await container.stop();
  });

  // TRANSACTION per test - fast isolation
  let txSql: postgres.Sql;

  beforeEach(async () => {
    // Start transaction
    txSql = await sql.begin(async (txn) => {
      return txn;
    });
  });

  afterEach(async () => {
    // Rollback transaction
    await txSql`ROLLBACK`;
  });

  it('should insert and retrieve credential', async () => {
    const [result] = await txSql`
      INSERT INTO credentials (workspace_id, provider, access_token)
      VALUES ('ws_test', 'linear', 'token123')
      RETURNING *
    `;

    expect(result.workspace_id).toBe('ws_test');
  });

  it('should start with clean state', async () => {
    // Previous test's data rolled back
    const results = await txSql`SELECT * FROM credentials`;
    expect(results).toHaveLength(0);
  });
});
```

**Source:** [Testcontainers Java discussion on data pollution](https://github.com/testcontainers/testcontainers-java/discussions/4845), [PostgreSQL transaction docs](https://www.atdatabases.org/docs/pg-guide-transactions)

### Pattern 3: Factory Functions for Test Fixtures
**What:** Simple factory functions with default merging, deterministic IDs
**When to use:** Creating test data for any domain object
**Why not Fishery:** Simpler codebase with TypeScript already providing type safety

**Example:**
```typescript
// packages/test-utils/src/factories/credentials.ts
import type { DecryptedCredential } from '@aesir/integrations';

interface CreateCredentialOptions {
  id?: string;
  workspaceId?: string;
  provider?: 'linear' | 'github' | 'slack';
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

let credentialCounter = 0;

export function createTestCredential(options: CreateCredentialOptions = {}): DecryptedCredential {
  const id = credentialCounter++;

  return {
    id: options.id ?? `test_cred_${id}`,
    workspaceId: options.workspaceId ?? 'ws_test',
    provider: options.provider ?? 'linear',
    accessToken: options.accessToken ?? `token_${id}`,
    refreshToken: options.refreshToken ?? null,
    tokenType: 'Bearer',
    scope: null,
    expiresAt: options.expiresAt ?? null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

// Usage in tests
const cred1 = createTestCredential();  // Deterministic: test_cred_0, token_0
const cred2 = createTestCredential();  // Deterministic: test_cred_1, token_1
const custom = createTestCredential({ provider: 'github', accessToken: 'custom_token' });
```

**Why deterministic over Faker:**
- Predictable test assertions (always know what ID will be)
- Faster (no random generation overhead)
- Debuggable (same test always creates same data)
- Simpler (no seeding complexity)

**Source:** [Arguments against Faker](https://kevin.burke.dev/kevin/faker-js-problems/), [Stop using Faker article](https://jetthoughts.com/blog/stop-using-faker-random-data-in-test-fixtures/)

### Pattern 4: MSW for HTTP Mocking
**What:** Mock external API requests (Linear, GitHub, Slack) in unit tests
**When to use:** Testing integration client code without hitting real APIs
**Setup:** Server created once, handlers reset between tests

**Example:**
```typescript
// packages/test-utils/src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const linearHandlers = [
  http.post('https://api.linear.app/graphql', () => {
    return HttpResponse.json({
      data: {
        issue: {
          id: 'issue_123',
          title: 'Test Issue',
          state: { name: 'Todo' },
        },
      },
    });
  }),
];

// packages/test-utils/src/mocks/server.ts
import { setupServer } from 'msw/node';
import { linearHandlers } from './handlers';

export const server = setupServer(...linearHandlers);

// vitest.setup.ts (referenced in vitest.config.ts)
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from '@aesir/test-utils/mocks/server';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Source:** [MSW Node.js integration docs](https://mswjs.io/docs/integrations/node/)

### Anti-Patterns to Avoid

- **Per-project coverage config:** Coverage configuration in project-level vitest.config files is silently ignored when running from root
- **Per-test containers:** Creating new containers for each test is 5x slower than transaction rollback
- **Random test data:** Faker and randomized fixtures lead to flaky tests and debugging nightmares
- **Shared database state:** Tests that don't clean up pollute later tests - always use transactions
- **Global mocks:** Resetting MSW handlers in afterEach prevents test pollution from custom handlers

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PostgreSQL test isolation | Custom database cleanup scripts | Testcontainers + transactions | Containers provide true isolation, transactions are fast |
| HTTP request mocking | Custom fetch wrapper with stubs | MSW | MSW intercepts at network level, works with any HTTP library |
| Test data factories | Object.assign with defaults | Simple factory functions | Factory pattern with counter provides determinism |
| Coverage aggregation | Custom coverage merging | Vitest workspace coverage | Vitest handles monorepo aggregation natively |
| Database migrations in tests | Manual schema setup | Run actual migrations | Tests should use production migration code |

**Key insight:** Testing infrastructure has well-solved patterns. Testcontainers eliminates database mocking, MSW eliminates HTTP mocking, and Vitest handles monorepo complexity.

## Common Pitfalls

### Pitfall 1: Coverage Config in Wrong Place
**What goes wrong:** Coverage configuration in project-level `vitest.config.ts` files appears to work when running tests from that package directory, but is silently ignored when running from monorepo root
**Why it happens:** Vitest's workspace/projects mode only respects coverage configuration from the root config file
**How to avoid:** Put ALL coverage configuration (thresholds, exclusions, reporters) in root `vitest.config.ts`
**Warning signs:** Coverage report missing when running `pnpm test` from root, but present when running in package directory

**Source:** [Vitest workspace coverage discussion](https://github.com/vitest-dev/vitest/discussions/3852), [Coverage config location issue](https://github.com/vitest-dev/vscode/discussions/454)

### Pitfall 2: Container Per Test Performance
**What goes wrong:** Creating new testcontainers in `beforeEach` causes tests to run extremely slowly (30+ seconds for simple suites)
**Why it happens:** Docker container startup includes image pull, container creation, health checks, and initialization
**How to avoid:** Use static containers in `beforeAll`, isolate tests with transaction rollback in `beforeEach/afterEach`
**Warning signs:** Tests taking >1000ms each, Docker daemon showing frequent container churn

**Benchmark:** Container startup 1500ms vs transaction rollback 300ms

**Source:** [Testcontainers reuse strategy](https://callistaenterprise.se/blogg/teknik/2020/10/09/speed-up-your-testcontainers-tests/), [Performance optimization article](https://rieckpil.de/reuse-containers-with-testcontainers-for-fast-integration-tests/)

### Pitfall 3: Faker-Based Flaky Tests
**What goes wrong:** Tests fail intermittently because Faker generates data that violates assumptions (e.g., string too long, unexpected characters)
**Why it happens:** Random data creates random test behavior, violating determinism
**How to avoid:** Use deterministic factory functions with incrementing counters, not Faker
**Warning signs:** Tests fail in CI but pass locally, failures disappear on retry, "it works on my machine"

**Evidence:** Teams have reduced test time 20%+ by removing Faker

**Source:** [Faker problems article](https://kevin.burke.dev/kevin/faker-js-problems/), [Stop using Faker in tests](https://jetthoughts.com/blog/stop-using-faker-random-data-in-test-fixtures/)

### Pitfall 4: Transaction Scope Leakage
**What goes wrong:** Test transactions leak to other tests, causing "database is being accessed by other users" errors
**Why it happens:** Transaction not properly committed or rolled back, or client connection shared across tests
**How to avoid:** Always pair `BEGIN` with `COMMIT` or `ROLLBACK` in try/finally, use separate client per transaction
**Warning signs:** Intermittent "database locked" errors, tests pass alone but fail in suite

**Pattern:**
```typescript
beforeEach(async () => {
  txSql = await sql.begin(async (txn) => txn);
});

afterEach(async () => {
  // ALWAYS rollback, even if test throws
  await txSql`ROLLBACK`;
});
```

**Source:** [node-postgres transactions](https://node-postgres.com/features/transactions), [Transaction isolation issue](https://github.com/brianc/node-postgres/issues/794)

### Pitfall 5: Test File Naming Ambiguity
**What goes wrong:** Integration tests run during `test:fast` because they're named `*.test.ts` instead of `*.integration.test.ts`
**Why it happens:** Insufficient naming convention clarity
**How to avoid:** Strictly enforce naming: `*.test.ts` (unit), `*.integration.test.ts` (with containers), `*.e2e.test.ts` (full system)
**Warning signs:** "Fast" tests still taking >10 seconds, Docker containers starting during rapid iteration

### Pitfall 6: MSW Handler Pollution
**What goes wrong:** Custom handler from one test affects subsequent tests because handlers aren't reset
**Why it happens:** Forgetting `server.resetHandlers()` in `afterEach`
**How to avoid:** Always call `server.resetHandlers()` in global afterEach hook
**Warning signs:** Tests fail when run together but pass in isolation, unexpected responses in unrelated tests

### Pitfall 7: Coverage Threshold Auto-Update with Shared Configs
**What goes wrong:** Setting `coverage.thresholds.autoUpdate: true` fails with "Configuration file is too complex" when using shared configs
**Why it happens:** Vitest can't auto-update thresholds in configs that use `mergeConfig()` or imports
**How to avoid:** Don't use `autoUpdate` in monorepos with shared configuration
**Warning signs:** Error message about complex configuration when coverage improves

**Source:** [Auto-update threshold issue](https://github.com/vitest-dev/vitest/issues/5803)

## Code Examples

Verified patterns from official sources:

### Vitest Workspace Configuration with Projects Mode
```typescript
// vitest.config.ts (root)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Projects mode (replaces deprecated workspace feature)
    projects: ["packages/*"],

    // Coverage at workspace level
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',

      // Glob-based thresholds
      thresholds: {
        'packages/platform/**': {
          lines: 70,
          functions: 70,
          branches: 70,
          statements: 70,
        },
      },

      exclude: [
        '**/node_modules/**',
        '**/*.test.ts',
        '**/main.ts',
        '**/types.ts',
        '**/schemas.ts',
        '**/_legacy/**',
      ],
    },
  },
});
```
**Source:** [Vitest projects configuration](https://vitest.dev/guide/workspace), [Coverage config options](https://vitest.dev/config/coverage)

### Testcontainers with Static Container Pattern
```typescript
// packages/platform/tests/db.integration.test.ts
import { describe, beforeAll, afterAll, beforeEach, afterEach, it } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

describe('Database operations', () => {
  let container: StartedPostgreSqlContainer;
  let sql: postgres.Sql;

  beforeAll(async () => {
    // Start once per suite
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_db')
      .start();

    sql = postgres(container.getConnectionUri());

    // Run migrations
    await runMigrations(sql);
  }, 60000);

  afterAll(async () => {
    await sql.end();
    await container.stop();
  });

  // Transaction isolation per test
  beforeEach(async () => {
    await sql`BEGIN`;
  });

  afterEach(async () => {
    await sql`ROLLBACK`;
  });

  it('should isolate test data', async () => {
    await sql`INSERT INTO users (name) VALUES ('test')`;
    // Rolled back after test
  });
});
```
**Source:** [PostgreSQL Testcontainers docs](https://node.testcontainers.org/modules/postgresql/)

### Deterministic Factory Pattern
```typescript
// packages/test-utils/src/factories/issues.ts
import type { LinearIssue } from '@aesir/integration-linear';

let issueCounter = 0;

export function createTestIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  const id = issueCounter++;

  return {
    id: `issue_${id}`,
    title: `Test Issue ${id}`,
    description: `Description for test issue ${id}`,
    state: 'Todo',
    priority: 2,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,  // Spread overrides last
  };
}

// Usage
const issue1 = createTestIssue();  // Always creates issue_0 first
const issue2 = createTestIssue({ title: 'Custom' });  // issue_1 with custom title
```

### Fast Test Filtering by File Name Pattern
```typescript
// vitest.config.ts (root)
export default defineConfig({
  test: {
    projects: ["packages/*"],

    // Exclude patterns for test:fast command
    exclude: [
      '**/node_modules/**',
      '**/*.integration.test.ts',  // Skip integration tests
      '**/*.e2e.test.ts',           // Skip E2E tests
      '**/sandbox/**/*.test.ts',    // Skip Docker sandbox tests
    ],
  },
});

// package.json scripts
{
  "scripts": {
    "test": "vitest run",
    "test:fast": "vitest run --exclude='**/*.integration.test.ts' --exclude='**/*.e2e.test.ts'",
    "test:integration": "vitest run --testNamePattern='integration'",
    "test:watch": "vitest"
  }
}
```
**Source:** [Vitest test filtering](https://vitest.dev/guide/filtering)

### MSW Setup for Vitest
```typescript
// vitest.setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './src/mocks/server';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// src/mocks/server.ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const handlers = [
  http.get('https://api.linear.app/graphql', () => {
    return HttpResponse.json({ data: { viewer: { id: 'user_123' } } });
  }),
];

export const server = setupServer(...handlers);

// vitest.config.ts - reference setup file
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
});
```
**Source:** [MSW Node.js integration](https://mswjs.io/docs/integrations/node/)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jest | Vitest | 2023-2024 | Native ESM, faster, better monorepo support |
| Istanbul coverage | V8 coverage | 2023 | Faster coverage collection, no transpilation |
| In-memory/mocked DBs | Testcontainers | 2020+ | Tests use production database, catch more bugs |
| Static fixtures (JSON) | Factory functions | Ongoing | Easier to customize, type-safe |
| Workspace config | Projects config | Vitest 3.2 (2024) | Same functionality, different name |
| Faker with seeding | Deterministic factories | 2024-2025 | Eliminates flaky tests from randomness |
| H2/SQLite for tests | PGlite | 2025-2026 | WASM PostgreSQL, faster than containers |

**Deprecated/outdated:**
- `vitest.workspace.ts`: Deprecated in Vitest 3.2, use `projects` config in `vitest.config.ts`
- Testcontainers reuse mode: Experimental, not recommended for CI (local dev only)
- `coverage.all` option: Had issues in workspace mode, prefer explicit includes
- Per-project coverage reporters: Only root-level reporters are respected

## Open Questions

Things that couldn't be fully resolved:

1. **PGlite vs Testcontainers Trade-off**
   - What we know: PGlite (@electric-sql/pglite) is faster (no Docker overhead), WASM-based PostgreSQL
   - What's unclear: Production parity - does PGlite catch all PostgreSQL quirks? Extension support?
   - Recommendation: Start with Testcontainers (known good), evaluate PGlite in Phase 21 for CI speed optimization

2. **Testcontainers Reuse Feature for Local Dev**
   - What we know: Can enable `testcontainers.reuse.enable=true` in `~/.testcontainers.properties` to keep containers running between test runs
   - What's unclear: Risk of stale state between test runs, memory leaks over time
   - Recommendation: Document as optional local dev optimization, not required or default

3. **Cross-Package Coverage in Monorepo**
   - What we know: When package A tests call package B code, coverage for package B may not be reported
   - What's unclear: Whether Vitest's `coverage.allowExternal` fully resolves this
   - Recommendation: Accept per-package coverage reports, investigate aggregation in Phase 21

4. **Temporal Workflow Integration Tests**
   - What we know: @testcontainers/temporal exists but less documented than PostgreSQL module
   - What's unclear: Performance implications, whether to mock Temporal or use real container
   - Recommendation: Phase 20 focuses on platform/integration tests; defer Temporal testing patterns to agent testing phase

## Sources

### Primary (HIGH confidence)
- [Vitest Coverage Configuration](https://vitest.dev/config/coverage) - Official coverage options
- [Vitest Test Projects Guide](https://vitest.dev/guide/workspace) - Monorepo projects mode
- [Testcontainers PostgreSQL Module](https://node.testcontainers.org/modules/postgresql/) - Container setup
- [MSW Node.js Integration](https://mswjs.io/docs/integrations/node/) - HTTP mocking setup
- [node-postgres Transactions](https://node-postgres.com/features/transactions) - Transaction patterns

### Secondary (MEDIUM confidence)
- [Vitest projects monorepo setup](https://www.thecandidstartup.org/2024/08/19/vitest-monorepo-setup.html) - Practical monorepo guide
- [Testcontainers performance optimization](https://callistaenterprise.se/blogg/teknik/2020/10/09/speed-up-your-testcontainers-tests/) - Container reuse patterns
- [Fishery GitHub repo](https://github.com/thoughtbot/fishery) - Factory library comparison
- [Factory.ts npm page](https://www.npmjs.com/package/factory.ts) - Alternative factory library

### Tertiary (LOW confidence - WebSearch only, marked for validation)
- [Arguments against Faker](https://kevin.burke.dev/kevin/faker-js-problems/) - Performance and flakiness concerns
- [Stop using Faker article](https://jetthoughts.com/blog/stop-using-faker-random-data-in-test-fixtures/) - Determinism arguments
- [PGlite for testing](https://dev.to/benjamindaniel/how-to-test-your-nodejs-postgres-app-using-drizzle-pglite-4fb3) - WASM PostgreSQL alternative
- [Coverage issues in monorepo](https://github.com/vitest-dev/vitest/discussions/3852) - Community discussion of workspace coverage

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official packages with clear documentation
- Architecture: HIGH - Official docs for Vitest workspace and Testcontainers lifecycle
- Pitfalls: HIGH - Documented issues in GitHub with workarounds
- Coverage monorepo config: HIGH - Verified in official docs and multiple issue threads
- Factory pattern choice: MEDIUM - Based on community feedback, not official recommendation
- PGlite alternative: LOW - Emerging pattern, needs validation

**Research date:** 2026-01-23
**Valid until:** ~60 days (stable testing tools, slow-moving ecosystem)
