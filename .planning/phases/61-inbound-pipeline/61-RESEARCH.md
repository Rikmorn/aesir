# Phase 61: Inbound Pipeline - Research

**Researched:** 2026-02-08
**Domain:** Adapter replyContext extraction, signal message formatting, executor wiring
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Adapter extraction scope
- **Every adapter output that has enough data to construct a replyContext includes one** -- adapters normalize data, they don't classify intent. Deciding whether an event warrants a reply is the agent's job
- The only events without replyContext are ones that genuinely have no originating channel (internal signals like timeout expirations or scheduled events)
- Slack: extract `teamId` from the webhook's top-level `team_id` field. If missing (malformed webhook), omit replyContext entirely rather than falling back to config -- a wrong teamId could route to the wrong workspace
- Linear: pass through whatever the webhook provides as `issueId` (UUID or identifier like ABC-123). No normalization -- the Linear SDK and MCP tool accept both formats
- GitHub: extract `owner` and `repo` from the webhook's `repository.owner.login` and `repository.name` fields, not from env config. Webhook is the ground truth for "where did this event come from"

#### Signal message format
- **XML tag format: `<reply_context>{JSON}</reply_context>`** -- LLMs are good at extracting structured data from XML tags and passing it as JSON in tool calls
- **Appended at the end of the message** after all human-readable content. Signal text comes first for comprehension, reply_context trails as metadata
- **Append to existing format, don't restructure** -- the current `buildSignalMessage` output works. Append `\n\n<reply_context>...</reply_context>` after the existing string. Minimal blast radius
- **Only append when replyContext is present** -- absence of the tag IS the signal that there's no reply address. No empty/null tags. LLMs handle absence naturally

#### start() path replyContext
- **Phase 61 scope: schema + executor wiring** -- StartConversationParams gets optional replyContext field, executor stores it on the conversation row and includes it in the initial message
- **Phase 62 scope: router wiring** -- router's start_conversation tool adds replyContext to its input schema, router prompt tells the LLM to forward it
- **Same message format as signals** -- initial message appends `<reply_context>` tag at the end, identical pattern. Agent doesn't need to distinguish between initial message and signal resume
- Phase 61's start() changes are testable in isolation: call executor.start({ ..., replyContext }) directly and verify it persists and appears in the message

#### Overwrite semantics
- **Column: only update when signal has replyContext** -- if signal has no replyContext, leave the existing value. The column is "last known reply address," not "this signal's reply address." A timeout signal shouldn't wipe out the Slack thread context from the original human message
- **Messages: each signal gets its own `<reply_context>` tag** -- agent sees all replyContexts in conversation history and can reply to any signal using its specific replyContext. The column is a convenience projection; message history is the complete record
- **No "channel changed" marker** -- if the conversation moves from Slack to Linear, each message has a different `<reply_context>` tag. The LLM can read the difference without infrastructure annotations

### Claude's Discretion
- Exact implementation of the replyContext extraction helper (shared function vs inline per adapter)
- How to handle edge cases in adapter extraction (e.g., Slack events without a channel, GitHub events without a PR number)
- Whether to add a utility function for appending reply_context tags to messages

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

## Summary

Phase 61 threads `replyContext` from webhook adapters through to signal delivery. The implementation touches four layers: (1) the IncomingEvent and Signal schemas gain an optional `replyContext` field, (2) each adapter extracts replyContext from available webhook payload data, (3) the ConversationExecutor's `start()` and `signal()` methods store replyContext on the conversation row and append `<reply_context>` XML tags to messages, and (4) the worker loop's signal consumption paths also append the tag.

The codebase is well-structured for this change. The `ReplyContext` Zod type already exists in `packages/agents/src/shared/communication/types.ts` (shipped in Phase 60). The `conversations` table already has a `reply_context JSONB` column (migration `0006_add_reply_context.sql`). The adapter->router->executor pipeline is clean and testable. All three adapters follow identical patterns, and all have existing test files.

**Primary recommendation:** Use a shared `appendReplyContextTag()` helper function and a per-adapter `extractReplyContext()` function. The tag appending is identical everywhere (3 places in executor + 2 in worker loop), so DRY wins. The extraction is adapter-specific but small enough to inline within each adapter's switch cases.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | (monorepo) | Schema validation for ReplyContext on IncomingEvent/Signal | Already used for all schemas in types.ts |
| drizzle-orm | (monorepo) | Database operations for reply_context column | Already used for conversations table |
| vitest | (monorepo) | Unit testing for adapters and executor | Project standard |

### Supporting
No new libraries needed. All infrastructure exists.

### Alternatives Considered
None -- this phase uses only existing libraries.

## Architecture Patterns

### Recommended File Changes

```
packages/agents/src/
├── adapters/
│   ├── types.ts          # Add optional replyContext to IncomingEventSchema
│   ├── slack.ts          # Extract replyContext for each event case
│   ├── linear.ts         # Extract replyContext for each event case
│   ├── github.ts         # Extract replyContext for each event case
│   ├── pass-through.ts   # No replyContext (fallback adapter)
│   ├── slack.test.ts     # Verify replyContext extraction
│   ├── linear.test.ts    # Verify replyContext extraction
│   └── github.test.ts    # Verify replyContext extraction
├── framework/
│   ├── types.ts          # Add replyContext to SignalSchema, StartConversationParams
│   ├── conversation-executor.ts  # Store replyContext, append XML tag to messages
│   ├── conversation-executor.test.ts  # Test replyContext wiring
│   └── worker-loop.ts    # Append XML tag in signal consumption paths
└── shared/
    └── communication/
        ├── types.ts       # Already has ReplyContext (Phase 60)
        └── message-utils.ts  # NEW: appendReplyContextTag() helper
```

### Pattern 1: ReplyContext on IncomingEvent

**What:** Add optional `replyContext` to `IncomingEventSchema` in `adapters/types.ts`.
**When to use:** Every adapter output that has enough data to construct one.

The ReplyContextSchema already exists. Import it and add it as optional:

```typescript
import { ReplyContextSchema } from "../shared/communication/types.js";

export const IncomingEventSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()),
  source: z.string().min(1),
  correlationKey: z.string().optional(),
  deduplicationId: z.string().optional(),
  message: z.string().optional(),
  taskId: z.string().optional(),
  replyContext: ReplyContextSchema.optional(),  // NEW
});
```

### Pattern 2: Adapter ReplyContext Extraction

**What:** Each adapter case constructs a `ReplyContext` from available webhook payload fields.
**When to use:** For every event that has enough data.

Slack example (app_mention.created):
```typescript
case "slack.app_mention.created": {
  const threadTs = (payload.threadTs as string) || (payload.ts as string);
  const teamId = payload.teamId as string | undefined;
  const channelId = payload.channel as string | undefined;

  return {
    type: "slack.app_mention.created",
    data: { ... },
    source: "slack:webhook",
    correlationKey: threadTs,
    // Only include replyContext if we have the required fields
    ...(teamId && channelId && {
      replyContext: {
        channel: "slack" as const,
        teamId,
        channelId,
        threadTs,
      },
    }),
  };
}
```

Linear example (comment.created):
```typescript
case "linear.comment.created": {
  const issueId = payload.issueId as string;
  return {
    type: "issue_comment",
    data: { ... },
    source: "linear:webhook",
    correlationKey: issueId,
    replyContext: {
      channel: "linear" as const,
      issueId,
    },
  };
}
```

GitHub example (pr_review):
```typescript
// payload.repository is available in the NormalizedEvent payload
const repository = payload.repository as { owner: string; name: string } | undefined;
const prNumber = payload.prNumber as number;

return {
  type: "pr_review",
  data: { ... },
  source: "github:webhook",
  ...(repository?.owner && repository?.name && prNumber && {
    replyContext: {
      channel: "github" as const,
      owner: repository.owner,
      repo: repository.name,
      prNumber,
    },
  }),
};
```

### Pattern 3: Signal Schema Extension

**What:** Add optional `replyContext` to `SignalSchema` in `framework/types.ts`.

```typescript
import { ReplyContextSchema } from "../shared/communication/types.js";

export const SignalSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  source: z.string().optional(),
  deduplicationId: z.string().optional(),
  replyContext: ReplyContextSchema.optional(),  // NEW
});
```

### Pattern 4: XML Tag Append Helper

**What:** Shared function that appends `<reply_context>` XML tag to a message string.
**When to use:** Signal message construction (3 locations) and start() initial message.

```typescript
// packages/agents/src/shared/communication/message-utils.ts
import type { ReplyContext } from "./types.js";

/**
 * Append a <reply_context> XML tag to a message string.
 * Returns the message unchanged if replyContext is undefined/null.
 */
export function appendReplyContextTag(
  message: string,
  replyContext: ReplyContext | undefined | null,
): string {
  if (!replyContext) return message;
  return `${message}\n\n<reply_context>${JSON.stringify(replyContext)}</reply_context>`;
}
```

### Pattern 5: Executor Signal Delivery with ReplyContext

**What:** When delivering a signal, update `reply_context` column (if signal has one) and append XML tag to message.

In `conversation-executor.ts` signal() method:
```typescript
// Build signal message
const signalContent =
  signal.message ??
  `Signal received: ${signal.type}. Data: ${JSON.stringify(signal.data ?? {})}`;
// Append reply_context tag if present
const finalContent = appendReplyContextTag(signalContent, signal.replyContext);
const signalMessage = { role: "user", content: finalContent };

// Update conversation row -- only update reply_context when signal has one
await tx.update(conversations).set({
  status: "queued",
  messages: updatedMessages,
  pending_wait: null,
  delivered_signal_ids: deliveredIds,
  ...(signal.replyContext && { reply_context: signal.replyContext }),
  updated_at: new Date(),
}).where(eq(conversations.id, conversationId));
```

### Pattern 6: Executor start() with ReplyContext

**What:** `StartConversationParams` gets optional `replyContext` field. Executor stores it and appends tag.

```typescript
export interface StartConversationParams {
  agentDefinitionId: string;
  correlationKey: string;
  initialMessage: string;
  context?: string;
  parentConversationId?: string;
  taskId?: string;
  replyContext?: ReplyContext;  // NEW
}
```

In the start() method, after building `fullMessage`:
```typescript
const messageWithContext = appendReplyContextTag(fullMessage, params.replyContext);

await tx.insert(conversations).values({
  id: baseId,
  ...
  messages: [{ role: "user", content: messageWithContext }],
  reply_context: params.replyContext ?? null,
  ...
});
```

### Anti-Patterns to Avoid

- **Don't validate replyContext against the event type.** The adapter constructs it; the executor stores it blindly. No `if (event.source === "slack") { validateSlackContext(replyContext) }` in the executor.
- **Don't add replyContext to the pass-through adapter.** It's a fallback for unrecognized events -- it has no structured payload to extract from.
- **Don't update reply_context column to null when a signal has no replyContext.** Per locked decisions, absence means "leave existing." Only presence updates.
- **Don't try to merge replyContexts.** Each message has its own tag. The column is the latest projection. No deep-merge logic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ReplyContext type | Custom type | `ReplyContextSchema` from `shared/communication/types.ts` | Already exists (Phase 60) |
| Database column | New migration | Existing `reply_context JSONB` column | Already exists (migration 0006) |
| XML tag parsing | Custom parser | Simple string concatenation | `<reply_context>JSON</reply_context>` is just string formatting |

**Key insight:** Phase 60 already shipped the foundational types and migration. Phase 61 only wires them through the adapter-to-executor pipeline.

## Common Pitfalls

### Pitfall 1: Missing Signal Message Construction Sites
**What goes wrong:** Only updating `conversation-executor.ts` signal() but missing the worker-loop signal consumption paths.
**Why it happens:** There are THREE places where signal messages are constructed:
1. `conversation-executor.ts` signal() method (lines 387-393) -- signal delivery to waiting conversations
2. `worker-loop.ts` pre-claim signal consumption (lines 670-677) -- queued signal consumed before agent loop
3. `worker-loop.ts` post-wait_for signal auto-resume (lines 919-925) -- queued signal consumed at pause point
**How to avoid:** Grep for `signalContent =` across the codebase. All three must use `appendReplyContextTag()`.
**Warning signs:** Tests pass for executor signal delivery but queued signal consumption doesn't include `<reply_context>` tags.

### Pitfall 2: GitHub Repository Data Nested in NormalizedEvent Payload
**What goes wrong:** Looking for `payload.owner` and `payload.repo` directly, finding undefined.
**Why it happens:** The GitHub normalizer stores repository data under `payload.repository` as `{ owner: string, name: string, fullName: string }`. The adapter's `payload` is `event.payload as Record<string, unknown>`, so `repository` is a nested object.
**How to avoid:** Access via `payload.repository` and cast to `{ owner: string; name: string }`. Check the GitHub normalizer (`packages/integrations/github/src/dispatcher/normalize.ts`) for the exact shape.
**Warning signs:** GitHub replyContext always has undefined owner/repo.

### Pitfall 3: Slack teamId Location Varies by Event Type
**What goes wrong:** Looking for `payload.teamId` on block_actions events and finding undefined.
**Why it happens:** The Slack normalizer puts `teamId` at the top level of the NormalizedEvent payload for ALL event types (both Events API and block_actions), extracted from different places per event type. But the adapter already accesses `payload.teamId` directly, so this should work consistently.
**How to avoid:** Verify in the Slack normalizer that `teamId` is present in the payload for all event types. For block_actions (approval buttons), the normalizer extracts `teamId` from `event.team?.id` or falls back to `"unknown"`. If it's `"unknown"`, omit replyContext entirely.
**Warning signs:** Slack approval events have `teamId: "unknown"` in replyContext.

### Pitfall 4: Forgetting to Thread replyContext from IncomingEvent to Signal
**What goes wrong:** Adapters add replyContext to IncomingEvent, but the EventRouter builds Signal objects without it.
**Why it happens:** The EventRouter's handle() method constructs Signal from IncomingEvent fields. Currently it maps `type`, `data`, `message`, `source`, `deduplicationId` but NOT `replyContext`.
**How to avoid:** Update EventRouter.handle() to include `replyContext` when building Signal objects. Same for the task-routing path in `router.ts` (routeViaTask).
**Warning signs:** Signals delivered through fast-path routing never have replyContext.

### Pitfall 5: Worker Loop Signal Objects Don't Have replyContext
**What goes wrong:** The worker loop reads queued signals from `conv.queued_signals`, which are stored as raw JSON. If the Signal was queued before replyContext was added to SignalSchema, the stored signal won't have it.
**Why it happens:** Queued signals are persisted as JSON in the `queued_signals` JSONB column. The worker loop casts them to `Array<{ type; data?; message? }>` -- note this doesn't include `replyContext`.
**How to avoid:** Update the worker loop's type assertion to include `replyContext?: ReplyContext`. The JSON serialization preserves the field automatically if it was present when the signal was queued.
**Warning signs:** Queued signals consumed by the worker loop never include `<reply_context>` tags even when they should.

## Code Examples

### Example 1: Slack Adapter ReplyContext Extraction

The Slack adapter handles 6 event types. For replyContext, the relevant fields are `teamId`, `channel` (channelId), and `threadTs`. All are present in the NormalizedEvent payload (set by the Slack normalizer).

**Available payload fields per event type:**

| Event Type | teamId | channelId | threadTs | Notes |
|-----------|--------|-----------|----------|-------|
| `block_actions.approved` | Not in payload | `payload.channel` | `payload.messageTs` | Approval buttons -- interactions handler sets `channel` |
| `block_actions.rejected` | Not in payload | `payload.channel` | `payload.messageTs` | Same as approved |
| `block_actions.escalation_retry` | Not in payload | Not available | Not available | Only has `taskIdentifier` |
| `block_actions.escalation_abort` | Not in payload | Not available | Not available | Only has `taskIdentifier` |
| `app_mention.created` | `payload.teamId` | `payload.channel` | `payload.threadTs` or `payload.ts` | Has all fields |
| `message.created` (thread) | `payload.teamId` | `payload.channel` | `payload.threadTs` | Has all fields |

**Critical observation:** For `block_actions` events (approval/rejection), the NormalizedEvent is constructed by the Slack interactions handler (`packages/integrations/slack/src/api/interactions.ts`), NOT the Slack normalizer. The interactions handler puts `channel: channelId` and `messageTs` in the payload, but does NOT include `teamId`. The `user.team_id` is available on the raw Slack payload object but not forwarded to the NormalizedEvent.

**Recommendation for block_actions:** The interactions handler would need to be updated to include `teamId` in the NormalizedEvent payload. Since the `SlackBlockActionsPayload` has `user.team_id`, this is available. However, modifying integration packages is potentially a separate concern. Alternatively, omit replyContext for block_actions events since approval signals don't typically need reply routing (the agent's reply goes to the original channel, not the approval button location).

**For events from the Slack normalizer** (app_mention, message), `teamId` is always present (extracted by `extractTeamId()` in the parser). These are the primary Slack events that need replyContext.

### Example 2: GitHub Repository Object in Payload

The GitHub normalizer stores repository data at `payload.repository`:

```typescript
// From normalizePRReviewEvent:
payload: {
  action: payload.action,
  prNumber: payload.pull_request.number,
  // ... other fields ...
  repository: {
    owner: payload.repository.owner.login,   // <-- owner
    name: payload.repository.name,            // <-- repo
    fullName: payload.repository.full_name,
  },
}

// From normalizePRClosedEvent:
payload: {
  prNumber: payload.pull_request.number,
  branchName: payload.pull_request.head.ref,
  // ... other fields ...
  repository: {
    owner: payload.repository.owner.login,   // <-- owner
    name: payload.repository.name,            // <-- repo
    fullName: payload.repository.full_name,
  },
}
```

So in the GitHub adapter, access via:
```typescript
const repo = payload.repository as { owner: string; name: string } | undefined;
```

### Example 3: Linear Payload Structure

For `linear.agent_session.created`:
```typescript
payload: {
  sessionId: payload.agentSession.id,
  issueId: payload.agentSession.issueId,  // <-- issueId for replyContext
  status: payload.agentSession.status,
  url: payload.agentSession.url,
  creatorId: payload.agentSession.creator?.id,
}
```

For `linear.comment.created`:
```typescript
payload: {
  commentId: payload.data.id,
  commentBody: payload.data.body,
  issueId: payload.data.issueId,  // <-- issueId for replyContext
  userId: payload.data.userId,
  // ... other fields
}
```

The adapter already extracts `issueId` from the payload for correlationKey. The same value works for replyContext.

### Example 4: EventRouter Signal Construction (Needs Update)

Current code in `event-router.ts` handle() method:
```typescript
const signal: Signal = {
  type: event.type,
  data: event.data,
  message: event.message,
  source: event.source,
  deduplicationId: event.deduplicationId,
  // Missing: replyContext: event.replyContext,
};
```

The fix is adding `replyContext: event.replyContext` to this object. Same for the task routing path in `router.ts`.

### Example 5: Complete Signal Message Output

Before Phase 61:
```
Plan approved via Slack button.
```

After Phase 61:
```
Plan approved via Slack button.

<reply_context>{"channel":"slack","teamId":"T123","channelId":"C456","threadTs":"1234567890.000000"}</reply_context>
```

Or without replyContext (e.g., timeout signal):
```
Signal received: timeout. Data: {"reason":"72h expired"}
```
(No `<reply_context>` tag at all.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No reply context | ReplyContext type exists, column exists, not wired | Phase 60 (current) | Foundation laid |
| Signal messages plain text | Signal messages with `<reply_context>` XML tag | Phase 61 (this phase) | Agents can extract reply addresses |

## Open Questions

1. **Block_actions teamId availability**
   - What we know: The Slack interactions handler constructs NormalizedEvent for approval/rejection buttons. It includes `channel` (channelId) and `messageTs` but NOT `teamId` in the payload.
   - What's unclear: Should we modify the interactions handler to forward `user.team_id` from the raw Slack payload?
   - Recommendation: **Omit replyContext for block_actions events.** Approval signals don't need reply routing -- the agent replies to the original conversation channel, not the approval button's channel. This keeps the change within the adapter package boundary. If needed later, the interactions handler can be updated to include teamId.

2. **Escalation events have minimal payload**
   - What we know: `escalation_retry` and `escalation_abort` events only have `taskIdentifier` in their payload. No channel, no teamId, no threadTs.
   - What's unclear: Is there useful replyContext for escalation resolution?
   - Recommendation: **No replyContext for escalation events.** They're responses to Slack buttons in an ops channel, not the original user conversation. The agent should reply to the conversation's original channel context.

3. **GitHub PR events without correlationKey (pr_review)**
   - What we know: PR review events have `prNumber` and `repository` data but no `correlationKey` (branch name isn't available). They always go to slow_path.
   - What's unclear: The PR review events DO have repository owner/name/prNumber data for replyContext construction.
   - Recommendation: **Include replyContext for pr_review events.** Even though they go to slow_path for routing, the replyContext is still useful for reply routing once the signal reaches the conversation.

## Sources

### Primary (HIGH confidence)
- Codebase files read directly:
  - `packages/agents/src/adapters/*.ts` -- all three adapters and types
  - `packages/agents/src/framework/types.ts` -- SignalSchema, StartConversationParams
  - `packages/agents/src/framework/conversation-executor.ts` -- signal() and start() methods
  - `packages/agents/src/framework/worker-loop.ts` -- signal consumption paths (lines 670, 919)
  - `packages/agents/src/framework/event-router.ts` -- Signal construction in handle()
  - `packages/agents/src/router/router.ts` -- routeViaTask signal construction
  - `packages/agents/src/shared/communication/types.ts` -- ReplyContextSchema (Phase 60)
  - `packages/agents/src/shared/db/schema.ts` -- conversations table with reply_context column
  - `packages/integrations/*/src/dispatcher/normalize.ts` -- payload shapes per integration
  - `packages/integrations/slack/src/api/interactions.ts` -- block_actions NormalizedEvent construction

### Secondary (MEDIUM confidence)
- None

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all infrastructure exists
- Architecture: HIGH -- direct codebase analysis of every file that needs changes
- Pitfalls: HIGH -- traced all signal construction sites, verified payload shapes

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (stable domain, internal codebase)
