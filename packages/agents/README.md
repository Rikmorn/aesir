# @aesir/agents

Autonomous agents that automate software development workflows.

## Architecture

The agents package contains two main agents and shared infrastructure:

```
packages/agents/src/
├── dev-agent/       # Development automation agent
├── product-agent/   # Product conversation agent
└── shared/          # Common infrastructure (MCP, Temporal, tracing)
```

### Dev Agent

Automates Linear issue resolution through a multi-phase workflow:
1. Receives issue assignment via Linear webhook
2. Researches codebase to understand context
3. Creates execution plan
4. Requests human approval (HITL)
5. Executes plan in sandbox container
6. Creates PR and handles feedback

**Entry points:**
- `main.ts` - HTTP server for receiving events
- `worker.ts` - Temporal worker for workflow execution

### Product Agent

Handles Slack conversations to gather requirements and create Linear issues:
1. Receives @mention or DM in Slack
2. Classifies intent (feature request, bug report, question)
3. Gathers requirements through conversation
4. Creates tasks in Linear

**Entry points:**
- `main.ts` - HTTP server for receiving events
- `worker.ts` - Temporal worker for workflow execution

### Shared Infrastructure

Common utilities used by all agents:
- **mcp/** - MCP client for integration communication
- **temporal/** - Workflows, activities, and signals
- **tracing/** - LangGraph execution tracing
- **config/** - Agent configuration
- **state/** - Shared state schemas
- **env/** - Environment validation

## Usage

### Docker Compose (Recommended)

```bash
docker compose up -d dev-agent product-agent
```

### Local Development

```bash
# Start dev-agent
pnpm --filter @aesir/agents dev-agent

# Start product-agent
pnpm --filter @aesir/agents product-agent
```

## Communication Pattern

Agents communicate with integrations (Linear, GitHub, Slack) via MCP HTTP protocol:

```
Agent → callMcpTool() → HTTP POST → Integration MCP Server → SDK Call
```

Agents do NOT import integration SDKs directly. All external communication goes through MCP.

## Workflows

### HITL Workflow (Dev Agent)

Uses Temporal for durable, human-in-the-loop execution:
- `devAgentWorkflow` - Main orchestration workflow
- Activities wrap LangGraph nodes for durability
- Signals handle approvals and feedback

### Code Workflow (Dev Agent)

Lightweight LangGraph-only workflow for simple code generation:
- No Temporal involvement
- Direct task execution without approval gates

### Conversation Workflow (Product Agent)

Temporal workflow for multi-turn Slack conversations:
- `productAgentConversationWorkflow` - Handles conversation lifecycle
- Checkpointer persists conversation state across messages

## Testing

```bash
pnpm --filter @aesir/agents test
```

## API Reference

See individual agent READMEs for detailed API documentation:
- [Dev Agent](./src/dev-agent/README.md)
- [Product Agent](./src/product-agent/README.md)
