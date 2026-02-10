# Phase 70: Task Delegation - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents delegate work to other agents through tasks with a negotiation handshake, creating cross-conversation collaboration. `task:delegate` creates a task targeting a directory entity, materializes it as a new conversation via `executor.start()`, and a handshake (accept/reject) gives the delegator agency over whether to proceed, pivot, or escalate. Agent-only materialization (single path). Human delegation, parallel delegation, and counter-propose deferred.

</domain>

<decisions>
## Implementation Decisions

### Delegation Brief Shape
- `task:delegate` has two required fields only: `targetEntityId: string` + `description: string`
- No structured priority, effort estimate, deadline, or knowledge reference fields -- the agent writes all context into the description as prose
- Agent-first principle: the tool is a thin routing mechanism, the intelligence lives in the agent's brief
- The delegate queries shared memory independently (DEL-10) -- no knowledge entry IDs passed structurally
- Priority, effort estimates, and structured expectations deferred until the system acts on them

### Target Agent Initial Context
- Delegation brief injected as the initial user message using a `<delegation>` XML block
- Format: `<delegation task_id="task_abc123" from="product-agent" depth="2" max_depth="3">`
- Attributes carry machine-readable fields (task_id, from, depth, max_depth); body is the description string
- Consistent with existing XML patterns (`<task_context>`, `<summary>`)
- Target agent's prompt.md guides: evaluate the delegation, respond via handshake, then work if accepted

### Delegate Return Behavior
- `task:delegate` returns immediately with task ID -- does NOT block for handshake
- Delegator calls `wait_for` (type: "task_handshake", taskId) to pause and await the response
- Async flow: delegate → wait → resume on handshake signal (accept/reject)
- 30s handshake timeout is a wait_for timeout via pg-boss (DEL-08), not a tool execution timeout
- Race condition handled: signals delivered to non-waiting conversations are queued, worker loop auto-resumes on match

### Handshake Behavior
- `task:respond` tool schema: `taskId: string` (required), `response: "accept" | "reject"` (required), `estimate: string` (optional, with accept), `reason: string` (optional, with reject)
- Estimate is free-text ("~15 minutes", "should be quick") -- no structured duration field
- In Phase 70, estimate is informational for delegator context only; Phase 71 delegator uses it for timeout judgment
- Separate estimate/reason fields: estimate informs timeout planning, reason informs fallback routing
- Signal payload is self-contained: `{ taskId, response, estimate|reason, respondedBy }`
- No framework enforcement of handshake-before-work -- prompt-guided only (agent-first principle)
- 30s timeout without handshake = treated as rejection, delegator pivots

### Rejection and Pivot Flow
- Agent judgment drives pivot strategy based on rejection reason
- Common path: try next candidate from existing `directory:find` results (no re-query)
- Rare path: rejection reveals wrong query ("you need a DBA, not a backend dev") → re-query with refined terms
- Prompt guidance: "If rejected, consider the reason. Try next candidate from existing results. If the rejection suggests you need a different capability, re-query. If all candidates exhausted, report failure to your delegator."

### Depth Enforcement
- `depth` integer column on tasks table: root task = 0, delegated task = parent.depth + 1
- MAX_DELEGATION_DEPTH = 3 (depth 0, 1, 2 active -- two delegation hops max)
- Enforced in `task:delegate` tool before task creation -- agent gets immediate error: "Delegation depth limit reached (3). Handle this work directly."
- Depth and max_depth included in `<delegation>` block attributes as context (not enforcement)
- Target agent at max depth: (1) attempt work yourself if remotely capable, (2) fail task with specific capability reason, (3) store context in shared knowledge before failing
- Depth limits push problem-solving up the tree -- parent at depth 1 has full delegation capability

### Prompt Judgment Criteria
- Guidance lives in each agent's prompt.md with role-specific examples (not framework-injected)
- **Spawn vs Delegate heuristic:** sub-agent spawn = "my job, need a specialist tool" (coder, researcher, tester); delegation = "someone else's job" (different agent capabilities)
- Simplest signal: if it's in your subAgents list, spawn. If you need directory:find, delegate.
- **When NOT to delegate:** work is within your capabilities (even if imperfect), task is small relative to delegation overhead, you already have the context from research
- **When to delegate:** genuine capability gap, distinct unit with clear deliverable, work justifies independent budget and tracking ("would you create a separate ticket for this?")
- **Anti-pattern:** management-layer agent that delegates everything and produces nothing. Delegation is for capability gaps, not preference.
- Universal principles duplicated across 2-3 orchestrators with agent-specific criteria (e.g., dev-agent: "don't delegate code writing", product-agent: "never delegate user conversation")

### Claude's Discretion
- Schema extensions on tasks table beyond depth (e.g., delegation_metadata JSONB vs separate columns)
- Exact `<delegation>` block content beyond specified attributes
- Error message wording for depth limit rejection
- Whether `task:delegate` also takes an optional `parentTaskId` explicitly or infers it from the current task context

</decisions>

<specifics>
## Specific Ideas

- "The tool is a thin routing mechanism, the intelligence lives in the agent's brief" -- agent-first principle applies to delegation as much as everything else
- Delegation as triggering event: `<delegation>` block is the initial user message, following the pattern where events trigger conversations
- "Each level manages its own subtree" -- A sees only B's final result, not C's intermediate failures (from spec Phase 74 resolution, relevant to delegation design)
- "Don't delegate what you can spawn. Delegation has overhead -- handshake, new conversation, signal routing, separate budget."
- Handshake ordering: prompt says "evaluate first, respond, then work" -- no tool filtering state machine in the executor

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 70-task-delegation*
*Context gathered: 2026-02-10*
