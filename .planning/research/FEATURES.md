# Feature Landscape: v2.7 Agent Collaboration

**Domain:** Multi-agent collaboration -- task delegation, shared memory, entity discovery, completion signaling, and triangular validation workflows for an agentic development platform. Plus Linear Agent SDK integration for first-class agent identity.
**Researched:** 2026-02-10
**Overall Confidence:** MEDIUM-HIGH (multi-agent collaboration patterns well-established across CrewAI, LangGraph, AutoGen, A2A protocol; Linear Agent SDK is well-documented with official developer docs; shared memory patterns validated via Letta/MemGPT and pgvector ecosystem; QA agent patterns are emerging but less standardized)
**Context:** v2.7 milestone -- adding multi-agent collaboration to an existing platform with 5 agents, 39 tools, Postgres-backed conversation executor, domain-language communication (reply/ask/notify), and task primitive with hierarchy guardrails. Agents already collaborate indirectly through Linear/GitHub/Slack; this milestone makes collaboration direct and programmatic.

---

## Competitor/Framework Analysis

Before categorizing features, here is what production multi-agent frameworks and agent platforms actually provide for collaboration, delegation, and shared context.

### Multi-Agent Delegation Patterns

| Framework | Delegation Model | Task Routing | Negotiation | State Sharing | Completion Signaling | Status |
|-----------|-----------------|-------------|-------------|---------------|---------------------|--------|
| **CrewAI** | Hierarchical: manager agent decomposes goals and delegates to specialist crew. `allow_delegation=True` gives agents delegation tools. `allowed_agents` parameter (2025) restricts delegation targets. | Sequential (assembly line) or Hierarchical (manager decides). Manager auto-assigned or custom-defined. | None. Manager decides, specialist executes. No accept/reject. Recent bugs with delegation loops when roles are poorly defined. | Shared crew memory via `memory=True`. Long-term memory persists across runs. Short-term memory within execution. Entity memory for key entities. | Task callbacks when individual tasks complete. Manager validates results before accepting. No structured failure/retry signaling. | Production. 27K+ GitHub stars. Delegation disabled by default since 2025 to prevent loops. |
| **LangGraph** | Graph-based: agents are nodes, edges define handoff paths. Supervisor node decides routing. `create_handoff_tool` for swarm-style transfers. | Supervisor pattern (centralized LLM decides next node) or swarm pattern (agents hand off to each other via tools). Conditional edges enable dynamic routing. | None built-in. Handoff is unilateral -- the current agent or supervisor decides. Target agent receives full message history by default. | StateGraph maintains shared state across nodes. Per-agent state isolation possible via typed schemas. Full message history passed on handoff by default; customizable to summarize or filter. | Graph completion when terminal node reached. No explicit completion signaling between agents -- state transitions handle it. Checkpointing enables pause/resume. | Production. 15K+ stars. Most flexible but requires manual wiring. |
| **AutoGen v0.4** | Async event-driven: agents communicate via messages. Supports sequential, concurrent, and hierarchical patterns. Being placed in maintenance mode -- new work targets Microsoft Agent Framework. | Event-driven routing. Agents respond/reflect/call tools based on internal logic. Supports domain-specific sub-agent delegation. | Basic: agents can respond, reflect, or decline in conversation. No structured accept/reject protocol. | Shared conversation history. Agents see all prior messages. No structured shared memory beyond conversation context. | Message-based: completion indicated by specific message content or conversation termination. Human-in-the-loop support for validation. | Maintenance mode. Being superseded by Microsoft Agent Framework (GA Q1 2026). |
| **A2A Protocol (Google)** | Task-oriented: client agent creates task, delegates to remote agent. Agent Cards describe capabilities in JSON. Peer-to-peer, vendor-neutral. | Capability-based discovery via Agent Cards. Client chooses remote agent based on advertised capabilities. Registry, DNS, or direct discovery. | Task lifecycle: submitted, working, input-needed, completed, failed. Client can monitor progress. No counter-propose, but input-needed enables back-and-forth. | Task context passed on creation. No shared memory -- each agent is independent. Task artifacts carry results. | Structured: task states (completed/failed) with artifacts. Client monitors via polling or push. Supports long-running tasks with status updates. | Open standard (2025). 10K+ GitHub stars. Complementary to MCP. |
| **Microsoft Agent Framework** | Convergence of AutoGen + Semantic Kernel. Handoff orchestration pattern with explicit agent transfers. | Supervisor orchestration or handoff-based routing. Agents use structured handoff tools to transfer control. | Handoff includes context summary. Target agent can request additional information. No formal negotiation protocol. | Shared context passed via handoff. Per-agent conversation state. Orchestrator maintains global state. | Event-driven completion with callbacks. Supervisor receives completion notification. | Pre-GA (targeting Q1 2026). |

**Key insight:** No mainstream framework implements a structured negotiation handshake (accept/reject/counter-propose) for delegation. CrewAI's manager just assigns work. LangGraph's supervisor routes without asking. A2A comes closest with task lifecycle states, but the "input-needed" state is for clarification, not negotiation. Aesir's planned negotiation handshake is genuinely novel in the open-source space -- a differentiator, not table stakes. However, this novelty also means there are no proven patterns to follow, making it higher risk.

**Confidence: MEDIUM-HIGH** -- CrewAI, LangGraph, AutoGen patterns verified via official docs and recent GitHub activity. A2A protocol verified via Google's developer blog and official spec. Microsoft Agent Framework status verified but detailed API still pre-GA.

### Linear Agent SDK Interaction Model

| Feature | Implementation | API Surface | Notes |
|---------|---------------|-------------|-------|
| **Agent Identity** | `actor=app` OAuth parameter. Agent gets its own workspace identity (name, icon). Not a billable user. | OAuth2 authorization with `actor=app`. Scopes: `app:assignable`, `app:mentionable`. `viewer { id }` query returns app's workspace ID. | Eliminates echo problem entirely -- agent activities are structurally distinct from user actions. |
| **Agent Sessions** | Tracks lifecycle of an agent task. Created automatically on mention/delegation. 5 states: `pending`, `active`, `awaitingInput`, `error`, `complete`. | `agentSessionCreateOnIssue`, `agentSessionCreateOnComment` mutations for proactive creation. Session state updated automatically from emitted activities. | Must emit `thought` activity within 10 seconds of session creation or marked unresponsive. Webhook receiver must respond within 5 seconds. |
| **Agent Activities** | 5 types: `thought` (reasoning), `elicitation` (request clarification), `action` (tool invocation), `response` (completion), `error` (failure). `prompt` type is user-only. | `agentActivityCreate` / `linearClient.createAgentActivity()`. Content is typed JSON. `thought` and `action` can be ephemeral. | Activities drive session state transitions automatically. No manual state management needed. |
| **Agent Plans** | Session-level checklists with evolving tasks. Each step: `content`, `status` (pending/inProgress/completed/canceled). | `agentSessionUpdate` mutation with plan array. Must replace entire plan on update (or use `addedExternalUrls`/`removedExternalUrls` for URLs). | Provides structured progress visibility. Good for multi-step workflows. |
| **External URLs** | Link sessions to external dashboards. Array of `{ label, url }` objects. PR URLs unlock future PR-related features. | `agentSessionUpdate` mutation with `externalUrls` field. Supports add/remove operations. | Bridge between Linear sessions and Aesir dashboard/GitHub PRs. |
| **Repository Suggestions** | LLM-ranked repo matches for an issue using issue context + agent guidance. | `issueRepositorySuggestions` query. Agent provides candidate repos, Linear returns filtered + ranked with confidence scores. | Useful for dev-agent to determine which repo to work in. Leverages Linear's internal context signals. |
| **Webhooks** | `AgentSessionEvent` with actions: `created` (new session), `prompted` (user follow-up). `promptContext` field provides formatted issue context. | Webhook subscription in OAuth config. `created` action triggers new agent loop. `prompted` action triggers follow-up handling. | Subscribing to `AgentSessionEvent` enables Agent Session UI for all workspace users -- consider timing. |

**Key insight:** Linear's Agent SDK is remarkably well-designed for Aesir's use case. The session lifecycle maps cleanly to Aesir's conversation lifecycle (`pending`=`queued`, `active`=`running`, `awaitingInput`=`waiting`, `error`=`failed`, `complete`=`completed`). Activity types map cleanly to communication tools (`reply`->`response`, `ask`->`elicitation`). The echo elimination is architecturally superior to the current `LINEAR_BOT_USER_ID` filtering approach. Agent Plans provide progress visibility that Aesir doesn't currently expose.

**Confidence: HIGH** -- All details verified against Linear's official developer documentation at linear.app/developers/agents and linear.app/developers/agent-interaction.

### Shared Memory / Knowledge Store Patterns

| System | Memory Architecture | Shared Memory | Storage | Key Pattern |
|--------|-------------------|---------------|---------|-------------|
| **Letta/MemGPT** | Three-tier: core memory (in-context blocks), conversational memory (searchable history), archival memory (vector DB). Agents actively self-manage memory via tools (`memory_replace`, `memory_insert`, `memory_rethink`). | Conversations API (Jan 2026) enables shared memory across parallel agent experiences. Memory blocks can be shared between agents. | pgvector for archival (semantic search), Postgres for structured, filesystem for documents. | Agent-managed memory: the agent decides when and what to remember/forget, not external orchestration. This aligns with Aesir's agent-first philosophy. |
| **LangChain/LangMem** | Long-term memory backed by Postgres + pgvector. Background memory processing (async extraction). Semantic memory as a database of facts agents can search. | Shared via common database. Multiple agents can read/write to the same memory store. No built-in conflict resolution. | Postgres + pgvector. Embeddings generated at write time. Hybrid search (semantic + keyword). | Background processing: memory extraction happens asynchronously, not blocking agent execution. Useful for reducing latency on memory operations. |
| **Cairn MCP** | Three-tier knowledge capture with DBSCAN clustering. Hybrid semantic search. LLM enrichment for stored memories. | Shared via MCP server. Any agent with MCP access can query the memory store. | PostgreSQL + pgvector. Clustering for pattern discovery. | MCP-based access: memory as a tool service, not a library. Clean boundary between agent and memory system. |
| **CrewAI Memory** | Short-term (within execution), long-term (across runs), entity memory (key entities). Configurable per crew via `memory=True`. | Shared within a crew. Long-term memory persists across crew runs. Not shared across different crew definitions. | Configurable backend. Default uses local storage. Enterprise supports custom backends. | Crew-scoped sharing: memory is shared within a collaboration group, not globally. Useful scoping model. |
| **Custom Postgres** | Unified database: episodic events, semantic knowledge, procedural state in PostgreSQL. Hybrid vector + structured queries. | Direct database access. All agents query same tables. Application-level access control. | PostgreSQL + pgvector. Optional Neo4j for graph relationships. | Simplicity: no additional infrastructure. Postgres handles both structured queries and semantic search via pgvector. |

**Key insight:** The dominant pattern for agent memory in 2025-2026 is Postgres + pgvector for semantic search, with agents managing their own memory via tools (not external orchestration). Letta's "agent-managed memory" pattern aligns perfectly with Aesir's agent-first philosophy -- the agent decides what to remember, not the framework. The spec's `knowledge:store` / `knowledge:query` tools follow this established pattern. The key decision is scope: per-agent (private notepad), per-workspace (shared knowledge), or per-project. The spec already distinguishes private notepad from shared knowledge, which matches Letta's core-memory vs archival-memory distinction.

**Confidence: MEDIUM-HIGH** -- Letta/MemGPT patterns verified via official docs. pgvector capabilities verified via Postgres ecosystem. CrewAI memory verified via official docs. Custom patterns aggregated from multiple sources.

### Agent Observability and Tracing

| Platform | Tracing Model | Multi-Agent Support | Visualization | Status |
|---------|---------------|-------------------|---------------|--------|
| **LangSmith** | Trace-span hierarchy. Traces contain runs (spans) with inputs/outputs/tool calls. | Supports multi-agent traces with parent-child run relationships. Cross-agent tracing via shared trace IDs. | Timeline view, trace tree, LLM call details. Production monitoring + evaluation. | Production. Tight LangChain/LangGraph integration. |
| **Arize Phoenix** | OpenTelemetry-based. Traces, spans, generations, tool calls, retrievals. | Multi-agent traces with hierarchical spans. Agent handoffs visible as span transitions. | Trace waterfall, dependency graph, performance metrics. | Production. Open-source. |
| **Maxim AI** | Integrated testing + monitoring. Pre-release testing connected to production monitoring. | Multi-agent flow tracing with agent interaction maps. | Dashboard with agent interaction maps, delegation flows, signal tracing. | Production (2025). |
| **OpenTelemetry (semantic conventions)** | Standardized conventions for AI agent observability. Framework-agnostic. | Common instrumentation across CrewAI, AutoGen, LangGraph. Distributed tracing across agent boundaries. | Depends on backend (Jaeger, Zipkin, etc.). Standard span attributes for agent operations. | Emerging standard (2025). |

**Key insight:** Over 75% of multi-agent systems become difficult to manage past 5 agents due to exponential monitoring complexity. Aesir's approach of building observability into the dashboard (task tree view, delegation timeline, signal flow) is the right call -- external observability platforms add integration overhead without understanding Aesir's task/conversation model. The task tree structure from the spec provides the data model; the dashboard visualization is the key deliverable.

**Confidence: MEDIUM** -- Platform capabilities verified via official docs and marketing materials. The "75% of systems" statistic is from a single industry report and should be treated as directional, not precise.

---

## Table Stakes

Features users expect from a multi-agent collaboration system. Missing = the system feels like independent agents pretending to collaborate.

| Feature | Why Expected | Complexity | Existing in Aesir | Notes |
|---------|--------------|------------|-------------------|-------|
| **Task delegation between agents** | Core primitive. Agents must be able to assign work to other agents. Every multi-agent framework supports this (CrewAI hierarchical, LangGraph handoffs, A2A tasks). Without it, "collaboration" is just sequential execution with manual handoffs. | High | Partial -- task primitive exists, but delegation is manual (via Linear tickets + human assignment). | DEL-01 through DEL-07 in spec. The key gap is programmatic agent-to-agent delegation without human intermediary. |
| **Completion notification** | The delegating agent must know when delegated work finishes. Blocking without notification = wasted compute. Every framework handles this (callbacks, state transitions, event-driven). | Medium | Partial -- `wait_for` + signal infrastructure exists. Completion-driven signaling is new. | SIG-01 through SIG-07 in spec. Foundation (`wait_for`, signals) is solid. Task-lifecycle-driven signals are the new piece. |
| **Shared context / knowledge** | Agents in a delegation chain need shared context to avoid redundant work. Every framework provides some form of shared state (CrewAI memory, LangGraph StateGraph, A2A task context). | High | No. Each conversation is isolated. Task handoffs carry some context, but no persistent queryable store. | MEM-01 through MEM-07 in spec. This is the most impactful table-stakes feature -- without it, agents waste significant token budget re-discovering known facts. |
| **Agent identity in external tools** | Agents using business tools (Linear, GitHub, Slack) must be identifiable as agents, not impersonating users. Users need to know who (or what) is acting. | Medium | No. Agent actions appear as the installing user's OAuth identity. Echo filtering is a symptom. | LSDK-01 through LSDK-07 in spec. Linear Agent SDK solves this cleanly. GitHub and Slack identities are separate concerns (not in v2.7 scope). |
| **Progress visibility** | When an agent is working on a delegated task, the user (and delegating agent) need to see progress. Opaque long-running tasks erode trust. | Low-Med | Partial -- conversation events exist but not exposed as structured progress. | Linear's Agent Plans feature provides checklist-style progress. Aesir dashboard shows conversation status. Gap: structured progress updates during delegation chains. |
| **Failure handling in delegation** | When a delegated task fails, the delegating agent must be notified and able to retry, escalate, or pivot. Silent failures are unacceptable. | Medium | Partial -- conversation failures are tracked. Task-level failure signaling to delegators is new. | SIG-02 in spec. Critical for reliability. Without it, delegation chains silently break. |
| **Entity/capability discovery** | For delegation to work, agents must know who can help. Hardcoded routing (only product-agent can talk to dev-agent) is fragile and doesn't scale. | Medium | No. Agent definitions are YAML files on disk. No queryable registry. | DIR-01 through DIR-06 in spec. The directory is what makes delegation dynamic rather than hardcoded. |

---

## Differentiators

Features that set the collaboration system apart. Not expected by default, but valued by teams that adopt multi-agent workflows.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Negotiation handshake** | No mainstream framework implements accept/reject/counter-propose for delegation. Agents negotiate terms (estimate, capacity, scope) before committing. Prevents wasted work on tasks the target cannot or should not do. | High | DEL-03, DEL-04 in spec. Genuinely novel. The strategy abstraction interface is well-designed for extensibility. Risk: higher complexity for uncertain payoff at v1 scale (only 5 agents). Start with simple accept/reject, leave counter-propose for later. |
| **Materialization as policy** | Whether delegation creates a Linear ticket, a Slack thread, or stays purely internal is a prompt-level decision, not architecture. Same delegation primitive, different visibility. No other framework offers this separation. | Medium | DEL-05, DEL-06 in spec. Powerful for teams with different transparency preferences. A regulated team might want every delegation as a ticket; a fast-moving team might want internal-only until something ships. |
| **Bidirectional clarification during delegation** | Target agent can signal back to the delegator requesting more information without completing or failing the task. Delegator wakes, responds, pauses again. Enables true back-and-forth collaboration, not just fire-and-forget. | High | SIG-05 in spec. This is where Aesir's `wait_for` + signal infrastructure pays off. Most frameworks only support unidirectional delegation (assign and wait for result). |
| **Knowledge classification and lifecycle** | Knowledge entries are typed (discovery, architecture_decision, constraint, thought) with metadata (confidence, expiry, author). Stale facts expire. Contradictory facts are flagged. Beyond simple key-value memory. | Medium-High | MEM-01, MEM-07 in spec. Letta supports agent-managed memory but doesn't classify by knowledge type. The classification taxonomy enables smarter queries ("show me all architecture decisions for the auth module") and lifecycle management (constraints expire when a refactor ships). |
| **Human-agent unified directory** | The entity directory contains both agents and humans, queryable by the same capability interface. An agent asking "who can approve architecture decisions?" gets humans. "Who can implement code?" gets dev-agent. Same tool, same protocol. | Medium | DIR-01, DIR-03 in spec. Most frameworks treat agents and humans as fundamentally different. The unified directory means delegation tools work identically regardless of recipient type -- only materialization differs. |
| **Delegation graph observability** | Task tree visualization, delegation timeline, cross-conversation tracing, signal flow visualization. Purpose-built for understanding multi-agent work, not generic LLM tracing. | Medium-High | OBS-01 through OBS-05 in spec. External observability platforms (LangSmith, Arize) provide generic trace trees. Aesir's dashboard can provide domain-specific views (task tree, delegation chain, signal flow) that understand the business domain. |
| **Triangular validation workflow** | QA agent closes the feedback loop: product defines requirements, dev implements, QA validates, failures delegate back to dev. Three-party collaboration exercises every primitive. | High | QA-01 through QA-07 in spec. This isn't just a feature -- it's the validation vehicle for the entire collaboration system. The triangular workflow exercises directory queries, delegation handshakes, materialization, completion signaling, clarification signals, shared memory, and delegation depth. |
| **Graceful degradation** | Collaboration enhances but isn't required. If the directory is unreachable, agents work solo. If memory is down, agents pay higher token cost but still function. Each primitive is best-effort. | Low-Med | Design constraint in spec. This is unusual -- most multi-agent frameworks assume all components are available. Graceful degradation means collaboration can be adopted incrementally without all-or-nothing deployment. |

---

## Anti-Features

Features to explicitly NOT build. Based on anti-patterns observed across CrewAI, AutoGen, LangGraph, and the broader multi-agent ecosystem.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Central orchestrator agent** | CrewAI's hierarchical manager pattern creates a bottleneck: all work flows through one agent that must understand every task type. The manager becomes a single point of failure, and adding new agents requires updating manager logic. Research shows this pattern has 200%+ token overhead due to coordination reasoning. Additionally, poorly defined managers cause infinite delegation loops (CrewAI's most common bug report). | **Peer-to-peer delegation with directory discovery.** Agents discover and delegate directly to capable peers. No central router for agent-to-agent work. The directory provides discovery; the agents provide judgment. This matches Aesir's agent-first philosophy. |
| **Full message history passing on handoff** | LangGraph's default: pass all messages to the next agent on handoff. This wastes context window, leaks irrelevant information, and scales poorly with delegation depth. By level 3 of delegation, the working agent has a context window full of upstream conversation that isn't relevant to its task. | **Task description + shared memory references.** Delegated tasks carry a focused brief (task description, expectations, relevant knowledge references). The target agent queries shared memory for additional context as needed. Self-service, not broadcast. |
| **Consensus protocols between agents** | Multi-agent consensus (agents vote on decisions, majority wins) adds enormous complexity and token cost for marginal benefit. Research papers explore it; production systems avoid it. Agents disagreeing on a fact should flag for human review, not vote on truth. | **Single-authority delegation.** The delegating agent owns the decision. If a task fails, the delegator decides what to do (retry, escalate, pivot). No committee decisions. The negotiation handshake provides the target's input; the delegator has final authority. |
| **Agent-to-agent chat channels** | Persistent chat channels between agents (like Slack channels but for bots). Massive token waste, hard to debug, no clear ownership of decisions, and creates coupling between agents that should be independent. | **Task-scoped communication.** All inter-agent communication happens through task delegation and completion signals. Clarification signals (SIG-05) handle back-and-forth within a task scope. No persistent chat. |
| **Automatic delegation without judgment criteria** | CrewAI disabled `allow_delegation` by default because agents over-delegate -- they delegate work they could do themselves, creating management overhead without productivity gain. The "management layer" anti-pattern: an agent spends more tokens coordinating than it would spend just doing the work. | **Delegation judgment guidance in prompts.** Agent prompts include criteria for when delegation is worth the overhead vs. doing the work directly (DEL-07). The agent weighs the cost of delegation (handshake, context passing, waiting) against just doing it. |
| **Complex taxonomy with many knowledge types** | Over-classifying knowledge entries (20+ types) leads to miscategorization, inconsistent tagging, and queries that return nothing because the wrong type was specified. Agents are imprecise classifiers. | **Small, extensible taxonomy.** Start with 4-5 types (discovery, architecture_decision, constraint, preference, fact). Let usage patterns reveal if more types are needed. The taxonomy should be a tool for retrieval, not a comprehensive ontology. |
| **Real-time agent presence/availability** | Tracking which agents are currently busy, idle, or available adds infrastructure complexity (heartbeats, capacity tracking, load balancing) for minimal benefit when you have < 10 agent types. | **Assume always-available for v1.** Agents are services, not employees. The conversation executor handles concurrency. If an agent type is overloaded, that's an infrastructure scaling problem, not a directory problem. Add availability tracking when there are enough agents for it to matter. |
| **Cross-workspace collaboration** | Agents in different workspaces collaborating on shared tasks. Adds authentication, authorization, and data isolation complexity that isn't needed for a single-team tool. | **Single-workspace scope for v1.** All entities in the directory belong to one workspace. The schema should accommodate multi-workspace later (entity IDs are globally unique), but don't build the routing. |

---

## Feature Dependencies

```
Linear Agent SDK (Phase 70)
  |
  +---> Entity Directory (Phase 72) [agent identity must exist before directory exposes agents]
  |       |
  |       +---> Task Delegation (Phase 73) [agents need to discover who to delegate to]
  |               |
  |               +---> Completion Signaling (Phase 74) [signals need tasks to signal about]
  |                       |
  |                       +---> Delegation Graph Observability (Phase 75) [full lifecycle must exist before visualization]
  |                               |
  |                               +---> QA Agent + Validation Workflow (Phase 76) [exercises all primitives]
  |
Shared Memory (Phase 71) [independent, parallel with Phase 70]
  |
  +---> Informally feeds into Phase 73+ (agents use knowledge:store/query during delegation)
```

**Cross-cutting dependencies not in the linear chain:**
- Shared Memory (Phase 71) has no hard dependency on other phases but becomes increasingly valuable as delegation chains grow. Agents in Phase 73+ will use `knowledge:store` and `knowledge:query` to pass context and accumulate institutional knowledge.
- Entity Directory (Phase 72) seeds from agent YAML definitions (existing) and a human config file (new). The directory is read-heavy after initial seed -- no complex write patterns.
- Completion Signaling (Phase 74) builds on existing `wait_for` + signal infrastructure. The new piece is task-lifecycle-driven signal dispatch, not new signal mechanics.

---

## Feature-by-Feature Complexity Assessment

### Phase 70: Linear Agent SDK

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| OAuth `actor=app` re-authorization | Low | Low | Well-documented. Parameter addition to existing OAuth flow. |
| New scopes (`app:assignable`, `app:mentionable`) | Low | Low | Standard OAuth scope addition. |
| Agent activity MCP tools | Medium | Low | Replace `create_comment` with `createAgentActivity`. 5 activity types to map. TypeScript SDK has clean API. |
| Session ID tracking through replyContext | Medium | Medium | Session ID must flow from webhook through adapter through conversation through replyContext through denormalizer. Longest data flow in the phase. |
| Communication tool to activity type mapping | Low | Low | Clean 1:1 mapping: `reply`->`response`, `ask`->`elicitation`, reasoning->`thought`. |
| `agent_session.prompted` event handling | Medium | Low | Replaces `comment.created` for active sessions. Adapter needs to detect session context. |
| Echo filter removal | Low | Low | Delete code. Agent activities and user prompts are structurally distinct. |
| Agent Plans integration | Low-Med | Low | Optional enhancement. Checklist-style progress updates mapped from task steps. |

**Phase complexity: MEDIUM.** Well-defined API surface, clear mapping to existing abstractions. Main risk is session ID propagation through multiple layers.

### Phase 71: Shared Memory

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| Knowledge schema + classification taxonomy | Medium | Medium | Schema design affects everything downstream. Start with 4-5 types. pgvector extension required for semantic search. |
| Private agent notepad | Low-Med | Low | Per-agent scoped. Simpler than shared knowledge -- no cross-agent visibility, no semantic search needed. |
| `knowledge:store` / `knowledge:query` / `knowledge:update` tools | Medium | Low | Standard MCP tool pattern. Query needs to support type filtering + semantic search. |
| Scope and permission configuration | Medium | Medium | User-configurable policies. Risk: over-engineering permissions before usage patterns emerge. Start with simple defaults (discoveries shared, thoughts private). |
| Vector search via pgvector | Medium | Medium | Embedding generation (which model? when?), index creation, query performance. pgvector is mature but embedding pipeline adds a dependency. |
| Knowledge lifecycle (expiry, supersession, invalidation) | Medium | Low | Time-based expiry is simple. Supersession requires duplicate detection. Invalidation is manual (agent or human). |

**Phase complexity: MEDIUM-HIGH.** The storage layer is straightforward (Postgres + pgvector). The harder parts are: embedding generation pipeline, classification taxonomy that agents actually use correctly, and scope/permission policies that don't over-constrain.

### Phase 72: Entity Directory

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| Entity table + schema | Low | Low | Standard Postgres table. Agents and humans as rows with type discriminator. |
| Agent seeding from YAML | Low | Low | Read existing definitions, extract capabilities, seed to table. Run on deploy. |
| Human entries from config | Low | Low | JSON/YAML config file or seed script. Name, role, capabilities, reachVia. |
| `directory:find` (capability-based query) | Medium | Medium | The matching quality determines the feature's value. Options: keyword search (simple but brittle), pg_trgm similarity (good for fuzzy text), pgvector semantic similarity (best but adds embedding dependency). If Phase 71 already has pgvector, reuse the embedding pipeline. |
| `directory:get` (entity detail) | Low | Low | Simple lookup by ID. |

**Phase complexity: LOW-MEDIUM.** The directory is fundamentally a lookup service. Capability matching quality is the only meaningful risk -- and it can start with text search and upgrade to semantic later.

### Phase 73: Task Delegation

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| `task:delegate` tool | Medium | Medium | Creates task targeting a directory entity. Must pass context, set expectations, initiate materialization. |
| Task tree structure (`parentTaskId`) | Low | Low | Single foreign key. Tree queries via recursive CTE. |
| Negotiation handshake (accept/reject) | High | High | This is the novel piece. Target agent must receive delegation, reason about it, and respond. Strategy abstraction adds interface complexity. Start simple: accept + estimate or reject + reason. |
| Materialization layer | Medium-High | Medium | Agent target: start conversation with task context. Human target: Slack message with context. Each target type needs its own materialization strategy. |
| Materialization as policy | Medium | Low | Prompt-level configuration. The materialization layer needs a policy lookup, but the actual branching is simple. |
| Delegation judgment guidance | Low | Low | Prompt engineering. Criteria for when to delegate vs. do it yourself. |

**Phase complexity: HIGH.** The negotiation handshake is the hardest part of the entire milestone. It requires: (1) creating the task, (2) starting/signaling the target, (3) the target reasoning about acceptance, (4) routing the response back to the delegator, (5) the delegator acting on the response. This is a multi-turn protocol across two conversations.

### Phase 74: Completion Signaling

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| `callbackConversationId` on tasks | Low | Low | Column addition. Set during delegation, read during signal dispatch. |
| Task completion signal dispatch | Medium | Medium | When task status changes to complete, fire signal to callback conversation. Must handle: conversation still waiting, conversation already completed, conversation errored. |
| Task failure signal | Medium | Low | Same mechanism as completion, different payload. |
| Clarification signal (bidirectional) | High | High | Target signals delegator for more info. Delegator wakes, responds, pauses again. This is the most complex signaling pattern -- requires both conversations to coordinate. |
| Expectation-based timeout | Medium | Low | Existing pg-boss timeout infrastructure. Set timeout from handshake estimate. |
| Orphan handling | Medium | Medium | Callback conversation no longer active. Must log, not lose data. Dashboard visibility for orphaned completions. |

**Phase complexity: MEDIUM-HIGH.** The foundation (`wait_for`, signals, pg-boss timeouts) exists. The new complexity is task-lifecycle-driven signal dispatch and bidirectional clarification. The clarification signal is the hardest piece -- it's essentially a mini-conversation protocol layered on top of the existing signal infrastructure.

### Phase 75: Delegation Graph Observability

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| Task tree API endpoints | Low-Med | Low | Recursive CTE queries. Aggregate status, timestamps, entity assignments. |
| Dashboard task tree view | Medium | Low | Next.js component. Tree rendering with expandable nodes. Status indicators. |
| Delegation timeline | Medium | Low | Chronological event list. Filter by task tree. |
| Cross-conversation trace view | Medium | Medium | Click-through from task to conversation. Requires linking task IDs to conversation IDs. |
| Signal flow visualization | Medium-High | Medium | Edges between conversations representing signals. Timeline view with signal delivery timestamps and payloads. |
| Health indicators | Medium | Low | Pattern detection: orphans, timeouts, rejection chains, excessive depth. Queries against existing data. |

**Phase complexity: MEDIUM.** Mostly dashboard work (React components, API endpoints). The data model exists from prior phases. Risk is UX design -- making delegation graphs comprehensible, not just technically correct.

### Phase 76: QA Agent + Validation Workflow

| Feature | Complexity | Risk | Notes |
|---------|-----------|------|-------|
| QA agent definition | Low-Med | Low | YAML + prompt.md. Standard agent definition pattern. |
| Core QA tools (run tests, check PR, review) | Medium-High | Medium | Running tests requires sandbox access. PR diff review requires GitHub integration. Requirements matching requires shared memory or task context. |
| Collaboration wiring | Medium | Low | Standard collaboration tools (directory, delegation, knowledge, communication). The QA agent is a consumer of infrastructure built in Phases 71-74. |
| Feedback loop (fail -> delegate fix -> retest) | High | High | Multi-step workflow: QA fails -> delegates fix to dev -> dev fixes -> dev delegates re-verification to QA -> QA passes -> completion chain unwinds. This exercises delegation depth (3 levels), feedback loops, and completion signaling cascades. |
| End-to-end validation test suite | High | Medium | Integration tests for the full triangular workflow. Requires all prior phases working. Test infrastructure for multi-agent scenarios is non-trivial. |

**Phase complexity: HIGH.** The QA agent itself is straightforward. The validation workflow is complex because it exercises every collaboration primitive simultaneously. Failures in prior phases surface here as integration test failures.

---

## MVP Recommendation

### Prioritize (in dependency order):

1. **Linear Agent SDK (Phase 70)** -- Table stakes for agent identity. Eliminates the echo problem permanently. Unlocks Linear's first-class agent UX. Low-medium complexity with high-confidence API surface. Ship this first; it provides value independently of collaboration features.

2. **Shared Memory (Phase 71)** -- Table stakes for collaboration efficiency. Without shared context, delegation chains waste tokens re-discovering known facts. Can run in parallel with Phase 70. Start with pgvector in Postgres (no additional infrastructure). Simple taxonomy (4-5 types). Agent-managed via tools.

3. **Entity Directory (Phase 72)** -- Enabler for dynamic delegation. Low complexity, high leverage. Without it, delegation targets must be hardcoded. With it, agents discover capabilities at runtime.

4. **Task Delegation with simple handshake (Phase 73)** -- Core collaboration primitive. For v1, implement accept/reject only (no counter-propose). Materialize to internal conversations for agents and Slack for humans. Defer Linear ticket materialization to prompt-level policy.

5. **Completion Signaling (Phase 74)** -- Closes the delegation loop. Without it, delegation is fire-and-forget. Focus on completion and failure signals first. Defer bidirectional clarification to a follow-up if complexity is too high.

### Defer:

- **Counter-propose in negotiation handshake**: The accept/reject pattern covers 90% of delegation scenarios. Counter-propose adds significant protocol complexity for an edge case that can be handled by rejecting + the delegator trying a different approach. Implement the strategy abstraction interface so counter-propose can be added later without refactoring.

- **Bidirectional clarification signal (SIG-05)**: If Phase 74 becomes too complex, defer this to a fast-follow. The delegator can include sufficient context upfront (via task description + knowledge references) to reduce the need for mid-task clarification. The `wait_for` + signal infrastructure supports it -- the complexity is in the multi-conversation coordination.

- **Semantic capability matching in directory**: Start with text similarity (pg_trgm) for `directory:find`. With only 5-6 entity types, exact and fuzzy text matching is sufficient. Upgrade to vector-based semantic matching when the directory grows past ~20 entities or when matching quality degrades.

- **Production QA agent scope**: The QA agent in Phase 76 is a validation vehicle, not a production-grade testing system. Document the expansion path (continuous test monitoring, regression detection, test coverage analysis) for v2.8 but don't build it now.

---

## Sources

### Linear Agent SDK
- [Getting Started - Linear Agents](https://linear.app/developers/agents) -- HIGH confidence, official docs
- [Developing the Agent Interaction - Linear Developers](https://linear.app/developers/agent-interaction) -- HIGH confidence, official docs
- [Agent Interaction Guidelines and SDK - Changelog](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk) -- HIGH confidence, official changelog
- [Our approach to building the Agent Interaction SDK](https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk) -- HIGH confidence, official blog

### Multi-Agent Frameworks
- [CrewAI Documentation - Collaboration](https://docs.crewai.com/en/concepts/collaboration) -- HIGH confidence, official docs
- [CrewAI Hierarchical Delegation PR #2068](https://github.com/crewAIInc/crewAI/pull/2068) -- HIGH confidence, official GitHub
- [LangGraph Multi-Agent Documentation](https://docs.langchain.com/oss/python/langchain/multi-agent) -- HIGH confidence, official docs
- [LangGraph Supervisor Repository](https://github.com/langchain-ai/langgraph-supervisor-py) -- HIGH confidence, official GitHub
- [AutoGen - Microsoft Research](https://www.microsoft.com/en-us/research/project/autogen/) -- HIGH confidence, official source
- [A2A Protocol - Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/) -- HIGH confidence, official announcement
- [Multi-Agent Frameworks Explained for Enterprise AI Systems 2026](https://www.adopt.ai/blog/multi-agent-frameworks) -- MEDIUM confidence, aggregator

### Shared Memory / Knowledge
- [Letta Memory Documentation](https://docs.letta.com/guides/agents/memory/) -- HIGH confidence, official docs
- [MemGPT Concepts - Letta Docs](https://docs.letta.com/concepts/memgpt/) -- HIGH confidence, official docs
- [Agent Memory: How to Build Agents that Learn and Remember - Letta Blog](https://www.letta.com/blog/agent-memory) -- HIGH confidence, official blog
- [Cairn MCP - Semantic memory for AI agents](https://github.com/jasondostal/cairn-mcp) -- MEDIUM confidence, open source project

### Observability
- [Agent Tracing for Debugging Multi-Agent AI Systems](https://www.getmaxim.ai/articles/agent-tracing-for-debugging-multi-agent-ai-systems/) -- MEDIUM confidence, vendor content
- [Agent Observability and Tracing - Arize](https://arize.com/ai-agents/agent-observability/) -- MEDIUM confidence, vendor content

### Agent Discovery and Protocols
- [Agent Communication & Discovery Protocol (ACDP)](https://www.cmdzero.io/blog-posts/introducing-the-agent-communication-discovery-protocol-acdp-a-proposal-for-ai-agents-to-discover-and-collaborate-with-each-other) -- MEDIUM confidence, proposal
- [Agent Discovery - A2A Protocol](https://a2a-protocol.org/latest/topics/agent-discovery/) -- HIGH confidence, protocol spec
- [Microsoft Multi-Agent Reference Architecture](https://microsoft.github.io/multi-agent-reference-architecture/docs/reference-architecture/Reference-Architecture.html) -- MEDIUM confidence, reference architecture

### Anti-Patterns and Pitfalls
- [Choosing the right orchestration pattern for multi agent systems - Kore.ai](https://www.kore.ai/blog/choosing-the-right-orchestration-pattern-for-multi-agent-systems) -- MEDIUM confidence, vendor blog
- [Multi-Agent AI Orchestration: Enterprise Strategy 2025-2026](https://www.onabout.ai/p/mastering-multi-agent-orchestration-architectures-patterns-roi-benchmarks-for-2025-2026) -- MEDIUM confidence, industry analysis
- [AI Agent Design Patterns - Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- HIGH confidence, Microsoft official docs
