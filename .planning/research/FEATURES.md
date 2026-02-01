# Feature Landscape: v2.3 Unified Agent Framework

**Domain:** Unified agent framework replacing per-agent services and Temporal orchestration with declarative agent definitions, conversation-based execution, and event-sourced persistence.
**Researched:** 2026-02-01
**Overall Confidence:** HIGH (patterns well-established across OpenAI Agents SDK, Claude Code, Google ADK, CrewAI, AutoGen/Microsoft Agent Framework, Anthropic SDK compaction API)
**Context:** v2.3 milestone -- replacing Temporal with ConversationExecutor, unifying persistence into an event log, making agents declarative config

---

## Table Stakes

Features users expect. Missing any of these means the unified framework is incomplete relative to the v2.2 system it replaces, or deficient compared to production agent frameworks.

### 1. Declarative Agent Definitions

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **YAML + Markdown agent config** | Industry consensus. Claude Code uses YAML frontmatter + Markdown body. CrewAI uses `agents.yaml` + `tasks.yaml`. OpenAI Agents SDK uses code objects but industry is moving to data. The v2.3 spec proposes `definition.yaml` + `prompt.md`. This is the dominant pattern. | Low | Existing system prompts as constants, existing tool lists in orchestrator code | Claude Code: `---\nname: code-reviewer\ndescription: ...\ntools: Read, Glob, Grep\nmodel: sonnet\n---\nYou are a code reviewer...` CrewAI: separate `agents.yaml` with role/goal/backstory. Aesir's proposed split (YAML config + Markdown prompt) aligns with Claude Code's approach and keeps prompts in their natural format. |
| **Zod schema validation on load** | All frameworks validate agent definitions at load time. CrewAI fails on malformed YAML with clear errors. OpenAI Agents SDK uses Pydantic for type enforcement. AutoGen validates `Agent` constructor parameters. Runtime errors from invalid definitions are unacceptable. | Low | Existing Zod usage throughout codebase | The `AgentDefinition` Zod schema validates identity fields, tool references, model, guardrails, history config, and triggers. Invalid definitions fail immediately at load time, not at runtime. |
| **System prompt as primary control surface** | Every framework treats instructions/prompts as the core agent behavior definition. OpenAI: `instructions` field. CrewAI: `role` + `goal` + `backstory`. Claude Code: Markdown body. AutoGen: `system_message`. Anthropic's v2.2 principle: "Prompt Engineering over Code Engineering." | Low | Existing `ORCHESTRATOR_SYSTEM_PROMPT` constants | Move prompt constants to `.md` files verbatim. The framework reads the prompt file alongside the YAML config. No content changes needed -- only the storage location changes. |
| **Tool references by name (not implementation)** | OpenAI Agents SDK: `tools=[get_weather]` (function objects). CrewAI: tools assigned by name or import. Claude Code: `tools: Read, Glob, Grep`. AutoGen: `tools=[web_search]`. All decouple tool selection from tool implementation. The v2.3 spec uses `"linear:get_issue"` string references resolved at runtime. | Low | Existing tool implementations in `shared/tools/`, existing name-based filtering in orchestrator | The current code already does `["linear_get_issue", ...].includes(t.name)` filtering. This formalizes the pattern with a namespace:tool_name convention. No tool implementations change. |
| **Model and temperature config per agent** | All frameworks support per-agent model selection. OpenAI: `model="gpt-5-nano"`. Claude Code: `model: sonnet`. CrewAI: `llm: provider/model-id`. AutoGen: `model_client`. Different agents need different models (Haiku for sub-agents, Sonnet for orchestrator). | Low | Existing per-agent model selection (hardcoded in orchestrator configs) | Move from hardcoded model strings to definition YAML fields. The `runAgentLoop()` already accepts model as a parameter. |
| **Guardrails (maxIterations, tokenBudget)** | Every production framework has hard limits. OpenAI: `reset_tool_choice` to prevent loops. Claude Code: context window as natural bound. AutoGen: retry strategies and timeout settings. LangGraph: configurable recursion limits. Without these, agents spin indefinitely. | Low | Existing `maxIterations ?? 100` and `maxTokenBudget ?? 500_000` | Move from function parameter defaults to definition YAML fields. The `runAgentLoop()` already enforces these limits. |

**Confidence: HIGH** -- Every framework cited uses declarative-ish agent configuration. The specific YAML+Markdown split is validated by Claude Code's production usage.

### 2. Conversation Executor (Replaces Temporal)

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **start/signal/cancel/get/list API** | The fundamental CRUD+lifecycle for conversations. OpenAI Agents SDK: `session.run()` for start/continue. Google ADK: Runner with event loop. Microsoft Agent Framework: session-based state management. SnapLogic: continuation-based pause/resume. Temporal provided this via workflows -- the executor must match or exceed. | High | Existing Temporal workflow client (`start`, `signal`, `getHandle`, `cancel`, `list`) | This is the highest-complexity feature in v2.3. Must replicate Temporal's durable execution guarantees without Temporal. Postgres-backed for local dev, with interface that supports SQS/EventBridge for production. |
| **Pause/resume via wait_for tool** | Every agent framework needs external wait capability. Temporal: signals. OpenAI: `pause_turn` stop reason. Google ADK: yield/pause/process/resume cycle. SnapLogic: continuation snapshots. The agent needs to express "I need to wait for X" as a tool call, not as workflow state. | Medium | Existing signal infrastructure (6 signal types in v2.2) | The `wait_for` tool replaces 6 typed Temporal signals with one freeform tool. The agent calls `wait_for({ type: "approval" })`, the framework pauses and persists. This is a structural improvement over Temporal's approach. |
| **Full conversation history on resume** | The critical improvement over v2.2. Currently, each Temporal activity starts a fresh agent with an LLM-generated summary. Every major framework preserves full history: OpenAI Sessions store complete conversation. LangGraph checkpoints store full state. Google ADK sessions store full event history. | Medium | Existing `runAgentLoop()` accepts messages array | Persist the Anthropic API message array (user/assistant turns with tool_use and tool_result blocks) to Postgres. On resume, load and pass to `runAgentLoop()`. No summaries needed at pause boundaries. |
| **Deterministic conversation IDs** | Standard pattern for idempotent starts. Temporal: `workflowId` for dedup. OpenAI Conversations API: durable identifier across sessions/devices. The formula `{agentDefinitionId}-{correlationKey}` ensures the same event never creates duplicate conversations. | Low | Existing Temporal `WorkflowExecutionAlreadyStartedError` handling | Replace the error-catching idempotency pattern with deterministic ID construction. Same event, same conversation ID, same result. |
| **Concurrency control (one loop per conversation)** | Temporal enforces this via workflow execution uniqueness. Google ADK's Runner processes events synchronously per session. Without this guarantee, two simultaneous signal arrivals could run two agent loops for the same conversation, creating race conditions. | Medium | Existing Temporal workflow uniqueness guarantee | Postgres advisory locks or row-level locking on the conversation record. The executor acquires a lock before running the agent loop and releases on completion or pause. |
| **At-least-once execution** | Temporal's core guarantee: if an activity crashes, it replays. The executor must detect stale "running" conversations (heartbeat timeout) and re-enqueue them. | Medium | Existing Temporal retry/replay infrastructure | Heartbeat column on conversations table. A periodic checker finds conversations with stale heartbeats and re-enqueues. Simpler than Temporal's deterministic replay but sufficient for agent loops. |
| **Timeout enforcement** | Temporal: workflow-level and activity-level timeouts. The executor must wake paused conversations after N hours if no signal arrives. `wait_for` accepts timeout. The framework delivers a timeout signal when it expires. | Medium | Existing Temporal timeout configuration (24h/72h approval, 7d feedback) | pg_cron or polling-based timeout checker. Finds paused conversations past their timeout and delivers `wait_timeout` signals. The agent decides what to do (escalate, retry, complete). |
| **Signal queueing for race conditions** | Structural fix for v2.2's retry-with-backoff hack. OpenAI session memory handles this implicitly (SDK manages ordering). Google ADK processes events synchronously (no races). When a signal arrives before the conversation has paused, it must be queued and checked on the next `wait_for` call. | Low | None -- new capability replacing workaround | Store signals on the conversation record. When `wait_for` executes, check queued signals before suspending. If a match exists, resume immediately without pausing. |

**Confidence: HIGH** -- These are the specific capabilities Temporal provides today. Each one has clear prior art in other frameworks. The executor must match all of them.

### 3. Unified Event Log

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **Append-only event store** | Event sourcing is the standard pattern for agent observability. LangSmith: Run Tree model with nested spans. Langfuse: traces/observations/events built on OpenTelemetry. Google ADK: event-based session history. Every observability platform records events in real-time, not reconstructed afterward. | Medium | Existing `execution_traces` table (records tool calls but NOT tool results -- noted as gap) | The event log replaces three disconnected stores. Events are written when things happen. `append()` is fire-and-forget (void return, buffered writes). Postgres batch inserts with configurable flush interval. |
| **Event types covering full lifecycle** | LangSmith run types: chain, llm, tool. Langfuse observation types: span, generation, event. Google ADK events: function_call, function_response, text_response, state_change. The v2.3 spec defines: `tool.called`, `tool.succeeded`, `tool.failed`, `llm.response`, `agent.started`, `agent.completed`, `agent.paused`, `agent.resumed`, `agent.spawned`, `agent.child_completed`, `signal.received`. | Low | Existing trace types in `execution_traces` | The type system covers the full agent lifecycle: tool execution, LLM interaction, agent lifecycle, sub-agent lifecycle, and external signals. Each event carries conversation ID, agent instance ID, sequence number, and timestamp. |
| **Tool results in events** | The critical gap in v2.2's `execution_traces`. LangSmith traces capture full inputs AND outputs. Langfuse generations capture model responses. Google ADK function_response events carry results. Without tool results, you cannot debug what the agent saw. | Low | None -- this is the gap being filled | `tool.succeeded` events include the tool's result payload. This is the single most important improvement to observability over v2.2. |
| **Query interface** | All observability platforms support querying by trace/session. LangSmith: filter by trace ID, tags, time range. Langfuse: filter by session, user, time range. The event log needs `query(conversationId, opts)` for debugging and projection building. | Low | Existing PostgreSQL + Drizzle | SQL queries on the `agent_events` table with indexes on `conversation_id + sequence` and `type`. Standard database queries. |
| **Session projection (fast reads)** | CQRS pattern from event sourcing. Write to the event log, project to optimized read models. The `agent_sessions` table replaces `tasks` with reactively-updated state: status, last event, artifacts. | Medium | Existing `tasks` table (imperatively updated by Temporal activities) | The projection subscribes to events and updates on each `tool.succeeded` (for artifacts) and lifecycle event (for status). Replaces `parsePrInfoFromTrace()` with ground-truth extraction. |
| **Artifact extraction from tool results** | Tool results contain structured data (PR number, branch name) that must be queryable without replaying the entire conversation. LangSmith allows custom metadata on runs. Langfuse supports scored observations. The tool registry maps tools to artifact keys. | Medium | Existing PR/branch extraction via `parsePrInfoFromTrace()` | When `tool.succeeded` fires for a tool with artifact config AND the result includes `data`, store it in the session projection under the configured key. The tool knows its own output format. |

**Confidence: HIGH** -- Event sourcing for agent systems is the industry standard. LangSmith, Langfuse, and Google ADK all use append-only event logs with projections.

### 4. History Management

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **Tool output pruning (Phase 1)** | The most impactful, cheapest compaction technique. Claude Code: two-phase (clear old tool results first, then summarize). OpenCode: head+tail preservation (first 500 + last 1500 tokens, truncate middle). Cline: middle-out truncation + dedup. JetBrains NeurIPS 2025: observation masking matched LLM summarization quality, was 7% cheaper, and faster. | Medium | Existing conversation history in Anthropic API format | When conversation exceeds `pruneThreshold`, protect last `protectedMessages` messages. For older messages: keep assistant reasoning, replace tool results with short descriptors. Deduplicate same-file reads (keep only most recent). Head+tail preservation for large results. |
| **Protected recent messages** | Every compaction implementation protects recent context. Claude Code protects recently accessed files. OpenCode: `PRUNE_PROTECT` guards last 40K tokens. Forge Code: `retention_window` preserves recent messages. The agent needs its recent chain of thought intact. | Low | None -- new parameter on AgentDefinition | `protectedMessages: 20` in the definition. The last N messages are never touched by pruning or summarization. Simple index-based protection. |
| **Configurable thresholds** | Forge Code supports: `token_threshold`, `message_threshold`, `turn_threshold`, `retention_window`, `eviction_window`. Anthropic SDK: `context_token_threshold` (default 100K). OpenCode: hardcoded at 95%. Community consensus: 70-80% is the right trigger point, not 95%. | Low | None -- new fields on AgentDefinition | `pruneThreshold` and `summaryThreshold` in the definition. Per-agent configuration because different agents have different context needs (product agent: 30K prune, dev agent: 80K prune). |
| **Structured anchored summarization (Phase 2)** | When pruning alone is not enough, generate a structured summary. Factory.ai found structured summaries preserve file paths and artifact references better than freeform. OpenCode's prompt: "what we did, what we're doing, which files we're working on, what we're going to do next." Claude Code preserves "architectural decisions, unresolved bugs, and implementation details." | High | Event log session projection (for artifact data injection) | The summary has explicit sections: goal, progress, artifacts (from event log -- ground truth, not LLM memory), current state, next steps. Updated incrementally (anchored), not regenerated from scratch. This resists the "summaries of summaries" drift that every research paper identifies as the primary failure mode. |

**Confidence: HIGH** -- Compaction is well-studied. The three-phase approach (prune first, summarize second, agent-managed memory future) is backed by JetBrains research and production usage in Claude Code, OpenCode, and Cline.

### 5. Agent Registry and Single Service

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **Single service replacing per-agent services** | Industry consensus: agents are config, not services. Claude Code: single process, agents loaded from files. OpenAI Agents SDK: single process, agents are objects. CrewAI: single process, agents from YAML. AutoGen: single runtime managing multiple agent types. No production framework deploys separate services per agent type. | Medium | Existing `dev-agent/main.ts` (port 3004), `product-agent/main.ts` (port 3005), `router/main.ts` | One `main.ts`, one HTTP server, one port. Routes: `GET /health`, `POST /events`, `GET /conversations/:id`, `POST /conversations/:id/cancel`. All webhook traffic enters through `POST /events` and the event router dispatches. |
| **Lazy-loading agent registry** | AutoGen: agents registered with factory function, created on first use. CrewAI: YAML loaded at startup. Claude Code: agent files loaded at session start. The registry reads definitions from disk on first `get()` call, caches in memory. | Low | None -- new component | File-based for v2.3. Definitions in `packages/agents/definitions/`. Cached with mtime invalidation (no file watchers). New definition files picked up on next access without restart. |
| **Factory-based tool registry** | AutoGen: `register()` class method with factory function. Microsoft Agent Framework: `AIFunctionFactory.Create()` with reflection. LangGraph: allowlisted tool registry. The pattern: string reference in, ToolDefinition out, with per-invocation context injection. | Medium | Existing tool implementations in `shared/tools/` | Tool factories registered at startup: `toolRegistry.register("codebase:read_file", (ctx) => createReadFileTool(ctx))`. Each factory receives `ToolContext` (agentId, correlationId, containerManager, logger) and returns a configured `ToolDefinition`. |
| **Namespace:tool_name convention** | OpenAI: tools are functions with unique names. Claude Code: tools are named (Read, Glob, Grep). MCP: tools have server-scoped names. The namespace convention `codebase:read_file`, `linear:get_issue` groups tools by integration and prevents naming collisions. | Low | Existing tool names (e.g., `linear_get_issue`) | Simple rename from underscore to colon separator. The namespace maps to the integration/toolkit the tool belongs to. Makes tool permissions and auditing straightforward. |

**Confidence: HIGH** -- Registry + factory pattern is the standard approach across AutoGen, Microsoft Agent Framework, and LangGraph.

### 6. Signal Handling and Event Routing

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **Freeform IncomingEvent shape** | Confluent's event-driven multi-agent patterns use domain events, not integration-specific payloads. Google ADK uses typed events but with extensible schemas. AWS dynamic dispatch converts structured event attributes into semantically classified actions. No predefined enum -- any source can emit events. | Low | Existing 6 typed Temporal signals | Replace `defineSignal<[PlanApprovalPayload]>` with freeform `IncomingEvent { type: "approval", data: {...} }`. The agent speaks domain language ("approval", "pr_merged"), never integration-specific names. |
| **Adapter normalization** | Google ADK dispatcher pattern: central agent analyzes intent and routes. AWS agentic routing: raw events transformed into context-aware domain events. The Slack adapter maps `block_actions.approve` to `"approval"`. The GitHub adapter maps `pull_request.merged` to `"pr_merged"`. Agents never see raw webhook payloads. | Low | Existing webhook parsing in dev-agent and product-agent API handlers | Extract existing webhook-to-action logic into standalone adapter functions. Each adapter transforms one integration's payloads into `IncomingEvent` objects. The adapter is the only code that knows about integration-specific payload structures. |
| **Start rules from agent triggers** | CrewAI: tasks define which agent handles them. Google ADK: dispatcher routes to specialist agents. The event router loads triggers from all registered definitions and matches incoming events. When `linear.agent_session.created` arrives, it matches dev-agent's trigger. | Low | Existing hardcoded routing in event handlers | Move routing rules from code to agent definition `triggers` field. The router reads triggers from all registered definitions at startup. Declarative, not imperative. |
| **Correlation-based signal routing** | Confluent: correlation ID assigned to first event, all subsequent events carry same ID. Arkency: correlation ID + causation ID pattern. The conversation ID is constructed deterministically from correlation data, enabling signal routing without database lookups. | Low | Existing correlation ID pattern in shared/mcp | The formula `{agentDefinitionId}-{correlationKey}` constructs the same conversation ID from both start events and signal events. The router resolves the conversation and delivers the signal. |
| **Three-layer deduplication** | Webhook delivery dedup (HTTP layer). Conversation start dedup (deterministic IDs). Signal dedup (source + delivery ID). Temporal provided workflow uniqueness. The executor must match or exceed this protection. | Low | Existing `WebhookIdempotencyService` | Layer 1 is unchanged. Layer 2 comes from deterministic conversation IDs (start is idempotent). Layer 3 tracks delivered signal IDs on the conversation record. |

**Confidence: HIGH** -- Event routing with correlation IDs is a well-established distributed systems pattern. The specific application to agent frameworks is validated by Google ADK, Confluent's multi-agent guide, and AWS prescriptive guidance.

---

## Differentiators

Features that would make Aesir's approach better than alternatives. Not expected by industry standards, but create clear competitive advantage.

### 1. Event Log as Single Source of Truth (Replacing Three Stores)

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **Converging three stores into one** | v2.2 has `execution_traces` (no tool results), `tasks` (imperatively updated), and `context_snapshots` (lossy summaries). Most frameworks have at least two (state + traces). Converging to a single event stream eliminates data consistency issues across stores. Neither LangSmith nor Langfuse handle agent state AND observability in one store. | Medium | All three existing stores (to be replaced) | The event log IS the trace log AND the state projection source. No separate "update task table" step. When a tool succeeds, the event is written once. The session projection is derived, not separately maintained. This is architecturally cleaner than any production framework researched. |
| **Reactive projections via subscribe** | Standard event sourcing: projections subscribe to the event stream. LangSmith rebuilds dashboards from traces. Langfuse generates scores from observations. But neither offers a programmatic `subscribe()` API for custom projections. The event log's `subscribe(filter, handler)` enables arbitrary downstream consumers without modifying the log. | Medium | EventLog interface (must exist first) | Session projection is the first subscriber. Future subscribers: metrics aggregation, billing, external webhooks, audit log. Adding a new projection requires zero changes to the event log or any existing code. |
| **Ground truth artifact injection into summaries** | No framework researched injects verified data from the event log into compaction summaries. Claude Code and OpenCode rely entirely on the LLM's memory of file paths and PR numbers. Factory.ai identified artifact loss as the primary failure mode. Anchoring summaries with event-log-sourced artifacts is a genuine improvement. | Low (with event log + session projection) | Session projection with artifacts | The Phase 2 summary's "Artifacts" section is populated from `session.artifacts`, not from the LLM. PR numbers, branch names, and file paths come from ground truth (`tool.succeeded` events), not from the LLM's potentially-lossy memory. |

**Confidence: HIGH** -- The convergence pattern is well-understood from event sourcing. The specific application to agent frameworks (one event stream for observability + state + history) is novel but architecturally sound.

### 2. Framework-Level History Management (Not Per-Agent Custom Code)

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **Every agent gets compaction via config** | v2.2: only the product agent has `compactConversationHistory()`. Most frameworks require per-agent custom code for history management. Anthropic's SDK `compaction_control` parameter is the closest analogue -- but it's SDK-level, not framework-level. Making compaction a framework concern configured per-agent via `history` fields is cleaner. | Low (once history manager exists) | History manager component | The `history` field on `AgentDefinition` configures thresholds. The framework applies compaction transparently before each `runAgentLoop()` call. Agent code never touches history management. |
| **Three-phase escalation strategy** | Most tools use one technique. Claude Code: clear tool results, then summarize. OpenCode: prune then summarize. Cline: auto-compact OR manual compact. The three-phase strategy (prune -> structured summary -> future agent-managed memory) applies the cheapest technique first and only escalates when needed. | Low (design decision, not implementation complexity) | Phases 1 and 2 of history manager | Phase 1 (pruning) handles most cases with zero LLM calls. Phase 2 (structured summary) only fires when pruning alone is insufficient. This saves LLM calls and cost compared to always-summarize approaches. JetBrains evidence: pruning-only matched summarization quality and was 7% cheaper. |

**Confidence: HIGH** -- Framework-level compaction is validated by Anthropic's `compaction_control` API. The three-phase approach is backed by JetBrains NeurIPS 2025 research.

### 3. Structural Race Condition Fix (Signal Queueing)

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **Signal queueing eliminates retry-with-backoff** | v2.2 has a known race condition: signals arrive before the workflow starts. The fix is `retry-with-backoff` (a timing-dependent workaround). No framework researched has an explicit signal queueing mechanism -- most avoid the problem by using synchronous event processing (Google ADK) or SDK-managed sessions (OpenAI). Aesir's approach (queue on conversation record, check on `wait_for`) is a structural fix. | Low | Conversation persistence with `queuedSignals` field | Three states when signal arrives: (1) paused with matching type -- resume, (2) paused with wrong type -- reject, (3) running/not yet paused -- queue. When `wait_for` fires, check queue before suspending. If match, resume immediately. No `sleep(500ms)` hacks. |

**Confidence: HIGH** -- This is a direct fix for a documented v2.2 bug with clear implementation path.

### 4. Zero-Infrastructure Agent Addition

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **New agent = new definition directory** | Currently: adding an agent requires new service, new Dockerfile, new port, new Temporal worker, ~400 lines of boilerplate. In v2.3: add `definitions/new-agent/definition.yaml` + `prompt.md`. No code changes. No infrastructure changes. Claude Code and CrewAI both achieve this, but they're single-process tools. Achieving this for a production distributed system (webhooks, signals, durable execution) is genuinely harder and more valuable. | Already covered by registry + single service | Agent registry, tool registry, event router | The registry picks up new definitions on next access. Triggers from the definition integrate with the event router. Existing tools are referenced by name. This is the primary developer experience improvement in v2.3. |

**Confidence: HIGH** -- This is a direct consequence of the architecture, not a separate feature to implement. If the registries and single service work, this works.

### 5. Domain-Language Event Normalization

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **Agents think in domain terms, not integration terms** | The adapter layer normalizes `block_actions.approve` to `"approval"` and `pull_request.merged` to `"pr_merged"`. This means agent prompts never mention Slack, GitHub, or Linear event structures. Adding Jira support means adding an adapter -- existing agent prompts and `wait_for` types are unchanged. Google ADK's dispatcher pattern is the closest analogue, but it uses LLM routing (expensive). Aesir's approach uses deterministic adapters (free). | Low | Adapter functions (new code) | Each adapter is a pure function: `(rawPayload) => IncomingEvent | null`. Highly testable, no dependencies, no state. Integration-agnostic agent definitions are the payoff. |

**Confidence: HIGH** -- This is an adapter pattern, one of the simplest and most well-understood patterns in software engineering.

---

## Anti-Features

Features to deliberately NOT build in v2.3. These are common traps that add complexity without proportional value for Aesir's specific use case.

### Architecture Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Database-backed agent definitions** | The v2.3 spec supports it (the interface abstracts the backing store), but building DB storage, admin API, and migration tooling for agent definitions is premature. There are 5 agents. They change infrequently. File-based is sufficient and keeps definitions in version control where they belong. | File-based definitions with `AgentRegistry` interface. Database backing is a future extension, not a v2.3 deliverable. |
| **Kafka/SQS/EventBridge implementations** | The `EventLog` and `ConversationExecutor` interfaces are designed for these backends. But implementing them adds distributed systems complexity (exactly-once delivery, partition ordering, dead letter queues) that is unnecessary for local dev and early production. | Postgres implementations for v2.3. The interfaces support swapping backends later without changing agent or framework code. |
| **Cross-agent collaboration (agent-to-agent signaling)** | The architecture supports it (agents can signal each other via the executor). But wiring it adds signal type negotiation, dependency tracking between conversations, and deadlock detection. Aesir's current agents don't need this -- the orchestrator spawns sub-agents synchronously. | Sub-agents run inline via `spawn_agent` (same process, separate conversation). Cross-agent signaling is out of scope for v2.3. |
| **Agent marketplace / third-party definitions** | The framework supports external definitions. But packaging, distribution, sandboxing, and trust verification for third-party agents is a product in itself. | Internal definitions only. The `AgentRegistry` interface supports external sources later. |
| **Dynamic model selection per request** | RouteLLM and MasRouter dynamically select models based on query complexity. Aesir has 5 agents with fixed model assignments. The complexity of model routing outweighs any cost savings at this scale. | Fixed model per agent in definition YAML. Update the definition to change the model. |
| **Plugin/middleware architecture for the framework** | Building a general-purpose extensible framework with lifecycle hooks, middleware chains, and plugin registries. The v2.3 spec describes 7 specific components. Building extension points for hypothetical future needs adds accidental complexity. | Build the 7 components as direct implementations. Refactor to extensibility patterns only when a concrete extension need arises. |

### History Management Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Phase 3: Agent-managed memory (MemGPT/Letta style)** | Adds `memory:save` and `memory:search` tools. The agent manages its own memory via LLM calls. Adds cost (extra LLM calls), complexity (memory retrieval quality), and a new failure mode (agent forgets to save important things). Not needed when Phase 1+2 handle most cases. | Defer to post-v2.3. The architecture supports it (just add tools to the registry). No framework changes needed when the time comes. |
| **Opaque/encrypted compression** | OpenAI's `/responses/compact` achieves 99.3% token reduction. But it's a black box -- cannot inspect, debug, or port across providers. Aesir uses Anthropic directly; this is not available. | Phase 1 (pruning) + Phase 2 (structured summary) provide transparent, debuggable compaction. |
| **Cross-session learning** | Agent improves over time by remembering past tasks. Requires vector store, embedding pipeline, semantic search. Unclear value for Aesir's use case where agents work on discrete tasks with clear boundaries. | Each conversation is independent. Convention discovery happens via codebase tools (read existing code, detect patterns). |
| **Automatic compaction model selection** | Cline community proposes using cheap models (Llama 3, Mistral) for summarization. Adds multi-model complexity (auth, routing, quality verification). | Use a single `summaryModel` per agent definition (default: Haiku). One model, configured in YAML. |

### Observability Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full OpenTelemetry integration** | Langfuse is built on OpenTelemetry. LangSmith uses Run Tree. Both are complex instrumentation frameworks. Aesir's event log already captures everything needed for debugging. Adding OTel spans, exporters, and collectors adds infrastructure complexity. Benchmarks show 5-15% overhead from observability frameworks (LangSmith: ~0%, Langfuse: ~15%, AgentOps: ~12%). | Write events to Postgres directly via the `EventLog` interface. The `subscribe()` API allows adding OTel export as a subscriber later without changing any event-producing code. |
| **Real-time event streaming dashboard** | WebSocket infrastructure, streaming UI, real-time trace visualization. High complexity, low immediate value when conversations run in the background. | SQL queries on `agent_events` table. Pino logs for development. Dashboard is a future UI concern. |
| **LLM-as-judge evaluation pipelines** | Braintrust excels at this. LangSmith supports it. But evaluation requires datasets, scoring rubrics, and regression test infrastructure. This is an MLOps concern, not a framework concern. | Monitor via event log queries. Manual evaluation of agent quality through conversation review. Automated evaluation is a separate initiative. |

### Signal Handling Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **LLM-based signal classification** | Using an LLM to classify every incoming signal type. Adds latency and cost to every webhook. The existing smart router already handles ambiguous events via slow-path LLM classification. Signal routing is deterministic (conversation ID + expected wait type). | Deterministic signal matching. The router checks `pendingWait.type` against `signal.type`. Mismatches are rejected, not reclassified. LLM classification only for initial event routing (existing smart router), not for signal delivery. |
| **Complex event processing (CEP)** | Aggregating multiple events before routing (e.g., "3 PR reviews within 1 hour = ready for merge"). Adds temporal windowing, event buffering, and complex matching rules. | Each event is processed independently. The agent reasons about aggregated state via its tools (e.g., query PR reviews). Business logic stays in the agent, not in event processing infrastructure. |
| **Bi-directional event bus** | Events flow in AND out of the agent system. Agents publish events that external systems subscribe to. Adds publisher/subscriber infrastructure, event schemas, and API contracts. | Events flow in via `POST /events`. The event log's `subscribe()` API enables outbound event forwarding as a future extension. For v2.3, the agent communicates outward via its tools (Slack, Linear, GitHub MCP calls). |

---

## Feature Dependencies

```
                 Agent Definition Schema (Zod)
                         |
              +----------+-----------+
              |                      |
              v                      v
       Agent Registry         Tool Registry
       (lazy load from        (factory functions,
        definitions/)          namespace resolution)
              |                      |
              +----------+-----------+
                         |
                         v
                    Event Log
                  (append-only,
                   buffered writes)
                         |
              +----------+-----------+
              |                      |
              v                      v
       Session Projection     History Manager
       (reactive from         (pruning + summary
        events, artifacts)     + protected messages)
              |                      |
              +----------+-----------+
                         |
                         v
              Conversation Executor
              (start/signal/cancel/get,
               concurrency, timeouts,
               at-least-once)
                         |
              +----------+-----------+
              |                      |
              v                      v
        Event Router           wait_for Tool
        (start rules,          (framework-
         signal matching,        intercepted
         adapter normalization)   tool call)
              |                      |
              +----------+-----------+
                         |
                         v
                Single HTTP Service
                (main.ts, one port,
                 POST /events entry)
                         |
                         v
               Router Adaptation
               (smart router:
                Temporal -> executor)
                         |
                         v
              Temporal Removal + Cleanup
              (delete workflows, signals,
               per-agent services, old tables)
                         |
                         v
                E2E Validation
                (dev-agent + product-agent
                 full workflow smoke test)
```

### Critical Path

1. **Agent Definition Schema + Registries** -- everything references these
2. **Event Log + Session Projection** -- executor depends on event recording
3. **History Manager** -- executor needs compaction before resuming conversations
4. **Conversation Executor** -- the core replacement for Temporal
5. **Event Router + Adapters + wait_for** -- connects external events to conversations
6. **Single Service** -- wires everything together
7. **Router Adaptation** -- adapt existing smart router from Temporal to executor
8. **Temporal Removal** -- clean up after cutover
9. **E2E Validation** -- proves the full flow works

### Parallelizable Work

- **Agent definition files** (YAML + Markdown) can be created from existing prompts/configs in parallel with framework code
- **Event adapters** (Slack, GitHub, Linear) can be built in parallel once `IncomingEvent` shape is defined
- **History manager** can be built in parallel with conversation executor (they share the definition schema but not implementation)
- **Database schema + migrations** can be built in parallel with framework components

---

## MVP Recommendation

### Must Have for v2.3 Launch

1. **AgentDefinition schema + validation** -- 5 agents with definition files that produce identical configs to v2.2
2. **AgentRegistry** -- lazy loading from files, cached with mtime invalidation
3. **ToolRegistry** -- factory-based resolution with namespace:tool_name convention
4. **EventLog** -- append-only Postgres store with query, subscribe, flush
5. **Session projection** -- reactive status + artifact tracking from events
6. **ConversationExecutor** -- start/signal/cancel/get/list with full conversation persistence
7. **wait_for tool** -- pause/resume conversations with type matching and timeout
8. **History manager** -- Phase 1 (tool output pruning) + Phase 2 (structured anchored summarization)
9. **Event router** -- start rules from triggers + signal matching from correlation
10. **Event adapters** -- Slack, GitHub, Linear payload normalization
11. **Single HTTP service** -- one main.ts replacing three per-agent services
12. **Smart router adaptation** -- Temporal calls to executor calls
13. **Three-layer deduplication** -- webhook, conversation start, signal
14. **Signal queueing** -- structural race condition fix
15. **Timeout enforcement** -- paused conversation wake-up
16. **Temporal removal** -- delete workflows, signals, per-agent services

### Defer to Post-v2.3

- Agent-managed memory (Phase 3 history)
- Database-backed agent definitions (admin API)
- Kafka/SQS/EventBridge event log backends
- Cross-agent collaboration (agent-to-agent signaling)
- OpenTelemetry integration
- Real-time streaming dashboard
- Cross-session learning
- Production deployment infrastructure (AWS services)

---

## Existing Feature Inventory (Unchanged in v2.3)

These features already exist and require NO changes. Listed for completeness because they interact with v2.3 features.

| Feature | Location | How It Interacts with v2.3 |
|---------|----------|---------------------------|
| `runAgentLoop()` | `shared/agent-loop/` | Core runtime unchanged. ConversationExecutor calls it with messages + resolved tools. |
| MCP HTTP protocol | `shared/mcp/client.ts` | Tool factories use `callMcpTool()` unchanged. |
| MCP tool permissions | Integration DB tables | Same permission checks, invoked through tool registry factories. |
| MCP rate limiting | Integration HTTP middleware | Same 100 req/min/agent limit applies. |
| Dev container sandbox | `@aesir/platform` | Codebase tools wrap `DevContainerManager.execute()` unchanged. |
| Pino structured logging | `@aesir/platform` | Agents use existing logger with correlation IDs. |
| PostgreSQL + Drizzle ORM | `@aesir/platform` | New tables use same connection, same migration pattern. |
| Webhook receivers | Integration HTTP servers | Same webhook handling. Events forwarded to single agent service. |
| OAuth credential storage | Integration DB schemas | Unchanged. MCP tools access credentials as before. |
| Integration packages | `@aesir/integration-*` | Linear, GitHub, Slack packages unchanged. |

---

## Sources

### Agent Definition Formats
- [OpenAI Agents SDK - Agents](https://openai.github.io/openai-agents-python/agents/) - Agent class API with name, instructions, model, tools, handoffs, hooks
- [OpenAI Agents SDK - GitHub](https://github.com/openai/openai-agents-python) - Lightweight framework with Agent, Handoff, Guardrail primitives
- [CrewAI YAML Configuration](https://deepwiki.com/crewAIInc/crewAI/8.2-yaml-configuration) - Declarative agents.yaml and tasks.yaml with variable interpolation
- [CrewAI Getting Started](https://docs.crewai.com/en/quickstart) - @CrewBase decorator pattern linking YAML to Python
- [Claude Code Custom Subagents](https://code.claude.com/docs/en/sub-agents) - YAML frontmatter + Markdown body, tools/model/permissionMode fields
- [AutoGen Agents](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/tutorial/agents.html) - AssistantAgent with name, model_client, tools, system_message
- [AutoGen Agent Runtime](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/agent-and-agent-runtime.html) - Factory-based agent registration with runtime management

### Conversation Persistence and Pause/Resume
- [OpenAI Agents SDK Sessions](https://openai.github.io/openai-agents-python/sessions/) - SQLite, SQLAlchemy, Dapr, OpenAI-hosted, encrypted session backends
- [OpenAI Session Memory Cookbook](https://cookbook.openai.com/examples/agents_sdk/session_memory) - Context engineering with session-based persistence
- [OpenAI Conversation State](https://platform.openai.com/docs/guides/conversation-state) - Conversations API with durable identifiers
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) - Checkpoint-based state persistence across conversation turns
- [LangGraph Checkpointing Best Practices](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025) - PostgresSaver for production, InMemorySaver for testing
- [Google ADK Event Loop](https://google.github.io/adk-docs/runtime/event-loop/) - Yield/pause/process/resume cycle with session state management
- [SnapLogic Agent Continuations](https://www.snaplogic.com/blog/agent-continuations-for-resumable-ai-workflows) - Continuation-based snapshots for pause/resume
- [Microsoft Agent Framework - Persisted Conversations](https://learn.microsoft.com/en-us/agent-framework/tutorials/agents/persisted-conversation) - Thread serialization with Cosmos DB

### Event Sourcing and Observability
- [LangSmith Tracing Deep Dive](https://medium.com/@aviadr1/langsmith-tracing-deep-dive-beyond-the-docs-75016c91f747) - Run Tree model, run_type classification, context propagation
- [LangSmith Observability Concepts](https://docs.langchain.com/langsmith/observability-concepts) - Traces, runs, nested spans
- [Langfuse Tracing Data Model](https://langfuse.com/docs/observability/data-model) - Traces, observations (span/generation/event), OpenTelemetry foundation
- [Langfuse OpenTelemetry Integration](https://langfuse.com/integrations/native/opentelemetry) - OTel-native SDK with semantic conventions
- [AI Agent Observability Tools 2026](https://research.aimultiple.com/agentic-monitoring/) - Platform comparison with overhead benchmarks
- [AgentOps Taxonomy (arXiv)](https://arxiv.org/html/2411.05285v1) - Academic taxonomy of agent traceable artifacts
- [Event Sourcing Pattern - Azure](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) - Append-only logs, projections, replay, snapshots
- [Event Sourcing - Kurrent](https://www.kurrent.io/event-sourcing) - Projections as read-side optimization, replayability

### History Compaction
- [Context Compaction Research](https://gist.github.com/martinec/0d078c88b0bdc97fea21fc6d7d596af8) - Claude Code, Codex CLI, OpenCode, Amp comparison
- [Anthropic Context Compaction Cookbook](https://platform.claude.com/cookbook/tool-use-automatic-context-compaction) - compaction_control API with configurable thresholds
- [Anthropic Context Editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) - clear_tool_uses and clear_thinking strategies
- [Anthropic Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) - Context as precious, finite resource
- [Claude Code Compaction](https://stevekinney.com/courses/ai-development/claude-code-compaction) - Auto-compact triggers at 64-75% context usage
- [How Claude Code Got Better by Protecting Context](https://hyperdev.matsuoka.com/p/how-claude-code-got-better-by-protecting) - Earlier compaction preserves more working memory
- [Cline Auto Compact](https://docs.cline.bot/features/auto-compact) - LLM-based summarization with rule-based fallback
- [OpenCode Context Management](https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction) - 95% threshold, prune then summarize, head+tail preservation

### Event Routing and Multi-Agent Patterns
- [Confluent Event-Driven Multi-Agent Systems](https://www.confluent.io/blog/event-driven-multi-agent-systems/) - Orchestrator-worker, hierarchical, blackboard, market-based patterns
- [AWS Routing Dynamic Dispatch](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/routing-dynamic-dispatch-patterns.html) - EventBridge-based agentic routing
- [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) - Dispatcher, sequential pipeline, human-in-the-loop patterns
- [Confluent Correlation Identifier](https://developer.confluent.io/patterns/event/correlation-identifier/) - UUID-based correlation across event flows
- [Correlation and Causation IDs](https://blog.arkency.com/correlation-id-and-causation-id-in-evented-systems/) - Correlation ID + causation ID pattern

### Tool Registries
- [AutoGen Agent Runtime - Registration](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/agent-and-agent-runtime.html) - Factory function pattern for agent type registration
- [Microsoft Agent Framework - AIFunctionFactory](https://medium.com/@venya-brodetskiy/getting-started-with-microsoft-agent-framework-61a1112220f8) - Reflection-based tool schema generation
- [AgentScope Runtime](https://github.com/agentscope-ai/agentscope-runtime) - White-box adapter pattern with namespace/tag configuration

---

*Feature research for v2.3 Unified Agent Framework*
*Researched: 2026-02-01*
*Replaces: v2.2 Agentic Architecture feature research (2026-01-29)*
