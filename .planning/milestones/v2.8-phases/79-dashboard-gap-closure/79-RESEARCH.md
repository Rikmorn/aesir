# Phase 79: Dashboard Gap Closure - Research

**Researched:** 2026-02-18
**Domain:** Dashboard UI (Next.js 15, React, Tailwind CSS), cost estimation, event type propagation
**Confidence:** HIGH

## Summary

Phase 79 closes two specific gaps identified in the v2.8 milestone audit: (1) DASH-08 cost estimate metric missing from the EventMetricsBar, and (2) `event.routed` (the 18th event type) not propagated to the dashboard schema, SSE types, or icon/color mapping.

Both gaps are well-scoped with minimal blast radius. The cost estimate requires a client-side pricing lookup table and a `formatCost` utility. The `event.routed` propagation is a 3-file, ~10-line change. All existing patterns are established from Phase 77 (Dashboard Observability) -- no new architectural decisions needed.

**Primary recommendation:** Two small, independent plans. Plan 1 adds cost estimation to EventMetricsBar. Plan 2 syncs `event.routed` across dashboard schema, SSE types, icon mapping, timeline grouping, and filter categorization.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-08 | Conversation detail shows summary metrics -- total tokens, cost estimate, wall-clock duration, tool call count/success rate, retry count | All metrics except cost estimate already implemented. Cost estimate requires: pricing lookup table keyed by model ID, `formatCost` utility, EventMetricsBar prop addition, model info propagation from agent definition to dashboard. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. All work uses existing project dependencies.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15 | App router, RSC, server components | Already in use |
| React | 19 | UI components | Already in use |
| Tailwind CSS | 4 | Styling | Already in use |
| Drizzle ORM | (project version) | Database queries | Already in use |
| Lucide React | (project version) | Icon library for event.routed icon | Already in use |

### Supporting

No new supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side cost estimation | Server-side cost column in DB | Server-side would be more accurate but requires schema migration, event log backfill, and agent framework changes. Client-side is good enough for an estimate and ships faster. |
| Hardcoded pricing table | External pricing API | External API adds latency, a dependency, and failure modes. Pricing changes infrequently; a static lookup updated manually is appropriate for a dashboard metric. |

## Architecture Patterns

### Pattern 1: Cost Estimation via Client-Side Pricing Lookup

**What:** A static pricing map keyed by model ID string, used to compute `cost = (inputTokens * inputPricePerToken) + (outputTokens * outputPricePerToken)`.

**When to use:** When the model ID is available and tokens are already aggregated.

**Data flow for cost estimation:**

```
agent_definition_id (on conversation/events)
        |
        v
Agent definition model field (in YAML)
        |
        v  (NOT directly available to dashboard)

Alternative: Store model on llm.response payload
        OR: Look up from agentDefinitionId -> model mapping
```

**Critical data gap:** The dashboard currently has `agentDefinitionId` but NOT the model name. The `llm.response` event payload only contains `{ stop_reason }` -- no model field. The agent definition's `model` field is in YAML on disk, not in any database table the dashboard reads.

**Resolution options (ranked):**

1. **Add model to llm.response event payload** (recommended) -- Modify the worker-loop.ts emission to include `model` in the event payload. Dashboard reads it from events. This is the most accurate approach since sub-agents may use different models than the orchestrator.
   - Change: `packages/agents/src/framework/worker-loop.ts` line ~1471: add `model` to payload
   - Dashboard: Read model from first `llm.response` event's payload
   - Confidence: HIGH -- single-line change in existing emission code

2. **Static agentDefinitionId-to-model lookup in dashboard** -- Hardcode a mapping like `{ "dev-agent": "claude-sonnet-4", "coder": "claude-haiku-4.5" }`. Fragile -- breaks when definitions change.
   - Confidence: LOW -- maintenance burden, violates DRY

3. **Expose agent definitions via API** -- Add an endpoint to agent-service that returns definition metadata. Over-engineered for this gap.
   - Confidence: MEDIUM -- correct long-term but overkill for Phase 79

**Pricing table structure:**

```typescript
// packages/dashboard/src/lib/pricing.ts

interface ModelPricing {
  inputPerMTok: number;   // USD per million input tokens
  outputPerMTok: number;  // USD per million output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Sonnet family
  "claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4": { inputPerMTok: 3, outputPerMTok: 15 },

  // Haiku family
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4.5": { inputPerMTok: 1, outputPerMTok: 5 },

  // Opus family (future-proofing)
  "claude-opus-4": { inputPerMTok: 15, outputPerMTok: 75 },
};

// Default to Sonnet pricing when model is unknown
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model?: string,
): number {
  const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}

export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}
```

**Current Anthropic API pricing (verified 2026-02-18):**

| Model | Input ($/MTok) | Output ($/MTok) |
|-------|---------------|-----------------|
| Claude Sonnet 4 / 4.5 / 4.6 | $3 | $15 |
| Claude Haiku 4.5 | $1 | $5 |
| Claude Opus 4 / 4.5 / 4.6 | $5 | $25 |
| Claude Opus 4.1 | $15 | $75 |

**Models used in Aesir definitions (verified from YAML):**
- `claude-sonnet-4-20250514` -- dev-agent, product-agent (orchestrators)
- `claude-haiku-4-5-20251001` -- coder, researcher, tester, qa-agent, all test agents (sub-agents + summary)

### Pattern 2: Event Type Propagation (event.routed)

**What:** When a new event type is added to the canonical agents schema, three dashboard files must be updated in sync.

**Files to update:**

1. `packages/dashboard/src/lib/schema.ts` -- `agentEventTypeValues` array (line 62-80)
2. `packages/dashboard/src/lib/sse-types.ts` -- `ALL_EVENT_TYPES` array (line 64-82)
3. `packages/dashboard/src/components/conversation-detail/event-icon.tsx` -- `iconMap` and `colorMap` records

**Timeline grouping:** `event.routed` events need a `kind` assignment in `groupTimelineEvents()` (event-timeline.tsx). Since `event.routed` is a routing infrastructure event (not agent lifecycle, tool call, or LLM), it should render as a lifecycle banner -- same treatment as `notification.failed` and standalone MCP errors.

**Filter categorization:** `event.routed` should be visible under the "Lifecycle" filter chip, matching its lifecycle_banner kind.

**Icon/color choice:** `event.routed` represents a routing decision -- "this event was matched and delivered to a conversation." Appropriate icon: `Navigation` (routing/direction) or `GitBranch` (branching/routing). Color: `text-indigo-400` (matches the indigo accent used for active/running states, since routing is infrastructure-level).

**Description extraction:** The `event.routed` payload contains:
```typescript
{
  entity?: { entityType: string; entityId: string };
  disposition: "new" | "signal" | "retry" | "supersede";
  routingMethod: "trigger_match" | "signal_match" | "correlation_fallback" | "slow_path";
  targetConversationId?: string;
  reasoning?: string; // only for slow_path
}
```

The lifecycle banner's `getLifecycleDescription()` should format this as: `"trigger_match → new"` or `"correlation_fallback → signal (LIN-456)"`.

### Anti-Patterns to Avoid

- **Importing from @aesir/agents:** Dashboard maintains its own schema mirror. Never import from the agents package.
- **Server-side cost computation without model data:** Don't try to compute cost in the server component without the model field -- there's no model info available until we add it to the event payload.
- **Pricing as a build-time constant:** Don't import pricing from a config file that needs env vars. Use a plain TypeScript constant module.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Currency formatting | Custom number formatting | `toFixed(2)` with `$` prefix | Simple enough; Intl.NumberFormat overkill for USD-only |
| Icon selection | Custom SVG for routing | Lucide `Navigation` or `GitBranch` | Consistency with existing icon library |

**Key insight:** Both gaps are simple UI additions to established patterns. The risk is in forgetting a file (there are 5+ touchpoints per event type), not in architectural complexity.

## Common Pitfalls

### Pitfall 1: Missing model data for cost estimation

**What goes wrong:** Dashboard tries to compute cost but has no model info. Falls back to a single default price, producing inaccurate estimates for conversations using Haiku (5x cheaper than Sonnet for output).
**Why it happens:** The llm.response event payload currently only has `stop_reason`, not the model.
**How to avoid:** Add `model` to the llm.response event payload in worker-loop.ts. For existing events without model data, fall back to the agentDefinitionId-based heuristic (dev-agent/product-agent = Sonnet, everything else = Haiku).
**Warning signs:** Cost shown is same for all conversations regardless of agent type.

### Pitfall 2: event.routed not appearing in SSE stream

**What goes wrong:** `event.routed` events are stored in DB but don't appear in real-time SSE feed because `ALL_EVENT_TYPES` doesn't include them.
**Why it happens:** The SSE endpoint may use the `ALL_EVENT_TYPES` constant for type validation.
**How to avoid:** Add `"event.routed"` to `ALL_EVENT_TYPES` in sse-types.ts. Check if the SSE endpoint validates against this array.
**Warning signs:** event.routed appears on page refresh (DB fetch) but not via live SSE.

### Pitfall 3: event.routed has conversation_id "router"

**What goes wrong:** `event.routed` events are emitted with `conversation_id: "router"` when there's no target conversation (params.targetConversationId is undefined). This means they won't appear in any specific conversation's timeline.
**Why it happens:** The router emits these events for observability, using "router" as a synthetic conversation_id.
**How to avoid:** For events WITH a targetConversationId, they use the real conversation_id and will appear in that conversation's timeline. For events with "router" as the conversation_id, they'll only appear if someone navigates to a "router" pseudo-conversation (which doesn't exist as a real conversation). This is acceptable -- the important ones (with a target) do appear in the right conversation.
**Warning signs:** Some routing events visible in DB but not in any conversation timeline. This is by design for router-level events without a target.

### Pitfall 4: Forgetting the filter categorization

**What goes wrong:** `event.routed` events appear in the timeline but can't be filtered, or worse, are hidden by default.
**Why it happens:** The `shouldShowItem()` function in event-timeline.tsx routes unknown event types to `"generic"` kind, which always shows. But without explicit timeline grouping, event.routed falls through to the generic renderer instead of getting lifecycle banner treatment.
**How to avoid:** Add explicit handling in `groupTimelineEvents()` for `event.routed` as `lifecycle_banner` kind.
**Warning signs:** event.routed renders with raw JSON payload dump instead of a formatted lifecycle banner.

### Pitfall 5: Mixed model costs in sub-agent conversations

**What goes wrong:** A dev-agent conversation spawns coder (Haiku) and researcher (Haiku) sub-agents. Token totals include all events, but the cost estimate uses one model's pricing.
**Why it happens:** Different agents use different models within the same conversation timeline.
**How to avoid:** If model is in the llm.response payload, compute cost per-event (not per-conversation), then sum. Each event's tokens are priced at the model that generated them.
**Warning signs:** Cost for conversations with sub-agents is wildly off.

## Code Examples

### Adding cost to EventMetricsBar

```typescript
// event-metrics-bar.tsx addition
interface EventMetricsBarProps {
  wallClockDuration: string;
  tokenInput: number;
  tokenOutput: number;
  toolSuccessCount: number;
  toolTotalCount: number;
  retryCount: number;
  costEstimate: number | null; // NEW
}

// In the JSX, after the retry count section:
{costEstimate !== null && costEstimate > 0 && (
  <>
    <span className="text-border">|</span>
    <span className="font-mono tabular-nums">
      ~{formatCost(costEstimate)}
    </span>
  </>
)}
```

### Adding event.routed to dashboard schema

```typescript
// packages/dashboard/src/lib/schema.ts
export const agentEventTypeValues = [
  "tool.called",
  "tool.succeeded",
  "tool.failed",
  "llm.response",
  "agent.started",
  "agent.completed",
  "agent.paused",
  "agent.resumed",
  "agent.reopened",
  "signal.received",
  "signal.orphaned",
  "mcp.error",
  "mcp.rate_limited",
  "mcp.retries_exhausted",
  "notification.failed",
  "agent.stale_recovered",
  "agent.retry_scheduled",
  "event.routed", // Phase 79: 18th event type
] as const;
```

### Adding event.routed icon/color

```typescript
// event-icon.tsx additions
import { Navigation } from "lucide-react"; // or GitBranch

// In iconMap:
"event.routed": Navigation,

// In colorMap:
"event.routed": "text-indigo-400",
```

### Adding event.routed lifecycle description

```typescript
// lifecycle-banner.tsx getLifecycleDescription() addition
case "event.routed": {
  const disposition = typeof p.disposition === "string" ? p.disposition : "unknown";
  const method = typeof p.routingMethod === "string" ? p.routingMethod : "unknown";
  const entity = p.entity as { entityType?: string; entityId?: string } | undefined;
  const entityLabel = entity?.entityId ? ` (${entity.entityId})` : "";
  return `${method} \u2192 ${disposition}${entityLabel}`;
}
```

### Adding model to llm.response payload

```typescript
// packages/agents/src/framework/worker-loop.ts (around line 1468-1476)
eventLog.append({
  ...eventBase,
  type: "llm.response",
  payload: {
    stop_reason: response.stop_reason,
    model: definition.model, // NEW: enables cost estimation in dashboard
  },
  tokenCountInput: response.usage.input_tokens,
  tokenCountOutput: response.usage.output_tokens,
  ...(textContent && { content: textContent }),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No cost estimate (Phase 77 scope reduction) | Client-side estimate from token counts + model pricing | Phase 79 | Dashboard tells cost story |
| 17 event types in dashboard | 18 event types (adds event.routed) | Phase 79 | Complete event coverage |

**Deprecated/outdated:**
- None. All approaches use current patterns established in Phase 77.

## Open Questions

1. **Should model be added to llm.response payload?**
   - What we know: This is a one-line change in worker-loop.ts that enables accurate per-event cost computation
   - What's unclear: Whether this is acceptable as a Phase 79 agent framework change, or should be deferred
   - Recommendation: Include it in Phase 79. Without it, cost estimation degrades to a rough heuristic based on agentDefinitionId. The change is minimal and backward-compatible (payload is JSONB, no schema migration needed). The dashboard already reads `stop_reason` from the same payload -- adding `model` follows the exact same pattern.

2. **Cost for existing (pre-Phase 79) events without model in payload**
   - What we know: Events already in DB won't have the model field
   - What's unclear: How to handle cost estimation for historical conversations
   - Recommendation: Fall back to default Sonnet pricing for events without model data. Accept that historical cost estimates are approximate. This is an "estimate" by definition -- the tilde prefix (`~$0.42`) communicates this clearly.

3. **Should the cost estimate use the `~` prefix?**
   - What we know: Cost depends on model, caching, batch API usage, and pricing changes
   - What's unclear: Whether users will misinterpret exact-looking numbers
   - Recommendation: Always display as `~$X.XX` (with tilde prefix). This signals "estimate" and avoids precision theater. The EventMetricsBar already shows approximate data (wall-clock duration ticks live, token counts don't include system prompt overhead).

## Sources

### Primary (HIGH confidence)

- Codebase inspection: `packages/dashboard/src/components/conversation-detail/event-metrics-bar.tsx` -- current EventMetricsBar implementation
- Codebase inspection: `packages/dashboard/src/lib/schema.ts` -- dashboard schema with 17 event types (missing event.routed)
- Codebase inspection: `packages/dashboard/src/lib/sse-types.ts` -- SSE type definitions with ALL_EVENT_TYPES (17 types)
- Codebase inspection: `packages/dashboard/src/components/conversation-detail/event-icon.tsx` -- icon/color mapping (17 entries)
- Codebase inspection: `packages/agents/src/shared/db/schema.ts` -- canonical schema with 18 event types (includes event.routed)
- Codebase inspection: `packages/agents/src/framework/worker-loop.ts` -- llm.response emission (payload: stop_reason only, no model)
- Codebase inspection: `packages/agents/src/router/router.ts` -- event.routed emission with payload structure
- Codebase inspection: `packages/agents/src/shared/db/migrations/0016_add_event_routed_type.sql` -- DB migration adding 18th type
- [Anthropic pricing page](https://platform.claude.com/docs/en/about-claude/pricing) -- verified model pricing 2026-02-18
- `.planning/v2.8-MILESTONE-AUDIT.md` -- audit identifying both gaps
- `.planning/REQUIREMENTS.md` -- DASH-08 requirement definition

### Secondary (MEDIUM confidence)

- `.planning/specs/2.8-agent-resilience.md` -- Phase 4 design decision: "No cost estimate -- cost depends on model, token type, and pricing that changes." This was a v2.8 Phase 4 design decision that Phase 79 now reverses per the gap closure requirement.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing patterns
- Architecture: HIGH -- all changes are additions to established Phase 77 patterns
- Pitfalls: HIGH -- verified data flow from codebase inspection, identified the model data gap with concrete resolution

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable -- pricing table may need update if Anthropic changes rates)
