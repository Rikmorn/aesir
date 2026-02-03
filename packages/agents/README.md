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

# Run tests
pnpm --filter @aesir/agents test
```

Entry point: `src/service/main.ts` -- single Express server with integrated worker loop.
