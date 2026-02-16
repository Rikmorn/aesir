# Requirements: Aesir v2.8 Resilience and Observability

**Defined:** 2026-02-16
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## v2.8 Requirements

Requirements for v2.8 milestone. Each maps to roadmap phases.

### Quick Fixes

- [ ] **QF-01**: `get_task_context` returns null gracefully on reopened conversations without tasks (ISS-003)
- [ ] **QF-02**: Dev-agent uses `ask` + `wait_for` for questions instead of `reply` (ISS-007)
- [ ] **QF-03**: `spawn_agent` works for test agents — fix validation mismatch vs production sub-agents (ISS-022)
- [ ] **QF-04**: `communication:notify` works for test agents — either remove tool from test agents or add default broadcast channel config (ISS-023)

### Echo Elimination

- [ ] **ECHO-01**: Duplicate webhook deliveries rejected at adapter level via event ID dedup table (implementation note: 24h TTL cleanup via pg-boss scheduled job)
- [ ] **ECHO-02**: Agent-caused webhooks suppressed via per-integration actor detection — Linear (`actor.type`), GitHub (`sender.type`/`sender.login`), Slack (`bot_id`/`app_id`)
- [ ] **ECHO-03**: Suppressed events logged for debugging transparency (not forwarded to router)

### Runtime Resilience

- [ ] **RESIL-01**: All channels (Slack, Linear, GitHub) receive failure notification when a conversation reaches terminal `failed` status (ISS-001)
- [ ] **RESIL-02**: All failure paths trigger notification — retry-exhausted, non-retryable errors, max iterations (ISS-001)
- [ ] **RESIL-03**: `notification.failed` event emitted when the failure notification itself fails — dashboard is the visibility backstop (ISS-001)
- [ ] **RESIL-04**: MCP errors classified as permanent (400, 401, 403, 404, 422) vs transient (429, 5xx) at the MCP client level (ISS-009)
- [ ] **RESIL-05**: Permanent MCP errors return structured context to agent — status code, error message, what was attempted (ISS-009)
- [ ] **RESIL-06**: Transient MCP errors retried transparently with backoff; agent sees error only when retries are exhausted (ISS-009)
- [ ] **RESIL-07**: MCP observability events emitted — `mcp.error` (permanent), `mcp.rate_limited` (429), `mcp.retries_exhausted` (transient exhaustion) (ISS-009)
- [ ] **RESIL-08**: Recovery context injected on crash resume — query event log for work completed after last persistence point, format as `<recovery_context>` XML block (ISS-006)
- [ ] **RESIL-09**: Retry count and recovery status included in recovery context for agent decision-making (ISS-006)
- [ ] **RESIL-10**: Worker drains in-progress conversations on SIGTERM before exit — stop claiming new work, let active conversations finish (with deadline), then exit cleanly

### Dashboard Observability

- [ ] **DASH-01**: `agent.stale_recovered` event emitted on stale heartbeat recovery with worker ID, stale duration, and retry count
- [ ] **DASH-02**: `agent.retry_scheduled` event emitted on retry decisions with error context and retry count
- [ ] **DASH-03**: Lifecycle events (started, paused, resumed, reopened, stale recovery, retry) render with distinct icons and colors in timeline
- [ ] **DASH-04**: Tool calls grouped by `toolCallId` as expandable cards showing tool name, duration, input (collapsed), output (collapsed)
- [ ] **DASH-05**: Sub-agent work visually attributed with agent name labels and indented/nested blocks using existing `parent_instance_id`
- [ ] **DASH-06**: MCP error events (`mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted`) rendered in timeline
- [ ] **DASH-07**: `notification.failed` event rendered prominently in timeline
- [ ] **DASH-08**: Conversation detail shows summary metrics — total tokens, cost estimate, wall-clock duration, tool call count/success rate, retry count

### Work Correlation

- [ ] **CORR-01**: Entity reference `{entity_type, entity_id}` standardized on IncomingEvent — Linear `('linear_issue', issueId)`, GitHub `('github_pr', 'owner/repo#number')`, Slack `('slack_thread', 'channelId:threadTs')`
- [ ] **CORR-02**: `work_correlations` table with composite key `(entity_type, entity_id, conversation_id)` linking external entities to active conversations
- [ ] **CORR-03**: `work:register` tool allows agents to register that they are working on an external entity
- [ ] **CORR-04**: `work:query` tool allows agents and router to check existing work for an entity before starting new work
- [ ] **CORR-05**: Conversation status changes (completed, failed) propagate to correlation registry automatically
- [ ] **CORR-06**: Router uses correlation lookup as fallback for events with no trigger match — active work found signals that conversation
- [ ] **CORR-07**: Disposition vocabulary (new, signal, retry, supersede, duplicate) formalized for routing and agent decision-making
- [ ] **CORR-08**: Knowledge query supports metadata-based exact match mode alongside semantic search — `mode: 'semantic' | 'exact' | 'combined'`

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Deferred to v2.9 (Platform Completion)

- **PCMP-01**: Counter-propose in delegation negotiation handshake (ADEL-01)
- **PCMP-02**: Bidirectional clarification signal for mid-task communication (ASIG-01)
- **PCMP-03**: Parallel delegation with task groups and completion policies (ASIG-02)
- **PCMP-04**: Tree-level token budget enforcement for delegation chains (ASIG-03)
- **PCMP-05**: Transparent materialization — delegation creates Linear tickets (ADEL-02/03)
- **PCMP-06**: Scheduled agent execution — periodic triggers (SCH-01)
- **PCMP-07**: Sub-agent discovery by capability — dynamic selection (DISC-01)
- **PCMP-08**: Persistent agent identity documents — memory across conversations (IDN-01)

### Deferred to v3.0 (Domain Modeling)

- **DMOD-01**: Domain-language action primitives (DAP-01)
- **DMOD-02**: Role-by-role agent deep dives (DOM-01)

### Deferred to v3.1 (Human Collaboration)

- **HCOL-01**: Human directory entries, materialization, async handshake, response parsing (HUM-01-04)

## Out of Scope

Explicitly excluded from v2.8. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Circuit breaker at MCP client level | Agents should reason about integration failures, not have calls silently blocked. With 3 integrations, operational benefit is minimal. |
| Secondary channel fallback for failure notifications | Combinatorial complexity (3 channels x failure modes). Dashboard is the single backstop. Revisit when workspace-level channel config exists. |
| Semantic dedup (Layer 3) as a filter | "Is this work already in progress?" is agent judgment, not a deterministic filter. Work correlation enriches context; agents decide relevance. |
| Real-time integration health dashboard | Over-engineered for 3 integrations. MCP error event aggregation provides sufficient visibility. |
| Automatic retry escalation | Agent is better positioned to decide alternatives than infrastructure. Fixed retry with agent-visible context. |
| Event replay for crash recovery | LLM calls are non-deterministic; replaying tool calls causes duplicate side effects. Recovery context injection instead. |
| Automatic work correlation registration | Platform should not guess correlations. Agent-initiated via `work:register` tool. |
| Dashboard entity-centric views | Correlation data enables these but UI work is v2.9 scope. Data queryable via tools and router. |
| Correlation-based dashboard filtering | "Show all conversations for LIN-456" requires UI work beyond timeline improvements. Defer to v2.9. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| QF-01 | — | Pending |
| QF-02 | — | Pending |
| QF-03 | — | Pending |
| QF-04 | — | Pending |
| ECHO-01 | — | Pending |
| ECHO-02 | — | Pending |
| ECHO-03 | — | Pending |
| RESIL-01 | — | Pending |
| RESIL-02 | — | Pending |
| RESIL-03 | — | Pending |
| RESIL-04 | — | Pending |
| RESIL-05 | — | Pending |
| RESIL-06 | — | Pending |
| RESIL-07 | — | Pending |
| RESIL-08 | — | Pending |
| RESIL-09 | — | Pending |
| RESIL-10 | — | Pending |
| DASH-01 | — | Pending |
| DASH-02 | — | Pending |
| DASH-03 | — | Pending |
| DASH-04 | — | Pending |
| DASH-05 | — | Pending |
| DASH-06 | — | Pending |
| DASH-07 | — | Pending |
| DASH-08 | — | Pending |
| CORR-01 | — | Pending |
| CORR-02 | — | Pending |
| CORR-03 | — | Pending |
| CORR-04 | — | Pending |
| CORR-05 | — | Pending |
| CORR-06 | — | Pending |
| CORR-07 | — | Pending |
| CORR-08 | — | Pending |

**Coverage:**
- v2.8 requirements: 33 total
- Mapped to phases: 0
- Unmapped: 33 (pending roadmap creation)

---
*Requirements defined: 2026-02-16*
*Last updated: 2026-02-16 after initial definition*
