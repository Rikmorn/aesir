# Shared Infrastructure

Common utilities and infrastructure used by all agents.

## Structure

```
shared/
├── agent-loop/    # Core agent loop (LLM call + tool execution)
├── config/        # Agent configuration utilities
├── db/            # Database client, schema, migrations
├── env/           # Environment validation (Zod)
├── mcp/           # MCP client for integration communication
└── tools/         # Reusable tool factories
    ├── codebase/       # read_file, search_codebase, list_directory, write_file, run_command
    ├── coordination/   # request_human_input, spawn_agent, wait_for
    └── integration/    # Linear, GitHub, Slack MCP wrappers
```

## MCP Client

Agent-to-integration communication via HTTP:

```typescript
import { callMcpTool } from "../shared/mcp/index.js";

const issue = await callMcpTool<IssueDetails>({
  integration: "linear",
  tool: "get_issue",
  params: { issueId: "ABC-123" },
  agentId: "dev-agent",
  correlationId: "req-456",
});
```

MCP URLs configured via environment (defaults to Docker network names):
- `LINEAR_MCP_URL` (default: `http://linear-integration:3001`)
- `GITHUB_MCP_URL` (default: `http://github-integration:3002`)
- `SLACK_MCP_URL` (default: `http://slack-integration:3003`)

## Agent Loop

Core LLM execution loop (`agent-loop/run-agent-loop.ts`):
- Iterates: LLM call → tool execution → LLM call
- Token budget tracking with configurable limits
- Rate limit retry with exponential backoff
- Heartbeat callbacks for executor liveness detection

## Environment

Validates all env vars at import time (fail-fast):

```typescript
import { config } from "../shared/env/config.js";

const apiKey = config.anthropic.apiKey;
const dbUrl = config.database.url;
```

## Tools

Tool factories receive `ToolContext` and return configured `ToolDefinition` instances.
Registered in the `ToolRegistry` with `namespace:tool_name` resolution (e.g., `linear:get_issue`).
