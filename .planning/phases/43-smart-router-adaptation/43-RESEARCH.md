# Phase 43: Smart Router Adaptation - Research

**Researched:** 2026-02-03
**Domain:** In-place refactoring of router/router.ts to wire adapters, EventRouter, and ConversationExecutor into routeEvent(), plus adding missing adapters for slow-path event types
**Confidence:** HIGH

## Summary

Phase 43 adapts the existing smart router (`packages/agents/src/router/`) to replace Temporal workflowClient with ConversationExecutor. This is primarily a wiring phase: all the building blocks exist from prior phases. Phase 42 created the adapters (Slack, GitHub, Linear), the EventRouter (`createEventRouter`), the adapted slow-path tools (`start-conversation`, `signal-conversation`, `query-conversations`), `routeViaAgentLoopV2()`, and `ROUTER_SYSTEM_PROMPT_V2`. Phase 40 created the `ConversationExecutor` interface. Phase 43 connects these into the top-level `routeEvent()` function.

The key changes are: (1) replace `router.ts`'s `routeEvent()` pipeline to use adapter -> EventRouter -> executor instead of `matchFastPath` -> `executeFastPath` with Temporal client, (2) add adapters for the remaining event types that Phase 42 left as null-returning (slack.message.created, linear.comment.created, linear.agent_session.prompted, github.pull_request.review_*), (3) implement the pass-through adapter for unmatched events, (4) remove MCP enrichment from the routing layer (per CONTEXT.md: agents fetch their own context), (5) implement the fire-and-forget slow-path with unified 200 response, and (6) add error/alert handling with generic Slack alerts for actual failures.

The phase is constrained by CONTEXT.md decisions: in-place modification (not rewrite), no MCP enrichment in routing, unified 200 responses, fire-and-forget slow-path, and specific error alerting patterns. Claude has discretion on exact adapter implementations for new event types, pass-through adapter structure, log levels, and response body shape.

**Primary recommendation:** Modify `router.ts` in-place with a new `routeEvent()` that runs the adapter pipeline, calls `EventRouter.handle()`, then dispatches results to executor.start()/signal()/slow-path. Add adapters for remaining event types in the existing adapter files. The pass-through adapter is a final fallback function after ALL_ADAPTERS.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aesir/agents framework | workspace:* | EventRouter, ConversationExecutor, adapters | All built in Phases 38-42, ready to wire |
| @aesir/types | workspace:* | NormalizedEvent, NormalizedEventSchema | Existing input validation |
| zod | existing | IncomingEvent validation, response schemas | Codebase standard |
| @aesir/platform | workspace:* | PinoLogger for structured logging | Codebase standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| callMcpTool (shared/mcp) | local | Slack alert sending for routing failures | Error alerting only -- NOT for MCP enrichment |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-place modification of router.ts | New file alongside old | CONTEXT.md locks in-place modification |
| callMcpTool for Slack alerts | Direct HTTP to Slack | callMcpTool already handles retry/backoff and is used by v2.2 router |
| Unified 200 for all paths | 200 fast-path / 202 slow-path (current) | CONTEXT.md locks unified 200 |

**Installation:**
No new packages required. All dependencies already exist in the project.

## Architecture Patterns

### Recommended File Structure
```
packages/agents/src/
  router/
    router.ts               # MODIFIED: New routeEvent() pipeline using adapter -> EventRouter -> executor
    types.ts                 # MODIFIED: Add RouteEventDeps (superset of EventRouterDeps + EventRouter)
    main.ts                  # NOT MODIFIED in Phase 43 (Phase 44 replaces this with single service)
    fast-path.ts             # PRESERVED: Old code remains until Phase 47 cleanup
    slow-path.ts             # PRESERVED: routeViaAgentLoopV2() already exists from Phase 42
    system-prompt.ts         # PRESERVED: ROUTER_SYSTEM_PROMPT_V2 already exists from Phase 42
    tools/                   # PRESERVED: New tools from Phase 42 coexist with old
    index.ts                 # MODIFIED: Export new routeEvent dependencies
  adapters/
    slack.ts                 # MODIFIED: Add slack.message.created handler
    github.ts                # MODIFIED: Add github.pull_request.review_* handlers
    linear.ts                # MODIFIED: Add linear.comment.created, linear.agent_session.prompted handlers
    pass-through.ts          # NEW: Fallback adapter for unmatched events
    types.ts                 # UNCHANGED
    index.ts                 # MODIFIED: Export pass-through adapter, update ALL_ADAPTERS
```

### Pattern 1: Adapted routeEvent() Pipeline
**What:** The new `routeEvent()` replaces the old fast-path/slow-path dispatch with a unified adapter -> EventRouter -> executor pipeline. This is the core of Phase 43.
**When to use:** Every incoming event.
**Example:**
```typescript
// Source: CONTEXT.md wiring strategy + existing router.ts structure

import type { NormalizedEvent } from "@aesir/types";
import { ALL_ADAPTERS } from "../adapters/index.js";
import { adaptPassThrough } from "../adapters/pass-through.js";
import type { IncomingEvent } from "../adapters/types.js";
import { routeViaAgentLoopV2 } from "./slow-path.js";
import type { RouteEventDeps } from "./types.js";

export async function routeEvent(
  event: NormalizedEvent,
  deps: RouteEventDeps,
): Promise<RouteEventResult> {
  const eventLogger = deps.logger.child({
    eventId: event.id,
    eventType: event.type,
    source: event.source,
  });

  eventLogger.info("Routing event");

  // 1. Adapt: NormalizedEvent -> IncomingEvent
  let incomingEvent: IncomingEvent | null = null;
  for (const adapter of ALL_ADAPTERS) {
    incomingEvent = adapter(event);
    if (incomingEvent) break;
  }

  // Fallback: pass-through adapter wraps raw event for slow-path
  if (!incomingEvent) {
    incomingEvent = adaptPassThrough(event);
  }

  // 2. Route: IncomingEvent -> EventRouterRouteResult
  const result = deps.eventRouter.handle(incomingEvent);

  // 3. Execute: dispatch based on routing decision
  try {
    switch (result.action) {
      case "start":
        return await handleStart(result, deps, eventLogger);
      case "signal":
        return await handleSignal(result, deps, eventLogger);
      case "slow_path":
        return handleSlowPath(event, deps, eventLogger);
      case "ignore":
        eventLogger.debug({ reason: result.reason }, "Event ignored");
        return { received: true, action: "ignored" };
    }
  } catch (error) {
    return await handleRoutingError(event, error, deps, eventLogger);
  }
}
```

### Pattern 2: Minimal Initial Message (No MCP Enrichment)
**What:** The router passes a minimal initial message to executor.start(). The agent fetches its own context as its first action.
**When to use:** All start actions in the new routeEvent().
**Example:**
```typescript
// Source: CONTEXT.md "MCP enrichment removed from routing" decision

async function handleStart(
  result: StartRouteResult,
  deps: RouteEventDeps,
  logger: PinoLogger,
): Promise<RouteEventResult> {
  // Minimal message -- agent fetches its own context via tools
  const conversationId = await deps.executor.start({
    agentDefinitionId: result.agentDefinitionId,
    correlationKey: result.correlationKey,
    initialMessage: result.message,
  });

  logger.info(
    { conversationId, agentDefinitionId: result.agentDefinitionId },
    "Conversation started",
  );

  return {
    received: true,
    action: "started",
    conversationId,
  };
}
```

### Pattern 3: Fire-and-Forget Slow-Path
**What:** When EventRouter returns slow_path, routeEvent() spawns the LLM classification in the background and returns 200 immediately.
**When to use:** All slow_path routing decisions.
**Example:**
```typescript
// Source: CONTEXT.md "Slow-path is fire-and-forget" decision

function handleSlowPath(
  event: NormalizedEvent,
  deps: RouteEventDeps,
  logger: PinoLogger,
): RouteEventResult {
  // Fire and forget -- return immediately, process in background
  void routeViaAgentLoopV2(event, deps).catch((error) => {
    logger.error(
      { err: error, eventId: event.id, eventType: event.type },
      "Slow-path background routing failed",
    );
    // Best-effort alert for actual failures
    void sendRoutingAlert(event, deps, error);
  });

  return { received: true, action: "classifying" };
}
```

### Pattern 4: Pass-Through Adapter
**What:** A fallback adapter that wraps any unmatched NormalizedEvent as a generic IncomingEvent, preserving the original dotted type. This ensures all events flow through the same pipeline.
**When to use:** When no specific adapter (Slack, GitHub, Linear) matches the event.
**Example:**
```typescript
// Source: CONTEXT.md "Pass-through adapter for unmatched events" decision

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

/**
 * Fallback adapter for events not handled by specific adapters.
 * Wraps the raw NormalizedEvent as a generic IncomingEvent, preserving
 * the original dotted type. EventRouter will naturally return slow_path
 * for these since they won't match any start or signal rules.
 */
export function adaptPassThrough(event: NormalizedEvent): IncomingEvent {
  return {
    type: event.type,
    data: (event.payload as Record<string, unknown>) ?? {},
    source: `${event.source}:webhook`,
    deduplicationId: event.correlationId,
    // No correlationKey -- unresolvable, goes to slow_path
  };
}
```

### Pattern 5: New Slow-Path Adapter (Domain Normalization)
**What:** Adding cases to existing adapters for events that go to slow-path but should arrive in domain language rather than raw integration format.
**When to use:** Events whose event type is clear but whose routing action requires LLM content analysis.
**Example:**
```typescript
// Source: CONTEXT.md "Missing adapters" decision

// In slack.ts -- add case for slack.message.created
case "slack.message.created": {
  const threadTs = payload.threadTs as string | undefined;
  const ts = payload.ts as string;
  return {
    type: "thread_reply",
    data: {
      text: payload.text,
      userId: payload.user,
      channelId: payload.channel,
      threadTs: threadTs ?? ts,
    },
    source: "slack:webhook",
    correlationKey: threadTs, // undefined for non-thread messages
    deduplicationId: event.correlationId,
    message: payload.text as string,
  };
}

// In github.ts -- add case for PR review events
case "github.pull_request.review_approved":
case "github.pull_request.review_changes_requested":
case "github.pull_request.review_commented":
case "github.pull_request.review_dismissed": {
  const prNumber = payload.prNumber as number;
  const branchName = (payload as Record<string, unknown>).branchName as string | undefined;
  const branchMatch = branchName?.match(BRANCH_TASK_REGEX);
  return {
    type: "pr_review",
    data: {
      reviewState: payload.reviewState,
      reviewBody: payload.reviewBody,
      reviewerLogin: payload.reviewerLogin,
      prNumber,
    },
    source: "github:webhook",
    correlationKey: branchMatch?.[1], // may be undefined -> slow_path
    deduplicationId: event.correlationId,
    message: `PR #${prNumber} review (${payload.reviewState}): ${payload.reviewBody || "(no comment)"}`,
  };
}

// In linear.ts -- add cases for comment.created and agent_session.prompted
case "linear.comment.created": {
  const issueId = payload.issueId as string;
  return {
    type: "issue_comment",
    data: {
      body: payload.body,
      userId: payload.userId,
      issueId,
    },
    source: "linear:webhook",
    correlationKey: issueId,
    deduplicationId: event.correlationId,
    message: payload.body as string,
  };
}

case "linear.agent_session.prompted": {
  const issueId = payload.issueId as string;
  return {
    type: "agent_prompt",
    data: {
      issueId,
      prompt: payload.prompt ?? payload.body,
    },
    source: "linear:webhook",
    correlationKey: issueId,
    deduplicationId: event.correlationId,
    message: (payload.prompt ?? payload.body) as string,
  };
}
```

### Pattern 6: Error Handling with Generic Slack Alerts
**What:** Routing failures send a single generic Slack alert. Idempotent results (already exists, deduplicated) are logged only.
**When to use:** All error paths in routeEvent().
**Example:**
```typescript
// Source: CONTEXT.md error & alert handling decisions

async function handleRoutingError(
  event: NormalizedEvent,
  error: unknown,
  deps: RouteEventDeps,
  logger: PinoLogger,
): Promise<RouteEventResult> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  logger.error(
    { eventId: event.id, eventType: event.type, err: error },
    `Routing failure: ${errorMessage}`,
  );

  // Generic alert for ops team -- no stack traces
  await sendRoutingAlert(event, deps, error);

  return { received: true, action: "error" };
}

async function sendRoutingAlert(
  event: NormalizedEvent,
  deps: RouteEventDeps,
  error: unknown,
): Promise<void> {
  if (!deps.alertsChannel) return;

  try {
    await callMcpTool({
      integration: "slack",
      tool: "send_message",
      params: {
        channel: deps.alertsChannel,
        text: `Something went wrong processing event ${event.type} (${event.id}). Check logs.`,
      },
      agentId: "router",
      correlationId: event.correlationId,
    });
  } catch {
    // Best-effort -- swallow alert send failures
    deps.logger.warn({ eventId: event.id }, "Failed to send routing alert");
  }
}
```

### Anti-Patterns to Avoid
- **Don't call MCP enrichment in routeEvent():** Per CONTEXT.md, agents fetch their own context. The old `executeFastPath()` fetched issue details via callMcpTool -- this is explicitly removed.
- **Don't modify fast-path.ts or executeFastPath():** Old code is preserved for Phase 47 cleanup. Phase 43 wires the new pipeline alongside it.
- **Don't create interface abstractions for slow-path invocation:** Per CONTEXT.md, direct call to `routeViaAgentLoopV2()` -- no unnecessary abstraction.
- **Don't return different HTTP status codes for different paths:** Per CONTEXT.md, unified 200 for all paths.
- **Don't include stack traces in Slack alerts:** Per CONTEXT.md, generic messages for ops team.
- **Don't alert on idempotent results:** Conversation already exists or signal deduplicated should be logged only, not alerted.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Adapter pipeline | Custom event dispatch | ALL_ADAPTERS array + pass-through fallback | Phase 42 built the adapter infrastructure |
| Event routing decisions | Custom matching logic | EventRouter.handle() | Phase 42 built the EventRouter with start/signal/ignore/slow_path |
| Conversation start/signal | Custom executor calls | ConversationExecutor.start()/signal() | Phase 40 built the executor with idempotency, dedup, queueing |
| Slow-path LLM routing | Custom LLM integration | routeViaAgentLoopV2() | Phase 42 adapted the slow-path with conversation tools and ROUTER_SYSTEM_PROMPT_V2 |
| Slack alerts | Custom Slack HTTP calls | callMcpTool() with integration "slack" | Already handles retry, backoff, MCP permissions |
| NormalizedEvent validation | Custom parsing | NormalizedEventSchema.safeParse() | Already exists in @aesir/types |
| Domain signal types | Custom mapping | SIGNAL_AGENT_MAP in EventRouter | Phase 42 established the signal-to-agent mapping |
| Branch name task extraction | Custom regex | BRANCH_TASK_REGEX from adapters/github.ts | Already tested pattern from Phase 42 |

**Key insight:** Phase 43 is a wiring phase. Every building block exists. The phase's value is connecting them correctly and adding the missing adapter cases. Zero new infrastructure is needed.

## Common Pitfalls

### Pitfall 1: Accidentally Keeping MCP Enrichment
**What goes wrong:** The dev-agent start path still fetches issue details via MCP before calling executor.start(), adding latency and violating the agent-first principle.
**Why it happens:** The old `executeFastPath()` has 50+ lines of MCP enrichment code. It's easy to carry over during the rewrite.
**How to avoid:** The new handleStart() must pass only `result.message` (from EventRouter) as the initialMessage. No callMcpTool calls. The adapter's message field (e.g., "New agent session created for issue ABC-123") provides just enough context for the agent to know what to fetch.
**Warning signs:** Any `callMcpTool` import or call in the new routeEvent pipeline (excluding Slack alerts).

### Pitfall 2: Slow-Path Blocks HTTP Response
**What goes wrong:** routeViaAgentLoopV2() is awaited before returning the HTTP response, causing 3-10 second delays for webhook callers.
**Why it happens:** The natural pattern is `await routeViaAgentLoopV2()` -- forgetting the fire-and-forget requirement.
**How to avoid:** Use `void routeViaAgentLoopV2().catch(...)` -- no await. Return `{ received: true, action: "classifying" }` immediately.
**Warning signs:** Webhook callers (integration dispatchers) timing out on slow-path events.

### Pitfall 3: routeViaAgentLoopV2 Gets Wrong Dependencies
**What goes wrong:** `routeViaAgentLoopV2()` takes `EventRouterDeps` (which has `executor`). If called with `RouterDeps` (which has `workflowClient`), it fails at runtime.
**Why it happens:** The old `routeViaAgentLoop()` takes `RouterDeps`. The new one takes `EventRouterDeps`. The types look similar but are incompatible.
**How to avoid:** The new `RouteEventDeps` interface should extend `EventRouterDeps` (or include executor). Pass the correct deps type to routeViaAgentLoopV2. TypeScript will catch this at compile time if types are correct.
**Warning signs:** Runtime "executor is undefined" errors in slow-path routing.

### Pitfall 4: Missing correlationKey on New Adapter Events
**What goes wrong:** A new adapter case (e.g., `slack.message.created` without threadTs) produces an IncomingEvent with no correlationKey. The EventRouter returns slow_path, but the slow-path LLM can't derive a conversation ID from the event.
**Why it happens:** Not all events have natural correlation keys. A top-level Slack message (no threadTs) has no existing conversation to correlate with.
**How to avoid:** This is expected behavior. The slow-path LLM handles this -- it uses `query_conversations` to find existing conversations or determines the event should be ignored. The adapter should set correlationKey only when it genuinely exists.
**Warning signs:** If you find yourself inventing correlation keys (e.g., using the event ID), that's wrong.

### Pitfall 5: GitHub PR Review State Types Not Matching
**What goes wrong:** The GitHub integration normalizer produces `github.pull_request.review_approved`, `github.pull_request.review_changes_requested`, etc. (with state suffix). The adapter needs to handle all four variants.
**Why it happens:** The GitHub normalizer uses `github.pull_request.review_${state}` where state is `approved`, `changes_requested`, `commented`, or `dismissed`. There's also a `github.pull_request.review_submitted` type. That's five total event types for PR reviews.
**How to avoid:** Handle all five PR review event types in the GitHub adapter. Use a switch fallthrough or check for the `github.pull_request.review_` prefix. Map all to domain type `"pr_review"` with the review state in the data field.
**Warning signs:** PR review events falling through to the pass-through adapter instead of being normalized to domain language.

### Pitfall 6: Old routeEvent() Signature Incompatible with New
**What goes wrong:** The old `routeEvent(event, deps: RouterDeps): Promise<RouteResult>` has a different deps type and return type than the new one. Callers break.
**Why it happens:** In-place modification means the function signature changes.
**How to avoid:** Phase 43 changes the signature to use the new `RouteEventDeps` and `RouteEventResult`. Since this code won't be live until Phase 44 wires the single service, there's no immediate caller breakage. But the old `main.ts` (which calls routeEvent) should NOT be modified -- it will be replaced in Phase 44.
**Warning signs:** TypeScript errors in `router/main.ts` -- these are expected and should be left. Phase 44 replaces main.ts entirely.

### Pitfall 7: Forgetting to Call EventRouter.loadStartRules()
**What goes wrong:** The EventRouter is created but loadStartRules() is never called. All start events fall through to slow_path because startRules is an empty Map.
**Why it happens:** loadStartRules() is an async init method that must be called before handle(). Easy to forget when wiring dependencies.
**How to avoid:** Phase 43 should NOT call loadStartRules() -- that's Phase 44's job (single service bootstrap). Phase 43 modifies routeEvent() to take a pre-initialized EventRouter via deps. The caller (Phase 44) is responsible for initialization.
**Warning signs:** All `linear.agent_session.created` events going to slow_path instead of starting conversations.

### Pitfall 8: Alerting on Idempotent Results
**What goes wrong:** executor.start() returns an existing conversation ID (idempotent), but routeEvent() treats this as an error and sends a Slack alert.
**Why it happens:** executor.start() is designed to be idempotent -- same correlationKey returns the same ID. This is success, not failure.
**How to avoid:** Only alert on actual errors (exceptions thrown by executor). Idempotent results and "deduplicated" signal results should be logged at info/debug level, not alerted.
**Warning signs:** Slack channel flooded with alerts for duplicate webhook deliveries.

## Code Examples

Verified patterns from the codebase:

### Complete RouteEventDeps Interface
```typescript
// Source: Existing EventRouterDeps + new dependencies needed by routeEvent()

import type { PinoLogger } from "@aesir/platform";
import type { ConversationExecutor, EventRouter } from "../framework/types.js";

/**
 * Dependencies for the adapted routeEvent() function.
 * Extends EventRouterDeps with the EventRouter itself and alerts config.
 */
export interface RouteEventDeps {
  /** ConversationExecutor for start/signal operations */
  executor: ConversationExecutor;
  /** EventRouter for routing decisions (must have loadStartRules() called) */
  eventRouter: EventRouter;
  /** Pino logger instance */
  logger: PinoLogger;
  /** Slack channel ID for routing failure alerts (optional) */
  alertsChannel?: string | undefined;
  /** Linear team ID for product-agent starts (optional, legacy) */
  linearTeamId?: string | undefined;
}
```

### Complete RouteEventResult Interface
```typescript
// Source: CONTEXT.md HTTP response model decisions

/**
 * Result returned by routeEvent(). Used as HTTP response body.
 */
export interface RouteEventResult {
  /** Always true -- webhook callers just need ack */
  received: true;
  /** What happened: started, signaled, classifying, ignored, error */
  action: "started" | "signaled" | "classifying" | "ignored" | "error";
  /** Conversation ID when a conversation was started or signaled */
  conversationId?: string;
}
```

### Full Event Type Inventory (Current System)
```typescript
// Source: Integration dispatcher routes + adapter analysis

// Events from Slack dispatcher:
// 1. slack.message.created         -> Phase 42: null (slow-path). Phase 43: "thread_reply" adapter
// 2. slack.app_mention.created     -> Phase 42: "slack.app_mention.created" (start trigger)
// 3. slack.block_actions.approved  -> Phase 42: "approval" (signal)
// 4. slack.block_actions.rejected  -> Phase 42: "approval" (signal)
// 5. slack.block_actions.escalation_retry  -> Phase 42: "escalation_resolved" (signal)
// 6. slack.block_actions.escalation_abort  -> Phase 42: "escalation_resolved" (signal)

// Events from GitHub dispatcher:
// 7.  github.pull_request.merged    -> Phase 42: "pr_merged" (signal)
// 8.  github.pull_request.closed    -> Phase 42: "pr_closed" (signal)
// 9.  github.pull_request.review_submitted  -> Phase 42: null. Phase 43: "pr_review" adapter
// 10. github.pull_request.review_approved   -> Phase 42: not handled. Phase 43: "pr_review" adapter
// 11. github.pull_request.review_changes_requested -> Phase 42: not handled. Phase 43: "pr_review" adapter
// 12. github.pull_request.review_commented  -> Phase 42: not handled. Phase 43: "pr_review" adapter
// 13. github.pull_request.review_dismissed  -> Phase 42: not handled. Phase 43: "pr_review" adapter

// Events from Linear dispatcher:
// 14. linear.agent_session.created  -> Phase 42: "linear.agent_session.created" (start trigger)
// 15. linear.agent_session.prompted -> Phase 42: not handled. Phase 43: "agent_prompt" adapter
// 16. linear.issue.created          -> Phase 42: "linear.issue.created" (IGNORE_EVENT_TYPES)
// 17. linear.issue.updated          -> Phase 42: "linear.issue.updated" (IGNORE_EVENT_TYPES)
// 18. linear.comment.created        -> Phase 42: null (slow-path). Phase 43: "issue_comment" adapter

// Phase 43 NEW adapters needed (events returning null in Phase 42):
// - slack.message.created -> "thread_reply" (slow-path, but normalized)
// - github.pull_request.review_* (5 variants) -> "pr_review" (slow-path for most)
// - linear.comment.created -> "issue_comment" (slow-path)
// - linear.agent_session.prompted -> "agent_prompt" (slow-path)
```

### GitHub PR Review Adapter with State Handling
```typescript
// Source: GitHub normalizer produces review_${state} types

// Note: GitHub normalizer creates FIVE distinct types for PR reviews:
// github.pull_request.review_submitted (generic)
// github.pull_request.review_approved
// github.pull_request.review_changes_requested
// github.pull_request.review_commented
// github.pull_request.review_dismissed
//
// The adapter should handle all five, normalizing to "pr_review" domain type.
// The review state is preserved in data.reviewState for the slow-path LLM.

// Important: github.pull_request.review_submitted might have a branchName
// in its payload if the normalizer includes head.ref. The PR review normalizer
// (normalizePRReviewEvent) does NOT include branchName in its payload -- it
// only has prNumber, prTitle, prUrl, reviewId, reviewState, reviewBody,
// reviewerLogin, and repository. So correlationKey extraction from branch
// name is NOT possible for PR reviews. They must go to slow_path.
//
// However, the LLM slow-path can derive the conversation ID by:
// 1. Looking at prNumber in the data
// 2. Querying conversations to find a dev-agent conversation handling that PR
// This is exactly what the slow-path LLM does today.
```

### Interaction Between routeEvent() and main.ts
```typescript
// Source: Existing main.ts analysis

// IMPORTANT: router/main.ts currently creates RouterDeps with Temporal client
// and calls routeEvent(event, routerDeps). Phase 43 changes routeEvent()'s
// signature to require RouteEventDeps (with executor + eventRouter).
//
// This means main.ts WILL HAVE TYPE ERRORS after Phase 43.
// This is intentional and expected:
// - Phase 43 code won't be live until Phase 44
// - Phase 44 creates a new main.ts (single service) that provides RouteEventDeps
// - router/main.ts is NOT modified in Phase 43
//
// The old routeEvent import in main.ts will show TypeScript errors.
// The old fast-path.ts, executeFastPath, matchFastPath remain importable
// for the old main.ts if needed during transition.
```

## State of the Art

| Old Approach (v2.2 router) | New Approach (Phase 43) | When Changed | Impact |
|---|---|---|---|
| `routeEvent()` calls `matchFastPath()` then `executeFastPath()` with Temporal | `routeEvent()` runs adapter pipeline -> `EventRouter.handle()` -> executor | Phase 43 | Temporal removed from routing |
| `executeFastPath()` fetches issue details via MCP before dev-agent start | `handleStart()` passes minimal message, agent fetches own context | Phase 43 | Simpler routing, agent-first principle |
| Slow-path returns 202 Accepted, processed async | Unified 200 for all paths, slow-path still fire-and-forget | Phase 43 | Simpler HTTP model |
| `RouterDeps` with `workflowClient: Client` | `RouteEventDeps` with `executor: ConversationExecutor` + `eventRouter: EventRouter` | Phase 43 | Clean dependency injection |
| Events not matching fast-path go directly to LLM with raw NormalizedEvent | Events normalized by adapter first, then EventRouter, then slow-path if needed | Phase 43 | Domain-language events throughout pipeline |
| `sendRoutingAlert()` includes detailed error messages | Generic "Something went wrong" alerts, details in logs only | Phase 43 | Ops-friendly alerts, no information leaks |

**Deprecated/outdated (after Phase 43 modification):**
- `routeEvent()` old signature (RouterDeps) -- replaced with RouteEventDeps
- `executeFastPath()` usage in routeEvent -- replaced by EventRouter + executor
- `matchFastPath()` usage in routeEvent -- replaced by adapter + EventRouter pipeline
- MCP enrichment in routing layer -- agents fetch their own context
- 202 Accepted for slow-path -- unified 200

**Preserved until Phase 47 cleanup:**
- `fast-path.ts` (DETERMINISTIC_RULES, matchFastPath, executeFastPath)
- Old Temporal-based router tools (start-workflow.ts, signal-workflow.ts, query-workflows.ts)
- `RouterDeps` interface
- `RouteResult` interface (old)
- `ROUTER_SYSTEM_PROMPT` (v1)
- `routeViaAgentLoop()` (v1)

## Open Questions

Things that couldn't be fully resolved:

1. **Should router/main.ts be modified to avoid TypeScript errors?**
   - What we know: Phase 43 changes routeEvent()'s signature. main.ts calls routeEvent. Phase 44 replaces main.ts entirely.
   - What's unclear: Should Phase 43 leave main.ts broken (TypeScript errors) or add a temporary compatibility shim?
   - Recommendation: Leave main.ts untouched. Phase 43 code won't be live until Phase 44. TypeScript errors in main.ts are expected and harmless since main.ts won't be used after Phase 44. However, ensure `pnpm run typecheck` still passes for the overall project -- this may require making the old routeEvent a differently-named export (e.g., `routeEventV1`) or keeping the old signature as a separate export.

2. **Should the old routeEvent be renamed or kept alongside the new one?**
   - What we know: In-place modification means changing the existing function. But main.ts imports it. The codebase uses both old and new router code during transition.
   - What's unclear: Whether to have one routeEvent (new signature, breaks main.ts) or two (routeEvent + routeEventV2).
   - Recommendation: Replace routeEvent in-place and rename the old one to `routeEventLegacy` with `@deprecated` JSDoc. Update main.ts's import to use routeEventLegacy. This keeps typecheck passing while clearly marking the migration path.

3. **How should routeViaAgentLoopV2 receive EventRouterDeps from RouteEventDeps?**
   - What we know: routeViaAgentLoopV2 takes `EventRouterDeps` (executor + logger + alertsChannel + linearTeamId). RouteEventDeps is a superset (adds eventRouter).
   - What's unclear: Can RouteEventDeps be passed directly to routeViaAgentLoopV2?
   - Recommendation: Yes -- RouteEventDeps extends/overlaps with EventRouterDeps. TypeScript structural typing means RouteEventDeps satisfies EventRouterDeps. No adaptation needed.

4. **Domain type for slack.message.created -- "thread_reply" or preserve original type?**
   - What we know: CONTEXT.md says adapters normalize to domain language (e.g., `github.issue_comment.created` -> `"issue_comment"`). But slack.message.created can be both thread replies (has threadTs) and top-level messages (no threadTs).
   - What's unclear: Should these be separate domain types?
   - Recommendation: Use `"thread_reply"` for messages with threadTs, and `"channel_message"` for messages without. This gives the slow-path LLM clearer intent signals. Both still go to slow_path since neither is in SIGNAL_AGENT_MAP or start rules.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/agents/src/router/router.ts` -- Current routeEvent() implementation being modified
- Existing codebase: `packages/agents/src/router/fast-path.ts` -- DETERMINISTIC_RULES (10 rules) and executeFastPath() being replaced
- Existing codebase: `packages/agents/src/router/types.ts` -- RouterDeps, EventRouterDeps, RouteResult types
- Existing codebase: `packages/agents/src/router/slow-path.ts` -- routeViaAgentLoopV2() already exists
- Existing codebase: `packages/agents/src/router/system-prompt.ts` -- ROUTER_SYSTEM_PROMPT_V2 already exists
- Existing codebase: `packages/agents/src/router/tools/` -- start-conversation, signal-conversation, query-conversations already exist
- Existing codebase: `packages/agents/src/adapters/` -- ALL_ADAPTERS, adapter functions, IncomingEvent type
- Existing codebase: `packages/agents/src/framework/event-router.ts` -- createEventRouter, SIGNAL_AGENT_MAP
- Existing codebase: `packages/agents/src/framework/types.ts` -- ConversationExecutor, EventRouter, EventRouterRouteResult
- Integration dispatchers: `packages/integrations/{linear,github,slack}/src/dispatcher/routes.ts` -- All 18 event types flowing through system
- GitHub normalizer: `packages/integrations/github/src/dispatcher/normalize.ts` -- PR review state-based type generation
- Phase 42 summaries: 42-01, 42-02, 42-03 -- What was built and what's available
- Phase 40 research: ConversationExecutor patterns and interface
- Phase 43 CONTEXT.md: All locked implementation decisions

### Secondary (MEDIUM confidence)
- v2.3 spec Section A.6: "Smart Router: Why Adapt, Not Rewrite" -- Architectural rationale
- v2.3 spec Section 5: EventRouter interface definition

### Tertiary (LOW confidence)
- None -- all findings verified against existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All components already exist in the codebase, no new dependencies
- Architecture: HIGH -- Building blocks are implemented; Phase 43 is pure wiring with clear CONTEXT.md decisions
- Pitfalls: HIGH -- Derived from direct analysis of existing code patterns, dependency types, and integration dispatcher event types
- Code examples: HIGH -- Derived directly from existing router.ts, adapter implementations, and CONTEXT.md decisions

**Research date:** 2026-02-03
**Valid until:** 2026-03-05 (stable domain -- in-project wiring, no external library concerns)
