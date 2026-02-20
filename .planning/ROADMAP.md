# Roadmap: Aesir

## Milestones

- v1 MVP -- Phases 1-9 (shipped 2026-01-19)
- v2.0 Foundation -- Phases 10-22 (shipped 2026-01-25)
- v2.1 Agents That Ship -- Phases 23-27 (shipped 2026-01-28)
- v2.2 Agentic Architecture -- Phases 28-36 (shipped 2026-01-31)
- v2.3 Unified Agent Framework -- Phases 37-47 (shipped 2026-02-04)
- v2.4 Operations Dashboard -- Phases 48-55 (shipped 2026-02-05)
- v2.5 Agentic Conversations -- Phases 56-59 (shipped 2026-02-08)
- v2.6 Unified Agent Communication -- Phases 60-66 (shipped 2026-02-09)
- v2.7 Agent Collaboration -- Phases 67-73 (shipped 2026-02-13)
- v2.8 Resilience and Observability -- Phases 74-79 (shipped 2026-02-18)
- v2.9 Platform Completion -- Phases 80-87 (in progress)

## Completed Phases

<details>
<summary>v1 MVP (Phases 1-9) -- SHIPPED 2026-01-19</summary>

See `.planning/milestones/v1-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.0 Foundation (Phases 10-22) -- SHIPPED 2026-01-25</summary>

See `.planning/milestones/v2.0-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.1 Agents That Ship (Phases 23-27) -- SHIPPED 2026-01-28</summary>

See `.planning/milestones/v2.1-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.2 Agentic Architecture (Phases 28-36) -- SHIPPED 2026-01-31</summary>

See `.planning/milestones/v2.2-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.3 Unified Agent Framework (Phases 37-47) -- SHIPPED 2026-02-04</summary>

See `.planning/milestones/v2.3-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.4 Operations Dashboard (Phases 48-55) -- SHIPPED 2026-02-05</summary>

See `.planning/milestones/v2.4-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.5 Agentic Conversations (Phases 56-59) -- SHIPPED 2026-02-08</summary>

See `.planning/milestones/v2.5-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.6 Unified Agent Communication (Phases 60-66) -- SHIPPED 2026-02-09</summary>

See `.planning/milestones/v2.6-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.7 Agent Collaboration (Phases 67-73) -- SHIPPED 2026-02-13</summary>

See `.planning/milestones/v2.7-ROADMAP.md` for full details.

</details>

<details>
<summary>v2.8 Resilience and Observability (Phases 74-79) -- SHIPPED 2026-02-18</summary>

See `.planning/milestones/v2.8-ROADMAP.md` for full details.

</details>

## v2.9 Platform Completion (Phases 80-87)

**Milestone Goal:** Complete every collaboration capability agents need before v3.0 domain modeling -- richer negotiation, parallel delegation, transparent materialization, tree-level budgets, scheduled execution, sub-agent discovery, persistent identity, and knowledge retrieval enhancement.

**Build Waves:**
- Wave 1 (parallel): Phases 80, 82, 84, 85
- Wave 2: Phases 81, 86
- Wave 3: Phases 83, 87

### Phases

- [x] **Phase 80: Richer Negotiation** - Counter-proposals and mid-task clarification in the delegation handshake (gaps found) (completed 2026-02-20)
- [ ] **Phase 81: Parallel Delegation** - Fan-out delegation with configurable completion policies
- [ ] **Phase 82: Transparent Materialization** - Optional Linear ticket creation for delegated tasks
- [ ] **Phase 83: Tree-Level Token Budgets** - Budget enforcement across entire delegation trees
- [ ] **Phase 84: Scheduled Execution** - Cron-based agent triggers via pg-boss for periodic work
- [ ] **Phase 85: Sub-Agent Discovery** - Capability-based sub-agent selection replacing hardcoded YAML references
- [ ] **Phase 86: Persistent Agent Identity** - Structured, versioned identity documents per agent role with lifecycle hooks
- [ ] **Phase 87: Knowledge Retrieval Enhancement** - Pluggable retrieval pipeline and pre-compaction knowledge flush

### Phase Details

### Phase 80: Richer Negotiation
**Goal**: Agents negotiate delegation scope through counter-proposals and resolve ambiguity through mid-task clarification, replacing the binary accept/reject handshake
**Depends on**: Nothing (Wave 1)
**Requirements**: NEG-01, NEG-02, NEG-03, NEG-04, NEG-05, NEG-06, NEG-07
**Success Criteria** (what must be TRUE):
  1. Target agent can respond to a delegation with a modified scope/approach, and the delegator sees the modification and decides to accept, reject, or try someone else
  2. Target agent can send a clarification question back to the delegator mid-task, and the delegator's answer resumes the target's paused conversation
  3. Clarification can go back and forth multiple rounds within a single delegation, bounded by the task timeout
  4. Agents demonstrate judgment about when to counter-propose vs reject and when to clarify vs proceed with assumptions, guided by prompt updates
**Plans:** 5/5 plans complete
Plans:
- [x] 80-01-PLAN.md -- Counter-propose response type + foundation types + wait_for_task extension
- [x] 80-02-PLAN.md -- task:clarify and task:answer tool factories + wiring
- [x] 80-03-PLAN.md -- Agent definition updates + negotiation prompt guidance
- [x] 80-04-PLAN.md -- Dashboard representation of counter-proposals and clarifications
- [ ] 80-05-PLAN.md -- Gap closure: rejection signal context + counter-proposal reject action

### Phase 81: Parallel Delegation
**Goal**: Orchestrator agents can fan out work to multiple delegates simultaneously with policy-driven completion semantics
**Depends on**: Phase 80
**Requirements**: PAR-01, PAR-02, PAR-03, PAR-04, PAR-05, PAR-06, PAR-07
**Success Criteria** (what must be TRUE):
  1. An agent can create a group of delegations with a named completion policy (all_required, any_sufficient, or majority), and each delegation runs as an independent conversation
  2. The delegator is signaled when the group's completion policy is satisfied -- not on every individual task completion
  3. The delegator can query aggregated group status (complete/pending/failed counts) and cancel all remaining tasks in a group
  4. When an all_required group has a task failure, the delegator receives immediate notification and can decide how to proceed (wait, cancel remaining, or accept partial)
  5. The group data model accommodates future tree budget distribution without schema changes
**Plans:** 2/6 plans executed
Plans:
- [ ] 81-01-PLAN.md -- Database schema (task_groups table, group_id FK) and GroupService
- [ ] 81-02-PLAN.md -- delegate_group, group_status, cancel_group tools
- [ ] 81-03-PLAN.md -- Group policy evaluation in TaskSignalDispatcher + signal matching
- [ ] 81-04-PLAN.md -- wait_for_group tool + tool registration + worker loop wiring
- [ ] 81-05-PLAN.md -- Cancellation pattern (pending_cancellation + one-cleanup-turn)
- [ ] 81-06-PLAN.md -- Dashboard group node in delegation graph

### Phase 82: Transparent Materialization
**Goal**: Delegated tasks can optionally create corresponding Linear tickets, giving human operators visibility into agent-to-agent work through their existing tools
**Depends on**: Nothing (Wave 1)
**Requirements**: MAT-01, MAT-02, MAT-03, MAT-04, MAT-05, MAT-06
**Success Criteria** (what must be TRUE):
  1. An agent can delegate a task with `materialization: "transparent"`, which creates a corresponding Linear issue with description, priority, and agent assignee
  2. Task completion or failure updates the materialized Linear issue status, and Linear issue status changes sync back to the internal task
  3. Incoming webhooks from materialized Linear issues route correctly to the owning task via the correlation layer
  4. The materialization dispatch interface is extensible for future targets (GitHub issue, Slack thread) without changing the delegation tool
**Plans**: TBD

### Phase 83: Tree-Level Token Budgets
**Goal**: Token spending across an entire delegation tree is tracked and enforced as a single budget, preventing runaway costs from parallel or deep delegation chains
**Depends on**: Phase 81
**Requirements**: BUD-01, BUD-02, BUD-03, BUD-04, BUD-05, BUD-06
**Success Criteria** (what must be TRUE):
  1. A root task can set a total token budget for its delegation tree, and delegated tasks inherit a portion of the remaining budget (explicit allocation or equal-split default)
  2. Token usage is tracked atomically across all conversations in the tree, and an agent can query remaining tree budget via `task:tree_budget`
  3. When the tree budget approaches exhaustion, active conversations receive a warning signal; hard exhaustion stops all conversations in the tree
  4. The dashboard displays token usage per tree level, per conversation, and total within the task tree view
  5. Conversations without a tree budget continue using per-conversation budgets with no behavior change
**Plans**: TBD

### Phase 84: Scheduled Execution
**Goal**: Agents can run on a schedule for periodic work like backlog grooming or monitoring, breaking the purely reactive event-driven model
**Depends on**: Nothing (Wave 1)
**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04, SCH-05, SCH-06, SCH-07, SCH-08
**Success Criteria** (what must be TRUE):
  1. An agent definition can declare schedule triggers with cron expressions, validated at YAML load time, and the worker loop registers corresponding pg-boss scheduled jobs at startup
  2. When a schedule fires, a synthetic event creates a conversation for the target agent with context about the schedule (name, last run time, last run outcome)
  3. Overlap prevention works: if configured to `skip`, a new run is dropped when the previous is still active; if `queue`, it waits for completion then starts
  4. An operator can manually trigger a scheduled agent via API endpoint or dashboard button
  5. The dashboard shows active schedules, next run time, last run status, and run history
**Plans**: TBD

### Phase 85: Sub-Agent Discovery
**Goal**: Orchestrator agents select sub-agents by describing the capability they need, replacing hardcoded agent ID references in spawn calls
**Depends on**: Nothing (Wave 1)
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06, DISC-07
**Success Criteria** (what must be TRUE):
  1. Sub-agent definitions include capability descriptions that are embedded and stored in the entity directory with a `sub_agent` tier discriminator
  2. `coordination:spawn_agent` accepts a `capability` parameter that resolves to the best-matching sub-agent via semantic similarity, while hardcoded `agentType` still works as a fallback
  3. Orchestrator prompts describe the capability they need rather than naming specific agents, with prompt guidance teaching capability-based reasoning
  4. If no sub-agent matches the capability query above the similarity threshold, the agent receives an empty result and decides how to proceed
**Plans**: TBD

### Phase 86: Persistent Agent Identity
**Goal**: Agents accumulate understanding across conversations through structured identity documents, and the framework provides a lifecycle hook mechanism for injecting turns at conversation boundaries
**Depends on**: Nothing (Wave 2, but establishes lifecycle hooks needed by Phase 87)
**Requirements**: IDN-01, IDN-02, IDN-03, IDN-04, IDN-05, IDN-06, IDN-07, IDN-08, IDN-09
**Success Criteria** (what must be TRUE):
  1. Agents start every conversation with their accumulated identity documents (product brief, architectural model, domain knowledge, etc.) injected into the system prompt
  2. Agents can update their identity documents mid-conversation or at conversation end via `identity:update`, with every update creating a new version (full history retained)
  3. Identity documents have configurable token limits per type, and agents are prompted to summarize when approaching the limit
  4. The dashboard shows identity documents per agent with version history and side-by-side comparison of how understanding evolved
  5. If identity documents fail to load, the conversation starts without them (graceful degradation, not hard failure)
**Plans**: TBD

### Phase 87: Knowledge Retrieval Enhancement
**Goal**: The knowledge retrieval pipeline is pluggable for future strategies, and agents get a chance to persist important knowledge before history compaction discards it
**Depends on**: Phase 86 (uses lifecycle hook mechanism)
**Requirements**: KR-01, KR-02, KR-03, KR-04, KR-05, KR-06, KR-07, KR-08
**Success Criteria** (what must be TRUE):
  1. The retrieval pipeline uses a strategy abstraction (type contract with zero-overhead default path) where the current vector search is the default implementation, with no runtime dispatch overhead for the default case
  2. Agents can declare retrieval preferences in their definition.yaml (strategy selection, weights, feature flags), validated at load time via Zod, with agents without config using current vector-only behavior
  3. Before history compaction, agents receive a prompt to persist important knowledge via `store_knowledge`, with safeguards preventing double-flush and skipping agents without knowledge tools
  4. New retrieval strategies can be added by implementing the strategy interface and registering by name, without changing pipeline code
**Plans**: TBD

## Progress

**Execution Order:**
Wave 1 (parallel): 80, 82, 84, 85 -> Wave 2: 81, 86 -> Wave 3: 83, 87

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-9 | v1 MVP | 34 | Complete | 2026-01-19 |
| 10-22 | v2.0 Foundation | 104 | Complete | 2026-01-25 |
| 23-27 | v2.1 Agents That Ship | 46 | Complete | 2026-01-28 |
| 28-36 | v2.2 Agentic Architecture | 30 | Complete | 2026-01-31 |
| 37-47 | v2.3 Unified Agent Framework | 32 | Complete | 2026-02-04 |
| 48-55 | v2.4 Operations Dashboard | 22 | Complete | 2026-02-05 |
| 56-59 | v2.5 Agentic Conversations | 17 | Complete | 2026-02-08 |
| 60-66 | v2.6 Unified Agent Communication | 16 | Complete | 2026-02-09 |
| 67-73 | v2.7 Agent Collaboration | 26 | Complete | 2026-02-13 |
| 74-79 | v2.8 Resilience and Observability | 22 | Complete | 2026-02-18 |
| 80. Richer Negotiation | 5/5 | Complete    | 2026-02-20 | - |
| 81. Parallel Delegation | 2/6 | In Progress|  | - |
| 82. Transparent Materialization | v2.9 | 0/TBD | Not started | - |
| 83. Tree-Level Token Budgets | v2.9 | 0/TBD | Not started | - |
| 84. Scheduled Execution | v2.9 | 0/TBD | Not started | - |
| 85. Sub-Agent Discovery | v2.9 | 0/TBD | Not started | - |
| 86. Persistent Agent Identity | v2.9 | 0/TBD | Not started | - |
| 87. Knowledge Retrieval Enhancement | v2.9 | 0/TBD | Not started | - |

**Total: 10 milestones shipped (79 phases, 349 plans) + v2.9 in progress (8 phases)**

---

_Last updated: 2026-02-20 after v2.9 roadmap creation_
