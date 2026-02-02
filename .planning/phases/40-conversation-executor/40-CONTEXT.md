# Phase 40: Conversation Executor - Context

**Gathered:** 2026-02-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Postgres-backed durable executor that replaces Temporal workflows. Worker loop claims conversations with concurrency-safe locking (SELECT FOR UPDATE SKIP LOCKED), agents pause via `wait_for` tool, signals resume matching conversations, with at-least-once execution and crash recovery. The `ConversationExecutor` interface abstracts the backing implementation -- Postgres for local dev, production swaps to AWS services (SQS, EventBridge) without interface changes.

</domain>

<decisions>
## Implementation Decisions

### Message Persistence Strategy
- Messages live in memory during agent loop execution, persisted to JSONB column only at lifecycle boundaries (pause, complete, fail)
- 2 writes per execution cycle: one on pause/complete, one read on resume
- Full array replacement on persist (UPDATE SET messages = $fullArray) -- TOAST rewrites the whole blob anyway, no benefit from delta approach
- LZ4 compression on the messages column from day one (Postgres 15 supports it, 2x faster than default pglz, trivial to configure via migration)
- No per-tool-call persistence -- avoids CRITICAL-1 write amplification entirely

### Crash Recovery Strategy
- Re-run from last persisted state: heartbeat detects stale conversation, re-enqueues it, agent loop restarts from the last persisted messages snapshot
- In-memory messages between persist points are lost on crash -- accepted tradeoff for simplicity
- No event-log replay for message reconstruction -- the re-run approach is simpler and sufficient

### Worker & Concurrency Model
- Fixed 5-second polling interval for the worker loop (SELECT FOR UPDATE SKIP LOCKED)
- Configurable concurrency limit, default 3 concurrent conversations per process (env var override)
- Scaling path: single process (1-10 conversations) -> multiple process instances sharing same DB via SKIP LOCKED (10-100) -> swap to SQS/EventBridge (100+)
- 30-second heartbeat interval: worker updates `last_heartbeat_at` on conversation record every 30s during execution
- 5-minute stale threshold: conversations with heartbeat older than 5 minutes are considered abandoned and re-enqueued
- **Note for production revisit:** heartbeat interval, stale threshold, polling interval, and concurrency limit are all implementation details behind the ConversationExecutor interface and should be tuned for production deployment
- Conversations table used directly for job claiming (no separate queue table) -- sufficient for current scale, abstracted behind executor interface
- Graceful shutdown: on SIGTERM, stop accepting new conversations, let running loops persist at next natural boundary, Docker `stop_grace_period` set to 60-120s

### Failure & Retry Semantics
- Up to 2 retry attempts for failed agent loops (matches Temporal's current `maximumAttempts: 2`)
- Exponential backoff between retries: 30s, 60s
- Non-retryable errors (immediate fail, no retry): `TokenBudgetExhaustedError`, `AgentAbortedError`
- All other errors are retryable (transient LLM failures, network issues, tool crashes)
- After 2 failed retries, conversation status set to `failed`
- Transparent retry: agent does not know it's a retry, re-runs from last persisted state as if nothing happened
- Retry counter tracked internally for logging/observability but not exposed to the agent

### Duplicate Start & Re-trigger Behavior
- Running/paused conversations: `start()` returns existing conversation ID (idempotent no-op, per spec)
- Terminal states (completed/failed/cancelled): `start()` creates new conversation with suffix (`-r2`, `-r3`, etc.)
- Original conversation preserved as historical record -- clean separation between attempts
- Webhook retries are caught by existing `WebhookIdempotencyService` (delivery ID dedup) before reaching executor -- if start() reaches executor with terminal conversation ID, it's a genuine re-trigger
- Previous attempt context: inject one-line reference from session projection into new conversation's initial message (status, failure reason, known artifacts from previous attempt)
- Agent decides whether previous attempt context is relevant -- lightweight injection, not a full summary

### Claude's Discretion
- Exact SQL for the worker polling query and claim transaction
- Heartbeat implementation mechanism (callback wiring to `runAgentLoop`)
- Retry backoff jitter strategy
- Conversation suffix format for re-triggers (e.g., `-r2` vs `-attempt-2` vs timestamp-based)
- Autovacuum tuning parameters for conversations table
- Exact graceful shutdown drain sequence and force-persist fallback

</decisions>

<specifics>
## Specific Ideas

- Worker polling, heartbeat intervals, concurrency limits, and queue table choice are all behind the `ConversationExecutor` interface -- changing them for production requires zero changes to callers
- The scaling path is explicit: single process -> multi-process (same DB) -> proper queue infra (SQS). Each step is a configuration/implementation swap, not an architecture change
- Heartbeat and stale detection directly ports Temporal's existing `heartbeatTimeout: "5 minutes"` config -- proven thresholds for Aesir's agent loop durations
- Previous attempt context for re-triggers uses existing session projection data (no new infrastructure needed)

</specifics>

<deferred>
## Deferred Ideas

- Production-grade queue infrastructure (SQS, EventBridge) -- separate deployment phase
- Adaptive polling (poll frequently when active, back off when idle) -- optimization for production
- LISTEN/NOTIFY for instant signal delivery (replacing polling latency) -- post-v2.3 optimization
- Agent-visible retry context (injecting retry count/failure reason) -- future feature when error recovery strategies are formalized
- Worker thread isolation for memory safety -- future scaling concern
- Conversation retention/cleanup policy -- flagged in research, not Phase 40 scope

</deferred>

---

*Phase: 40-conversation-executor*
*Context gathered: 2026-02-02*
