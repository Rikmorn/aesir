# Phase 80: Richer Negotiation - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the binary accept/reject delegation handshake with counter-proposals and mid-task clarification. Agents can negotiate scope before starting work and ask follow-up questions during execution. Parallel delegation, tree budgets, and role-specific negotiation calibration are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Counter-proposal shape
- New `counter_propose` response type on existing `task:respond` tool (discriminated union) — not a separate tool
- Parameters: `taskId`, `type: "counter_propose"`, `reason` (optional), `proposal` (required — free-text modification description)
- Calling `task:respond({ type: "counter_propose" })` implicitly triggers `wait_for` on the target side — two-round handshake
- `task_counter_proposed` signal resumes the delegator's `wait_for` with payload: original task summary, counter-proposal text, responding agent ID
- Delegator sees the counter-proposal and uses existing tools to act: accept the modified version, reject/cancel the task, or re-delegate to a different agent — no new delegator-side tools needed
- Strictly accept/reject the counter-proposal — no counter-counter-proposals. If the delegator doesn't like it, reject and re-delegate with refined scope (effectively a fresh negotiation)
- Handshake answers "will you do this?" (bounded). Clarification handles "how exactly?" (iterative). Those are the right boundaries.

### Clarification style
- Standalone `task:clarify` tool in the task namespace — NOT an extension of `task:respond` (different lifecycle phase: execution vs handshake)
- Parameters: `taskId`, `question` (required — free-text), `options` (optional — structured choices when the question has discrete answers)
- `task:clarify` automatically enters `wait_for` — asking and waiting is a single logical operation
- `task_clarification` signal resumes the delegator with the question and options. Delegator answers via signal back to target
- Delegator can always answer freely regardless of whether structured options were provided
- Clarification time counts against the task timeout — single timeout model, no pause/resume clock mechanism
- Multi-round clarification naturally bounded by the task timeout — no hard round limit

### Negotiation personality
- Accommodating by default — counter-propose makes accommodating safe by enabling honest scoping
- Disposition hierarchy: prefer accepting > counter-proposing > rejecting. Move work forward.
- Counter-propose to honestly scope: "I can do this but not that part" beats accepting and delivering poorly
- Reserve rejection for genuine capability mismatches: "I'm a test runner, I can't write a product brief"
- Clarify when the ambiguity is about intent (what do you want?) — proceed with assumptions when ambiguity is about implementation (how should I build it?)
- Cost-of-being-wrong framework: clarify when wrong assumption wastes significant work; assume when getting it wrong is cheap to fix
- Task timeout is the universal bound for both clarification rounds and delegation retry attempts — no hard limits on either
- Generic negotiation principles for all agents in v2.9 — role-specific calibration deferred to v3.0 Domain Modeling

### Fallback after rejection
- Entirely the delegator's responsibility — agent-first principle. No system-level retry mechanism or alternative suggestions.
- Delegator's LLM reasons about next steps using existing tools: directory search (today), capability-based discovery (Phase 85)
- Rejection/counter-proposal-rejected signals carry: reason, original task summary, responding agent ID — enough context for the delegator to reason without history lookup
- Consistent signal shape across all delegation signals (rejection, counter-proposal, counter-proposal-rejected, clarification)
- Re-delegation context is naturally included by the delegator's LLM in the new task description — no `previousAttempts` system field needed
- The delegator decides what prior context is relevant to share with the new agent (sometimes the rejection reason matters, sometimes it doesn't)

### Claude's Discretion
- Signal naming conventions (exact signal type strings)
- Zod schema design for the discriminated union on `task:respond`
- `task:clarify` internal implementation and how it interacts with the wait_for mechanism
- Dashboard representation of counter-proposals and clarifications in the conversation timeline
- Prompt wording for the generic negotiation principles

</decisions>

<specifics>
## Specific Ideas

- Counter-propose mirrors good team dynamics: "A helpful colleague doesn't say 'not my job' — they say 'I can handle X, but you'll need someone else for Y.'"
- The two-round handshake is a meaningful design detail the planner needs: `task:respond({ type: "counter_propose" })` triggers `wait_for` on the target, then the delegator's acceptance/rejection signals back to resume or terminate
- NEG-01 lists three outcomes (accept modified, reject, try someone else) but the spec doesn't specify they flow through signals — the planner needs to know this is signal-based, reusing existing tools, not new tools
- Clarification cost-of-being-wrong examples: "Build the auth system" = clarify (OAuth vs JWT = different work). "Create a Linear ticket" = proceed (agent decides priority/labels). "Research this library" = proceed broadly, let delegator narrow.
- PITFALLS.md CRITICAL-1 (clarification deadlock from nested wait_for) is an architectural concern — round limits don't fix it, deadlock detection does

</specifics>

<deferred>
## Deferred Ideas

- Role-specific negotiation calibration (e.g., "QA agent should be more selective about work outside testing scope") — v3.0 Domain Modeling
- Counter-counter-proposals / multi-round handshake negotiation — explicitly rejected, re-delegation handles this
- System-suggested alternative agents after rejection — anti-pattern per agent-first principles

</deferred>

---

*Phase: 80-richer-negotiation*
*Context gathered: 2026-02-20*
