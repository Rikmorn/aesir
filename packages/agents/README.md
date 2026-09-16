# @aesir/agents

Unified agent service that automates software development workflows.

## Architecture

Single service with declarative agent definitions and a Postgres-backed conversation executor:

```
packages/agents/
├── definitions/     # Agent YAML + prompt.md files
│   ├── dev-agent/   # Development workflow orchestrator
│   ├── product-agent/ # Product conversation orchestrator
│   ├── qa-agent/    # QA verification (delegation-activated)
│   ├── coder/       # Code generation sub-agent
│   ├── researcher/  # Codebase research sub-agent
│   └── tester/      # Test execution sub-agent
├── src/
│   ├── adapters/    # Event normalization (Linear, GitHub, Slack)
│   ├── framework/   # Core runtime (executor, worker, event log, history)
│   ├── router/      # Event routing pipeline
│   ├── service/     # Unified HTTP entry point
│   └── shared/      # MCP client, agent loop, tools, config
│       └── tools/   # Agent tool factories by namespace
│           ├── codebase/      # read_file, search_codebase, list_directory, write_file, run_command
│           ├── communication/ # reply, ask, notify (agent-to-human)
│           ├── coordination/  # spawn_agent, wait_for, request_human_input
│           ├── directory/     # search_directory, get_agent_profile
│           ├── integration/   # linear, github, slack MCP wrappers
│           ├── knowledge/     # store_knowledge, search_knowledge
│           └── task/          # create_task, complete_task, delegate_task, handoff_task, list_tasks
```

### Agent Definitions

Agents are declared in YAML with a companion Markdown prompt:

- `definition.yaml` -- model, tools, triggers, history config, sub-agents
- `prompt.md` -- system prompt (raw LLM-visible text)

New agent = new directory in `definitions/`. Zero code changes.

### Conversation Executor

Postgres-backed durable executor managing conversation lifecycle:

- `start()` creates conversations (idempotent via correlation key)
- Worker loop claims queued conversations with `FOR UPDATE SKIP LOCKED`
- Agent loop runs LLM + tools until completion, pause, or error
- `wait_for` tool pauses conversations; signals resume them
- Heartbeats detect stale claims from crashed workers

### Event Routing

```
Webhook → NormalizedEvent → Adapter → IncomingEvent → EventRouter → start()/signal()
```

- **Fast path**: Deterministic routing for unambiguous events (e.g., `slack.app_mention` → product-agent)
- **Slow path**: LLM-based classification for ambiguous events

## Communication Pattern

Agents communicate with integrations (Linear, GitHub, Slack) via MCP HTTP protocol:

```
Agent → callMcpTool() → HTTP POST → Integration MCP Server → SDK Call
```

Agents do NOT import integration SDKs directly.

### MCP Endpoints

Each integration exposes an MCP server. Agents call tools via `callMcpTool` from `shared/mcp/`.

**Endpoint pattern:** `POST /mcp/tools/:name`

**Required headers:**
- `X-Agent-ID` -- identifies the calling agent (used for permission checks)
- `X-Correlation-ID` -- optional, propagated to logs

**Rate limit:** 100 requests/minute per agent (by X-Agent-ID).

**Ports:**
- Linear: `http://linear-integration:3001/mcp/*` (Docker) / `http://localhost:3001/mcp/*` (local)
- GitHub: `http://github-integration:3002/mcp/*` / `http://localhost:3002/mcp/*`
- Slack: `http://slack-integration:3003/mcp/*` / `http://localhost:3003/mcp/*`

### Available MCP Tools

**Linear (9 tools):**
- `get_issue` -- retrieve issue details
- `create_issue` -- create new issue
- `update_issue_status` -- change issue workflow state
- `list_teams` -- list all teams
- `list_labels` -- list labels (optionally by team)
- `search_issues` -- search issues by text query
- `create_comment` -- create comment on an issue
- `create_agent_activity` -- emit typed activity (thought, action, response, error, elicitation)
- `update_session_state` -- update Linear agent session status

**GitHub (10 tools):**
- `get_repository` -- get repository info
- `create_branch` -- create a new branch
- `create_commit` -- create a commit with files
- `create_pull_request` -- open a PR
- `get_pull_request` -- get PR details
- `list_pull_requests` -- list PRs
- `merge_pull_request` -- merge a PR
- `create_pr_comment` -- comment on a PR
- `get_file_contents` -- read file content
- `list_files` -- list directory contents

**Slack (7 tools):**
- `send_message` -- send a message
- `send_approval_request` -- send approval buttons
- `send_escalation_request` -- send escalation with retry/abort buttons
- `get_message` -- retrieve a message
- `reply_to_thread` -- reply in a thread
- `update_message` -- update existing message
- `list_channels` -- list channels

### callMcpTool Usage

```typescript
import { callMcpTool } from "@aesir/agents";

const issue = await callMcpTool<{ title: string; status: string }>({
  integration: "linear",
  tool: "get_issue",
  params: { issueId: "ABC-123" },
  agentId: "dev-agent",
  correlationId: taskId,
});
```

Tool permissions are database-backed (allow-list). Seed defaults with:
```bash
pnpm --filter @aesir/integration-{linear,github,slack} seed:permissions
```

## Usage

```bash
# Docker Compose (recommended)
docker compose up agent-service

# Run unit tests
pnpm --filter @aesir/agents test
```

Entry point: `src/service/main.ts` -- single Express server with integrated worker loop.

## Agent Integration Tests

LLM-driven integration tests that exercise agent collaboration primitives against a live system. Unlike Vitest unit tests, these fire real events, let agents run, then collect evidence from the database and have an LLM evaluate whether the behavior matched natural language success criteria.

### Prerequisites

- Agent-service running: `docker compose up`
- Environment: `DATABASE_URL` and `ANTHROPIC_API_KEY` set (loaded from root `.env`)

### Running

```bash
pnpm --filter @aesir/agents test:agents                  # Run all scenarios
pnpm --filter @aesir/agents test:agents -- delegation     # Run a specific scenario
pnpm --filter @aesir/agents test:agents -- --tag handoff  # Run scenarios by tag
```

### Scenarios

The registry is `allScenarios` in `scripts/agent-tests/scenarios/index.ts`; each scenario file beside it carries the `id`, `name`, `description`, `tags`, and `expect` criteria. Run with an unknown ID and the runner prints the IDs it knows.

### How It Works

1. **Trigger** -- fires an event (e.g., `testing.delegate.start`) via HTTP POST to agent-service
2. **Poll** -- waits for all related conversations to settle (completed/failed), following delegation and sub-agent chains
3. **Collect** -- gathers evidence from DB: conversations, tasks, handoffs, events (tool calls, signals)
4. **Evaluate** -- sends evidence + natural language success criteria to Haiku for pass/fail judgment
5. **Report** -- outputs verdict with per-criterion reasoning

### Adding a New Scenario

1. **Create test agents** in `definitions/test-*/{definition.yaml,prompt.md}`
   - Use `testing.<name>.start` as the trigger event type
   - Use Haiku model with low token budgets (test agents do minimal work)
   - Add `capabilities` for directory discovery if agents need to find each other
2. **Create scenario file** at `scripts/agent-tests/scenarios/<name>.ts`
   ```typescript
   export const myScenario: AgentTestScenario = {
     id: "my-scenario",
     name: "My Scenario",
     description: "What this tests",
     trigger: { eventType: "testing.my-scenario.start" },
     timeoutMs: 60_000,
     expect: `
       - Natural language success criterion 1
       - Natural language success criterion 2
     `,
     tags: ["my-tag"],
   };
   ```
3. **Register** in `scripts/agent-tests/scenarios/index.ts`
4. **Seed directory** -- `pnpm --filter @aesir/agents seed:directory` to register new test agents

### Test Agents

Test agents live alongside production agents in `definitions/test-*/`. They use Haiku with low token budgets, are triggered by `testing.*` events, and exist solely for the integration test suite. `ls definitions/test-*` lists the current set; each scenario's `expect` block in `scripts/agent-tests/scenarios/` names the agents it exercises.
