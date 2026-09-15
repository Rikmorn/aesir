# Test Plan: v2.8 + v2.9 End-to-End Validation

## Context

v2.8 (Resilience & Observability, 6 phases) and v2.9 (Platform Completion, 7 phases) are complete. Before moving to v3.0, this plan verifies everything works end-to-end.

---

## Part 1: Automated Scenarios (8 new, 15 total)

### Scenario 1: Counter-Propose Handshake (Phase 80)

**ID:** `counter-propose` | **Trigger:** `testing.counterpropose.start` | **Timeout:** 60s

**Test agents:** test-counterpropose-delegator, test-counterpropose-responder

**Criteria:**
- Two conversations: delegator and responder, both completed
- Responder called respond_task with type "counter_propose" (NOT "accept")
- A task_counter_proposed signal was received by the delegator
- After delegator accepts: responder resumed and called complete_task
- Delegator called wait_for_task BEFORE complete_task
- No stuck conversations

---

### Scenario 2: Clarification Round-Trip (Phase 80)

**ID:** `clarification` | **Trigger:** `testing.clarify.start` | **Timeout:** 90s

**Test agents:** test-clarify-delegator, test-clarify-worker

**Criteria:**
- Two conversations: delegator and worker, both completed
- Worker called clarify_task (sends task_clarification signal)
- Delegator called answer_task (sends task_clarification_response signal)
- Worker resumed after answer and called complete_task
- Delegator's completion references worker's outcome
- No stuck conversations, no timeouts

---

### Scenario 3: Parallel Delegation with any_sufficient (Phase 81)

**ID:** `parallel-any` | **Trigger:** `testing.parallel.any.start` | **Timeout:** 90s

**Test agents:** test-parallel-delegator, test-parallel-fast-worker, test-parallel-slow-worker

**Criteria:**
- Three conversations: delegator + two workers
- Delegator completed successfully
- At least one worker completed (any_sufficient satisfied)
- Delegator called delegate_group (not individual delegate calls)
- delegation_groups record exists with policy any_sufficient
- Delegator woke from wait_for_group after first completion
- Delegator called group_status after waking

---

### Scenario 4: Parallel Delegation with all_required + Failure (Phase 81)

**ID:** `parallel-all-fail` | **Trigger:** `testing.parallel.allfail.start` | **Timeout:** 90s

**Test agents:** test-parallel-allfail-delegator, test-parallel-fast-worker, test-delegate-rejector (reused)

**Criteria:**
- Three conversations: delegator, fast-worker, rejector
- Rejector's task was rejected (respond_task with reject)
- Delegator woke because all_required became unsatisfiable
- Delegator called cancel_group OR completed after checking group_status
- Delegator completed noting partial failure
- No stuck conversations

---

### Scenario 5: Tree Budget Exhaustion (Phase 83)

**ID:** `tree-budget` | **Trigger:** `testing.treebudget.start` | **Timeout:** 90s

**Test agents:** test-budget-root (treeBudget: 12000), test-budget-worker

**Criteria:**
- Two conversations: root and worker
- tree_budget tool called, returned allocation/consumed/remaining
- tree_budget.warning or tree_budget.exhausted event exists, or failure with budget exhaustion
- Root reaches terminal state (completed or failed)
- Context injection visible ("Tree budget:" text)
- No stuck conversations

---

### Scenario 6: Identity Document Persistence (Phase 86)

**ID:** `identity` | **Trigger:** `testing.identity.start` | **Timeout:** 60s

**Test agents:** test-identity-writer

**Criteria:**
- One conversation: identity-writer, completed
- identity_update called with document_type "product_brief"
- identity_read called and returned content
- No tool.failed events for identity tools
- Completion result references document content

---

### Scenario 7: Knowledge Flush Before Compaction (Phase 87)

**ID:** `knowledge-flush` | **Trigger:** `testing.knowledgeflush.start` | **Timeout:** 120s

**Test agents:** test-knowledge-flusher (pruneThreshold: 4000)

**Criteria:**
- One conversation: knowledge-flusher, completed
- knowledge_store called at least once (manual storage)
- If compaction triggered: knowledge flush prompt injected, knowledge_store called again
- If compaction did not trigger: manual knowledge operations still succeeded (acceptable)
- No knowledge tool errors

---

### Scenario 8: Scheduled Execution (Phase 84)

**ID:** `scheduled` | **Trigger:** `testing.scheduled.start` | **Timeout:** 60s

**Test agents:** test-scheduled-agent (cron: "0 0 1 1 *" — never fires naturally)

**Criteria:**
- One conversation: scheduled-agent, completed
- Agent completed task with trigger summary
- No errors
- Manual follow-up: POST /schedules/test-scheduled-agent/test-schedule/trigger for schedule context test

---

## Part 2: Manual Dashboard Verification Checklist

### Conversation Detail Page

| # | Check | How to verify | Phase |
|---|-------|---------------|-------|
| D1 | Event timeline renders all 18 event types | Open a conversation with tool calls, signals, lifecycle events | 77 |
| D2 | Tool call cards group called+succeeded | Expand tool card — single grouped card, not two events | 77 |
| D3 | MCP error events render in tool cards | If mcp.error/mcp.rate_limited exist, verify sub-sections in tool card | 76/77 |
| D4 | Lifecycle banners styled correctly | agent.stale_recovered (amber), agent.retry_scheduled (amber), notification.failed (red) | 77 |
| D5 | Cost estimate displays | EventMetricsBar shows ~$X.XX for conversations with token usage | 79 |
| D6 | Sub-agent pills visible | Open orchestrator with sub-agents — child events have agent name pills | 77 |
| D7 | SSE live updates work | Open running conversation — events stream without page refresh | 77 |
| D8 | Recovery context visible | Retried conversation shows `<recovery_context>` in resumed messages | 76 |

### Task/Delegation Graph Page

| # | Check | How to verify | Phase |
|---|-------|---------------|-------|
| T1 | Delegation graph renders tree | Open delegation test task — React Flow shows nodes and edges | v2.7 |
| T2 | Group nodes display | Parallel delegation test — group node shows policy badge + progress | 81 |
| T3 | Budget bars on nodes | Tree-budget test — nodes with subtree_allocation show colored fill | 83 |
| T4 | Budget bar colors correct | emerald (<60%), amber (60-80%), red (>80%), dark red (100%) | 83 |
| T5 | Task detail panel budget section | Click budget node — Allocated, Remaining, Used, Usage % | 83 |
| T6 | Health badges display | Failures show red AlertCircle, timeouts/rejections show amber AlertTriangle | v2.8 |
| T7 | Counter-propose status | Counter-propose test — "counter_proposed" status during negotiation | 80 |
| T8 | Node click <-> timeline sync | Click graph node — timeline scrolls to that task's events | v2.7 |

### Agents Page

| # | Check | How to verify | Phase |
|---|-------|---------------|-------|
| A1 | Schedule panel visible | Open test-scheduled-agent — sidebar shows schedule card with cron, timezone, next run | 84 |
| A2 | Manual trigger button | Schedule card has "Trigger" button | 84 |
| A3 | Identity documents visible | Open test-identity-writer after test — sidebar shows product_brief document card | 86 |
| A4 | Identity version history | Multiple versions show evolution list | 86 |
| A5 | Agent config shows treeBudget | Open test-budget-root — config panel displays treeBudget value | 83 |

### Overview Page

| # | Check | How to verify | Phase |
|---|-------|---------------|-------|
| O1 | Stat cards reflect running tests | While tests run, Running stat increments | v2.7 |
| O2 | Recent errors show failures | If any test fails, error card appears with agent ID + message | v2.8 |
| O3 | Upcoming schedules card | Shows test-scheduled-agent's schedule (if registered) | 84 |
| O4 | Token usage chart renders | 24h range — chart shows input/output token bars | 79 |

---

## Running the Tests

```bash
# All 15 scenarios (7 existing + 8 new)
pnpm --filter @aesir/agents test:agents

# Run specific new scenarios
pnpm --filter @aesir/agents test:agents -- counter-propose
pnpm --filter @aesir/agents test:agents -- clarification
pnpm --filter @aesir/agents test:agents -- parallel-any
pnpm --filter @aesir/agents test:agents -- parallel-all-fail
pnpm --filter @aesir/agents test:agents -- tree-budget
pnpm --filter @aesir/agents test:agents -- identity
pnpm --filter @aesir/agents test:agents -- knowledge-flush
pnpm --filter @aesir/agents test:agents -- scheduled

# Run by tag
pnpm --filter @aesir/agents test:agents -- --tag negotiation
pnpm --filter @aesir/agents test:agents -- --tag parallel
pnpm --filter @aesir/agents test:agents -- --tag identity
```
