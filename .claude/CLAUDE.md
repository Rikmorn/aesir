# Aesir

Agentic development platform that automates software workflows - from feature request to shipped code. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools.

## Architecture

### 3-Layer Structure

```
Agents (dev-agent, product-agent)
   ↓ uses
Integrations (Linear, GitHub, Slack)
   ├── @aesir/integration-linear (independent package)
   ├── @aesir/integration-github (independent package)
   ├── @aesir/integration-slack (independent package)
   ├── @aesir/integrations (shared, legacy)
   ↓ uses
Platform (config, logging, state, temporal)
```

**Dependency rules:**
- Agents import from Integrations and Platform
- Integrations import from Platform only
- Platform imports nothing from Agents or Integrations
- Never import in the reverse direction

**Integration Extraction:**
Each integration is extracted to its own package for independent deployment, versioning, and lifecycle management. The extraction pattern enables:
- Independent HTTP services with their own database schemas
- Separate deployment and scaling decisions
- Clear package boundaries with explicit dependencies

**Extracted integrations:** Linear (Phase 16), GitHub (Phase 17), Slack (Phase 18).

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
packages/
├── agents/              # @aesir/agents - Agent definitions
│   └── src/
│       ├── dev-agent/   # Development workflow automation
│       └── product-agent/ # Product roadmap management
├── integrations/
│   ├── linear/          # @aesir/integration-linear (independent)
│   │   ├── src/
│   │   │   ├── api/     # HTTP routes (webhooks, OAuth)
│   │   │   ├── client/  # Linear SDK wrapper
│   │   │   ├── db/      # linear.* schema, credential store
│   │   │   ├── oauth/   # Token management
│   │   │   ├── webhooks/ # Signature verification, parsing
│   │   │   ├── types/   # Config, errors
│   │   │   ├── index.ts # Barrel export
│   │   │   └── main.ts  # HTTP server entry
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── github/          # @aesir/integration-github (independent)
│   │   ├── src/
│   │   │   ├── api/     # HTTP routes (webhooks, OAuth)
│   │   │   ├── client/  # Octokit client factory
│   │   │   ├── db/      # github.* schema, credential store
│   │   │   ├── oauth/   # Token management
│   │   │   ├── operations/ # Branch, commit, PR operations
│   │   │   ├── webhooks/ # Signature verification, parsing
│   │   │   ├── types/   # Config, errors
│   │   │   ├── index.ts # Barrel export
│   │   │   └── main.ts  # HTTP server entry
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── slack/           # @aesir/integration-slack (independent)
│   │   ├── src/
│   │   │   ├── api/     # HTTP routes (events, OAuth)
│   │   │   ├── client/  # Bolt app factory, WebClient
│   │   │   ├── db/      # slack.* schema, credential store
│   │   │   ├── events/  # Event handling with deduplication
│   │   │   ├── messages/ # Block Kit builders, message posting
│   │   │   ├── oauth/   # Token management
│   │   │   ├── types/   # Config, errors
│   │   │   ├── index.ts # Barrel export
│   │   │   └── main.ts  # HTTP server entry
│   │   ├── Dockerfile
│   │   └── package.json
│   └── src/             # @aesir/integrations - shared, legacy
│       ├── _legacy/     # Old Linear/GitHub/Slack code (deprecated)
│       └── index.ts     # Re-exports
├── platform/            # @aesir/platform - Core services
│   └── src/
│       ├── config/      # Configuration and environment
│       ├── db/          # Database connection, migrations
│       ├── logging/     # Pino-based logging
│       └── sandbox/     # Docker sandbox for code execution
├── observability/       # @aesir/observability - Execution tracking
│   └── src/
│       ├── db/          # observability.* schema
│       └── services/    # ExecutionTracker, IdempotencyChecker
└── common/              # @aesir/common - Shared types
    └── src/
        ├── errors/      # Error classes
        ├── types/       # Domain types
        └── state/       # LangGraph state definitions
```

## Integration Packages

Independent integration packages in `packages/integrations/`:

### Linear (`@aesir/integration-linear`)
- Location: `packages/integrations/linear/`
- Port: 3001
- Database schema: `linear.*`
- Webhook secret env: `LINEAR_WEBHOOK_SECRET`
- Client: Linear SDK via `@linear/sdk`

### GitHub (`@aesir/integration-github`)
- Location: `packages/integrations/github/`
- Port: 3002
- Database schema: `github.*`
- Webhook secret env: `GITHUB_WEBHOOK_SECRET`
- Client: `@octokit/rest` for API operations
- Webhook verification: `@octokit/webhooks-methods` (timing-safe)

### Slack (`@aesir/integration-slack`)
- Location: `packages/integrations/slack/`
- Port: 3003
- Database schema: `slack.*`
- Signing secret env: `SLACK_SIGNING_SECRET`
- Client: `@slack/bolt` for Slack app framework
- Modes: Socket Mode (development) or HTTP (production)
- OAuth storage: PostgreSQL via Bolt's installationStore

Each integration:
- Self-contained environment validation (own .env, Zod schema)
- Own database schema namespace (isolated data)
- HTTP API (webhooks, OAuth, health check)
- Can be deployed independently via Docker

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

### Linear Integration

For Linear functionality, import from the dedicated package:

```typescript
// Linear is extracted to its own package
import {
  createLinearClientFromDatabase,
  verifyWebhookSignature,
  emitThought,
} from "@aesir/integration-linear";

// Use the factory to create a client with DB-backed credentials
const client = await createLinearClientFromDatabase({
  workspaceId: "ws_default",
  db,
  logger,
});

// Verify webhook signatures
const isValid = await verifyWebhookSignature({
  body: rawBody,
  signature: headers["linear-signature"],
  secret: config.linear.webhookSigningSecret,
});
```

### GitHub Integration

For GitHub functionality, import from the dedicated package:

```typescript
// GitHub is extracted to its own package
import {
  createGitHubClientFromDatabase,
  createBranch,
  createCommit,
  createPR,
} from "@aesir/integration-github";

// Use the factory to create a client with DB-backed credentials
const client = await createGitHubClientFromDatabase({
  owner: "my-org",
  db,
  logger,
});

// Verify webhook signatures (timing-safe)
import { verifyWebhookRequest } from "@aesir/integration-github";
const { isValid, deliveryId, eventType } = await verifyWebhookRequest({
  body: rawBody,
  signature: headers["x-hub-signature-256"],
  secret: config.github.webhookSecret,
});

// Re-export from @aesir/integrations for backward compatibility
import { createGitHubClient, createBranch } from "@aesir/integrations";
```

### Slack Integration

For Slack functionality, import from the dedicated package:

```typescript
// Slack is extracted to its own package
import {
  createBoltApp,
  createSlackClientFromDatabase,
  sendApprovalRequest,
  buildApprovalBlocks,
} from "@aesir/integration-slack";

// Create Bolt app with database-backed OAuth
const app = await createBoltApp({
  db,
  logger,
  socketMode: true, // or false for HTTP mode
});

// Create WebClient from database credentials
const client = await createSlackClientFromDatabase({
  teamId: "T1234567890",
  credentialStore,
  logger,
});

// Send approval request with Block Kit
await sendApprovalRequest(client, {
  type: "approval_needed",
  taskId: "ABC-123",
  prUrl: "https://github.com/org/repo/pull/42",
  title: "feat: Add user authentication",
  summary: "Implements JWT-based auth",
}, "C1234567890");

// Re-export from @aesir/integrations for backward compatibility
import { sendSlackNotification } from "@aesir/integrations";
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

- Linear OAuth tokens stored in PostgreSQL `linear.credentials` table (encrypted)
- GitHub OAuth tokens stored in PostgreSQL `github.credentials` table (encrypted)
- Slack OAuth tokens stored in PostgreSQL `slack.credentials` table (encrypted)
- Each integration uses its own database schema (`linear.*`, `github.*`, `slack.*`)
- Run `npm run linear-oauth` or `npm run github-oauth` to authenticate
- Slack uses Bolt's built-in OAuth flow with PostgreSQL installationStore
- Requires `CREDENTIAL_ENCRYPTION_KEY` environment variable (generate with `openssl rand -hex 32`)

### Package Imports

- Import Linear from `@aesir/integration-linear`, not from `@aesir/integrations`
- Import GitHub from `@aesir/integration-github`, not from `@aesir/integrations`
- Import Slack from `@aesir/integration-slack`, not from `@aesir/integrations`
- Each extracted integration has its own package scope and dependencies
- `@aesir/integrations` maintains re-exports for backward compatibility
- Platform utilities imported via `@aesir/platform`
- Shared types imported via `@aesir/common`

### npm Install

- Use `--legacy-peer-deps` due to LangChain peer dependency conflicts
- Example: `npm install <package> --legacy-peer-deps`

## v2.0 Foundation Work

Current milestone is v2.0 Foundation - full architectural restructure for maintainability.

### Completed Phases

- **Phase 10**: Foundation Setup (Biome, dotenv-flow, pre-commit hooks, AI context)
- **Phase 11**: Monorepo Setup (pnpm workspaces, TypeScript project references)
- **Phase 12**: Observability (pino logging, correlation IDs, Temporal adapter)
- **Phase 13**: Data Layer (Drizzle ORM, PostgreSQL schemas, credential encryption)
- **Phase 14**: Platform Services (ExecutionTracker, IdempotencyChecker, CursorStore)
- **Phase 15**: Code Quality (Result types, error handling, boundaries)
- **Phase 16**: Linear Extraction (independent package)
- **Phase 17**: GitHub Extraction (independent package)
- **Phase 18**: Slack Extraction (independent package) - **Current**

### Integration Extraction Pattern

Phases 16-18 establish the pattern for extracting integrations into independent packages:

1. **Dedicated package** under `packages/integrations/{integration}/`
2. **Own database schema** (e.g., `linear.*`, `github.*`, `slack.*`)
3. **HTTP service** with Express server for webhooks and OAuth
4. **Credential management** via schema-specific store with encryption
5. **Dockerfile** for independent deployment

**Completed extractions:** Linear (Phase 16), GitHub (Phase 17), Slack (Phase 18)

### Upcoming Phases

- Phase 17+: See `.planning/ROADMAP.md`

### Key Achievements

- pnpm monorepo structure (complete)
- Centralized pino logging (complete)
- PostgreSQL-based credentials storage (complete)
- Result types for error handling (complete)
- Linear as independent package (complete)
- GitHub as independent package (complete)
- Slack as independent package (complete)
