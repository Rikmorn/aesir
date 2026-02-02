# Phase 42: Event Router + Adapters - Research

**Researched:** 2026-02-02
**Domain:** Adapter pattern (NormalizedEvent to IncomingEvent), deterministic event routing, correlation-based signal routing, AgentRegistry trigger rules
**Confidence:** HIGH

## Summary

Phase 42 creates three adapters (Slack, GitHub, Linear) that transform existing `NormalizedEvent` objects into domain-language `IncomingEvent` types, and an `EventRouter` that matches events against agent trigger rules for start or correlation-based signal delivery. The adapters are thin mappers -- they consume `NormalizedEvent` (dotted types like `slack.block_actions.approved`) and produce `IncomingEvent` (domain types like `"approval"`). The EventRouter replaces the existing `routeEvent()` function and `executeFastPath()` by using `ConversationExecutor.start()` and `ConversationExecutor.signal()` instead of Temporal's `workflowClient`.

This is a well-scoped refactoring phase. The existing fast-path rules in `packages/agents/src/router/fast-path.ts` define exactly what needs to be handled deterministically (10 rules covering 8 actionable event types + 2 ignore rules). The existing router infrastructure (slow-path LLM routing, system prompt, ROUT-06 failure handling) carries forward with minimal changes. The `NormalizedEvent` schema in `@aesir/types` is the adapter input, and the `IncomingEvent` type from the v2.3 spec is the adapter output. The `ConversationExecutor` interface (from Phase 40) provides `start()` and `signal()` methods that replace Temporal calls. The `AgentRegistry` (from Phase 38) provides trigger rules via the `triggers` field on `AgentDefinition`.

No new external dependencies are needed. This phase operates entirely within the `@aesir/agents` package using existing framework components (AgentRegistry, ToolRegistry, ConversationExecutor) and existing types (NormalizedEvent from `@aesir/types`).

**Primary recommendation:** Build adapters as pure functions (`NormalizedEvent -> IncomingEvent | null`), build EventRouter as a factory function that loads start rules from AgentRegistry triggers and delegates to adapters + ConversationExecutor. Keep the slow-path unchanged except for swapping Temporal tools to executor tools. The MCP enrichment pattern (fetching issue details before dev-agent start) carries forward in the EventRouter's start-action handler.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | existing | Validate IncomingEvent shape, adapter outputs | Already used throughout codebase for all validation |
| @aesir/types | workspace:* | NormalizedEvent source type consumed by adapters | Existing package, NormalizedEventSchema already defined |
| @aesir/platform | workspace:* | PinoLogger for router/adapter logging | Existing dependency |
| @aesir/agents framework | local | ConversationExecutor, AgentRegistry, Signal type | Built in Phases 37-41 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aesir/agents shared/mcp | local | `callMcpTool` for MCP enrichment (issue detail fetch before start) | Dev-agent start enrichment |
| @aesir/agents shared/agent-loop | local | `runAgentLoop` for slow-path LLM routing | Ambiguous events that need LLM classification |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure adapter functions | Class-based adapters | Functions are simpler, match codebase patterns, and adapters are stateless transforms |
| Re-using NormalizedEvent type for adapters | Creating a narrower input type | NormalizedEvent is already the exact input format; narrowing adds complexity without value |
| Loading triggers from AgentRegistry at init | Hardcoding trigger-to-agent mappings | Registry-based is spec-mandated and supports adding new agents without code changes |

**Installation:**
No new packages required. All dependencies already exist in the project.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
  adapters/                       # NEW: Webhook payload adapters
    slack.ts                      # Slack NormalizedEvent -> IncomingEvent
    slack.test.ts                 # Slack adapter tests
    github.ts                     # GitHub NormalizedEvent -> IncomingEvent
    github.test.ts                # GitHub adapter tests
    linear.ts                     # Linear NormalizedEvent -> IncomingEvent
    linear.test.ts                # Linear adapter tests
    types.ts                      # IncomingEvent type + shared adapter types
    index.ts                      # Barrel export
  framework/
    event-router.ts               # NEW: EventRouter implementation
    event-router.test.ts          # NEW: EventRouter tests
    types.ts                      # MODIFIED: Add EventRouter interface
    index.ts                      # MODIFIED: Add new exports
  router/                         # MODIFIED: Slow-path adapted to use executor
    types.ts                      # MODIFIED: RouterDeps uses executor instead of Temporal
    tools/
      start-conversation.ts       # RENAMED from start-workflow.ts
      signal-conversation.ts      # RENAMED from signal-workflow.ts
      query-conversations.ts      # RENAMED from query-workflows.ts
      send-message.ts             # UNCHANGED
    slow-path.ts                  # MODIFIED: Updated tool imports
    system-prompt.ts              # MODIFIED: "workflow" -> "conversation" terminology
```

### Pattern 1: IncomingEvent Type Definition
**What:** The unified event shape that adapters produce and the EventRouter consumes. This is the domain-language event type from the v2.3 spec.
**When to use:** Every event flowing through the router pipeline after adapter transformation.
**Example:**
```typescript
// Source: v2.3 spec Section 6 (Signal Handling)
import { z } from "zod";

export const IncomingEventSchema = z.object({
  /** Domain-language event type (e.g., "approval", "pr_merged", "user_reply") */
  type: z.string().min(1),
  /** Event-specific payload data */
  data: z.record(z.unknown()),
  /** Origin of the event (e.g., "slack:webhook", "github:webhook") */
  source: z.string().min(1),
  /** Raw correlation key for conversation ID resolution (e.g., issueId, threadTs) */
  correlationKey: z.string().optional(),
  /** Idempotency key for deduplication (webhook delivery ID) */
  deduplicationId: z.string().optional(),
  /** Human-readable description for agent context on resume */
  message: z.string().optional(),
});

export type IncomingEvent = z.infer<typeof IncomingEventSchema>;
```

### Pattern 2: Adapter as Pure Function
**What:** Each adapter is a pure function that transforms a `NormalizedEvent` to an `IncomingEvent` (or returns null if the event is unhandled).
**When to use:** Every integration-specific event transformation.
**Example:**
```typescript
// Source: v2.3 spec Section 6, existing fast-path.ts payload structures

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

/**
 * Transform a Slack NormalizedEvent into a domain-language IncomingEvent.
 * Returns null if the event type is not recognized by this adapter.
 */
export function adaptSlackEvent(event: NormalizedEvent): IncomingEvent | null {
  if (event.source !== "slack") return null;

  switch (event.type) {
    case "slack.block_actions.approved": {
      const payload = event.payload as { taskIdentifier: string };
      return {
        type: "approval",
        data: { approved: true, source: "slack" },
        source: "slack:webhook",
        correlationKey: payload.taskIdentifier,
        deduplicationId: event.correlationId,
        message: `Plan approved via Slack button.`,
      };
    }
    case "slack.block_actions.rejected": {
      const payload = event.payload as { taskIdentifier: string };
      return {
        type: "approval",
        data: { approved: false, feedback: "Rejected via Slack button", source: "slack" },
        source: "slack:webhook",
        correlationKey: payload.taskIdentifier,
        deduplicationId: event.correlationId,
        message: `Plan rejected via Slack button. Feedback: Rejected via Slack button`,
      };
    }
    case "slack.app_mention.created": {
      const payload = event.payload as {
        channel: string; user: string; text: string;
        ts: string; threadTs?: string; teamId: string;
      };
      const threadTs = payload.threadTs || payload.ts;
      return {
        type: "slack.app_mention.created",  // Start events keep their original type
        data: {
          threadTs, channelId: payload.channel,
          initialMessage: payload.text, userId: payload.user,
          slackTeamId: payload.teamId,
        },
        source: "slack:webhook",
        correlationKey: threadTs,
        deduplicationId: event.correlationId,
        message: payload.text,
      };
    }
    // ... escalation buttons, thread replies (forwarded for slow-path)
    default:
      return null;
  }
}
```

### Pattern 3: EventRouter with Start Rules from AgentRegistry
**What:** The EventRouter loads trigger rules from registered agent definitions, mapping event types to agent IDs. For signal events, it constructs conversation IDs from the adapter-provided correlation key.
**When to use:** The central routing function called for every incoming event.
**Example:**
```typescript
// Source: v2.3 spec Section 5 (EventRouter)

interface EventRouter {
  handle(event: IncomingEvent): Promise<RouteResult>;
}

type RouteResult =
  | { action: "start"; agentDefinitionId: string; conversationId: string; message: string }
  | { action: "signal"; conversationId: string; signal: Signal }
  | { action: "slow_path"; event: IncomingEvent }
  | { action: "ignore"; reason: string };

// Start rules are loaded from AgentRegistry triggers at construction time
interface StartRule {
  eventType: string;
  agentDefinitionId: string;
}

function createEventRouter(options: EventRouterOptions): EventRouter {
  const { agentRegistry, executor, logger } = options;

  // Build start rules map from all agent definition triggers
  let startRules: StartRule[] = [];

  async function loadStartRules(): Promise<void> {
    const definitions = await agentRegistry.list();
    startRules = [];
    for (const def of definitions) {
      for (const trigger of def.triggers ?? []) {
        startRules.push({
          eventType: trigger.event,
          agentDefinitionId: def.id,
        });
      }
    }
  }

  return {
    async handle(event: IncomingEvent): Promise<RouteResult> {
      // 1. Check ignore rules
      if (isIgnoredEvent(event)) {
        return { action: "ignore", reason: "..." };
      }

      // 2. Check start rules (match trigger event type)
      const startRule = startRules.find(r => r.eventType === event.type);
      if (startRule && event.correlationKey) {
        const conversationId = `${startRule.agentDefinitionId}-${event.correlationKey}`;
        return {
          action: "start",
          agentDefinitionId: startRule.agentDefinitionId,
          conversationId,
          message: event.message ?? JSON.stringify(event.data),
        };
      }

      // 3. Check signal rules (correlation-based)
      if (event.correlationKey) {
        // Determine which agent definition this signal targets
        const conversationId = resolveConversationId(event);
        if (conversationId) {
          return {
            action: "signal",
            conversationId,
            signal: {
              type: event.type,
              data: event.data,
              message: event.message,
              source: event.source,
              deduplicationId: event.deduplicationId,
            },
          };
        }
      }

      // 4. Fall through to slow path
      return { action: "slow_path", event };
    },
  };
}
```

### Pattern 4: Conversation ID Resolution for Signals
**What:** Signal events need to resolve which conversation they target. The formula is `{agentDefinitionId}-{correlationKey}`, owned by the EventRouter.
**When to use:** All signal routing -- approval, pr_merged, pr_closed, escalation, user_reply.
**Example:**
```typescript
// Source: v2.3 spec Section B.5, existing fast-path.ts patterns

/**
 * Resolve the target conversation ID from an IncomingEvent.
 *
 * For signal events, the conversation ID is derived from the event's
 * correlationKey and the agent definition that handles this event type.
 *
 * Current mappings:
 * - approval, escalation_resolved -> dev-agent-{correlationKey}
 * - pr_merged, pr_closed -> dev-agent-{correlationKey}  (extracted from branch name)
 * - user_reply -> product-agent-{correlationKey}
 */
function resolveConversationId(event: IncomingEvent): string | null {
  // Signal type -> agent definition mapping
  const signalAgentMap: Record<string, string> = {
    "approval": "dev-agent",
    "escalation_resolved": "dev-agent",
    "pr_merged": "dev-agent",
    "pr_closed": "dev-agent",
    "user_reply": "product-agent",
  };

  const agentId = signalAgentMap[event.type];
  if (!agentId || !event.correlationKey) return null;

  return `${agentId}-${event.correlationKey}`;
}
```

### Pattern 5: MCP Enrichment on Start Actions
**What:** Before starting a dev-agent conversation, fetch issue details via MCP `get_issue`. Before starting a product-agent conversation, inject config (linearTeamId).
**When to use:** When the EventRouter produces a "start" action result, the caller enriches the initial message with external data before calling `executor.start()`.
**Example:**
```typescript
// Source: Existing fast-path.ts enrichment pattern (lines 386-438)

async function enrichAndStart(
  result: StartRouteResult,
  deps: EventRouterDeps,
): Promise<void> {
  let initialMessage = result.message;

  // Dev-agent: fetch issue details via MCP
  if (result.agentDefinitionId === "dev-agent" && result.event.data.issueId) {
    const issue = await callMcpTool<IssueDetails>({
      integration: "linear",
      tool: "get_issue",
      params: { issueId: result.event.data.issueId },
      agentId: "router",
      correlationId: result.conversationId,
    });
    // Build enriched initial message
    initialMessage = buildDevAgentMessage(issue, deps);
  }

  // Product-agent: inject config context
  if (result.agentDefinitionId === "product-agent") {
    initialMessage = buildProductAgentMessage(result.event, deps);
  }

  await deps.executor.start({
    agentDefinitionId: result.agentDefinitionId,
    correlationKey: result.event.correlationKey!,
    initialMessage,
  });
}
```

### Pattern 6: Adapter-to-Router Pipeline
**What:** The full event processing pipeline: receive NormalizedEvent, run through adapter, run through EventRouter, execute action via executor.
**When to use:** The top-level event handler called by the HTTP endpoint (`POST /events`).
**Example:**
```typescript
// The complete pipeline

async function handleIncomingEvent(
  normalizedEvent: NormalizedEvent,
  adapters: EventAdapter[],
  eventRouter: EventRouter,
  executor: ConversationExecutor,
  deps: RouterDeps,
): Promise<void> {
  // 1. Adapt: NormalizedEvent -> IncomingEvent
  let incomingEvent: IncomingEvent | null = null;
  for (const adapter of adapters) {
    incomingEvent = adapter(normalizedEvent);
    if (incomingEvent) break;
  }

  if (!incomingEvent) {
    // No adapter recognized this event -- forward raw to slow path
    incomingEvent = {
      type: normalizedEvent.type,
      data: normalizedEvent.payload as Record<string, unknown>,
      source: `${normalizedEvent.source}:webhook`,
      deduplicationId: normalizedEvent.correlationId,
    };
  }

  // 2. Route: IncomingEvent -> RouteResult
  const result = await eventRouter.handle(incomingEvent);

  // 3. Execute: RouteResult -> action via executor
  switch (result.action) {
    case "start":
      await enrichAndStart(result, deps);
      break;
    case "signal":
      await executor.signal(result.conversationId, result.signal);
      break;
    case "slow_path":
      await routeViaSlowPath(normalizedEvent, deps);
      break;
    case "ignore":
      deps.logger.debug({ reason: result.reason }, "Event ignored");
      break;
  }
}
```

### Anti-Patterns to Avoid
- **Don't parse raw webhook payloads in adapters:** Adapters receive `NormalizedEvent` objects already produced by integration packages. The integration packages handle webhook signature verification and payload normalization. Adapters only do domain-language mapping.
- **Don't import from `@temporalio/client` in new code:** All Temporal references must be replaced with `ConversationExecutor` calls. The router tools (`start-workflow.ts`, `signal-workflow.ts`, `query-workflows.ts`) must be renamed and adapted to use executor methods.
- **Don't hardcode agent-to-trigger mappings in the EventRouter:** Start rules are loaded from `AgentRegistry.list()` via the `triggers` field on each `AgentDefinition`. Hardcoding defeats the purpose of declarative agent definitions.
- **Don't skip the enrichment step for dev-agent starts:** The existing MCP enrichment (fetching issue details via `callMcpTool`) is critical for providing the agent with task context. The pattern must carry forward.
- **Don't modify `NormalizedEvent` or integration packages:** CONTEXT.md explicitly locks this decision -- adapters consume `NormalizedEvent` as-is, integration packages produce `NormalizedEvent` unchanged.
- **Don't collapse slow-path into the EventRouter:** PR reviews and Slack thread replies remain on the slow-path LLM routing per CONTEXT.md decisions. The EventRouter falls through to the slow-path for events it cannot deterministically route.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event type validation | Custom string parsing | Zod schema for IncomingEvent | Type-safe validation, consistent with codebase |
| Conversation ID generation | Custom ID derivation | `{agentDefinitionId}-{correlationKey}` formula | Already proven in existing fast-path rules, matches spec B.5 |
| Branch name task ID extraction | Custom regex per use site | Existing `BRANCH_TASK_REGEX` from fast-path.ts | Already handles `feature/{IDENTIFIER}` pattern, well-tested |
| Signal deduplication | Custom dedup logic | `ConversationExecutor.signal()` returns `"deduplicated"` | Executor already handles dedup via `delivered_signal_ids` on conversation record |
| Webhook delivery dedup | Custom idempotency check | Existing `WebhookIdempotencyService` at HTTP layer | Already handles webhook retries before events reach the router |
| MCP enrichment | Custom HTTP calls | Existing `callMcpTool()` from `shared/mcp/` | Handles retry, backoff, error reporting |
| Slow-path LLM routing | Rewrite from scratch | Adapt existing `routeViaAgentLoop()` with renamed tools | Business logic, system prompt, and LLM routing all survive intact |

**Key insight:** Phase 42 is a refactoring and wiring phase, not a greenfield build. The 10 existing fast-path rules define the exact mapping from `NormalizedEvent` types to routing actions. The adapters extract the domain-language transformation from those rules. The EventRouter replaces the Temporal execution layer with ConversationExecutor calls. The slow-path LLM router continues to handle ambiguous events.

## Common Pitfalls

### Pitfall 1: Adapter Returns IncomingEvent for Slow-Path Events
**What goes wrong:** An adapter produces an IncomingEvent for `linear.comment.created` or `slack.message.created` (thread reply) -- events that should go to the slow-path LLM. The EventRouter tries to deterministically route them and fails or misroutes.
**Why it happens:** It's tempting to make adapters handle all event types. But some events (Linear comments, thread replies, PR reviews) require semantic understanding of the message content.
**How to avoid:** Adapters return `null` for events that need LLM classification. The pipeline falls through to the slow-path when no adapter matches AND no start/signal rule matches. The CONTEXT.md explicitly locks PR reviews and thread replies as slow-path.
**Warning signs:** If an adapter has `if (event.type === "linear.comment.created")` with a static type assignment, that's wrong. Linear comments need intent classification (approve/reject/guidance/question/abort).

### Pitfall 2: Losing MCP Enrichment During Refactor
**What goes wrong:** The dev-agent start path stops fetching issue details via MCP, so the agent starts with an empty or minimal context.
**Why it happens:** The existing enrichment logic is embedded in `executeFastPath()` in fast-path.ts (lines 397-438). When refactoring to use the EventRouter, it's easy to forget this step.
**How to avoid:** The enrichment logic must be extracted and placed in the EventRouter's start-action execution path. Test that dev-agent conversations receive a fully enriched initial message including issue title, description, priority, and labels.
**Warning signs:** Dev-agent conversations starting with only a bare issue ID and no title/description.

### Pitfall 3: GitHub Branch Name Extraction Fails Silently
**What goes wrong:** A PR merged/closed event has a branch name that doesn't match `feature/{IDENTIFIER}`, so the adapter returns null for the correlation key. The signal gets dropped.
**Why it happens:** The existing fast-path handles this by returning an "ignore" action with a reason. The adapter must do the same or return null so the EventRouter can handle it.
**How to avoid:** The GitHub adapter must handle the branch regex match failure explicitly. If the branch doesn't match, it should either return null (forwarding to slow-path) or return an IncomingEvent with no correlationKey (which the EventRouter treats as unroutable).
**Warning signs:** PR merged events for non-standard branch names silently disappearing.

### Pitfall 4: Start-Rule Matching by Original Event Type vs. Domain Type
**What goes wrong:** The adapter transforms `slack.app_mention.created` to a domain type like `"app_mention"`, but the agent definition trigger says `event: "slack.app_mention.created"` (the original type). The start rule doesn't match.
**Why it happens:** Confusion about whether start-rule matching happens on the original NormalizedEvent type or the adapted IncomingEvent type.
**How to avoid:** Start events keep their original dotted type (`slack.app_mention.created`, `linear.agent_session.created`) as the IncomingEvent.type so they match the triggers in agent definitions. Domain-language types (`"approval"`, `"pr_merged"`) are used for signal events that need to match `wait_for` types. This is a critical distinction.
**Warning signs:** Agent trigger rules not firing for known start events.

### Pitfall 5: Temporal Import Leakage in Adapted Router Tools
**What goes wrong:** The renamed router tools (`start-conversation.ts`, etc.) still import from `@temporalio/client`, causing build failures or runtime errors when Temporal is removed.
**Why it happens:** The existing tools import `WorkflowExecutionAlreadyStartedError` from `@temporalio/client` and use `deps.workflowClient.workflow.start()`. These must all be replaced.
**How to avoid:** The adapted tools must use `ConversationExecutor` methods exclusively. `start_conversation` calls `executor.start()`, `signal_conversation` calls `executor.signal()`, `query_conversations` calls `executor.list()`. No Temporal imports anywhere in the new code.
**Warning signs:** `import { ... } from "@temporalio/client"` in any new or adapted file.

### Pitfall 6: Inconsistent Signal Type Names Between Adapter and wait_for
**What goes wrong:** An adapter produces `type: "plan_approved"` but the agent's wait_for call specifies `type: "approval"`. The signal doesn't match and the conversation stays paused.
**Why it happens:** The adapter author and the agent prompt author use different terminology for the same signal.
**How to avoid:** Define canonical signal type names and document them. Match the types used in the existing Temporal signals to the new domain types:
- `planApproval` -> `"approval"` (adapter must produce this)
- `prCompletion` -> `"pr_merged"` or `"pr_closed"` (adapter must produce this)
- `escalationResolved` -> `"escalation_resolved"` (adapter must produce this)
- `userReply` -> `"user_reply"` (adapter must produce this)
- `prFeedback` -> `"pr_review"` (adapter must produce this)
These names must match what the agent prompts tell agents to use with `wait_for`.
**Warning signs:** Conversations stuck in "waiting" status after signals are delivered.

## Code Examples

Verified patterns from the codebase and spec:

### Complete Slack Adapter
```typescript
// Source: Derived from existing fast-path.ts rules + v2.3 spec B.4

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

/**
 * Adapt Slack NormalizedEvents into domain-language IncomingEvents.
 *
 * Handles:
 * - block_actions.approved -> "approval" (fast-path)
 * - block_actions.rejected -> "approval" (fast-path)
 * - block_actions.escalation_retry -> "escalation_resolved" (fast-path)
 * - block_actions.escalation_abort -> "escalation_resolved" (fast-path)
 * - app_mention.created -> "slack.app_mention.created" (start trigger)
 *
 * Returns null for:
 * - message.created (thread replies) -> slow-path LLM
 * - Any unrecognized Slack event type
 */
export function adaptSlackEvent(event: NormalizedEvent): IncomingEvent | null {
  if (event.source !== "slack") return null;

  const payload = event.payload as Record<string, unknown>;

  switch (event.type) {
    case "slack.block_actions.approved": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "approval",
        data: { approved: true, source: "slack" },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message: "Plan approved via Slack button.",
      };
    }

    case "slack.block_actions.rejected": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "approval",
        data: {
          approved: false,
          feedback: "Rejected via Slack button",
          source: "slack",
        },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message: "Plan rejected via Slack button. Feedback: Rejected via Slack button",
      };
    }

    case "slack.block_actions.escalation_retry": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "escalation_resolved",
        data: { action: "retry" },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message: "Escalation resolved: retry.",
      };
    }

    case "slack.block_actions.escalation_abort": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "escalation_resolved",
        data: { action: "abort" },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message: "Escalation resolved: abort.",
      };
    }

    case "slack.app_mention.created": {
      const threadTs = (payload.threadTs as string) || (payload.ts as string);
      return {
        type: "slack.app_mention.created",
        data: {
          threadTs,
          channelId: payload.channel,
          initialMessage: payload.text,
          userId: payload.user,
          slackTeamId: payload.teamId,
        },
        source: "slack:webhook",
        correlationKey: threadTs,
        deduplicationId: event.correlationId,
        message: payload.text as string,
      };
    }

    // slack.message.created (thread replies) -> return null for slow-path
    default:
      return null;
  }
}
```

### Complete GitHub Adapter
```typescript
// Source: Derived from existing fast-path.ts rules + v2.3 spec B.4

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

const BRANCH_TASK_REGEX = /feature\/([A-Z]+-\d+)/i;

export function adaptGitHubEvent(event: NormalizedEvent): IncomingEvent | null {
  if (event.source !== "github") return null;

  const payload = event.payload as Record<string, unknown>;

  switch (event.type) {
    case "github.pull_request.merged": {
      const branchName = payload.branchName as string;
      const prNumber = payload.prNumber as number;
      const branchMatch = branchName.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) return null; // Can't extract task ID -> fall through
      return {
        type: "pr_merged",
        data: { merged: true, prNumber },
        source: "github:webhook",
        correlationKey: branchMatch[1],
        deduplicationId: event.correlationId,
        message: `PR #${prNumber} (${branchName}) was merged into main.`,
      };
    }

    case "github.pull_request.closed": {
      const branchName = payload.branchName as string;
      const prNumber = payload.prNumber as number;
      const branchMatch = branchName.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) return null;
      return {
        type: "pr_closed",
        data: { merged: false, prNumber },
        source: "github:webhook",
        correlationKey: branchMatch[1],
        deduplicationId: event.correlationId,
        message: `PR #${prNumber} (${branchName}) was closed without merging.`,
      };
    }

    // github.pull_request.review_submitted -> return null for slow-path
    default:
      return null;
  }
}
```

### Complete Linear Adapter
```typescript
// Source: Derived from existing fast-path.ts rules + v2.3 spec B.4

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

export function adaptLinearEvent(event: NormalizedEvent): IncomingEvent | null {
  if (event.source !== "linear") return null;

  const payload = event.payload as Record<string, unknown>;

  switch (event.type) {
    case "linear.agent_session.created": {
      const issueId = payload.issueId as string;
      return {
        type: "linear.agent_session.created",
        data: { issueId },
        source: "linear:webhook",
        correlationKey: issueId,
        deduplicationId: event.correlationId,
        message: `New agent session created for issue ${issueId}`,
      };
    }

    case "linear.issue.created":
      return {
        type: "linear.issue.created",
        data: payload,
        source: "linear:webhook",
        deduplicationId: event.correlationId,
        // No correlationKey -- this is an ignore event
      };

    case "linear.issue.updated":
      return {
        type: "linear.issue.updated",
        data: payload,
        source: "linear:webhook",
        deduplicationId: event.correlationId,
      };

    // linear.comment.created -> return null for slow-path
    default:
      return null;
  }
}
```

### Canonical Signal Type Mapping
```typescript
// Source: Derived from existing Temporal signals + v2.3 spec B.4

/**
 * Maps Temporal signal names to v2.3 domain-language signal types.
 * These are the canonical signal types that:
 * 1. Adapters produce as IncomingEvent.type
 * 2. Agents use with wait_for({ type: ... })
 * 3. EventRouter uses for signal matching
 */
export const SIGNAL_TYPE_MAP = {
  // Temporal signal name -> v2.3 IncomingEvent type
  planApproval: "approval",         // approved: true/false
  prCompletion: "pr_merged",        // merged: true (also "pr_closed" for merged: false)
  prFeedback: "pr_review",          // PR review feedback
  escalationResolved: "escalation_resolved", // action: retry/abort
  userReply: "user_reply",          // Slack thread reply text
  cancelConversation: "cancel",     // Admin cancellation
} as const;

// Start events keep their original dotted type to match triggers:
// "slack.app_mention.created", "linear.agent_session.created"
```

### EventRouter Start Rule Loading
```typescript
// Source: v2.3 spec Section 5, existing AgentDefinition triggers field

// Start rules loaded from AgentRegistry at init
interface StartRule {
  eventType: string;        // e.g., "linear.agent_session.created"
  agentDefinitionId: string; // e.g., "dev-agent"
}

// From agent definitions:
// dev-agent/definition.yaml:   triggers: [{ event: "linear.agent_session.created" }]
// product-agent/definition.yaml: triggers: [{ event: "slack.app_mention.created" }]

// Result:
// startRules = [
//   { eventType: "linear.agent_session.created", agentDefinitionId: "dev-agent" },
//   { eventType: "slack.app_mention.created", agentDefinitionId: "product-agent" },
// ]
```

### Ignore Rules
```typescript
// Source: Existing fast-path.ts ignore rules

/**
 * Events that should be explicitly ignored (not routed, not sent to slow-path).
 */
const IGNORE_EVENTS = new Set([
  "linear.issue.created",
  "linear.issue.updated",
]);

function isIgnoredEvent(event: IncomingEvent): boolean {
  return IGNORE_EVENTS.has(event.type);
}
```

## State of the Art

| Old Approach (v2.2 router) | Current Approach (v2.3 Phase 42) | When Changed | Impact |
|---|---|---|---|
| `matchFastPath()` returns `FastPathAction` with Temporal signal/start semantics | Adapters produce `IncomingEvent`, EventRouter returns `RouteResult` with executor semantics | v2.3 | Decouples routing logic from execution mechanism |
| `executeFastPath()` calls `workflowClient.workflow.start/getHandle().signal()` | EventRouter returns action, caller calls `executor.start()`/`executor.signal()` | v2.3 | Removes Temporal dependency from routing |
| `RouterDeps.workflowClient: Client` (Temporal) | `EventRouterDeps.executor: ConversationExecutor` | v2.3 | Temporal-free router |
| Signal names: `planApprovalSignal.name`, `prCompletionSignal.name` | Domain types: `"approval"`, `"pr_merged"` | v2.3 | Agents use domain language, not infrastructure terminology |
| Workflow IDs: `dev-agent-{issueId}` (constructed in fast-path rules) | Conversation IDs: `{agentDefinitionId}-{correlationKey}` (constructed by EventRouter) | v2.3 | Same formula, different naming |
| Start rules hardcoded in DETERMINISTIC_RULES array | Start rules loaded from AgentRegistry triggers | v2.3 | Adding new agents requires zero router changes |

**Deprecated/outdated (replaced by this phase):**
- `FastPathAction` type (SignalAction, StartAction, IgnoreAction with Temporal semantics)
- `executeFastPath()` function (Temporal execution)
- `RouterDeps.workflowClient` (Temporal Client dependency)
- `RoutingRule` type with Temporal-based actions
- Router tool imports from `@temporalio/client` (`WorkflowExecutionAlreadyStartedError`)
- `SIGNAL_MAP` in `signal-workflow.ts` (Temporal signal definitions)

**Important:** Do NOT delete the old router code in Phase 42. The existing router module continues to be referenced until Phase 47 (Cleanup). Phase 42 creates the new adapter and EventRouter infrastructure alongside the old code. The old router tools are adapted (renamed, Temporal calls replaced with executor calls) but the old `fast-path.ts` and `executeFastPath()` remain available as reference during migration.

## Open Questions

Things that couldn't be fully resolved:

1. **Should the EventRouter handle enrichment internally or externally?**
   - What we know: The existing `executeFastPath()` handles MCP enrichment (fetching issue details) inside the fast-path execution. The v2.3 spec's EventRouter interface returns a `RouteResult` -- it's a routing decision, not an execution function.
   - What's unclear: Should the enrichment logic live inside the EventRouter's `handle()` method, or in the caller that processes the RouteResult?
   - Recommendation: Keep enrichment in the caller (the pipeline function that processes RouteResults). The EventRouter's job is routing decisions, not data fetching. This keeps the EventRouter pure and testable. The enrichment logic can be a separate function (`enrichStartAction()`) called by the pipeline.

2. **How should the slow-path tools reference ConversationExecutor?**
   - What we know: The current slow-path tools (`start-workflow.ts`, `signal-workflow.ts`, `query-workflows.ts`) receive `RouterDeps` which includes `workflowClient`. These need to be adapted to use ConversationExecutor.
   - What's unclear: Should the adapted `RouterDeps` type be a new type (`EventRouterDeps`) or should the existing `RouterDeps` be modified in-place?
   - Recommendation: Create a new `EventRouterDeps` interface that uses `executor: ConversationExecutor` instead of `workflowClient: Client`. This avoids breaking the existing code until Phase 47 cleanup. The adapted tools use the new deps type. Both types can coexist.

3. **What happens when an adapter returns null AND no start/signal rule matches?**
   - What we know: Events like `linear.comment.created`, `slack.message.created` (thread replies), and `github.pull_request.review_submitted` are not handled by adapters (per CONTEXT.md) and don't match start rules.
   - What's unclear: How does the pipeline forward these to the slow-path? The slow-path's `formatEventForLLM()` currently takes a `NormalizedEvent`, not an `IncomingEvent`.
   - Recommendation: When the adapter returns null AND the EventRouter returns `{ action: "slow_path" }`, the pipeline calls the existing `routeViaAgentLoop()` with the original `NormalizedEvent`. The slow-path does not need to understand `IncomingEvent` -- it receives the raw normalized event and reasons about it via LLM. This minimizes changes to the slow-path.

4. **Should PR completion signals be split into "pr_merged" and "pr_closed" or unified as "pr_completion"?**
   - What we know: The existing Temporal signal is `prCompletionSignal` with `{ merged: boolean }` in the payload. The v2.3 spec B.4 uses `"pr_merged"` as the signal type.
   - What's unclear: Should the adapter produce two distinct types (`"pr_merged"` and `"pr_closed"`) or one type (`"pr_completion"` with a `merged` boolean in data)?
   - Recommendation: Use two distinct types (`"pr_merged"` and `"pr_closed"`). This is cleaner for `wait_for` matching -- an agent waiting for `"pr_merged"` doesn't need to inspect the payload to determine if it should act. The EventRouter resolves both to the same `dev-agent-{taskId}` conversation, and the agent prompt says `wait_for({ type: "pr_merged" })`. If the PR is closed without merge, the agent gets woken with `"pr_closed"` and can decide how to respond.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/agents/src/router/fast-path.ts` -- All 10 deterministic routing rules, enrichment logic, signal/start patterns
- Existing codebase: `packages/agents/src/router/types.ts` -- FastPathAction, RouteResult, RouterDeps, RoutingRule types
- Existing codebase: `packages/agents/src/router/router.ts` -- Core routing function with fast-path/slow-path dispatch
- Existing codebase: `packages/agents/src/router/slow-path.ts` -- LLM-based routing, tool creation, result parsing
- Existing codebase: `packages/agents/src/router/system-prompt.ts` -- Full router system prompt with intent classification
- Existing codebase: `packages/agents/src/router/tools/` -- start-workflow, signal-workflow, query-workflows tool factories
- Existing codebase: `packages/types/src/events/schema.ts` -- NormalizedEvent schema (id, type, source, timestamp, correlationId, payload)
- Existing codebase: `packages/agents/src/framework/types.ts` -- ConversationExecutor, Signal, StartConversationParams interfaces
- Existing codebase: `packages/agents/src/framework/conversation-executor.ts` -- ConversationExecutor factory implementation
- Existing codebase: `packages/agents/src/shared/db/schema.ts` -- conversations table, agent_events, agent_sessions schemas
- Existing codebase: `packages/agents/definitions/dev-agent/definition.yaml` -- triggers: [{ event: "linear.agent_session.created" }]
- Existing codebase: `packages/agents/definitions/product-agent/definition.yaml` -- triggers: [{ event: "slack.app_mention.created" }]
- v2.3 spec: `2.3-spec.md` Section 5 (EventRouter), Section 6 (Signal Handling), Appendix B.4 (Signal-to-Message Format), Appendix B.5 (Conversation ID Construction)
- Phase 42 CONTEXT.md: Implementation decisions (adapter input format, slow-path decisions, fast-path philosophy)
- Phase 38 RESEARCH.md: AgentRegistry, ToolRegistry patterns, tool name mapping
- Phase 40 RESEARCH.md: ConversationExecutor patterns, signal delivery, worker loop

### Secondary (MEDIUM confidence)
- v2.2 spec: `2.2-spec.md` Section 3 (Smart Router) -- Original router design intent

### Tertiary (LOW confidence)
- None -- all findings verified against existing codebase and spec

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies, all components already exist in the codebase
- Architecture: HIGH -- Spec provides explicit interfaces, existing fast-path rules define exact adapter mappings, ConversationExecutor interface is already implemented
- Pitfalls: HIGH -- Based on direct analysis of existing fast-path rules, adapter-router interface boundary, and Temporal-to-executor migration surface
- Code examples: HIGH -- Derived directly from existing `fast-path.ts` rules and spec signal type definitions

**Research date:** 2026-02-02
**Valid until:** 2026-03-04 (stable domain -- adapter pattern is straightforward, no fast-moving libraries)
