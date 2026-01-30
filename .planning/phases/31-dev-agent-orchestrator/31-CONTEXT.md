# Phase 31: Dev Agent Orchestrator - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the 13-node LangGraph graph with an orchestrator agentic loop that reasons about tasks using sub-agents (researcher, coder, tester). The orchestrator decides what to research, how detailed to plan, whether to test, and how to recover from errors. Temporal integration is Phase 32 -- this phase builds the reasoning engine standalone.

</domain>

<decisions>
## Implementation Decisions

### LLM-first reasoning philosophy
- The orchestrator leverages LLM reasoning for ALL decisions: task complexity assessment, delegation strategy, error recovery approach
- No heuristic-based complexity classifiers or routing logic -- the LLM reads the task and decides
- No hardcoded skip conditions (e.g., "if docs-only, skip tests") -- the LLM reasons about what's appropriate
- Delegation vs. direct work is at the LLM's discretion based on the task and available tools
- This is the core architectural principle of v2.2: agents reason, they don't follow flowcharts

### Tools-only bootstrapping
- The orchestrator's system prompt contains identity, constraints, and sub-agent guidance -- not issue details or repo info
- The initial message contains the issue ID (and optionally title/description if already available from the triggering event)
- Everything else (repo structure, conventions, codebase patterns) is discovered via tools (read_file, search_codebase, get_issue, etc.)
- No template assembly or dynamic prompt construction -- the system prompt is a fixed string per agent type
- Rationale: removes coupling between activity setup code and orchestrator behavior; the same loop works for any task

### Self-sufficient agents (context via tools)
- Orchestrator and sub-agents fetch their own context rather than having it pre-loaded
- Context snapshots (Phase 29) are read via tools, not injected into system prompts by activity code
- This means the post-approval orchestrator loop uses the same code as pre-approval -- it just reads its previous context as its first action
- **Research needed**: Validate that tool-based context read is worth the extra LLM round-trip vs. injecting the snapshot into the initial message. User leans tool-based for flexibility, but cost/latency tradeoff should be evaluated.

### Static system prompts
- Each agent type (orchestrator, researcher, coder, tester) gets a fixed system prompt
- Dynamic context comes from tools and the initial message, not from prompt assembly
- Precedent: GSD workflow agents (researcher, planner, executor) use fixed prompts successfully
- **Research needed**: Validate that static prompts are sufficient for the dev orchestrator. The difference vs. GSD is that GSD operates on structured planning files while the orchestrator operates on arbitrary issues -- confirm this doesn't require dynamic prompt sections.

### Sub-agent context flow
- Orchestrator passes context to sub-agents via the spawn_agent tool's task/context parameters (already built in Phase 30)
- The orchestrator decides what context each sub-agent needs -- this is part of its reasoning
- Researcher gets the task description; coder gets the plan + relevant file references; tester gets changed files + project info
- Sub-agents can read additional files themselves if the orchestrator's brief is insufficient
- **Research needed**: Best format for sub-agent briefs -- structured JSON vs. natural language task description. Phase 30's spawn_agent accepts both.

### Claude's Discretion
- System prompt content: exact wording, constraint ordering, level of detail in sub-agent guidance
- Error recovery heuristics within the prompt: how to guide the LLM to try distinct approaches
- How the orchestrator decides plan granularity (brief vs. detailed) -- prompt guidance vs. emergent reasoning
- Whether the orchestrator reads the full issue first or just the title to decide complexity

</decisions>

<specifics>
## Specific Ideas

- "The overriding principle is to leverage the LLM" -- the orchestrator should be maximally LLM-driven with minimal scaffolding
- "Agents are self-sufficient" -- they discover what they need via tools rather than being told
- System prompt philosophy: like GSD agents, fixed prompts define identity and constraints, tools provide dynamic context
- The architecture should avoid creating maintenance surfaces -- if the "facts the orchestrator always needs" change, the orchestrator adapts via tools, not via code changes in the activity layer

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 31-dev-agent-orchestrator*
*Context gathered: 2026-01-30*
