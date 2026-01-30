# Phase 32: Dev Agent Temporal Integration - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Wrap the orchestrator agentic loop (Phase 31) inside Temporal's durability envelope. Three new activities replace the LangGraph-based activities. A simplified workflow handles approval gates, PR feedback loops, and timeouts. Context snapshots (Phase 29) provide continuity across activity boundaries.

This phase does NOT preserve the v2.1 Temporal workflow structure. The existing `dev-agent-workflow.ts` and `dev-agent-activities.ts` are legacy LangGraph wrappers — they should be replaced, not adapted.

</domain>

<decisions>
## Implementation Decisions

### Fresh implementation over legacy adaptation
- The existing Temporal workflow (`dev-agent-workflow.ts`) and activities (`dev-agent-activities.ts`) wrap LangGraph graphs — they are not a template for v2.2
- Write new activities and workflow from scratch to serve the agentic orchestrator
- The old code's structure (10 activity types, nested approval handling, graph invocation) reflects LangGraph's architecture, not the agentic pattern
- Phase 35 (Guardrails & Cleanup) will remove the old files; Phase 32 creates the new ones alongside them

### Three orchestrator activities
- `runOrchestratorPreApproval` — runs the orchestrator agentic loop for research + planning, returns a plan for human approval
- `runOrchestratorPostApproval` — runs the orchestrator agentic loop for execution + testing + PR creation, resuming from context snapshot
- `handleOrchestratorFeedback` — runs the orchestrator agentic loop to address PR review comments with targeted fixes
- Each activity invokes `runAgentLoop()` (Phase 28) with the orchestrator's system prompt and toolkit

### Orchestrator handles side-effects via tools
- The orchestrator sends Slack messages, updates Linear status, and posts approval requests through its own tools (built in Phase 30)
- This eliminates separate activities for `updateSlackApprovalActivity`, `syncApprovalToLinearActivity`, `sendReminderActivity`
- The workflow only needs orchestrator activities + infrastructure activities (container stop, task completion)
- Fewer activity types = simpler workflow = less Temporal-specific logic

### Context snapshot handoff between activities
- Pre-approval activity writes a context snapshot at completion (via Phase 29 context manager)
- Post-approval activity starts the same orchestrator loop — it reads its previous snapshot as its first action via tools (Phase 31 decision: "self-sufficient agents fetch their own context")
- No injection of context into system prompts or initial messages by activity code
- The same orchestrator code runs in both activities — the difference is what context exists in the database when it starts

### Simplified workflow structure
- Setup → pre-approval loop → approval wait → post-approval loop → PR wait → feedback loop → complete
- Signal types carry over unchanged: `planApprovalSignal`, `prFeedbackSignal`, `prCompletionSignal`, `escalationResolvedSignal`
- Timeout patterns carry over: 24h reminder, 72h total approval, 7-day PR feedback
- Re-planning on rejection is handled inside the orchestrator loop (via `request_human_input` tool), not as a separate Temporal activity

### LLM-first philosophy (inherited from Phase 31)
- The orchestrator decides what to do — the Temporal wrapper just provides durability and signal handling
- No complexity routing, phase enums, or conditional activity selection in the workflow
- The workflow is a thin shell: start loop, wait for signal, start loop again, wait for signal, complete

### Claude's Discretion
- Activity retry configuration for agentic loops (retry count, backoff, timeouts)
- How `request_human_input` sentinel maps to Temporal signal waits (parsing approach)
- Whether container setup is a separate activity or part of pre-approval
- Error classification: which errors are retryable at the Temporal level vs. handled inside the orchestrator

</decisions>

<specifics>
## Specific Ideas

- "Ignore any carry over code from v2.1 — agent tool loop is the focus. Old code should be refactored to fulfil new objectives."
- The existing workflow has 10 activity types and ~694 lines of nested approval/feedback handling. The new workflow should be dramatically simpler because the orchestrator handles most logic internally.
- The `HUMAN_INPUT_MARKER` sentinel (Phase 30 decision) allows the orchestrator to signal "I need human input" from inside the agentic loop — the activity wrapper parses this to pause the Temporal workflow.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 32-dev-agent-temporal*
*Context gathered: 2026-01-30*
