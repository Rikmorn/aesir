# Phase 34: Smart Router - Research

**Researched:** 2026-01-30
**Domain:** Event routing, hybrid deterministic/LLM classification, Temporal client API, HTTP service setup
**Confidence:** HIGH

## Summary

Phase 34 creates a new HTTP service (port 3006) that receives all normalized events from integration dispatchers and routes them to the correct agent workflow. The router uses a hybrid approach: deterministic pattern-matching for unambiguous events (button clicks, PR merges, agent sessions) and an LLM-powered agentic loop for ambiguous events (Slack mentions, Linear comments, thread replies). It absorbs the existing approval intent classifier from `dev-agent/classification/approval.ts`.

The codebase already has all the foundational pieces needed: `runAgentLoop()` (Phase 28), `ToolDefinition` interface (Phase 30), `NormalizedEvent` schema, Temporal client patterns for starting/signaling workflows, and the exact dispatchers that need rewiring. The router is a new service that composes these pieces into a unified entry point.

**Primary recommendation:** Build the router as a standalone HTTP service within the `@aesir/agents` package (same Dockerfile, different entry point), using the existing `runAgentLoop()` with 4 router-specific tools and a 10-iteration limit. Deterministic routing handles ~60% of events with zero LLM latency; the agentic path handles the rest.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.72.0 | LLM calls for ambiguous event classification | Already in `@aesir/agents`, used by `runAgentLoop()` |
| `@temporalio/client` | ^1.14.1 | Start/signal/query Temporal workflows | Already in `@aesir/agents`, used by events handlers |
| `zod` | 3.25.67 | Schema validation for events, tool inputs | Already in `@aesir/agents` and `@aesir/types` |
| `node:http` | built-in | HTTP server for router service | Same pattern as dev-agent `main.ts` and product-agent `main.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aesir/platform` | workspace | Pino logging, correlation IDs | All logging throughout router |
| `@aesir/types` | workspace | `NormalizedEvent`, `NormalizedEventSchema` | Event validation on ingress |
| `fetch-retry-ts` | ^1.3.1 | HTTP retry for MCP calls (via `callMcpTool`) | Only if router needs to send Slack messages directly |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:http` raw server | Express | Express adds dependency for simple routing; existing agents use raw `node:http`. Follow existing pattern. |
| Claude Haiku 4.5 for router LLM | Claude Sonnet 4 | Haiku is 4-5x faster and much cheaper. Router needs speed, not deep reasoning. Recommend Haiku for the LLM path. |
| Separate `@aesir/router` package | Entry point in `@aesir/agents` | A new package adds build complexity. The router uses the same Dockerfile and shares `runAgentLoop()`, `callMcpTool`, and Temporal types. Keep it in `@aesir/agents`. |

**Installation:**
No new dependencies needed. All required packages are already in `@aesir/agents`.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
├── router/                    # NEW: Smart Router service
│   ├── main.ts               # HTTP server entry point (port 3006)
│   ├── router.ts             # Core routing logic (fast path + slow path)
│   ├── fast-path.ts          # Deterministic rule matching
│   ├── slow-path.ts          # Agentic loop for ambiguous events
│   ├── tools/                # Router-specific tool definitions
│   │   ├── query-workflows.ts
│   │   ├── start-workflow.ts
│   │   ├── signal-workflow.ts
│   │   └── send-message.ts
│   ├── system-prompt.ts      # Router system prompt
│   ├── types.ts              # Router-specific types
│   └── router.test.ts        # Tests
├── dev-agent/
├── product-agent/
└── shared/
```

### Pattern 1: Hybrid Router with Fast Path / Slow Path
**What:** Events arrive at a single endpoint. A fast-path check runs deterministic rules first. Only events that don't match any rule go through the LLM agentic loop.
**When to use:** Always -- this is the core architecture decision.
**Example:**
```typescript
// router.ts
import type { NormalizedEvent } from "@aesir/types";
import { matchFastPath, type FastPathResult } from "./fast-path.js";
import { routeViaAgentLoop } from "./slow-path.js";

export interface RouterDeps {
  workflowClient: TemporalClient;
  logger: PinoLogger;
}

export async function routeEvent(
  event: NormalizedEvent,
  deps: RouterDeps,
): Promise<RouteResult> {
  const fastResult = matchFastPath(event);

  if (fastResult) {
    // Deterministic route -- zero LLM latency
    return executeFastPath(fastResult, deps);
  }

  // Ambiguous event -- LLM reasoning
  return routeViaAgentLoop(event, deps);
}
```

### Pattern 2: Deterministic Rule Table
**What:** A flat array of rules, each with a matcher function and an action function. First match wins. Rules are evaluated in order.
**When to use:** For the fast path. Makes adding new deterministic rules trivial.
**Example:**
```typescript
// fast-path.ts
interface RoutingRule {
  name: string;
  match: (event: NormalizedEvent) => boolean;
  action: (event: NormalizedEvent) => FastPathAction;
}

const DETERMINISTIC_RULES: RoutingRule[] = [
  {
    name: "slack-approval-button",
    match: (e) => e.type === "slack.block_actions.approved",
    action: (e) => ({
      type: "signal",
      workflowId: `dev-agent-${(e.payload as any).taskIdentifier}`,
      signal: "planApproval",
      payload: { approved: true, source: "slack" },
    }),
  },
  // ... more rules
];
```

### Pattern 3: Router Agentic Loop with Routing Tools
**What:** Use `runAgentLoop()` with router-specific tools (query_running_workflows, start_workflow, signal_workflow, send_message). The LLM reads the event, reasons about intent, and calls the appropriate tool.
**When to use:** For ambiguous events (app_mention, linear.comment.created, thread replies, PR reviews).
**Example:**
```typescript
// slow-path.ts
import { runAgentLoop } from "../../shared/agent-loop/index.js";

export async function routeViaAgentLoop(
  event: NormalizedEvent,
  deps: RouterDeps,
): Promise<RouteResult> {
  const result = await runAgentLoop({
    systemPrompt: ROUTER_SYSTEM_PROMPT,
    tools: createRouterTools(deps),
    initialMessage: formatEventForLLM(event),
    model: "claude-haiku-4-5-20251016",  // Fast, cheap model for routing
    maxIterations: 10,                    // ROUT-07: Quick decisions
    logger: deps.logger,
  });

  return parseRouteResult(result);
}
```

### Pattern 4: Integration Dispatcher Rewiring
**What:** Update each integration's dispatch routes to point all events at the router service instead of individual agents.
**When to use:** Phase 34 includes this rewiring so the router is testable end-to-end.
**Example:**
```typescript
// packages/integrations/slack/src/dispatcher/routes.ts (CHANGED)
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "slack.message.created",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
  {
    eventType: "slack.app_mention.created",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync",
  },
  {
    eventType: "slack.block_actions.approved",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync",
  },
  // ... all events go to router
];
```

### Anti-Patterns to Avoid
- **Routing inside Temporal:** The router is a stateless HTTP gateway. Do NOT wrap it in a Temporal workflow. Temporal adds latency and complexity for what should be sub-second routing. If the router crashes mid-LLM-call, the integration dispatcher retries the HTTP POST.
- **Separate LLM call for classification then another for action:** The LLM should read the event and directly call the appropriate tool (start_workflow, signal_workflow, etc.). No separate "classify then dispatch" two-step. The tool call IS the classification.
- **Hardcoded cancellation detection in router:** Per CONTEXT.md decision, cancellation detection stays with the product agent. Router sends `userReplySignal` for all thread messages; the agent decides if it's a cancellation.
- **Importing agent-internal modules:** The router should only use `@temporalio/client` for workflow operations and `callMcpTool` for sending Slack messages. It must NOT import agent-internal workflow logic, state types, or node implementations.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM tool-use loop | Custom LLM call+tool loop | `runAgentLoop()` from `shared/agent-loop/` | Already handles iteration limits, token budgets, abort signals, tracing, error handling |
| Zod-to-JSON-Schema conversion | Manual JSON Schema construction | `betaZodTool()` via `runAgentLoop()` | SDK handles all edge cases |
| Event validation | Custom event parsing | `NormalizedEventSchema.safeParse()` | Already handles all normalized event formats |
| Temporal workflow start | Raw gRPC calls | `workflowClient.workflow.start()` | TypeScript SDK handles connection, retries, error types |
| Temporal workflow signal | Raw gRPC calls | `workflowClient.workflow.getHandle().signal()` | SDK handles serialization and error types |
| Temporal workflow listing | Custom queries | `workflowClient.list({ query: "ExecutionStatus='Running'" })` | SDK's visibility API with SQL-like queries |
| HTTP server setup | Express (adds dependency) | `node:http` with `createServer()` | Same pattern as `dev-agent/main.ts` and `product-agent/main.ts` |
| Workflow ID derivation | New convention | Existing: `dev-agent-{issueId}`, `product-agent-{threadTs}` | Must match existing conventions or signal delivery fails |

**Key insight:** The entire router can be built from existing primitives. The novel part is only the routing logic (rules + system prompt), not the infrastructure.

## Common Pitfalls

### Pitfall 1: Workflow ID Mismatch
**What goes wrong:** Router starts or signals a workflow with an ID that doesn't match the running workflow's ID.
**Why it happens:** The codebase uses different ID schemes: `dev-agent-{Linear UUID}` (from `events.ts` line 480) and `product-agent-{threadTs}` (from `events.ts` line 234). If the router uses the wrong format, signals go nowhere.
**How to avoid:** Extract the exact workflow ID derivation logic from the existing event handlers into shared utility functions. The router must use the same ID formulas.
**Warning signs:** `WorkflowNotFoundError` when signaling workflows that are definitely running.

### Pitfall 2: Approval Classification Regression
**What goes wrong:** The router's inline LLM reasoning classifies approval intents less accurately than the dedicated `classifyApprovalIntent()` function.
**Why it happens:** The existing classifier uses a carefully crafted system prompt with 50+ examples (the `APPROVAL_CLASSIFICATION_PROMPT` constant). Moving to inline reasoning without this guidance degrades accuracy.
**How to avoid:** Port the classification guidance (intent types, examples, edge cases) from `approval.ts` into the router's system prompt. The prompt should include: approve, reject, question, unclear, guidance, abort intent patterns.
**Warning signs:** Linear comments that used to trigger approval now get misrouted.

### Pitfall 3: Blocking the Fast Path with LLM Calls
**What goes wrong:** Events that should route deterministically (button clicks, PR merges) accidentally fall through to the LLM path, adding 2-5 seconds of latency.
**Why it happens:** Fast-path rules don't cover all event variations. For example, the escalation buttons (`escalation_retry`, `escalation_abort`) are a separate pattern from approval buttons.
**How to avoid:** Enumerate ALL current event types and explicitly classify each as fast-path or slow-path. Test each with a deterministic assertion. See the complete event inventory below.
**Warning signs:** Button clicks taking seconds instead of milliseconds.

### Pitfall 4: Fire-and-Forget Dispatch Losing Events
**What goes wrong:** Integration dispatchers use fire-and-forget (no await on fetch). If the router returns 5xx, the event is lost.
**Why it happens:** The current dispatcher (`client.ts`) catches fetch errors and logs them but does NOT retry. The `.catch()` handler just logs.
**How to avoid:** For the router, update dispatchers to await the response and retry on 5xx. Alternatively, the router itself must be highly available (restart policy + health check). ROUT-06 requires events are never silently dropped.
**Warning signs:** Events logged as "dispatch failed" in integration logs with no corresponding router processing.

### Pitfall 5: Router LLM Timeout Stalling Event Processing
**What goes wrong:** The LLM takes too long (API latency spike, rate limiting) and the integration dispatcher's HTTP timeout fires first.
**Why it happens:** Slack dispatcher uses 30s timeout for "sync" events, 5s for "async" events. An LLM call can take 5-15 seconds.
**How to avoid:** The router should acknowledge receipt immediately (200 OK) and process asynchronously for events going through the LLM path. Only the fast path is synchronous. The integration dispatcher already has appropriate timeout configs.
**Warning signs:** Slack dispatcher logs "Event dispatch received non-OK response" or timeouts.

### Pitfall 6: PR Branch Name Extraction Failure
**What goes wrong:** The router can't extract task ID from GitHub PR branch name, so it can't find the workflow to signal.
**Why it happens:** The existing `sendCompletionSignal` uses regex `/feature\/([A-Z]+-\d+)/i` to extract task IDs from branch names. If branch naming convention changes or uses UUIDs instead of identifiers, extraction fails.
**How to avoid:** For deterministic PR events, use the same extraction logic already in `signal-handler.ts`. Port it to a shared utility.
**Warning signs:** `Cannot extract task ID from branch name` warnings.

## Code Examples

Verified patterns from the existing codebase:

### Starting a Temporal Workflow (from dev-agent events.ts)
```typescript
// Source: packages/agents/src/dev-agent/api/events.ts lines 503-527
const workflowId = `dev-agent-${issue.id}`;

await workflowClient.workflow.start("devAgentWorkflow", {
  taskQueue: "dev-agent",
  workflowId,
  args: [input],
});

// Handle already-started gracefully
catch (error) {
  const isAlreadyStarted =
    error instanceof Error &&
    (error.message.includes("already exists") ||
      error.message.includes("already started") ||
      error.name === "WorkflowExecutionAlreadyStartedError");
}
```

### Signaling an Existing Workflow (from signal-handler.ts)
```typescript
// Source: packages/agents/src/dev-agent/api/signal-handler.ts lines 112-145
const handle = workflowClient.workflow.getHandle(workflowId);
await handle.signal(planApprovalSignal, {
  approved: input.approved,
  ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
});

// Handle workflow-not-found
catch (error) {
  const isNotFound =
    error instanceof Error &&
    (error.message.includes("not found") ||
      error.message.includes("WorkflowNotFoundError") ||
      error.name === "WorkflowNotFoundError");
}
```

### Listing Running Workflows (Temporal Visibility API)
```typescript
// Source: Temporal TypeScript SDK documentation
// Uses the WorkflowClient.list() method with SQL-like query filter

const runningWorkflows = workflowClient.list({
  query: `ExecutionStatus = "Running" AND WorkflowType = "orchestratorWorkflow"`,
});

// Iterate results (async iterable)
for await (const workflow of runningWorkflows) {
  console.log(workflow.workflowId, workflow.status.name);
}

// Or with task ID filter (requires search attributes)
const taskWorkflows = workflowClient.list({
  query: `ExecutionStatus = "Running" AND WorkflowId = "dev-agent-${taskId}"`,
});
```

### Querying a Workflow's Status (existing query handlers)
```typescript
// Source: packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts line 162
// The orchestrator defines: orchestratorStatusQuery
// The product-agent defines: conversationStatusQuery

const handle = workflowClient.workflow.getHandle(workflowId);
const status = await handle.query(orchestratorStatusQuery);
// Returns: { taskId, phase, prNumber?, prUrl?, errorMessage? }

const convStatus = await handle.query(conversationStatusQuery);
// Returns: { threadTs, phase, iterations, issueId?, issueIdentifier? }
```

### runAgentLoop() Usage (from existing shared module)
```typescript
// Source: packages/agents/src/shared/agent-loop/run-agent-loop.ts
import { runAgentLoop } from "../../shared/agent-loop/index.js";
import type { ToolDefinition } from "../../shared/agent-loop/types.js";

const result = await runAgentLoop({
  systemPrompt: "You are a routing agent...",
  tools: [queryWorkflowsTool, startWorkflowTool, signalWorkflowTool, sendMessageTool],
  initialMessage: `Route this event:\n${JSON.stringify(event, null, 2)}`,
  model: "claude-haiku-4-5-20251016",  // Fast model for routing
  maxIterations: 10,                    // ROUT-07
  logger,
  onToolCall: (call) => { /* trace routing decision */ },
});
```

### HTTP Server Pattern (from dev-agent main.ts)
```typescript
// Source: packages/agents/src/dev-agent/main.ts lines 120-182
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "router" }));
    return;
  }

  if (req.method === "POST" && req.url === "/events") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    // ... process event
  }
});
```

## Complete Event Inventory

All event types currently dispatched, with routing classification:

### Fast Path (Deterministic Rules)
| Event Type | Current Target | Router Action | Payload Keys |
|------------|---------------|---------------|--------------|
| `slack.block_actions.approved` | dev-agent:3004 | Signal `planApproval` | taskIdentifier, userId, isApproval |
| `slack.block_actions.rejected` | dev-agent:3004 | Signal `planApproval` (rejected) | taskIdentifier, userId, isApproval |
| `slack.block_actions.escalation_retry` | dev-agent:3004 | Signal `escalationResolved` (retry) | taskIdentifier, escalationAction |
| `slack.block_actions.escalation_abort` | dev-agent:3004 | Signal `escalationResolved` (abort) | taskIdentifier, escalationAction |
| `github.pull_request.merged` | dev-agent:3004 | Signal `prCompletion` (merged) | prNumber, branchName, merged |
| `github.pull_request.closed` | dev-agent:3004 | Signal `prCompletion` (closed) | prNumber, branchName, merged |
| `linear.agent_session.created` | dev-agent:3004 | Start `devAgentWorkflow` | sessionId, issueId |

### Slow Path (LLM Reasoning)
| Event Type | Current Target | Router Must Decide | Why LLM Needed |
|------------|---------------|-------------------|----------------|
| `slack.app_mention.created` | product-agent:3005 | Which agent? New vs. existing thread? | Message content determines if product request |
| `slack.message.created` | product-agent:3005 | Which workflow to signal? | Must match to existing conversation thread |
| `linear.comment.created` | dev-agent:3004 | Approval intent? (approve/reject/guidance/abort/question/unclear) | Currently uses dedicated LLM classifier |
| `github.pull_request.review_submitted` | dev-agent:3004 | What action based on review state? | Review body may contain nuanced feedback |
| `github.pull_request.review_approved` | dev-agent:3004 | Signal PR feedback | Review may include comments alongside approval |
| `github.pull_request.review_changes_requested` | dev-agent:3004 | Signal PR feedback | Need to extract actionable feedback |
| `github.pull_request.review_commented` | dev-agent:3004 | Signal PR feedback or ignore? | Comment-only reviews may be informational |
| `github.pull_request.review_dismissed` | dev-agent:3004 | Ignore or re-evaluate? | Usually safe to ignore |
| `linear.issue.created` | dev-agent:3004 | Filter for agent-ready label | Currently handler filters; could be fast-path with payload check |
| `linear.issue.updated` | dev-agent:3004 | Filter for state changes | Currently handler filters |
| `linear.agent_session.prompted` | dev-agent:3004 | Signal existing workflow | Message content determines signal type |

### Potentially Promotable to Fast Path
After analysis, these events COULD be fast-path if we add payload field matching:
- `github.pull_request.review_approved` -- always signals prFeedback
- `github.pull_request.review_changes_requested` -- always signals prFeedback
- `github.pull_request.review_dismissed` -- always ignored
- `slack.message.created` in thread -- if threadTs exists and matches workflow, signal userReply

**Recommendation:** Start with the conservative split above. After seeing real traffic, promote events to fast-path based on observed LLM routing patterns.

## Router Model Selection

**Recommendation: Claude Haiku 4.5 (`claude-haiku-4-5-20251016`)**

| Factor | Haiku 4.5 | Sonnet 4 |
|--------|-----------|----------|
| Latency | 4-5x faster | Baseline |
| Cost | ~$0.80/$4.00 per 1M tokens | $3/$15 per 1M tokens |
| Routing accuracy | Sufficient for classification + tool selection | Better but overkill for routing |
| Context needed | Event JSON + system prompt (small) | Same |
| Reasoning depth | Adequate for "read event, pick tool" | Better for ambiguous cases |

**Rationale:** The router's LLM path does simple classification: read an event, understand intent, call one tool. This does not require deep reasoning. Haiku 4.5 handles this well at a fraction of the cost and latency. If accuracy issues arise on specific event types, the model can be configured per-event-type or upgraded to Sonnet.

**Confidence:** MEDIUM -- This is Claude's Discretion per CONTEXT.md. Haiku 4.5 is the best starting point but may need tuning.

## Integration Rewiring Details

### Files to Modify

| File | Change | Impact |
|------|--------|--------|
| `packages/integrations/slack/src/dispatcher/routes.ts` | All targets -> router:3006 | Slack events go to router |
| `packages/integrations/linear/src/dispatcher/routes.ts` | All targets -> router:3006 | Linear events go to router |
| `packages/integrations/github/src/dispatcher/routes.ts` | All targets -> router:3006 | GitHub events go to router |
| `packages/integrations/slack/src/api/interactions.ts` | dispatchUrl -> router:3006 | Button clicks go to router |
| `docker-compose.yml` | Add router service, update env vars | New container, env changes |
| `docker-config/nginx.conf` | Add /router/* route | Expose router if needed |

### Environment Variables for Router
```env
# Router service
ANTHROPIC_API_KEY=...             # For LLM routing
TEMPORAL_ADDRESS=temporal:7233    # For workflow client
TEMPORAL_NAMESPACE=default
ROUTER_PORT=3006
ROUTER_MODEL=claude-haiku-4-5-20251016  # Configurable LLM model

# MCP URLs (only needed for send_message tool)
SLACK_MCP_URL=http://slack-integration:3003

# Integration dispatchers (add to each integration)
ROUTER_URL=http://router:3006/events
```

### Docker Compose Addition
```yaml
# Smart Router - event classification and routing
router:
  build:
    context: .
    dockerfile: Dockerfile
  container_name: aesir-router
  depends_on:
    temporal:
      condition: service_started
    slack-integration:
      condition: service_healthy
  environment:
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    - TEMPORAL_ADDRESS=temporal:7233
    - TEMPORAL_NAMESPACE=default
    - ROUTER_PORT=3006
    - SLACK_MCP_URL=http://slack-integration:3003
    - LINEAR_MCP_URL=http://linear-integration:3001
    - NODE_ENV=${NODE_ENV:-production}
  ports:
    - "3006:3006"
  command: ["node", "dist/router/main.js"]
  healthcheck:
    test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3006/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))\""]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 30s
  networks:
    - aesir-network
  restart: unless-stopped
```

## Router System Prompt Design

The system prompt must include:

1. **Identity and purpose:** "You are a routing agent that classifies incoming events and routes them to the correct workflow."
2. **Available agents:** Dev agent (handles Linear issues, code tasks) and Product agent (handles Slack conversations, requirement gathering).
3. **Signal types:** What each signal does and what workflow accepts it.
4. **Intent classification guidance:** Ported from `APPROVAL_CLASSIFICATION_PROMPT` -- approve, reject, question, unclear, guidance, abort patterns with examples.
5. **Routing heuristics:**
   - New app_mention not in thread -> start product agent workflow
   - Thread reply with existing workflow -> signal userReply
   - Linear comment on issue with running dev-agent workflow -> classify intent and signal
   - PR review -> extract feedback and signal
6. **Constraints:** "Route events, don't process them. Don't interpret cancellation intent -- route thread messages to existing workflows and let agents decide."
7. **Tool descriptions:** Clear guidance on when to use each tool.

**Confidence:** MEDIUM -- Prompt engineering requires iteration. Start with comprehensive prompt, tune based on traces.

## Fallback and Alerting (ROUT-06)

When LLM routing fails or times out:

1. **Log the full event** with `error` level including event type, payload, and failure reason
2. **Send alert via Slack** using `callMcpTool` to post to a designated alerts channel
3. **Return 200 OK** to the dispatcher (to prevent retry loops that would produce duplicate alerts)
4. **Do NOT silently drop** -- the log + alert combination ensures visibility

```typescript
if (result.status === "error" || result.status === "max_iterations") {
  logger.error(
    { event, result },
    "Router failed to classify event -- event not routed",
  );

  // Alert via Slack MCP
  await callMcpTool({
    integration: "slack",
    tool: "send_message",
    params: {
      channel: alertsChannel,
      text: `Router failed to route event: ${event.type} (${event.id})`,
    },
    agentId: "router",
    correlationId: event.correlationId,
  }).catch((err) => {
    logger.error({ err }, "Failed to send router alert");
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded switch in events.ts | Smart router with hybrid dispatch | Phase 34 (this phase) | Unified entry point, LLM handles ambiguity |
| `classifyApprovalIntent()` via LangChain `withStructuredOutput` | Router inline LLM reasoning | Phase 34 (this phase) | One LLM call classifies and routes |
| Each agent has /events endpoint | Single /events endpoint on router | Phase 34 (this phase) | Simpler dispatcher config |
| `@langchain/anthropic` for classification | `@anthropic-ai/sdk` via `runAgentLoop()` | Phase 28 (dependency) | No LangChain dependency for classification |

**Deprecated/outdated:**
- `classifyApprovalIntent()` in `dev-agent/classification/approval.ts` -- absorbed into router
- Direct dispatch to `dev-agent:3004/events` and `product-agent:3005/events` from integration dispatchers -- replaced with `router:3006/events`
- `isCancellationMessage()` function in product-agent events.ts -- replaced by agent-side LLM detection (Phase 33)
- The LLM instance (`ChatAnthropic`) created in `dev-agent/main.ts` for comment classification -- no longer needed

## Open Questions

Things that couldn't be fully resolved:

1. **Should PR review events go through fast-path or slow-path?**
   - What we know: `review_approved` and `review_changes_requested` have clear intent from the review state. `review_submitted` and `review_commented` are more ambiguous.
   - What's unclear: Whether the review body content matters for routing (vs. just the review state)
   - Recommendation: Make `review_changes_requested` fast-path (always signals prFeedback). Keep `review_submitted` as slow-path since the review body may contain nuanced intent. `review_commented` and `review_dismissed` can be fast-path (ignore or forward).

2. **Async acknowledgment for LLM path**
   - What we know: Integration dispatchers have 5s (async) or 30s (sync) timeouts. LLM calls can take 5-15 seconds.
   - What's unclear: Whether to acknowledge immediately (200 OK) and process in background, or process synchronously.
   - Recommendation: Acknowledge immediately with 202 Accepted for events going to the slow path. Process asynchronously. This prevents dispatcher timeout issues.

3. **Alert channel configuration**
   - What we know: ROUT-06 requires alerting. The router needs a Slack channel to post alerts to.
   - What's unclear: Whether this should be a new channel or reuse `DEV_AGENT_SLACK_CHANNEL`.
   - Recommendation: Add `ROUTER_ALERTS_CHANNEL` env var. Default to `DEV_AGENT_SLACK_CHANNEL`.

4. **linear.issue.created and linear.issue.updated routing**
   - What we know: These events are currently dispatched to dev-agent but the handler doesn't process them (only `agent_session.created` triggers workflow start). The dispatch routes exist but are essentially no-ops.
   - What's unclear: Whether to route them through the router at all, or just drop them in fast-path.
   - Recommendation: Fast-path acknowledge and ignore. They exist in dispatch routes but aren't actionable. Can be promoted to active routing when needed.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/agents/src/dev-agent/api/events.ts` -- current event routing logic
- Codebase analysis: `packages/agents/src/product-agent/api/events.ts` -- current Slack event handling
- Codebase analysis: `packages/agents/src/dev-agent/classification/approval.ts` -- classifier to absorb
- Codebase analysis: `packages/agents/src/shared/agent-loop/run-agent-loop.ts` -- existing agentic loop
- Codebase analysis: `packages/agents/src/shared/temporal/signals.ts` -- signal definitions
- Codebase analysis: `packages/integrations/*/src/dispatcher/routes.ts` -- current dispatch routes
- Codebase analysis: `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts` -- workflow query patterns
- Codebase analysis: `packages/agents/src/dev-agent/api/signal-handler.ts` -- signal sending patterns
- Codebase analysis: `docker-compose.yml` -- current service topology

### Secondary (MEDIUM confidence)
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) -- Claude Haiku 4.5 model ID and capabilities
- [Temporal TypeScript SDK - WorkflowClient](https://typescript.temporal.io/api/classes/client.WorkflowClient) -- `list()` method for visibility queries
- [Temporal Community - List Running Workflows](https://community.temporal.io/t/how-to-get-a-list-of-running-open-workflows-using-typescript-sdk/3632) -- `workflowService.listWorkflowExecutions` alternative

### Tertiary (LOW confidence)
- Claude Haiku 4.5 routing accuracy for event classification -- needs empirical testing
- Exact model ID format for latest Haiku may need verification against API docs at implementation time

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in codebase, no new dependencies
- Architecture: HIGH -- hybrid router pattern is well-defined in spec and CONTEXT.md decisions
- Event inventory: HIGH -- exhaustive analysis of all dispatcher routes and event handlers
- Router tools: HIGH -- clear from CONTEXT.md decisions, matches existing Temporal client patterns
- System prompt: MEDIUM -- prompt engineering requires iteration, guidance from approval.ts helps
- Model selection: MEDIUM -- Haiku 4.5 is recommended but needs accuracy validation
- Pitfalls: HIGH -- derived from direct codebase analysis of existing patterns and edge cases
- Integration rewiring: HIGH -- straightforward env var and route target changes

**Research date:** 2026-01-30
**Valid until:** 2026-03-01 (stable domain, 30-day validity)
