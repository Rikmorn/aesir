# Shared Infrastructure

Common utilities and infrastructure used by all agents.

## Overview

The shared module provides:
- MCP client for integration communication
- Temporal workflows, activities, and signals
- LangGraph execution tracing
- Agent configuration
- Shared state schemas
- Environment validation

## Structure

```
shared/
├── mcp/           # Model Context Protocol client
├── temporal/      # Temporal workflows and activities
│   ├── workflows/
│   ├── activities/
│   └── signals.ts
├── tracing/       # LangGraph execution tracing
├── config/        # Agent configuration utilities
├── state/         # Shared state schemas
├── env/           # Environment configuration
└── index.ts       # Barrel export
```

## MCP Client

The MCP client enables agent-to-integration communication:

```typescript
import { callMcpTool } from "@aesir/agents";

// Call Linear MCP tool
const issue = await callMcpTool<IssueDetails>({
  integration: "linear",
  tool: "get_issue",
  params: { issueId: "ABC-123" },
  agentId: "dev-agent",
  correlationId: "req-456",
});

// Call GitHub MCP tool
await callMcpTool({
  integration: "github",
  tool: "create_branch",
  params: { owner, repo, branch: "feature/xyz", from: "main" },
  agentId: "dev-agent",
  correlationId: "req-456",
});

// Call Slack MCP tool
await callMcpTool({
  integration: "slack",
  tool: "send_message",
  params: { channel: "C123", text: "Hello" },
  agentId: "product-agent",
  correlationId: "req-789",
});
```

Configuration via environment:
- `LINEAR_MCP_URL` (default: `http://linear-integration:3001`)
- `GITHUB_MCP_URL` (default: `http://github-integration:3002`)
- `SLACK_MCP_URL` (default: `http://slack-integration:3003`)

## Temporal

### Workflows

Durable workflow orchestration for multi-step processes:

- `devAgentWorkflow` - HITL development workflow
- `productAgentConversationWorkflow` - Multi-turn Slack conversations

### Activities

Activity implementations that wrap LangGraph nodes:

- Dev Agent: `runDevAgentGraphActivity`, `continueAfterApprovalActivity`, etc.
- Product Agent: `runProductAgentActivity`, `sendSlackReplyActivity`, etc.
- Integration activities: `updateLinearIssueStatusActivity`, `mergePullRequestActivity`

### Signals

Async communication with running workflows:

```typescript
import { planApprovalSignal, prCompletionSignal } from "@aesir/agents";

// Signal plan approval
await handle.signal(planApprovalSignal, { approved: true });

// Signal PR completion
await handle.signal(prCompletionSignal, { merged: true, prNumber: 42 });
```

## Tracing

LangGraph execution tracing for debugging:

```typescript
import { createLangGraphTracer } from "@aesir/agents";

const tracer = createLangGraphTracer({ taskId: "ABC-123" });
const workflow = createWorkflow().withCallbacks([tracer]);
```

Traces capture:
- Node execution start/end
- LLM calls
- Tool invocations
- Errors

## State

Shared state schemas used across agents:

```typescript
import {
  AgentState,
  createInitialState,
  shouldContinue,
  hasExceededLoopLimit,
} from "@aesir/agents";
```

## Environment

Environment validation for agent configuration:

```typescript
import { config, env, type AgentsConfig } from "@aesir/agents";

// Access validated configuration
const apiKey = config.anthropic.apiKey;
const temporalAddress = env.TEMPORAL_ADDRESS;
```

## Usage

All exports are available from the main package:

```typescript
// Everything from shared is re-exported
import {
  callMcpTool,
  planApprovalSignal,
  createLangGraphTracer,
  config,
} from "@aesir/agents";
```
