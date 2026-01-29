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
- Agents communicate with Integrations via HTTP/MCP (no direct imports)
- Integrations import from Platform only
- Platform imports nothing from Agents or Integrations
- Agents import from Platform and Types only

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

### Agent MCP Communication

Agents communicate with integrations via MCP HTTP protocol, not direct SDK clients.

**MCP Client:**
- Located: `packages/agents/src/shared/mcp/`
- Function: `callMcpTool(options)` - makes HTTP POST to /mcp/tools/:name
- Headers: X-Agent-ID (required), X-Correlation-ID (for tracing)
- Retry: Exponential backoff on 5xx/429, fail immediately on network errors

**MCP Endpoints:**
- Linear: http://linear-integration:3001/mcp/tools/:name
- GitHub: http://github-integration:3002/mcp/tools/:name
- Slack: http://slack-integration:3003/mcp/tools/:name

**Agent Configuration:**
- Agents do NOT require integration tokens (LINEAR_ACCESS_TOKEN, GITHUB_TOKEN, etc.)
- Agents only need: ANTHROPIC_API_KEY, workspace IDs (LINEAR_TEAM_ID, GITHUB_REPO)
- MCP URLs configurable via env (defaults to Docker network names)

**Note:** Both LangGraph nodes and Temporal activities use MCP for integration communication.

## Directory Structure

```
packages/
├── agents/              # @aesir/agents - Agent definitions
│   └── src/
│       ├── dev-agent/   # Development workflow automation
│       │   ├── api/     # HTTP handlers, webhooks, events
│       │   ├── code-workflow/  # Simple LangGraph code generation
│       │   │   ├── nodes/      # Workflow nodes
│       │   │   └── state/      # Workflow state
│       │   ├── nodes/   # HITL workflow nodes
│       │   ├── main.ts  # HTTP server entry
│       │   └── worker.ts # Temporal worker entry
│       ├── product-agent/ # Product conversation agent
│       │   ├── api/     # HTTP handlers
│       │   ├── nodes/   # LangGraph nodes
│       │   ├── slack/   # Slack-specific handlers
│       │   ├── main.ts  # HTTP server entry
│       │   └── worker.ts # Temporal worker entry
│       └── shared/      # Common infrastructure
│           ├── mcp/     # MCP client for integrations
│           ├── temporal/ # Workflows, activities, signals
│           ├── tracing/ # LangGraph execution tracing
│           ├── config/  # Agent configuration
│           ├── state/   # Shared state schemas
│           └── env/     # Environment validation
├── integrations/
│   ├── linear/          # @aesir/integration-linear (independent)
│   │   ├── src/
│   │   │   ├── api/     # HTTP routes (webhooks, OAuth)
│   │   │   ├── client/  # Linear SDK wrapper
│   │   │   ├── db/      # linear.* schema, credential store
│   │   │   ├── mcp/     # MCP server and tools
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
│   │   │   ├── mcp/     # MCP server and tools
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
│   │   │   ├── mcp/     # MCP server and tools
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
├── types/               # @aesir/types - Shared type definitions
│   └── src/
│       ├── errors/      # Error classes
│       └── types/       # Domain types, Zod schemas
└── test-utils/          # @aesir/test-utils - Test utilities
    └── src/             # Vitest mocks, test factories
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

## Agents Package (`@aesir/agents`)

The agents package follows an agent-centric organization with shared infrastructure.

### Dev Agent

Automates Linear issue resolution through multi-phase workflows:
- **HITL Workflow** (`graph.ts`): Full Temporal orchestration with approval gates
  - Receive issue → Research → Plan → Approval → Execute → PR → Review
- **Code Workflow** (`code-workflow/`): Lightweight LangGraph-only for simple tasks
  - Pickup task → Create branch → Generate code → Test → Commit PR

**Entry points:**
- `main.ts` - HTTP server (port 3004) for receiving events
- `worker.ts` - Temporal worker for workflow execution

### Product Agent

Handles Slack conversations to gather requirements and create Linear issues:
- Classify intent → Analyze requirements → Clarify → Confirm → Create tasks

**Entry points:**
- `main.ts` - HTTP server (port 3005) for receiving events
- `worker.ts` - Temporal worker for workflow execution

### Shared Infrastructure (`shared/`)

Common utilities used by all agents:
- **mcp/** - MCP client for integration communication (`callMcpTool`)
- **temporal/** - Workflows, activities, and signals
- **tracing/** - LangGraph execution tracing
- **config/** - Agent configuration utilities
- **state/** - Shared state schemas
- **env/** - Environment validation

## Common Commands

### Local Development (Docker Compose)

**First-time setup:**
```bash
docker compose up -d postgresql  # Start database first
pnpm db:migrate                  # Run all migrations (REQUIRED)
pnpm --filter @aesir/integration-github seed:permissions  # Seed MCP permissions
docker compose up -d             # Start all services
```

**Daily usage:**
```bash
docker compose up              # Start all services (PostgreSQL, Temporal, agents, integrations)
docker compose up -d           # Start in background
docker compose logs -f         # Follow all logs
docker compose watch           # Hot reload mode (rebuilds on file changes)
docker compose down            # Stop all services
```

### Infrastructure Only

```bash
docker compose up -d postgresql temporal temporal-ui  # Start infra without agents
```

### Integration Services

```bash
docker compose up linear-integration    # Start Linear integration only
docker compose up github-integration    # Start GitHub integration only
docker compose up slack-integration     # Start Slack integration only
```

### Access URLs

- PostgreSQL: localhost:5432
- Temporal gRPC: localhost:7233
- Temporal UI: http://localhost:8080
- Linear Integration: http://localhost:3001
- GitHub Integration: http://localhost:3002
- Slack Integration: http://localhost:3003
- Dev Agent: http://localhost:3004

### Development (Local)

```bash
pnpm run dev          # Start development server (tsx watch)
pnpm run build        # TypeScript compilation
pnpm run typecheck    # Type check without emit
```

### Agents

```bash
pnpm --filter @aesir/agents dev-agent      # Start dev-agent HTTP server
pnpm --filter @aesir/agents product-agent  # Start product-agent HTTP server
```

Entry points are in `src/{agent}/main.ts`. Workers are started separately via `worker.ts`.

### Testing

```bash
pnpm test                 # Run all tests
pnpm test:fast           # Skip integration tests (no Docker required)
pnpm test:integration    # Run integration tests only (requires testcontainers)
pnpm test:coverage       # Run with coverage report
```

### Code Quality

```bash
pnpm run lint         # Run Biome linting
pnpm run lint:fix     # Auto-fix lint issues
pnpm run format       # Format with Biome
```

### Infrastructure (Legacy)

```bash
npm run infra:up     # Start PostgreSQL + Temporal via Docker (prefer docker compose)
npm run infra:down   # Stop infrastructure
npm run infra:logs   # View infrastructure logs
```

### Database Setup

**IMPORTANT:** Database migrations must be run before using the system. Each integration package has its own PostgreSQL schema.

```bash
# Run ALL migrations (recommended for fresh setup)
pnpm db:migrate

# Run migrations for specific packages
pnpm db:migrate:platform      # platform.* schema
pnpm db:migrate:integrations  # integrations.* schema (legacy)
pnpm db:migrate:observability # observability.* schema
pnpm db:migrate:linear        # linear.* schema
pnpm db:migrate:github        # github.* schema
pnpm db:migrate:slack         # slack.* schema
```

**Database Schemas:**
| Schema | Package | Description |
|--------|---------|-------------|
| `platform` | @aesir/platform | Workspaces, configurations |
| `integrations` | @aesir/integrations | Legacy shared credentials |
| `observability` | @aesir/observability | Execution tracking |
| `linear` | @aesir/integration-linear | Linear credentials, webhooks, MCP permissions |
| `github` | @aesir/integration-github | GitHub credentials, webhooks, MCP permissions |
| `slack` | @aesir/integration-slack | Slack credentials, events, MCP permissions |

**Seed MCP Permissions:**
After migrations, seed default tool permissions for agents:

```bash
pnpm --filter @aesir/integration-linear seed:permissions
pnpm --filter @aesir/integration-github seed:permissions
pnpm --filter @aesir/integration-slack seed:permissions
```

**Migration Files Location:**
- Platform: `packages/platform/src/db/migrations/`
- Linear: `packages/integrations/linear/src/db/migrations/`
- GitHub: `packages/integrations/github/src/db/migrations/`
- Slack: `packages/integrations/slack/src/db/migrations/`

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

### MCP Layer

Each integration exposes an MCP (Model Context Protocol) server for standardized agent tool calls:

**Endpoints:**
- GET `/mcp/tools` - List available tools
- POST `/mcp/tools/:name` - Invoke a specific tool

**Headers:**
- `X-Correlation-ID` - Optional. Propagated to all logs and responses.
- `X-Agent-ID` - Required for tool invocation. Identifies the calling agent for permission checks.

**Ports:**
- Linear MCP: http://localhost:3001/mcp/*
- GitHub MCP: http://localhost:3002/mcp/*
- Slack MCP: http://localhost:3003/mcp/*

**Tool Permissions:**
Tool access is controlled via database-backed permissions (allow-list approach):
- Permissions stored in `{integration}.mcp_tool_permissions` table
- Check permissions with `checkLinearToolPermission`, `checkGitHubToolPermission`, `checkSlackToolPermission`
- Seed default permissions: `pnpm --filter @aesir/integration-{integration} seed:permissions`

**Available Tools:**

Linear:
- `get_issue` - Retrieve issue details
- `create_issue` - Create new issue
- `update_issue_status` - Change issue workflow state
- `list_teams` - List all teams
- `list_labels` - List labels (optionally by team)

GitHub:
- `get_repository` - Get repository info
- `create_branch` - Create a new branch
- `create_commit` - Create a commit with files
- `create_pull_request` - Open a PR
- `get_pull_request` - Get PR details
- `list_pull_requests` - List PRs
- `merge_pull_request` - Merge a PR
- `get_file_contents` - Read file content
- `list_files` - List directory contents

Slack:
- `send_message` - Send a message
- `send_approval_request` - Send approval buttons
- `get_message` - Retrieve a message
- `reply_to_thread` - Reply in a thread
- `list_channels` - List channels

**Example Tool Invocation:**
```bash
curl -X POST http://localhost:3001/mcp/tools/get_issue \
  -H "Content-Type: application/json" \
  -H "X-Agent-ID: dev-agent" \
  -H "X-Correlation-ID: req_abc123" \
  -d '{"issueId": "ABC-123"}'
```

**Rate Limiting:**
MCP endpoints are rate-limited to 100 requests per minute per agent (by X-Agent-ID header).

### Agent Usage of MCP

Agents call integration tools via the MCP client wrapper, not direct SDK imports.

```typescript
import { callMcpTool } from "@aesir/agents";

// Call Linear tool
const issue = await callMcpTool<{ title: string; status: string }>({
  integration: "linear",
  tool: "get_issue",
  params: { issueId: "ABC-123" },
  agentId: "dev-agent",
  correlationId: taskId,
});

// Call GitHub tool
await callMcpTool({
  integration: "github",
  tool: "create_branch",
  params: {
    owner: "my-org",
    repo: "my-repo",
    branch: "feature/new-auth",
    from: "main"
  },
  agentId: "dev-agent",
  correlationId: taskId,
});

// Call Slack tool
await callMcpTool({
  integration: "slack",
  tool: "send_message",
  params: {
    channel: "C1234567890",
    text: "PR created",
  },
  agentId: "dev-agent",
  correlationId: taskId,
});
```

**Important:** Both LangGraph nodes and Temporal activities use MCP for all integration communication.

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
- Shared types imported via `@aesir/types` (formerly `@aesir/common`)
- Test utilities imported via `@aesir/test-utils`

### Agent Integration Communication

- **LangGraph agent nodes**: Use `callMcpTool` from `@aesir/agents` (HTTP-based MCP protocol)
- **Temporal activities**: Use `callMcpTool` from `@aesir/agents` (HTTP-based MCP protocol)
- **Webhooks and API handlers**: Use integration packages directly (`@aesir/integration-*`)
- Agent package has NO SDK dependencies (`@linear/sdk`, `@octokit/rest` are NOT imported)
- Agents communicate with integrations via HTTP only - never direct imports

### npm Install

- Use `--legacy-peer-deps` due to LangChain peer dependency conflicts
- Example: `npm install <package> --legacy-peer-deps`

### Docker Watch Mode

- `docker compose watch` triggers rebuilds on source changes
- Rebuilds entire container (TypeScript compilation happens in Dockerfile)
- For faster iteration, run services locally with `tsx watch` instead
- Watch mode is opt-in; default `docker compose up` is stable without file watching

### Database Migrations

- **CRITICAL**: Run `pnpm db:migrate` before first use - schemas won't exist otherwise
- Each extracted integration has its own schema (`linear.*`, `github.*`, `slack.*`)
- MCP tool permissions require seeding after migration (see Database Setup section)
- Migrations are NOT run automatically by Docker Compose or on service startup
- If you get "relation does not exist" errors, you likely need to run migrations

## v2.0 Foundation Work

v2.0 Foundation is complete - full architectural restructure for maintainability.

### Completed Phases

- **Phase 10**: Foundation Setup (Biome, dotenv-flow, pre-commit hooks, AI context)
- **Phase 11**: Monorepo Setup (pnpm workspaces, TypeScript project references)
- **Phase 12**: Observability (pino logging, correlation IDs, Temporal adapter)
- **Phase 13**: Data Layer (Drizzle ORM, PostgreSQL schemas, credential encryption)
- **Phase 14**: Platform Services (ExecutionTracker, IdempotencyChecker, CursorStore)
- **Phase 15**: Code Quality (Result types, error handling, boundaries)
- **Phase 16**: Linear Extraction (independent package)
- **Phase 17**: GitHub Extraction (independent package)
- **Phase 18**: Slack Extraction (independent package)
- **Phase 19**: MCP Layer (Model Context Protocol for agent-integration communication)
- **Phase 20**: Testing Pyramid (testcontainers, MSW, test factories)
- **Phase 21**: CI/CD Pipeline (deferred to v3.0)
- **Phase 22**: Local Dev Environment (Docker Compose, health checks, watch mode)

### Integration Extraction Pattern

Phases 16-18 establish the pattern for extracting integrations into independent packages:

1. **Dedicated package** under `packages/integrations/{integration}/`
2. **Own database schema** (e.g., `linear.*`, `github.*`, `slack.*`)
3. **HTTP service** with Express server for webhooks and OAuth
4. **Credential management** via schema-specific store with encryption
5. **Dockerfile** for independent deployment

**Completed extractions:** Linear (Phase 16), GitHub (Phase 17), Slack (Phase 18)

### Key Achievements

- pnpm monorepo structure (complete)
- Centralized pino logging (complete)
- PostgreSQL-based credentials storage (complete)
- Result types for error handling (complete)
- Linear as independent package (complete)
- GitHub as independent package (complete)
- Slack as independent package (complete)
- MCP tool layer for all integrations (complete)
- Testing infrastructure with testcontainers (complete)
- Docker Compose local development (complete)

## v2.1 Codebase Cleanup

v2.1 focused on package consolidation and organization improvements.

### Completed Work

- **Package Rename**: `@aesir/common` → `@aesir/types` (clearer purpose)
- **Logging Consolidation**: Moved logging from common to `@aesir/platform`
- **Test Utils Extraction**: Created `@aesir/test-utils` for shared test utilities
- **Agents Restructure**: Agent-centric organization with shared infrastructure
  - `shared/` - MCP client, Temporal, tracing, config, state
  - `dev-agent/` - HITL workflow + code-workflow subdirectory
  - `product-agent/` - Conversation workflow + Slack handlers
- **Dead Code Removal**: Cleaned up unused exports and legacy code
