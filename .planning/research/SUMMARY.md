# Project Research Summary

**Project:** Aesir v2.9 Platform Completion
**Domain:** Multi-agent collaboration capabilities for an agentic development platform
**Researched:** 2026-02-20
**Confidence:** HIGH

## Executive Summary

v2.9 is a platform completion milestone, not a product expansion. The goal is to ship every foundational collaboration capability agents need before v3.0 domain modeling begins. Research confirms that all 8 planned features are achievable on existing infrastructure with minimal new dependencies: the only new library needed is `cron-parser` for cron expression validation at YAML load time. Everything else is Drizzle migrations, TypeScript interfaces, Zod schema extensions, and service logic built on existing Postgres, pg-boss, pgvector, and MCP infrastructure. Ecosystem comparison against FIPA Contract Net, A2A, CrewAI, LangGraph, Temporal, Dapr, and Letta/MemGPT confirms that Aesir's planned features either match or exceed what production multi-agent platforms offer -- counter-proposals, configurable parallel completion policies, policy-based materialization, and tree-level token budgets are genuinely novel at this level of design.

The recommended build approach is three waves based on hard dependencies. The Phase 1-2-4 chain (negotiation -> parallel delegation -> tree budgets) has sequential dependencies and forms the critical path. Phases 3, 5, 6 are genuinely independent and can ship alongside Phase 1. Phase 7 must precede Phase 8 because it establishes the lifecycle hook mechanism both phases share. This structure allows Wave 1 (Phases 1, 3, 5, 6) to be built largely in parallel before Wave 2 (Phases 2, 7) and Wave 3 (Phases 4, 8) follow.

The dominant risk is signal machinery complexity, not feature novelty. The `executeConversation()` function in the worker loop is the single most modified component across all 8 phases, and v2.9 introduces cross-conversation state dependencies (tree budgets, task groups, bidirectional clarification) that no prior milestone has required. The PITFALLS research identified 5 critical pitfalls with specific code-level prevention strategies. The most important structural mitigation across all phases: extract lifecycle hooks, budget checking, and signal aggregation into well-tested composable modules before the worker loop grows from ~1100 to ~1500+ lines.

## Key Findings

### Recommended Stack

The existing stack covers all 8 capability areas without new infrastructure. v2.9 reuses pg-boss v12.8.0 for cron scheduling (already initialized with `schedule: true`), pgvector for sub-agent capability embeddings (same pipeline as the entity directory), Drizzle ORM for 5 new tables and 4 column additions, and the existing MCP HTTP client for Linear materialization. No new orchestration infrastructure -- Temporal, Airflow, Redis -- is needed.

**Core technologies:**
- `pg-boss` v12.8.0: Cron scheduling (Phase 5) -- already initialized, `schedule()` API verified from installed type definitions; `singletonKey` for overlap prevention
- `drizzle-orm` + migrations: 5 new tables (`task_groups`, `tree_budgets`, `tree_budget_allocations`, `schedule_runs`, `identity_documents`) and 4 column additions to existing tables
- `pgvector` + `voyageai`: Sub-agent capability embeddings (Phase 6) -- same pipeline, same `entity_directory` table with `tier` discriminator column
- `cron-parser` ^5.x: Only new dependency -- validates cron expressions at YAML load time and computes next-run for dashboard display; 15M+ weekly downloads, maintained, TypeScript types included
- `@xyflow/react` + `recharts`: Budget and task tree visualization (Phase 4 dashboard) -- already installed

**What to explicitly avoid adding:** Redis (budget aggregation is infrequent enough for Postgres WITH FOR UPDATE), Temporal (signal-based coordination handles parallel delegation without an external workflow engine), BM25/Elasticsearch (deferred to v3.0 after role analysis), GraphQL (REST + SSE suffices), diffing libraries (side-by-side version display in React is simpler for natural-language documents).

### Expected Features

**Must have (table stakes for v3.0 readiness):**
- Counter-propose in delegation -- agents need to negotiate scope, not just accept or reject; wasted turns otherwise
- Bidirectional clarification during delegation -- target agents discover gaps mid-task; only option otherwise is guess or abort
- Parallel delegation with `all_required`/`any_sufficient`/`majority` completion policies -- sequential delegation bottlenecks orchestrators needing research from multiple sources
- Scheduled agent execution -- reactive-only agents cannot groom backlogs or run monitoring checks; pg-boss already supports `schedule()`
- Pre-compaction knowledge flush -- current compaction discards context without giving agents a chance to persist important discoveries
- Retrieval strategy abstraction -- hardcoded vector search in KnowledgeService cannot evolve without this seam; makes v3.0 strategies a config change
- Persistent agent identity documents -- agents rediscover context every session; at v3.0 scale with frequent domain agent runs, this is a real cost
- Linear ticket materialization -- human visibility into agent-to-agent work; deferred from v2.7 (ADEL-02/03)

**Should have (differentiators):**
- Multi-round clarification within one delegation (A2A supports only single-round `input-needed`)
- `majority` completion policy (N-of-M) -- enables voting patterns; no mainstream framework offers configurable completion policies for parallel groups
- Budget warning signals before exhaustion -- agents wrap up gracefully instead of hard-stop mid-work
- Budget visibility in task tree dashboard -- operators spot runaway costs before they become expensive
- Schedule context injection -- scheduled agents know their run history and can skip already-processed items
- Identity document version comparison in dashboard
- Score fusion interface for future hybrid retrieval -- v3.0 hybrid search becomes a config change, not a refactor

**Defer to v3.0+:**
- Concrete BM25/keyword retrieval strategies (build the pluggable pipeline interface, not implementations; v3.0 role analysis reveals which agents need which strategies)
- Human directory entries (agents competent professionals first, human collaboration later)
- Per-agent bot users/integration identities (unified external identity is a v3.0 target)
- Materialization targets beyond Linear (GitHub Issues, Slack threads -- no real use case yet)
- Cross-session learning feedback loops (requires real domain-expert agents running real work)
- Runtime schedule CRUD API (YAML is the source of truth; restart to modify)
- Cross-tree budget sharing (trees should be independent budget units)

### Architecture Approach

All 8 features decompose into three integration patterns: extending existing services (Phases 1, 2, 3, 4 extend TaskService, DelegationDeps, and signal infrastructure), adding new infrastructure alongside existing (Phases 5, 6, 7 add new services bootstrapped in `main.ts`), and refactoring an existing pipeline (Phase 8 restructures KnowledgeService query path). Every pattern follows established Aesir conventions -- factory functions with explicit dependencies, fail-fast Zod validation, health/close lifecycle methods, and the `callMcpTool()` pattern for integration calls.

**Major components:**
1. `TaskSignalDispatcher` (extended, Phases 2 + 3) -- group completion policy evaluation with atomic SQL; materialization sync on task terminal transitions; most complex modified component
2. `ScheduleRegistry` (new, Phase 5) -- registers pg-boss scheduled jobs at startup; creates synthetic IncomingEvents routed directly to `executor.start()`, bypassing EventRouter LLM call for deterministic routing
3. `MaterializationDispatcher` + `LinearMaterializationHandler` (new, Phase 3) -- strategy pattern for external artifact creation; only Linear ships in v2.9; `materialize()` + `syncCompletion()` + `reconcile()` interface
4. `TreeBudgetService` (new, Phase 4) -- atomic SQL token tracking across delegation trees; never application-level read-modify-write; `UPDATE ... SET remaining = remaining - $delta RETURNING remaining`
5. Lifecycle hook mechanism (new, Phase 7) -- ordered pipeline: `pre_compaction` hook (Phase 8) then compaction, then main loop, then `pre_completion` hook (Phase 7); `shouldRun`, `toolRestriction`, `sentinel` per hook
6. Retrieval strategy pipeline (new, Phase 8) -- `RetrievalStrategy` interface + `VectorRetrievalStrategy` refactored from KnowledgeService + `ScoreFusion` interface (single strategy = zero-overhead direct call)

**New schema:** 5 tables, 4 column additions. Key design: `entity_directory.tier` discriminator ('orchestrator' | 'sub_agent') avoids a second table while sharing the pgvector embedding pipeline. `tree_budget_allocations` separates per-conversation allocation from aggregate tree tracking. `identity_documents` is append-only (versioned by integer) with full history retained.

### Critical Pitfalls

1. **Clarification deadlock from nested wait-for (CRITICAL-1, Phase 1)** -- Delegator alternates between waiting for clarification responses and task completion. If it uses plain `wait_for` instead of `wait_for_task` to re-pause after answering a clarification, task completion signals may arrive while `pending_wait.types` no longer includes them. Fix: extend `wait_for_task` to always include `task_clarification` in its types array; make `wait_for_task` the only mechanism for delegation waits; integration test the full cycle.

2. **Parallel task group completion race condition (CRITICAL-2, Phase 2)** -- Two concurrent completions from different workers both read group state as "1 of 3 complete," both evaluate policy as unsatisfied, and neither triggers group completion. Fix: use `pg_advisory_xact_lock` on group ID for all completion signal processing, or atomic `UPDATE task_groups SET completed_count = completed_count + 1 RETURNING completed_count` -- evaluate policy against the returned authoritative value, never a re-read.

3. **Tree-level token budget double-spend under concurrency (CRITICAL-3, Phase 4)** -- Two parallel conversations both read `remaining = 50k`, each spend 30k, both write back `remaining = 20k` instead of the correct `-10k`. Fix: always atomic SQL decrement, never read-modify-write. Check `WHERE remaining >= $deducted RETURNING remaining`; empty result means exhausted.

4. **Webhook echo loop from transparent materialization (CRITICAL-4, Phase 3)** -- Agent updates Linear ticket via materialization -> Linear webhook -> EventRouter processes it -> potentially signals or re-starts the same conversation. Fix: track outbound materializations with TTL and suppress matching inbound webhooks; or use Linear's `actor` field to detect Aesir-originated updates.

5. **Lifecycle hook ordering creates unpredictable extra agent turns (CRITICAL-5, Phases 7+8)** -- Both phases inject extra LLM turns at lifecycle boundaries. If both fire in the same `executeConversation()` call, the agent runs 2-3 times with token costs compounding and ordering bugs possible (identity update before knowledge flush loses flushed knowledge). Fix: ordered pipeline -- (1) pre-compaction knowledge flush, (2) history compaction, (3) agent main loop, (4) pre-completion identity update. These are inherently different lifecycle points and must not collide.

## Implications for Roadmap

Based on combined research, the 8 phases should be organized into 3 waves. Wave 1 maximizes parallelism across all independent features. Wave 2 builds on Wave 1 foundations. Wave 3 completes the highest-complexity cross-cutting features.

### Phase 1: Richer Negotiation (Wave 1)
**Rationale:** Unblocks Phase 2 -- group delegations should support counter-propose within individual member handshakes. Medium complexity, signal mechanics are well-understood. Foundation for every delegation interaction in v3.0.
**Delivers:** `task:clarify` tool (new), `counter_propose` response type in `task:respond` (extended), `task_clarification` + `task_counter_propose` signal types, agent prompt guidance for negotiation
**Addresses:** NEG-01 through NEG-06 (counter-propose, clarification, multi-round bounded by timeout)
**Avoids:** CRITICAL-1 (extend `wait_for_task` types array to always include `task_clarification`; make it the only delegation wait mechanism); HIGH-1 (hard limit of 2 counter-proposal rounds tracked in task metadata)

### Phase 2: Parallel Delegation (Wave 2, after Phase 1)
**Rationale:** Highest-impact single feature. Sequential delegation is a wall-clock bottleneck for orchestrators needing fan-out. Depends on Phase 1 for rich handshakes within groups. Unblocks Phase 4 -- tree budgets multiply in necessity with parallel delegation.
**Delivers:** `task:delegate_group`, `task:group_status`, `task:cancel_group` tools; `agents.task_groups` table; `tasks.group_id` column; `TaskSignalDispatcher` group policy evaluation; `all_required`/`any_sufficient`/`majority` policies
**Uses:** `pg_advisory_xact_lock` or atomic SQL `RETURNING` for policy evaluation atomicity; `task_group_completion` signal type to decouple group signaling from individual task signals
**Avoids:** CRITICAL-2 (atomic policy evaluation -- never evaluate policy on a re-read after update); HIGH-6 (group-scoped signal matching; mark group `satisfied` in DB to suppress late completions after policy fires); INTEGRATION-3 (do not materialize individual group tasks as separate Linear tickets -- design group-aware materialization before combining with Phase 3)

### Phase 3: Transparent Materialization (Wave 1, independent)
**Rationale:** Independent of the negotiation/delegation chain. Immediate value for teams wanting Linear visibility into agent work. v2.8 correlation routing already handles the webhook routing side -- bidirectional sync builds directly on it.
**Delivers:** `materialization` parameter on `task:delegate` (optional, defaults to `internal`), `MaterializationDispatcher` strategy interface, `LinearMaterializationHandler`, `tasks.materialization` JSONB column, bidirectional sync via existing correlation routing
**Uses:** Existing `callMcpTool("linear", "create_issue")`, `CorrelationService`, webhook routing; pg-boss retry queue for fire-and-forget materialization updates
**Avoids:** CRITICAL-4 (outbound change tracking with TTL OR actor-field filtering on Linear webhooks; decide and implement one approach before MAT-03); MODERATE-1 (never block task status transitions on materialization success; internal task state is source of truth)

### Phase 4: Tree-Level Token Budgets (Wave 3, after Phase 2)
**Rationale:** Parallel delegation multiplies budget risk -- 5 parallel tasks with 200k tokens each means 1M potential spend from one orchestrator decision. Tree budgets make this controllable. Must come after Phase 2 group data model is stable; the `task_groups.tree_budget_tokens` field is designed in Phase 2 even if enforcement ships here.
**Delivers:** `agents.tree_budgets` + `agents.tree_budget_allocations` tables, `TreeBudgetService` with atomic SQL tracking, `task:tree_budget` tool (read-only), budget warning signals, `conversations.tree_budget_id` column, dashboard visualization in task tree view
**Implements:** Atomic `UPDATE ... SET remaining = remaining - $delta WHERE remaining >= $deducted RETURNING remaining`; hard exhaustion enforced at executor level via `max_iterations = 0` (not signal-only); backwards compatibility via fallthrough to per-conversation budget when no `tree_budget_id`
**Avoids:** CRITICAL-3 (atomic decrement, never read-modify-write); MODERATE-6 (executor-level hard enforcement for exhaustion, signals for warnings only); INTEGRATION-1 (clarification round-trip tokens charge against target's budget share)

### Phase 5: Scheduled Agent Execution (Wave 1, independent)
**Rationale:** Independent of all other phases. Breaks the purely reactive model. pg-boss support is already present and initialized. Straightforward implementation path: register `boss.schedule()` at startup, create synthetic IncomingEvent, route directly to `executor.start()` (bypassing EventRouter LLM call -- scheduling is deterministic).
**Delivers:** `schedules[]` in definition.yaml (Zod-validated), `ScheduleRegistry`, `agents.schedule_runs` table, overlap prevention (`skip`/`queue` policies), manual trigger API + dashboard button, schedule context injection in initial message, schedule history dashboard page
**Uses:** `pg-boss.schedule()` API with `singletonKey`; `cron-parser` ^5.x for fail-fast validation at YAML load time
**Avoids:** HIGH-2 (application-level overlap check before creating conversation in addition to pg-boss singletonKey; pg-boss schedule singleton has known 60-second resolution limitation); MODERATE-2 (advisory lock during schedule registration OR separate seed script run once per deployment)

### Phase 6: Sub-Agent Discovery (Wave 1, independent)
**Rationale:** Independent and lowest urgency (hardcoded `agentId` in `spawn_agent` still works with 3 current sub-agents), but the pgvector embedding pattern is proven and the extension is small. Build early to establish the pattern before v3.0 adds many specialized sub-agents.
**Delivers:** `tier` column on `agents.entity_directory` (discriminates `orchestrator` vs. `sub_agent`), `SubAgentRegistry` thin service (~60 lines), `capability` parameter on `coordination:spawn_agent` (backward compatible -- `agentType` takes precedence), updated seed script
**Uses:** Existing DirectoryService + pgvector embedding pipeline; `findSubAgent(capability)` method with `WHERE tier = 'sub_agent'` filter; 0.85 cosine similarity threshold
**Avoids:** HIGH-3 (minimum similarity threshold of 0.85; specific capability descriptions in YAML; hardcoded `subAgents` map as safety net fallback; no capability-based discovery in `delegate_group` -- parallel delegation uses explicit entity lookups)

### Phase 7: Persistent Agent Identity (Wave 2, establishes lifecycle hooks)
**Rationale:** Independent but must precede Phase 8 because it establishes the lifecycle hook mechanism both phases share. v3.0 domain agents need accumulated understanding -- without identity documents, they rediscover context every session. Phase 7 defines the `LifecycleHook` interface; Phase 8 registers a second hook into it.
**Delivers:** `agents.identity_documents` table (append-only, integer versioning), `IdentityService`, `identity:update` + `identity:read` tools, context injection into system prompt at conversation start, `framework/lifecycle-hooks.ts` with ordered pipeline, dashboard identity viewer with version comparison
**Implements:** Ordered lifecycle pipeline: `pre_compaction` -> compaction -> main loop -> `pre_completion`. Phase 7 registers `pre_completion` hook with `toolRestriction: ["identity:update", "identity:read"]`; Phase 8 registers `pre_compaction` hook
**Avoids:** CRITICAL-5 (ordered pipeline, not independent hooks -- these are different lifecycle points); HIGH-4 (conservative per-type token limits, skip identity injection for sub-agents entirely, account for identity overhead in tokenBudget); MODERATE-3 (retain last N=10 versions, compact similar versions on schedule); MODERATE-5 (last-write-wins acceptable for v1, but retain both versions in history so nothing is lost)

### Phase 8: Knowledge Retrieval Enhancement (Wave 3, after Phase 7)
**Rationale:** Plugs into lifecycle hook mechanism from Phase 7. Pre-compaction knowledge flush addresses a genuine v2.8 gap -- history compaction discards context that agents spent 50 tool calls building. Retrieval abstraction prepares the knowledge service for v3.0 strategies without building them prematurely.
**Delivers:** `RetrievalStrategy` interface, `VectorRetrievalStrategy` (refactored from KnowledgeService -- zero-overhead default path), `ScoreFusion` interface (designed but dead code until second strategy), per-agent `retrieval` config in YAML (optional, backward compatible), pre-compaction knowledge flush lifecycle hook
**Implements:** Pre-compaction hook with `toolRestriction: ["knowledge:store"]`, Haiku model, `maxIterations: 3`; sentinel detection via tool call log inspection (not text response parsing); flush count tracking per conversation to prevent double-flush
**Avoids:** HIGH-5 (restrict flush turn tool set to `knowledge:` namespace only -- no integration, codebase, or communication tools); MODERATE-4 (zero-overhead default: single strategy = direct call, no registry dispatch); MINOR-3 (check tool call log for "nothing stored" detection, not text sentinel parsing; `maxIterations: 1` if no knowledge:store call in first iteration)

### Phase Ordering Rationale

Three structural constraints drive the wave ordering:

- **Hard sequential dependency chain:** Phase 1 -> Phase 2 -> Phase 4. Counter-propose enriches the handshake used in group delegations. Tree budgets need the group data model to distribute budgets across parallel delegates. Each phase must be functionally stable before the next begins.
- **Shared infrastructure constraint:** Phase 7 before Phase 8. The lifecycle hook mechanism is shared infrastructure. Building Phase 8 first would require it to establish AND use the mechanism in one change -- larger scope, harder to review, and Phase 7 would need to retrofit instead of plugging in.
- **Parallelism opportunity:** Phases 3, 5, 6 touch different parts of the system with no shared state. Running them in parallel with Phase 1 in Wave 1 maximizes throughput. Phase 7 is independent of Phase 1-2-4 chain but constrained relative to Phase 8.

One critical caveat for parallel work: `worker-loop.ts` is modified by Phases 1, 2, 4, 6, 7, and 8. Any parallel execution of Wave 1 phases must explicitly assign file ownership to prevent merge conflicts on this single hot file.

### Research Flags

Phases requiring careful design attention during planning:
- **Phase 1 (Richer Negotiation):** The wait_for type cycling mechanism for multi-round clarification needs design-time validation before coding. Integration test covering the full cycle (delegate -> clarification -> answer -> completion, with task_completion signal arriving during clarification wait) is mandatory.
- **Phase 2 (Parallel Delegation):** Signal aggregation race condition (CRITICAL-2) must be solved at the design level. Choose between `pg_advisory_xact_lock` and atomic SQL `RETURNING` before writing `TaskSignalDispatcher` group logic. This is the highest-complexity piece of Phase 2.
- **Phase 4 (Tree-Level Token Budgets):** Novel territory with no production reference implementations. Strongly recommended: implement monitoring-only (aggregate + display) first, validate that atomic accounting is correct under parallel load, then add enforcement.
- **Phase 7 (Persistent Agent Identity):** The `LifecycleHook` interface design must accommodate both Phase 7's `pre_completion` use case and Phase 8's `pre_compaction` use case before either ships. Draft the interface and validate it against both hooks before implementing either.

Phases with standard patterns (skip additional research during planning):
- **Phase 3 (Transparent Materialization):** Echo prevention is well-documented. The `actor`-field approach is simpler; the outbound-tracking approach is more robust. Pick one, implement it. Pattern is understood.
- **Phase 5 (Scheduled Execution):** pg-boss schedule API is verified from installed types. Existing `timeout-scheduler.ts` provides a template. Application-level overlap check is standard guard pattern.
- **Phase 6 (Sub-Agent Discovery):** Entity directory extension is small and the embedding pipeline is proven. Threshold calibration (0.85 starting point) can be tuned empirically after initial seeding.
- **Phase 8 (Knowledge Retrieval Enhancement):** Strategy abstraction is a standard registry pattern. Pre-compaction flush approach (restricted tool set, Haiku model, maxIterations guard, tool-call-log sentinel detection) is fully specified in PITFALLS.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All integration points verified against installed package type definitions and actual source code. Only new dependency (`cron-parser`) verified on npm with usage rationale. Explicit "what not to add" list reduces over-engineering risk. |
| Features | MEDIUM-HIGH | Ecosystem research verified via official docs (A2A, Linear Agent SDK, pg-boss, LangGraph, Temporal, Dapr, Letta/MemGPT). Tree-level token budgets are novel -- no production reference implementation exists, but the approach is sound from first principles. Feature scope traces directly to v2.7/v2.8 deferred items. |
| Architecture | HIGH | All component boundaries, data flows, and integration points verified against actual source code (schema.ts, worker-loop.ts, tool factories, all service files). Modified component lists are exhaustive. Schema changes specified to the column level. Build wave dependencies verified against codebase structure. |
| Pitfalls | HIGH | 5 CRITICAL + 6 HIGH + 6 MODERATE pitfalls identified from deep analysis of 2000+ lines of executor/worker-loop/signal code and external research (MAST taxonomy, pg-boss changelog, bidirectional sync literature). Cross-phase interaction pitfalls are specific, non-obvious, and individually mitigable. |

**Overall confidence:** HIGH

### Gaps to Address

- **Clarification deadlock prevention (Phase 1):** The full multi-round clarification cycle (delegate -> clarify -> answer -> re-clarify -> answer -> complete) needs an integration test before Phase 1 is considered done. The mechanism is specified; the edge cases need validation.
- **Completion policy atomicity approach (Phase 2):** Both `pg_advisory_xact_lock` and atomic `UPDATE ... RETURNING` are viable. The choice depends on whether the policy evaluation needs to span multiple SQL statements (advisory lock) or can be expressed as a single atomic update (RETURNING). Decide during Phase 2 planning before writing TaskSignalDispatcher.
- **Echo suppression for materialization (Phase 3):** Actor-field approach is simpler (requires consistent OAuth identity for Aesir) vs. outbound-tracking approach (requires an extra table or cache). Pick one approach; both are well-understood.
- **Lifecycle hook interface (Phases 7+8):** The `LifecycleHook` interface needs to be designed before either phase begins. Validate against both use cases: Phase 7's pre-completion identity update (post-main-loop, restricted tools) and Phase 8's pre-compaction knowledge flush (pre-compaction, different restricted tools, Haiku model).
- **Tree budget traversal strategy (Phase 4):** Recursive CTE vs. denormalized `root_task_id` column for finding all conversations in a tree. Denormalized column is faster at read time but requires maintenance at delegation write time. Decide before implementing TreeBudgetService.
- **Parallel sub-agent threshold calibration (Phase 6):** The 0.85 cosine similarity threshold is a starting recommendation validated against the existing entity directory. Measure actual similarity scores between existing sub-agent capability descriptions and typical orchestrator queries before setting the production threshold.

## Sources

### Primary (HIGH confidence)
- Installed pg-boss v12.8.0 types (`packages/agents/node_modules/pg-boss/dist/types.d.ts`) -- schedule API, singletonKey, ScheduleOptions verified
- Aesir source code (`packages/agents/src/framework/`, `packages/agents/src/shared/`, `packages/agents/definitions/`) -- 30+ files, all component boundaries and data flows verified against actual implementation
- A2A Protocol (Google Developers Blog) -- agent negotiation, `input-needed` task state
- Linear Agent SDK (linear.app/agents) -- materialization and bidirectional sync capabilities
- Temporal workflow documentation -- parallel completion policies, overlap handling, saga compensation
- Dapr workflow documentation -- `when_all()` / `when_any()` fan-out patterns
- Letta/MemGPT documentation -- core memory architecture, identity document pattern basis

### Secondary (MEDIUM confidence)
- FIPA Contract Net Protocol (Wikipedia) -- academic standard for agent negotiation, iterated bidding analog to counter-propose
- Mem0, CrewAI, Amazon Bedrock AgentCore Memory documentation -- persistent memory pattern comparison
- MAST taxonomy (arXiv:2503.13657) -- multi-agent failure mode classification; 79% of failures from specification/coordination issues
- pg-boss GitHub issues and changelog -- singleton key behavior, schedule limitations, v10/v11/v12 API evolution
- Token budget research papers (BudgetThinker, OpenReview, arXiv:2412.18547) -- tree-level budget patterns; no production implementations found
- ParadeDB, pg_textsearch, Jonathan Katz blog -- hybrid search patterns in PostgreSQL; confirms pgvector + Postgres FTS is sufficient for v3.0 keyword strategy without extensions

### Tertiary (LOW confidence, extrapolated to Aesir context)
- Workato bidirectional sync documentation -- echo loop prevention via record hashing and directional flags; applied to webhook echo problem
- ACDP agent discovery protocol -- capability-based discovery concepts; different architecture (DNS-based) but confirms semantic capability matching as the right pattern

---
*Research completed: 2026-02-20*
*Ready for roadmap: yes*
