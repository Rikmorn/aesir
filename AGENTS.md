# Aesir

Agentic development platform that automates software workflows -- from feature request to shipped code. A Postgres-backed conversation executor with declarative agent definitions. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools.

## Working inside a package

Each package that has its own concerns carries a `CLAUDE.md` you read first when working there. A Task subagent picks one up on its own, on its first read of a file in that package -- not at dispatch. Sidekick's `sk-executor` does not: it reads a fixed list of paths (`./CLAUDE.md`, `./.claude/rules/*.md`, any `./.sidekick/decisions/*.md` whose name matches the task's surface area) and never opens a nested `CLAUDE.md` on its own. The root `CLAUDE.md` is a symlink to this file, so a session started inside a package sees this pointer block too. Even so, the task that sends a worker into a package should name that package's `CLAUDE.md`; if it didn't, read it anyway:

- `packages/agents/CLAUDE.md` -- the agent-first checklist, prompt rules, runtime gotchas
- `packages/dashboard/CLAUDE.md` -- the design system, UI skills, server/client boundary rules
- `packages/integrations/CLAUDE.md` -- the three services, MCP, OAuth, webhooks

Package READMEs are the implementation guides; `docs/reference/dev-harness.md` explains how guidance is layered and why.

## README Freshness

When modifying a package's public interface (new tools, changed APIs, updated setup), update its README to match. Package READMEs are referenced by agents as implementation guides -- stale docs cause wrong code.

## Sidekick Test Bench

This repo is built with [sidekick](https://github.com/Rikmorn/sidekick) (`/sk-design`, `/sk-build`, `/sk-review`) **and sidekick is under test here**. Treat it as a tool being evaluated, not an authority: be critical of how it works. Gaps, annoyances, bugs, confusing output, missing capabilities, and improvement ideas, whether noticed by Roberto or by an agent, go into `docs/superpowers/sidekick-testbench-log.md` (local-only, not committed) as they happen (date, who, what happened, why it matters, proposed disposition). At the end of a session we review the log together and file the entries that deserve it on `Rikmorn/sidekick`, one `area:*` label each, with a body that says what happened in aesir.

When sidekick blocks the work, or either of us is uncomfortable with how it is handling something, fall back to the superpowers workflow for that task and log it. The fallback is the record, not a failure.

Work tracking follows sidekick's PM conventions (`.claude/rules/sk-pm-conventions.md`): GitHub issues, milestones, and the aesir project board are the status surface; files keep content. Aesir adds optional `pkg:*` labels because it is a multi-workspace repo.

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
  qa-agent/           # QA verification (delegation-activated)
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

Signal types use domain language: `approval`, `pr_review`, `pr_merged`, `pr_closed`, `user_reply`, `cancel`.

## Directory Structure

```
packages/
|-- agents/                  # @aesir/agents - Unified agent service
|   |-- definitions/         # Agent YAML + prompt.md files (dir name = agent id)
|   |   |-- dev-agent/       # Development workflow orchestrator
|   |   |-- product-agent/   # Product conversation orchestrator
|   |   |-- qa-agent/        # QA verification (delegation-activated)
|   |   |-- coder/           # Code generation sub-agent
|   |   |-- researcher/      # Codebase research sub-agent
|   |   +-- tester/          # Test execution sub-agent
|   +-- src/
|       |-- adapters/        # Event normalization (linear, github, slack, pass-through)
|       |-- framework/       # Core runtime (executor, worker loop, event log, registry, signals)
|       |-- router/          # Event routing pipeline + router-specific tools
|       |-- service/         # Express entry point (main.ts)
|       +-- shared/
|           |-- agent-loop/  # LLM call + tool execution loop
|           |-- db/          # Database client, schema, migrations
|           |-- mcp/         # MCP HTTP client for integration calls
|           +-- tools/       # Agent tool factories by namespace
|               |-- codebase/      # read_file, search_codebase, list_directory, write_file, run_command
|               |-- communication/ # reply, ask, notify (agent-to-human)
|               |-- coordination/  # request_human_input, spawn_agent, wait_for
|               |-- directory/     # search_directory, get_agent_profile
|               |-- integration/   # linear, github, slack MCP wrappers
|               |-- knowledge/     # store_knowledge, search_knowledge
|               +-- task/          # create_task, complete_task, delegate_task, handoff_task, list_tasks
|-- integrations/            # Independent services, each with: api/, client/, db/, mcp/, oauth/, webhooks/
|   |-- linear/              # @aesir/integration-linear (port 3001, schema: linear.*)
|   |-- github/              # @aesir/integration-github (port 3002, schema: github.*)
|   +-- slack/               # @aesir/integration-slack (port 3003, schema: slack.*)
|-- dashboard/               # Next.js 15 operations dashboard (port 3005, basePath=/dashboard)
|   +-- src/
|       |-- app/             # App router pages (overview, conversations, tasks, agents, tools)
|       |-- components/      # React components grouped by domain (overview/, conversations/, tasks/, agents/, tools/, layout/, ui/)
|       |-- lib/             # Schema, API client, utilities
|       +-- services/        # Data access layer (typed functions over Postgres + agent-service API)
|-- platform/                # @aesir/platform - Config, database, logging, sandbox
|-- observability/           # @aesir/observability - Execution tracking (db/, services/)
|-- types/                   # @aesir/types - Domain types, Zod schemas, error classes
+-- test-utils/              # @aesir/test-utils - Vitest mocks, test factories
```

## Common Commands

**First-time setup:**
```bash
docker compose up -d postgresql       # Start database first
pnpm db:migrate                       # Run all migrations (REQUIRED -- schemas won't exist otherwise)
pnpm --filter @aesir/integration-linear seed:permissions
pnpm --filter @aesir/integration-github seed:permissions
pnpm --filter @aesir/integration-slack seed:permissions
docker compose up -d                  # Start all services
```

The `seed:permissions` and `migrate` scripts run under [bun](https://bun.sh), which must be on your PATH; pnpm remains the package manager and the Docker images stay on Node.

**Daily:** `docker compose up` (all services) | `docker compose up -d` (background) | `docker compose watch` (hot reload) | `docker compose down` (stop)

**Build/check:** `pnpm run build` | `pnpm run typecheck`

**Test:** `pnpm test` (all) | `pnpm test:fast` (no Docker) | `pnpm --filter @aesir/agents test:agents` (agent integration tests, requires `docker compose up`)

**Lint:** `pnpm run lint` | `pnpm run lint:fix` | `pnpm run format`

**Database schemas:** `platform.*`, `agents.*`, `observability.*`, `linear.*`, `github.*`, `slack.*` -- each package owns its schema. Migrations are NOT auto-run; "relation does not exist" errors mean you need `pnpm db:migrate`. `schema.drizzle.ts` retains old table definitions to prevent destructive DROP TABLE migrations -- do not clean it up.

## Code Patterns

### Environment Configuration

- **Env files:** Only `.env` (gitignored, real credentials) and `.env.example` (tracked, template). No per-environment files.
- Each service validates env at startup via Zod schema. Missing vars = immediate exit.
- **Scripts** (seed, migrate): `.env` is at monorepo root. Use `loadEnvFromRoot()` from `@aesir/platform` before accessing `process.env`.

### Integration Architecture

- **Agent code** calls integrations via `callMcpTool()` (HTTP/MCP) -- never import integration SDKs directly
- **Integration code** uses its own SDK clients (`@linear/sdk`, `@octokit/rest`, `@slack/bolt`)
- For MCP tool lists, endpoints, and `callMcpTool` usage, see `packages/agents/README.md`
- For integration-specific APIs, env vars, and code examples, see each integration's README

### Code Conventions

- **Logging:** Use `createPinoLogger` from `@aesir/platform` -- no `console.log` in production code
- **Validation:** Use Zod schemas at all external data boundaries (webhooks, API inputs, env vars)
- **Error handling:** Wrap external API calls in try/catch with logged context (`logger.error({ err, issueId }, "message")`)
- **Types:** Prefer explicit types for public signatures. Use `unknown` over `any`. Export types alongside implementations.

### Dependency Injection

Services use factory functions (not classes) with explicit dependencies:

1. Create services at application startup, pass to handlers
2. Dependencies via options object (db, logger, config)
3. Fail fast on missing required dependencies
4. Include `health()` and `close()` methods for lifecycle management
5. Export interface and factory function

## Testing

- **Unit tests:** `*.test.ts` next to source files. Run: `npx vitest run path/to/file.test.ts`
- **Agent integration tests:** LLM-evaluated scenarios at `packages/agents/scripts/agent-tests/`. See `packages/agents/README.md` for full details on scenarios, adding tests, and test agents.
- **Testing workflow:** Automated suite (`test:agents`) is the regression safety net. Manual exploratory testing with Claude is for investigating edge cases. When manual testing discovers an issue, codify it as a new scenario in the automated suite.

## Gotchas

### Docker Networking

- Internal services use Docker network names: `postgresql`, `linear-integration`, `github-integration`, `slack-integration`, `agent-service`
- External access (webhooks) via Cloudflare tunnels, not localhost
- Containers should not expose ports directly to host in production

### Package Imports

- Import integration code from `@aesir/integration-{linear,github,slack}` (never from SDKs directly)
- Platform utilities from `@aesir/platform`, shared types from `@aesir/types`, test utils from `@aesir/test-utils`
- Agent tools call integrations via `callMcpTool` (HTTP/MCP) -- agent package has NO integration SDK dependencies
- OAuth tokens stored encrypted in each integration's `*.credentials` table. Requires `CREDENTIAL_ENCRYPTION_KEY` env var.

## Historical Context

The project was built in eleven milestones between 2026-01-15 and 2026-02-23 and reset in 2026-09. The record lives under `docs/`:

- `docs/reference/design-vision.md` -- the principles and anti-patterns as they stand now
- `docs/adr/` -- the decisions that still bind, one file each
- `docs/history/` -- milestones, phases, every recorded decision, requirements, the milestone specs and per-milestone archives, frozen
- `docs/learnings/` -- post-mortems and lessons
- `docs/research/` -- the v3.x direction documents written before the retarget conversation
- `docs/backlog/` -- deferred directions and known debt, each naming its GitHub issue

`docs/README.md` explains the taxonomy. Work in flight is on the GitHub board, not in files.
