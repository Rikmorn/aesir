# ADR-0001: Postgres-backed conversation executor instead of a workflow engine

**Status:** accepted (v2.3, 2026-02-04)
**Supersedes / superseded by:** —

## Context

Temporal workflows had been the durability layer for agent runs since v2.1, providing signal-based flow control, approval gates, timeouts, and crash recovery. Temporal workflows are deterministic state machines that encode a phase graph (`setup → pre_approval → awaiting_approval → post_approval → ...`), but the v2.2 agent loop didn't think in phases — it thought in goals and tool calls. When the agent's actual behaviour diverged from the expected phase sequence, the workflow broke: a dev agent that completed a trivial task without calling `request_human_input` left its workflow waiting forever for a signal that would never arrive, requiring the workflow to reverse-engineer what the agent had done. Each Temporal activity invocation also started a fresh `runAgentLoop()`, so context accumulated during one activity — file paths, error messages, architectural reasoning — was lost by the time the next activity began, replaced by an LLM-generated summary. Signals that arrived before a workflow was ready to receive them (a Slack thread reply landing before the workflow started) were handled with retry-with-backoff hacks rather than a structural fix.

## Decision

Aesir runs a Postgres-backed `ConversationExecutor` as the sole durability and orchestration layer for agent conversations, replacing Temporal. Conversations are claimed with `SKIP LOCKED` semantics so only one worker processes a given conversation at a time — job-queue semantics that Temporal's workflow model didn't map onto cleanly. `pg-boss` is scoped narrowly to delayed signal delivery for `wait_for` timeouts, not to general orchestration. Signals that arrive before an agent calls `wait_for` are queued on the conversation record and are checked the next time the agent pauses, so a conversation resumes immediately without ever visibly pausing if a matching signal is already waiting — a structural fix for the race condition retry-with-backoff had been papering over.

## Consequences

- The agent loop is the state machine; there is no external phase graph to keep in sync with what the agent actually does, and no inference logic reverse-engineering agent behaviour from activity return values.
- Conversation history is the agent's complete memory across a pause/resume cycle — no per-activity summarization drops detail at the boundary.
- `pg-boss`'s responsibility stayed to a single, narrow concern (delayed signal scheduling), keeping the operational surface of that dependency small.
- Docker services for the agent runtime dropped from 12 to 6, removing Temporal and Temporal UI outright.
- Signal race conditions are eliminated structurally by queueing rather than patched with timing-dependent retries.
- Committed the project to owning conversation claiming, heartbeat monitoring, and timeout scheduling itself, rather than relying on a workflow engine's built-in guarantees for them.

## Sources

- `git show 39c7015c:.planning/PROJECT.md`, `## Key Decisions`: rows "Postgres-backed ConversationExecutor" and "pg-boss for timeout scheduling only" (the same table is preserved verbatim in `docs/history/decisions-log.md`, Part B).
- `git show 39c7015c:.planning/MILESTONES.md`, `## v2.3 Unified Agent Framework (Shipped: 2026-02-04)` — "cutting Docker services from 12 to 6".
- `docs/history/specs/2.3-spec-raw.md`, `### 3. Execution Model`; `#### Signal Queueing`; Appendix `### A.1 Why Temporal Is Being Replaced`.
- `docs/history/specs/design-vision.md`, `## Design Decisions Log`: row "Signal queueing, not retry backoff".
