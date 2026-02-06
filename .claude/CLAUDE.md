# Aesir

Agentic development platform that automates software workflows -- from feature request to shipped code. A Postgres-backed conversation executor with declarative agent definitions. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools.

## MANDATORY: Agent-First Decision Checklist

Before modifying ANY file in `packages/agents/definitions/` or `packages/agents/src/framework/`, apply these checks:

1. **Is this agent behavior or infrastructure?**
   - Agent behavior (HOW to communicate, WHAT to decide, WHEN to act) --> Fix via **prompt or tool changes**, NOT framework code
   - Infrastructure (timeouts, retries, signal handling, conversation lifecycle) --> OK as framework code

2. **Am I pattern-matching on agent output to add behavior?**
   - If your code inspects agent results to decide what to do next (e.g., `if (result.field)` --> call Slack/Linear/GitHub), that's an anti-pattern. The AGENT should make that decision via its tools during its loop.

3. **Could this logic live in the system prompt instead?**
   - If the agent has the tools to do it and just isn't doing it, the fix is a prompt change, not a code change. Prompt fixes are cheaper, more flexible, and let the agent adapt to context.

Violations create brittle systems where the wrapper code fights the agent for control.

### Agent-First Problem Solving

When an agent makes a wrong decision, fix the agent -- don't add deterministic overrides.

**The principle:** Agents reason about their environment through tools and context. When something goes wrong, the fix should be:
1. **Better prompts** -- give the agent clearer instructions for the scenario
2. **Better tools** -- give the agent the ability to detect and handle the situation
3. **Better context** -- give the agent more information to make good decisions

**Anti-patterns to avoid:**
- Adding `if/else` logic in framework code that overrides the agent's decision
- Hardcoding error recovery paths that the agent should handle via reasoning
- Pattern-matching on agent output to "correct" it in executor code
- Moving classification logic out of the LLM into deterministic rules (unless the event is genuinely unambiguous -- see fast-path criteria below)

**When deterministic logic IS appropriate:**
- **Fast-path routing**: Events that are genuinely unambiguous (e.g., `linear.agent_session.created` always starts dev-agent). The test: "would every reasonable person route this the same way?"
- **Infrastructure concerns**: Timeouts, max iteration limits, heartbeat management, conversation lifecycle -- these are executor domain, not the agent's
- **Data validation**: Schema validation at system boundaries (Zod), not semantic validation of agent decisions

### Writing Agent Prompts

**Full guide: `packages/agents/definitions/PROMPT_GUIDE.md`** — read it before writing or reviewing any prompt.

Prompts are the primary control surface for agent behavior. These rules apply when writing or modifying any `prompt.md` file:

**Goal-oriented, not procedure-oriented:**
- Describe WHAT the agent should achieve and the JUDGMENT CRITERIA for decisions -- not step-by-step procedures
- Bad: "IF clear request THEN 1. search issues 2. draft issue 3. call wait_for 4. emit phase tag"
- Good: "Your goal is to turn user requests into well-structured Linear issues. Search for duplicates when relevant. Confirm with the user before creating. Use your judgment on how much clarification is needed."
- The agent decides the tool sequence based on reasoning, not because the prompt prescribed it

**No state machines in natural language:**
- Never encode if/then/else branching trees that classify input and prescribe different tool sequences per branch
- If behavior genuinely must be deterministic (e.g., always search before creating), put it in executor code where it's testable -- not in a prompt where it'll be followed inconsistently
- State machines in Markdown are the worst of both worlds: unreliable like an LLM, inflexible like code

**Judgment criteria over rigid rules:**
- Instead of "SIMPLE TASKS: skip research" / "COMPLEX TASKS: get approval", describe what makes something risky and let the agent calibrate
- Bad: "MUST always call wait_for after drafting" -- this removes agent judgment about when confirmation is needed
- Good: "Confirm with the user before creating issues, especially when requirements are ambiguous or the scope is large"

**Minimize directive density:**
- Every MUST/ALWAYS/NEVER/IMPORTANT is a place where you're overriding the agent's reasoning. Each one should earn its place.
- Reserve strong directives for genuine safety boundaries (don't delete production data, don't merge without tests)
- For behavioral guidance, prefer "prefer X" or "tend toward X" over "MUST do X" -- this lets the agent adapt to edge cases

**Trust the model:**
- LLMs are good at reasoning about intent, context, and appropriate responses. Encoding "if user says 'yes'/'looks good'/'go ahead' then proceed" is doing work the model already does natively.
- Give the agent context about why something matters rather than rules about what to do. An agent that understands why will handle novel situations; an agent following rules will break on the first edge case.

## Architecture

### Overview

Aesir uses a Postgres-backed ConversationExecutor with declarative YAML agent definitions. This is the natural conclusion of agent-first principles -- rather than orchestrating agents through external workflow engines, the agents manage their own state through tools and conversation history, persisted directly in PostgreSQL.

**Core runtime components:**
- **ConversationExecutor**: Creates, claims (SKIP LOCKED), runs, pauses, and resumes agent conversations
- **WorkerLoop**: Polls for claimable conversations and executes them concurrently
- **EventLog**: Append-only buffered event recording with subscriber notifications
- **HistoryManager**: Compacts long conversations (prunes old tool results, summarizes via Haiku)
- **AgentRegistry**: Loads and caches YAML + prompt.md definitions from disk
- **ToolRegistry**: Maps `namespace:tool_name` references to factory functions
- **EventRouter**: Matches incoming events to agent triggers (start or signal)
- **TimeoutScheduler**: pg-boss delayed signal delivery for wait_for timeouts
- **SessionProjection**: Reactively updates agent_sessions from event log

**Entry point:** `service/main.ts` -- single Express server that bootstraps all components and starts the worker loop.

### 3-Layer Structure

```
Agents (definitions/ + framework/)
   |  uses
Integrations (Linear, GitHub, Slack)
   |-- @aesir/integration-linear (independent package)
   |-- @aesir/integration-github (independent package)
   |-- @aesir/integration-slack (independent package)
   |  uses
Platform (config, logging, database, sandbox)
```

**Dependency rules:**
- Agents communicate with Integrations via HTTP/MCP (no direct imports)
- Integrations import from Platform only
- Platform imports nothing from Agents or Integrations
- Agents import from Platform and Types only

### Agent Definitions

Agents are declared in YAML with a companion Markdown prompt file:

```
definitions/
  dev-agent/
    definition.yaml   # Model, tools, triggers, history config
    prompt.md          # System prompt (raw LLM-visible text)
  product-agent/
    definition.yaml
    prompt.md
  coder/              # Sub-agent for code generation
  researcher/         # Sub-agent for codebase research
  tester/             # Sub-agent for test execution
```

**definition.yaml fields:**
- `id`, `name`, `description`, `version` -- identity
- `model`, `temperature` -- LLM configuration
- `tools` -- list of `namespace:tool_name` references (e.g., `linear:get_issue`)
- `subAgents` -- role-to-agent-ID mapping for spawning sub-agents
- `maxIterations`, `tokenBudget` -- execution limits
- `history` -- pruneThreshold, protectedMessages, summaryThreshold, summaryModel
- `triggers` -- events that start this agent (e.g., `linear.agent_session.created`)

**prompt.md:** Contains the raw system prompt text. Not TypeScript, not escaped -- the file content IS the prompt.

**To add a new agent:**
1. Create `definitions/{agent-id}/definition.yaml` with the Zod-validated schema
2. Create `definitions/{agent-id}/prompt.md` with the system prompt
3. The AgentRegistry auto-discovers it (directory name must match `id` field)

### ConversationExecutor Flow

```
IncomingEvent --> EventRouter --> start() or signal()
                                     |
                          ConversationExecutor
                           |              |
                      start()          signal()
                        |                |
                  Create row        Resume or queue
                  status=queued     the signal
                        |
                  WorkerLoop claims (SKIP LOCKED)
                        |
                  Load definition + resolve tools
                        |
                  Run agent loop (LLM + tools)
                        |
            +-----------+-----------+
            |           |           |
        end_turn    wait_for    error
            |           |           |
        completed    waiting    retry/failed
```

**Key behaviors:**
- `start()` is idempotent: same correlationKey returns the same conversation ID
- Conversations are claimed with `FOR UPDATE SKIP LOCKED` -- no two workers process the same conversation
- Heartbeats detect stale claims from crashed workers
- `wait_for` tool pauses the conversation and optionally schedules a timeout via pg-boss
- Signals resume waiting conversations or are queued for later delivery
- HistoryManager compacts messages when token count exceeds thresholds

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

### Event Routing

Events flow through adapters and the EventRouter:

1. **Integration webhooks** (Linear, GitHub, Slack) emit `NormalizedEvent` to `POST /events`
2. **Adapters** (`adapters/`) normalize integration-specific payloads into `IncomingEvent`
3. **EventRouter** matches against agent trigger rules:
   - `start` -- creates a new conversation for a matching agent
   - `signal` -- delivers a signal to an existing conversation (approval, PR review, etc.)
   - `ignore` -- known events to skip (e.g., agent's own issue updates)
   - `slow_path` -- ambiguous events routed to LLM for classification

Signal types use domain language: `approval`, `pr_review`, `pr_merged`, `pr_closed`.

## Directory Structure

```
packages/
|-- agents/                  # @aesir/agents - Unified agent service
|   |-- definitions/         # Agent YAML + prompt.md files
|   |   |-- dev-agent/       # Development workflow agent
|   |   |-- product-agent/   # Product conversation agent
|   |   |-- coder/           # Code generation sub-agent
|   |   |-- researcher/      # Codebase research sub-agent
|   |   +-- tester/          # Test execution sub-agent
|   +-- src/
|       |-- adapters/        # Event normalization (linear, github, slack, pass-through)
|       |-- framework/       # Core runtime
|       |   |-- agent-registry.ts       # YAML definition loader with mtime cache
|       |   |-- conversation-executor.ts # SKIP LOCKED conversation lifecycle
|       |   |-- event-log.ts            # Buffered append-only event recording
|       |   |-- event-router.ts         # Event-to-agent trigger matching
|       |   |-- history-manager.ts      # Message compaction + summarization
|       |   |-- session-projection.ts   # Reactive agent_sessions updates
|       |   |-- timeout-scheduler.ts    # pg-boss delayed signal delivery
|       |   |-- tool-factories.ts       # Registers all 28 tool factories
|       |   |-- tool-registry.ts        # namespace:tool_name resolution
|       |   |-- wait-for-tool.ts        # Pause/resume via wait_for
|       |   |-- worker-loop.ts          # Poll + execute queued conversations
|       |   +-- types.ts                # Framework interfaces and Zod schemas
|       |-- router/          # Event routing pipeline
|       |   |-- router.ts              # Main route dispatcher
|       |   |-- slow-path.ts           # LLM-based event classification
|       |   |-- system-prompt.ts       # Router agent prompt
|       |   +-- tools/                 # Router-specific tools
|       |       |-- query-conversations.ts
|       |       |-- send-message.ts
|       |       |-- signal-conversation.ts
|       |       +-- start-conversation.ts
|       |-- service/         # Unified HTTP entry point
|       |   +-- main.ts               # Express server, bootstrap, graceful shutdown
|       +-- shared/          # Shared utilities
|           |-- agent-loop/  # Core agent loop runtime (LLM call + tool execution)
|           |-- config/      # Agent configuration utilities
|           |-- db/          # Database client, schema, migrations
|           |-- env/         # Environment validation (Zod)
|           |-- mcp/         # MCP client for integration communication
|           +-- tools/       # Reusable tool factories
|               |-- codebase/      # read_file, search_codebase, list_directory, write_file, run_command
|               |-- coordination/  # request_human_input, (spawn_agent, wait_for via framework)
|               +-- integration/   # linear, github, slack MCP wrappers
|-- integrations/
|   |-- linear/              # @aesir/integration-linear (independent, port 3001)
|   |   +-- src/
|   |       |-- api/         # HTTP routes (webhooks, OAuth)
|   |       |-- client/      # Linear SDK wrapper
|   |       |-- db/          # linear.* schema, credential store
|   |       |-- mcp/         # MCP server and tools
|   |       |-- oauth/       # Token management
|   |       |-- webhooks/    # Signature verification, parsing
|   |       +-- types/       # Config, errors
|   |-- github/              # @aesir/integration-github (independent, port 3002)
|   |   +-- src/
|   |       |-- api/         # HTTP routes (webhooks, OAuth)
|   |       |-- client/      # Octokit client factory
|   |       |-- db/          # github.* schema, credential store
|   |       |-- mcp/         # MCP server and tools
|   |       |-- oauth/       # Token management
|   |       |-- operations/  # Branch, commit, PR operations
|   |       |-- webhooks/    # Signature verification, parsing
|   |       +-- types/       # Config, errors
|   +-- slack/               # @aesir/integration-slack (independent, port 3003)
|       +-- src/
|           |-- api/         # HTTP routes (events, OAuth)
|           |-- client/      # Bolt app factory, WebClient
|           |-- db/          # slack.* schema, credential store
|           |-- events/      # Event handling with deduplication
|           |-- mcp/         # MCP server and tools
|           |-- messages/    # Block Kit builders, message posting
|           |-- oauth/       # Token management
|           +-- types/       # Config, errors
|-- platform/                # @aesir/platform - Core services
|   +-- src/
|       |-- config/          # Configuration and environment
|       |-- db/              # Database connection, migrations
|       |-- logging/         # Pino-based logging
|       +-- sandbox/         # Docker sandbox for code execution
|-- observability/           # @aesir/observability - Execution tracking
|   +-- src/
|       |-- db/              # observability.* schema
|       +-- services/        # ExecutionTracker, IdempotencyChecker
|-- types/                   # @aesir/types - Shared type definitions
|   +-- src/
|       |-- errors/          # Error classes
|       +-- types/           # Domain types, Zod schemas
+-- test-utils/              # @aesir/test-utils - Test utilities
    +-- src/                 # Vitest mocks, test factories
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

### Local Development (Docker Compose)

**First-time setup:**
```bash
docker compose up -d postgresql       # Start database first
pnpm db:migrate                       # Run all migrations (REQUIRED)
pnpm --filter @aesir/integration-linear seed:permissions
pnpm --filter @aesir/integration-github seed:permissions
pnpm --filter @aesir/integration-slack seed:permissions
docker compose up -d                  # Start all services
```

**Daily usage:**
```bash
docker compose up              # Start all services (PostgreSQL, integrations, agent-service)
docker compose up -d           # Start in background
docker compose logs -f         # Follow all logs
docker compose watch           # Hot reload mode (rebuilds on file changes)
docker compose down            # Stop all services
```

### Infrastructure Only

```bash
docker compose up -d postgresql  # Start database without application services
```

### Integration Services

```bash
docker compose up linear-integration    # Start Linear integration only
docker compose up github-integration    # Start GitHub integration only
docker compose up slack-integration     # Start Slack integration only
```

### Agent Service

```bash
docker compose up agent-service   # Start the unified agent service only
```

### Access URLs

- PostgreSQL: localhost:5432
- Linear Integration: http://localhost:3001
- GitHub Integration: http://localhost:3002
- Slack Integration: http://localhost:3003
- Agent Service: http://localhost:3004

### Development (Local)

```bash
pnpm run build        # TypeScript compilation
pnpm run typecheck    # Type check without emit
```

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

### Database Setup

**IMPORTANT:** Database migrations must be run before using the system. Each package has its own PostgreSQL schema.

```bash
# Run ALL migrations (sequential, respects workspace dependency order)
pnpm db:migrate

# Run migration for a specific package
pnpm --filter @aesir/platform db:migrate
pnpm --filter @aesir/agents db:migrate
```

**Database Schemas:**
| Schema | Package | Description |
|--------|---------|-------------|
| `platform` | @aesir/platform | Workspaces, configurations |
| `agents` | @aesir/agents | Conversations, agent_events, agent_sessions |
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
- Agents: `packages/agents/src/shared/db/migrations/`
- Linear: `packages/integrations/linear/src/db/migrations/`
- GitHub: `packages/integrations/github/src/db/migrations/`
- Slack: `packages/integrations/slack/src/db/migrations/`

## Code Patterns

### Environment Configuration

**Env files:** Only `.env` (gitignored, real credentials) and `.env.example` (tracked, template). dotenv-flow loads `.env` at startup. No per-environment files (`.env.development`, `.env.test`, etc.).

Each service validates its environment at startup via a Zod schema. Missing or invalid variables cause immediate process exit with clear error messages.

```typescript
// Entry point - env must be first
import "./shared/env/config.js";
import { config } from "./shared/env/config.js";

// Use typed config object
const apiKey = config.anthropic.apiKey;
const dbUrl = config.database.url;
```

**Scripts (seed, migrate):** Scripts run from package directories via `pnpm --filter`, but `.env` is at the monorepo root. Use `loadEnvFromRoot()` from `@aesir/platform` to load env vars correctly:

```typescript
#!/usr/bin/env tsx
import { loadEnvFromRoot } from "@aesir/platform";
loadEnvFromRoot(); // Must be called before accessing process.env

// Now process.env has vars from root .env
const dbUrl = process.env.DATABASE_URL;
```

### Linear Integration

For Linear functionality, import from the dedicated package:

```typescript
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
```

### Slack Integration

For Slack functionality, import from the dedicated package:

```typescript
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
- `search_issues` - Search issues by text query
- `create_comment` - Create comment on an issue

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

Use pino logger from `@aesir/platform` - no `console.log` in production code:

```typescript
import { createPinoLogger } from "@aesir/platform";

const logger = createPinoLogger({ component: "agent-service" });
const childLogger = logger.child({ conversationId: "conv_123" });
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
- Vitest for unit tests, testcontainers for integration tests

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

### Agent Definitions

- Agent definitions use YAML + prompt.md, NOT TypeScript code
- The `id` field in definition.yaml MUST match the directory name
- The `version` field must be a string (YAML coerces unquoted numbers like `1.0` to floats)
- prompt.md contains raw LLM-visible text -- no escaping, no TypeScript encoding
- Sub-agent `tokenBudget` in YAML is the standalone value; the executor overrides it with the parent's shared budget when spawning

### ConversationExecutor

- `start()` is idempotent: same correlationKey deterministically produces the same conversation ID
- Conversations are claimed with `FOR UPDATE SKIP LOCKED` -- no two workers process the same conversation
- Ownership is verified after the agent loop before persisting results -- prevents split-brain writes
- Non-retryable errors (TokenBudgetExhaustedError, AgentAbortedError) skip the retry loop

### EventLog

- `append()` is synchronous (buffered) -- call `flush()` at lifecycle boundaries (pause, complete, fail)
- `initSequence()` MUST be called before the first `append()` for a conversation
- Gapless per-conversation sequences are safe because only one loop runs per conversation at a time
- Subscriber notifications happen in-memory before persistence (fire-and-forget)

### History Manager

- Compacts messages when token count exceeds `pruneThreshold` (default 80,000 tokens)
- Old tool results beyond `protectedMessages` are truncated to summaries
- Summarization uses a cheaper model (Haiku) via `summaryModel` config
- Summaries are wrapped in `<summary></summary>` tags for detection
- Single-summary-block-with-merge strategy prevents summaries-of-summaries degradation
- Falls back to pruned result if summarization fails

### WaitForState and Signals

- `wait_for` tool creates a pending wait that the executor intercepts
- Uses mutable flag pattern (not exceptions) so the LLM sees confirmation and generates clean end_turn
- Signals use domain-language types: `approval`, `pr_review`, `pr_merged`, `pr_closed`
- Signal deduplication via optional `deduplicationId` stored in `delivered_signal_ids` JSONB array
- Worker loop re-reads queued_signals after wait_for triggers and auto-resumes if a matching signal exists

### Tool Separation

- **Router tools** (`router/tools/`): Used by the event routing LLM -- `query_conversations`, `send_message`, `signal_conversation`, `start_conversation`
- **Agent tools** (`shared/tools/`): Used by agents -- `codebase:*`, `coordination:*`, `integration:*`
- These are separate sets registered in different contexts

### Docker Networking

- Internal services use Docker network names: `postgresql`, `linear-integration`, `github-integration`, `slack-integration`, `agent-service`
- External access (webhooks) via Cloudflare tunnels, not localhost
- Containers should not expose ports directly to host in production

### OAuth Tokens

- Linear OAuth tokens stored in PostgreSQL `linear.credentials` table (encrypted)
- GitHub OAuth tokens stored in PostgreSQL `github.credentials` table (encrypted)
- Slack OAuth tokens stored in PostgreSQL `slack.credentials` table (encrypted)
- Each integration uses its own database schema (`linear.*`, `github.*`, `slack.*`)
- OAuth flows available via integration HTTP endpoints (e.g., `/linear/oauth/authorize`)
- Slack uses Bolt's built-in OAuth flow with PostgreSQL installationStore
- Requires `CREDENTIAL_ENCRYPTION_KEY` environment variable (generate with `openssl rand -hex 32`)

### Package Imports

- Import Linear from `@aesir/integration-linear`
- Import GitHub from `@aesir/integration-github`
- Import Slack from `@aesir/integration-slack`
- Platform utilities imported via `@aesir/platform`
- Shared types imported via `@aesir/types`
- Test utilities imported via `@aesir/test-utils`

### Agent Integration Communication

- Agent tools call integrations via `callMcpTool` from `@aesir/agents` (HTTP-based MCP protocol)
- Webhook and API handlers in integration packages use their own SDK clients directly
- Agent package has NO integration SDK dependencies (`@linear/sdk`, `@octokit/rest` are NOT imported)
- Agents communicate with integrations via HTTP only -- never direct imports

### Docker Watch Mode

- `docker compose watch` triggers rebuilds on source changes
- Rebuilds entire container (TypeScript compilation happens in Dockerfile)
- For faster iteration, run services locally with `tsx watch` instead
- Watch mode is opt-in; default `docker compose up` is stable without file watching

### Database Migrations

- **CRITICAL**: Run `pnpm db:migrate` before first use -- schemas won't exist otherwise
- Each integration has its own schema (`linear.*`, `github.*`, `slack.*`)
- Agents have their own schema (`agents.*` -- conversations, agent_events, agent_sessions)
- MCP tool permissions require seeding after migration (see Database Setup section)
- Migrations are NOT run automatically by Docker Compose or on service startup
- If you get "relation does not exist" errors, you likely need to run migrations
- `schema.drizzle.ts` retains old table definitions to prevent destructive DROP TABLE migrations -- do not clean it up

## Historical Context

Historical project context (milestones, architectural decisions, evolution from v1 through v2.0/v2.1/v2.2 to v2.3) is maintained in the `.planning/` directory. This includes phase plans, research documents, summaries, and the full decision log.
