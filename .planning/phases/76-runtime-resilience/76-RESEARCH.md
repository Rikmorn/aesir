# Phase 76: Runtime Resilience - Research

**Researched:** 2026-02-16
**Domain:** Agent framework resilience -- failure notifications, MCP error handling, recovery context, graceful shutdown
**Confidence:** HIGH

## Summary

Phase 76 closes four resilience gaps in the agent framework. The codebase is well-structured for these changes: the denormalizer already routes to all three channels (Slack, Linear, GitHub), the MCP client (`callMcpTool`) already has retry logic via `fetch-retry-ts`, the event log already supports sequence-based queries with `afterSequence`, and the shutdown sequence in `main.ts` already has a SIGTERM handler with a configurable force timeout. The work is primarily extension of existing patterns, not new architecture.

The four work areas are loosely coupled. Failure notifications read `reply_context` from conversation rows and route through the existing denormalizer. MCP error classification replaces the `fetch-retry-ts` library with hand-written retry logic in `callMcpTool` (the library doesn't expose HTTP status codes to distinguish permanent vs transient). Recovery context queries the event log on resume and injects an XML block. Graceful shutdown refines the existing drain sequence to add abort signaling and drain timeout enforcement.

**Primary recommendation:** Plan as four independent work streams with minimal cross-dependencies. The MCP error handling and graceful shutdown are the most self-contained. Failure notifications and recovery context both touch `worker-loop.ts` but at different lifecycle points (terminal failure vs resume).

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Failure notifications:**
- Trigger: Terminal `failed` status only -- no notifications during retry attempts or stale heartbeat re-enqueue
- Target: Originating channel only via `reply_context` on conversation row
- No reply_context: Log and move on, dashboard is the only visibility
- Content: Agent name, classified failure reason, retry count ("failed after 2/2 retries" or "failed (non-retryable)"), task context when available, conversation ID
- No stack traces, no dashboard links, no rich channel-specific formatting
- Format: Plain text with light markdown, passed through existing denormalizer
- Notification delivery failure: Emit `notification.failed` event, log it, no secondary fallback

**MCP error handling:**
- Classification boundary: HTTP status code
  - Permanent (4xx: 400, 401, 403, 404, 422) -> return to agent immediately
  - Transient (429, 5xx) -> infrastructure retries transparently
  - Network errors -> transient (2-3 quick retries)
- Retry policy: 3 total attempts, exponential backoff 1s/2s/4s, full jitter, 10s max delay cap
- 429 with Retry-After: Respect header up to 10s cap, return error if server says >10s
- Location: `callMcpTool` (one place, one policy)
- Permanent error response shape: `{ error: true, status: 404, tool: "linear:get_issue", message: "...", params: { issueId: "LIN-456" } }`
- Transient-exhausted: Includes total attempts, total time, final status code, tool name

**Recovery context:**
- Checkpoint: `last_persisted_sequence` integer column on conversation row, updated atomically with message persistence
- Recovery window events: sub-agent completions, successful tool calls, failed tool calls, signals received
- Skip: `tool.called`, `llm.response`, `agent.started`
- Output truncation: 200-300 chars per entry
- No event count cap (bounded by one agent loop iteration)
- Injection: User message following `<task_context>` / `<active_delegations>` pattern
- Retry awareness: Include retry number, max retries, failure reason from previous attempt
- First-iteration crash: `last_persisted_sequence` is null/0, recovery window = entire event log

**Graceful shutdown:**
- Drain timeout: 30s default (configurable via existing `config.service.forceShutdownTimeoutMs`)
- Goal: Finish current agent loop iteration, not entire conversation
- Stop immediately on SIGTERM: HTTP server, SSE connections, pg-boss, knowledge cleanup timer
- Stay open: In-flight agent loop iterations, event log, database pool
- Overflow: Abandon, let stale heartbeat detector pick them up, log at warn, flush event log, don't update status or send notifications
- Health endpoint returns `{ status: "draining", inFlight: N }` with 503 during drain

### Claude's Discretion
- Exact event log query strategy for recovery context (sequence range query vs type-filtered query)
- How to handle started-but-not-completed sub-agents in recovery context
- Notification message template wording
- Whether to add `<recovery_context>` mention to agent system prompts

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RESIL-01 | All channels receive failure notification on terminal `failed` status | Denormalizer already routes to Slack/Linear/GitHub via `reply_context`. Worker loop needs a notification function at all `status: "failed"` transitions. |
| RESIL-02 | All failure paths trigger notification -- retry-exhausted, non-retryable, max iterations | Worker loop has 4 codepaths that set `status: "failed"` (lines ~610, ~700, ~726, ~1449, ~1568). Each needs notification call. |
| RESIL-03 | `notification.failed` event emitted when notification delivery fails | New event type needed in schema (`notification.failed`). Catch block around denormalize call emits event. |
| RESIL-04 | MCP errors classified as permanent (4xx) vs transient (429, 5xx) | Replace `fetch-retry-ts` with custom retry loop in `callMcpTool`. HTTP status available on Response object. |
| RESIL-05 | Permanent MCP errors return structured context to agent | Return error object as tool result instead of throwing. Shape: `{ error, status, tool, message, params }`. |
| RESIL-06 | Transient MCP errors retried transparently with backoff | Custom retry loop: 3 attempts, exponential backoff with jitter. `fetch-retry-ts` replaced because it can't distinguish permanent vs transient or expose status to the caller. |
| RESIL-07 | MCP observability events -- `mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted` | New event types in schema. Events emitted from `callMcpTool` -- requires event emitter/callback pattern since MCP client doesn't have EventLog access. |
| RESIL-08 | Recovery context injected on crash resume | New `last_persisted_sequence` column, event log query on resume, `<recovery_context>` XML block injection in worker loop. |
| RESIL-09 | Retry count and recovery status in recovery context | Worker loop already has `conv.retry_count` and `conv.error_message` available at resume time. Include in recovery block. |
| RESIL-10 | Worker drains on SIGTERM with deadline | Existing drain logic in worker loop + main.ts shutdown. Add AbortController signaling and timeout enforcement. |

</phase_requirements>

## Standard Stack

### Core (already in codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | existing | Database queries, schema, migrations | Already used throughout |
| zod | existing | Validation at boundaries | Already used for all schemas |
| pino | existing | Structured logging | Already used via `createPinoLogger` |
| express | existing | HTTP server | Already used in main.ts |

### Removing
| Library | Current Purpose | Replacement | Why |
|---------|----------------|-------------|-----|
| fetch-retry-ts | MCP client retry | Custom retry loop in `callMcpTool` | Cannot distinguish permanent (4xx) from transient (5xx/429) errors. All retryOn codes are retried uniformly. No access to Response object between retries for classification logic. Custom loop is ~40 lines and gives full control over classification, jitter, Retry-After header parsing, and observability event emission. |

**No new dependencies required.**

## Architecture Patterns

### Recommended Changes by File

```
packages/agents/
├── src/
│   ├── framework/
│   │   ├── worker-loop.ts          # Failure notifications, recovery context injection, drain refinement
│   │   └── types.ts                # New event types: notification.failed, mcp.error, mcp.rate_limited, mcp.retries_exhausted
│   ├── service/
│   │   └── main.ts                 # Graceful shutdown refinement (abort signaling, drain timeout)
│   ├── shared/
│   │   ├── mcp/
│   │   │   ├── client.ts           # Replace fetch-retry-ts with custom retry + classification
│   │   │   ├── errors.ts           # Extend McpError with status code, classification
│   │   │   └── types.ts            # Add McpCallOptions.retryable flag, structured error response type
│   │   ├── db/
│   │   │   ├── schema.ts           # Add last_persisted_sequence column, new event types
│   │   │   ├── schema.drizzle.ts   # Mirror schema changes for drizzle-kit
│   │   │   └── migrations/
│   │   │       └── 0012_add_resilience.sql  # Migration for last_persisted_sequence + event types
│   │   └── communication/
│   │       └── denormalizer.ts      # No changes needed (already supports all channels)
│   └── ...
```

### Pattern 1: Failure Notification via Denormalizer

**What:** When a conversation reaches terminal `failed` status, read `reply_context` from the row and send a plain-text failure message through the existing denormalizer.

**When to use:** Every codepath in worker-loop.ts that sets `status: "failed"`.

**How it works:**
```typescript
// In worker-loop.ts, new function alongside emitErrorActivity
async function sendFailureNotification(
  conv: Conversation,
  failureReason: string,
  deps: { logger: PinoLogger; eventLog: EventLog },
): Promise<void> {
  const replyContext = conv.reply_context as ReplyContext | null;
  if (!replyContext) {
    deps.logger.info(
      { conversationId: conv.id },
      "No reply_context, skipping failure notification (dashboard only)",
    );
    return;
  }

  const message = buildFailureMessage(conv, failureReason);

  try {
    await denormalize(
      { replyContext, text: message },
      { agentId: "system", correlationId: conv.id },
    );
  } catch (error) {
    // Emit notification.failed event -- dashboard backstop
    deps.eventLog.append({
      conversationId: conv.id,
      agentDefinitionId: conv.agent_definition_id,
      agentDefinitionVersion: conv.agent_definition_version,
      agentInstanceId: `notification-${conv.id}`,
      type: "notification.failed",
      payload: {
        channel: replyContext.channel,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    deps.logger.warn(
      { err: error, conversationId: conv.id, channel: replyContext.channel },
      "Failure notification delivery failed (dashboard backstop)",
    );
  }
}
```

**Key insight:** The denormalizer is already channel-agnostic. The notification function is ~30 lines of new code plus the message builder.

### Pattern 2: MCP Error Classification in callMcpTool

**What:** Replace `fetch-retry-ts` with a custom retry loop that classifies HTTP status codes and handles permanent vs transient errors differently.

**When to use:** All MCP tool calls (single codepath).

**How it works:**
```typescript
// Simplified structure -- custom retry replacing fetchWithRetry
async function callMcpToolWithRetry<T>(
  url: string,
  init: RequestInit,
  options: { maxAttempts: number; tool: string; params: Record<string, unknown> },
): Promise<Response> {
  let lastError: Error | undefined;
  let totalRetryMs = 0;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);

      // Permanent errors -- return immediately, no retry
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response; // Caller builds structured error for agent
      }

      // Success
      if (response.ok) return response;

      // Transient -- retry (429, 5xx)
      if (attempt < options.maxAttempts) {
        const delay = calculateDelay(attempt, response);
        totalRetryMs += delay;
        await sleep(delay);
        continue;
      }

      return response; // Exhausted -- caller builds error
    } catch (networkError) {
      // Network error -- transient
      lastError = networkError as Error;
      if (attempt < options.maxAttempts) {
        const delay = calculateDelay(attempt);
        totalRetryMs += delay;
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError ?? new Error("MCP call failed");
}
```

### Pattern 3: Recovery Context Injection

**What:** On resume, query event log for events after `last_persisted_sequence`, build `<recovery_context>` XML block, inject as user message.

**When to use:** In `executeConversation()` when `isResumed = true` and `last_persisted_sequence > 0` (or when retry_count > 0).

**How it works:**
```typescript
// After existing task context injection, before agent loop
if (isResumed && (conv.retry_count > 0 || conv.last_persisted_sequence)) {
  const recoveryEvents = await eventLog.query(conv.id, {
    types: ["tool.succeeded", "tool.failed", "agent.completed", "signal.received"],
    afterSequence: conv.last_persisted_sequence ?? 0,
  });

  if (recoveryEvents.length > 0) {
    const recoveryBlock = buildRecoveryContextBlock(recoveryEvents, {
      retryCount: conv.retry_count,
      maxRetries: conv.max_retries,
      errorMessage: conv.error_message,
    });
    existingMessages.push({
      role: "user" as const,
      content: recoveryBlock,
    });
  }
}
```

### Pattern 4: Graceful Shutdown with Abort Signaling

**What:** On SIGTERM, abort running agent loops via AbortController, wait up to drain timeout, then exit.

**When to use:** In main.ts shutdown handler.

**Key change:** The worker loop's `drain()` currently waits indefinitely for running conversations. The change adds a timeout that aborts in-flight loops after the deadline:

```typescript
// In main.ts shutdown handler
const drainPromise = executor.stopWorker();
const timeoutPromise = new Promise<void>((resolve) => {
  setTimeout(() => {
    logger.warn("Drain timeout reached, abandoning in-flight conversations");
    resolve();
  }, config.service.forceShutdownTimeoutMs);
});
await Promise.race([drainPromise, timeoutPromise]);
```

### Anti-Patterns to Avoid

- **Don't add channel-specific notification logic:** Use the denormalizer for all channels. The existing `emitErrorActivity()` function is Linear-only and should be replaced, not extended.
- **Don't retry permanent MCP errors:** 401 is permanent because the integration handles OAuth refresh internally. If the token is invalid after refresh, retrying won't help.
- **Don't persist recovery context in message history:** It's injected fresh on each resume, never saved. This prevents recovery context from accumulating across multiple retries.
- **Don't send notifications for non-terminal states:** Stale heartbeat re-enqueue and retries are infrastructure self-healing. Only terminal `failed` triggers notification.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Channel routing | Per-channel notification functions | Existing denormalizer (`denormalize()`) | Already handles Slack threads, Linear comments/activities, GitHub PR comments |
| Event recording | Custom notification logging | Existing EventLog with new event type | Consistent with all other observability, surfaces in dashboard |
| Retry with backoff | Generic retry utility | Inline retry loop in `callMcpTool` | Single-use, domain-specific (HTTP status classification, Retry-After parsing). A generic utility adds abstraction for one callsite. |
| XML block building | Template engine | String concatenation (matches `<task_context>` pattern) | Consistent with existing codebase pattern, no dependency needed |

## Common Pitfalls

### Pitfall 1: Missing Failure Paths
**What goes wrong:** Notifications only fire from one or two of the `status: "failed"` transitions, missing others.
**Why it happens:** Worker loop has at least 5 codepaths that set `status: "failed"`:
1. Stale heartbeat recovery with max retries exceeded (line ~610)
2. Agent definition not found (line ~700)
3. Sub-agent definition not found (line ~726)
4. Non-retryable loop result (line ~1449)
5. Unexpected exception with max retries exceeded (line ~1568)
**How to avoid:** Extract a single `transitionToFailed()` function that handles notification, then call it from all failure paths. This makes it impossible to add a new failure path without triggering notification.
**Warning signs:** Tests that only cover one failure path.

### Pitfall 2: Notification Echo Loop
**What goes wrong:** Failure notification generates a webhook event that triggers a new conversation or signal.
**Why it happens:** When the denormalizer posts to Slack/Linear/GitHub, those platforms fire webhooks back. Phase 75's echo suppression should catch these (actor-based: the message is from our bot), but if misconfigured, it creates an infinite loop.
**How to avoid:** Use `agentId: "system"` (not a real agent ID) for the notification MCP call. Phase 75's actor-based echo suppression handles the webhook side. Verify echo suppression catches notifications in tests.
**Warning signs:** Notification causing new conversations to start.

### Pitfall 3: fetch-retry-ts Removal Side Effects
**What goes wrong:** Removing `fetch-retry-ts` from `callMcpTool` breaks the existing retry behavior that other parts of the codebase depend on.
**Why it happens:** `callMcpTool` is the only consumer of `fetch-retry-ts` in the codebase (verified: only 3 files reference it -- package.json, client.ts, client.test.ts). But the replacement must exactly match the existing retry behavior for 429/5xx while adding the new classification.
**How to avoid:** Write the custom retry loop to match the existing `retryOn: [429, 500, 502, 503, 504]` behavior first, then layer classification on top. Keep the same total attempt count (currently 4: initial + 3 retries, changing to 3 total per CONTEXT.md).
**Warning signs:** Existing MCP client tests failing.

### Pitfall 4: Recovery Context for First Run
**What goes wrong:** `last_persisted_sequence` is NULL on a brand-new conversation that crashes before its first persistence. The recovery query returns the entire event log, which may be empty or unexpectedly large.
**Why it happens:** `last_persisted_sequence` defaults to NULL/0 for new conversations.
**How to avoid:** CONTEXT.md explicitly addresses this: "First-iteration crash: `last_persisted_sequence` is null/0. Recovery window is the entire event log for that conversation. Fine -- it's short." Code should handle NULL gracefully by treating it as 0 (query all events). The event log for a first-iteration crash is bounded by one agent loop iteration (typically 5-15 events).
**Warning signs:** Recovery context being empty when it shouldn't be, or containing thousands of events.

### Pitfall 5: Drain Timeout vs Force Exit Race
**What goes wrong:** The drain timeout and the force exit timeout in main.ts fire at the same time (both default to 30s), causing ungraceful shutdown.
**Why it happens:** The existing `forceShutdownTimeoutMs` (line 420-426 in main.ts) starts when SIGTERM is received. The drain starts at the same time. If they're the same duration, the force exit can kill the process before drain cleanup (event log flush, pool close) completes.
**How to avoid:** The drain timeout should be slightly shorter than the force exit timeout. The force exit is the hard backstop. Sequence: SIGTERM -> stop HTTP/SSE/pg-boss (fast) -> drain with timeout (25s) -> cleanup (event flush, pool close) -> exit. The 5s buffer between drain and force exit allows cleanup.
**Warning signs:** Event log entries missing after shutdown, database pool errors on exit.

### Pitfall 6: MCP Observability Events Without EventLog Access
**What goes wrong:** `callMcpTool` is a standalone function in `shared/mcp/client.ts` with no access to the EventLog. Emitting `mcp.error`/`mcp.rate_limited`/`mcp.retries_exhausted` events requires either importing EventLog (creating a dependency cycle) or threading it through.
**Why it happens:** The MCP client is designed as a thin HTTP wrapper with no framework dependencies.
**How to avoid:** Use a callback/event emitter pattern. Add an optional `onMcpEvent` callback to `McpCallOptions` that the worker loop provides when constructing tool contexts. The callback is called from `callMcpTool` with event data, and the worker loop forwards to EventLog. Alternative: emit events from the tool execution layer (where `onToolResult` already exists) rather than from `callMcpTool` itself.
**Warning signs:** Circular imports, or MCP events missing from conversations that don't go through the worker loop.

## Code Examples

### Failure Message Builder
```typescript
// Source: follows sendRoutingAlertV2 pattern in router.ts
function buildFailureMessage(
  conv: Conversation,
  failureReason: string,
): string {
  const agentName = conv.agent_definition_id;
  const retryInfo = conv.retry_count > 0
    ? `Failed after ${conv.retry_count}/${conv.max_retries} retries`
    : "Failed (non-retryable)";

  const lines = [
    `**${agentName}** encountered an error and could not complete its work.`,
    "",
    `**Reason:** ${failureReason}`,
    `**Status:** ${retryInfo}`,
  ];

  // Task context when available
  if (conv.task_id) {
    lines.push(`**Task:** ${conv.task_id}`);
  }

  lines.push(`**Conversation:** ${conv.id}`);

  return lines.join("\n");
}
```

### Structured MCP Error Response
```typescript
// Source: CONTEXT.md locked decision on error shape
function buildPermanentErrorResult(
  response: Response,
  tool: string,
  params: Record<string, unknown>,
  errorBody: unknown,
): McpPermanentError {
  const message = typeof errorBody === "object" && errorBody !== null
    ? (errorBody as { error?: string }).error ?? `HTTP ${response.status}`
    : `HTTP ${response.status}`;

  return {
    error: true,
    status: response.status,
    tool,
    message,
    params: extractKeyParams(params), // Only key parameters, not full payload
  };
}
```

### Recovery Context Block Builder
```typescript
// Source: follows <task_context> pattern in worker-loop.ts buildTaskContextBlock
function buildRecoveryContextBlock(
  events: AgentEvent[],
  retryInfo: { retryCount: number; maxRetries: number; errorMessage: string | null },
): string {
  const lines: string[] = ["<recovery_context>"];

  // Retry awareness
  if (retryInfo.retryCount > 0) {
    const retryLabel = retryInfo.retryCount >= retryInfo.maxRetries
      ? `retry ${retryInfo.retryCount} of ${retryInfo.maxRetries} (final attempt)`
      : `retry ${retryInfo.retryCount} of ${retryInfo.maxRetries}`;
    lines.push(`This conversation was interrupted (${retryLabel}) and is being resumed.`);
    if (retryInfo.errorMessage) {
      lines.push(`Previous interruption: ${retryInfo.errorMessage}`);
    }
  } else {
    lines.push("This conversation is being resumed after an interruption.");
  }

  lines.push("");
  lines.push("Work completed since your last checkpoint (not in your message history):");
  lines.push("");

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const output = truncateOutput(payload.output as string | undefined, 300);

    switch (event.type) {
      case "agent.completed":
        if (event.parent_instance_id) {
          const role = payload.role ?? event.agent_definition_id;
          const error = payload.error as string | undefined;
          if (error) {
            lines.push(`- Sub-agent "${role}" failed: ${truncateOutput(error, 200)}`);
          } else {
            lines.push(`- Sub-agent "${role}" completed: ${output}`);
          }
        }
        break;
      case "tool.succeeded":
        lines.push(`- Tool "${payload.tool_name}" succeeded: ${output}`);
        break;
      case "tool.failed":
        lines.push(`- Tool "${payload.tool_name}" failed: ${output}`);
        break;
      case "signal.received":
        lines.push(`- Signal received: ${payload.signalType} from ${payload.source ?? "unknown"}`);
        break;
    }
  }

  lines.push("");
  lines.push("Continue from where you left off, accounting for the above.");
  lines.push("</recovery_context>");

  return lines.join("\n");
}
```

### Event Log Query for Recovery
```typescript
// Source: EventLog.query() interface in framework/types.ts
// Recommendation: Use type-filtered query for efficiency
const recoveryEvents = await eventLog.query(conv.id, {
  types: ["tool.succeeded", "tool.failed", "agent.completed", "signal.received"],
  afterSequence: conv.last_persisted_sequence ?? 0,
});
// This is efficient because:
// 1. type filter uses idx_agent_events_type index
// 2. afterSequence uses idx_agent_events_conversation (conversation_id, sequence)
// 3. Result set is bounded by one agent loop iteration (5-15 events typically)
```

### Custom Retry with Jitter
```typescript
// Full jitter: randomize between 0 and calculated delay
function calculateDelay(attempt: number, response?: Response): number {
  // Respect Retry-After header for 429
  if (response?.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      const retryAfterMs = Number.parseInt(retryAfter, 10) * 1000;
      if (retryAfterMs > 10000) {
        return -1; // Signal: don't retry, return error immediately
      }
      return Math.min(retryAfterMs, 10000);
    }
  }

  // Exponential backoff: 1s, 2s, 4s (attempt is 1-based)
  const baseDelay = 1000 * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(baseDelay, 10000);

  // Full jitter: uniform random between 0 and cappedDelay
  return Math.floor(Math.random() * cappedDelay);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `fetch-retry-ts` uniform retry | Custom retry with HTTP status classification | Phase 76 | Agents get structured errors for permanent failures, transparent retry for transient |
| `emitErrorActivity()` Linear-only | Denormalizer-based all-channel notification | Phase 76 | All three channels notified on failure |
| Resume with "continue where you left off" | Resume with `<recovery_context>` XML block | Phase 76 | Agent avoids re-doing completed work after crash |
| Worker loop `drain()` waits indefinitely | Drain with configurable timeout + abort signaling | Phase 76 | Clean shutdown even when LLM calls are slow |

**Existing infrastructure leveraged:**
- `reply_context` on conversation rows (added in Phase 62)
- `denormalize()` function (added in Phase 63)
- EventLog with `query()` and `afterSequence` support (added in Phase 37)
- `config.service.forceShutdownTimeoutMs` (added in Phase 40)
- AbortController/AbortSignal pattern (already used in worker loop line 1606)

## Open Questions

1. **MCP observability event emission location**
   - What we know: `callMcpTool` is a standalone function without EventLog access. Events need to be emitted from somewhere with EventLog access.
   - What's unclear: Whether to add a callback to `McpCallOptions` or emit from the tool execution layer.
   - Recommendation: Add an optional `onMcpEvent?: (event: McpObservabilityEvent) => void` callback to `McpCallOptions`. The worker loop provides this when constructing tool contexts. This keeps `callMcpTool` decoupled from the framework while enabling observability. The callback approach is simpler than an event emitter and matches the existing `onToolCall`/`onToolResult` pattern.

2. **Started-but-not-completed sub-agents in recovery context**
   - What we know: `agent.started` events exist for sub-agents, but `agent.completed` may not if the parent crashed before the sub-agent finished.
   - What's unclear: Whether to mention "sub-agent X is still running" or omit.
   - Recommendation: Omit. If a sub-agent started but didn't complete, it was spawned in-process (not via the executor) and died with the parent. The recovery context should only mention completed work. The agent will re-spawn if needed. Including "still running" would be misleading because the sub-agent is dead.

3. **New event types in schema enum**
   - What we know: The `agentEventTypeValues` enum in schema.ts is a TypeScript const array that maps to a TEXT column with enum constraint. Adding new types requires a migration.
   - What's unclear: Whether `notification.failed` and `mcp.*` types should be added to this same enum or stored differently.
   - Recommendation: Add to the same enum. The schema uses `text("type", { enum: agentEventTypeValues })` which creates a CHECK constraint in PostgreSQL. The migration adds the new values. This is consistent with how all other event types are handled and lets the dashboard render them uniformly.

4. **Whether to add `<recovery_context>` mention to agent system prompts**
   - What we know: Agents will see `<recovery_context>` blocks on resume but have no prompt guidance about what they are.
   - Recommendation: Add a brief mention. The `<task_context>` and `<active_delegations>` blocks are not explicitly mentioned in prompts either, but recovery context benefits from a one-line mention because agents need to know NOT to repeat the listed work. A single line like "On resume after an interruption, a `<recovery_context>` block describes work completed since your last checkpoint -- do not repeat it." in each orchestrator prompt is sufficient.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/agents/src/shared/mcp/client.ts` -- current MCP client with `fetch-retry-ts`
- Codebase inspection: `packages/agents/src/framework/worker-loop.ts` -- all failure paths, resume logic, drain
- Codebase inspection: `packages/agents/src/service/main.ts` -- shutdown sequence (lines 380-427)
- Codebase inspection: `packages/agents/src/shared/communication/denormalizer.ts` -- channel routing
- Codebase inspection: `packages/agents/src/framework/event-log.ts` -- query interface with afterSequence
- Codebase inspection: `packages/agents/src/shared/db/schema.ts` -- conversation columns, event types
- Codebase inspection: `packages/agents/src/shared/env/config.ts` -- `forceShutdownTimeoutMs` config

### Secondary (MEDIUM confidence)
- [fetch-retry-ts npm](https://www.npmjs.com/package/fetch-retry-ts) -- API docs confirming retryOn behavior and limitations
- `.planning/specs/2.8-agent-resilience.md` -- Phase 3 design for ISS-001, ISS-006, ISS-009

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all changes use existing patterns
- Architecture: HIGH -- all four work areas have clear attachment points in existing code
- Pitfalls: HIGH -- identified from direct codebase analysis, especially the 5 failure paths and drain/force-exit race
- MCP error handling: HIGH -- `fetch-retry-ts` behavior verified via source code and npm docs
- Recovery context: HIGH -- EventLog.query() with afterSequence verified in types.ts and event-log.ts

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable domain, all patterns are internal codebase)
