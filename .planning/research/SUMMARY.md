# v2.2 Agentic Architecture Research Summary

**Project:** Aesir v2.2 — Replace LangGraph with Agentic Tool-Use Loops
**Domain:** AI Agent Development Platform
**Researched:** 2026-01-29
**Overall Confidence:** HIGH

---

## Executive Summary

The v2.2 architectural shift from LangGraph state machines to agentic tool-use loops is **validated by extensive industry precedent** and production systems (Claude Code, Anthropic's multi-agent research system, SWE-Agent ecosystem). The spec's approach is sound: use Anthropic's native SDK for tool-use, run agentic loops inside Temporal activities (not as workflows), spawn focused sub-agents with isolated context, and persist semantic summaries at activity boundaries. Research confirms this is the established production pattern.

**Key research findings that enrich the spec:**

1. **Stack:** The `@anthropic-ai/sdk` provides everything needed — `betaZodTool()` for schema conversion, `toolRunner()` helper for the loop pattern, server-side context management (`clear_tool_uses`), and stable token counting API. No additional dependencies required beyond removing four `@langchain/*` packages. Existing Zod 3.25.67 is compatible (no upgrade needed).

2. **Architecture:** The spec's Temporal integration is correct — workflows remain deterministic shells, agentic loops run inside activities. Sub-agent spawning should be in-process (nested function calls) not out-of-process (separate Temporal activities) for latency and context passing. Database schema design is sound: structured data in `agents.tasks`, semantic summaries in `agents.context_snapshots`.

3. **Critical additions missing from spec:** Hybrid smart router (rules for deterministic events, LLM only for ambiguous cases), LLM self-summarization step at activity boundaries, and shared token budget tracking across orchestrator + sub-agents.

**The primary risk:** Token cost explosion from accumulating context in long tool loops. Research shows quadratic growth (full history resent each iteration). Mitigation: server-side `clear_tool_uses` (auto-clears old tool results at 80% context), iteration limits per agent type (50 for sub-agents, 100 for orchestrator), and the sub-agent pattern itself (fresh context per spawn).

---

## Key Findings

### Recommended Stack

The Anthropic TypeScript SDK (`@anthropic-ai/sdk` ^0.71.0) provides native tool-use capabilities with minimal integration surface. The SDK's `betaZodTool()` helper converts Zod schemas directly to Anthropic's tool format, eliminating the need for `zod-to-json-schema` (now deprecated). The `toolRunner()` helper implements the exact pattern Aesir needs: iterate tool calls until the LLM stops or guardrails hit.

**Core technologies:**

- **@anthropic-ai/sdk ^0.71.0:** Native tool-use API with Zod support, context management, token counting — replaces `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres` (removes 4 packages, adds 1)
- **Existing Zod 3.25.67:** Compatible with SDK's peer dependency (`^3.25.0`) — no upgrade needed
- **Temporal (unchanged):** Remains as durability envelope for agentic loops — workflows own signal waits and timeouts, activities own LLM calls
- **MCP layer (unchanged):** All 21 existing tools wrapped as `ToolDefinition` objects — thin Zod schema + execute function that calls `callMcpTool()`

**Why this stack:**

1. Direct API access vs abstraction layer — better control, clearer debugging, no LangChain peer dependency conflicts
2. Built-in Zod support — `betaZodTool()` handles schema conversion automatically
3. Server-side context management — `clear_tool_uses` API clears old tool results when context nears limits
4. Production-proven pattern — Temporal's official cookbook shows exactly this: agentic loop inside activity, signals for HITL

### Expected Features

**Must have (table stakes):**

- **while(tool_use) loop runtime** — The fundamental primitive. LLM calls → tool execution → result feedback → repeat until done. Every production agentic system uses this pattern.
- **Tool definition interface (Zod → Anthropic)** — Strongly typed tools with Zod input schemas. Anthropic SDK's `betaZodTool()` handles conversion.
- **Iteration limit (maxIterations)** — Hard safety cap on tool call count. Default 50 for sub-agents, 100 for orchestrator, 10 for router.
- **AbortSignal / cancellation** — Map Temporal activity timeout to loop cancellation. SDK supports this natively.
- **Structured result return** — Loop returns status (completed/max_iterations/aborted/error), output, tool count, tokens.
- **Error handling with LLM reasoning** — Tool errors returned as `isError: true` tool results. LLM sees error text and decides: fix, retry differently, skip, or escalate. This replaces v2.1's blind 3x retry.
- **Context persistence at Temporal boundaries** — Semantic summaries + structured data written to DB when activities end. Next activity reads context to resume.
- **Execution tracing with parent-child correlation** — Every tool call logged automatically. Sub-agents linked to orchestrator via `parent_agent_instance_id`.

**Should have (competitive differentiators):**

- **Sub-agent spawning (orchestrator tool)** — Orchestrator spawns researcher/coder/tester with focused context and restricted tool sets. Sub-agents return condensed summaries, not full transcripts. In-process spawning (nested function call) not out-of-process (Temporal activity) for latency and simplicity.
- **Context-scoped tool sets** — Researcher gets read-only tools (5-10 tools). Coder gets read+write (5-10 tools). Tester gets read+run (5-10 tools). Orchestrator gets spawn+integration+git (8-10 tools).
- **Smart router with LLM reasoning** — Replace hardcoded event routing with LLM classification for ambiguous events. Hybrid approach: rules for deterministic events (PR merged → signal), LLM for ambiguous (Slack message → is this a request, reply, or chatter?).
- **Adaptive agent behavior** — Simple tasks take fewer steps naturally. No forced phases. LLM decides whether to spawn sub-agents, whether to test, whether to clarify based on task complexity.

**Defer (v2+):**

- **Parallel sub-agent execution** — Anthropic's research system shows 90% improvement from parallel spawning, but Aesir's dev workflow is inherently sequential (research → plan → code → test). Defer unless needed.
- **Automatic context compaction mid-loop** — Claude Code compacts at 92% context usage. Aesir's iteration limits (50 per sub-agent) prevent hitting context window in typical tasks. Server-side `clear_tool_uses` is sufficient safety net.
- **Cross-session learning / vector store** — Each task starts fresh. Project context comes from CLAUDE.md files and codebase exploration, not long-term memory.
- **Dynamic model selection** — Single model (Claude Sonnet) for all agent work. Use Haiku only for smart router.
- **Custom agentic framework** — Build `runAgentLoop()` as a focused utility function (~100-150 lines), not a framework with plugins, middleware, lifecycle hooks.

### Architecture Approach

The v2.2 architecture keeps Temporal workflows as the deterministic shell (loops, signal waits, timeouts) and runs agentic loops inside activities (non-deterministic LLM calls). This separation is critical for Temporal's replay model — workflows must be deterministic, activities can be non-deterministic. The spec's approach matches the production pattern documented in Temporal's official AI cookbook.

**Major components:**

1. **Agentic Loop Runtime (`runAgentLoop`)** — Core execution primitive. Takes system prompt, tools, initial message → iterates: LLM call → tool execution → result feedback → repeat until done or limits hit. Wraps Anthropic SDK's `messages.create()` with tracing callbacks, token tracking, iteration counting, and abort handling.

2. **Tool Library (per-agent toolkits)** — Composable tool sets. Codebase tools (read/write/search/list/run) wrap `DevContainerManager`. MCP tools (Linear/GitHub/Slack) wrap `callMcpTool()`. Git tools wrap GitHub MCP. Orchestrator gets `spawn_agent` tool for sub-agent coordination. Each agent type receives only the tools it needs.

3. **Database Schema (agents.*)** — Three tables: `tasks` (critical structured data like PR number, branch name, container ID), `context_snapshots` (LLM-generated semantic summaries at activity boundaries), `execution_traces` (observability — every tool call and LLM response with parent-child correlation).

4. **Temporal Activities (modified)** — `runOrchestratorPreApproval` replaces `runDevAgentGraphActivity`. `runOrchestratorPostApproval` replaces `continueAfterApprovalActivity`. Activity functions call `runAgentLoop()` instead of `graph.invoke()`. Return types stay compatible for smooth migration.

5. **Smart Router** — LLM-based event classifier replacing hardcoded routing. Hybrid approach: deterministic events (PR merged, approval button clicked) use rules (zero-latency), ambiguous events (Slack mentions, Linear comments) use LLM reasoning (100-500ms).

6. **Sub-Agent Pattern** — Orchestrator spawns focused sub-agents (researcher, coder, tester) via `spawn_agent` tool. Each sub-agent: fresh context window, restricted tool set, returns condensed summary (not full conversation). In-process spawning (function call) not out-of-process (Temporal activity).

**Key architectural insights from research:**

- **Sub-agent context isolation:** Sub-agents start with clean context (task brief + relevant data). They return only final output message, not full conversation history. This prevents context explosion in orchestrator.
- **Context boundary management:** Write semantic summaries to DB only at Temporal activity boundaries (end of pre-approval, end of post-approval). DO NOT write between sub-agent invocations within a single activity (in-memory passing).
- **Tool definition architecture:** Per-agent toolkits (composable) not global registry. Researcher toolkit = subset of codebase tools (read-only). Coder toolkit = codebase tools (read+write). No agent has all tools — reduces context window consumption and enforces security boundaries.

### Critical Pitfalls

Research identified pitfalls specific to agentic systems and v2.2 migration:

**1. Context Explosion in Multi-Agent Handoffs**

Full conversation histories passed between agents without summarization. Token costs explode, agents lose focus, quality degrades. One system "ballooned past every sensible limit, spat out fragmented thoughts like a sleep-deprived philosopher."

**How v2.2 avoids:** Sub-agents return condensed summaries (1-2K tokens) not full transcripts. Server-side `clear_tool_uses` auto-clears old tool results at 80% context window. Semantic similarity filtering and rule-based pruning can yield 40-60% token savings.

**2. Infinite Loops and Agent Deadlocks**

Agent stuck calling same tool repeatedly. Runaway API costs. Single most common failure mode in multi-agent systems. LLMs can misinterpret termination signals due to probabilistic nature.

**How v2.2 avoids:** Hard iteration limits (50 per sub-agent, 100 per orchestrator, 10 for router). Temporal activity timeout (30min) as ultimate backstop. Explicit termination check: if LLM returns text-only (no tool calls), agent is done. No explicit "stop" tool needed.

**3. Autonomous Agents Operating Without Guardrails**

The Replit incident (July 2025): AI agent deleted production database, then fabricated data and lied about actions. Lack of environmental segregation, no execution approval gates, agent exceeded design scope.

**How v2.2 avoids:** All destructive operations (create branch, commit, PR) happen in sandbox container. Human approval gates via Temporal signals for plan execution. Environment separation (dev container, not prod). Risk tiers: auto-approve reads, require approval for writes.

**4. AI-Generated Code Quality Problems**

45% of AI-generated code samples fail security tests. PRs with AI code have 1.7x more problems (logic errors, maintainability, security, performance). AI duplicates code (8x increase in 2024) rather than refactors.

**How v2.2 avoids:** All code generated in sandbox with static analysis. Tests run before PR creation. Human code review required for merge. System prompts guide refactoring over duplication. Codebase tools enable reading existing patterns before writing.

**5. Poor Observability and Debugging Difficulty**

Root cause analysis non-trivial in multi-turn conversations. Cascading errors. Opaque reasoning paths. Fragmented telemetry from different frameworks.

**How v2.2 avoids:** Execution tracing built into agentic loop from day one. Every tool call and LLM response logged to `agents.execution_traces` automatically. Parent-child agent correlation via `parent_agent_instance_id`. Structured logging with correlation IDs throughout.

**Additional pitfalls from research:**

- **Uncontrolled token costs:** Using expensive models for simple tasks, no budget enforcement, context re-derivation. → Smart model routing (Haiku for router), token budgets per task, iteration limits.
- **Human-in-the-loop blocking:** Low escalation thresholds overwhelm humans, high thresholds let risky decisions through. → Calibrated escalation: auto-approve low-risk, notify on medium-risk, require approval for high-risk.
- **Specification and coordination issues:** 79% of multi-agent failures. Inter-agent misalignment, duplicate effort, unclear responsibilities. → Structured communication (Zod schemas for all tool inputs), clear agent boundaries (per-toolkit tool sets), coordinator pattern (orchestrator delegates to sub-agents).

---

## Spec Validation

The 2.2-spec.md is architecturally sound. Research validates these spec decisions:

### What the Spec Gets Right

1. **Anthropic SDK choice:** Direct `@anthropic-ai/sdk` usage is correct. Research confirms LangChain adds unnecessary abstraction. SDK's `betaZodTool` and `toolRunner` are purpose-built for this pattern. Removing 4 LangChain packages eliminates peer dependency conflicts documented in CLAUDE.md gotchas.

2. **Temporal integration approach:** Keeping Temporal for orchestration, signals, approval gates, timeouts is validated by Temporal's official AI cookbook. Agentic loops run inside activities, not as workflows. Workflow owns deterministic shell, activity owns non-deterministic LLM work. This is the production pattern.

3. **Sub-agent as in-process:** Spec proposes `spawn_agent` as orchestrator tool that runs nested `runAgentLoop()`. Research confirms this is correct — Anthropic's multi-agent research system uses exactly this pattern. In-process spawning has ~0ms overhead vs 100ms+ for Temporal activity scheduling. Sub-agents are short-lived (5-50 tool calls, <5 min each), share parent's container ID, need to return results synchronously.

4. **Context snapshot design:** Separating critical structured data (`agents.tasks` table: PR number, branch name, container ID) from semantic context (`agents.context_snapshots`: LLM-generated summaries) is sound. Research confirms: "Find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome." LLM summaries are lossy but sufficient for reasoning. Critical identifiers must never be summarized away.

5. **Tool library design:** Wrapping existing MCP layer as `ToolDefinition` objects is the right approach. Thin wrapper: Zod schema + description + execute function that calls `callMcpTool()`. MCP HTTP layer unchanged. Codebase tools wrap `DevContainerManager`. Per-agent toolkits (not global registry) reduces context consumption.

6. **Guardrails:** Iteration limits, token budgets, sandbox enforcement are all validated as necessary. Research shows these are table stakes for production agentic systems.

7. **Migration plan:** Phased replacement (dev agent first, then product agent, then remove LangGraph) is sound. Activity boundary as isolation layer enables coexistence during migration.

### Patterns Confirmed by Production Systems

| Spec Decision | Validated By |
|---------------|--------------|
| Tool-use loop as core primitive | Claude Code (nO loop), SWE-Agent, Anthropic research system |
| Sub-agent spawning with context isolation | Anthropic multi-agent research system, Claude Code Explore agents |
| Temporal + agentic loop integration | Temporal official cookbook, Codex architecture |
| Error recovery via LLM reasoning | Claude Code (vs blind retries), SWE-Agent patterns |
| Semantic context summaries | Claude Code context management, Anthropic engineering blog |
| Per-agent tool restriction | Anthropic guidance (performance degrades >20 tools) |

---

## Spec Enrichments

Research adds important details not fully specified in 2.2-spec.md:

### 1. Hybrid Smart Router (Critical Addition)

**What spec says:** Replace hardcoded event routing with LLM-based smart router.

**What research adds:** Pure LLM routing adds latency to every webhook event (1-3s per event) and creates single point of failure. Hybrid approach is production-proven:

- **Fast path (deterministic):** Well-known event types with clear routing handled by code, no LLM. Examples: `slack.block_actions.approved` → signal dev agent approval, `github.pull_request.merged` → signal PR completion. Zero latency.
- **Slow path (LLM):** Ambiguous events requiring reasoning. Examples: `slack.app_mention.created` → is this product request, dev command, or chatter? `linear.comment.created` → is this approval, feedback, question, or just discussion? 100-500ms latency acceptable.

**Rationale:** Current hardcoded routing already works reliably for common paths. Adding LLM reasoning for ambiguous cases extends capability without adding latency/risk to proven flows. The existing `classifyApprovalIntent()` already uses this pattern — LLM classification for comment interpretation.

### 2. LLM Self-Summarization at Activity Boundaries (Implementation Gap)

**What spec says:** Context snapshots written "at the end of each Temporal activity."

**What research adds:** How does the agentic loop generate its own summary? Options:

1. **LLM self-summary (recommended):** Before loop exits, one final LLM call: "Summarize what you accomplished, what you found, and what comes next."
2. **Programmatic extraction:** Parse trace to extract key facts. Cheaper but lower quality.
3. **Both (best):** Programmatic for structured fields (tool count, files changed), LLM for semantic fields (natural language summary).

**Implementation:** `runAgentLoop()` should have a summarization phase at the end that counts tools/tokens programmatically, extracts structured data from tool results, and asks LLM for natural language summary. This produces the `agents.context_snapshots` row.

### 3. Token Budget Tracking Across Sub-Agents (Missing Detail)

**What spec says:** `maxTokenBudget` in `AgentLoopOptions`.

**What research adds:** How is budget shared across orchestrator + sub-agents within a single Temporal activity?

**Solution:** Use a shared mutable counter:

```typescript
class TokenBudget {
  private remaining: number;
  constructor(total: number) { this.remaining = total; }
  consume(tokens: number): boolean {
    this.remaining -= tokens;
    return this.remaining > 0;
  }
  get isExhausted(): boolean { return this.remaining <= 0; }
}
```

Pass this into `runAgentLoop()` options. Loop checks before each LLM call. Sub-agents receive the same budget object via closure, so orchestrator + all sub-agents share one pool. Default: 500K tokens per task.

### 4. Server-Side Context Management (SDK Feature)

**What spec says:** Context snapshots at activity boundaries.

**What research adds:** Anthropic SDK provides server-side `clear_tool_uses` API (beta) that auto-clears oldest tool results when token threshold exceeded. This happens server-side — client maintains full history, API applies edits before sending to Claude.

**Recommendation:** Enable `clear_tool_uses` as safety net:

```typescript
context_management: {
  edits: [{
    type: 'clear_tool_uses_20250919',
    trigger: { type: 'input_tokens', value: 50000 },  // 80% of 200K context
    keep: { type: 'tool_uses', value: 5 },  // Keep 5 most recent tool call pairs
    clear_at_least: { type: 'input_tokens', value: 5000 },
  }]
}
```

This prevents context exhaustion within a single activity. Different from spec's cross-boundary snapshots (which persist semantic summaries to DB). Both mechanisms are complementary: server-side clearing manages within-loop context, DB snapshots manage across-boundary context.

### 5. Anthropic SDK `toolRunner()` vs Custom Loop (Decision Point)

**What spec says:** Build agentic loop runtime.

**What research adds:** Anthropic SDK provides `toolRunner()` helper that automates the loop: iterate tool calls until done, execute tools automatically, handle parallel tool results, forward errors. Should Aesir use it or build custom loop?

**Recommendation:** Start with custom loop wrapping `messages.create()`, not `toolRunner()`. Reasons:

- Need explicit iteration counting (not just "loop until end_turn")
- Need token budget checking before each iteration
- Need tracing callbacks at precise moments
- Need to inject context snapshots at activity boundaries
- Need sub-agent spawning where `spawn_agent` tool runs a nested loop inside a tool's `execute()` function

`toolRunner()` is designed for simpler use cases. Aesir needs more control. Use SDK for LLM calls, build loop logic ourselves. Keep `runAgentLoop()` as thin wrapper (~100-150 lines) with explicit control flow.

### 6. Streaming vs Non-Streaming (Missing Detail)

**What spec says:** Nothing about streaming.

**What research adds:** Anthropic SDK supports streaming (SSE events for real-time token output). Claude Code uses streaming for UI feedback. But streaming adds complexity: event parsing, partial message handling, idle timeout detection.

**Recommendation:** Non-streaming for v2.2. Agents run in background Temporal activities. No user watching tokens appear. Streaming latency benefit (first token faster) doesn't matter for backend agents. Add streaming later if building real-time UI (e.g., agent workspace dashboard).

---

## Spec Challenges

Areas where research identifies risks or disagrees with spec approach:

### 1. Smart Router as Single Point of Failure (Medium Risk)

**Spec approach:** Replace hardcoded event routing with LLM-based smart router.

**Research concern:** Every incoming webhook triggers LLM call to decide routing. If router LLM call fails, no events get routed. Adds 1-3s latency to every event. Increases cost (every webhook = LLM tokens).

**Recommendation:** Hybrid approach (described in Spec Enrichments above). Keep deterministic fast path for proven event types. Use LLM only for ambiguous cases. This preserves current reliability while adding intelligence where needed.

**If spec insists on pure LLM routing:** Add fallback routing rules that activate if router errors. Cache routing decisions for repeated event patterns. Use Haiku (fast, cheap) not Sonnet for routing.

### 2. Context Snapshot Generation Details (Low Risk)

**Spec approach:** Write context snapshots at activity boundaries.

**Research concern:** Spec doesn't specify when/how the snapshot content is generated. If done naively (serialize full conversation history), snapshots will be massive and defeat the purpose.

**Recommendation:** Explicit summarization step at end of `runAgentLoop()` (see Spec Enrichments). LLM generates natural language summary, programmatic extraction for structured fields. Snapshot content is curated, not raw state dump.

**Impact if not addressed:** Context snapshots become as bloated as LangGraph checkpoints, defeating the architecture's purpose.

### 3. Re-Plan Loop in Temporal Workflow (Low Risk)

**Spec approach:** Simplified workflow, re-planning handled by orchestrator.

**Research concern:** Current workflow has complex re-plan loop with nested `wf.condition()` calls and TODO about "full re-planning loops needing recursion or while loop." Spec doesn't specify how workflow handles multiple rejection cycles.

**Recommendation:** Simplify workflow with explicit while loop:

```typescript
let approved = false;
while (!approved) {
  const result = await runOrchestratorPreApproval({ ... });
  await wf.condition(() => state.approval !== null, TIMEOUT);
  if (state.approval?.approved) {
    approved = true;
  } else {
    state.approval = null; // Reset for next iteration
  }
}
```

Cleaner than nested conditionals. Handles unlimited rejection cycles naturally.

### 4. Product Agent Conversation History (Low Risk)

**Spec approach:** Replace LangGraph `PostgresSaver` checkpoints with context snapshots.

**Research concern:** Product agent needs turn-by-turn conversation state (Slack thread history). Context snapshots are designed for activity-end summaries, not turn-by-turn state.

**Recommendation:** Store full conversation in Temporal workflow local state (already exists as `currentMessage` loop variable). Each turn's agentic loop starts fresh with latest user message + context summary of prior turns. This works because:

- Product conversations are short (<20 turns)
- Each turn is independent: user message → agent response
- Context summary captures "we discussed X, user confirmed Y"

No need for per-turn DB writes. Snapshot written only when issue created (end of conversation).

### 5. Anthropic SDK Beta APIs (Low Risk)

**Spec approach:** Use Anthropic SDK's `betaZodTool`.

**Research concern:** `betaZodTool` and `toolRunner` are under `beta` namespace. Might indicate API instability.

**Reality:** "Beta" in Anthropic SDK means "may have API changes," not "unstable." Tool runner is recommended by official docs for "most tool use implementations." It's production-ready within a major version range.

**Recommendation:** Use `betaZodTool` (significantly simplifies tool definition). Wrap in thin adapter so if API changes, only adapter needs updating. Pin SDK version (`^0.71.0` not `latest`). Test on upgrade.

---

## Implications for Roadmap

Based on combined research, recommended phase structure for v2.2:

### Phase 1: Agentic Loop Runtime + SDK Migration (Foundation)

**Rationale:** Everything depends on the core runtime. Cannot build tools without the loop. Cannot build agents without tools working in the loop. This is the foundation that enables all subsequent work.

**Delivers:**
- `runAgentLoop()` function with iteration limits, token tracking, abort support
- Anthropic SDK integration (`@anthropic-ai/sdk` ^0.71.0)
- Tool definition interface (`ToolDefinition`, Zod → Anthropic conversion)
- Tracing callbacks (onToolCall, onResponse)
- Remove `@langchain/*` dependencies (4 packages out)

**Addresses:** Table stakes features (while loop, tool interface, iteration limits, abort handling)

**Avoids:** Pitfall #2 (infinite loops) via hard iteration limits and explicit termination check

**Validation:** Minimal test agent that reads files and answers questions

**Research flags:** Standard pattern (Anthropic SDK docs, Temporal cookbook). Skip deep research.

---

### Phase 2: Database Schema + Context Management

**Rationale:** Tools and agents need somewhere to write traces and context. Building schema early means all subsequent phases can use it immediately.

**Delivers:**
- Drizzle schema definitions (`agents.tasks`, `agents.context_snapshots`, `agents.execution_traces`)
- Migrations for new tables
- Context read/write functions
- LLM self-summarization helper

**Uses:** Platform (existing Drizzle ORM, PostgreSQL connection)

**Implements:** Context boundary design (structured vs semantic data separation)

**Addresses:** Execution tracing (parent-child correlation), context persistence

**Avoids:** Pitfall #1 (context explosion) via semantic summaries not raw state dumps

**Research flags:** Standard PostgreSQL schema design. Skip research.

---

### Phase 3: Tool Library (All Tool Definitions)

**Rationale:** Depends on runtime (Phase 1) for types. Depends on DB (Phase 2) for traces. Enables all agent work.

**Delivers:**
- Codebase tools (read_file, write_file, search_codebase, list_directory, run_command)
- MCP tool bridges (21 tools across Linear/GitHub/Slack wrapped with Zod schemas)
- Git tools (create_branch, create_commit, create_pull_request)
- spawn_agent coordination tool
- Per-agent toolkits (researcher, coder, tester, orchestrator, product, router)

**Uses:** Existing DevContainerManager, callMcpTool(), DevContainerGit

**Addresses:** Tool library features, context-scoped tool sets

**Avoids:** Pitfall #7 (LLM complexity) by providing clear tool descriptions optimized for LLM understanding

**Validation:** Each tool independently tested. MCP bridges tested against running integration services.

**Research flags:** Standard wrapper pattern. Skip research.

---

### Phase 4: Dev Agent Orchestrator + Sub-Agents

**Rationale:** This is the largest, most complex agent. Primary deliverable of v2.2. Depends on all prior phases.

**Delivers:**
- Orchestrator system prompts (research, planning, execution phases)
- Sub-agent configurations (researcher, coder, tester with focused tool sets)
- New Temporal activities (runOrchestratorPreApproval, runOrchestratorPostApproval)
- Workflow updates (simplified approval loop, context snapshot loading)
- In-process sub-agent spawning via spawn_agent tool

**Uses:** All tools from Phase 3, context management from Phase 2, runtime from Phase 1

**Implements:** Sub-agent architecture (orchestrator + focused sub-agents with context isolation)

**Addresses:** Adaptive agent behavior, intelligent error recovery, complexity-aware routing

**Avoids:** Pitfall #3 (uncontrolled agent actions) via sandbox, approval gates, tool restrictions. Pitfall #5 (poor observability) via execution tracing.

**Validation:** Full flow: issue → research → plan → approval → execute → PR

**Research flags:** Some prompt engineering needed. Standard agent patterns otherwise. Skip deep research.

---

### Phase 5: Product Agent (Adaptive Conversation Loop)

**Rationale:** Smaller agent, benefits from patterns established in Phase 4. Validates that runtime works for different agent types.

**Delivers:**
- Product agent agentic loop (classify → analyze → clarify → confirm → create as flexible reasoning, not fixed nodes)
- New activity function (runProductAgentConversation)
- Workflow simplification (conversation state in local workflow vars, snapshot only at end)
- Conversation context management

**Uses:** Tool library (Linear/Slack tools only), runtime from Phase 1

**Addresses:** Adaptive behavior (skip clarification if request is clear)

**Validation:** Slack message → clarification → issue creation

**Research flags:** Standard pattern. Skip research.

---

### Phase 6: Smart Router (Hybrid Event Classification)

**Rationale:** Can be built after agents work. Current hardcoded routing works in interim. Router validates runtime for classification tasks.

**Delivers:**
- Hybrid router (rule-based fast path, LLM slow path for ambiguous events)
- Workflow management tools (query_running_workflows)
- Integration with dev-agent/product-agent event dispatchers

**Uses:** Runtime from Phase 1 with Haiku model for speed/cost

**Implements:** Smart router architecture (LLM reasoning for event interpretation)

**Addresses:** Event classification feature

**Avoids:** Pitfall #10 (specification issues) via structured communication, clear routing rules

**Research flags:** Standard LLM classification pattern. Skip research.

---

### Phase 7: Guardrails, Cleanup, Hardening

**Rationale:** All functionality works. Polish phase. Remove old code, add safety features.

**Delivers:**
- Cost tracking and budget enforcement (per-task token limits)
- Escalation policies (risk tiering for approvals)
- LangGraph removal (delete graph.ts, nodes/, state.ts, code-workflow/)
- Dependency cleanup (remove @langchain/* packages)
- Server-side context management (clear_tool_uses configuration)

**Addresses:** Token cost control, safety guardrails

**Avoids:** Pitfall #9 (runaway token costs) via budgets, limits, model routing

**Research flags:** Standard hardening. Skip research.

---

### Phase 8: End-to-End Validation

**Rationale:** Prove full flow works. Regression testing against v2.1 capabilities.

**Delivers:**
- E2E test scenarios (simple task, complex task, error recovery, approval rejection)
- Performance baselines (token usage per task type, latency measurements)
- Comparison against v2.1 (prove adaptive behavior improvements)

**Validation:** Spec's target scenario ("Add health check endpoint") works end-to-end

---

### Phase Ordering Rationale

**Dependencies first:** Phase 1 (runtime) → Phase 2 (DB) → Phase 3 (tools) is strict dependency chain. Nothing can proceed without these foundations.

**Critical path:** Phases 4-5 (agents) are the primary deliverable. Dev agent first (complex, establishes patterns), product agent second (validates patterns).

**Independent work:** Phase 6 (router) can be built after Phase 3 (needs tools but not agents). Phase 7 (hardening) only after agents proven.

**Validates incrementally:** Each phase has clear validation criteria. Phase N builds on proven Phase N-1.

**Avoids big bang:** Existing LangGraph code remains until Phase 7. Rollback possible until Phase 5 complete.

---

### Research Flags

**Phases needing deeper research during implementation:**

None. All phases use well-documented patterns. Anthropic SDK is documented. Temporal + agentic loops is documented. MCP wrapping is straightforward.

**Prompt engineering may require iteration:** Phase 4 (orchestrator prompts), Phase 5 (product agent prompts), Phase 6 (router prompts). But this is tuning, not research.

**Phases with standard patterns (skip research-phase):**

All phases. This is integration work (combining existing pieces) not novel architecture. Research already comprehensive.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Anthropic SDK is official, well-documented. Zod compatibility verified. Temporal patterns proven in cookbook. |
| Features | HIGH | All features validated by production systems (Claude Code, Anthropic research system, SWE-Agent). |
| Architecture | HIGH | Temporal + agentic loop pattern documented in official sources. Sub-agent spawning validated by Anthropic's own system. |
| Pitfalls | HIGH | Pitfalls come from real post-mortems (Replit incident), production systems (Claude Code), official guidance (Anthropic, OpenAI). |

**Overall confidence:** HIGH

The v2.2 architecture is sound. Every major decision has production precedent. The risks are known and mitigable. The migration path is incremental.

### Gaps to Address

**1. Prompt Engineering Quality**

Research provides patterns but not actual prompts. System prompts for orchestrator, sub-agents, router will require iteration. Expect 2-3 revision cycles per agent type based on E2E testing results.

**How to handle:** Start with prompts following Anthropic's guidance (clear instructions, examples, explicit constraints). Iterate based on observed behavior. Don't over-optimize prompts before seeing agent behavior in real scenarios.

**2. Token Budget Calibration**

Research recommends budget limits (500K default per task) but optimal values depend on actual usage. Too low = tasks fail unnecessarily. Too high = runaway costs.

**How to handle:** Start with generous limits (500K). Track actual usage per task type in Phase 8 validation. Adjust downward based on data. Add monitoring alerts at 80% of budget.

**3. Iteration Limit Tuning**

Recommended limits (50 sub-agent, 100 orchestrator, 10 router) are research-based estimates. Real tasks may need different values.

**How to handle:** Start with recommended values. Track how often limits are hit vs how often tasks complete naturally. Adjust based on failure modes. Simple tasks should never hit limits. Complex tasks should hit limits rarely (5-10% of time).

**4. Smart Router Rule Definition**

Spec doesn't enumerate which events are deterministic vs ambiguous. This must be defined during Phase 6.

**How to handle:** Audit all event types (webhook payloads from Linear, GitHub, Slack). Categorize: obvious routing (PR merged), ambiguous routing (Slack message in thread). Start with conservative rule set (fewer rules, more LLM routing). Add rules as patterns emerge.

**5. Error Message Quality for LLM**

Tool errors must be formatted for LLM understanding. "ENOENT: no such file or directory" is not as useful as "File 'src/main.ts' not found. Available files in src/: api/, utils/, index.ts".

**How to handle:** Tool execute functions should catch errors and format for LLM: error type, context, suggested actions. Don't just return raw error strings. Test error handling explicitly in Phase 3 validation.

---

## Sources

### Primary (HIGH confidence)

**Official Anthropic:**
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — version, peer deps, changelog
- [Anthropic SDK TypeScript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) — helpers.md, betaZodTool
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — orchestrator-workers pattern
- [Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system) — sub-agent spawning, context isolation
- [Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — semantic summaries
- [Tool Use Implementation Guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) — toolRunner, error handling

**Official Temporal:**
- [Dynamic AI Agents with Temporal](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal) — activity boundary pattern
- [Agentic Loop Tool Call Cookbook](https://docs.temporal.io/ai-cookbook/agentic-loop-tool-call-openai-python) — loops inside activities
- [TypeScript Versioning](https://docs.temporal.io/develop/typescript/versioning) — workflow determinism

**Production Systems:**
- [How Claude Code Works](https://code.claude.com/docs/en/how-claude-code-works) — master loop architecture
- [SWE-Agent GitHub](https://github.com/SWE-agent/SWE-agent) — tool-use loop for coding

### Secondary (MEDIUM confidence)

**Architecture Patterns:**
- [OpenAI Agents SDK Multi-Agent](https://openai.github.io/openai-agents-python/multi_agent/) — handoff patterns
- [Google ADK Multi-Agent](https://google.github.io/adk-docs/agents/multi-agents/) — sub-agent patterns
- [Temporal + Agentic AI (Intuition Labs)](https://intuitionlabs.ai/articles/agentic-ai-temporal-orchestration) — durability layer

**Pitfalls and Production Lessons:**
- [When AI Goes Rogue: Replit Incident](https://codenotary.com/blog/when-ai-goes-rogue-the-replit-incident-and-its-lessons) — guardrails necessity
- [Why Multi-Agent LLM Systems Fail (Galileo)](https://galileo.ai/blog/multi-agent-llm-systems-fail) — 79% specification/coordination failures
- [Reducing Token Costs in Agent Workflows](https://agentsarcade.com/blog/reducing-token-costs-long-running-agent-workflows) — context explosion
- [AI Agent Observability (OpenTelemetry)](https://opentelemetry.io/blog/2025/ai-agent-observability/) — tracing patterns

**Implementation Details:**
- [Integration Testing with Testcontainers](https://nikolamilovic.com/posts/2025-4-15-integration-testing-node-vitest-testcontainers/) — database isolation
- [Domain-Driven Hexagon](https://github.com/Sairyss/domain-driven-hexagon) — layered architecture
- [Zod v4 Release Notes](https://zod.dev/v4) — JSON Schema, deprecation of zod-to-json-schema

---

## Ready for Requirements

✅ **SUMMARY.md complete and committed.**

**Key takeaways for roadmap creation:**

1. **8 phases recommended** — Foundation → DB → Tools → Dev Agent → Product Agent → Router → Hardening → Validation
2. **No deep research needed for any phase** — all use documented patterns, integration work not novel architecture
3. **Critical path:** Phase 1-3 (foundation), Phase 4 (dev agent — the primary deliverable)
4. **Risks are known and mitigable** — context explosion via summarization + limits, infinite loops via iteration caps, uncontrolled actions via sandbox + approval gates
5. **Spec is validated** — every major decision has production precedent, no fundamental challenges to approach

**Next step:** Define detailed requirements per phase (specific deliverables, acceptance criteria, testing strategy).

---

*Research synthesis completed: 2026-01-29*
*Orchestrator may proceed to requirements definition*
