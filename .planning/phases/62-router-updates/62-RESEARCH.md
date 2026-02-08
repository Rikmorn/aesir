# Phase 62: Router Updates - Research

**Researched:** 2026-02-08
**Domain:** Event routing infrastructure, replyContext forwarding, Linear comment routing
**Confidence:** HIGH

## Summary

Phase 62 modifies the router layer to propagate `replyContext` through signal delivery (both fast-path and slow-path) and adds Linear comment handling as a routing path equivalent to Slack thread replies. The scope is well-bounded: only router tools, the router system prompt, the `EventRouterDeps` interface, and the slow-path invocation site need changes. No new packages, no new database columns, no new external dependencies.

The implementation touches four concerns: (1) adding `replyContext` as an optional field on `signal_conversation` and `start_conversation` tool schemas, (2) auto-injecting `eventReplyContext` from the incoming event into those tool execute() functions as a default, (3) updating the router system prompt to replace the Slack-specific `<slack_thread_reply_routing>` with a channel-agnostic `<follow_up_routing>` section, and (4) passing `eventReplyContext` through the slow-path invocation chain so tools have access to the incoming event's replyContext at execution time.

**Primary recommendation:** Three plans -- (1) tool schema changes + deps wiring, (2) prompt rewrite, (3) tests. Plan 1 is the core infrastructure, Plan 2 is the prompt engineering, Plan 3 validates success criteria.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### replyContext Forwarding

- **Infrastructure auto-injects** replyContext from the incoming event into signal_conversation and start_conversation calls as the default
- **LLM can override** via an optional top-level replyContext field on both tool schemas; LLM-provided value takes precedence over auto-injected
- **Fast-path routes** also propagate replyContext -- a one-liner per fast-path branch: `incomingEvent.replyContext` passed to `executor.start()` or signal construction. Both `StartConversationParams` and `Signal` already have replyContext fields from Phase 61
- **Reopen flow**: replyContext flows through the paired signal_conversation call, not the reopen_conversation call itself. Reopen just changes conversation status; the signal carries the new event's replyContext. This means a conversation originally from Slack can be reopened via Linear and the agent replies on Linear ("classify by intent, reply by origin")
- **Injection implementation**: In each tool's `execute()` function as `const replyContext = input.replyContext ?? deps.eventReplyContext;` -- not a middleware/wrapper. Only two tools need it; a shared abstraction is premature

#### Linear Comment Routing

- **Same pattern as Slack thread replies**: query_conversations by correlation key, check status, signal or reopen. Not a separate flow -- structurally identical
- **Correlation key**: issueId for Linear (vs threadTs for Slack)
- **No match found**: Ignore. Issues are assigned to agents through agent_session.created, not through comments. The prompt should be explicit: "If a Linear comment has no matching conversation, ignore it"
- **Agent echo filtering**: Essential to prevent feedback loops (agent comments -> webhook -> router -> signal -> agent comments again). This is NOT a Phase 62 concern -- it belongs in the Linear integration layer or adapter. Phase 62 should flag this as a dependency/prerequisite
- **Intent classification**: Same classification logic applies to Linear comments as Slack thread replies (approve/reject/guidance/question/abort). The classification concern is orthogonal to routing

#### Router Prompt Updates

- **replyContext guidance**: Minimal -- two sentences maximum. "replyContext is automatically forwarded from the incoming event to signal and start calls. You don't need to pass it. Only provide an explicit replyContext if the event lacks one and you can construct the correct channel address from conversation context." No type structure, no channel variants, no procedural if/then
- **Unified follow-up section**: Replace `<slack_thread_reply_routing>` with a channel-agnostic `<follow_up_routing>` section. One procedure for all follow-up messages (Slack thread replies, Linear issue comments, future GitHub PR comments). Correlation key lookup table by source
- **Separate routing from classification**: `<follow_up_routing>` owns "where does this go?" (query -> check status -> signal/reopen/ignore). `<intent_classification>` owns "what does this mean?" (approval, feedback, question). These are orthogonal concerns, cleanly separated. Kill the existing Linear-specific "derive conversationId" shortcut in the tools section
- **Generalize intent classification**: The existing `<intent_classification>` section should not be Linear-specific. Same classification applies across channels. Ensure examples and descriptions are channel-neutral

#### Tool Schema Changes

- **signal_conversation**: Add `replyContext` as a separate top-level optional field (not nested in payload). Uses `ReplyContextSchema.optional()` for Zod validation of the discriminated union at the tool boundary
- **start_conversation**: Add `replyContext` as a separate top-level optional field. Critical for agents that complete without pausing -- without replyContext on start, they have no way to reply to the originating channel
- **Consistency**: Top-level field matches Phase 61's IncomingEventSchema and SignalSchema placement. Payload carries signal-specific data (approved, feedback); replyContext is routing metadata. Different concerns, different fields
- **eventReplyContext in deps**: Add to `EventRouterDeps` (or the tool-construction-time context). Set when the router creates tools for a specific incoming event, alongside existing correlationId pattern

### Claude's Discretion

- Exact wording of the `<follow_up_routing>` prompt section
- Whether to add a fast-path success criterion beyond what's in the roadmap
- How to surface the agent echo filtering dependency to the planner (note in plan vs separate prerequisite)
- Exact field name in deps (`eventReplyContext` vs `incomingEventReplyContext` etc.)

### Deferred Ideas (OUT OF SCOPE)

- **Agent echo filtering for Linear comments** -- needed before production use of Linear comment routing. Belongs in the Linear integration layer or adapter, not the router. Phase 62 should flag as a dependency
- **GitHub PR comment routing** -- follow-up messages on GitHub PRs follow the same pattern. Will be one additional entry in the correlation key table when implemented
</user_constraints>

## Standard Stack

### Core

No new libraries needed. Phase 62 uses only existing codebase patterns and dependencies.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | existing | ReplyContextSchema validation on tool input boundary | Already used in all tool schemas and adapter types |
| vitest | existing | Unit tests for tool schema changes and routing logic | Project standard test runner |

### Supporting

N/A -- no additional libraries.

### Alternatives Considered

N/A -- all decisions are locked. No library choices to make.

## Architecture Patterns

### File Structure (files modified, no new files)

```
packages/agents/src/
  router/
    types.ts                    # Add eventReplyContext to EventRouterDeps
    tools/
      signal-conversation.ts    # Add replyContext field to schema + auto-inject
      start-conversation.ts     # Add replyContext field to schema + auto-inject
    system-prompt.ts            # Replace <slack_thread_reply_routing> with <follow_up_routing>
    slow-path.ts                # Pass eventReplyContext when creating tool deps
    router.ts                   # Pass incomingEvent.replyContext to slow-path deps
```

### Pattern 1: replyContext Auto-Injection in Tool Execute Functions

**What:** Each tool's `execute()` function reads `input.replyContext` from the LLM, falling back to `deps.eventReplyContext` from the incoming event. The LLM can override by providing an explicit value, but normally doesn't need to.

**When to use:** Only for `signal_conversation` and `start_conversation` -- the two tools that deliver data to the executor.

**Current signal_conversation execute (lines 80-98):**
```typescript
async execute(input: unknown): Promise<ToolResult> {
  const parsed = SignalConversationInputSchema.safeParse(input);
  // ... validation ...
  const { conversationId, signalType, payload, message } = parsed.data;
  const signal: Signal = {
    type: signalType,
    data: payload,
    message,
    source: "router",
  };
  // ... executor.signal() call ...
}
```

**After change:**
```typescript
async execute(input: unknown): Promise<ToolResult> {
  const parsed = SignalConversationInputSchema.safeParse(input);
  // ... validation ...
  const { conversationId, signalType, payload, message, replyContext: inputReplyContext } = parsed.data;
  const replyContext = inputReplyContext ?? deps.eventReplyContext;
  const signal: Signal = {
    type: signalType,
    data: payload,
    message,
    source: "router",
    ...(replyContext && { replyContext }),
  };
  // ... executor.signal() call ...
}
```

**Confidence:** HIGH -- directly follows the pattern established in Phase 61 for conditional spread.

### Pattern 2: eventReplyContext Threading Through Slow-Path

**What:** The slow-path creates tool instances per invocation (once per event). The incoming event's replyContext must be available to those tools. Since the slow-path receives a `NormalizedEvent` (pre-adapter), the replyContext needs to come from the adapted `IncomingEvent` via the deps.

**Current slow-path invocation in router.ts (line 287):**
```typescript
case "slow_path": {
  void routeViaAgentLoopV2(event, deps).catch((error) => { ... });
}
```

**Problem:** `routeViaAgentLoopV2` receives `NormalizedEvent` (not `IncomingEvent`) and `EventRouterDeps` (which currently has no event-specific context). The `IncomingEvent.replyContext` produced by adapters is not available to tool factories.

**Solution:** The slow-path dispatch in `router.ts` already has access to `routeDecision.event` (the `IncomingEvent` from the `slow_path` route decision). It should create a deps object with `eventReplyContext` set:

```typescript
case "slow_path": {
  const slowPathDeps = routeDecision.event.replyContext
    ? { ...deps, eventReplyContext: routeDecision.event.replyContext }
    : deps;
  void routeViaAgentLoopV2(event, slowPathDeps).catch((error) => { ... });
}
```

Wait -- `routeViaAgentLoopV2` takes `EventRouterDeps`, not `RouteEventDeps`. `EventRouterDeps` doesn't include `eventRouter` (which is only on `RouteEventDeps`). But TypeScript structural typing means we can pass a wider type. We need to ensure `eventReplyContext` is on `EventRouterDeps` since that's what tool factories receive.

**Confidence:** HIGH -- straightforward deps threading, consistent with existing patterns.

### Pattern 3: Unified Follow-Up Routing in System Prompt

**What:** Replace the Slack-specific `<slack_thread_reply_routing>` XML section with a channel-agnostic `<follow_up_routing>` section that covers all follow-up message sources using a correlation key lookup table.

**Current prompt structure:**
```
<identity> ... </identity>
<fast_path_context> ... </fast_path_context>
<available_agents> ... </available_agents>
<routing_rules> ... </routing_rules>
<slack_thread_reply_routing> ... </slack_thread_reply_routing>  <-- REPLACE
<intent_classification> ... </intent_classification>
<constraints> ... </constraints>
<tools> ... </tools>
```

**New `<follow_up_routing>` structure:**
- One procedure for all follow-up messages regardless of source
- Correlation key lookup table: Slack = threadTs, Linear = issueId, GitHub = owner/repo/prNumber (future)
- Clear guidance: query_conversations by correlationRef, check status, signal/reopen/ignore
- For product-agent: always forward as user_reply (agent handles classification)
- For dev-agent: classify intent first, then signal with appropriate type
- No match found: ignore

**Confidence:** HIGH -- this is prompt text, not code. The procedure already exists for Slack; we're generalizing it.

### Anti-Patterns to Avoid

- **Adding replyContext to reopen_conversation**: Per CONTEXT.md, replyContext flows through the paired signal_conversation call, not reopen. Reopen changes status; the follow-up signal carries the new replyContext.
- **Creating middleware/wrapper for replyContext injection**: Only two tools need it. A shared abstraction would be premature.
- **Encoding channel-specific routing in the prompt**: The prompt should describe one procedure, not per-channel branches.
- **Forgetting conditional spread**: Per Phase 61 patterns, use `...(replyContext && { replyContext })` for `exactOptionalPropertyTypes` compliance.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| replyContext validation | Custom type guards | `ReplyContextSchema.optional()` from `shared/communication/types.ts` | Zod discriminated union handles all three channel variants; custom validation would miss edge cases |
| Channel-aware routing | if/else per channel in router code | Prompt-based classification with correlation key table | The LLM handles channel-agnostic intent classification natively; deterministic channel routing creates brittle code |

## Common Pitfalls

### Pitfall 1: exactOptionalPropertyTypes Breaking Conditional Assignment

**What goes wrong:** Assigning `undefined` to an optional property violates TypeScript's `exactOptionalPropertyTypes`. Code like `replyContext: input.replyContext` where `input.replyContext` can be `undefined` causes a type error.
**Why it happens:** Phase 61 established this pattern, and the project has `exactOptionalPropertyTypes` enabled.
**How to avoid:** Use conditional spread: `...(replyContext && { replyContext })` for Signal and StartConversationParams.
**Warning signs:** TypeScript error "Type 'undefined' is not assignable to type..."

### Pitfall 2: NormalizedEvent vs IncomingEvent in Slow-Path

**What goes wrong:** The slow-path function `routeViaAgentLoopV2` takes `NormalizedEvent`, which is the raw pre-adapter event. It does NOT have `replyContext`. If you try to extract replyContext from the `NormalizedEvent` passed to the slow-path, it won't be there.
**Why it happens:** The slow-path was designed before replyContext existed. It receives the raw event and re-formats it for the LLM. The `IncomingEvent` (with replyContext) is only available in the `routeDecision.event` from `EventRouter.handle()`.
**How to avoid:** Thread `eventReplyContext` through the deps object, not through the event itself. The slow-path route case in `router.ts` has access to `routeDecision.event.replyContext` and should set it on the deps.
**Warning signs:** `replyContext` is always `undefined` in slow-path tool invocations.

### Pitfall 3: Fast-Path replyContext Already Partially Wired

**What goes wrong:** Phase 61 already wired replyContext forwarding in the fast-path for the `start` and `signal` cases in `router.ts` and `event-router.ts`. Double-wiring or conflicting changes would break what works.
**Why it happens:** Phase 61 Plan 03 already added: (1) `...(routeDecision.event.replyContext && { replyContext: routeDecision.event.replyContext })` to the start case, (2) `...(event.replyContext && { replyContext: event.replyContext })` to the EventRouter signal construction, (3) `...(event.replyContext && { replyContext: event.replyContext })` in task routing signal construction.
**How to avoid:** Verify the existing fast-path wiring is already correct before adding anything. Phase 62 success criterion 4 says "Fast-path routes propagate replyContext" -- this is ALREADY true from Phase 61. Phase 62 needs to verify this, not re-implement it.
**Warning signs:** Redundant spread expressions in router.ts, lint warnings about dead code.

### Pitfall 4: Agent Echo Filtering Not in Scope

**What goes wrong:** Linear comment routing without echo filtering creates an infinite loop: agent comments on issue -> webhook fires -> router signals agent -> agent comments again.
**Why it happens:** Slack already has Bolt's built-in bot message filtering. GitHub has sender.type "Bot". Linear has no equivalent filtering in the adapter or integration layer.
**How to avoid:** Phase 62 should flag this as a prerequisite dependency. The Linear adapter or integration webhook handler needs to filter out comments made by the agent's own OAuth user before Phase 62's Linear comment routing goes to production.
**Warning signs:** Infinite conversation loops when an agent comments on a Linear issue.

### Pitfall 5: Adapter Already Produces Domain Types for Linear Comments

**What goes wrong:** The Linear adapter already transforms `linear.comment.created` into `{ type: "issue_comment", correlationKey: issueId }` and `linear.agent_session.prompted` into `{ type: "agent_prompt", correlationKey: issueId }`. Neither of these types is in SIGNAL_AGENT_MAP or in the start rules, so they currently fall to slow_path. The prompt needs to handle `issue_comment` (the adapted type), not `linear.comment.created` (the raw type).
**Why it happens:** The adapters run before the EventRouter, transforming raw event types into domain types. The slow-path LLM sees the original `NormalizedEvent` type (not the adapted type) in `formatEventForLLM`. But the *tools* are created with adapted event context.
**How to avoid:** The prompt's `<fast_path_context>` section lists event types that reach the LLM. Currently it says `linear.comment.created` reaches the LLM, but the LLM actually sees the `NormalizedEvent` which has `type: "linear.comment.created"` (the original webhook type, since `formatEventForLLM` uses the raw `NormalizedEvent`). The prompt should reference `linear.comment.created` (what the LLM sees in the event payload), and the routing procedure should use `issueId` from the event payload for the `correlationRef` query.
**Warning signs:** LLM can't find the event type referenced in the prompt guidance.

## Code Examples

### Example 1: signal_conversation Tool Schema Change

```typescript
// Current schema (signal-conversation.ts line 21-48)
const SignalConversationInputSchema = z.object({
  conversationId: z.string().describe("..."),
  signalType: z.enum([...]).describe("..."),
  payload: z.record(z.unknown()).optional().describe("..."),
  message: z.string().optional().describe("..."),
});

// New schema -- add replyContext as top-level optional field
const SignalConversationInputSchema = z.object({
  conversationId: z.string().describe("..."),
  signalType: z.enum([...]).describe("..."),
  payload: z.record(z.unknown()).optional().describe("..."),
  message: z.string().optional().describe("..."),
  replyContext: ReplyContextSchema.optional().describe(
    "Reply context for routing responses back to the originating channel. Usually auto-injected from the incoming event -- only provide explicitly if overriding."
  ),
});
```

### Example 2: Auto-Injection in signal_conversation execute()

```typescript
// In the execute function, after parsing:
const { conversationId, signalType, payload, message, replyContext: inputReplyContext } = parsed.data;
const replyContext = inputReplyContext ?? deps.eventReplyContext;

const signal: Signal = {
  type: signalType,
  data: payload,
  message,
  source: "router",
  ...(replyContext && { replyContext }),
};
```

### Example 3: EventRouterDeps Extension

```typescript
// router/types.ts -- EventRouterDeps
export interface EventRouterDeps {
  executor: ConversationExecutor;
  logger: PinoLogger;
  alertsChannel?: string | undefined;
  linearTeamId?: string | undefined;
  /** Reply context from the current incoming event, auto-injected into tool calls */
  eventReplyContext?: ReplyContext | undefined;  // NEW
}
```

### Example 4: Slow-Path Deps Threading

```typescript
// router.ts, case "slow_path":
case "slow_path": {
  const slowPathDeps: EventRouterDeps = {
    ...deps,
    ...(routeDecision.event.replyContext && {
      eventReplyContext: routeDecision.event.replyContext,
    }),
  };
  void routeViaAgentLoopV2(event, slowPathDeps).catch((error) => { ... });
  return { received: true, action: "classifying" };
}
```

### Example 5: start_conversation Schema + Execute Change

```typescript
// start-conversation.ts -- schema
const StartConversationInputSchema = z.object({
  agentDefinitionId: z.enum(["dev-agent", "product-agent"]).describe("..."),
  correlationKey: z.string().describe("..."),
  input: z.record(z.unknown()).describe("..."),
  replyContext: ReplyContextSchema.optional().describe(
    "Reply context for routing responses back to the originating channel. Usually auto-injected from the incoming event."
  ),
});

// execute() -- after parsing:
const { agentDefinitionId, correlationKey, input: conversationInput, replyContext: inputReplyContext } = parsed.data;
const replyContext = inputReplyContext ?? deps.eventReplyContext;

const conversationId = await deps.executor.start({
  agentDefinitionId,
  correlationKey,
  initialMessage: JSON.stringify(conversationInput),
  ...(replyContext && { replyContext }),
});
```

## State of the Art

| Component | Current State | After Phase 62 | Impact |
|-----------|--------------|-----------------|--------|
| signal_conversation schema | No replyContext field | Optional replyContext field + auto-injection | Signals carry channel routing metadata |
| start_conversation schema | No replyContext field | Optional replyContext field + auto-injection | New conversations know where to reply |
| EventRouterDeps | No event-specific context | Has eventReplyContext field | Tools can auto-inject replyContext |
| Router system prompt | Slack-specific `<slack_thread_reply_routing>` | Channel-agnostic `<follow_up_routing>` | Linear comments routed same as Slack threads |
| Fast-path replyContext | Already wired (Phase 61) | Verified, no changes needed | Phase 61 handled this |

**Already complete from Phase 61 (do not re-implement):**
- `IncomingEventSchema` has `replyContext` field (adapters/types.ts line 40)
- `SignalSchema` has `replyContext` field (framework/types.ts line 443)
- `StartConversationParams` has `replyContext` field (framework/types.ts line 492)
- EventRouter fast-path forwards replyContext in signal construction (event-router.ts line 131)
- Router start case forwards replyContext to executor.start() (router.ts line 233-235)
- Task routing forwards replyContext in both signal and start paths (router.ts lines 93, 128)
- Executor signal() updates reply_context column and appends XML tag (conversation-executor.ts)
- Executor start() stores replyContext and appends XML tag (conversation-executor.ts)
- Adapters extract replyContext from all event types (linear.ts, slack.ts, github.ts)

## Key File Inventory

### Files to Modify

| File | What Changes | Lines Affected |
|------|-------------|----------------|
| `packages/agents/src/router/types.ts` | Add `eventReplyContext` to `EventRouterDeps` | ~5 lines added around line 52 |
| `packages/agents/src/router/tools/signal-conversation.ts` | Add replyContext to schema + auto-inject in execute | Schema: ~4 lines, Execute: ~5 lines |
| `packages/agents/src/router/tools/start-conversation.ts` | Add replyContext to schema + auto-inject in execute | Schema: ~4 lines, Execute: ~5 lines |
| `packages/agents/src/router/system-prompt.ts` | Replace `<slack_thread_reply_routing>` with `<follow_up_routing>`, generalize `<intent_classification>`, add minimal replyContext guidance, update `<tools>` section | ~40-50 lines changed |
| `packages/agents/src/router/router.ts` | Pass `eventReplyContext` to slow-path deps | ~5 lines changed |
| `packages/agents/src/router/slow-path.ts` | No changes needed (tool factories already receive full deps) | 0 lines |

### Files to Create

None.

### Test Files to Modify/Create

| File | What Changes |
|------|-------------|
| `packages/agents/src/router/tools/signal-conversation.test.ts` | New test file: schema validation, auto-injection, LLM override |
| `packages/agents/src/router/tools/start-conversation.test.ts` | New test file: schema validation, auto-injection |
| `packages/agents/src/router/router.test.ts` | Add tests for slow-path replyContext deps threading |
| `packages/agents/src/framework/event-router.test.ts` | Verify existing fast-path tests (no changes expected) |

## Open Questions

1. **Slow-path replyContext visibility to LLM**
   - What we know: `formatEventForLLM()` formats the `NormalizedEvent` payload for the LLM. The `NormalizedEvent` payload may or may not contain the raw channel information (teamId, channelId, etc.) depending on the integration webhook.
   - What's unclear: Whether the LLM has enough information to construct a replyContext override. In practice, auto-injection handles 99% of cases, so this is a minor edge case.
   - Recommendation: Auto-injection via deps handles the default case. The LLM override path exists for edge cases but will rarely be used. No action needed.

2. **Agent echo filtering timeline**
   - What we know: Phase 62 routes Linear comments but does NOT filter agent-originated comments. Production use requires echo filtering.
   - What's unclear: When echo filtering will be implemented. It's deferred from Phase 62.
   - Recommendation: Document as a known limitation/prerequisite in the plan. Flag with a `// TODO(echo-filtering):` comment in the Linear comment routing prompt section.

## Dependency Analysis

### Phase 61 Deliverables Used

- `ReplyContextSchema` from `shared/communication/types.ts` -- used in tool schema validation
- `ReplyContext` type from `shared/communication/types.ts` -- used in `EventRouterDeps` type
- `replyContext` field on `IncomingEvent`, `Signal`, `StartConversationParams` -- all consumed by Phase 62 code
- Fast-path replyContext wiring in `event-router.ts`, `router.ts`, `conversation-executor.ts` -- verified working, not modified

### Cross-Cutting Dependencies

- **Agent echo filtering (Linear)**: NOT delivered by Phase 62. Must be addressed before Linear comment routing goes to production. Belongs in adapter or integration webhook layer.
- **Phase 63 (outbound denormalizer)**: Will consume the replyContext that Phase 62 ensures is present. No coupling -- Phase 62 just makes replyContext available, Phase 63 acts on it.
- **Phase 65 (agent prompts)**: Will reference replyContext in agent prompts. Phase 62's router prompt changes are independent.

## Sources

### Primary (HIGH confidence)

- **Codebase inspection**: All source files read directly from the working tree
  - `packages/agents/src/router/` -- all 12 files (router.ts, types.ts, system-prompt.ts, slow-path.ts, enrichment.ts, index.ts, and all 5 tool files + router.test.ts)
  - `packages/agents/src/framework/event-router.ts` and `event-router.test.ts`
  - `packages/agents/src/framework/types.ts` (Signal, StartConversationParams, EventRouter interfaces)
  - `packages/agents/src/adapters/` (linear.ts, slack.ts, github.ts, types.ts)
  - `packages/agents/src/shared/communication/types.ts` (ReplyContextSchema)
  - `packages/agents/src/shared/communication/message-utils.ts` (appendReplyContextTag)
  - `packages/agents/src/shared/agent-loop/types.ts` (ToolDefinition interface)

- **Phase 61 summaries**: `61-03-SUMMARY.md` confirms replyContext end-to-end wiring is complete

- **Phase 62 CONTEXT.md**: Locked decisions from user discussion

- **ROADMAP.md**: Phase 62 requirements and success criteria

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing patterns
- Architecture: HIGH -- straightforward deps threading and schema extension, following Phase 61 patterns exactly
- Pitfalls: HIGH -- identified from direct code reading and Phase 61 experience with exactOptionalPropertyTypes
- Prompt changes: MEDIUM -- prompt wording is subjective, but the structural change (replace Slack-specific with channel-agnostic) is clear

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (stable codebase, no external dependency changes)
