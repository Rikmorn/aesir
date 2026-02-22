# Requirements: Aesir

**Defined:** 2026-02-20
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## v2.9 Requirements

Requirements for v2.9 Platform Completion. Each maps to roadmap phases.

### Negotiation

- [x] **NEG-01**: Counter-propose response type -- target responds with modified scope, timeline, or approach. Delegator sees the modification and decides: accept modified version, reject and cancel, or try someone else
- [x] **NEG-02**: Counter-propose as handshake strategy -- new strategy implementation alongside existing accept/reject. Same `task:respond` tool with additional response type
- [x] **NEG-03**: Clarification signal type -- `task_clarification` signal from target to delegator with question and optional structured options
- [x] **NEG-04**: `task:clarify` tool -- target agent sends a clarification request back to the delegating conversation
- [x] **NEG-05**: Clarification response -- delegator answers via signal back to target. Target's `wait_for` resumes with the answer
- [x] **NEG-06**: Multi-round support -- clarification can go back and forth within a single delegation, bounded by the task timeout
- [x] **NEG-07**: Prompt guidance -- agents understand when to counter-propose vs reject, when to ask for clarification vs proceed with assumptions

### Parallel Delegation

- [x] **PAR-01**: Task groups -- `task:delegate_group` creates multiple delegations as a named group with a shared completion policy
- [x] **PAR-02**: Completion policies -- `all_required` (wait for all), `any_sufficient` (first success unblocks delegator), `majority` (N of M). Defined at group creation
- [x] **PAR-03**: Partial completion handling -- when policy is `all_required` and one task fails, delegator receives immediate notification and decides: wait for others, cancel remaining, or accept partial results
- [x] **PAR-04**: Group status tool -- `task:group_status` returns aggregated group state (how many complete, pending, failed)
- [x] **PAR-05**: Signal aggregation -- completion signals from group members are collected. Delegator is signaled when the group's completion policy is satisfied
- [x] **PAR-06**: Group cancellation -- delegator can cancel all remaining tasks in a group (e.g., after `any_sufficient` is met, cancel the rest)
- [x] **PAR-07**: Budget-aware group design -- group data model accommodates future tree budget distribution (Phase 4). Phase 2 uses per-conversation budgets; Phase 4 retrofits tree-level allocation into groups

### Transparent Materialization

- [x] **MAT-01**: Materialization policy parameter -- `task:delegate` accepts an optional `materialization` parameter: `internal` (default, current behavior) or `transparent`
- [x] **MAT-02**: Linear materialization -- transparent mode creates a Linear issue with task description, priority, assignee (agent), and a link/reference back to the internal task
- [x] **MAT-03**: Bidirectional sync -- status changes on the materialized artifact (Linear issue updated) sync to task status. Task completion updates the Linear issue
- [x] **MAT-04**: Materialization as prompt guidance -- the decision to use internal vs transparent is agent judgment. Prompt guidance describes when transparency is valuable
- [x] **MAT-05**: Materialization interface -- extensible dispatch for future targets (Slack thread, GitHub issue) without changing the delegation tool
- [x] **MAT-06**: Correlation tracking -- materialized artifacts are tracked in the integration correlation layer so incoming webhooks route correctly back to the task

### Tree-Level Token Budgets

- [ ] **BUD-01**: Tree budget allocation -- root task sets a total token budget for the entire delegation tree via `task:delegate` parameter
- [ ] **BUD-02**: Budget propagation -- delegated tasks inherit a portion of the remaining tree budget, not an independent allocation. The delegating agent can specify allocation or accept default (equal split of remaining)
- [ ] **BUD-03**: Budget tracking -- real-time token usage aggregated across all conversations in the tree, queryable via `task:tree_budget` tool
- [ ] **BUD-04**: Budget exhaustion signal -- when tree budget is approaching exhaustion, active conversations receive a warning signal. Hard exhaustion stops all conversations in the tree
- [ ] **BUD-05**: Budget visibility in dashboard -- token usage per tree level, per conversation, and total. Visual representation in the task tree view
- [ ] **BUD-06**: Backward compatibility -- conversations without a tree budget continue using per-conversation budgets (existing behavior)

### Scheduled Execution

- [x] **SCH-01**: Schedule trigger type -- agents declare `schedule` triggers in definition.yaml alongside event triggers
- [x] **SCH-02**: Cron expression support -- standard cron syntax (e.g., `"0 9 * * MON"` for Monday 9am). Validated at definition load time
- [x] **SCH-03**: Schedule registration -- on startup, worker loop registers pg-boss scheduled jobs for all agents with schedule triggers
- [x] **SCH-04**: Synthetic event -- when a schedule fires, pg-boss job creates a synthetic `IncomingEvent` with type `schedule.triggered` and metadata (schedule name, last run time, last run outcome). EventRouter processes it like any other trigger
- [x] **SCH-05**: Overlap prevention -- configurable per-schedule: `skip` (drop if previous run still active) or `queue` (wait for completion then start). Default: `skip`
- [x] **SCH-06**: Schedule context injection -- scheduled conversations receive context about why they were triggered: schedule name, last run timestamp, last run outcome summary, time since last run
- [ ] **SCH-07**: Manual trigger -- API endpoint and dashboard button to manually fire a scheduled agent (for testing and ad-hoc execution)
- [ ] **SCH-08**: Schedule visibility in dashboard -- active schedules, next run time, last run status, run history

### Sub-Agent Discovery

- [ ] **DISC-01**: Sub-agent capabilities field -- sub-agent definitions include `capabilities` (same format as orchestrator capabilities in directory)
- [ ] **DISC-02**: Sub-agent registry -- internal registry of sub-agents queryable by capability, separate from the entity directory
- [ ] **DISC-03**: Capability-based spawn -- `coordination:spawn_agent` accepts either a hardcoded agent ID (backward compatible) or a `capability` parameter that resolves to the best-matching sub-agent
- [ ] **DISC-04**: Registry seeding -- sub-agent capabilities seeded from YAML at startup, alongside orchestrator directory seeding
- [ ] **DISC-05**: Semantic matching -- reuse pgvector embedding pipeline from knowledge/directory for capability matching
- [ ] **DISC-06**: Orchestrator prompt simplification -- orchestrators describe the capability they need ("I need code written" vs "spawn coder"). Prompt guidance teaches capability-based reasoning
- [ ] **DISC-07**: Fallback behavior -- if no sub-agent matches the capability query, return empty result. Agent decides: do the work itself, try a different capability description, or signal inability

### Persistent Agent Identity

- [ ] **IDN-01**: Identity document table -- structured, versioned documents scoped to an agent role (not a conversation). Schema: agent_id, document_type, content (text), version, updated_at, token_count
- [ ] **IDN-02**: Document types -- extensible set: `product_brief`, `architectural_model`, `stakeholder_map`, `domain_knowledge`, `working_context`, `learned_preferences`. New types addable without schema change
- [ ] **IDN-03**: Context injection -- relevant identity documents injected into the system prompt at conversation start. The agent begins every conversation with its accumulated understanding
- [ ] **IDN-04**: `identity:update` tool -- agents update their identity documents at conversation end (or mid-conversation for important discoveries). Appends a new version; old versions retained
- [ ] **IDN-05**: `identity:read` tool -- agents can explicitly read their identity documents (beyond the auto-injected version at start) for refresh during long conversations
- [ ] **IDN-06**: Document versioning -- every update creates a new version. Full history retained for audit and rollback
- [ ] **IDN-07**: Size management -- identity documents have configurable token limits per type. When approaching the limit, the agent is prompted to summarize/compress before the next update
- [ ] **IDN-08**: Dashboard visibility -- identity documents viewable and version-comparable in the dashboard. Operators can see how an agent's understanding evolved over time
- [ ] **IDN-09**: Graceful degradation -- if identity documents fail to load, conversation starts without them (higher context cost, not a hard failure)

### Knowledge Retrieval Enhancement

- [ ] **KR-01**: Retrieval strategy abstraction -- pluggable pipeline interface (type contract with zero-overhead default path) that accepts a query and agent config, returns ranked results. Current vector search refactored as the default strategy implementation. Must NOT add runtime dispatch overhead when using the default strategy.
- [ ] **KR-02**: Per-agent retrieval config in definition.yaml -- agents declare retrieval preferences (strategy selection, weights, feature flags) in their definition. Schema designed against known strategy interfaces: vector, keyword, temporal decay, diversity
- [ ] **KR-03**: Strategy registry -- strategies registered by name, resolved at query time from agent config. New strategies addable without changing the pipeline code
- [ ] **KR-04**: Score fusion interface -- when multiple strategies are enabled, scores are combined via configurable weights. Designed for hybrid retrieval (e.g., vector + keyword) even though only vector ships initially
- [ ] **KR-05**: Pre-compaction knowledge flush -- before history compaction, inject a turn prompting the agent to persist important knowledge via `store_knowledge`. Uses existing auto-supersede deduplication
- [ ] **KR-06**: Flush safeguards -- flush count tracking prevents double-flushing. Flush is skipped if agent has no knowledge tools. Agent responds with a sentinel if nothing to store
- [ ] **KR-07**: Backward compatibility -- agents without retrieval config in YAML use the current vector-only pipeline with existing behavior. No changes to existing agent definitions required
- [ ] **KR-08**: Config validation -- retrieval config validated at definition load time via Zod. Invalid strategy references or weight configurations fail fast at startup

## Future Requirements

Deferred to v3.0+ milestones. Tracked but not in current roadmap.

### Concrete Retrieval Strategies (v3.0)

- **KRS-01**: BM25/keyword retrieval strategy implementation
- **KRS-02**: Temporal decay retrieval strategy
- **KRS-03**: MMR diversity retrieval strategy

### Domain Modeling (v3.0)

- **DOM-01**: Role-by-role agent deep dives (product, dev, QA, new roles)
- **DOM-02**: Domain-specific sub-agents and tools
- **DAP-01**: Domain-language action primitives (`work:create_item` vs `linear:create_issue`)

### Human Collaboration (v3.1)

- **HUM-01**: Human directory entries, seeding + delegation for human entities
- **HUM-02**: Slack materialization for human task delivery
- **HUM-03**: Async handshake for human response parsing
- **HUM-04**: Escalation strategies and reminder logic

### Cross-Session Learning

- **CSL-01**: Feedback loop from real task outcomes to agent improvement

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Concrete BM25/keyword/temporal-decay/MMR strategies | v3.0 role analysis reveals which agents need them. v2.9 ships the pipeline interface only. |
| Human directory entries | Agents must be competent (v3.0) before humans collaborate (v3.1). Schema ready from v2.7. |
| Per-agent bot users / integration identities | v2.9 spec constraint: "do not deepen per-agent external identities." v3.0 target. |
| GitHub/Slack materialization targets | Linear only for v2.9. Extensible interface accommodates future targets. |
| Dynamic schedule CRUD API | Schedules from YAML, not runtime config. Manual trigger provides ad-hoc execution. |
| Cross-tree budget sharing | Trees are independent budget units. Sharing creates unpredictable resource consumption. |
| Automatic identity document updates | Agent decides when to persist. Prompt guidance + optional executor reminder, not mandatory injection. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| NEG-01 | Phase 80 | Complete |
| NEG-02 | Phase 80 | Complete |
| NEG-03 | Phase 80 | Complete |
| NEG-04 | Phase 80 | Complete |
| NEG-05 | Phase 80 | Complete |
| NEG-06 | Phase 80 | Complete |
| NEG-07 | Phase 80 | Complete |
| PAR-01 | Phase 81 | Complete |
| PAR-02 | Phase 81 | Complete |
| PAR-03 | Phase 81 | Complete |
| PAR-04 | Phase 81 | Complete |
| PAR-05 | Phase 81 | Complete |
| PAR-06 | Phase 81 | Complete |
| PAR-07 | Phase 81 | Complete |
| MAT-01 | Phase 82 | Complete |
| MAT-02 | Phase 82 | Complete |
| MAT-03 | Phase 82 | Complete |
| MAT-04 | Phase 82 | Complete |
| MAT-05 | Phase 82 | Complete |
| MAT-06 | Phase 82 | Complete |
| BUD-01 | Phase 83 | Pending |
| BUD-02 | Phase 83 | Pending |
| BUD-03 | Phase 83 | Pending |
| BUD-04 | Phase 83 | Pending |
| BUD-05 | Phase 83 | Pending |
| BUD-06 | Phase 83 | Pending |
| SCH-01 | Phase 84 | Complete |
| SCH-02 | Phase 84 | Complete |
| SCH-03 | Phase 84 | Complete |
| SCH-04 | Phase 84 | Complete |
| SCH-05 | Phase 84 | Complete |
| SCH-06 | Phase 84 | Complete |
| SCH-07 | Phase 84 | Pending |
| SCH-08 | Phase 84 | Pending |
| DISC-01 | Phase 85 | Pending |
| DISC-02 | Phase 85 | Pending |
| DISC-03 | Phase 85 | Pending |
| DISC-04 | Phase 85 | Pending |
| DISC-05 | Phase 85 | Pending |
| DISC-06 | Phase 85 | Pending |
| DISC-07 | Phase 85 | Pending |
| IDN-01 | Phase 86 | Pending |
| IDN-02 | Phase 86 | Pending |
| IDN-03 | Phase 86 | Pending |
| IDN-04 | Phase 86 | Pending |
| IDN-05 | Phase 86 | Pending |
| IDN-06 | Phase 86 | Pending |
| IDN-07 | Phase 86 | Pending |
| IDN-08 | Phase 86 | Pending |
| IDN-09 | Phase 86 | Pending |
| KR-01 | Phase 87 | Pending |
| KR-02 | Phase 87 | Pending |
| KR-03 | Phase 87 | Pending |
| KR-04 | Phase 87 | Pending |
| KR-05 | Phase 87 | Pending |
| KR-06 | Phase 87 | Pending |
| KR-07 | Phase 87 | Pending |
| KR-08 | Phase 87 | Pending |

**Coverage:**
- v2.9 requirements: 58 total
- Mapped to phases: 58
- Unmapped: 0

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-02-20 after roadmap creation*
