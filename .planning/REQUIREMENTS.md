# Requirements: Aesir v2.5 Agentic Conversations

**Defined:** 2026-02-06
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Spec:** `.planning/specs/2.5-agentic-conversations.md`

## v2.5 Requirements

### Prompt Rewrites

- [x] **PROMPT-01**: Rewrite product-agent prompt to goal-oriented style (identity, constitutional constraints, few-shot examples, PROMPT_GUIDE.md structure)
- [x] **PROMPT-02**: Rewrite dev-agent prompt to goal-oriented style (identity, constitutional constraints, few-shot examples, PROMPT_GUIDE.md structure)
- [x] **PROMPT-03**: Traceability matrix created per agent (old if/then rule → failure it prevented → new constraint or example that covers it)
- [x] **PROMPT-04**: Orchestrator prompts include selective chain-of-thought (`<reasoning>` blocks before significant decisions)
- [x] **PROMPT-05**: Constraint priority ordering documented per agent (safety > correctness > efficiency)
- [x] **PROMPT-06**: One few-shot example per agent demonstrates resolving a constraint tension

### Conversation Reopening

- [ ] **REOPEN-01**: Executor handles `reopen` signal on conversations in `completed` status
- [ ] **REOPEN-02**: Executor handles `reopen` signal on conversations in `failed` status
- [ ] **REOPEN-03**: Reopen signal transitions conversation back to `queued` with signal payload available
- [ ] **REOPEN-04**: Reopened conversation receives full prior history plus signal context
- [ ] **REOPEN-05**: World-state `<world_state>` context block injected when conversation is reopened (signal payload describes what changed)
- [ ] **REOPEN-06**: Constitutional constraint added to reopened prompts: verify current state of artifacts before acting
- [ ] **REOPEN-07**: Dashboard reopen/retry action available on conversation detail view
- [ ] **REOPEN-08**: Agent service exposes POST /conversations/:id/reopen endpoint
- [ ] **REOPEN-09**: `agent.reopened` event type added to event log
- [ ] **REOPEN-10**: Other signal types on terminal conversations still ignored (only `reopen` triggers transition)
- [ ] **REOPEN-11**: `delivered_signal_ids` capped at 100 entries to prevent unbounded growth

### Task Primitive

- [ ] **TASK-01**: `agents.tasks` table created with id, parent_id, creator_type/id, assignee_type/id, status, title, objective, metadata, timestamps
- [ ] **TASK-02**: `agents.task_handoffs` table created with id, task_id, conversation_id, handoff_type, context (JSONB), author_type/id, created_at
- [ ] **TASK-03**: `task_id` nullable FK column added to `agents.conversations`
- [ ] **TASK-04**: Task IDs use existing `createId` pattern (`task_<nanoid>`)
- [ ] **TASK-05**: Handoff IDs use `createId` pattern (`ho_<nanoid>`)
- [ ] **TASK-06**: Task status transitions enforced via tools (complete_task rejects cancelled tasks, etc.) with CHECK constraint for valid values
- [ ] **TASK-07**: Handoff context enforced via Zod: `{ summary: string (required, max 2000 chars), key_decisions?, artifacts?, open_questions?, next_steps? }`, capped at ~4KB
- [ ] **TASK-08**: `tasks.metadata` validated with Zod on write, 10KB size limit enforced at application layer
- [ ] **TASK-09**: `create_task` agent tool implemented (with optional parent_id for subtasks)
- [ ] **TASK-10**: `complete_task` agent tool implemented (marks task completed with structured completion handoff)
- [ ] **TASK-11**: `pause_task` agent tool implemented (pauses task with structured pause handoff)
- [ ] **TASK-12**: `handoff_task` agent tool implemented (writes delegation or escalation handoff)
- [ ] **TASK-13**: `list_tasks` agent tool implemented (query by assignee, status, or metadata)
- [ ] **TASK-14**: `get_task_context` agent tool implemented (retrieve handoffs and conversation history for a task)
- [ ] **TASK-15**: 6 task tools registered in ToolRegistry under `task:` namespace
- [ ] **TASK-16**: Task tools added to agent definition YAML files
- [ ] **TASK-17**: Parent-child task hierarchy supported (parent_id FK)
- [ ] **TASK-18**: Circular delegation prevented: `create_task` checks ancestry for same-assignee cycles
- [ ] **TASK-19**: Max depth of 5 levels for parent_id chains enforced
- [ ] **TASK-20**: Max 10 subtasks per parent task enforced
- [ ] **TASK-21**: `ToolContext.taskId` renamed to `sandboxId` (existing sandbox container ID usage)
- [ ] **TASK-22**: New `ToolContext.taskId` set from `conv.task_id` in worker loop
- [ ] **TASK-23**: Task context auto-injected as `<task_context>` block in worker loop (most recent handoff, truncated at 4000 chars with pointer to `get_task_context`)
- [ ] **TASK-24**: TaskService factory created with CRUD operations and validation
- [ ] **TASK-25**: Backward compatibility: all code paths handle null task_id gracefully
- [ ] **TASK-27**: Schema migration handles legacy `tasks` table in schema.drizzle.ts (check if empty, drop or rename)

### Integration Correlation

- [ ] **CORR-01**: `linear.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [ ] **CORR-02**: `github.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [ ] **CORR-03**: `slack.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [ ] **CORR-04**: `X-Task-ID` header added to MCP calls when conversation has a task
- [ ] **CORR-05**: Linear integration records correlation on outgoing MCP tool calls (fire-and-forget)
- [ ] **CORR-06**: GitHub integration records correlation on outgoing MCP tool calls (fire-and-forget)
- [ ] **CORR-07**: Slack integration records correlation on outgoing MCP tool calls (thread_ts as external_ref)
- [ ] **CORR-08**: Linear integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [ ] **CORR-09**: GitHub integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [ ] **CORR-10**: Slack integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [ ] **CORR-11**: `IncomingEvent` schema extended with optional `taskId` field

*Note: CORR-01/02/03, CORR-05/06/07, and CORR-08/09/10 follow a 3x3 pattern (same requirement per integration). Built once, replicated three times.*

### Event Routing

- [ ] **ROUTE-01**: Task-based routing priority: task reference → fast-path start → reasoning path
- [ ] **ROUTE-02**: When task has active/waiting conversation: deliver event as signal (serialized)
- [ ] **ROUTE-03**: When task has no active conversation: create new conversation in task with most recent handoff as context
- [ ] **ROUTE-04**: Task-scoped conversations use correlationKey including task ID + triggering event ID
- [ ] **ROUTE-05**: Task-level event serialization via PostgreSQL advisory locks (`pg_advisory_xact_lock`)
- [ ] **ROUTE-06**: Backward compatibility: events without task reference route through existing fast-path/slow-path unchanged

### Prompt Evolution

- [ ] **EVOL-01**: Product-agent prompt updated to leverage task lifecycle (create tasks for meaningful work)
- [ ] **EVOL-02**: Dev-agent prompt updated to leverage task lifecycle (create tasks, write handoffs)
- [ ] **EVOL-03**: All agent prompts include handoff examples in few-shot sections (good vs bad handoff content)
- [ ] **EVOL-04**: Agents guided to delegate subtasks to other agents via `create_task`
- [ ] **EVOL-05**: Agents guided to query related tasks via `list_tasks` and incorporate context
- [ ] **EVOL-06**: Prompt guidance: create a task when starting meaningful work, skip for quick single-turn interactions
- [ ] **EVOL-07**: Prompt guidance: call `get_task_context` when latest handoff references prior work
- [ ] **EVOL-08**: Prompts degrade gracefully when no task is available ("operate as before")

## Future Requirements

Deferred to post-v2.5 milestones. Tracked but not in current roadmap.

### Stale Task Cleanup
- **TASK-26**: Stale task cleanup: scheduled job flags inactive tasks via timeout signal (reuses existing pg-boss + wait_for timeout pattern). *Deferred: tasks won't go stale until system has been running for weeks. Operational polish, not core capability.*

### Evaluation and Monitoring
- **EVAL-01**: Prompt evaluation tooling (promptfoo, shadow mode)
- **EVAL-02**: Handoff quality evaluation (LLM-as-judge)
- **EVAL-03**: Correlation miss rate monitoring

### Advanced Task Features
- **ADV-01**: Agent → human task notification delivery (Slack DM, Linear assignment)
- **ADV-02**: Cross-agent task discovery
- **ADV-03**: Task analytics / cross-session learning
- **ADV-04**: Proactive task creation (agents identify work without event triggers)
- **ADV-05**: Many-to-many artifact correlation (relaxing PK constraint)
- **ADV-06**: Optimistic correlation / reconciliation job

### Integration Edge Cases
- **EDGE-01**: Slack thread forking correlation
- **EDGE-02**: GitHub force push correlation handling
- **EDGE-03**: Linear status noise filtering for reopening

### Dashboard
- **DASH-01**: Tasks list view (separate page)
- **DASH-02**: Task detail view (grouped conversations, handoffs, status)
- **DASH-03**: Conversation reopening history reset (handoff-only context mode for multi-reopen)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full prompt eval tooling | Building eval infrastructure is a milestone unto itself. Manual traceability matrix covers v2.5 rewrite. |
| Automatic task creation by framework | Agent-first principle. Agents decide when to create tasks. |
| Framework pattern-matching on handoff_type | Types are metadata for the agent, not framework behavior triggers. |
| Auto-completion on external signals | Agent decides when work is complete, not the framework. |
| Global orchestrator agent | Creates bottleneck and single point of failure. Stateless routing sufficient. |
| Worker agent prompt rewrites (coder, researcher, tester) | Workers just execute — they don't need the constitutional/few-shot overhaul. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMPT-01 | Phase 56 | Pending |
| PROMPT-02 | Phase 56 | Pending |
| PROMPT-03 | Phase 56 | Pending |
| PROMPT-04 | Phase 56 | Pending |
| PROMPT-05 | Phase 56 | Pending |
| PROMPT-06 | Phase 56 | Pending |
| REOPEN-01 | Phase 57 | Pending |
| REOPEN-02 | Phase 57 | Pending |
| REOPEN-03 | Phase 57 | Pending |
| REOPEN-04 | Phase 57 | Pending |
| REOPEN-05 | Phase 57 | Pending |
| REOPEN-06 | Phase 57 | Pending |
| REOPEN-07 | Phase 57 | Pending |
| REOPEN-08 | Phase 57 | Pending |
| REOPEN-09 | Phase 57 | Pending |
| REOPEN-10 | Phase 57 | Pending |
| REOPEN-11 | Phase 57 | Pending |
| TASK-01 | Phase 58.1 | Pending |
| TASK-02 | Phase 58.1 | Pending |
| TASK-03 | Phase 58.1 | Pending |
| TASK-04 | Phase 58.1 | Pending |
| TASK-05 | Phase 58.1 | Pending |
| TASK-06 | Phase 58.1 | Pending |
| TASK-07 | Phase 58.1 | Pending |
| TASK-08 | Phase 58.1 | Pending |
| TASK-09 | Phase 58.2 | Pending |
| TASK-10 | Phase 58.2 | Pending |
| TASK-11 | Phase 58.2 | Pending |
| TASK-12 | Phase 58.2 | Pending |
| TASK-13 | Phase 58.2 | Pending |
| TASK-14 | Phase 58.2 | Pending |
| TASK-15 | Phase 58.2 | Pending |
| TASK-16 | Phase 58.2 | Pending |
| TASK-17 | Phase 58.2 | Pending |
| TASK-18 | Phase 59 | Pending |
| TASK-19 | Phase 59 | Pending |
| TASK-20 | Phase 59 | Pending |
| TASK-21 | Phase 58.1 | Pending |
| TASK-22 | Phase 58.1 | Pending |
| TASK-23 | Phase 58.2 | Pending |
| TASK-24 | Phase 58.1 | Pending |
| TASK-25 | Phase 58.1 | Pending |
| TASK-27 | Phase 58.1 | Pending |
| CORR-01 | Phase 58.3 | Pending |
| CORR-02 | Phase 58.3 | Pending |
| CORR-03 | Phase 58.3 | Pending |
| CORR-04 | Phase 58.3 | Pending |
| CORR-05 | Phase 58.3 | Pending |
| CORR-06 | Phase 58.3 | Pending |
| CORR-07 | Phase 58.3 | Pending |
| CORR-08 | Phase 58.3 | Pending |
| CORR-09 | Phase 58.3 | Pending |
| CORR-10 | Phase 58.3 | Pending |
| CORR-11 | Phase 58.3 | Pending |
| ROUTE-01 | Phase 58.4 | Pending |
| ROUTE-02 | Phase 58.4 | Pending |
| ROUTE-03 | Phase 58.4 | Pending |
| ROUTE-04 | Phase 58.4 | Pending |
| ROUTE-05 | Phase 58.4 | Pending |
| ROUTE-06 | Phase 58.4 | Pending |
| EVOL-01 | Phase 59 | Pending |
| EVOL-02 | Phase 59 | Pending |
| EVOL-03 | Phase 59 | Pending |
| EVOL-04 | Phase 59 | Pending |
| EVOL-05 | Phase 59 | Pending |
| EVOL-06 | Phase 59 | Pending |
| EVOL-07 | Phase 59 | Pending |
| EVOL-08 | Phase 59 | Pending |

**Coverage:**
- v2.5 active requirements: 68 total
- Mapped to phases: 68
- Unmapped: 0
- Deferred: 1 (TASK-26)

---
*Requirements defined: 2026-02-06*
*Last updated: 2026-02-06 after roadmap restructuring*
