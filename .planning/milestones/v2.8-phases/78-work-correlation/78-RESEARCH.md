# Phase 78: Work Correlation - Research

**Researched:** 2026-02-17
**Domain:** Event routing, entity correlation, agent tooling, knowledge query extensions
**Confidence:** HIGH

## Summary

Phase 78 introduces a formal work correlation system to the Aesir platform: a `work_correlations` table linking external entities (Linear issues, GitHub PRs, Slack threads) to active conversations, agent tools for registration and querying, router pipeline augmentation with correlation-based fallback routing, and a disposition vocabulary for routing decisions. The knowledge system also gains metadata and exact-match query modes.

The codebase is well-structured for this change. The routing pipeline (`router.ts` -> `event-router.ts` -> `slow-path.ts`) has clear insertion points for a correlation fallback step between signal matching and slow-path fallthrough. The `IncomingEvent` schema is Zod-validated and easily extended with optional entity reference fields. The tool registration system (`tool-factories.ts`) follows a consistent pattern for adding new namespaces. The knowledge service already supports semantic search with pgvector, and adding metadata-based queries is a natural extension.

The primary technical challenge is the pipeline insertion for correlation lookup: the `EventRouter.handle()` method is currently synchronous (no I/O), but correlation lookup requires a database query. This means correlation must happen in the async `routeEvent()` function in `router.ts`, between the `eventRouter.handle()` call (step 2) and the dispatch switch (step 3), when the result is `slow_path`. Alternatively, the correlation step can be inserted as a new pre-enrichment step before the slow-path LLM call.

**Primary recommendation:** Implement as 7-8 focused plans: schema/migration, entity reference on adapters, auto-registration in executor, work tools (register+query), correlation fallback in router, knowledge query extension, event.routed emission, and dashboard rendering.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Registration behavior
- **Dual-layer registration:** Executor auto-registers the trigger entity at `start()` (infrastructure fact, same pattern as `reply_context`). Agents explicitly register additional entities via `work:register` (agent judgment for secondary entities discovered during execution).
- **No auto-registration for sub-agents:** Delegated conversations have no trigger entity. Sub-agents use `work:register` only if they create/own external entities (e.g., dev-agent opening a PR). Most sub-agents (coder, researcher, tester) won't need correlation.
- **Trust agent input:** `work:register` validates shape only (Zod: entity_type enum, entity_id non-empty string). No MCP round-trips to verify entity existence. Agents get IDs from tool results — redundant validation adds failure modes and integration coupling.
- **Correlation lifecycle:** Correlations persist with terminal status (completed, failed, superseded). Never deleted — disposition vocabulary requires terminal correlations for `retry` and `supersede` decisions. Table growth is trivially small (1-3 correlations per conversation). TTL-based cleanup of old terminal correlations deferred to post-v2.8 if needed.

#### Routing precedence
- **Trigger first, correlation fallback:** Existing trigger matching runs first (unchanged). Signal routing (wait_for matching) second. Correlation lookup only fires when neither matches. Correlation augments the pipeline, never overrides it.
- **Pipeline ordering:** Event -> Phase 2 filters -> trigger rules -> signal routing -> correlation lookup -> slow-path LLM (with enriched context) -> ignore.
- **`start()` idempotency prevents trigger duplicates:** Same correlationKey = same conversation ID. Two trigger events for the same entity don't create duplicate conversations — existing infrastructure handles this.
- **Pre-enrich, don't tool:** Correlation data is automatically injected into slow-path LLM context. No new router tool. The lookup is deterministic (always do it for slow-path events), and the LLM's job is to decide, not discover.
- **New signal type needed:** Correlation-routed events use `entity_update` signal type (carries original event payload). Agent receives it and decides relevance from payload content.

#### Multi-correlation handling
- **Broadcast all active/waiting:** When multiple conversations correlate with the same entity, signal all of them. Each agent decides relevance. Cost is low (MAX_DELEGATION_DEPTH = 5, most waiting), missed delivery risk is high.
- **Primary entity only from adapters:** Each event produces one entity reference from structured payload fields (Linear: `issueId`, GitHub: `pull_request.number`, Slack: `channelId:threadTs`). No cross-reference parsing from free text. Cross-entity bridges are created by agents via `work:register`.
- **Entity reference is optional on IncomingEvent:** Some events don't map to an entity (agent_session.created, workspace-level events, top-level Slack messages). Adapters set it when structurally clear, omit when not. No entity -> skip correlation lookup -> fall through to existing routing.

#### Disposition boundaries
- **Router-only vocabulary for v2.8:** The 5 dispositions (new, signal, retry, supersede, duplicate) are internal to the routing pipeline. Agents use `work:query` to get correlation data and reason in natural language — no enum classification.
- **Deterministic vs judgment split:**
  - `duplicate` — Phase 2 filters (deterministic infrastructure)
  - `signal` — Correlation fallback, active/waiting status (deterministic infrastructure)
  - `new` — Correlation fallback, no correlation found (deterministic infrastructure)
  - `retry` — Slow-path LLM with enriched context (judgment)
  - `supersede` — Slow-path LLM with enriched context (judgment)
- **Supersede mechanics:** Start new conversation + update old correlation status to `superseded`. No active cancellation of old conversations — they reach terminal state naturally (token budget, max iterations, timeout). Graceful cancellation deferred to v2.9 agent lifecycle features.
- **Emit `event.routed` events:** Router emits disposition events with entity, disposition, routing method (trigger_match, signal_match, correlation_fallback, slow_path), target conversation, and LLM reasoning (for slow-path). Skip emitting for duplicate/ignore. Dashboard renders these for routing provenance debugging.

#### Knowledge query extension
- **Extend existing `knowledge:query`:** Add `mode` parameter (semantic/exact/combined, default semantic) and optional `metadata` filter. No new tool — one tool, one purpose, backward compatible.
- **Mode behavior:** `semantic` = current embedding search (unchanged). `exact` = metadata WHERE clause only. `combined` = filter by metadata, then rank by semantic similarity within matches.
- **Metadata JSONB column** added to knowledge entries for structured data (issue IDs, PR numbers, branch names).

### Claude's Discretion
- Correlation table schema details (indexes, constraints beyond the spec's outline)
- `entity_update` signal payload structure
- `event.routed` storage (routing_decisions table vs system event log)
- knowledge:query combined mode implementation details (SQL strategy)
- Agent prompt guidance wording for work:register and work:query usage

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORR-01 | Entity reference `{entity_type, entity_id}` standardized on IncomingEvent | IncomingEvent schema (Zod) in `adapters/types.ts` is easily extended with optional fields. All 3 adapters (Linear, GitHub, Slack) already parse structured payloads with entity identifiers. See Architecture Patterns section. |
| CORR-02 | `work_correlations` table with composite key `(entity_type, entity_id, conversation_id)` | Existing `agents.*` schema uses `pgSchema("agents")` with Drizzle ORM. Migration pattern established (14 migrations exist, sequential numbering). See Code Examples section. |
| CORR-03 | `work:register` tool allows agents to register work on an external entity | Tool registration pattern in `tool-factories.ts` supports new namespaces. Pattern: create factory, register with `registry.register("work:register", factory)`. See Architecture Patterns section. |
| CORR-04 | `work:query` tool allows agents and router to check existing work | Same pattern as `work:register`. Service layer (`WorkCorrelationService`) provides the DB queries, tool wraps it. See Architecture Patterns section. |
| CORR-05 | Conversation status changes propagate to correlation registry automatically | Worker loop (`worker-loop.ts`) updates conversation status at 5 lifecycle boundaries (completed, failed, waiting, queued, cancelled). Status propagation hooks at these points. See Architecture Patterns section. |
| CORR-06 | Router uses correlation lookup as fallback for events with no trigger match | `routeEvent()` in `router.ts` dispatches on `routeDecision.action`. Correlation fallback inserts between EventRouter's `slow_path` result and the actual slow-path LLM call. See Architecture Patterns section. |
| CORR-07 | Disposition vocabulary (new, signal, retry, supersede, duplicate) formalized | Router pipeline already has implicit dispositions (start=new, signal=signal, deduplicated=duplicate, ignored=ignore). Formalizing adds `retry` and `supersede` for slow-path enrichment. See Architecture Patterns section. |
| CORR-08 | Knowledge query supports metadata-based exact match mode | Knowledge service in `knowledge-service.ts` uses Drizzle ORM with pgvector. Adding metadata JSONB column + WHERE clause is straightforward. See Code Examples section. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | (existing) | Database schema, queries, migrations | Already used throughout for all `agents.*` tables |
| Zod | (existing) | Input validation at boundaries | Already used for IncomingEvent, Signal, tool inputs |
| PostgreSQL | 15 (pgvector) | Correlation registry, knowledge metadata | Existing database, no new infrastructure |
| Express | (existing) | HTTP endpoints for events | Existing service entrypoint |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-kit | (existing) | Migration generation | For the `work_correlations` table and knowledge metadata column |
| nanoid | (existing) | ID generation | For routing decision event IDs |

### Alternatives Considered
No alternatives — this phase extends existing infrastructure with no new dependencies.

**Installation:**
No new packages needed. All dependencies are already in the monorepo.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
├── adapters/
│   ├── types.ts              # Add entityRef to IncomingEventSchema
│   ├── linear.ts             # Add entity reference extraction
│   ├── github.ts             # Add entity reference extraction
│   └── slack.ts              # Add entity reference extraction
├── framework/
│   ├── conversation-executor.ts  # Add auto-registration at start()
│   └── types.ts              # Add entity_update signal type
├── router/
│   ├── router.ts             # Add correlation fallback step
│   ├── system-prompt.ts      # Enrich with correlation context
│   └── types.ts              # Add disposition types
├── shared/
│   ├── db/
│   │   ├── schema.ts         # Add work_correlations table, knowledge metadata
│   │   ├── schema.drizzle.ts # Mirror changes
│   │   └── migrations/
│   │       ├── 0014_add_work_correlations.sql
│   │       └── 0015_add_knowledge_metadata.sql
│   ├── services/
│   │   └── correlation-service.ts  # New: register, query, update status
│   └── tools/
│       └── work/
│           ├── index.ts       # New: barrel export
│           ├── register.ts    # New: work:register tool factory
│           └── query.ts       # New: work:query tool factory
└── service/
    └── main.ts               # Wire CorrelationService into deps
```

### Pattern 1: Entity Reference on IncomingEvent
**What:** Add optional `entityRef` field to the IncomingEvent Zod schema.
**When to use:** Every adapter that can extract a primary entity from structured payload fields.
**Key insight:** The field is OPTIONAL. Not all events have entity references. Adapters only set it when structurally unambiguous.

```typescript
// In adapters/types.ts - extend IncomingEventSchema
export const IncomingEventSchema = z.object({
  // ... existing fields ...
  entityRef: z.object({
    entityType: z.enum(['linear_issue', 'github_pr', 'slack_thread']),
    entityId: z.string().min(1),
  }).optional(),
});
```

**Adapter extraction examples:**
- Linear `comment.created`: `{ entityType: 'linear_issue', entityId: payload.issueId }`
- Linear `agent_session.created`: `{ entityType: 'linear_issue', entityId: payload.issueId }`
- GitHub `pull_request.merged`: `{ entityType: 'github_pr', entityId: '${owner}/${repo}#${prNumber}' }`
- Slack `message.created` (with threadTs): `{ entityType: 'slack_thread', entityId: '${channelId}:${threadTs}' }`
- Slack `app_mention.created`: `{ entityType: 'slack_thread', entityId: '${channelId}:${threadTs}' }` (threadTs is the thread root, same as correlationKey)

### Pattern 2: Auto-Registration in executor.start()
**What:** When a conversation is created from a trigger event, auto-register the entity correlation.
**When to use:** Only for webhook-triggered conversations (not sub-agents, not delegations).
**Key insight:** `start()` already receives `correlationKey` — but correlationKey is agent-scoped (e.g., issueId), not a full entity reference. The entity reference must be passed through from the router.

```typescript
// In StartConversationParams - add optional entityRef
export interface StartConversationParams {
  // ... existing ...
  entityRef?: { entityType: string; entityId: string };
}

// In start() implementation, after INSERT:
if (params.entityRef) {
  await correlationService.register({
    entityType: params.entityRef.entityType,
    entityId: params.entityRef.entityId,
    conversationId: newId,
    agentId: params.agentDefinitionId,
  });
}
```

### Pattern 3: Correlation Fallback in Router
**What:** After EventRouter returns `slow_path`, check correlation before sending to LLM.
**When to use:** Only when the event has an `entityRef` and the EventRouter returned `slow_path`.
**Key insight:** The EventRouter.handle() is synchronous. Correlation lookup is async. The correlation step must live in `routeEvent()` (which is already async), not inside EventRouter.handle().

```typescript
// In routeEvent(), between step 2 (EventRouter) and step 3 (dispatch):
case "slow_path": {
  // Correlation fallback: check if entity has active work
  if (routeDecision.event.entityRef && deps.correlationService) {
    const correlations = await deps.correlationService.queryActive(
      routeDecision.event.entityRef.entityType,
      routeDecision.event.entityRef.entityId,
    );

    if (correlations.length > 0) {
      // Signal all active/waiting conversations
      for (const corr of correlations) {
        const signal: Signal = {
          type: 'entity_update',
          data: routeDecision.event.data,
          message: routeDecision.event.message,
          source: routeDecision.event.source,
          deduplicationId: routeDecision.event.deduplicationId,
          ...(routeDecision.event.replyContext && { replyContext: routeDecision.event.replyContext }),
        };
        await deps.executor.signal(corr.conversationId, signal);
      }
      // Emit event.routed
      return { received: true, action: 'signaled', conversationId: correlations[0].conversationId };
    }

    // No active correlations — check for terminal correlations
    const terminalCorrelations = await deps.correlationService.queryTerminal(
      routeDecision.event.entityRef.entityType,
      routeDecision.event.entityRef.entityId,
    );

    if (terminalCorrelations.length > 0) {
      // Enrich slow-path context and let LLM decide (retry vs supersede vs new)
      // Fall through to slow_path with enrichment
    }
  }

  // Fall through to existing slow-path LLM
  void routeViaAgentLoopV2(event, slowPathDeps).catch(...)
}
```

### Pattern 4: Status Propagation
**What:** When conversation status changes to completed/failed, update correlation status.
**When to use:** At all terminal status transitions in the worker loop.
**Key insight:** The worker loop already updates conversation rows at lifecycle boundaries. The correlation update can piggyback on these same DB operations. Use a fire-and-forget pattern (same as eventLog.append) to avoid blocking the main path.

```typescript
// After setting status = 'completed' in worker-loop.ts:
if (correlationService) {
  void correlationService.updateStatus(conv.id, 'completed').catch(err => {
    childLogger.warn({ err }, 'Failed to update correlation status (non-fatal)');
  });
}
```

### Pattern 5: CorrelationService Factory
**What:** A service following the existing factory pattern (like KnowledgeService, TaskService).
**When to use:** Created at bootstrap in main.ts, injected into executor, router, and tool factories.

```typescript
export interface CorrelationService {
  register(params: { entityType: string; entityId: string; conversationId: string; agentId: string }): Promise<void>;
  queryActive(entityType: string, entityId: string): Promise<WorkCorrelation[]>;
  queryTerminal(entityType: string, entityId: string): Promise<WorkCorrelation[]>;
  queryAll(entityType: string, entityId: string): Promise<WorkCorrelation[]>;
  updateStatus(conversationId: string, status: string): Promise<void>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}
```

### Pattern 6: event.routed Storage
**What:** Routing decisions stored for dashboard visibility.
**When to use:** After every routing decision (except duplicate/ignore).
**Claude's Discretion recommendation:** Store as system events in the existing `agent_events` table with a new `event.routed` type. This reuses existing infrastructure (EventLog, dashboard queries, SSE streaming) and avoids creating a new table. The `event.routed` type can use a synthetic conversation_id (e.g., `router-{eventId}`) since routing decisions are pre-conversation.

Alternative considered: A dedicated `routing_decisions` table. This is cleaner for querying routing history specifically, but creates a new table, new service, new dashboard queries, and new SSE integration — all for data that the existing event system can handle. The agent_events table already supports 17 event types and the dashboard already queries it.

**Recommendation:** Use the `agent_events` table with `event.routed` type. Add the event type to `agentEventTypeValues`. Store entity, disposition, routing_method, target conversation, and LLM reasoning in the `payload` JSONB. The conversation_id can be the target conversation ID (for signal/start) or a synthetic `router-{evt_id}` for unmatched events. The agent_definition_id is `router` (the system component).

### Pattern 7: entity_update Signal Payload
**What:** The signal type used when correlation-routed events reach an agent.
**Claude's Discretion recommendation:** Keep the signal payload transparent — the agent receives the original event data with the entity_update type wrapper.

```typescript
const signal: Signal = {
  type: 'entity_update',
  data: {
    originalEventType: incomingEvent.type,  // e.g., 'issue_comment', 'pr_review'
    ...incomingEvent.data,                   // Original event payload
  },
  message: incomingEvent.message,
  source: incomingEvent.source,
  deduplicationId: incomingEvent.deduplicationId,
  ...(incomingEvent.replyContext && { replyContext: incomingEvent.replyContext }),
};
```

The agent's wait_for types must include `entity_update` if it wants to receive correlation-routed events. Since orchestrator agents (dev-agent, product-agent) are the primary recipients, add `entity_update` to the signal type handling in their wait_for patterns. The agent then inspects the payload to decide relevance.

### Anti-Patterns to Avoid
- **Coupling correlation to triggers:** Correlation is a fallback, not a replacement for trigger matching. Never skip trigger matching even if a correlation exists — triggers are deterministic and faster.
- **Making EventRouter.handle() async:** The synchronous nature of handle() is a design strength (pure routing logic, no I/O). Correlation is async I/O — keep it in the caller (`routeEvent()`).
- **Validating entity existence via MCP:** Per locked decision, trust agent input for `work:register`. Round-tripping to integrations adds latency, failure modes, and coupling.
- **Deleting terminal correlations:** Terminal correlations are needed for `retry` and `supersede` dispositions. The slow-path LLM needs to see "this entity had a failed conversation" to make good routing decisions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ID generation | Custom UUID/nanoid wrapper | `createId` from `@aesir/types` | Consistent ID prefixes across all tables |
| Database queries | Raw SQL strings | Drizzle ORM query builder | Type safety, schema validation, consistent patterns |
| Schema validation | Manual if/else checks | Zod schemas | Composable, automatic TypeScript types, consistent error messages |
| Embedding search | Custom vector math | Existing `cosineDistance` from drizzle-orm | Already used in knowledge service, correct math |
| Event emission | Custom pub/sub | Existing `EventLog.append()` | Buffered, sequence-tracked, subscriber-notified |

**Key insight:** Every piece of infrastructure this phase needs already exists in the codebase. The work is wiring — connecting new data to existing patterns.

## Common Pitfalls

### Pitfall 1: Synchronous EventRouter Contamination
**What goes wrong:** Trying to add the correlation lookup inside `EventRouter.handle()` would require making it async, breaking its synchronous contract and all callers.
**Why it happens:** Correlation lookup requires a database query, and the natural place seems to be inside the routing decision logic.
**How to avoid:** Keep correlation lookup in the async `routeEvent()` function. Insert it as a new step between the EventRouter's `slow_path` result and the actual slow-path LLM call.
**Warning signs:** Any PR that changes the `EventRouter` interface from sync to async.

### Pitfall 2: Race Between Auto-Registration and First Signal
**What goes wrong:** An event about an entity arrives and triggers correlation lookup before the auto-registration from `start()` has been committed.
**Why it happens:** `start()` runs in a transaction. If a second event arrives before the transaction commits, the correlation row doesn't exist yet.
**How to avoid:** This is handled by existing infrastructure — `start()` is idempotent (same correlationKey = same conversation). The second event gets routed by trigger match (fast path), not correlation. Correlation fallback only fires for events that DON'T match triggers, and those events inherently arrive later than the trigger event.
**Warning signs:** Test scenarios where trigger events and correlation-routed events arrive simultaneously.

### Pitfall 3: Schema Drift Between schema.ts and schema.drizzle.ts
**What goes wrong:** Adding `work_correlations` to `schema.ts` but forgetting `schema.drizzle.ts` causes drizzle-kit to not see the new table for migration generation.
**Why it happens:** The codebase maintains two parallel schema files — `schema.ts` (runtime, has external deps) and `schema.drizzle.ts` (migration generation, CJS-compatible).
**How to avoid:** Always update both files in the same plan. Include an explicit verification step.
**Warning signs:** `pnpm db:migrate` doesn't create the expected table.

### Pitfall 4: Signal Type Mismatch with wait_for
**What goes wrong:** Correlation-routed events use `entity_update` signal type, but the waiting conversation's `pending_wait.types` doesn't include `entity_update`, causing signal rejection.
**Why it happens:** `signal()` in conversation-executor.ts checks `signalMatchesPendingWait()` — if the signal type doesn't match the wait types, it's rejected.
**How to avoid:** Two approaches: (1) agents explicitly include `entity_update` in their wait_for types, or (2) skip type matching for entity_update signals (broadcast to all active/waiting regardless of wait type). Recommendation: use approach (2) for `entity_update` signals — the whole point of correlation routing is that the event couldn't be routed normally, so it shouldn't be subject to type filtering. Signal to running/queued conversations (where signals are queued, not type-matched) and only apply special handling for waiting conversations.
**Warning signs:** Correlation-routed events being silently rejected.

### Pitfall 5: knowledge:query Backward Compatibility
**What goes wrong:** Changing the knowledge query input schema breaks existing agents that don't pass the new `mode` parameter.
**Why it happens:** Adding required parameters to an existing Zod schema.
**How to avoid:** Make `mode` optional with default `semantic` (current behavior). Make `metadata` optional. Existing callers with no mode/metadata get exactly the same behavior as before.
**Warning signs:** Any required new field on `KnowledgeQueryInputSchema`.

### Pitfall 6: event.routed Event Type Not in Database CHECK Constraint
**What goes wrong:** Inserting an `event.routed` event into `agent_events` fails because the CHECK constraint (from migration 0013) doesn't include the new type.
**Why it happens:** Migration 0013 added a CHECK constraint enumerating all valid event types. New types must be added to this constraint.
**How to avoid:** Include a migration that updates the CHECK constraint to include `event.routed`. Follow the same pattern as 0013 (drop old constraint, create new one with full list).
**Warning signs:** `agent_events INSERT` failures in logs after deploying the new event type.

### Pitfall 7: Dashboard Schema Not Updated
**What goes wrong:** Dashboard queries for `event.routed` events fail because the dashboard's local `schema.ts` doesn't include the new event type or new tables.
**Why it happens:** Dashboard maintains its own schema copy (`packages/dashboard/src/lib/schema.ts`) separate from the canonical `@aesir/agents` schema.
**How to avoid:** Update the dashboard schema in a dedicated plan step. Add `event.routed` to `agentEventTypeValues` and add `work_correlations` table definition if the dashboard needs to query it.
**Warning signs:** TypeScript errors in dashboard service files referencing new event types.

## Code Examples

### Work Correlations Table Schema (Drizzle)
```typescript
// In schema.ts
export const correlationStatusValues = [
  'active', 'waiting', 'completed', 'failed', 'superseded',
] as const;
export type CorrelationStatus = (typeof correlationStatusValues)[number];

export const workCorrelations = agentsSchema.table(
  'work_correlations',
  {
    entity_type: text('entity_type').notNull(),
    entity_id: text('entity_id').notNull(),
    conversation_id: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    agent_id: text('agent_id').notNull(),
    status: text('status', { enum: correlationStatusValues })
      .notNull()
      .default('active'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Composite primary key as unique constraint
    // (Drizzle doesn't support composite PKs directly, use unique + index)
    index('idx_correlations_entity').on(table.entity_type, table.entity_id),
    index('idx_correlations_conversation').on(table.conversation_id),
    index('idx_correlations_status').on(table.entity_type, table.entity_id, table.status),
  ],
);
```

### Migration SQL (0014)
```sql
-- Phase 78: Work Correlation
-- Registry linking external entities to active conversations.
-- Composite primary key prevents duplicate registrations.
-- Status mirrors conversation lifecycle for disposition decisions.

CREATE TABLE agents.work_correlations (
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES agents.conversations(id),
  agent_id      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'waiting', 'completed', 'failed', 'superseded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, conversation_id)
);

CREATE INDEX idx_correlations_entity ON agents.work_correlations (entity_type, entity_id);
CREATE INDEX idx_correlations_conversation ON agents.work_correlations (conversation_id);
CREATE INDEX idx_correlations_status ON agents.work_correlations (entity_type, entity_id, status);
```

### Knowledge Metadata Migration (0015)
```sql
-- Phase 78: Knowledge metadata for exact-match queries
-- Adds JSONB metadata column for structured data (issue IDs, PR numbers, etc.)
-- Existing entries get empty metadata ({}).

ALTER TABLE agents.knowledge_entries
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';

-- GIN index for efficient JSONB containment queries (@>)
CREATE INDEX idx_knowledge_metadata ON agents.knowledge_entries USING GIN (metadata);
```

### event.routed CHECK Constraint Update (0016)
```sql
-- Phase 78: Add event.routed event type to the CHECK constraint.
-- Same pattern as migration 0013.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'agents.agent_events'::regclass
    AND contype = 'c'
    AND conname LIKE '%type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agents.agent_events DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE agents.agent_events
  ADD CONSTRAINT agent_events_type_check
  CHECK (type IN (
    'tool.called', 'tool.succeeded', 'tool.failed',
    'llm.response',
    'agent.started', 'agent.completed', 'agent.paused', 'agent.resumed', 'agent.reopened',
    'signal.received', 'signal.orphaned',
    'mcp.error', 'mcp.rate_limited', 'mcp.retries_exhausted',
    'notification.failed',
    'agent.stale_recovered', 'agent.retry_scheduled',
    'event.routed'
  ));
```

### Tool Registration Pattern (work namespace)
```typescript
// In tool-factories.ts, add to registerAllTools():

// ── Work correlation tools (2) ─────────────────────────────────
const cs = options.correlationService;
registry.register('work:register', (ctx) => createWorkRegisterTool(cs, ctx));
registry.register('work:query', (ctx) => createWorkQueryTool(cs, ctx));
```

### Knowledge Query with Metadata Mode
```typescript
// Extended query in KnowledgeService:
async query(params) {
  const validated = QueryKnowledgeParamsSchema.parse(params);
  const mode = validated.mode ?? 'semantic';

  if (mode === 'exact') {
    // Metadata-only: WHERE clause on metadata JSONB
    const conditions = [...baseConditions];
    if (validated.metadata) {
      conditions.push(sql`${knowledgeEntries.metadata} @> ${JSON.stringify(validated.metadata)}`);
    }
    // Order by created_at (no embedding needed)
    return db.select(...).from(knowledgeEntries).where(and(...conditions)).orderBy(desc(knowledgeEntries.created_at)).limit(limit);
  }

  if (mode === 'combined') {
    // Filter by metadata FIRST, then rank by semantic similarity within matches
    const conditions = [...baseConditions];
    if (validated.metadata) {
      conditions.push(sql`${knowledgeEntries.metadata} @> ${JSON.stringify(validated.metadata)}`);
    }
    const queryEmbedding = await generateEmbedding(validated.query);
    if (queryEmbedding) {
      const similarity = sql`1 - (${cosineDistance(knowledgeEntries.embedding, queryEmbedding)})`;
      return db.select(...).from(knowledgeEntries).where(and(...conditions, gt(similarity, SIMILARITY_THRESHOLD))).orderBy(desc(similarity)).limit(limit);
    }
    // Embedding failed: fall back to metadata-only
    return db.select(...).from(knowledgeEntries).where(and(...conditions)).orderBy(desc(knowledgeEntries.created_at)).limit(limit);
  }

  // mode === 'semantic': current behavior (unchanged)
  // ... existing implementation ...
}
```

### Slow-Path Context Enrichment
```typescript
// In formatEventForLLM() or as a wrapper in router.ts:
function enrichWithCorrelations(basePrompt: string, correlations: WorkCorrelation[]): string {
  if (correlations.length === 0) return basePrompt;

  const lines = ['\nExisting work for this entity:'];
  for (const corr of correlations) {
    lines.push(`  - Conversation ${corr.conversationId} (${corr.agentId}), status: ${corr.status}, started ${relativeTime(corr.createdAt)}`);
  }
  return basePrompt + lines.join('\n');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No entity tracking | IncomingEvent has correlationKey (string) | v2.3 | Events are keyed but not tracked across conversations |
| No duplicate detection | Phase 2 webhook filter (dedup + echo) | v2.8 Phase 75 | Technical duplicates suppressed |
| No work awareness | Trigger matching + signal routing | v2.3 | Events route to known conversation patterns but miss unknown patterns |
| No routing visibility | Logged at info/debug level | v2.3 | Routing decisions invisible in dashboard |

**What this phase adds:**
- Entity reference: typed `{entityType, entityId}` replacing untyped correlationKey for entity tracking
- Work awareness: correlation registry answers "is anyone working on this?"
- Disposition vocabulary: formal language for routing decisions
- Routing visibility: `event.routed` events make every routing decision dashboardvisible

## Open Questions

1. **entity_update signal and pending_wait type matching**
   - What we know: `signal()` checks `signalMatchesPendingWait()` which compares signal type against `pending_wait.types`. Entity_update signals won't match existing wait types like `approval`, `pr_review`, etc.
   - What's unclear: Should entity_update bypass type matching entirely, or should agents explicitly add `entity_update` to their wait_for types?
   - Recommendation: For waiting conversations, entity_update should bypass type matching — the correlation router has already determined this conversation cares about this entity. For running/queued conversations, signals are simply queued (no type matching needed). This avoids requiring prompt changes to every agent. Implement as a special case in `signal()` or in the correlation routing code itself (call executor.signal with the original signal type, not entity_update, to match what the agent is waiting for).

2. **Correlation status tracking granularity**
   - What we know: Conversations have 6 statuses (queued, running, waiting, completed, failed, cancelled). Correlations need to track status changes.
   - What's unclear: Whether to mirror all 6 statuses or collapse to fewer (active=queued+running, waiting, completed, failed, superseded).
   - Recommendation: Use 5 correlation statuses: `active` (queued+running), `waiting`, `completed`, `failed`, `superseded`. The distinction between queued and running is an executor detail that correlation consumers don't need.

3. **event.routed for trigger_match and signal_match**
   - What we know: Per decision, emit routing events for all non-duplicate/non-ignore dispositions. Trigger matches and signal matches are fast-path (deterministic).
   - What's unclear: Whether to emit event.routed for EVERY trigger match (high volume) or only for correlation_fallback and slow_path (lower volume, higher debugging value).
   - Recommendation: Emit for all routing methods. The event payload is small (entity, disposition, routing_method, target), and the dashboard can filter by routing_method. The debugging value of seeing "LIN-456 was routed via trigger_match to dev-agent-LIN-456" is worth the storage cost.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** — all findings come from direct reading of the source files:
  - `packages/agents/src/router/router.ts` — routing pipeline structure
  - `packages/agents/src/router/types.ts` — RouteEventDeps, RouteEventResult types
  - `packages/agents/src/framework/event-router.ts` — EventRouter.handle() synchronous routing
  - `packages/agents/src/framework/conversation-executor.ts` — start(), signal(), idempotency
  - `packages/agents/src/framework/types.ts` — Signal schema, WaitForState, tool interfaces
  - `packages/agents/src/framework/worker-loop.ts` — lifecycle transitions, status updates
  - `packages/agents/src/adapters/*.ts` — Linear, GitHub, Slack event normalization
  - `packages/agents/src/shared/db/schema.ts` — full database schema
  - `packages/agents/src/shared/services/knowledge-service.ts` — query implementation
  - `packages/agents/src/framework/tool-factories.ts` — tool registration pattern
  - `packages/agents/src/service/main.ts` — service bootstrap wiring
  - `packages/agents/src/router/slow-path.ts` — LLM-based routing
  - `packages/agents/src/router/system-prompt.ts` — router LLM system prompt
  - `packages/dashboard/src/lib/schema.ts` — dashboard schema mirror
  - `packages/dashboard/src/services/overview.ts` — event query patterns

### Secondary (MEDIUM confidence)
- `.planning/specs/2.8-agent-resilience.md` — Phase 5 spec providing the design vision
- `.planning/phases/78-work-correlation/78-CONTEXT.md` — user decisions from discussion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, extending existing patterns
- Architecture: HIGH — all insertion points verified by reading actual source code
- Pitfalls: HIGH — identified from real code paths, not hypothetical
- Schema design: HIGH — follows existing Drizzle patterns verified in 14 existing migrations

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (stable — internal codebase, no external dependency changes)
