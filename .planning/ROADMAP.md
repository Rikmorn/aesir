# Roadmap: Aesir v2.5 Agentic Conversations

## Overview

v2.5 gives agents continuity across interactions. Five delivery boundaries: rewrite orchestrator prompts from procedural state machines to constitutional + few-shot style (Phase 56), enable completed/failed conversations to reopen on follow-up events (Phase 57), introduce the task primitive as a first-class coordination entity with schema, service, and tools (Phase 58.1-58.2), wire integration correlation and task-aware event routing (Phase 58.3-58.4), then evolve all agent prompts to leverage the task lifecycle with hierarchy enforcement (Phase 59). Phases 56 and 57 are independent and can execute in parallel; Phase 58 sub-phases are sequential; Phase 59 depends on both 56 and 58.2.

## Milestones

- v1.0 MVP -- Phases 1-9 (shipped 2026-01-19)
- v2.0 Foundation -- Phases 10-22 (shipped 2026-01-25)
- v2.1 Agents That Ship -- Phases 23-27 (shipped 2026-01-28)
- v2.2 Agentic Architecture -- Phases 28-36 (shipped 2026-01-31)
- v2.3 Unified Agent Framework -- Phases 37-47.1 (shipped 2026-02-04)
- v2.4 Operations Dashboard -- Phases 48-55 (shipped 2026-02-05)
- v2.5 Agentic Conversations -- Phases 56-59 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (56, 57, 59): Planned milestone work
- Decimal phases (58.1, 58.2, 58.3, 58.4): Task primitive sub-phases (sequential)

Decimal phases execute between their surrounding integers in numeric order.

- [x] **Phase 56: Goal-Oriented Prompt Rewrites** - Rewrite product-agent and dev-agent prompts to constitutional + few-shot style
- [x] **Phase 57: Conversation Reopening** - Enable completed/failed conversations to receive reopen signals and resume
- [x] **Phase 58.1: Task Schema and Service** - Task/handoff data model, TaskService, ToolContext rename, migration
- [ ] **Phase 58.2: Agent Task Tools** - Six task tools, registration, YAML wiring, context injection
- [ ] **Phase 58.3: Integration Correlation** - Correlation tables per integration, MCP header, outgoing recording, incoming lookup
- [ ] **Phase 58.4: Task-Aware Event Routing** - Task-based routing priority, advisory lock serialization, backward compatibility
- [ ] **Phase 59: Prompt Evolution and Hierarchy Enforcement** - Update all agent prompts to leverage task lifecycle, add hierarchy guardrails (depth, subtask limits, circular delegation prevention)

## Phase Details

### Phase 56: Goal-Oriented Prompt Rewrites
**Goal**: Agents reason about goals and constraints instead of following procedural state machines, producing more adaptive behavior across novel situations
**Depends on**: Nothing (independent, can run in parallel with Phase 57)
**Requirements**: PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04, PROMPT-05, PROMPT-06
**Success Criteria** (what must be TRUE):
  1. Product-agent prompt contains no if/then branching trees or prescriptive tool sequences -- only identity, constitutional constraints, few-shot examples, and context sections
  2. Dev-agent prompt contains no complexity classification rules or fixed workflows -- only goal-oriented identity with judgment criteria
  3. Each agent has 3-5 few-shot examples showing input-reasoning-action patterns, with at least one example resolving a constraint tension
  4. A traceability matrix exists per agent mapping every removed procedural rule to the new constraint or example that covers the same failure mode
  5. Both prompts include selective chain-of-thought guidance (reasoning blocks before significant decisions) and explicit constraint priority ordering (safety > correctness > efficiency)
**Plans:** 2 plans
Plans:
- [ ] 56-01-PLAN.md -- Product-agent traceability matrix and prompt rewrite
- [ ] 56-02-PLAN.md -- Dev-agent traceability matrix and prompt rewrite

### Phase 57: Conversation Reopening
**Goal**: Completed or failed conversations can receive follow-up events and re-enter the work loop with awareness of what changed since they last ran
**Depends on**: Nothing (independent, can run in parallel with Phase 56)
**Requirements**: REOPEN-01, REOPEN-02, REOPEN-03, REOPEN-04, REOPEN-05, REOPEN-06, REOPEN-07, REOPEN-08, REOPEN-09, REOPEN-10, REOPEN-11
**Success Criteria** (what must be TRUE):
  1. Sending a reopen signal to a completed or failed conversation transitions it back to queued, and the agent resumes with full prior history plus the signal payload describing what changed
  2. A world-state context block is injected when a conversation is reopened, and the agent's prompt includes a constitutional constraint to verify artifact state before acting
  3. The dashboard shows a reopen/retry button on completed and failed conversation detail views, and clicking it triggers POST /conversations/:id/reopen
  4. Non-reopen signal types on terminal conversations are still ignored -- only the reopen signal triggers the transition
  5. The delivered_signal_ids array is capped at 100 entries to prevent unbounded growth
**Plans:** 2 plans
Plans:
- [x] 57-01-PLAN.md -- Backend: schema migration, executor reopen method, API endpoint, session projection, prompt constraints
- [x] 57-02-PLAN.md -- Dashboard: API proxy, reopen dialog, action bar, metadata sidebar, event icon, list columns

### Phase 58.1: Task Schema and Service
**Goal**: The task and handoff data model exists in PostgreSQL with a validated service layer, enabling the tool and routing layers to be built on top
**Depends on**: Nothing (foundation for 58.2, 58.3, 58.4)
**Requirements**: TASK-01, TASK-02, TASK-03, TASK-04, TASK-05, TASK-06, TASK-07, TASK-08, TASK-21, TASK-22, TASK-24, TASK-25, TASK-27
**Success Criteria** (what must be TRUE):
  1. The agents.tasks and agents.task_handoffs tables exist with proper indexes, and conversations.task_id is a nullable FK to tasks -- verified by running the migration against a database with the legacy tasks table present
  2. TaskService provides CRUD operations with Zod-validated inputs: task status transitions are enforced via tools (CHECK constraint for valid values, tools reject invalid transitions), handoff context requires a summary field (max 2000 chars, ~4KB total), and metadata is capped at 10KB
  3. ToolContext.taskId has been renamed to sandboxId across all codebase tool factories, and a new ToolContext.taskId field is set from conv.task_id in the worker loop
  4. All existing code paths handle null task_id gracefully -- conversations without tasks continue to work unchanged
**Plans:** 2 plans
Plans:
- [x] 58.1-01-PLAN.md -- Rename ToolContext.taskId to sandboxId across agents package
- [x] 58.1-02-PLAN.md -- Migration, Drizzle schemas, createId, TaskService, ToolContext.taskId wiring

### Phase 58.2: Agent Task Tools
**Goal**: Agents can create, manage, and query tasks through six tools with structured context delivery
**Depends on**: Phase 58.1 (TaskService and schema must exist)
**Requirements**: TASK-09, TASK-10, TASK-11, TASK-12, TASK-13, TASK-14, TASK-15, TASK-16, TASK-17, TASK-23
**Success Criteria** (what must be TRUE):
  1. An agent can call create_task, complete_task, pause_task, handoff_task, list_tasks, and get_task_context -- all six tools registered under the task: namespace and added to agent definition YAML files
  2. create_task supports optional parent_id for subtask creation (parent-child hierarchy via FK)
  3. When a conversation has a task_id, the worker loop auto-injects a task_context block containing the most recent handoff (truncated at 4000 chars with a pointer to get_task_context for full history)
**Plans:** 3 plans
Plans:
- [ ] 58.2-01-PLAN.md -- TaskService extensions, shared types, six tool factory implementations
- [ ] 58.2-02-PLAN.md -- Tool registration in ToolRegistry, TaskService bootstrap, YAML definition updates
- [ ] 58.2-03-PLAN.md -- Task context auto-injection in worker loop

### Phase 58.3: Integration Correlation
**Goal**: External artifacts (issues, PRs, threads) are automatically correlated to tasks via outgoing MCP recording and incoming webhook lookup
**Depends on**: Phase 58.2 (task tools must exist for agents to create tasks that get correlated)
**Requirements**: CORR-01, CORR-02, CORR-03, CORR-04, CORR-05, CORR-06, CORR-07, CORR-08, CORR-09, CORR-10, CORR-11
**Success Criteria** (what must be TRUE):
  1. Each integration (Linear, GitHub, Slack) has a task_correlations table with PK on (external_type, external_ref)
  2. X-Task-ID header is added to MCP calls when the conversation has a task, and each integration records the correlation on outgoing tool calls (fire-and-forget)
  3. Each integration performs correlation lookup on incoming webhooks and attaches task_id to the event before forwarding
  4. The IncomingEvent schema includes an optional taskId field
**Plans**: TBD

### Phase 58.4: Task-Aware Event Routing
**Goal**: Incoming events with a task reference route to the correct task's conversation with serialization guarantees
**Depends on**: Phase 58.3 (correlation must exist to attach task references to events), Phase 57 (reopening pattern used when task has no active conversation)
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06
**Success Criteria** (what must be TRUE):
  1. Events with a task reference route to the task's active/waiting conversation as a signal, or create a new conversation within the task with the most recent handoff as context if no active conversation exists
  2. Task-level event serialization via PostgreSQL advisory locks prevents concurrent events from creating duplicate conversations for the same task
  3. Task-scoped conversations use a correlationKey that includes both the task ID and triggering event ID
  4. Events without a task reference continue to route through the existing fast-path/slow-path unchanged -- zero regression for non-task workflows
**Plans**: TBD

### Phase 59: Prompt Evolution and Hierarchy Enforcement
**Goal**: Agents naturally think in terms of tasks, write high-quality handoffs, delegate via subtasks with guardrails, enabling multi-conversation continuity without framework-imposed structure
**Depends on**: Phase 56 (constitutional + few-shot style established), Phase 58.2 (task tools available)
**Requirements**: EVOL-01, EVOL-02, EVOL-03, EVOL-04, EVOL-05, EVOL-06, EVOL-07, EVOL-08, TASK-18, TASK-19, TASK-20
**Success Criteria** (what must be TRUE):
  1. Product-agent and dev-agent prompts include guidance to create a task when starting meaningful work and to skip task creation for quick single-turn interactions
  2. All agent prompts include handoff examples in their few-shot sections showing good vs bad handoff content, and agents are guided to delegate subtasks via create_task and query related work via list_tasks
  3. Agents call get_task_context when the latest handoff references prior work, and prompts degrade gracefully when no task is available ("operate as before")
  4. create_task enforces hierarchy guardrails: max 5 levels of parent_id depth, max 10 subtasks per parent, and circular delegation is rejected when the same assignee appears in the ancestry chain
**Plans**: TBD

## Progress

**Execution Order:**
Phases 56 and 57 can execute in parallel. Then 58.1 -> 58.2 -> 58.3 -> 58.4 sequentially. Then 59.
Full order: 56 + 57 (parallel) -> 58.1 -> 58.2 -> 58.3 -> 58.4 -> 59

**Dependency Graph:**
```
Phase 56 (Prompts) ──────────────────────────────────────────────────────┐
                                                                          ├──> Phase 59 (Prompt Evolution + Hierarchy)
Phase 57 (Reopening) ──> Phase 58.1 ──> 58.2 ──> 58.3 ──> 58.4 ────────┘
```

| Phase | Milestone | Reqs | Plans Complete | Status | Completed |
|-------|-----------|:----:|----------------|--------|-----------|
| 56. Prompt Rewrites | v2.5 | 6 | 2/2 | Complete | 2026-02-06 |
| 57. Conversation Reopening | v2.5 | 11 | 2/2 | Complete | 2026-02-06 |
| 58.1 Task Schema and Service | v2.5 | 13 | 2/2 | Complete | 2026-02-06 |
| 58.2 Agent Task Tools | v2.5 | 10 | 0/3 | Not started | - |
| 58.3 Integration Correlation | v2.5 | 11 | 0/TBD | Not started | - |
| 58.4 Task-Aware Event Routing | v2.5 | 6 | 0/TBD | Not started | - |
| 59. Prompt Evolution + Hierarchy | v2.5 | 11 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-06*
*Last updated: 2026-02-07 after Phase 58.2 planning complete*
