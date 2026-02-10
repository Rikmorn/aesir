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
- v2.7 Agent Collaboration -- Phases 67-73 (in progress)

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

## v2.7 Agent Collaboration (In Progress)

**Milestone Goal:** Multi-agent collaboration -- agents delegate work to each other through tasks, backed by shared memory, an entity directory, and first-class Linear agent identity.

### Phases

- [x] **Phase 67: Linear Agent SDK** - Agents operate as first-class Linear workspace entities with typed activities (completed 2026-02-10)
- [x] **Phase 68: Shared Memory** - Agents store and retrieve shared knowledge with semantic search (completed 2026-02-10)
- [x] **Phase 69: Entity Directory** - Agents discover each other by capability for informed delegation decisions (completed 2026-02-10)
- [x] **Phase 70: Task Delegation** - Agents delegate work to other agents through tasks with negotiation handshake (completed 2026-02-10)
- [x] **Phase 71: Completion Signaling** - Delegating agents receive reliable notification when delegated work completes or fails (completed 2026-02-10)
- [ ] **Phase 72: Delegation Graph Observability** - Operators see delegation hierarchies, signal flows, and health indicators in the dashboard
- [ ] **Phase 73: QA Agent + Validation Workflow** - Triangular product-dev-QA workflow validates the entire collaboration system end-to-end

### Phase Details

#### Phase 67: Linear Agent SDK
**Goal**: Agents operate as first-class Linear workspace entities with typed activities, eliminating echo filtering and enabling native agent UX
**Depends on**: Nothing (parallel with Phase 68)
**Requirements**: LSDK-01, LSDK-02, LSDK-03, LSDK-04, LSDK-05, LSDK-06, LSDK-07, LSDK-08, LSDK-09
**Success Criteria** (what must be TRUE):
  1. Agent authenticates as `actor=app` and appears as a workspace entity in Linear (not impersonating a user)
  2. Agent communication appears as typed activities (thought, elicitation, response) in the Linear issue sidebar, not as plain comments
  3. Linear OAuth tokens refresh automatically before expiry and retry transparently on 401 without agent loop disruption
  4. Agent session creation triggers a synchronous thought activity within 10 seconds (before conversation is queued)
  5. Echo filtering by `LINEAR_BOT_USER_ID` is removed -- agent activities and user prompts are structurally distinct and never re-enter the inbound pipeline
**Plans**: 5 plans

Plans:
- [x] 67-01-PLAN.md -- Token refresh middleware (proactive at 80% lifetime, reactive 401 retry, mutex, Slack alerting)
- [x] 67-02-PLAN.md -- OAuth actor=app migration and agent activity MCP tools (create_agent_activity, update_session_state)
- [x] 67-03-PLAN.md -- Session ID tracking through adapter/replyContext/denormalizer, intent-to-activity mapping, 10s acknowledgment thought
- [x] 67-04-PLAN.md -- Echo filter removal, error activity emission on conversation failure, dev-agent prompt updates
- [x] 67-05-PLAN.md -- Gap closure: resume and completion activity emissions for session lifecycle completeness

#### Phase 68: Shared Memory
**Goal**: Agents store and retrieve classified knowledge with semantic search, enabling collaboration efficiency through shared context
**Depends on**: Nothing (parallel with Phase 67)
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, MEM-07, MEM-08
**Success Criteria** (what must be TRUE):
  1. An agent can store a knowledge entry with classification (discovery, constraint, architecture_decision, thought, preference, test_result) and retrieve it via semantic search from a different conversation
  2. Private notepad entries (scope=private) are invisible to other agents; shared entries are visible to all
  3. Knowledge entries expire automatically by category (discoveries 24h, architecture_decisions 7d, constraints 30d) and deduplication prevents redundant entries on the same topic
  4. `knowledge:query` returns empty results on connection failure and never crashes the agent loop
**Plans**: 4 plans

Plans:
- [x] 68-01-PLAN.md -- Schema (knowledge_entries table, pgvector extension, HNSW indexes), env config, Docker image swap
- [x] 68-02-PLAN.md -- Embedding pipeline (EmbeddingService interface, Ollama + Voyage AI providers, factory)
- [x] 68-03-PLAN.md -- KnowledgeService factory + knowledge:store and knowledge:query tools + framework registration
- [x] 68-04-PLAN.md -- knowledge:update tool (supersede/invalidate) + background expiry cleanup via pg-boss

#### Phase 69: Entity Directory
**Goal**: Agents discover each other by capability, enabling dynamic delegation decisions instead of hardcoded routing
**Depends on**: Phase 67 + Phase 68 (agent identity resolved, pgvector pipeline available)
**Requirements**: DIR-01, DIR-02, DIR-03, DIR-04, DIR-05, DIR-06
**Success Criteria** (what must be TRUE):
  1. All agent definitions are seeded into the entity directory at deploy time with capabilities extracted from a new `capabilities` field in definition.yaml
  2. An agent can call `directory:find` with a capability description and receive matching agents ranked by relevance
  3. Seed script is idempotent -- re-running updates existing entries without duplicating them
  4. `directory:find` returns empty results on failure; agents fall back to self-execution without crashing
**Plans**: 3 plans

Plans:
- [x] 69-01-PLAN.md -- Schema foundation (entity_directory table, migration, YAML capabilities field, AgentRegistry loading)
- [x] 69-02-PLAN.md -- DirectoryService factory, directory:find and directory:get tools, tool registration, main.ts wiring
- [x] 69-03-PLAN.md -- Agent definition capabilities, seed script (idempotent upsert with change detection), package.json entry

#### Phase 70: Task Delegation
**Goal**: Agents delegate work to other agents through tasks with a negotiation handshake, creating cross-conversation collaboration
**Depends on**: Phase 69
**Requirements**: DEL-01, DEL-02, DEL-03, DEL-04, DEL-05, DEL-06, DEL-07
**Success Criteria** (what must be TRUE):
  1. An agent can call `task:delegate` targeting a directory entity, which creates a task and starts a conversation for the target agent via executor.start()
  2. The target agent receives a focused brief (task description, expectations, knowledge references) -- not the delegator's full message history
  3. The target agent responds with accept (with optional estimate) or reject (with reason) via `task:respond`, and the delegator is notified of the outcome
  4. Delegation depth is enforced at MAX_DEPTH=3; attempts to delegate deeper are rejected with a clear error
  5. Agent prompts distinguish sub-agent spawn (within conversation, shared budget) from cross-conversation delegation (different agent capabilities)
**Plans**: 3 plans

Plans:
- [x] 70-01-PLAN.md -- Schema migration (depth column), DelegationDeps type, task:delegate tool, seconds timeout support, worker-loop injection
- [x] 70-02-PLAN.md -- task:respond tool (handshake accept/reject signal), main.ts DelegationDeps wiring
- [x] 70-03-PLAN.md -- Delegation tools added to orchestrator definitions, delegation judgment guidance in prompts

#### Phase 71: Completion Signaling
**Goal**: Delegating agents receive reliable notification when delegated work completes or fails, with orphan handling and context preservation
**Depends on**: Phase 70
**Requirements**: SIG-01, SIG-02, SIG-03, SIG-04, SIG-05, SIG-06, SIG-07
**Success Criteria** (what must be TRUE):
  1. When a delegated task reaches terminal state (completed/failed), the delegating agent's conversation is automatically signaled with the result
  2. `wait_for` accepts multiple signal types; `wait_for_task` auto-registers for all task-lifecycle signals (completion, failure, timeout) so agents cannot forget to listen
  3. When the callback conversation is terminal, the completion result is stored on the task (`completion_result` JSONB) and a `signal.orphaned` event is logged -- work product is never silently lost
  4. Callback routing resolves through tasks (latest active conversation for parent task), surviving conversation re-triggers
  5. Delegation context (active_delegations JSONB, signal payloads with original task description and results) survives history compaction
**Plans**: 3 plans

Plans:
- [x] 71-01-PLAN.md -- Schema migration (completion_result, active_delegations), multi-type wait_for, signal matching helper, wait_for_task tool
- [x] 71-02-PLAN.md -- TaskSignalDispatcher (signal dispatch on terminal task transitions), orphan handling (completion_result, signal.orphaned), callback routing through tasks
- [x] 71-03-PLAN.md -- active_delegations lifecycle (write on delegate, inject on resume, remove after processing)

#### Phase 72: Delegation Graph Observability
**Goal**: Operators see delegation hierarchies, signal flows, and health indicators in the dashboard for debugging and monitoring multi-agent workflows
**Depends on**: Phase 71
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06
**Success Criteria** (what must be TRUE):
  1. A task tree API endpoint returns the full delegation hierarchy with status, entity assignments, and timestamps for any root task
  2. The dashboard renders a delegation graph with expandable nodes, status indicators, and click-through to conversation detail pages
  3. A delegation timeline shows chronological events (delegation, handshake, signals) filterable by task tree
  4. Health indicators surface orphaned completions, excessive delegation depth, rejection chains, and timeout patterns
**Plans**: ~3 plans

Plans:
- [ ] 72-01: Task tree API endpoint (recursive CTE with depth limit, timeline, and signal flow data)
- [ ] 72-02: Dashboard task tree view (React Flow + dagre layout, expandable nodes, status indicators, cross-conversation links)
- [ ] 72-03: Signal flow visualization, delegation timeline, and health indicator components

#### Phase 73: QA Agent + Validation Workflow
**Goal**: A QA agent validates the triangular product-dev-QA workflow, exercising every collaboration primitive simultaneously as the integration test for the entire milestone
**Depends on**: Phase 72
**Requirements**: QA-01, QA-02, QA-03, QA-04, QA-05, QA-06
**Success Criteria** (what must be TRUE):
  1. QA agent is defined as YAML + prompt.md with capabilities registered in the entity directory, and has thin tool wrappers for running tests and reviewing PR diffs
  2. The triangular workflow executes: product delegates to dev, dev implements, dev delegates verification to QA, QA validates -- with failure triggering fix delegation back to dev
  3. The workflow exercises 3-level delegation depth, completion signaling cascade, and shared memory across the delegation chain
  4. One happy-path end-to-end integration test validates the full triangular workflow against running services
**Plans**: ~3 plans

Plans:
- [ ] 73-01: QA agent definition (YAML + prompt.md, capabilities, knowledge + directory tools) and thin tool wrappers (sandbox test runner, GitHub PR diff reviewer)
- [ ] 73-02: Triangular workflow wiring (product->dev->QA delegation chain, failure->fix loop, completion cascade)
- [ ] 73-03: End-to-end integration test (happy-path triangular workflow against running services)

## Progress

**Execution Order:**
Phases 67+68 execute in parallel, then 69 -> 70 -> 71 -> 72 -> 73 sequentially.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-9 | v1 | 34 | Complete | 2026-01-19 |
| 10-22 | v2.0 | 104 | Complete | 2026-01-25 |
| 23-27 | v2.1 | 46 | Complete | 2026-01-28 |
| 28-36 | v2.2 | 30 | Complete | 2026-01-31 |
| 37-47 | v2.3 | 32 | Complete | 2026-02-04 |
| 48-55 | v2.4 | 22 | Complete | 2026-02-05 |
| 56-59 | v2.5 | 17 | Complete | 2026-02-08 |
| 60-66 | v2.6 | 16 | Complete | 2026-02-09 |
| 67. Linear Agent SDK | v2.7 | 5/5 | Complete | 2026-02-10 |
| 68. Shared Memory | v2.7 | 4/4 | Complete | 2026-02-10 |
| 69. Entity Directory | v2.7 | 3/3 | Complete | 2026-02-10 |
| 70. Task Delegation | v2.7 | 3/3 | Complete | 2026-02-10 |
| 71. Completion Signaling | v2.7 | 3/3 | Complete | 2026-02-10 |
| 72. Delegation Graph Observability | v2.7 | 0/~3 | Not started | - |
| 73. QA Agent + Validation | v2.7 | 0/~3 | Not started | - |

**Total: 8 milestones shipped (69 phases, 301 plans) + v2.7 in progress (5/7 phases complete, 18/~24 plans)**

---

_Last updated: 2026-02-10_
