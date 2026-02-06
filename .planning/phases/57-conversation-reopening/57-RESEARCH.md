# Phase 57: Conversation Reopening - Research

**Researched:** 2026-02-06
**Domain:** Conversation lifecycle management, PostgreSQL state transitions, Next.js dashboard actions
**Confidence:** HIGH

## Summary

This phase adds a `reopen` signal that transitions completed/failed conversations back to `queued` status, enabling the agent to re-enter its work loop with awareness of what changed. The implementation touches four layers: database schema (new column + event type), conversation executor (reopen method + API endpoint), agent prompts (constitutional constraint), and the dashboard (reopen/retry button with reason dialog).

The codebase is well-structured for this change. The existing `signal()` method already handles status-based routing (waiting/running/terminal), and the reopen feature simply adds a new branch for terminal conversations when the signal type is `reopen`. The database migration is minimal (one column). The dashboard has all necessary UI primitives (Dialog, Button, Badge, API client pattern).

**Primary recommendation:** Implement as four sequential concerns: (1) schema migration + event type, (2) executor reopen method + API endpoint, (3) agent prompt constraints, (4) dashboard UI. Each is small and independently testable.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Signal payload is `reason: string`, required, non-empty -- free text, not structured delta
- Single API endpoint: `POST /conversations/:id/reopen` with `{ reason: string }` body
- Endpoint rejects non-terminal conversations with 400 (only completed and failed are reopenable)
- Race condition on simultaneous reopens handled by database -- first request transitions status, second finds non-terminal and gets 400
- World-state injected as a **user message** appended to conversation history (not system prompt modification)
- World-state format uses `<world_state>` tags with reason and verification instruction
- Add constitutional constraint to product-agent and dev-agent prompts **in this phase**
- Reopen/Retry button in the **top action bar** of conversation detail view
- Dashboard shows "Retry" label on failed, "Reopen" on completed -- same endpoint underneath
- Reopen count badge visible on conversation card and detail view
- No special history handling on reopen -- HistoryManager runs as normal
- Reset all execution limits on reopen: iteration count, token budget, and retry count all reset to definition YAML defaults
- Add `reopen_count` column to conversations table (integer, default 0, increment on each reopen)
- `reopen_count` is separate from `retries`
- Retry count resets on reopen
- Cap `delivered_signal_ids` at 100 entries with FIFO eviction on insert
- Single JSONB operation on insert, no background jobs
- `agent.reopened` event type emitted to event log (REOPEN-09)

### Claude's Discretion
- Interaction flow for the reopen button (inline text field vs modal dialog)
- Post-reopen navigation behavior (stay on detail view vs navigate to list)

### Deferred Ideas (OUT OF SCOPE)
- Reopen threshold warning ("This conversation has been reopened 3+ times, consider starting fresh")
- Cancelled conversation status and manual abort mechanism
- Automatic reopening from event routing
</user_constraints>

## Standard Stack

### Core (Already in Project)
| Library | Purpose | Location |
|---------|---------|----------|
| drizzle-orm | Schema definition + migrations | `packages/agents/src/shared/db/` |
| Express | HTTP API endpoint | `packages/agents/src/service/main.ts` |
| Zod | Request validation | `packages/agents/src/framework/types.ts` |
| Next.js 15 | Dashboard (RSC + client components) | `packages/dashboard/` |
| Radix Dialog | Modal dialogs | `packages/dashboard/src/components/ui/dialog.tsx` |
| Lucide React | Icons | Already used in event-icon, status-badge |
| TanStack Table | Data table columns | `packages/dashboard/src/components/conversations/columns.tsx` |

### No New Dependencies Required
This feature requires zero new packages. Everything needed is already in the project.

## Architecture Patterns

### Pattern 1: Database-Level Race Condition Handling

**What:** The reopen endpoint uses a database transaction with `FOR UPDATE` to atomically check-and-transition conversation status. First request wins; second finds non-terminal status and gets 400.

**Current pattern in codebase:** The `signal()` method in `conversation-executor.ts` (line 312) already uses this exact pattern:
```typescript
return await db.transaction(async (tx) => {
  const rows = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for("update");
  // ... status-based routing
});
```

**For reopen:** Follow identical pattern. Lock row, check status is terminal, transition to queued.

### Pattern 2: World-State Injection as User Message

**What:** Append a user message to the conversation's `messages` JSONB array containing the `<world_state>` block. This is the same mechanism used when signals resume waiting conversations (line 390-399 in conversation-executor.ts).

**Current pattern:**
```typescript
const signalMessage = { role: "user", content: signalContent };
const updatedMessages = [...(row.messages ?? []), signalMessage];
```

**For reopen:**
```typescript
const worldStateContent = `<world_state>\nThis conversation was reopened. Context: ${reason}\n\nThe world may have changed since you last acted. Verify the current state of any artifacts you previously created before taking new actions.\n</world_state>`;
const worldStateMessage = { role: "user", content: worldStateContent };
const updatedMessages = [...(row.messages ?? []), worldStateMessage];
```

### Pattern 3: Event Type Addition

**What:** Add `agent.reopened` to the `agentEventTypeValues` enum in BOTH `schema.ts` and `schema.drizzle.ts`, then add a migration to extend the PostgreSQL check constraint (or use ALTER TYPE if it's an enum).

**Current event types:** `tool.called`, `tool.succeeded`, `tool.failed`, `llm.response`, `agent.started`, `agent.completed`, `agent.paused`, `agent.resumed`, `signal.received` (9 types).

**Key finding:** The `type` column uses `text` with an enum constraint defined at the Drizzle level, not a PostgreSQL `CREATE TYPE`. Looking at the schema definition:
```typescript
type: text("type", { enum: agentEventTypeValues }).notNull(),
```
This is a Drizzle-level constraint. The database column is `text`. The migration needs to update the check constraint on the `agent_events.type` column to include `agent.reopened`.

**Both schema files must be updated:**
- `packages/agents/src/shared/db/schema.ts` (runtime)
- `packages/agents/src/shared/db/schema.drizzle.ts` (migration generation)
- `packages/dashboard/src/lib/schema.ts` (dashboard read-only mirror)

### Pattern 4: Execution Limit Reset

**What:** On reopen, reset `retry_count` to 0 (and `error_message` to null). The `maxIterations` and `tokenBudget` are not stored on the conversation row -- they come from the agent definition YAML loaded at execution time. So "resetting execution limits" means:
1. Set `retry_count = 0` in the DB update (explicit)
2. Set `error_message = null` (clear previous error)
3. `maxIterations` and `tokenBudget` are already fresh from definition -- no DB change needed

**Evidence:** In `worker-loop.ts` line 693-709:
```typescript
const loopOptions = {
  maxIterations: definition.maxIterations,
  // tokenBudget: created from definition at line 454
};
```
These are loaded fresh from the agent definition each time a conversation is claimed.

### Pattern 5: Dashboard API Client Pattern

**What:** The dashboard calls agent-service via HTTP from server-side functions. The `lib/agent-service.ts` file defines typed functions that `fetch()` from `AGENT_SERVICE_URL`.

**For reopen:** The dashboard needs a NEW client function that POSTs to the agent-service's `/conversations/:id/reopen` endpoint. However, this is a client-side action (button click), not a server component query. Two options:

1. **Next.js API route (proxy):** Create `/api/conversations/[id]/reopen/route.ts` that proxies to agent-service
2. **Direct client fetch:** Call agent-service directly from the client component

**Recommendation: Use a Next.js API route proxy.** This maintains the pattern where the dashboard never exposes the agent-service URL to the client, and keeps auth/validation server-side. The existing `/api/sse/events/route.ts` and `/api/events/[id]/content/route.ts` confirm this proxy pattern is established.

### Pattern 6: FIFO Eviction for delivered_signal_ids

**What:** Cap at 100 entries by dropping the oldest when adding entry 101.

**SQL pattern (single atomic JSONB operation):**
```sql
UPDATE agents.conversations
SET delivered_signal_ids = (
  CASE
    WHEN jsonb_array_length(delivered_signal_ids) >= 100
    THEN (delivered_signal_ids - 0) || to_jsonb($newId::text)
    ELSE delivered_signal_ids || to_jsonb($newId::text)
  END
)
```

**Drizzle ORM equivalent:**
```typescript
delivered_signal_ids: sql`
  CASE
    WHEN jsonb_array_length(${conversations.delivered_signal_ids}) >= 100
    THEN (${conversations.delivered_signal_ids} #- '{0}') || to_jsonb(${dedupKey}::text)
    ELSE ${conversations.delivered_signal_ids} || to_jsonb(${dedupKey}::text)
  END
`
```

**Alternative (simpler, used in existing code):** The current signal() method builds the array in TypeScript (line 342-347) and writes the whole array back. For FIFO eviction:
```typescript
const deliveredIds = [...(row.delivered_signal_ids ?? [])];
if (signal.deduplicationId && signal.source) {
  const dedupKey = `${signal.source}:${signal.deduplicationId}`;
  deliveredIds.push(dedupKey);
  // FIFO eviction: drop oldest when exceeding 100
  while (deliveredIds.length > 100) {
    deliveredIds.shift();
  }
}
```

**Recommendation:** Use the TypeScript approach for consistency with existing code. The `FOR UPDATE` lock guarantees no concurrent modification, so rebuilding the array in-memory is safe.

### Recommended File Changes Map

```
packages/agents/
  src/shared/db/
    schema.ts                    # Add reopen_count column, agent.reopened event type
    schema.drizzle.ts            # Mirror schema.ts changes
    migrations/0004_add_reopen_support.sql  # Migration: add column + update constraint
  src/framework/
    conversation-executor.ts     # Add reopen() method
    types.ts                     # Add reopen to ConversationExecutor interface + SignalSchema
    session-projection.ts        # Handle agent.reopened event (set status: running)
  src/service/
    main.ts                      # Add POST /conversations/:id/reopen route
  definitions/
    dev-agent/prompt.md          # Add constitutional constraint
    product-agent/prompt.md      # Add constitutional constraint

packages/dashboard/
  src/lib/
    schema.ts                    # Add reopen_count column, agent.reopened event type
  src/services/
    conversations.ts             # Add reopen_count to ConversationDetail + list item
  src/app/api/
    conversations/[id]/reopen/route.ts  # NEW: proxy endpoint
  src/components/
    conversation-detail/
      reopen-dialog.tsx          # NEW: modal with reason text field
      live-detail-panels.tsx     # Add reopen button to action bar
      metadata-sidebar.tsx       # Show reopen_count
      event-icon.tsx             # Add agent.reopened icon
    conversations/
      columns.tsx                # Add reopen count badge column
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal dialog | Custom overlay | Radix Dialog (already in project) | Accessibility, focus trap, ESC handling |
| Race condition prevention | Application-level locks | PostgreSQL `FOR UPDATE` transactions | Database is the source of truth; `FOR UPDATE` is guaranteed ACID |
| Request validation | Manual field checks | Zod schema parsing | Already used everywhere in the project for validation |
| JSONB array manipulation | Custom SQL functions | TypeScript array ops + whole-array write | Existing pattern in codebase, protected by `FOR UPDATE` lock |

## Common Pitfalls

### Pitfall 1: Forgetting to Update Both Schema Files
**What goes wrong:** Adding `agent.reopened` to `schema.ts` but forgetting `schema.drizzle.ts` causes migration generation issues. Similarly, forgetting the dashboard's `lib/schema.ts` causes runtime type errors.
**How to avoid:** All three schema files must be updated in the same plan.

### Pitfall 2: Check Constraint on agent_events.type
**What goes wrong:** Drizzle's `text("type", { enum: [...] })` generates a CHECK constraint in PostgreSQL. Adding a new value requires altering the constraint. If the migration doesn't update this, inserts with `agent.reopened` will fail at the DB level.
**How to avoid:** The migration must `ALTER TABLE agents.agent_events DROP CONSTRAINT` and recreate with the new value. Check the existing migration (0000) for how the constraint was originally created.

### Pitfall 3: SessionProjection Not Handling agent.reopened
**What goes wrong:** SessionProjection subscribes to specific event types. If `agent.reopened` is not handled, the session status won't update when a conversation is reopened.
**How to avoid:** Add `agent.reopened` to the subscription filter and add a handler that sets session status to `running` (same as `agent.resumed`).

### Pitfall 4: EventIcon and formatEventType Missing New Type
**What goes wrong:** The dashboard's EventIcon component uses a hardcoded `iconMap` and `colorMap`. The `formatEventType` function in format.ts handles it generically (splits on dots, capitalizes), so that works. But the icon will fall back to a generic `Circle`.
**How to avoid:** Add `agent.reopened` to the EventIcon maps with an appropriate icon (e.g., `RefreshCw` or `RotateCcw` from lucide-react).

### Pitfall 5: SSE Event Type Filter
**What goes wrong:** The SSE bridge may filter events by known types. If `agent.reopened` is not in the filter, it won't stream to the dashboard.
**How to avoid:** Check the SSE events router subscription filter. Looking at the code, it subscribes to ALL event types (no filter), so this is not actually a problem. But verify.

### Pitfall 6: Reopen of a Conversation That Was Never Claimed
**What goes wrong:** A conversation could be in `failed` status without having any messages (e.g., failed during definition loading). Reopening it would create a world-state message as the only message, which could confuse the agent.
**How to avoid:** The endpoint should still work -- the agent will start a "new" run seeing only the world-state message. This is acceptable since the world-state format asks the agent to verify artifact state (there are none, so it proceeds fresh). No special handling needed.

### Pitfall 7: SSE Connection Behavior on Reopen
**What goes wrong:** The LiveDetailPanels component only activates SSE when `status === "running" || status === "waiting"`. After reopen, the status transitions to `queued` (in DB) then `running` (when claimed by worker). The page needs to detect the status change.
**How to avoid:** After the reopen API call succeeds, the component should trigger a `router.refresh()` to re-fetch server data. The page will then show `queued` status and start SSE once it transitions to `running`. Alternatively, optimistically set status to `queued` client-side.

## Code Examples

### Reopen Method (ConversationExecutor)

```typescript
async reopen(conversationId: string, reason: string): Promise<{
  action: "reopened" | "rejected";
  error?: string;
}> {
  if (!reason || reason.trim().length === 0) {
    return { action: "rejected", error: "Reason is required" };
  }

  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");

    if (rows.length === 0) {
      return { action: "rejected", error: "Conversation not found" };
    }

    const row = rows[0];

    // Only completed and failed are reopenable
    if (row.status !== "completed" && row.status !== "failed") {
      return {
        action: "rejected",
        error: `Cannot reopen conversation in ${row.status} status`,
      };
    }

    // Build world-state user message
    const worldStateContent = [
      "<world_state>",
      `This conversation was reopened. Context: ${reason.trim()}`,
      "",
      "The world may have changed since you last acted. Verify the current state of any artifacts you previously created before taking new actions.",
      "</world_state>",
    ].join("\n");

    const updatedMessages = [
      ...((row.messages ?? []) as unknown[]),
      { role: "user", content: worldStateContent },
    ];

    // FIFO eviction for delivered_signal_ids
    const deliveredIds = [...((row.delivered_signal_ids ?? []) as string[])];
    const dedupKey = `reopen:${Date.now()}`;
    deliveredIds.push(dedupKey);
    while (deliveredIds.length > 100) {
      deliveredIds.shift();
    }

    await tx
      .update(conversations)
      .set({
        status: "queued",
        messages: updatedMessages,
        retry_count: 0,
        error_message: null,
        reopen_count: sql`${conversations.reopen_count} + 1`,
        pending_wait: null,
        claimed_by: null,
        claimed_at: null,
        last_heartbeat_at: null,
        delivered_signal_ids: deliveredIds,
        updated_at: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    // Emit agent.reopened event
    await eventLog.initSequence(conversationId);
    eventLog.append({
      conversationId,
      agentDefinitionId: row.agent_definition_id,
      agentDefinitionVersion: row.agent_definition_version,
      agentInstanceId: `reopen-${conversationId}`,
      type: "agent.reopened",
      payload: {
        reason: reason.trim(),
        previousStatus: row.status,
        reopenCount: (row.reopen_count ?? 0) + 1,
      },
    });
    await eventLog.flush();

    return { action: "reopened" };
  });
}
```

### API Endpoint (main.ts)

```typescript
// POST /conversations/:id/reopen -- reopen a terminal conversation
app.post("/conversations/:id/reopen", async (req, res) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      res.status(400).json({ error: "reason is required and must be non-empty" });
      return;
    }

    const result = await executor.reopen(req.params.id, reason);
    if (result.action === "rejected") {
      res.status(result.error?.includes("not found") ? 404 : 400).json({
        error: result.error,
      });
      return;
    }

    res.json({ reopened: true });
  } catch (error) {
    logger.error(
      { err: error, conversationId: req.params.id },
      "POST /conversations/:id/reopen failed",
    );
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### Migration SQL (0004_add_reopen_support.sql)

```sql
-- Add reopen_count column to conversations table
ALTER TABLE agents.conversations
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;

-- Update the check constraint on agent_events.type to include agent.reopened
-- Note: Drizzle text enums generate CHECK constraints, not PostgreSQL TYPE enums.
-- We need to drop and recreate the constraint.
-- The constraint name follows Drizzle's naming convention.
ALTER TABLE agents.agent_events
  DROP CONSTRAINT IF EXISTS agent_events_type_check;

-- Recreate with agent.reopened included
ALTER TABLE agents.agent_events
  ADD CONSTRAINT agent_events_type_check
  CHECK (type IN (
    'tool.called', 'tool.succeeded', 'tool.failed',
    'llm.response',
    'agent.started', 'agent.completed', 'agent.paused', 'agent.resumed', 'agent.reopened',
    'signal.received'
  ));
```

### Dashboard Reopen Dialog Component

```tsx
// Recommendation: modal dialog (Claude's discretion)
// Reasoning: A modal dialog is better than inline text because:
// 1. It creates a deliberate, interruptive action (reopening has consequences)
// 2. Prevents accidental clicks with a confirmation step
// 3. Provides space for a meaningful reason text area
// 4. Matches GitHub's "Reopen issue" pattern with a confirmation dialog

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ReopenDialogProps {
  conversationId: string;
  status: string; // "completed" or "failed"
  onReopened: () => void;
}

export function ReopenDialog({ conversationId, status, onReopened }: ReopenDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = status === "failed" ? "Retry" : "Reopen";
  const placeholder = status === "failed"
    ? "What was fixed that should allow this to succeed now?"
    : "What changed since this conversation completed?";

  async function handleSubmit() {
    // POST to Next.js API route (proxy)
    // ...
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} Conversation</DialogTitle>
          <DialogDescription>
            The agent will resume with awareness of its previous run.
            Provide context about what changed.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
          className="... textarea styles ..."
        />
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!reason.trim() || submitting}>
            {submitting ? "Submitting..." : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Post-Reopen Navigation (Claude's Discretion)

**Recommendation: Stay on detail view and trigger `router.refresh()`.** Reasoning:
1. The user just took action on THIS conversation -- they want to see it transition
2. Navigating away would lose the context they were just looking at
3. `router.refresh()` will re-fetch server data, showing the new `queued` status
4. SSE will auto-activate once the conversation moves to `running`

### Agent Prompt Constitutional Constraint

```markdown
<!-- Addition to <constraints> section of dev-agent/prompt.md and product-agent/prompt.md -->
- When resuming a previous conversation, verify the current state of any artifacts you previously created before acting on them.
```

This is a single bullet point added to the existing `<constraints>` section. It's small and mechanical -- not a prompt rewrite.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Terminal conversations create new conversation with `-r2` suffix | Reopened conversations re-enter the same conversation ID | Phase 57 | Preserves full history, no ID fragmentation |
| No way to retry failed conversations manually | Dashboard button + API endpoint | Phase 57 | Operators can retry without database access |

**Important distinction:** The existing re-trigger mechanism (lines 222-264 in conversation-executor.ts) creates a NEW conversation with a `-r2` suffix when `start()` is called for a terminal conversation. The reopen feature is fundamentally different -- it transitions the SAME conversation back to queued, preserving the full message history and conversation ID. These are complementary, not competing.

## Open Questions

1. **Check constraint name for agent_events.type**
   - What we know: Drizzle generates CHECK constraints from `text("type", { enum: [...] })` declarations
   - What's unclear: The exact constraint name Drizzle generated. It could be `agent_events_type_check` or something like `agents_agent_events_type_check` with schema prefix
   - Recommendation: Run `\d agents.agent_events` in psql to verify the constraint name before writing the migration, OR use a more defensive migration that drops any matching constraint

2. **SSE event type filter scope**
   - What we know: The SSE bridge subscribes to EventLog. The subscription filter in `sse-events.ts` needs to pass `agent.reopened` events through.
   - What's unclear: Whether the SSE subscription uses a type filter or accepts all types
   - Recommendation: Check `sse-events.ts` -- if it filters by type, add `agent.reopened`

## Sources

### Primary (HIGH confidence)
- `packages/agents/src/framework/conversation-executor.ts` -- signal() method pattern, FOR UPDATE locking
- `packages/agents/src/framework/worker-loop.ts` -- executeConversation() flow, limit loading from definition
- `packages/agents/src/shared/db/schema.ts` -- conversations table structure, event type enum
- `packages/agents/src/shared/db/schema.drizzle.ts` -- migration generation schema
- `packages/agents/src/framework/session-projection.ts` -- event type subscription and handling
- `packages/agents/src/framework/event-log.ts` -- append() and subscriber notification
- `packages/agents/src/service/main.ts` -- Express route pattern, endpoint placement
- `packages/dashboard/src/components/conversation-detail/live-detail-panels.tsx` -- action bar location
- `packages/dashboard/src/components/conversation-detail/metadata-sidebar.tsx` -- metadata display pattern
- `packages/dashboard/src/components/conversation-detail/event-icon.tsx` -- icon/color map
- `packages/dashboard/src/lib/schema.ts` -- dashboard schema mirror
- `packages/dashboard/src/services/conversations.ts` -- ConversationDetail type, query patterns
- `packages/dashboard/src/lib/agent-service.ts` -- HTTP client pattern
- `packages/dashboard/src/components/ui/dialog.tsx` -- Radix Dialog primitives

### Secondary (MEDIUM confidence)
- PostgreSQL CHECK constraint naming conventions for Drizzle-generated schemas

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all patterns exist in codebase
- Architecture: HIGH -- directly extends existing conversation executor and dashboard patterns
- Database migration: HIGH -- simple ALTER TABLE, verified column types and constraints
- Dashboard UX: HIGH -- all UI primitives already exist, established patterns for API proxy routes
- Pitfalls: HIGH -- identified from direct code reading, not speculation

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (stable -- internal codebase, no external dependency changes)
