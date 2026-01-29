# Feature Landscape: Agentic Tool-Use Loop Architecture

**Domain:** Agentic AI system with tool-use loops replacing fixed-graph state machines
**Researched:** 2026-01-29
**Overall Confidence:** HIGH (patterns well-established in production systems: Claude Code, Anthropic Research, SWE-Agent, Open SWE)
**Context:** v2.2 milestone - replacing LangGraph fixed-node graphs with agentic tool-use loops

---

## Table Stakes

Features that production agentic systems universally implement. Missing any of these means the system is a demo, not production-ready.

### Core Loop Runtime

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **while(tool_use) loop** | The fundamental execution primitive. Every production agentic system (Claude Code, SWE-Agent, Anthropic Research) uses this exact pattern: send to LLM, if tool_use in response execute tools and feed back, if text-only response stop. | Low | None - new code | Claude Code calls this the "nO" loop. The Anthropic SDK's `stop_reason === "tool_use"` check is purpose-built for this. There is no explicit stop tool needed - when the agent outputs text without tool calls, it's done. |
| **Tool definition interface (Zod -> JSON Schema)** | Tools must be strongly typed with Zod schemas that convert to Anthropic's JSON Schema format. Every tool needs name, description, input schema, execute function. | Low | Existing Zod usage throughout codebase | The `@anthropic-ai/sdk` has built-in Zod support for tool schemas. This is a direct port of existing MCP tool shapes into the Anthropic tool format. |
| **Iteration limit (maxIterations)** | Hard safety cap on tool call count. Every production system implements this. Without it, agents can spin indefinitely and burn unbounded tokens. | Low | Existing `AgentConfig.maxIterations` (currently 10 for LangGraph) | Claude Code has no explicit iteration limit but uses context window exhaustion as natural bound. For Aesir's cost model, explicit limits are essential. Default 50 for sub-agents, 100 for orchestrator, 10 for router. |
| **AbortSignal / cancellation** | Temporal activities have timeouts (30min dev, 5min product). The loop must respect cancellation signals for graceful shutdown. | Low | Existing Temporal activity timeout infrastructure | Pass `AbortSignal` through to `client.messages.create()`. The Anthropic SDK supports this natively. |
| **Structured result return** | Loop must return status (completed/max_iterations/aborted/error), final output, tool call count, and token usage. The orchestrator needs this to decide next steps. | Low | None - new interface | Match the `AgentLoopResult` interface from the spec. Status is critical for orchestrator decision-making. |
| **Conversation history management** | The loop accumulates messages (user, assistant with tool_use, tool results). This history must be passed correctly to each subsequent API call. | Low | None - new code, but follows Anthropic SDK patterns | Append-only message array. Each iteration adds assistant response + tool results. The Anthropic API requires the full conversation history on each call. |
| **Error handling for tool execution** | When a tool throws, the error must be returned to the LLM as a tool result with `isError: true` so the agent can reason about what went wrong and try a different approach. | Low | Existing MCP client has retry logic | This is the critical difference from v2.1's blind retry pattern. The LLM sees the error and decides what to do about it - fix, retry differently, escalate, or skip. |

**Confidence: HIGH** - These patterns are directly observed in Claude Code's architecture, documented in Anthropic's "Building Effective Agents" guide, and consistent across SWE-Agent, Live-SWE-Agent, and Open SWE.

### Tool Library

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **MCP tool wrappers** | Wrap existing `callMcpTool()` calls as `ToolDefinition` objects so the LLM can invoke Linear, GitHub, and Slack tools via native tool-use. | Low | Existing MCP client (`shared/mcp/client.ts`), all 21 tools across 3 services | Thin wrapper: take existing MCP tool, add Zod schema + description, execute calls `callMcpTool()`. The MCP HTTP layer is unchanged. |
| **Codebase tools (read/write/search/list/run)** | The dev agent needs to explore and modify code. These wrap `DevContainerManager.execute()` for sandboxed file/command operations. | Medium | Existing `DevContainerManager`, `DevContainerGit` from Phase 24 | Five tools: `read_file`, `write_file`, `search_codebase`, `list_directory`, `run_command`. Each runs inside the dev container sandbox. |
| **Git tools (branch/commit/PR)** | Creating branches, commits, and PRs is core dev agent functionality. These wrap existing GitHub MCP tools. | Low | Existing GitHub MCP tools (`create_branch`, `create_commit`, `create_pull_request`) | Already available via MCP. The wrapper adds Zod schemas and descriptions for the Anthropic tool format. |

**Confidence: HIGH** - These are direct wrappers of existing infrastructure. No new capabilities needed, just a different invocation mechanism.

### Temporal Integration

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **Agentic loop as Temporal activity** | The loop must run inside Temporal activities for durability. If the process crashes mid-loop, Temporal replays and restarts the activity. | Medium | Existing Temporal worker infrastructure, signal handlers, workflow definitions | Replace `runDevAgentGraphActivity` with `runOrchestratorPreApproval` / `runOrchestratorPostApproval`. Same timeout/retry config. |
| **Context persistence at activity boundaries** | When a Temporal activity ends (e.g., pre-approval loop finishes), its findings must be persisted so the next activity (post-approval) can resume with full context. | Medium | Existing PostgreSQL, Drizzle ORM | Write semantic summaries + structured data to DB at activity end. Read at activity start and inject into system prompt. Replaces LangGraph `PostgresSaver` checkpointing. |
| **Signal-based human-in-the-loop** | Approval signals, PR feedback, escalation resolution must work exactly as today. The agentic loop pauses (activity ends), Temporal waits for signal, next activity starts. | Low | All 6 existing signals unchanged: `planApprovalSignal`, `prFeedbackSignal`, `prCompletionSignal`, `escalationResolvedSignal`, `userReplySignal`, `cancelConversationSignal` | Signal infrastructure is completely unchanged. What changes is what runs between signals (agentic loop instead of LangGraph graph). |

**Confidence: HIGH** - Temporal + agentic AI is a well-established production pattern. Temporal's blog explicitly covers this architecture. Existing signal infrastructure requires zero changes.

### Execution Tracing

| Feature | Why Expected | Complexity | Existing Dependencies | Notes |
|---------|--------------|------------|----------------------|-------|
| **Automatic tool call logging** | Every tool invocation (name, params, result, duration, tokens) must be recorded without manual instrumentation. The loop runtime handles this via `onToolCall`/`onResponse` callbacks. | Medium | Existing `@aesir/observability` package, `observability.execution_events` table | New `agents.execution_traces` table. The agentic loop calls the trace callback automatically on every step. Agent code never touches tracing directly. |
| **Parent-child agent correlation** | When an orchestrator spawns a sub-agent, traces must link parent to child via `parent_agent_instance_id`. This enables "show me everything that happened for task AES-42" queries. | Medium | None - new capability | Each agent invocation gets a unique `agent_instance_id`. Sub-agents inherit `parent_agent_instance_id` from spawner. Sequential `step_number` within each agent. |
| **Token usage per agent instance** | Track input/output tokens per agent invocation. Essential for cost attribution and budget enforcement. | Low | Anthropic API returns usage in every response | Sum `usage.input_tokens` and `usage.output_tokens` from each API response. Store per-agent-instance totals. |

**Confidence: HIGH** - Execution tracing is universally considered table stakes for production agentic systems. OpenTelemetry's AI Agent Observability spec, Arize, LangSmith, and Vellum all center on this. Hierarchical tracing with parent-child correlation is the standard pattern.

---

## Differentiators

Features that make Aesir's agents actually intelligent rather than just functional. These separate a useful system from a demo.

### Intelligent Error Recovery

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **LLM-diagnosed error recovery** | When a tool fails, the LLM reads the error output and decides what to do: fix the code, try a different command, skip the step, or escalate. This replaces the current blind 3x retry in `execute.ts` (lines 237-273). | Low (inherent to the loop pattern) | Existing tool execution infrastructure | This is the single most impactful improvement over v2.1. The current `execute.ts` has a TODO comment: "In future, use LLM to analyze and fix." Tool errors returned with `isError: true` give the LLM the error text to reason about. No special code needed - this is the natural behavior of the loop. |
| **Distinct approach escalation** | Escalate only after 3 genuinely different approaches fail, not 3 identical retries. The LLM must describe its approach and the system checks that each attempt is distinct. | Medium | None - new guardrail logic | Track approach descriptions. Simple uniqueness check (LLM generates a one-line approach description, system ensures it differs from previous attempts). Prevents the current blind retry pattern. |
| **Adaptive test decisions** | The LLM decides whether to run tests, which tests, and how to test based on what changed. A README edit skips tests. A function change runs unit tests. A config change runs integration tests. | Low (inherent to the loop) | Existing test execution via `DevContainerManager` | Currently hardcoded: `allFilesAreNonCode()` check in execute.ts. The LLM naturally makes this decision by reading what it changed and reasoning about testing needs. System prompt guides but doesn't force. |

**Confidence: HIGH** - These are the specific failure modes documented in v2.1 E2E testing. The fix is inherent to the agentic loop pattern.

### Sub-Agent Architecture

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **spawn_agent orchestrator tool** | Orchestrator spawns focused sub-agents (researcher, coder, tester) with separate context windows and restricted tool sets. Each sub-agent gets a clean context with only relevant information. | High | Agentic loop runtime (must exist first) | Anthropic's multi-agent research system uses exactly this pattern: lead agent spawns specialized subagents in parallel. Claude Code uses Explore subagents with separate context. The key insight: subagents return condensed summaries (1-2K tokens), not full transcripts. |
| **Context-scoped tool sets** | Researcher gets read-only tools. Coder gets read+write. Tester gets read+run. Orchestrator gets spawn+integration tools. | Low | Tool definitions (must exist first) | Restricting tool sets is a natural security boundary. It also reduces context window consumption from tool definitions and prevents the coder from accidentally calling Slack. |
| **Sub-agent result aggregation** | Sub-agent returns structured result (summary, files found, patterns, etc.) that the orchestrator injects into its own context for next decisions. | Medium | spawn_agent tool (must exist first) | The orchestrator calls spawn_agent as a tool. The tool's `execute()` runs a nested agentic loop and returns the structured result as tool output. The orchestrator sees this as a regular tool result. |
| **Parallel sub-agent execution** | For research tasks, spawn multiple subagents simultaneously. Anthropic's research system achieves 90% improvement over sequential processing. | High | Sub-agent infrastructure (must exist first) | Defer to post-v2.2 unless needed. Claude Code limits to one sub-agent branch at a time. Aesir's dev agent tasks are largely sequential (research -> plan -> code -> test). Parallelism matters more for research/analysis. |

**Confidence: HIGH for core pattern, MEDIUM for parallel execution** - Anthropic's multi-agent research system and Claude Code both use orchestrator + subagent patterns. Parallel execution is proven but may not be needed for Aesir's sequential dev workflow.

### Smart Router

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **LLM-based event classification** | Replace hardcoded switch statements in `events.ts` with an LLM that reasons about event routing. Absorbs the approval intent classifier. Handles ambiguous events that can't be classified by rules alone. | Medium | Existing event infrastructure, webhook receivers, Temporal client | The current hardcoded routing in dev-agent and product-agent events.ts works but can't handle novel situations. LLM routing handles: "is this Slack message a feature request, a bug report, or chatter?" which rules can't. |
| **Running workflow awareness** | Router queries Temporal to check for running workflows before deciding. "Is there already a workflow for this issue?" prevents duplicate agent runs. | Low | Existing Temporal client with query support | `query_running_workflows` tool. Uses existing `devAgentStatusQuery` pattern. |
| **Lightweight model for routing** | Use a cheaper/faster model (Haiku) for the router since it needs to decide quickly with minimal context. | Low | None - model selection in loop config | Claude Code uses Haiku for command sanitization specifically because it's fast and cheap. Router decisions are simpler than agent work - smaller model is appropriate. |

**Confidence: MEDIUM** - LLM-based routing is established (AWS prescriptive guidance, Patronus AI patterns), but hybrid approaches (rules first, LLM for ambiguous) are more robust in production. Pure LLM routing adds latency to every event.

### Context Engineering

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **Semantic context snapshots** | At Temporal activity boundaries, the LLM generates a summary of work done, findings, and intent. This replaces full state serialization (LangGraph's PostgresSaver). Summaries are more useful than raw state dumps because they capture reasoning, not just data. | Medium | PostgreSQL, Drizzle ORM | Anthropic's context engineering guide emphasizes: "find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome." An LLM-generated summary is higher signal than a serialized state blob. |
| **Critical data in structured columns** | PR number, branch name, issue ID, container ID stored in typed DB columns, not in JSONB summaries. LLM summaries are lossy - critical identifiers must never be summarized away. | Low | PostgreSQL, Drizzle ORM | The spec's `agents.tasks` table design is correct: explicit columns for PR number, branch, approval status, etc. JSONB only for semantic/flexible data. |
| **Just-in-time context loading** | Sub-agents load files on demand rather than receiving all context upfront. The orchestrator provides file paths and descriptions, sub-agents read what they need. | Low (inherent to having read_file tool) | Codebase tools (read_file, search_codebase) | Claude Code's approach: "maintain lightweight identifiers (file paths, stored queries) and use references to dynamically load data into context at runtime using tools." This is the natural behavior when agents have file reading tools. |

**Confidence: HIGH** - Claude Code's context management, Anthropic's context engineering guide, and the multi-agent research system all validate these patterns. LLM-generated summaries at boundaries is the standard approach.

### Adaptive Agent Behavior

| Feature | Value Proposition | Complexity | Existing Dependencies | Notes |
|---------|-------------------|------------|----------------------|-------|
| **Complexity-aware routing** | Simple tasks (README edit) take fewer steps than complex features. The LLM naturally adapts its approach based on task complexity without hardcoded thresholds. | Low (inherent to the loop) | None - natural LLM behavior with good prompts | The spec's success criterion: "README edit without tests in under 10 tool calls." This happens naturally when the LLM isn't forced through a 13-node graph. |
| **Skip unnecessary phases** | No forced clarification on clear requests (product agent). No forced research on trivial changes (dev agent). The LLM decides what's needed. | Low (inherent to the loop) | None | v2.1 forces every task through classify -> analyze -> clarify -> confirm -> create -> notify. The agentic loop lets the product agent go directly from understanding to creating if the request is clear. |
| **Dynamic plan granularity** | Trivial change gets a brief plan. Complex feature gets detailed steps with risk analysis. The LLM judges appropriate effort. | Low (inherent to the loop with good prompts) | None | Anthropic's multi-agent research system: "Agents struggle to judge appropriate effort for different tasks, so scaling rules should be embedded in the prompts." Provide guidelines in system prompt, not hardcoded logic. |

**Confidence: HIGH** - This is the fundamental value proposition of replacing the fixed graph. Every tool-use loop system exhibits this behavior naturally.

---

## Anti-Features

Features to deliberately NOT build. These are common over-engineering traps in agentic systems that add complexity without proportional value.

### Architecture Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Multi-agent swarm / mesh** | Claude Code explicitly chose single-threaded master loop over multi-agent swarms. Anthropic's research system found that "domains requiring shared context or high interdependency between agents remain challenging for current multi-agent architectures." Aesir's dev workflow is inherently sequential (research -> plan -> approve -> code -> test -> PR). | Orchestrator + focused sub-agents (one at a time). Claude Code limits to one sub-agent branch. Aesir should do the same for v2.2. |
| **Dynamic agent creation / agent registry** | Building a generic agent spawning system with registration, discovery, and capability negotiation adds massive complexity. The v2.2 scope is 3 sub-agents (researcher, coder, tester) with known capabilities. | Hardcode the 3 sub-agent types with their tool sets. Add new types as needed in future milestones. The `spawn_agent` tool takes a type enum, not an arbitrary agent spec. |
| **Agent-to-agent communication protocol** | Google A2A, IBM ACP, and similar protocols are for multi-organization agent ecosystems. Aesir's agents run in the same process, communicate through function calls and Temporal signals. | Orchestrator talks to sub-agents via function calls (spawn_agent returns result). Agents talk to humans via Slack/Linear MCP tools. Cross-agent collaboration is out of scope for v2.2. |
| **Autonomous model selection** | RouteLLM and MasRouter dynamically select the best model per request. Aesir uses one model (Claude Sonnet) for all agent work. Model selection optimization is premature. | Single model per agent type in config. Use Haiku for the router only. Model selection is a tuning parameter, not an architecture feature. |
| **Custom agentic framework / SDK** | Building a general-purpose agentic framework is a product in itself. The spec describes `runAgentLoop` - that's a function, not a framework. | Build `runAgentLoop` as a focused utility function (~100-150 lines). Do NOT build a framework with plugins, middleware, lifecycle hooks, etc. If you need a framework later, consider the Claude Agent SDK. |
| **Claude Agent SDK adoption** | The `@anthropic-ai/claude-agent-sdk` provides agent loop, built-in tools, context management, and MCP support. However, adopting it means giving up control over the loop, context management, and tool execution - all things Aesir needs to customize for Temporal integration and sub-agent spawning. | Use `@anthropic-ai/sdk` (low-level) for direct API access. Build `runAgentLoop` as a thin wrapper. Keep full control over the loop for Temporal integration, custom tracing, and sub-agent coordination. The Claude Agent SDK is designed for Claude Code-like agents, not for agents embedded in Temporal workflows. |

### Observability Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full OpenTelemetry spans** | OpenTelemetry's AI Agent Observability spec is still evolving. Adding OTEL instrumentation to every tool call adds 12-15% latency overhead (benchmarked by Langfuse/AgentOps studies). Aesir's tracing needs are simpler. | Write trace rows to PostgreSQL directly. The `agents.execution_traces` table captures everything needed for debugging. Add OTEL later if/when an external observability platform is adopted. |
| **Visual agent topology / DAG visualization** | Dynatrace and Arize offer this. Building a custom visualization for 3 sub-agent types is not worth the effort. | SQL queries on `execution_traces` with parent-child joins. A simple CLI or admin endpoint that shows the trace tree for a task ID. Visualization is a future UI concern. |
| **Real-time streaming of agent reasoning** | Streaming each LLM token and tool call to a dashboard in real-time. Adds WebSocket infrastructure and streaming complexity. | Log to DB. Query after the fact. Pino logs show real-time progress for development. Streaming UI is out of scope for v2.2. |

### Context Management Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Automatic context compaction mid-loop** | Claude Code compacts at ~92% context usage. Aesir's activities have 30-minute timeouts and sub-agents have 50-iteration limits. Context exhaustion within a single activity is unlikely for well-scoped tasks. | Set iteration limits that prevent context exhaustion. If a sub-agent hits 50 tool calls, it returns what it has. The orchestrator can spawn another sub-agent if more work is needed. Context compaction is a complexity trap for v2.2. |
| **Long-term memory / vector store** | RAG, embeddings, vector databases for agent memory. Massively complex, unclear value for Aesir's use case where agents work on discrete tasks with clear boundaries. | Context snapshots in PostgreSQL. Each task starts fresh. Project context (conventions, patterns) comes from CLAUDE.md files and codebase exploration, not from a memory store. |
| **Cross-session learning** | Agent improves over time by remembering past tasks, common patterns, successful approaches. Requires sophisticated storage and retrieval. | Each task is independent. Convention discovery happens via codebase tools (read existing code, detect patterns). Learning from past tasks is a future milestone if needed. |

### Smart Router Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Pure LLM routing for all events** | Adding LLM latency to every webhook event (even simple ones like PR merged -> signal workflow) is wasteful. Some events have deterministic routing. | Hybrid approach: rule-based routing for deterministic events (e.g., `github.pull_request.merged` always signals the dev-agent workflow). LLM-based routing only for ambiguous events (e.g., Slack messages, Linear comments with unclear intent). |
| **Router learns from corrections** | A feedback loop where the router improves over time from human corrections. Requires labeling infrastructure, training pipeline. | Static system prompt with clear routing rules. Update the prompt when new event types or routing patterns emerge. The routing space is small and well-defined. |

### Cost Management Over-Engineering

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Real-time cost dashboard** | Building a UI to show live cost tracking per task. Out of scope for v2.2. | Log token usage in `execution_traces`. Provide a SQL query to calculate cost per task. Dashboard is a future UI concern. |
| **Dynamic model downgrading based on budget** | Switching to a cheaper model mid-task when budget is running low. Adds complexity, may degrade quality at critical moments. | Hard budget limit per task. If exceeded, the loop returns `max_tokens` status and the orchestrator decides whether to continue with a new budget or escalate. Simple, predictable. |
| **Token prediction before execution** | Research shows token consumption prediction has Pearson's r < 0.15 (OpenReview 2025). It doesn't work reliably. | Track actual usage. Set generous budgets. Alert on anomalies. Don't try to predict. |

---

## Feature Dependencies

```
                   @anthropic-ai/sdk migration
                           |
                           v
                   runAgentLoop() runtime
                     (core while loop)
                           |
            +--------------+--------------+
            |              |              |
            v              v              v
    Tool definitions   Tracing      Guardrails
    (Zod -> JSON)    callbacks    (iter/token limits)
            |              |              |
            +--------------+--------------+
                           |
            +--------------+--------------+
            |              |              |
            v              v              v
    Codebase tools   MCP wrappers   Context
    (DevContainer)   (Linear/GH/    snapshots
                      Slack)        (DB tables)
            |              |              |
            +--------------+--------------+
                           |
            +--------------+--------------+
            |              |              |
            v              v              v
    Dev Agent       Product Agent   Smart Router
    Orchestrator    (single loop)   (hybrid rules
    + sub-agents                     + LLM)
            |              |              |
            +--------------+--------------+
                           |
                           v
               Temporal workflow updates
               (new activities, same signals)
                           |
                           v
                    E2E validation
```

### Critical Path

1. **Anthropic SDK + Loop Runtime** -- everything depends on this
2. **Tool Definitions** -- agents can't do anything without tools
3. **Context Persistence** -- agents can't cross Temporal boundaries without this
4. **Dev Agent Orchestrator** -- the primary deliverable
5. **Product Agent** -- second agent, validates the pattern
6. **Smart Router** -- replaces event handling, ties everything together
7. **E2E Validation** -- proves it all works

### Parallelizable Work

- **Tool definitions** (codebase tools, MCP wrappers, git tools) can be built in parallel once the `ToolDefinition` interface exists
- **DB schema + migrations** (context_snapshots, tasks, execution_traces) can be built in parallel with tool definitions
- **System prompts** for each agent can be drafted in parallel with implementation
- **Smart Router** is largely independent from agent implementation (different loop instance, different tools)

---

## MVP Recommendation

### Must Have for v2.2 Launch

1. **Agentic loop runtime** (`runAgentLoop`) with iteration limits, token tracking, abort support
2. **Tool definitions** for all existing MCP tools + codebase tools
3. **Dev agent orchestrator** with spawn_agent for researcher/coder/tester sub-agents
4. **Product agent** as single adaptive loop
5. **Context persistence** at Temporal activity boundaries (semantic snapshots + structured tasks table)
6. **Execution tracing** with parent-child correlation
7. **Token budget enforcement** per task
8. **Temporal workflow updates** (new activities, same signals)
9. **E2E validation** of the full flow

### Should Have (v2.2 if time, otherwise next)

10. **Smart Router** with hybrid rules + LLM (can ship with existing hardcoded routing if needed)
11. **Distinct approach escalation** (vs simple iteration limit)
12. **Lightweight model for router** (Haiku)

### Defer to Post-v2.2

- Parallel sub-agent execution
- Agent topology visualization
- Real-time streaming dashboard
- Cross-session learning / memory
- Context compaction mid-loop
- Dynamic model selection

---

## Decision: `@anthropic-ai/sdk` vs `@anthropic-ai/claude-agent-sdk`

This is a critical technology choice that affects the entire architecture.

### Recommendation: Use `@anthropic-ai/sdk` (low-level), NOT `@anthropic-ai/claude-agent-sdk`

**Reasons:**

1. **Temporal integration**: The Claude Agent SDK manages its own loop lifecycle. Aesir needs the loop to run inside Temporal activities with specific timeout and retry semantics. A managed loop fights Temporal's execution model.

2. **Custom sub-agent spawning**: The Claude Agent SDK's subagent model is designed for Claude Code's explore-agent pattern. Aesir needs spawn_agent as a tool the orchestrator calls, with custom context briefing and tool set restriction. This requires loop-level control.

3. **Custom tracing**: The Agent SDK has its own observability. Aesir needs tracing that writes to its own PostgreSQL tables with parent-child agent correlation and Temporal workflow IDs. Custom `onToolCall`/`onResponse` callbacks are simpler than adapting the SDK's observability.

4. **Context management**: Aesir persists context to PostgreSQL at Temporal boundaries. The Agent SDK manages context internally with compaction and memory. These models conflict.

5. **Simplicity**: `runAgentLoop` is ~100-150 lines of code. It's a while loop with API calls. The Claude Agent SDK is thousands of lines handling concerns (terminal UI, permissions, MCP server management, file system access) that Aesir doesn't need.

6. **Debuggability**: With the raw SDK, every API call is visible and controllable. With the Agent SDK, the loop is a black box that makes decisions about compaction, tool search, and context management that may not align with Aesir's needs.

**Trade-off acknowledged**: The Claude Agent SDK provides battle-tested context management, tool search for large tool sets, and automatic compaction. By not using it, Aesir takes on the burden of context management. This is acceptable because:
- Aesir's tool count is small (~25 tools total, well within context budget)
- Context management happens at Temporal boundaries (not mid-loop)
- The sub-agent pattern naturally resets context per invocation

---

## Decision: Hybrid Router vs Pure LLM Router

### Recommendation: Hybrid (rules + LLM for ambiguous cases)

**Rules handle (zero-latency, deterministic):**
- `github.pull_request.merged` -> signal dev-agent workflow (always the same)
- `github.pull_request.closed` -> signal dev-agent workflow (always the same)
- `slack.block_actions.approved` / `rejected` -> signal appropriate workflow (deterministic from payload)
- Events with existing workflow context (thread_ts matches running workflow) -> signal that workflow

**LLM handles (100-500ms latency, but necessary):**
- `slack.app_mention.created` -> Is this a product request, dev command, or chatter?
- `linear.comment.created` -> What's the intent? (approval, feedback, question, guidance)
- `slack.message.created` in thread -> Is this a reply, cancellation, or new topic?
- Novel/unknown event types -> What should we do with this?

**Why hybrid wins:**
- Adds LLM latency only where it's needed (ambiguous events)
- Deterministic events get instant routing
- Reduces LLM cost (most events are deterministic)
- More testable (rule-based paths have deterministic test coverage)
- Graceful degradation (if LLM is down, deterministic events still route)

---

## Existing Feature Inventory (Kept Unchanged)

These features already exist and require NO changes in v2.2. They are listed for completeness because they interact with new features.

| Feature | Location | How It Interacts with v2.2 |
|---------|----------|---------------------------|
| MCP HTTP protocol | `shared/mcp/client.ts` | Tool wrappers call `callMcpTool()` unchanged |
| MCP tool permissions | Integration DB tables | Same permission checks, now invoked through tool wrappers |
| MCP rate limiting | Integration HTTP middleware | Same 100 req/min/agent limit applies |
| Temporal signals (6 types) | `shared/temporal/signals.ts` | Same signals, same handlers, different activity content |
| Temporal workflow timeouts | `shared/temporal/workflows/` | Same timeouts (24h/72h approval, 7d feedback) |
| Dev container sandbox | `@aesir/platform` | Codebase tools wrap `DevContainerManager.execute()` |
| Dev container git | `@aesir/platform` | Git tools wrap `DevContainerGit` operations |
| Pino structured logging | `@aesir/platform` | Agents use existing logger with correlation IDs |
| PostgreSQL + Drizzle ORM | `@aesir/platform` | New tables use same connection, same migration pattern |
| Webhook receivers | Integration HTTP servers | Same webhook handling, events pass through router |
| OAuth credential storage | Integration DB schemas | Unchanged, MCP tools access credentials as before |
| Docker Compose local dev | `docker-compose.yml` | Same topology, agents just run different code internally |

---

## Sources

### Anthropic Official
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) - Core patterns guide (orchestrator-workers, augmented LLM, tool use loops)
- [How We Built Our Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system) - Production multi-agent architecture with orchestrator-worker pattern
- [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) - Context management patterns
- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) - Long-running agent patterns
- [Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) - Tool Search, Programmatic Tool Calling, Tool Use Examples
- [Claude Code: Best Practices for Agentic Coding](https://www.anthropic.com/engineering/claude-code-best-practices) - Production agentic coding patterns
- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript) - Agent SDK reference
- [Anthropic Cookbook - Agent Patterns](https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents) - Reference implementations

### Claude Code Architecture
- [How Claude Code Works](https://code.claude.com/docs/en/how-claude-code-works) - Official architecture documentation
- [Claude Code: Behind the Scenes of the Master Agent Loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/) - Detailed loop analysis
- [Tracing Claude Code's LLM Traffic](https://medium.com/@georgesung/tracing-claude-codes-llm-traffic-agentic-loop-sub-agents-tool-use-prompts-7796941806f5) - Sub-agent and tool-use traffic analysis
- [Claude Code Agent Architecture: Single-Threaded Master Loop](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding) - Architecture analysis
- [Context Engineering Under the Hood of Claude Code](https://blog.lmcache.ai/en/2025/12/23/context-engineering-reuse-pattern-under-the-hood-of-claude-code/) - KV cache optimization and context reuse
- [Designing Agentic Loops (Simon Willison)](https://simonwillison.net/2025/Sep/30/designing-agentic-loops/) - Design principles

### SWE-Agent Ecosystem
- [SWE-Agent GitHub](https://github.com/SWE-agent/SWE-agent) - Original tool-use loop for coding agents
- [Open SWE (LangChain)](https://www.blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/) - Asynchronous coding agent architecture
- [Live-SWE-Agent](https://github.com/OpenAutoCoder/live-swe-agent) - Minimal scaffold with SOTA results (79.2% SWE-bench)

### Multi-Agent Patterns
- [Building Multi-Agent Systems Part 3](https://blog.sshh.io/p/building-multi-agent-systems-part-c0c) - Convergence toward Planner + Builder + Task Agent pattern
- [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) - Sequential, parallel, and loop agent patterns
- [OpenAI Agents SDK - Multi-Agent](https://openai.github.io/openai-agents-python/multi_agent/) - Handoff patterns

### Temporal + Agentic AI
- [Agentic AI Workflows with Temporal](https://intuitionlabs.ai/articles/agentic-ai-temporal-orchestration) - Temporal as durability layer for agents
- [Dynamic AI Agents with Temporal](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal) - Loop-in-workflow pattern
- [Durable Multi-Agentic AI with Temporal](https://temporal.io/blog/using-multi-agent-architectures-with-temporal) - Multi-agent orchestration
- [Building Production-Ready Agentic Systems](https://temporal.io/blog/building-an-agentic-system-thats-actually-production-ready) - Production patterns

### Observability
- [AI Agent Observability - OpenTelemetry](https://opentelemetry.io/blog/2025/ai-agent-observability/) - Standardization efforts
- [Practical Guide to AI Observability (Vellum)](https://www.vellum.ai/blog/understanding-your-agents-behavior-in-production) - Production observability patterns
- [15 AI Agent Observability Tools in 2026](https://research.aimultiple.com/agentic-monitoring/) - Tool landscape

### Error Recovery & Graceful Degradation
- [Multi-Agent AI Failure Recovery (Galileo)](https://galileo.ai/blog/multi-agent-ai-system-failure-recovery) - Reviewer agent, escalation patterns
- [Error Recovery Strategies in AI Agents](https://www.gocodeo.com/post/error-recovery-and-fallback-strategies-in-ai-agent-development) - State verification, retry strategies
- [Cognitive Degradation Resilience (CSA)](https://cloudsecurityalliance.org/blog/2025/11/10/introducing-cognitive-degradation-resilience-cdr-a-framework-for-safeguarding-agentic-ai-systems-from-systemic-collapse) - Long-running agent degradation

### Cost Management
- [Token Consumption in Agentic Coding Tasks (OpenReview)](https://openreview.net/forum?id=1bUeVB3fov) - Token prediction research (r < 0.15)
- [Hidden Costs of Agentic AI (Galileo)](https://galileo.ai/blog/hidden-cost-of-agentic-ai) - Why 40% of projects fail
- [Agentic AI Cost Iceberg (Dataiku)](https://www.dataiku.com/stories/blog/the-agentic-ai-cost-iceberg) - Hidden cost analysis

### Routing & Classification
- [AWS Routing Dynamic Dispatch Patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/routing-dynamic-dispatch-patterns.html) - Event-driven routing for agents
- [AI Agent Routing Tutorial (Patronus AI)](https://www.patronus.ai/ai-agent-development/ai-agent-routing) - Rule-based, ML, and LLM routing approaches
- [Intent Recognition in Multi-Agent Systems](https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa) - Router patterns

---

*Feature research for v2.2 Agentic Architecture - Tool-Use Loop Features*
*Researched: 2026-01-29*
*Replaces: v2.0 Foundation feature research (2026-01-19)*
