# Aesir

Agentic development platform that automates software workflows - from feature request to shipped code. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools.

## Architecture

### 3-Layer Structure

```
Agents (dev-agent, product-agent)
   ↓ uses
Integrations (Linear, GitHub, Slack)
   ↓ uses
Platform (config, logging, state, temporal)
```

**Dependency rules:**
- Agents import from Integrations and Platform
- Integrations import from Platform only
- Platform imports nothing from Agents or Integrations
- Never import in the reverse direction

### Key Frameworks

- **LangGraph**: Agent state machines with PostgreSQL checkpoint persistence
- **Temporal**: Durable workflows for human-in-the-loop approvals (signal-based)
- **Zod**: Schema validation for configs, API inputs, and agent state
- **Anthropic Claude**: Primary LLM for agent reasoning

### State & Persistence

- Agent state persisted to PostgreSQL via LangGraph checkpointer
- Temporal workflows stored in same PostgreSQL instance
- OAuth tokens encrypted and stored in PostgreSQL (integrations.credentials table)

## Directory Structure

```
src/
├── agents/          # Agent definitions (dev-agent, product-agent)
├── api/             # HTTP endpoints for webhooks (Linear, GitHub, Slack)
├── config/          # Configuration and environment validation
├── integrations/    # External service connectors
│   ├── github/      # GitHub API via Octokit
│   ├── linear/      # Linear SDK integration
│   └── slack/       # Slack Bolt for messaging
├── logging/         # Pino-based logging utilities
├── sandbox/         # Docker sandbox for code execution
├── scripts/         # CLI entry points (start-dev-agent, etc.)
├── state/           # LangGraph state definitions
├── temporal/        # Temporal workflow and activity definitions
├── testing/         # Test utilities and helpers
└── tools/           # Agent tools (code generation, etc.)
```

## Common Commands

### Development

```bash
npm run dev          # Start development server (tsx watch)
npm run build        # TypeScript compilation
npm run typecheck    # Type check without emit
```

### Agents

```bash
npm run dev-agent      # Start dev agent directly
npm run product-agent  # Start product agent directly
```

### Testing

```bash
npm test             # Run tests with vitest
npm run test:watch   # Watch mode
npm run test:coverage # With coverage report
```

### Code Quality

```bash
npm run lint         # Run Biome linting
npm run lint:fix     # Auto-fix lint issues
npm run format       # Format with Biome
```

### Infrastructure

```bash
npm run infra:up     # Start PostgreSQL + Temporal via Docker
npm run infra:down   # Stop infrastructure
npm run infra:logs   # View infrastructure logs
```

### Docker

```bash
npm run docker:build      # Build all containers
npm run docker:up         # Start all services
npm run docker:dev-agent  # Run dev agent in container
```

## Code Patterns

### Environment Configuration

Environment is validated at startup via `src/config/env.ts`. Import it first in entry points:

```typescript
// Entry point - env must be first
import "./config/env.js";
import { config } from "./config/index.js";

// Use typed config object
const apiKey = config.anthropic.apiKey;
const dbUrl = config.database.url;
```

### Zod Validation

Use Zod schemas for all external data boundaries:

```typescript
import { z } from "zod";

// Define schema
const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  status: z.enum(["todo", "in_progress", "done"]),
});

// Validate external data
const task = TaskSchema.parse(apiResponse);
```

### Logging

Use pino logger from `src/logging/` - no `console.log` in production code:

```typescript
import { logger } from "./logging/index.js";

const childLogger = logger.child({ component: "github" });
childLogger.info({ prNumber: 123 }, "PR created");
childLogger.error({ err }, "Failed to create PR");
```

### Error Handling

Wrap external API calls in try/catch with logged context:

```typescript
try {
  const result = await linearClient.issue(issueId);
  return result;
} catch (error) {
  logger.error({ err: error, issueId }, "Failed to fetch Linear issue");
  throw error;
}
```

### Type Conventions

- Prefer explicit types for public function signatures
- Use `unknown` over `any` when type is truly unknown
- Export types alongside implementations

### Dependency Injection Pattern

Services use factory functions with explicit dependencies for testability.

**Factory Function Pattern:**

```typescript
interface MyServiceOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

interface MyService {
  doWork(): Promise<void>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

export function createMyService(options: MyServiceOptions): MyService {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for MyService");
  if (!logger) throw new Error("logger is required for MyService");

  return {
    async doWork() { /* implementation */ },
    async health() { /* connectivity check */ },
    async close() { /* cleanup */ },
  };
}
```

**Rules:**

1. Create services at application startup, pass to handlers
2. Dependencies via options object (db, logger, config)
3. Fail fast on missing required dependencies
4. Include `health()` and `close()` methods for lifecycle management
5. Export interface and factory function

**Testing with Mocks:**

```typescript
import { describe, expect, it, vi } from "vitest";

describe("MyService", () => {
  it("should do work", async () => {
    const mockDb = { execute: vi.fn().mockResolvedValue([]) };
    const mockLogger = { info: vi.fn(), error: vi.fn() };

    const service = createMyService({
      db: mockDb as unknown as PostgresJsDatabase,
      logger: mockLogger as unknown as PinoLogger,
    });

    await service.doWork();
    expect(mockDb.execute).toHaveBeenCalled();
  });
});
```

## Testing

- Test files: `*.test.ts` next to source files
- Run single test: `npx vitest run path/to/file.test.ts`
- Vitest for unit tests, testcontainers planned for integration (v2.0)

### Test Structure

```typescript
import { describe, expect, it } from "vitest";

describe("ComponentName", () => {
  it("should do expected behavior", () => {
    // Arrange
    const input = createTestInput();

    // Act
    const result = component(input);

    // Assert
    expect(result).toEqual(expected);
  });
});
```

## Gotchas

### Temporal Workflows

- Workflows have serialization constraints - no closures, no classes
- Activities must be defined in separate files from workflows
- Use `proxyActivities` to import activities into workflows
- Workflow code must be deterministic (no Date.now(), Math.random())

### LangGraph State

- State must be serializable (JSON-safe objects only)
- Use reducers for state updates (not direct mutation)
- Checkpoint persistence requires PostgreSQL connection

### Docker Networking

- Internal services use Docker network names: `postgresql`, `temporal`
- External access (webhooks) via Cloudflare tunnels, not localhost
- Containers should not expose ports directly to host in production

### OAuth Tokens

- Linear OAuth tokens stored in PostgreSQL `integrations.credentials` table (encrypted)
- Run `npm run linear-oauth` to authenticate
- Requires `CREDENTIAL_ENCRYPTION_KEY` environment variable (generate with `openssl rand -hex 32`)

### npm Install

- Use `--legacy-peer-deps` due to LangChain peer dependency conflicts
- Example: `npm install <package> --legacy-peer-deps`

## v2.0 Foundation Work

Current milestone is v2.0 Foundation - full architectural restructure for maintainability.

### Phase 10: Foundation Setup (current)

- Biome linting/formatting (complete)
- dotenv-flow configuration (complete)
- Pre-commit hooks (complete)
- AI context files (.claude, .cursor)

### Upcoming Phases

- Phase 11: Logging consolidation (pino everywhere)
- Phase 12: Error handling patterns
- Phase 13: Testing infrastructure
- Phase 14+: See `.planning/ROADMAP.md`

### Key Changes Coming

- pnpm monorepo structure (complete)
- Centralized pino logging (complete)
- PostgreSQL-based credentials storage (complete)
- Result types for error handling (neverthrow)
