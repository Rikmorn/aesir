# Feature Landscape: v2.9 Platform Completion

**Domain:** Advanced multi-agent collaboration capabilities -- negotiation, parallel delegation, external materialization, hierarchical budgets, scheduled execution, dynamic discovery, persistent identity, and pluggable retrieval for an agentic development platform.
**Researched:** 2026-02-20
**Overall Confidence:** MEDIUM-HIGH
**Context:** v2.9 milestone -- completing every collaboration capability agents need before domain modeling begins. The platform has 6 agents (3 orchestrators, 3 sub-agents), 45+ tools, Postgres-backed conversation executor with pg-boss scheduling, pgvector knowledge store, entity directory with semantic matching, and task delegation with accept/reject handshake. All 8 phases are additive to existing v2.7/v2.8 infrastructure.

---

## Ecosystem Context

Before categorizing features, here is what production multi-agent frameworks and workflow orchestration platforms provide for each capability area, and how Aesir's planned features compare.

### 1. Task Negotiation / Counter-Proposals

| Framework | Negotiation Model | Counter-Propose | Clarification | Notes |
|-----------|------------------|-----------------|---------------|-------|
| **FIPA Contract Net** | Manager broadcasts call-for-proposals, contractors bid, manager selects. Iterated variant allows manager to re-issue CFP to subset of bidders. | Implicit via iterative bidding rounds. No explicit counter-propose message type -- contractor bids are the "proposals." Manager accepts or rejects. | Not in base protocol. Extensions add "request information" act. | Academic standard (1980s), well-studied. The iterative CFP pattern is the closest analog to counter-propose. |
| **A2A Protocol** | Task lifecycle: submitted -> working -> input-needed -> completed/failed. Client creates task, remote agent executes. | No explicit counter-propose. The `input-needed` state pauses execution and asks the client for more information, but this is clarification, not scope modification. | Built-in via `input-needed` task state. Client provides additional context, agent resumes. | Closest modern standard. Task states are well-defined but focused on execution, not negotiation. |
| **CrewAI** | Manager assigns, specialist executes. No negotiation. Delegation disabled by default since 2025 due to infinite loop bugs. | None. Manager decides unilaterally. | None built-in. Agents can use tools to gather info but cannot signal back to the delegator. | Anti-pattern for negotiation -- demonstrates why unilateral delegation causes problems. |
| **LangGraph** | Supervisor routes to agents. Handoff transfers context. No ask-and-wait pattern. | None. The supervisor or current agent decides routing. No mechanism for target to negotiate terms. | Not built-in. Would require custom state management. | Flexible enough to build negotiation, but no standard pattern exists. |
| **Microsoft Agent Framework** | Handoff-based routing. Context summary passed on transfer. | Handoff includes context; target can request more info. No formal counter-propose. | Informal -- target agent can emit messages requesting clarification. No structured protocol. | Merging AutoGen + Semantic Kernel. Still pre-GA for advanced negotiation patterns. |

**Key finding:** Counter-proposals remain genuinely novel in the open-source multi-agent space. The FIPA Contract Net's iterated bidding is the closest academic analog. A2A's `input-needed` state covers clarification but not scope modification. Aesir's v2.7 accept/reject handshake already exceeds what most frameworks offer. Adding counter-propose and bidirectional clarification puts Aesir ahead of the ecosystem.

**Confidence: MEDIUM-HIGH** -- FIPA protocol well-documented in academic literature. A2A verified via Google developer docs. Framework capabilities verified via official documentation.

### 2. Parallel Task Fan-Out with Completion Policies

| Framework | Fan-Out Pattern | Completion Policies | Partial Failure | State Management |
|-----------|----------------|--------------------|-----------------| ----------------|
| **Temporal** | Child workflows or parallel activities. `Promise.all()` for wait-all, `Promise.race()` for first-completes. Saga pattern for compensation. | Implicit via language constructs: `all` (Promise.all), `any` (Promise.race). Custom policies via reducer functions. | Saga compensation: each step has an "undo" action. Compensations run in reverse order on failure. | Durable execution. Workflow state survives crashes. Partial completion tracked automatically. |
| **LangGraph** | Fan-out via conditional edges to parallel nodes. "Superstep" execution: all parallel branches run, results merge. `defer=True` for branches with different lengths. | Built-in: wait for all branches (superstep). Deferred nodes wait until all pending tasks complete. No built-in "any" or "majority" policy. | Parallel branches can fail independently. Reducers combine available results. Error handling per-branch. | StateGraph with typed reducers. `operator.add` for list concatenation. Per-branch state isolation possible but not default. |
| **Dapr Workflows** | Fan-out/fan-in as first-class pattern. Parallel activities with `when_all()` and `when_any()`. | `when_all()` (wait for all), `when_any()` (first to complete). Built into the workflow SDK. | `when_any()` can be combined with cancellation of remaining tasks. Error propagation configurable. | Durable state via sidecar. Automatic checkpointing. |
| **Prefect** | `map()` for parallel task execution. Concurrency limits configurable. | All tasks must complete (map semantics). Custom policies via flow logic. | Failed tasks in a map do not block others. Results include success/failure per task. | State-based execution. Task states: Pending, Running, Completed, Failed, Cancelled. |
| **CrewAI** | Sequential or hierarchical. No true parallel execution within a crew. | N/A -- sequential only. | Manager handles individual task failure. Can reassign or skip. | Crew-level state. No per-task state isolation. |

**Key finding:** The `all_required` / `any_sufficient` / `majority` policy model maps cleanly to established patterns (Temporal's Promise.all/race, Dapr's when_all/when_any). The `majority` policy (N of M) is less common in frameworks but well-established in distributed systems (quorum). Aesir's planned signal aggregation for groups is the distinguishing piece -- most frameworks use in-process synchronization, while Aesir needs cross-conversation coordination via signals.

**Confidence: HIGH** -- Temporal, Dapr, and LangGraph patterns verified via official documentation and multiple tutorials.

### 3. Task Materialization to External Systems

| Platform | External Artifact Creation | Bidirectional Sync | Policy Model |
|----------|---------------------------|-------------------|--------------|
| **Linear Agent SDK** | Agents create issues via `createIssue` mutation. Sub-issues via parent assignment. Agent sessions track lifecycle. | Status changes sync automatically through webhook events. Comments sync bidirectionally. Assignee changes propagated. | Agent decides what to create. No built-in "materialize on delegation" pattern -- agents call tools explicitly. |
| **Codex (OpenAI)** | Creates Linear issues from code analysis. Agent creates sub-issues and self-assigns for parallelism. | Bidirectional: Linear issue updates trigger agent webhook. Agent updates flow back to Linear. | Hard-coded: all work materializes as Linear issues. No internal-only option. |
| **GitHub Copilot Workspace** | Creates GitHub issues, PRs, branches. All work visible as GitHub artifacts. | Full bidirectional: PR reviews trigger agent, agent pushes commits. Issue comments trigger re-analysis. | Hard-coded: everything is a GitHub artifact. No silent/internal mode. |
| **Warp Agents** | Create Linear issues. Updates synced back. | One-way: agent -> Linear. Status updates from Linear events. | Explicit tool calls. Agent chooses when to create external artifacts. |

**Key finding:** Most agent platforms hard-code materialization -- everything becomes a ticket or PR. Aesir's policy-based approach (`internal` vs `transparent`) where the agent decides based on prompt guidance is genuinely differentiated. The key implementation challenge is bidirectional sync: when a human modifies the materialized Linear issue, those changes must route back to the internal task via webhook correlation.

**Confidence: MEDIUM-HIGH** -- Linear Agent SDK verified via official docs. Other platform behaviors verified via product documentation and blog posts. Bidirectional sync complexity is well-understood from v2.7/v2.8 webhook routing experience.

### 4. Hierarchical Token Budget Tracking

| Approach | Budget Model | Propagation | Enforcement | Visibility |
|----------|-------------|-------------|-------------|------------|
| **Per-conversation (Aesir v2.7)** | Fixed budget per conversation. Sub-agents share parent's budget via `tokenBudget` reference. Independent per delegation. | No cross-conversation propagation. Each delegation gets its own budget from the agent definition. | `TokenBudgetExhaustedError` stops the current conversation. No impact on siblings or parent. | Per-conversation token count in dashboard. No tree-level aggregation. |
| **BudgetThinker (research)** | Dynamic token allocation per problem. Control tokens injected during inference to inform model of remaining budget. | Budget allocated at problem start. Model adjusts reasoning depth based on remaining budget signals. | Soft enforcement via control tokens. Model self-regulates output length. | Budget consumption visible per reasoning step. |
| **MetaGPT/AgentVerse (research)** | Hierarchical agent structures with implicit budgets. Input tokens 2-3x output tokens. Verification phases consume disproportionate input tokens. | Implicit. No explicit budget propagation. Each agent in hierarchy consumes independently. | None built-in. Total cost is measured post-hoc, not constrained proactively. | Post-hoc metrics. Delegation depth correlates with total consumption. |

**Key finding:** Tree-level token budgets across delegation chains are not implemented in any production framework. Every system either uses per-conversation budgets (Aesir v2.7, most frameworks) or post-hoc measurement (research systems). Aesir's planned approach -- propagating a shared budget through the delegation tree with real-time tracking -- is novel. The main design challenge is atomic budget accounting across concurrent conversations without a distributed lock.

**Confidence: MEDIUM** -- Research patterns verified via published papers. No production implementation found for tree-level budgets in LLM multi-agent systems. The approach is sound but unproven at scale.

### 5. Scheduled Agent Execution

| System | Scheduling Mechanism | Cron Support | Overlap Handling | Context Injection |
|--------|---------------------|-------------|------------------|-------------------|
| **pg-boss (Aesir dependency)** | `boss.schedule(name, cron, data)` for recurring jobs. Built on Postgres. Already used by Aesir for timeout scheduling. | Full cron syntax. Validated at schedule time. | `singletonKey` prevents duplicate jobs per key. Advisory locks for concurrency control. | Job data payload passed to worker function. Arbitrary JSON. |
| **pg_cron (Postgres extension)** | SQL-level cron scheduling. `cron.schedule()` function. Runs inside PostgreSQL. | Full cron syntax. Timezone support via `cron.schedule_in_database()`. | No built-in overlap prevention. Requires advisory lock or application-level guard. | Limited -- runs SQL statements. Cannot inject rich context. |
| **Temporal** | Cron workflows: `cronSchedule` option on workflow start. | Full cron syntax. Timezone via workflow options. | Previous run must complete before next starts (default). Configurable overlap policy: skip, buffer, cancel-other, terminate-other. | `searchAttributes` and `memo` for context. Previous run result available via `lastResult`. |

**Key finding:** pg-boss already supports `schedule()` with cron syntax and is already initialized in Aesir's `TimeoutScheduler` with `schedule: true`. The implementation path is straightforward: register schedules for agents with `schedule` triggers at startup, have the pg-boss worker create synthetic `IncomingEvent` objects that flow through the existing `EventRouter`. Temporal's overlap policies (`skip`, `queue`) map directly to the spec's proposed behavior. The main decisions are timezone handling and previous-run context injection.

**Confidence: HIGH** -- pg-boss scheduling API verified via npm documentation and existing Aesir usage in `timeout-scheduler.ts`.

### 6. Capability-Based Agent Discovery

| System | Discovery Mechanism | Registry Model | Matching |
|--------|-------------------|---------------|----------|
| **A2A Agent Cards** | Agents publish JSON capability manifests ("Agent Cards"). Clients discover via well-known URL or registry. | Decentralized -- each agent hosts its own card. Optional central registry for discovery. | Client queries capabilities. Matching is client-side. |
| **Aesir Entity Directory (v2.7)** | Agents seeded at startup. Capability text embedded via pgvector. `directory:find` does cosine similarity search. | Centralized Postgres table. Seeded from YAML definitions. | Semantic matching via pgvector embeddings. Threshold-based (0.3 cosine similarity). |
| **ACDP** | DNS-based discovery (SRV + TXT records). HTTPS for communication. Hybrid central + peer-to-peer. | DNS infrastructure. Central registries for bootstrapping. | Capability-based routing via structured descriptors. |

**Key finding:** The entity directory already provides the core pattern (semantic capability matching via pgvector). Sub-agent discovery is a natural extension: same embedding pipeline, same matching algorithm, different scope (internal sub-agents vs. peer orchestrators). The design question is whether to use a separate table or add a `tier` discriminator to the existing `entity_directory` table. Separate table is conceptually cleaner (sub-agents have different lifecycle -- no deactivation, no `reachVia`); same table is operationally simpler (shared embedding pipeline, shared queries).

**Confidence: HIGH** -- Entity directory already implemented and tested. pgvector embedding pipeline proven. Extension pattern is well-understood from the existing codebase.

### 7. Persistent Agent Memory / Identity

| System | Memory Architecture | Cross-Session Persistence | Versioning |
|--------|-------------------|--------------------------|------------|
| **Letta/MemGPT** | Three-tier: core memory (in-context blocks, always injected), conversational memory (searchable history), archival memory (vector DB). Agent-managed via tools. | Core memory persists across conversations. Archival memory is permanent. | Core memory blocks updated in-place. No version history. |
| **CrewAI** | Short-term (within execution), long-term (across runs), entity memory (key entities), procedural memory (learned strategies). | Long-term memory persists across crew runs via ChromaDB. | No explicit versioning. Overwrite on key collision. |
| **Amazon Bedrock AgentCore Memory** | Hierarchically managed memory scoped per user. Summarized conversation data stored under unique memory IDs. | Cross-session via memory IDs. Summarization-based. | Implicit via summary updates. |
| **Mem0** | Managed memory layer. Agents store and retrieve memories via API. Categories: personal, task, conversation. | Full cross-session persistence. User/agent scoping. | Last-write-wins with deduplication. |

**Key finding:** Aesir's planned "identity documents" are distinct from knowledge entries in a meaningful way that aligns with Letta's "core memory blocks" pattern. Knowledge entries are shared atomic facts with expiry. Identity documents are maintained structured narratives scoped to an agent role -- a product brief, an architectural model, a stakeholder map. The key design insight is that these documents are injected at conversation start (like Letta's core memory) and updated at conversation end (like Letta's `memory_replace`). Versioning with full history is a differentiator over Letta's in-place replacement.

**Confidence: MEDIUM-HIGH** -- Letta/MemGPT patterns verified via official docs. Mem0 and CrewAI memory verified via official documentation. The "identity document" concept is novel in its versioning and structured-document approach.

### 8. Pluggable Retrieval Strategies

| System | Retrieval Architecture | Strategy Types | Fusion Method |
|--------|----------------------|---------------|---------------|
| **pgvector + Postgres FTS** | Cosine similarity for semantic. `ts_rank` / `tsvector` for keyword. Can combine in single query. | Vector (semantic), Full-text (keyword). No BM25 without extensions. | Application-level: run both queries, merge with RRF or weighted average. |
| **ParadeDB** | BM25 scoring via `pg_search` extension alongside pgvector. True hybrid search in PostgreSQL. | BM25 (lexical), vector (semantic). Combined via RRF fusion built-in. | Reciprocal Rank Fusion (RRF) built-in. Configurable weights. |
| **pg_textsearch** | True BM25 ranking for Postgres. Designed to replace `ts_rank`. Integrates with pgvector. | BM25 (keyword), vector via pgvector. | Application-level fusion. RRF or weighted scoring. |
| **LangChain Ensemble** | Weighted combination of multiple retrievers. Pluggable retriever interface. | Any retriever type: BM25, vector, keyword, custom. | Weighted rank fusion. User-defined weights per retriever. |

**Key finding:** The pluggable pipeline abstraction is the right approach for v2.9. Concrete strategy implementations (BM25, temporal decay, MMR diversity) are explicitly deferred to v3.0 when role analysis reveals which strategies each agent role needs. For v2.9, the architecture is: (1) refactor current vector search as the default strategy implementation, (2) define the strategy interface, (3) add per-agent config in YAML, (4) implement score fusion interface for future hybrid use. Pre-compaction knowledge flush is independent of retrieval strategy and addresses a real gap.

For BM25 specifically: Postgres built-in `ts_rank` is adequate for v3.0 implementation. ParadeDB and pg_textsearch are options if higher quality BM25 is needed, but adding extensions increases operational complexity.

**Confidence: HIGH** -- pgvector capabilities verified via existing codebase. Hybrid search patterns verified via multiple authoritative sources.

---

## Table Stakes

Features that must exist for the platform to be considered "complete" before domain modeling (v3.0). Missing any of these means v3.0 agents will encounter capability gaps during role-specific work.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| **Counter-propose in delegation** | Accept/reject covers the common case, but agents sometimes need to negotiate scope. "I can do this but need the API spec first" is a natural response that does not fit accept or reject. Without counter-propose, agents must reject and force the delegator to resubmit with different terms -- wasting turns and tokens. | Medium | v2.7 handshake strategy abstraction (exists) | NEG-01/02. Strategy interface already designed for extensibility. This is a new strategy implementation, not a refactor. Free-text modification with optional structured metadata is sufficient for v1. |
| **Bidirectional clarification during delegation** | Target agent discovers mid-task that it needs more context. Without a clarification channel, it must either guess (risk wrong output) or abort (waste all progress). Every serious delegation protocol needs a "request more info" path. A2A has `input-needed`. FIPA has iterative CFP. | Medium-High | v2.7 multi-type wait_for, signal infrastructure (exists) | NEG-03 through NEG-06. New `task_clarification` signal type. Multi-round support bounded by task timeout. The wait_for + signal infrastructure already handles the mechanics. |
| **Parallel delegation with completion policies** | Sequential delegation is a bottleneck. When an orchestrator needs research from 3 sources or implementation of 3 independent features, doing them sequentially triples the wall-clock time. Fan-out/fan-in is table stakes for workflow orchestration (Temporal, Dapr, Prefect all have it). | High | Phase 1 negotiation (each delegation needs individual handshake) | PAR-01 through PAR-07. The signal aggregation across multiple conversations is the novel piece. `all_required` and `any_sufficient` are the essential policies; `majority` can be additive if complexity is high. |
| **Scheduled agent execution** | Purely reactive agents cannot groom backlogs, run monitoring checks, or perform proactive maintenance. Every workflow system supports cron triggers. pg-boss already supports `schedule()`. The gap is small but the capability is foundational for v3.0 domain agents. | Medium | pg-boss (exists, already initialized with schedule: true) | SCH-01 through SCH-08. Straightforward: register schedules at startup, create synthetic events, process through existing EventRouter. Overlap prevention via `singletonKey`. |
| **Pre-compaction knowledge flush** | History compaction discards context without giving agents a chance to persist important discoveries. An agent that spent 50 tool calls building understanding can lose it all when the history manager prunes. This is a real gap in v2.8's compaction system. | Medium | v2.7 knowledge tools (store/query), v2.8 history manager (exists) | KR-05/06. Inject a turn before compaction prompting the agent to persist important knowledge. Flush count tracking prevents double-flushing. Independent of retrieval strategy changes. |
| **Retrieval strategy abstraction** | Current vector-only search is hardcoded in the knowledge service. v3.0 role analysis will reveal that different agents need different retrieval strategies. Without the pluggable pipeline, every new strategy requires modifying the core knowledge service. | Medium | v2.7 knowledge service (exists) | KR-01 through KR-04. Refactor existing vector search as default strategy. Define interface. Add per-agent config in YAML. Score fusion interface for future hybrid use. No new concrete strategies needed yet. |
| **Persistent agent identity documents** | Agents need accumulated understanding across conversations. A product-agent's product brief evolves over 50 conversations. Without identity documents, agents rediscover context every session -- a real cost at v3.0 scale when domain agents run frequently. | Medium-High | v2.7 knowledge system (conceptually related but architecturally separate) | IDN-01 through IDN-09. Versioned documents injected at conversation start, updated at conversation end. Distinct from knowledge entries (shared atomic facts with expiry). |
| **Context injection at conversation start** | Identity documents are useless if they are not automatically loaded. The agent must begin every conversation with its accumulated understanding. Letta's core memory pattern proves this is essential. | Low-Medium | Phase 7 identity document table | IDN-03. Load agent's identity documents, inject into system prompt. Token budget consideration: identity documents consume context window. |
| **Linear ticket materialization** | Human visibility into agent-to-agent work. Teams using Linear need to see what agents are working on. v2.7 deferred ADEL-02/03 explicitly. Internal-only delegation is invisible to non-technical stakeholders. | Medium | v2.7 delegation, Linear MCP integration (exists) | MAT-01/02. Call `linear:create_issue` MCP tool with task description. |
| **Bidirectional sync for materialized artifacts** | Without sync, materialized tickets become stale immediately. Status changes on the Linear issue must flow back to the internal task, and task completion must update the Linear issue. | Medium-High | Phase 3 materialization + correlation tracking | MAT-03/06. Webhook routing from materialized artifact back to internal task via correlation table. |
| **Tree-level token budget tracking** | Parallel delegation (Phase 2) makes per-conversation budgets dangerous. A fan-out of 5 tasks could each allocate full budgets. Tree-level enforcement prevents runaway costs. v2.7 deferred ASIG-03 explicitly. | High | Phase 2 parallel delegation (budget risk multiplied by parallelism) | BUD-01 through BUD-06. Postgres row-level locking on budget table. Novel territory -- no production framework implements this. |
| **Capability-based sub-agent discovery** | v3.0 will introduce many specialized sub-agents per role. Hardcoded YAML references require updating every orchestrator when adding a sub-agent. Discovery via capability description scales automatically. | Medium | v2.7 entity directory, pgvector embedding pipeline (exists) | DISC-01 through DISC-07. Same pattern as entity directory. Backward compatible: hardcoded `agentId` still works. |

---

## Differentiators

Features that set Aesir apart from other multi-agent platforms. Not strictly required for v3.0, but provide significant value and would be costly to retrofit later.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| **Multi-round clarification (bounded by task timeout)** | Enables true back-and-forth within a single delegation, not just one-shot Q&A. A2A only supports single-round `input-needed`. No other framework supports iterative clarification during delegation. | Medium | Phase 1 clarification signal | NEG-06. Multiple clarification rounds within the task timeout. Deadlock prevention: only one side waits at a time. |
| **Task group completion policies (majority/N-of-M)** | The `majority` policy enables voting patterns: delegate code review to 3 agents, proceed when 2 agree. No mainstream framework offers configurable completion policies for parallel agent groups. | Medium (incremental over all/any) | Phase 2 group infrastructure | `majority` is additive over `all_required` and `any_sufficient`. If the group data model supports configurable policies, adding it is cheap. |
| **Materialization as prompt-level policy** | The same delegation flow creates an internal handoff or a visible Linear ticket based on agent judgment. No other platform offers this as a policy decision. Codex and Copilot Workspace hard-code everything as external artifacts. | Low | Phase 3 materialization interface | MAT-04. The decision to use internal vs. transparent is agent judgment guided by prompts. |
| **Materialization interface (extensible dispatch)** | Makes it trivial to add GitHub Issues or Slack thread materialization later. Strategy pattern costs very little upfront. | Low | Phase 3 materialization | MAT-05. Interface: `materialize(task, target)` -> `{ externalId, externalUrl }`. Only Linear implementation ships in v2.9. |
| **Budget warning signals before exhaustion** | Agents can wrap up gracefully instead of being hard-stopped mid-work. No framework provides proactive budget warnings across delegation trees. | Low-Medium | Phase 4 tree budget infrastructure | BUD-04. Configurable threshold (default 80%). Active conversations receive warning signal. |
| **Budget visibility in task tree dashboard** | Operators can spot runaway costs before they become expensive. Token usage per tree level, per conversation, and total. | Medium | Phase 4 tree budget + Phase 2 task tree view | BUD-05. Visual representation in task tree view. Data flows through event log token counts. |
| **Group cancellation** | When `any_sufficient` is met, the delegator can cancel remaining tasks explicitly. Prevents wasted compute on tasks whose results are no longer needed. Temporal offers cancel-other; most agent frameworks do not. | Low-Medium | Phase 2 group infrastructure | PAR-06. Task status transition to `cancelled` already exists. Iterate remaining tasks and send cancel signals. |
| **Overlap prevention for scheduled runs** | Prevents duplicate scheduled conversations when previous run is still active. Temporal offers configurable overlap policies; pg-boss provides `singletonKey`. | Low | Phase 5 scheduling | SCH-05. `skip` (drop if previous active) or `queue` (wait). Default: `skip`. |
| **Manual schedule trigger (API + dashboard button)** | Testing and ad-hoc execution without waiting for the next cron tick. Essential for operator experience. | Low | Phase 5 scheduling | SCH-07. Express endpoint + dashboard button. |
| **Schedule history and status in dashboard** | Operators need to see when agents last ran and whether they succeeded. | Medium | Phase 5 scheduling | SCH-08. Active schedules, next run time, last run status, run history. |
| **Identity document version comparison in dashboard** | Operators can watch how an agent's understanding evolves over time. Diff view between versions. | Medium | Phase 7 identity documents | IDN-08. Viewable and version-comparable in the dashboard. |
| **Size management with compression prompts** | Prevents identity documents from growing unbounded. When approaching token limit, agent is prompted to summarize/compress. Self-managing, not operator-managed. | Low-Medium | Phase 7 identity documents | IDN-07. Configurable token limits per document type. |
| **Score fusion interface for hybrid retrieval** | Even though only vector ships, the fusion seam makes v3.0 hybrid retrieval a config change, not a refactor. Reciprocal Rank Fusion (RRF) as default. | Low | Phase 8 retrieval abstraction | KR-04. Interface only -- no concrete hybrid strategies in v2.9. |
| **Flush safeguards (dedup, skip for non-knowledge agents)** | Prevents double-flushing and avoids pointless flush turns for agents without knowledge tools. | Low | Phase 8 pre-compaction flush | KR-06. Flush count tracking. Skip if agent has no knowledge tools. Sentinel response detection. |
| **Schedule context injection** | Scheduled agents know why they were triggered: schedule name, last run time, last run outcome. Enables intelligent behavior -- a weekly grooming agent skips already-processed items. | Low | Phase 5 scheduling | SCH-06. Metadata in synthetic event. Injected into initial message. |

---

## Anti-Features

Features to explicitly NOT build in v2.9. Based on anti-patterns from the ecosystem and Aesir's design philosophy.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Concrete BM25/keyword retrieval strategy** | v3.0 role analysis has not happened yet. Building strategies before knowing which agents need them wastes effort and may produce wrong abstractions. The spec explicitly defers this (KRS-01). | Build the pluggable pipeline interface only. Defer concrete strategies to v3.0 when role analysis reveals which strategies each agent role actually needs. |
| **Human directory entries** | Agents must be competent professionals (v3.0) before humans collaborate with them (v3.1). Premature human entries add complexity without real users. Spec defers HUM-01 through HUM-04 explicitly. | Defer to v3.1 as planned. Agent-only directory entries for now. |
| **Per-agent bot users / integration identities** | v2.9 spec explicitly says "do not deepen per-agent external identities." Unified external identity is a v3.0 target per the design vision. | Keep current unified identity model. Multiple agent types share one integration identity. |
| **Automatic identity document generation** | Having the framework auto-generate identity documents from conversation history (like LangMem's background extraction) fights the agent-first philosophy. The agent should decide what its identity documents contain, not a background process. | Agent-managed identity updates via `identity:update` tool. Prompt guidance describes when to update. Framework provides mechanism; agent provides intelligence. |
| **Mandatory identity updates at conversation end** | Forcing identity updates at every conversation end adds latency and cost for conversations that produced nothing worth persisting. | Prompt guidance ("update your identity documents when you learn something significant") plus optional executor reminder. Not mandatory injection. |
| **Dynamic schedule CRUD API** | Schedules come from YAML definitions, not runtime configuration. Runtime schedule management is a v3.1+ concern when operators need to modify agent behavior without redeployment. | Schedules are static from YAML. Manual trigger provides ad-hoc execution. YAML change + restart for schedule modifications. |
| **Cross-tree budget sharing** | Trees should be independent budget units. Sharing budgets across unrelated delegation trees creates unpredictable resource consumption and complex accounting. | Each delegation tree has its own budget. Independent conversations use per-conversation budgets. No cross-tree interference. |
| **Distributed budget enforcement via message passing** | Sophisticated distributed consensus for budget tracking adds enormous complexity. Agents on different workers competing for a shared budget via messages is a distributed systems problem Aesir does not need. | Postgres row-level locking on a `tree_budgets` table row. All budget checks are database transactions. Simple, correct, and fast enough (budget checks are infrequent relative to LLM calls). |
| **External scheduling infrastructure (Temporal, Airflow)** | pg-boss already supports cron scheduling, is already initialized in Aesir, and shares the existing Postgres connection pool. Adding Temporal or Airflow for 5-10 scheduled agents is massive over-engineering. | pg-boss `schedule()` API. Already proven in Aesir (timeout scheduling). Same connection pool, same error handling, same monitoring. |
| **Agent marketplace / dynamic agent registration at runtime** | Allowing agents to register themselves at runtime (A2A Agent Cards pattern, ACDP DNS discovery) adds security, validation, and lifecycle complexity that is unnecessary when all agents are defined in YAML and deployed together. | YAML-based agent definitions seeded at startup. Discovery mechanisms populated from definitions. Runtime registration is a future concern. |
| **Materialization to GitHub Issues or Slack threads** | No real use case exists yet. Linear is the primary work tracking tool. Building multiple materialization targets before demand exists is premature. | Build extensible interface, implement Linear only. GitHub/Slack implementations deferred until there is demand. |
| **Complex materialization sync conflict resolution** | Sophisticated bidirectional conflict resolution (merge strategies, three-way diff) for when humans modify materialized tickets adds major complexity for an edge case. | Status changes sync as signals (human moves ticket to Done -> completion signal to task). Description/priority changes are informational only -- logged but not propagated. Human edits are advisory, not authoritative. |
| **Real-time budget dashboards with WebSocket updates** | Live-updating budget consumption with sub-second refresh is over-engineering. Budget changes with every LLM call but the dashboard does not need real-time updates for monitoring. | Dashboard shows budget on page load and manual refresh. SSE events for conversation status (already exist) suffice for budget exhaustion alerts. |
| **Cross-session learning feedback loops** | Automatically adjusting agent behavior based on historical outcomes (CSL-01) requires real task outcomes from domain-expert agents running real work. Cannot build this before v3.0. | Build the identity document and knowledge infrastructure. Cross-session learning depends on both persistent identity (captures learnings) and knowledge retrieval (retrieves past experience). The infrastructure enables learning; the learning itself is v3.0+. |

---

## Feature Dependencies

```
Phase 1: Richer Negotiation
  |  (counter-propose extends handshake strategy; clarification adds signal type)
  |  Depends on: v2.7 delegation handshake, wait_for, signals [all exist]
  |
  +---> Phase 2: Parallel Delegation
  |       (fan-out needs individual handshakes per delegation)
  |       Depends on: Phase 1 negotiation patterns
  |
  +---> Phase 4: Tree-Level Token Budgets
          (budget risk multiplied by parallel delegation)
          Depends on: Phase 2 group data model

Phase 3: Transparent Materialization [INDEPENDENT]
  Depends on: v2.7 delegation, Linear MCP integration [exist]
  No dependency on Phases 1/2/4 -- materialization applies to both
  sequential and parallel delegation

Phase 5: Scheduled Agent Execution [INDEPENDENT]
  Depends on: pg-boss (exists with schedule:true), EventRouter [exists]
  Zero coupling to negotiation/delegation/budget chain

Phase 6: Sub-Agent Discovery [INDEPENDENT]
  Depends on: entity directory, pgvector embedding pipeline [exist]
  Backward compatible: hardcoded spawn still works

Phase 7: Persistent Agent Identity [INDEPENDENT]
  Depends on: nothing new (conceptually related to knowledge but architecturally separate)
  Shares lifecycle hook mechanism with Phase 8 (whichever builds first
  establishes the pattern)

Phase 8: Knowledge Retrieval Enhancement [INDEPENDENT]
  Depends on: knowledge service, history manager [exist]
  Shares lifecycle hook mechanism with Phase 7
```

**Cross-cutting dependencies:**
- Phases 7 and 8 both inject agent turns at lifecycle boundaries (identity update before completion, knowledge flush before compaction). Whichever is built first should establish the general lifecycle hook mechanism so the other plugs in.
- Phase 4 data model should be designed during Phase 2 (PAR-07), even though enforcement ships in Phase 4.
- Phase 3 correlation tracking reuses patterns from v2.7/v2.8 webhook routing.

---

## Feature-by-Feature Complexity Assessment

### Phase 1: Richer Negotiation

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| Counter-propose response type | Medium | Low | New response type in `task:respond`. Free-text modification + optional structured metadata. Strategy interface exists from v2.7. |
| Counter-propose handshake strategy | Medium | Medium | Delegator handles three outcomes (accept, reject, counter-propose). State machine expands: created -> counter-proposed -> accepted/rejected. |
| `task_clarification` signal type | Low | Low | New signal type string. Signal infrastructure handles arbitrary types. |
| `task:clarify` tool | Medium | Medium | Target sends clarification to delegator's conversation. Requires knowing delegator's conversation ID via task parent chain. |
| Multi-round clarification | Medium | High | Deadlock risk: both conversations waiting for each other. Must ensure only one side waits at a time. Timeout on clarification prevents infinite wait. |
| Prompt guidance for negotiation | Low | Low | When to counter-propose vs. reject, when to clarify vs. proceed with assumptions. |

**Phase complexity: MEDIUM.** Strategy abstraction from v2.7 absorbs most architectural complexity. Risk is in multi-round clarification deadlocks and expanded delegation state machine.

### Phase 2: Parallel Delegation

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| `task:delegate_group` tool | High | Medium | Creates N delegations as a named group. Data model: `task_groups` table. |
| Completion policies (all/any/majority) | Medium | Medium | Policy evaluation when group members complete/fail. |
| Signal aggregation | High | High | Cross-conversation coordination via database state. Race conditions between concurrent completion signals. |
| Partial completion handling | Medium | Medium | `all_required` + one failure: immediate notification. Delegator decides next action. |
| `task:group_status` tool | Low | Low | Read-only query on group state. |
| Group cancellation | Medium | Low | Iterate remaining tasks, send cancel signals. |

**Phase complexity: HIGH.** Signal aggregation across multiple conversations is the hardest part. Each completion signal must be evaluated against the policy, and the delegator must be signaled exactly once when satisfied. Concurrent completion race conditions are the primary risk.

### Phase 3: Transparent Materialization

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| `materialization` parameter | Low | Low | Optional parameter: `internal` (default) or `transparent`. |
| Linear issue creation | Medium | Medium | MCP call with task description, priority, agent assignee. |
| Bidirectional sync | High | High | Webhook events from materialized issue must route to internal task. Correlation table required. |
| Materialization interface | Medium | Low | Extensible dispatch for future targets. Linear first. |
| Correlation tracking | Medium | Medium | `task_materializations` table: task_id, external_system, external_id. |

**Phase complexity: MEDIUM-HIGH.** Linear issue creation is straightforward. Bidirectional sync via webhook correlation is the hard part.

### Phase 4: Tree-Level Token Budgets

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| Tree budget allocation | Medium | Medium | `tree_budgets` table: tree_root_task_id, total_budget, consumed, allocated. |
| Budget propagation | Medium | High | Subtract allocation from remaining on delegation. Race condition: concurrent delegations from same parent. |
| Budget tracking | Medium | Medium | Aggregate token usage across tree conversations. |
| Budget exhaustion signal | High | High | Broadcast warning/stop to all active tree conversations. Races between signal delivery and conversation completion. |
| Dashboard visibility | Medium | Low | Token usage per tree level. Data flows through event log. |

**Phase complexity: HIGH.** Atomic budget accounting across concurrent conversations is the primary challenge. Postgres row-level locking serializes budget checks, but exhaustion signal broadcast is complex.

### Phase 5: Scheduled Agent Execution

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| `schedules` in definition.yaml | Low | Low | New optional field. Validated via Zod. |
| Schedule registration on startup | Medium | Low | Worker loop calls `boss.schedule()` for each. Idempotent. |
| Synthetic event creation | Medium | Medium | pg-boss job creates `IncomingEvent` with `schedule.triggered` type. New trigger type in EventRouter. |
| Overlap prevention | Medium | Medium | Conversation-level check (not just pg-boss job-level). |
| Manual trigger API + dashboard | Low-Medium | Low | Express endpoint + dashboard button. |
| Schedule dashboard view | Medium | Low | Active schedules, next run, last status, history. |

**Phase complexity: MEDIUM.** Core scheduling is straightforward (pg-boss supports it). Nuance in overlap prevention and context injection.

### Phase 6: Sub-Agent Discovery

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| `capabilities` in sub-agent definitions | Low | Low | Same format as orchestrator capabilities. |
| Sub-agent registry | Medium | Medium | Separate table or `tier` discriminator. Same embedding pipeline. |
| Capability-based spawn | Medium | Medium | `spawn_agent` accepts `agentId` or `capability`. Resolution via pgvector. |
| Registry seeding | Low | Low | Same pattern as entity directory seeding. |
| Fallback on no match | Low | Low | Empty result. Agent decides what to do. |

**Phase complexity: MEDIUM.** Pattern is proven (entity directory). Risk is matching quality for imprecise descriptions.

### Phase 7: Persistent Agent Identity

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| Identity document table | Low | Low | Standard schema. agent_id, document_type, content, version. |
| Context injection at start | Medium | Medium | Load + inject into system prompt. Token budget consideration. |
| `identity:update` / `identity:read` tools | Medium | Medium | Versioned writes (append-only). Concurrent update handling (last-write-wins). |
| Size management | Medium | Medium | Token limits per type. Compression prompts. |
| Dashboard visibility | Medium | Low | Version list with diff view. |
| Lifecycle hook mechanism | Medium | Medium | Shared with Phase 8. Must be extensible for multiple hooks. |

**Phase complexity: MEDIUM-HIGH.** Storage is simple. Complexity in lifecycle hooks (shared with Phase 8), concurrent updates, and token budget management for injected documents.

### Phase 8: Knowledge Retrieval Enhancement

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| Strategy abstraction | Medium | Medium | Refactor current vector search as default. Interface definition. |
| Per-agent retrieval config | Low | Low | New optional YAML field. Backward compatible. |
| Strategy registry | Low | Low | Name-to-implementation map. |
| Score fusion interface | Medium | Low | RRF as default. Only used with multiple strategies. |
| Pre-compaction knowledge flush | Medium-High | High | Modify compaction lifecycle (critical path). Infinite loop prevention. Edge case handling. |
| Flush safeguards | Medium | Medium | Count tracking. Skip for non-knowledge agents. Sentinel detection. |

**Phase complexity: MEDIUM.** Abstraction and registry are standard. Pre-compaction flush is the riskiest piece -- modifies a critical path and must handle edge cases cleanly.

---

## MVP Recommendation

### Priority order (accounting for dependencies and v3.0 readiness):

1. **Phase 1 (Richer Negotiation)** -- Unblocks Phase 2. Medium complexity. v3.0 domain agents will negotiate scope constantly. Foundational for richer delegation.

2. **Phase 2 (Parallel Delegation)** -- Unblocks Phase 4. Highest-impact single feature. v3.0 orchestrators need fan-out for research, parallel implementation, concurrent reviews.

3. **Phase 5 (Scheduled Execution)** -- Independent, medium complexity. Breaks the purely reactive model. v3.0 domain agents need periodic execution. Can run in parallel with Phases 1-2.

4. **Phase 7 (Persistent Agent Identity)** -- Independent, establishes lifecycle hook mechanism (shared with Phase 8). v3.0 domain agents need accumulated understanding across sessions. Build before Phase 8.

5. **Phase 8 (Knowledge Retrieval Enhancement)** -- Independent, plugs into lifecycle hook from Phase 7. Pre-compaction flush addresses a real gap. Retrieval abstraction prepares for v3.0 strategies.

6. **Phase 3 (Transparent Materialization)** -- Independent. Immediate value for teams wanting visibility. Bidirectional sync is complex but the pattern is understood from v2.7/v2.8.

7. **Phase 6 (Sub-Agent Discovery)** -- Independent. Most graceful degradation path (hardcoded YAML references still work). Less urgent until v3.0 adds more sub-agents.

8. **Phase 4 (Tree-Level Token Budgets)** -- Depends on Phase 2. Highest complexity. Most risk. Per-conversation budgets are sufficient until parallel delegation creates unbounded cost risk. Build last because it benefits from all prior phases being stable.

### If time pressure forces cuts:

- **Phase 6 (Discovery)** degrades most gracefully -- hardcoded `agentId` in `spawn_agent` still works with 3 sub-agents.
- **Phase 4 (Tree Budgets)** can ship with monitoring-only (aggregate and display tree costs) without enforcement if the signal broadcast proves too complex.
- **`majority` completion policy** in Phase 2 can ship in a follow-up -- `all_required` and `any_sufficient` cover essential patterns.

---

## Sources

### Multi-Agent Negotiation
- [Contract Net Protocol - Wikipedia](https://en.wikipedia.org/wiki/Contract_Net_Protocol) -- HIGH confidence, well-established protocol
- [A2A Protocol - Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/) -- HIGH confidence, official announcement
- [AI Agent Protocols 2026 - ruh.ai](https://www.ruh.ai/blogs/ai-agent-protocols-2026-complete-guide) -- MEDIUM confidence, aggregator
- [Top AI Agent Protocols 2026 - getstream.io](https://getstream.io/blog/ai-agent-protocols/) -- MEDIUM confidence, vendor content

### Parallel Fan-Out / Completion Policies
- [AI Agent Design Patterns - Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- HIGH confidence, Microsoft official
- [Multi-Agent Parallel Execution - Skywork AI](https://skywork.ai/blog/agent/multi-agent-parallel-execution-running-multiple-ai-agents-simultaneously/) -- MEDIUM confidence, vendor blog
- [Deferred Nodes in LangGraph - Changelog](https://changelog.langchain.com/announcements/deferred-nodes-in-langgraph) -- HIGH confidence, official announcement
- [Temporal Workflow Patterns - Keith Tenzer](https://keithtenzer.com/temporal/Temporal_Fundamentals_Workflow_Patterns/) -- MEDIUM confidence, practitioner
- [Workflow Patterns - Dapr Docs](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/) -- HIGH confidence, official docs

### Materialization / External System Sync
- [Linear for Agents](https://linear.app/agents) -- HIGH confidence, official product page
- [Codex in Linear - OpenAI](https://developers.openai.com/codex/integrations/linear/) -- HIGH confidence, official docs
- [Linear-GitHub Integration](https://linear.app/integrations/github) -- HIGH confidence, official integration

### Token Budgets
- [Token Distribution in Multi-Agent Systems - OpenReview](https://openreview.net/pdf?id=0iLbiYYIpC) -- MEDIUM confidence, research paper
- [Budget-Aware Tool-Use - arXiv](https://arxiv.org/html/2511.17006v1) -- MEDIUM confidence, research paper
- [BudgetThinker - OpenReview](https://openreview.net/forum?id=ahatk5qrmB) -- MEDIUM confidence, research paper

### Scheduled Execution
- [pg-boss GitHub](https://github.com/timgit/pg-boss) -- HIGH confidence, official repository
- [pg-boss npm](https://www.npmjs.com/package/pg-boss) -- HIGH confidence, official package
- [Cron Jobs in Postgres - Wasp](https://wasp.sh/blog/2025/05/28/how-to-run-cron-jobs-in-postgress-without-extra-infrastructure) -- MEDIUM confidence, blog

### Agent Discovery
- [Agent Discovery - Agent Communication Protocol](https://agentcommunicationprotocol.dev/core-concepts/agent-discovery) -- HIGH confidence, protocol spec
- [ACDP - cmdzero.io](https://www.cmdzero.io/blog-posts/introducing-the-agent-communication-discovery-protocol-acdp-a-proposal-for-ai-agents-to-discover-and-collaborate-with-each-other) -- MEDIUM confidence, proposal
- [Agent Discovery in Internet of Agents - arXiv](https://www.arxiv.org/pdf/2511.19113) -- MEDIUM confidence, research

### Persistent Agent Memory
- [Memory - CrewAI](https://docs.crewai.com/en/concepts/memory) -- HIGH confidence, official docs
- [AI Agent Memory - Mem0](https://mem0.ai/blog/memory-in-agents-what-why-and-how) -- HIGH confidence, official blog
- [Amazon Bedrock AgentCore Memory](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/) -- HIGH confidence, AWS official
- [Memory in the Age of AI Agents - arXiv](https://arxiv.org/abs/2512.13564) -- HIGH confidence, survey paper
- [Persistent Memory in LLM Agents - emergentmind](https://www.emergentmind.com/topics/persistent-memory-for-llm-agents) -- MEDIUM confidence, aggregator

### Hybrid Search / Retrieval
- [Hybrid Search in PostgreSQL - ParadeDB](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) -- HIGH confidence, official blog
- [pg_textsearch BM25 - Tiger Data](https://www.tigerdata.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres) -- HIGH confidence, official product
- [Hybrid Search with pgvector - Jonathan Katz](https://jkatz05.com/post/postgres/hybrid-search-postgres-pgvector/) -- HIGH confidence, Postgres contributor
- [Optimizing RAG with Hybrid Search - Superlinked](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking) -- MEDIUM confidence, vendor
