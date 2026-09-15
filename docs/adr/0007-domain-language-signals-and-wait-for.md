# ADR-0007: Domain-language signals and `wait_for`

**Status:** accepted (v2.3, 2026-02-04)
**Supersedes / superseded by:** —

## Context

Under Temporal (pre-v2.3), signals were ceremony-heavy: each of six distinct signal types needed a typed `defineSignal<[Payload]>` definition, a dedicated sender function in `signal-handler.ts`, routing logic in `events.ts`, and its own payload type. Adding a new kind of external input meant touching all four. Separately, a structural race condition existed wherever an external reply could arrive before the workflow reached the point of waiting for it — the product agent worked around this with a retry-with-backoff hack rather than a fix.

## Decision

`IncomingEvent.type` is a freeform string, not a predefined enum — agents speak domain language ("approval", "pr_review", "pr_merged", "user_reply"), not integration or workflow language, and adding a new signal type requires no framework change: something emits an event with the new type, and an agent definition either triggers on it or calls `wait_for` with it. The `wait_for` tool pauses a conversation and sets `pendingWait = { type, metadata }`; the executor matches incoming signals by exact type and rejects (logs, does not resume) anything that doesn't match — a conversation waiting for `"approval"` is not woken by `"pr_merged"`. Signals that arrive while a conversation is running or not yet paused are queued on the conversation record rather than retried; when the agent next calls `wait_for`, the executor checks queued signals first and resumes immediately if one matches, which is the structural fix for the race condition the product agent used to work around with retries. Duplicate signals (webhook retries) are deduplicated by source and delivery ID, tracked in `delivered_signal_ids`, and are no-ops. v2.5 added one narrowly-scoped extension to this signal model: a `reopen` signal is the only signal type permitted to move a terminal conversation back to `queued` — every other signal type continues to be ignored for terminal conversations — and reopening injects a `<world_state>` context message rather than silently resuming where the agent left off.

## Consequences

- No enums, no predefined event types, no handler functions per signal — a new signal type is purely additive.
- The queueing mechanism eliminates a class of timing-dependent bugs (no `sleep()`, no retry loop) rather than papering over one instance of it.
- Type mismatch is a rejection, not a silent misapplication — protects `wait_for` semantics from an unrelated signal waking a conversation for the wrong reason.
- Reopening deliberately does not generalize to "any signal can revive a terminal conversation" — only `reopen` can, which keeps the terminal-state boundary explicit and observable rather than incidental.

## Sources

- `docs/history/decisions-log.md`, `## B. Project Key Decisions`: row "Domain-language signal types"; `## A. Per-plan decisions, by phase`, `### Phase 57-conversation-reopening` (world-state message via `<world_state>` XML tags, FIFO eviction consistent with the existing `signal()` pattern); `## B`: row "Conversation reopening via reopen signal".
- `docs/history/specs/design-vision.md`, `## Design Decisions Log`: row "Signal queueing, not retry backoff".
- `AGENTS.md`, `### WaitForState and Signals`.
- `docs/history/specs/2.3-spec-raw.md`, `### 6. Signal Handling` (Unified Event Shape, Signal Matching, Signal Queueing, Deduplication); Appendix `### A.7 Generalized Event System`.
