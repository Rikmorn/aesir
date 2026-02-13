# @aesir/agents

Unified agent service that automates software development workflows.

## Architecture

Single service with declarative agent definitions and a Postgres-backed conversation executor:

```
packages/agents/
├── definitions/     # Agent YAML + prompt.md files
│   ├── dev-agent/   # Development automation agent
│   ├── product-agent/ # Product conversation agent
│   ├── coder/       # Code generation sub-agent
│   ├── researcher/  # Codebase research sub-agent
│   └── tester/      # Test execution sub-agent
├── src/
│   ├── adapters/    # Event normalization (Linear, GitHub, Slack)
│   ├── framework/   # Core runtime (executor, worker, event log, history)
│   ├── router/      # Event routing pipeline
│   ├── service/     # Unified HTTP entry point
│   └── shared/      # MCP client, agent loop, tools, config
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

| ID | Name | What it tests |
|----|------|---------------|
| `delegation` | Basic Delegation | Full delegate → handshake → wait → complete cycle |
| `handoff` | Hand-off (Fire and Forget) | Delegate + handshake only, no wait for completion |
| `chain` | Chain Delegation (A→B→C) | Multi-hop delegation with result propagation |
| `rejection` | Rejection Handling | Delegatee rejects, assigner handles gracefully |
| `timeout` | Timeout Handling | Delegatee stalls, assigner's timeout fires via pg-boss |
| `subagent` | Sub-Agent Spawning | Parent spawns child via spawn_agent |
| `tools` | Tool Integration | Exercises knowledge, directory, and communication tools |

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

Test agents live alongside production agents in `definitions/test-*/`. They use Haiku with low token budgets, are triggered by `testing.*` events, and exist solely for the integration test suite. Current test agents:

- `test-delegate-assigner`, `test-delegate-acceptor` -- basic delegation pair
- `test-handoff-assigner`, `test-handoff-acceptor` -- fire-and-forget pair
- `test-chain-initiator`, `test-chain-relay` -- chain delegation (reuses `test-delegate-acceptor`)
- `test-reject-assigner`, `test-delegate-rejector` -- rejection handling pair
- `test-timeout-assigner`, `test-delegate-staller` -- timeout handling pair
- `test-subagent-parent`, `test-subagent-child` -- sub-agent spawning pair
- `test-tool-exerciser` -- standalone tool integration exerciser
