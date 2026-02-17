---
phase: 78-work-correlation
verified: 2026-02-17T23:50:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
---

# Phase 78: Work Correlation Verification Report

**Phase Goal:** The platform tracks which conversations are working on which external entities, enabling the router and agents to check existing work before starting duplicates
**Verified:** 2026-02-17T23:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

The phase delivers a complete correlation tracking pipeline: adapters extract entityRef from incoming events, the executor auto-registers correlations at conversation start, the worker loop propagates status changes through lifecycle boundaries, agents have work:register/work:query tools for manual registration and lookup, and the router uses correlation data to signal active conversations or enrich slow-path decisions instead of starting duplicates.

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | work_correlations table exists with composite PK (entity_type, entity_id, conversation_id) | VERIFIED | `0014_add_work_correlations.sql` has `PRIMARY KEY (entity_type, entity_id, conversation_id)`; schema.ts defines `workCorrelations` with unique constraint |
| 2  | knowledge_entries has a metadata JSONB column with GIN index | VERIFIED | `0015_add_knowledge_metadata.sql` has `ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'` + GIN index; schema.ts line 320 has metadata column |
| 3  | event.routed is a valid agent event type in schema and CHECK constraint | VERIFIED | schema.ts line 160 includes `"event.routed"` in agentEventTypeValues; `0016_add_event_routed_type.sql` updates CHECK constraint |
| 4  | IncomingEvent schema accepts optional entityRef with entityType and entityId | VERIFIED | adapters/types.ts lines 24-30 define `EntityRefSchema` with enum; line 65 adds optional `entityRef` to IncomingEventSchema |
| 5  | entity_update is documented as a known signal type in framework types | VERIFIED | framework/types.ts line 491 includes `"entity_update"` in `KNOWN_SIGNAL_TYPES` const |
| 6  | Adapters extract entityRef for Linear (linear_issue), GitHub (github_pr), Slack (slack_thread) | VERIFIED | linear.ts: 5 occurrences of `entityRef: { entityType: "linear_issue" }`; github.ts: 3 PR occurrences with `owner/repo#number` format; slack.ts: 6 thread occurrences |
| 7  | CorrelationService has all 7 methods and is wired into agents | VERIFIED | correlation-service.ts lines 44-64 declare all 7 interface methods; implemented at lines 101-199; tool-factories.ts lines 73-74 import and lines 375-377 register `work:register` and `work:query` |
| 8  | work:register tool calls CorrelationService.register() | VERIFIED | register.ts line 50: `correlationService.register(...)` called with conversationId and agentId from ctx |
| 9  | work:query tool calls CorrelationService.queryAll() | VERIFIED | query.ts line 45: `correlationService.queryAll(entityType, entityId)` |
| 10 | executor.start() auto-registers entity correlation when entityRef provided | VERIFIED | conversation-executor.ts lines 282-338: two registration points (new conversation and re-trigger path) guard on `params.entityRef && correlationService` |
| 11 | Worker loop propagates status to correlation registry at all lifecycle boundaries | VERIFIED | worker-loop.ts: active (line 1009), waiting (line 1716), completed (line 1766), failed (lines 1836, 1997) — all fire-and-forget via void+catch |
| 12 | CorrelationService bootstrapped in main.ts and injected into executor, tools, and router | VERIFIED | main.ts line 50 imports `createCorrelationService`; line 125 creates instance; lines 132, 190, 265 inject into executor, registerAllTools, and routeEvent deps |
| 13 | Router checks correlation registry on slow_path events with entityRef | VERIFIED | router.ts lines 385-391: `queryActive` called when `event.entityRef && deps.correlationService`; active correlations signaled with `entity_update` |
| 14 | Terminal correlations enrich slow-path LLM context | VERIFIED | router.ts lines 449-484: `queryTerminal` called; correlationContext assembled; slow-path.ts lines 64-73 append terminal work history to formatEventForLLM output |
| 15 | Disposition and RoutingMethod vocabulary formalized in router types | VERIFIED | router/types.ts lines 20-40: `dispositionValues` (`new/signal/retry/supersede/duplicate`) and `routingMethodValues` (`trigger_match/signal_match/correlation_fallback/slow_path`) |
| 16 | event.routed events emitted at routing decision points | VERIFIED | router.ts lines 330, 367, 433: emitRoutedEvent called at trigger_match, signal_match, and correlation_fallback |
| 17 | entityRef passed through router to executor.start() for auto-registration | VERIFIED | router.ts lines 308-309: conditional spread `...(routeDecision.event.entityRef && { entityRef: ... })` |
| 18 | knowledge:query supports semantic/exact/combined modes with metadata filtering | VERIFIED | knowledge-service.ts lines 283, 344, 364, 411: explicit mode dispatch; JSONB containment at line 310 |
| 19 | knowledge:store accepts optional metadata parameter | VERIFIED | store.ts lines 31-35: `metadata: z.record(z.unknown()).optional()` in input schema |
| 20 | Typecheck passes for all Phase 78 changes | VERIFIED | `pnpm --filter @aesir/agents run typecheck` exits 0 with no errors |

**Score:** 20/20 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/agents/src/shared/db/schema.ts` | workCorrelations table, correlationStatusValues, metadata column, event.routed type | VERIFIED | All four elements confirmed via grep (lines 160, 320, 502, 521) |
| `packages/agents/src/shared/db/schema.drizzle.ts` | Mirror of workCorrelations for drizzle-kit | VERIFIED | workCorrelations defined at line 376 with correlationStatusValues at line 361 |
| `packages/agents/src/shared/db/migrations/0014_add_work_correlations.sql` | Work correlations DDL with composite PK | VERIFIED | Full CREATE TABLE with PK, CHECK constraint, 3 indexes |
| `packages/agents/src/shared/db/migrations/0015_add_knowledge_metadata.sql` | Knowledge metadata JSONB column | VERIFIED | ADD COLUMN metadata JSONB + GIN index |
| `packages/agents/src/shared/db/migrations/0016_add_event_routed_type.sql` | event.routed CHECK constraint update | VERIFIED | event.routed added at line 30 |
| `packages/agents/src/adapters/types.ts` | EntityRefSchema, EntityRef type, entityRef on IncomingEvent | VERIFIED | Lines 24-30, 65 |
| `packages/agents/src/framework/types.ts` | entity_update in KNOWN_SIGNAL_TYPES, entityRef on StartConversationParams | VERIFIED | Lines 491, 569 |
| `packages/agents/src/adapters/linear.ts` | entityRef with linear_issue on issue events | VERIFIED | 5 occurrences with entityType "linear_issue" |
| `packages/agents/src/adapters/github.ts` | entityRef with github_pr on PR events | VERIFIED | 3 occurrences with owner/repo#number format |
| `packages/agents/src/adapters/slack.ts` | entityRef with slack_thread on thread events | VERIFIED | 6 occurrences with channelId:threadTs format |
| `packages/agents/src/shared/services/correlation-service.ts` | CorrelationService factory with 7 methods | VERIFIED | All 7 methods declared and implemented |
| `packages/agents/src/shared/tools/work/register.ts` | work:register tool factory | VERIFIED | Calls correlationService.register() with Zod-validated input |
| `packages/agents/src/shared/tools/work/query.ts` | work:query tool factory | VERIFIED | Calls correlationService.queryAll() with Zod-validated input |
| `packages/agents/src/shared/tools/work/index.ts` | Barrel export for work tools | VERIFIED | Exports createWorkRegisterTool and createWorkQueryTool |
| `packages/agents/src/framework/tool-factories.ts` | work:register and work:query registered | VERIFIED | Lines 375-377 register both tools under "work" namespace |
| `packages/agents/src/framework/conversation-executor.ts` | Auto-register at start(), correlationService option | VERIFIED | Two registration guard blocks for new and re-trigger paths |
| `packages/agents/src/framework/worker-loop.ts` | Status propagation at lifecycle boundaries | VERIFIED | 5 updateStatus calls: active, waiting, completed, failed (x2) |
| `packages/agents/src/service/main.ts` | CorrelationService bootstrap and injection | VERIFIED | Created at line 125, injected at lines 132, 190, 265 |
| `packages/agents/src/router/router.ts` | Correlation fallback, event.routed emission, entityRef pass-through | VERIFIED | All three present and substantive |
| `packages/agents/src/router/types.ts` | Disposition, RoutingMethod, CorrelationContext types | VERIFIED | Lines 20-40, 47-98, 141, 143 |
| `packages/agents/src/router/slow-path.ts` | formatEventForLLM with correlationContext enrichment | VERIFIED | Lines 49-73 accept and apply CorrelationContext |
| `packages/agents/src/router/system-prompt.ts` | Disposition guidance for retry/supersede decisions | VERIFIED | existing_work_context section at line 249 |
| `packages/agents/src/shared/services/knowledge-service.ts` | semantic/exact/combined mode dispatch, metadata JSONB filter | VERIFIED | Lines 283, 307-411 handle all three modes |
| `packages/agents/src/shared/tools/knowledge/query.ts` | mode and metadata parameters | VERIFIED | Lines 29-39 add both optional fields |
| `packages/agents/src/shared/tools/knowledge/store.ts` | metadata parameter | VERIFIED | Lines 31-35 add optional metadata field |
| `packages/agents/src/shared/db/migrations/meta/_journal.json` | 3 new migration entries | VERIFIED | All three tags present in journal |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `adapters/linear.ts` | `adapters/types.ts` | entityRef: { entityType: "linear_issue" } | WIRED | 5 occurrences of entityRef with linear_issue |
| `adapters/github.ts` | `adapters/types.ts` | entityRef: { entityType: "github_pr" } | WIRED | 3 occurrences with owner/repo#number format |
| `adapters/slack.ts` | `adapters/types.ts` | entityRef: { entityType: "slack_thread" } | WIRED | 6 occurrences with channelId:threadTs format |
| `tools/work/register.ts` | `services/correlation-service.ts` | correlationService.register() | WIRED | Line 50 calls register with all required params |
| `tools/work/query.ts` | `services/correlation-service.ts` | correlationService.queryAll() | WIRED | Line 45 calls queryAll with entityType/entityId |
| `framework/tool-factories.ts` | `tools/work/index.ts` | work:register and work:query registrations | WIRED | Lines 73-74 import; lines 375-377 register both |
| `conversation-executor.ts` | `services/correlation-service.ts` | start() calls correlationService.register() | WIRED | Lines 282-338 with two guard blocks |
| `worker-loop.ts` | `services/correlation-service.ts` | updateStatus at lifecycle boundaries | WIRED | 5 updateStatus calls at active/waiting/completed/failed boundaries |
| `service/main.ts` | `services/correlation-service.ts` | createCorrelationService bootstrap | WIRED | Import at line 50, instantiation at 125, injection at 132/190/265 |
| `router/router.ts` | `services/correlation-service.ts` | queryActive and queryTerminal in slow_path | WIRED | Lines 389 and 449 call both query methods |
| `router/router.ts` | `conversation-executor.ts` | executor.signal(entity_update) for active correlations | WIRED | Line 401 signals with entity_update type |
| `router/router.ts` | `db/schema.ts` | emitRoutedEvent direct DB insert of event.routed | WIRED | Lines 63-73 insert agentEvents with type "event.routed" |
| `router/slow-path.ts` | correlation context from router.ts | formatEventForLLM receives CorrelationContext | WIRED | Line 115 passes deps.correlationContext; lines 64-73 use it |
| `tools/knowledge/query.ts` | `services/knowledge-service.ts` | knowledgeService.query() with mode and metadata | WIRED | Spread passes all input fields including mode/metadata |
| `services/knowledge-service.ts` | `db/schema.ts` | knowledgeEntries.metadata @> JSONB containment | WIRED | Line 310 uses sql template with @> operator |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CORR-01 | 78-01, 78-02 | Entity reference standardized on IncomingEvent | SATISFIED | EntityRefSchema in adapters/types.ts; all three adapters extract typed entityRef |
| CORR-02 | 78-01, 78-05 | work_correlations table with composite key linking entities to conversations | SATISFIED | Migration 0014 creates table; executor auto-registers at start() |
| CORR-03 | 78-03 | work:register tool allows agents to register work on an external entity | SATISFIED | register.ts tool factory; registered in tool-factories.ts |
| CORR-04 | 78-03 | work:query tool allows agents and router to check existing work | SATISFIED | query.ts tool factory returning all correlations with status |
| CORR-05 | 78-05 | Conversation status changes propagate to correlation registry automatically | SATISFIED | Worker loop: 5 updateStatus calls at active/waiting/completed/failed boundaries |
| CORR-06 | 78-06 | Router uses correlation lookup as fallback — active work found signals that conversation | SATISFIED | router.ts slow_path case: queryActive then signal with entity_update |
| CORR-07 | 78-01, 78-06 | Disposition vocabulary formalized for routing decisions | SATISFIED | router/types.ts: dispositionValues, routingMethodValues; event.routed emissions at decision points |
| CORR-08 | 78-04 | Knowledge query supports metadata-based exact match mode | SATISFIED | knowledge-service.ts: semantic/exact/combined mode dispatch; query/store tools accept metadata |

All 8 requirements satisfied. No orphaned requirements detected.

---

### Anti-Patterns Found

No blocker or warning anti-patterns found in Phase 78 files.

Two `return null` occurrences in router.ts (lines 120, 130) are in a task-correlation-key lookup helper — legitimate nullish returns used as a signal to fall through to EventRouter, not implementation stubs.

---

### Human Verification Required

#### 1. Correlation fallback signal delivery (end-to-end)

**Test:** Trigger two events for the same Linear issue (e.g., a comment while a dev-agent conversation is active for that issue). Confirm the second event is delivered as an `entity_update` signal to the active conversation rather than starting a new one.
**Expected:** One conversation remains active; it receives an entity_update signal containing the second event's data.
**Why human:** Requires a live stack (DB, adapters, router, agent service) and a real Linear webhook sequence to verify the full pipeline.

#### 2. Knowledge exact-mode query without embeddings

**Test:** Store a knowledge entry with `metadata: { issueId: "LIN-123" }`, then query with `mode: "exact", metadata: { issueId: "LIN-123" }`. Confirm retrieval without triggering an embedding call.
**Expected:** Entry returned by JSONB containment match; no embedding service call logged.
**Why human:** Requires runtime execution to verify that the exact mode truly bypasses the embedding code path and the JSONB operator works on live PostgreSQL.

#### 3. Worker loop status propagation observable

**Test:** Create a conversation with entityRef, let it complete, then query work_correlations for the entity.
**Expected:** Row with status = "completed" present in agents.work_correlations.
**Why human:** Requires DB access and a live conversation to verify the fire-and-forget updateStatus actually persists before the connection closes.

---

### Gaps Summary

No gaps. All phase 78 truths are verified and all 8 requirements are satisfied. The three items above require human verification on a live stack but are not automated-verification failures — the code paths are clearly present and wired.

---

_Verified: 2026-02-17T23:50:00Z_
_Verifier: Claude (gsd-verifier)_
