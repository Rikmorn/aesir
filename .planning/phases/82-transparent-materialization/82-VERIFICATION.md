---
phase: 82-transparent-materialization
verified: 2026-02-20T23:45:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 82: Transparent Materialization Verification Report

**Phase Goal:** Delegated tasks can optionally create corresponding Linear tickets, giving human operators visibility into agent-to-agent work through their existing tools
**Verified:** 2026-02-20T23:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | MaterializationAdapter interface defines create(), syncStatus(), handleWebhook() | VERIFIED | `types.ts` lines 120–143: interface with all three methods, explicit typed params |
| 2  | MaterializationConfig Zod schema validates { type: 'transparent', target: 'linear', properties: { priority?, labels?, teamId? } } | VERIFIED | `types.ts` lines 25–38: exact schema shape with all optional properties |
| 3  | agents.materialization_records table exists with correct columns | VERIFIED | `0018_add_materialization_records.sql`: CREATE TABLE with task_id PK, target, external_id, external_url, conversation_id, agent_id, config, sync_status, created/updated_at |
| 4  | Linear MCP create_issue accepts optional parentId and passes it to SDK | VERIFIED | `schemas.ts` line 82: parentId optional; `issues.ts` lines 207–209: conditional pass-through |
| 5  | Linear MCP update_issue_status accepts optional stateType and resolves by type | VERIFIED | `schemas.ts` lines 120–134: stateType enum + refine; `issues.ts` lines 315–329: type-first resolution |
| 6  | delegate_task accepts optional materialization parameter and calls adapter.create() | VERIFIED | `delegate-task.ts` lines 42–44: schema extension; lines 174–213: materialization call with graceful degradation |
| 7  | delegate_group accepts group-level materialization for individual issue-per-task | VERIFIED | `delegate-group.ts` lines 65–68: schema extension; lines 267–308: per-task creation with group-{shortId} label |
| 8  | DelegationDeps includes materializationAdapter | VERIFIED | `types.ts` line 410: optional field; `worker-loop.ts` line 1280: injected from options |
| 9  | LinearMaterializationAdapter.create() creates issues, records row, registers work_correlation | VERIFIED | `linear-adapter.ts` lines 283–309: DB insert + correlationService.register() |
| 10 | Forward sync fires on task terminal transitions for materialized tasks | VERIFIED | `forward-sync.ts` lines 59–96: onTaskUpdate, syncable status set, materialization record lookup, adapter.syncStatus() call |
| 11 | linear.issue.updated events from materialized issues generate domain signals via router | VERIFIED | `router.ts` lines 265–381: step 1.4 looks up materialization_records, calls handleWebhook, delivers signal via executor.signal() |
| 12 | MaterializationAdapter bootstrapped in main.ts and wired through executor -> worker loop -> router | VERIFIED | `main.ts`: createLinearMaterializationAdapter (line 173), createForwardSyncListener (line 222), composite dispatcher (lines 228–243), routeEventDeps injection (line 307) |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/agents/src/shared/services/materialization/types.ts` | MaterializationAdapter interface, config schema, param/result types | VERIFIED | 163 lines, all exported types present |
| `packages/agents/src/shared/db/migrations/0018_add_materialization_records.sql` | Migration for materialization_records table | VERIFIED | CREATE TABLE with all required columns + 2 indexes |
| `packages/agents/src/shared/services/materialization/index.ts` | Barrel export for materialization module | VERIFIED | Re-exports from forward-sync, linear-adapter, types |
| `packages/agents/src/shared/services/materialization/linear-adapter.ts` | LinearMaterializationAdapter factory | VERIFIED | 489 lines; exports createLinearMaterializationAdapter; create/syncStatus/handleWebhook all implemented |
| `packages/agents/src/shared/services/materialization/forward-sync.ts` | Forward status sync listener | VERIFIED | 97 lines; exports createForwardSyncListener; queries DB before syncing |
| `packages/agents/src/shared/tools/task/delegate-task.ts` | delegate_task with materialization parameter | VERIFIED | MaterializationConfigSchema imported and used; adapter.create() wired; graceful degradation |
| `packages/agents/src/shared/tools/task/delegate-group.ts` | delegate_group with group-level materialization | VERIFIED | Per-task issue creation with group-{shortId} label; parent issue resolved once per group |
| `packages/agents/src/framework/types.ts` | DelegationDeps with materializationAdapter field | VERIFIED | Line 410: `materializationAdapter?: MaterializationAdapter | undefined` |
| `packages/agents/src/adapters/linear.ts` | correlationKey on issue.updated events | VERIFIED | Line 86: correlationKey set from issueId for materialization routing |
| `packages/agents/src/adapters/types.ts` | linear.issue.updated removed from IGNORE_EVENT_TYPES | VERIFIED | Line 127: IGNORE_EVENT_TYPES = new Set(["linear.issue.created"]) only |
| `packages/agents/src/router/router.ts` | Materialization routing step for linear.issue.updated | VERIFIED | Lines 265–381: step 1.4 with DB lookup, handleWebhook call, signal delivery, fallback ignore |
| `packages/agents/src/service/main.ts` | Full service wiring | VERIFIED | Adapter created, forward sync composed, routeEventDeps includes materializationAdapter |
| `packages/agents/src/framework/worker-loop.ts` | materializationAdapter injected into DelegationDeps | VERIFIED | Line 1280: materialized via options |
| `packages/integrations/linear/src/api/webhooks.ts` | Issue.update webhook handler | VERIFIED | Issue type handling added with timestamp validation and normalized event dispatch |
| `packages/integrations/linear/scripts/seed-label.ts` | agent-work label seed script | VERIFIED | Idempotent script using team.labels() + createIssueLabel(); seed:labels script in package.json |
| `packages/agents/definitions/dev-agent/prompt.md` | Materialization guidance | VERIFIED | Section present with parameter shape, heuristics, nesting depth, completion summary |
| `packages/agents/definitions/product-agent/prompt.md` | Materialization guidance | VERIFIED | Section present with parameter shape, heuristics, nesting depth, completion summary |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `types.ts` (materialization) | `schema.ts` | materializationRecords type alignment | WIRED | schema.ts exports MaterializationRecord = materializationRecords.$inferSelect |
| `linear-adapter.ts` | `mcp/index.ts` | callMcpTool for create_issue, update_issue_status | WIRED | Line 21 import; callMcpTool called in create() and syncStatus() |
| `linear-adapter.ts` | `schema.ts` | Insert/query materializationRecords | WIRED | Line 20 import; db.insert(materializationRecords) + db.update() |
| `linear-adapter.ts` | `correlation-service.ts` | correlationService.register() on create() | WIRED | Lines 295–300: register called with entityType/entityId/conversationId/agentId |
| `forward-sync.ts` | `linear-adapter.ts` | adapter.syncStatus on terminal transitions | WIRED | Lines 78–82: adapter.syncStatus called with external_id from materialization record |
| `delegate-task.ts` | `materialization/types.ts` | MaterializationConfigSchema import | WIRED | Line 22: import; line 42: used in schema |
| `types.ts` (framework) | `materialization/types.ts` | DelegationDeps.materializationAdapter | WIRED | Line 30: import; line 410: field declared |
| `router.ts` | `linear-adapter.ts` (via deps) | handleWebhook for materialized issue.updated | WIRED | Lines 318–328: deps.materializationAdapter.handleWebhook() called |
| `main.ts` | `materialization/index.ts` | Creates and injects adapter + forward sync | WIRED | Lines 54–57: imports; lines 173–243: instantiation and wiring |
| `worker-loop.ts` | `types.ts` (framework) | DelegationDeps includes materializationAdapter | WIRED | Line 1280: options.materializationAdapter passed through |
| `webhooks.ts` (linear) | dispatcher | Issue.update events dispatched | WIRED | Line 252: dispatcher.dispatch(normalizedIssueEvent) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MAT-01 | 82-04 | delegate_task accepts optional materialization parameter | SATISFIED | delegate-task.ts: MaterializationConfigSchema in schema; adapter.create() called on transparent type |
| MAT-02 | 82-03 | Linear materialization creates issue with description, priority, labels, dashboard link | SATISFIED | linear-adapter.ts: buildDescription(), PRIORITY_MAP, labelIds with agent-work label, callMcpTool create_issue |
| MAT-03 | 82-05 | Bidirectional sync: Linear status -> task signal; task completion -> Linear | SATISFIED | Forward sync (main.ts composite dispatcher) + reverse sync (router step 1.4 + webhooks.ts Issue.update handler) |
| MAT-04 | 82-02 | Materialization as agent judgment via prompt guidance | SATISFIED | Both dev-agent and product-agent prompt.md contain materialization sections with judgment criteria, no rigid rules |
| MAT-05 | 82-01, 82-03 | Extensible MaterializationAdapter interface for future targets | SATISFIED | Interface defined in types.ts; target enum extensible; no Linear SDK imports in agents package |
| MAT-06 | 82-01, 82-05 | Correlation tracking for webhook routing | SATISFIED | correlationService.register() called in create(); router queries materialization_records by external_id |

All 6 requirements verified as satisfied. No orphaned requirements found in REQUIREMENTS.md mapping to Phase 82.

### Anti-Patterns Found

No blockers or warnings found.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

Spot check for stubs in key files:
- `linear-adapter.ts`: Full implementation (create/syncStatus/handleWebhook all substantive)
- `forward-sync.ts`: Real DB query + adapter call, no placeholder
- `delegate-task.ts` / `delegate-group.ts`: Real adapter.create() call with error handling
- `router.ts`: Real DB lookup from materializationRecords, real signal delivery
- `seed-label.ts`: Actual Linear SDK call, idempotency check present

### Human Verification Required

#### 1. End-to-end materialization flow

**Test:** Call delegate_task with `materialization: { type: "transparent", target: "linear" }` from dev-agent or product-agent
**Expected:** A Linear issue is created in the configured team with the task description, "agent-work" label, and a dashboard link. The response includes the Linear issue URL.
**Why human:** Requires live Linear API connection; no unit test covers the full flow including Linear issue creation confirmation

#### 2. Forward sync: task completion to Linear

**Test:** Complete a task that was materialized. Check the Linear issue.
**Expected:** The Linear issue transitions to "Done" (or the team's "completed" state type) via update_issue_status.
**Why human:** Requires live Linear integration + task execution environment

#### 3. Reverse sync: Linear cancellation to agent signal

**Test:** Cancel a materialized Linear issue from the Linear UI
**Expected:** The owning conversation receives a `task_cancelled` signal with reason "Cancelled in Linear by human"
**Why human:** Requires live webhook delivery from Linear

#### 4. Comment routing on materialized issues

**Test:** Post a comment on a materialized Linear issue
**Expected:** The comment is routed as a `user_reply` signal to the owning conversation via the existing correlation_fallback path
**Why human:** Depends on existing correlation routing path; needs end-to-end webhook delivery

#### 5. Prompt guidance quality

**Test:** Interact with dev-agent and product-agent on a delegation task; observe whether they use materialization appropriately
**Expected:** Dev-agent keeps coder/researcher/tester delegations internal; product-agent materializes dev-agent and qa-agent delegations for human-initiated work
**Why human:** LLM behavior requires live testing with realistic scenarios

#### 6. agent-work label seed

**Test:** Run `pnpm --filter @aesir/integration-linear seed:labels`
**Expected:** "agent-work" label created in the Linear team (or skip message if already exists)
**Why human:** Requires LINEAR_ACCESS_TOKEN and LINEAR_TEAM_ID in environment; idempotency check depends on live API

### Gaps Summary

No gaps. All must-haves verified. All 6 requirements (MAT-01 through MAT-06) satisfied in the codebase.

One notable architectural note (not a gap): `handleWebhook()` is synchronous per the interface contract, so it cannot do async DB lookups. The caller (router) is responsible for looking up the materialization record and injecting taskId/conversationId into eventData before calling handleWebhook. This design is documented in the summary and the code comments — it is intentional and correct.

---

_Verified: 2026-02-20T23:45:00Z_
_Verifier: Claude (gsd-verifier)_
