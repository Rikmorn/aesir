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
- v2.8 Resilience and Observability -- Phases 74-78 (in progress)

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

## v2.8 Resilience and Observability (In Progress)

**Milestone Goal:** Stabilize the platform before domain modeling begins. Close gaps discovered during v2.7 live testing -- every failure visible and notified, the dashboard tells the complete story, agents know what work exists before starting their own.

## Phases

- [x] **Phase 74: Quick Fixes** - Address self-contained v2.7 E2E issues that clear noise before infrastructure work (completed 2026-02-16)
- [x] **Phase 75: Echo Elimination** - Suppress duplicate and agent-caused events at the infrastructure level before they reach the router (completed 2026-02-16)
- [x] **Phase 76: Runtime Resilience** - Close the loop between failure observation and recovery -- notify, classify, and adapt on every failure path (completed 2026-02-17)
- [ ] **Phase 77: Dashboard Observability** - Make the dashboard tell the full story of every conversation with lifecycle events, tool grouping, and sub-agent attribution
- [ ] **Phase 78: Work Correlation** - Give the platform a formal concept of "what work exists for entity X" with registry, tools, and disposition vocabulary

## Phase Details

### Phase 74: Quick Fixes
**Goal**: Known v2.7 E2E bugs are resolved and the test environment is clean for infrastructure work
**Depends on**: Nothing (first phase of v2.8)
**Requirements**: QF-01, QF-02, QF-03, QF-04
**Success Criteria** (what must be TRUE):
  1. Reopened conversations without tasks do not crash -- `get_task_context` returns null gracefully
  2. Dev-agent asks clarifying questions using `ask` + `wait_for` instead of `reply` (conversation pauses for user input)
  3. Test agents can spawn sub-agents without validation errors
  4. Test agents can use `communication:notify` without channel context failures
**Plans:** 3/3 plans complete
- [ ] 74-01-PLAN.md — Fix get_task_context graceful return and spawn_agent dynamic validation (QF-01, QF-03)
- [ ] 74-02-PLAN.md — Remove notify from test agents and add structural validation test (QF-04)
- [ ] 74-03-PLAN.md — Dev-agent prompt communication judgment criteria (QF-02)

### Phase 75: Echo Elimination
**Goal**: The platform rejects duplicate webhook deliveries and suppresses agent-caused events before they reach the router or agents
**Depends on**: Phase 74
**Requirements**: ECHO-01, ECHO-02, ECHO-03
**Success Criteria** (what must be TRUE):
  1. A webhook delivered twice (same event ID) is processed only once -- the second delivery is rejected at the adapter level
  2. Agent-caused webhooks (Linear app actions, GitHub bot commits, Slack bot messages) are detected and suppressed before reaching the router
  3. Suppressed events (both duplicate and echo) are logged with the suppression reason for debugging transparency
**Plans:** 3/3 plans complete
- [ ] 75-01-PLAN.md -- Foundation: dedup table migration, IncomingEvent actorInfo type, env config, webhook filter function (ECHO-01, ECHO-03)
- [ ] 75-02-PLAN.md -- Integration normalizers: thread actor data through Linear, GitHub, Slack normalizers (ECHO-02)
- [ ] 75-03-PLAN.md -- Wiring: adapter actorInfo extraction, router pipeline integration, pg-boss cleanup, bootstrap (ECHO-01, ECHO-02, ECHO-03)

### Phase 76: Runtime Resilience
**Goal**: When a conversation fails, the system notifies all channels, classifies MCP errors for agent decision-making, and injects recovery context on crash resume
**Depends on**: Phase 75 (echo elimination must be in place before failure notifications generate events that could echo back)
**Requirements**: RESIL-01, RESIL-02, RESIL-03, RESIL-04, RESIL-05, RESIL-06, RESIL-07, RESIL-08, RESIL-09, RESIL-10
**Success Criteria** (what must be TRUE):
  1. When a conversation reaches terminal `failed` status (any failure path -- retry-exhausted, non-retryable error, max iterations), a failure notification is delivered to the originating channel (Slack, Linear, or GitHub)
  2. When the failure notification itself fails to deliver, a `notification.failed` event is emitted and visible in the dashboard (dashboard is the backstop)
  3. Permanent MCP errors (4xx) return structured context to the agent immediately; transient MCP errors (429, 5xx) are retried transparently and the agent sees an error only when retries are exhausted
  4. When a conversation resumes after a crash, the agent receives a `<recovery_context>` block describing work completed since its last checkpoint (sub-agent completions, successful tool calls, received signals)
  5. Worker drains in-progress conversations on SIGTERM before exiting -- stops claiming new work and lets active conversations finish within a deadline
**Plans:** 3/3 plans complete

Plans:
- [ ] 76-01-PLAN.md -- MCP error classification + schema foundation (RESIL-04, RESIL-05, RESIL-06, RESIL-07)
- [ ] 76-02-PLAN.md -- Failure notifications at all failure paths + graceful shutdown drain (RESIL-01, RESIL-02, RESIL-03, RESIL-10)
- [ ] 76-03-PLAN.md -- Recovery context injection on crash resume (RESIL-08, RESIL-09)

### Phase 77: Dashboard Observability
**Goal**: The conversation timeline renders every lifecycle event, groups tool calls into expandable cards, and attributes sub-agent work visually
**Depends on**: Phase 76 (new event types from runtime resilience must exist before the dashboard can render them)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08
**Success Criteria** (what must be TRUE):
  1. Lifecycle events (started, paused, resumed, reopened, stale recovery, retry) render with distinct icons and colors in the conversation timeline -- visually distinguishable from tool call events
  2. Tool calls are grouped by `toolCallId` as expandable cards showing tool name, duration, and collapsible input/output
  3. Sub-agent work is visually attributed with agent name labels and indented/nested blocks -- the user can distinguish orchestrator work from sub-agent work at a glance
  4. MCP error events (`mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted`) render inside the associated tool card (correlated by `toolCallId`). `notification.failed` renders as a lifecycle banner with destructive styling.
  5. Conversation detail shows summary metrics: total tokens (input/output), wall-clock duration, tool call count/success rate, retry count
  6. Timeline filter chips allow filtering by category (Failures, Lifecycle, Tool calls, LLM) and by sub-agent name
**Plans:** 5 plans

Plans:
- [ ] 77-01-PLAN.md -- Agent-service event gaps: new event types, emission, MCP onMcpEvent wiring, SSE payload expansion (DASH-01, DASH-02, DASH-06)
- [ ] 77-02-PLAN.md -- Dashboard foundation: schema sync, SSE types, SseEvent interface, event icon/color extensions (DASH-03, DASH-05, DASH-07)
- [ ] 77-03-PLAN.md -- Tool call card component and event grouping pipeline (DASH-04, DASH-06)
- [ ] 77-04-PLAN.md -- Lifecycle banners, sub-agent pills, generic fallback renderer (DASH-03, DASH-05, DASH-07)
- [ ] 77-05-PLAN.md -- Filter chips, metrics bar, full EventTimeline + LiveDetailPanels integration (DASH-08)

### Phase 78: Work Correlation
**Goal**: The platform tracks which conversations are working on which external entities, enabling the router and agents to check existing work before starting duplicates
**Depends on**: Phase 74 (quick fixes clear noise; independent of Phases 76/77)
**Requirements**: CORR-01, CORR-02, CORR-03, CORR-04, CORR-05, CORR-06, CORR-07, CORR-08
**Success Criteria** (what must be TRUE):
  1. An agent can register that it is working on an external entity (Linear issue, GitHub PR, Slack thread) via `work:register`, and another agent or the router can query that correlation via `work:query`
  2. When an event arrives about an entity with active work and no trigger match, the router signals the correlated conversation as a fallback (instead of dropping or slow-pathing the event)
  3. Conversation status changes (completed, failed) automatically propagate to the correlation registry -- stale correlations do not persist
  4. The router and agents share a formal disposition vocabulary (new, signal, retry, supersede, duplicate) for reasoning about events with existing work
  5. Knowledge queries support metadata-based exact match mode alongside semantic search -- agents can query structured data (issue IDs, PR numbers) without relying on embedding similarity
**Plans**: TBD

## Progress

**Execution Order:**
Phases 74 through 78. Phase 78 is independent of 76/77 and can execute in parallel after Phase 74 completes.

```
74 (Quick Fixes) --> 75 (Echo Elimination) --> 76 (Runtime Resilience) --> 77 (Dashboard Observability)
74 (Quick Fixes) --> 78 (Work Correlation)  [parallel with 76/77]
```

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 74. Quick Fixes | 0/3 | Complete    | 2026-02-16 |
| 75. Echo Elimination | 0/3 | Complete    | 2026-02-16 |
| 76. Runtime Resilience | 0/3 | Complete    | 2026-02-17 |
| 77. Dashboard Observability | 0/5 | Not started | - |
| 78. Work Correlation | 0/TBD | Not started | - |

## Milestone Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v1 MVP | 1-9 | 34 | Complete | 2026-01-19 |
| v2.0 Foundation | 10-22 | 104 | Complete | 2026-01-25 |
| v2.1 Agents That Ship | 23-27 | 46 | Complete | 2026-01-28 |
| v2.2 Agentic Architecture | 28-36 | 30 | Complete | 2026-01-31 |
| v2.3 Unified Agent Framework | 37-47 | 32 | Complete | 2026-02-04 |
| v2.4 Operations Dashboard | 48-55 | 22 | Complete | 2026-02-05 |
| v2.5 Agentic Conversations | 56-59 | 17 | Complete | 2026-02-08 |
| v2.6 Unified Agent Communication | 60-66 | 16 | Complete | 2026-02-09 |
| v2.7 Agent Collaboration | 67-73 | 26 | Complete | 2026-02-13 |
| v2.8 Resilience and Observability | 74-78 | TBD | In progress | - |

**Total: 9 milestones shipped (73 phases, 327 plans) + v2.8 in progress (5 phases)**

---

_Last updated: 2026-02-16_
