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

- [x] **REOPEN-01**: Executor handles `reopen` signal on conversations in `completed` status
- [x] **REOPEN-02**: Executor handles `reopen` signal on conversations in `failed` status
- [x] **REOPEN-03**: Reopen signal transitions conversation back to `queued` with signal payload available
- [x] **REOPEN-04**: Reopened conversation receives full prior history plus signal context
- [x] **REOPEN-05**: World-state `<world_state>` context block injected when conversation is reopened (signal payload describes what changed)
- [x] **REOPEN-06**: Constitutional constraint added to reopened prompts: verify current state of artifacts before acting
- [x] **REOPEN-07**: Dashboard reopen/retry action available on conversation detail view
- [x] **REOPEN-08**: Agent service exposes POST /conversations/:id/reopen endpoint
- [x] **REOPEN-09**: `agent.reopened` event type added to event log
- [x] **REOPEN-10**: Other signal types on terminal conversations still ignored (only `reopen` triggers transition)
- [x] **REOPEN-11**: `delivered_signal_ids` capped at 100 entries to prevent unbounded growth

### Task Primitive

- [x] **TASK-01**: `agents.tasks` table created with id, parent_id, creator_type/id, assignee_type/id, status, title, objective, metadata, timestamps
- [x] **TASK-02**: `agents.task_handoffs` table created with id, task_id, conversation_id, handoff_type, context (JSONB), author_type/id, created_at
- [x] **TASK-03**: `task_id` nullable FK column added to `agents.conversations`
- [x] **TASK-04**: Task IDs use existing `createId` pattern (`task_<nanoid>`)
- [x] **TASK-05**: Handoff IDs use `createId` pattern (`ho_<nanoid>`)
- [x] **TASK-06**: Task status transitions enforced via tools (complete_task rejects cancelled tasks, etc.) with CHECK constraint for valid values
- [x] **TASK-07**: Handoff context enforced via Zod: `{ summary: string (required, max 2000 chars), key_decisions?, artifacts?, open_questions?, next_steps? }`, capped at ~4KB
- [x] **TASK-08**: `tasks.metadata` validated with Zod on write, 10KB size limit enforced at application layer
- [x] **TASK-09**: `create_task` agent tool implemented (with optional parent_id for subtasks)
- [x] **TASK-10**: `complete_task` agent tool implemented (marks task completed with structured completion handoff)
- [x] **TASK-11**: `pause_task` agent tool implemented (pauses task with structured pause handoff)
- [x] **TASK-12**: `handoff_task` agent tool implemented (writes delegation or escalation handoff)
- [x] **TASK-13**: `list_tasks` agent tool implemented (query by assignee, status, or metadata)
- [x] **TASK-14**: `get_task_context` agent tool implemented (retrieve handoffs and conversation history for a task)
- [x] **TASK-15**: 6 task tools registered in ToolRegistry under `task:` namespace
- [x] **TASK-16**: Task tools added to agent definition YAML files
- [x] **TASK-17**: Parent-child task hierarchy supported (parent_id FK)
- [x] **TASK-18**: Circular delegation prevented: `create_task` checks ancestry for same-assignee cycles
- [x] **TASK-19**: Max depth of 5 levels for parent_id chains enforced
- [x] **TASK-20**: Max 10 subtasks per parent task enforced
- [x] **TASK-21**: `ToolContext.taskId` renamed to `sandboxId` (existing sandbox container ID usage)
- [x] **TASK-22**: New `ToolContext.taskId` set from `conv.task_id` in worker loop
- [x] **TASK-23**: Task context auto-injected as `<task_context>` block in worker loop (most recent handoff, truncated at 4000 chars with pointer to `get_task_context`)
- [x] **TASK-24**: TaskService factory created with CRUD operations and validation
- [x] **TASK-25**: Backward compatibility: all code paths handle null task_id gracefully
- [x] **TASK-27**: Schema migration handles legacy `tasks` table in schema.drizzle.ts (check if empty, drop or rename)

### Integration Correlation

- [x] **CORR-01**: `linear.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [x] **CORR-02**: `github.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [x] **CORR-03**: `slack.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [x] **CORR-04**: `X-Task-ID` header added to MCP calls when conversation has a task
- [x] **CORR-05**: Linear integration records correlation on outgoing MCP tool calls (fire-and-forget)
- [x] **CORR-06**: GitHub integration records correlation on outgoing MCP tool calls (fire-and-forget)
- [x] **CORR-07**: Slack integration records correlation on outgoing MCP tool calls (thread_ts as external_ref)
- [x] **CORR-08**: Linear integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [x] **CORR-09**: GitHub integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [x] **CORR-10**: Slack integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [x] **CORR-11**: `IncomingEvent` schema extended with optional `taskId` field

*Note: CORR-01/02/03, CORR-05/06/07, and CORR-08/09/10 follow a 3x3 pattern (same requirement per integration). Built once, replicated three times.*

### Event Routing

- [x] **ROUTE-01**: Task-based routing priority: task reference → fast-path start → reasoning path
- [x] **ROUTE-02**: When task has active/waiting conversation: deliver event as signal (serialized)
- [x] **ROUTE-03**: When task has no active conversation: create new conversation in task with most recent handoff as context
- [x] **ROUTE-04**: Task-scoped conversations use correlationKey including task ID + triggering event ID
- [x] **ROUTE-05**: Task-level event serialization via PostgreSQL advisory locks (`pg_advisory_xact_lock`)
- [x] **ROUTE-06**: Backward compatibility: events without task reference route through existing fast-path/slow-path unchanged

### Prompt Evolution

- [x] **EVOL-01**: Product-agent prompt updated to leverage task lifecycle (create tasks for meaningful work)
- [x] **EVOL-02**: Dev-agent prompt updated to leverage task lifecycle (create tasks, write handoffs)
- [x] **EVOL-03**: All agent prompts include handoff examples in few-shot sections (good vs bad handoff content)
- [x] **EVOL-04**: Agents guided to delegate subtasks to other agents via `create_task`
- [x] **EVOL-05**: Agents guided to query related tasks via `list_tasks` and incorporate context
- [x] **EVOL-06**: Prompt guidance: create a task when starting meaningful work, skip for quick single-turn interactions
- [x] **EVOL-07**: Prompt guidance: call `get_task_context` when latest handoff references prior work
- [x] **EVOL-08**: Prompts degrade gracefully when no task is available ("operate as before")

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
| PROMPT-01 | Phase 56 | Complete |
| PROMPT-02 | Phase 56 | Complete |
| PROMPT-03 | Phase 56 | Complete |
| PROMPT-04 | Phase 56 | Complete |
| PROMPT-05 | Phase 56 | Complete |
| PROMPT-06 | Phase 56 | Complete |
| REOPEN-01 | Phase 57 | Complete |
| REOPEN-02 | Phase 57 | Complete |
| REOPEN-03 | Phase 57 | Complete |
| REOPEN-04 | Phase 57 | Complete |
| REOPEN-05 | Phase 57 | Complete |
| REOPEN-06 | Phase 57 | Complete |
| REOPEN-07 | Phase 57 | Complete |
| REOPEN-08 | Phase 57 | Complete |
| REOPEN-09 | Phase 57 | Complete |
| REOPEN-10 | Phase 57 | Complete |
| REOPEN-11 | Phase 57 | Complete |
| TASK-01 | Phase 58.1 | Complete |
| TASK-02 | Phase 58.1 | Complete |
| TASK-03 | Phase 58.1 | Complete |
| TASK-04 | Phase 58.1 | Complete |
| TASK-05 | Phase 58.1 | Complete |
| TASK-06 | Phase 58.1 | Complete |
| TASK-07 | Phase 58.1 | Complete |
| TASK-08 | Phase 58.1 | Complete |
| TASK-09 | Phase 58.2 | Complete |
| TASK-10 | Phase 58.2 | Complete |
| TASK-11 | Phase 58.2 | Complete |
| TASK-12 | Phase 58.2 | Complete |
| TASK-13 | Phase 58.2 | Complete |
| TASK-14 | Phase 58.2 | Complete |
| TASK-15 | Phase 58.2 | Complete |
| TASK-16 | Phase 58.2 | Complete |
| TASK-17 | Phase 58.2 | Complete |
| TASK-18 | Phase 59 | Complete |
| TASK-19 | Phase 59 | Complete |
| TASK-20 | Phase 59 | Complete |
| TASK-21 | Phase 58.1 | Complete |
| TASK-22 | Phase 58.1 | Complete |
| TASK-23 | Phase 58.2 | Complete |
| TASK-24 | Phase 58.1 | Complete |
| TASK-25 | Phase 58.1 | Complete |
| TASK-27 | Phase 58.1 | Complete |
| CORR-01 | Phase 58.3 | Complete |
| CORR-02 | Phase 58.3 | Complete |
| CORR-03 | Phase 58.3 | Complete |
| CORR-04 | Phase 58.3 | Complete |
| CORR-05 | Phase 58.3 | Complete |
| CORR-06 | Phase 58.3 | Complete |
| CORR-07 | Phase 58.3 | Complete |
| CORR-08 | Phase 58.3 | Complete |
| CORR-09 | Phase 58.3 | Complete |
| CORR-10 | Phase 58.3 | Complete |
| CORR-11 | Phase 58.3 | Complete |
| ROUTE-01 | Phase 58.4 | Complete |
| ROUTE-02 | Phase 58.4 | Complete |
| ROUTE-03 | Phase 58.4 | Complete |
| ROUTE-04 | Phase 58.4 | Complete |
| ROUTE-05 | Phase 58.4 | Complete |
| ROUTE-06 | Phase 58.4 | Complete |
| EVOL-01 | Phase 59 | Complete |
| EVOL-02 | Phase 59 | Complete |
| EVOL-03 | Phase 59 | Complete |
| EVOL-04 | Phase 59 | Complete |
| EVOL-05 | Phase 59 | Complete |
| EVOL-06 | Phase 59 | Complete |
| EVOL-07 | Phase 59 | Complete |
| EVOL-08 | Phase 59 | Complete |

**Coverage:**
- v2.5 active requirements: 68 total
- Mapped to phases: 68
- Unmapped: 0
- Deferred: 1 (TASK-26)

---
*Requirements defined: 2026-02-06*
*Last updated: 2026-02-08 after Phase 59 completion (all v2.5 requirements complete)*
