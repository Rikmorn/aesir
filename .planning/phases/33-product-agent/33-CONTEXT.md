# Phase 33: Product Agent - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the product agent's 6-node LangGraph conversation graph with a single adaptive agentic loop using `runAgentLoop()`. The agent reasons about input clarity and decides its own conversation strategy — clear requests create issues fast, vague requests trigger focused clarification, cancellation detected via LLM reasoning.

</domain>

<decisions>
## Implementation Decisions

### Core architecture
- Follow the agentic tool-use loop pattern established in Phases 28-32 — `runAgentLoop()` replaces the LangGraph StateGraph
- If the agent needs capabilities, add tools — tools are the extension mechanism
- If data or context needs persistence, use the database — `agents.*` schema is available
- Reuse patterns from dev-agent orchestrator (Phase 31-32) as reference for Temporal integration, system prompts, and activity structure

### Agent philosophy
- Prioritize effectiveness, capability, and intelligence over conversational polish
- No specific tone requirements — agent should be direct and useful
- Adapt to input clarity: clear request → issue in 1-2 tool calls, vague → ask focused questions
- Cancellation detection via LLM reasoning (no hardcoded phrase lists)
- Duplicate search before creating issues

### Multi-issue handling
- Not pre-decided — needs research into how the current agent handles this and what the best approach would be for the agentic loop pattern

### Claude's Discretion
- Conversation tone and phrasing style
- How to structure the system prompt (XML sections, etc.)
- Turn boundary architecture (one `runAgentLoop` per turn vs long-running loop with signal waits)
- Conversation state management across Temporal activity boundaries (full history injection vs summary-based context)
- Tool set composition (which MCP tools to expose, whether confirmation is a tool or natural conversation behavior)
- Activity structure and retry configuration

</decisions>

<specifics>
## Specific Ideas

- Prior phases (28-32) established the patterns — treat them as the reference architecture
- The 2.2 spec (Section 5: Product Agent) describes the target behavior in detail including tools, Temporal integration, and adaptive conversation flow
- Current product agent has 6 nodes (classify → analyze → clarify → confirm → createTasks → notify) with PostgreSQL checkpointer for multi-turn state — all replaced

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 33-product-agent*
*Context gathered: 2026-01-30*
