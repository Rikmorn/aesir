# Domain Pitfalls: v2.3 Unified Agent Framework

**Domain:** Replacing Temporal orchestration with custom ConversationExecutor, Postgres-backed job queue, unified event log, single agent service
**Researched:** 2026-02-01
**Overall confidence:** HIGH (multiple sources, cross-verified with official docs and real-world post-mortems)

---

## Critical Pitfalls

Mistakes that cause production outages, data loss, or forced rewrites.

---

### CRITICAL-1: JSONB Conversation Messages Column Becomes a Write Amplification Bomb

**What goes wrong:**
The v2.3 spec stores `messages: jsonb` as a single column on the `conversations` table. Every time the agent calls a tool or receives an LLM response, the framework appends to this array and persists. With agent loops running 5-30 minutes and making 10-100+ tool calls, this JSONB column grows rapidly. PostgreSQL's MVCC architecture means every UPDATE to a JSONB column rewrites the entire value -- there is no partial update for JSONB. A 500KB conversation history means every tool call generates a 500KB row rewrite plus WAL entry, plus dead tuple, plus index updates.

**Why it happens:**
PostgreSQL treats JSONB as an opaque blob. Any modification triggers full value duplication. Once the JSONB exceeds ~2KB (the TOAST threshold of 2,032 bytes), PostgreSQL stores it out-of-line in TOAST tables. Measured performance: TOAST compressed JSONB is 10x slower than inline uncompressed for reads (746ms vs 7,624ms on 1M rows), and writes are proportionally worse because the entire TOAST value must be duplicated, re-compressed, and WAL-logged.

Additionally, HOT (Heap-Only Tuple) updates are not available for JSONB columns with indexes, meaning every update also rewrites all index entries -- even if the indexed values did not change. This creates a cascading write amplification: row rewrite + TOAST rewrite + WAL entries + index updates + dead tuple accumulation.

**Consequences:**
- WAL generation balloons proportionally to conversation size, impacting replication lag
- Dead tuple accumulation overwhelms autovacuum on the conversations table
- Table bloat degrades query performance for all conversation operations
- At 10MB+ JSONB (realistic for long agent sessions with tool results), each UPDATE could generate 10MB+ of WAL per tool call
- Transaction ID wraparound risk if vacuum cannot keep pace

**Specific numbers (from pganalyze benchmarks):**
- Inline uncompressed JSONB: 746ms per 1M row scan
- TOAST compressed JSONB: 7,624ms per 1M row scan (10.2x slower)
- TOAST uncompressed JSONB: 3,393ms per 1M row scan (4.5x slower)
- Every UPDATE duplicates the full TOAST value regardless of change size

**Prevention:**
1. **Do NOT persist the full messages array in JSONB on every tool call.** Instead, persist only at lifecycle boundaries: when the conversation pauses (wait_for), completes, or fails. During the active agent loop, messages live in memory only.
2. **Consider a separate `conversation_messages` table** with one row per message (conversation_id, sequence, role, content, timestamp). Appending becomes an O(1) INSERT instead of an O(n) UPDATE of the entire JSONB blob.
3. **If you keep JSONB, use LZ4 compression** (`ALTER TABLE conversations ALTER COLUMN messages SET COMPRESSION lz4`) -- it is consistently 2x faster than the default PGLZ for TOAST operations.
4. **Set TOAST storage to EXTERNAL** (uncompressed out-of-line) if read performance matters more than disk space: `ALTER TABLE conversations ALTER COLUMN messages SET STORAGE EXTERNAL`.
5. **Tune autovacuum aggressively** for the conversations table: `autovacuum_vacuum_scale_factor = 0.01`, `autovacuum_vacuum_threshold = 50`.

**Warning signs:**
- `pg_stat_user_tables.n_dead_tup` growing faster than `n_tup_upd` on conversations table
- WAL generation rate spikes during agent loops (monitor `pg_stat_wal`)
- Replication lag increases during active agent sessions
- `pg_total_relation_size('conversations')` grows much larger than live data size

**Severity:** CRITICAL -- will cause production degradation within weeks of deployment under real workload
**Phase:** Must be addressed in Phase A (framework implementation). Design the persistence strategy before writing ConversationExecutor.

**Sources:**
- [pganalyze: Postgres performance cliffs with JSONB and TOAST](https://pganalyze.com/blog/5mins-postgres-jsonb-toast)
- [Evan Jones: Postgres large JSON performance](https://www.evanjones.ca/postgres-large-json-performance.html)
- [Nick Drane: Hidden costs of PostgreSQL JSONB](https://nickdrane.com/hidden-costs-of-postgresql-jsonb/)
- [MongoDB Engineering: No HOT updates on JSONB (write amplification)](https://dev.to/mongodb/no-hot-updates-on-jsonb-13k7)

---

### CRITICAL-2: Stale Running Conversation Detection Is Harder Than It Looks

**What goes wrong:**
The v2.3 spec requires "at-least-once execution: stale running conversations detected and re-enqueued." This is the single hardest problem when replacing Temporal. Temporal's activity heartbeats and task queue mechanics handle this transparently. Building it from scratch requires solving: How do you know a conversation is stale vs. still running? How do you avoid two agent loops running for the same conversation simultaneously? How do you handle the case where the process dies between "claimed job" and "started agent loop"?

**Why it happens:**
Agent loops run 5-30 minutes. During that time, the process could crash, the container could be OOM-killed, or the database connection could drop. The conversation record shows `status: "running"` but nothing is actually running. Without heartbeats, there is no way to distinguish "running but slow" from "crashed and abandoned."

If you use a simple timeout ("anything running > 45 minutes is stale"), you will either:
- Set the timeout too low and kill legitimate long-running conversations
- Set the timeout too high and leave abandoned conversations stuck for hours

If you use a polling-based reaper ("check every 60s for conversations older than X"), you create a thundering herd when the reaper reclaims 50 conversations simultaneously.

**Consequences:**
- Stuck conversations that never complete (user waiting for approval that will never come)
- Duplicate execution (two agent loops running for the same conversation, making duplicate API calls, creating duplicate PRs)
- Race conditions between the reaper and the still-running loop (reaper marks it stale, loop tries to persist, both claim ownership)

**Prevention:**
1. **Implement heartbeats.** The agent loop's `onHeartbeat` callback (already used for Temporal in v2.2) should UPDATE a `last_heartbeat_at` timestamp on the conversation record. River Queue (Go + Postgres) and Solid Queue (Rails + Postgres) both use this pattern with configurable intervals (default 60s) and thresholds (default 5 minutes).
2. **Use a `claimed_by` column** with the process/worker ID. On startup, each worker generates a unique ID. When claiming a conversation, SET `claimed_by = worker_id, last_heartbeat_at = now()`. The reaper only reclaims conversations where `claimed_by` refers to a dead worker OR `last_heartbeat_at` is older than the threshold.
3. **Separate claiming from executing.** Use the pattern from Postgres job queue best practices: atomic claim (UPDATE with SKIP LOCKED + SET status = 'running', COMMIT immediately), then execute the agent loop, then UPDATE status = 'completed/paused/failed'. This means the "running" status is committed before the agent loop starts, so crash detection works.
4. **Concurrency lock per conversation.** Use `pg_advisory_xact_lock(hashtext(conversation_id))` or a row-level lock to ensure only one process executes a conversation at a time. Check the lock before starting the agent loop.

**Warning signs:**
- Conversations stuck in "running" status for > max expected duration
- Heartbeat timestamps not advancing for running conversations
- Multiple log entries for the same conversation_id from different workers

**Severity:** CRITICAL -- without this, the system has no crash recovery and conversations silently die
**Phase:** Must be addressed in Phase A (ConversationExecutor implementation). This is the core durability guarantee.

**Sources:**
- [Solid Queue: Heartbeat and process pruning](https://github.com/rails/solid_queue)
- [River Queue: Maintenance services and stuck job rescue](https://riverqueue.com/docs/maintenance-services)
- [Brandur: Postgres Job Queues & Failure By MVCC](https://brandur.org/postgres-queues)

---

### CRITICAL-3: Event Log Sequence Gaps Cause Missed Events in Projections

**What goes wrong:**
The v2.3 spec uses a `sequence` column on `agent_events` with a unique constraint per conversation. PostgreSQL sequences (`SERIAL`/`BIGSERIAL`) are not transactional -- they increment on `nextval()` and do not roll back if the transaction fails. This creates gaps. If the session projection uses "process events after sequence N" to catch up, it will skip events whose transactions committed out of order.

Concrete scenario: Transaction A gets sequence 5, Transaction B gets sequence 6. Transaction B commits first. The projection reads up to sequence 6 and records "last processed = 6." Transaction A then commits with sequence 5. The projection never sees event 5.

**Why it happens:**
PostgreSQL sequences prioritize performance over gap-free ordering. `nextval()` is not rolled back on transaction abort, and concurrent transactions get interleaved sequence numbers. This is by design -- gap-free sequences require table-level locks that serialize all writes.

**Consequences:**
- Session projection misses events, showing stale status (e.g., still "running" when actually "completed")
- Artifact extraction fails (PR number from `tool.succeeded` event is never projected)
- Real-time subscribers via `EventLog.subscribe()` miss events permanently
- Silent data loss that is extremely difficult to debug because the events DO exist in the table -- they were just skipped by the catchup query

**Prevention:**
1. **Use transaction ID-based catchup instead of sequence numbers.** Oskar Dudycz's research (Event-Driven.io) demonstrates using `pg_current_xact_id()` stored alongside each event and `pg_snapshot_xmin(pg_current_snapshot())` to determine the safe watermark. Events are only "safe to process" when their transaction ID is below the minimum active transaction.
2. **For the append-only event log, consider gapless sequences per conversation.** Since events within a single conversation are sequential (one agent loop at a time), you can safely use `MAX(sequence) + 1` within the conversation scope without global contention. The unique constraint `(conversation_id, sequence)` enforces this.
3. **LISTEN/NOTIFY as hint only, always back with polling.** The spec mentions LISTEN/NOTIFY for subscription. Notifications are ephemeral -- lost during disconnection, no replay, fire-and-forget. Always pair with polling-based catchup on reconnect.
4. **Projection should re-scan periodically.** Even with correct watermarking, run a periodic full reconciliation that replays recent events to catch any gaps. This is defense in depth.

**Warning signs:**
- Session projection shows "running" but events table has "agent.completed" event
- Artifact fields empty despite successful tool calls in event log
- Subscribers receive events out of order

**Severity:** CRITICAL -- causes silent data corruption in the session projection
**Phase:** Must be addressed in Phase A (EventLog implementation). The sequence strategy must be designed before writing event append/query logic.

**Sources:**
- [Event-Driven.io: How Postgres sequences issues impact messaging guarantees](https://event-driven.io/en/ordering_in_postgres_outbox/)
- [SoftwareMill: Implementing event sourcing using a relational database](https://softwaremill.com/implementing-event-sourcing-using-a-relational-database/)
- [Dev.to: Event Storage in Postgres](https://dev.to/kspeakman/event-storage-in-postgres-4dk2)

---

### CRITICAL-4: Buffered Event Writes Lose Data on Crash

**What goes wrong:**
The v2.3 spec explicitly states: "`append` is void, not async. The caller never waits for persistence. The implementation handles buffering, batching, and flushing internally." This means events are held in memory and batch-inserted periodically. If the process crashes between a tool call and the next flush, those events are permanently lost.

For agent loops running 5-30 minutes making many tool calls, a crash could lose dozens of events. The event log -- which is supposed to be "unified ground truth" -- would have gaps. The session projection would show stale data. And the conversation history (which is the agent's memory) would be missing tool results.

**Why it happens:**
Buffering is a legitimate optimization for high-throughput event logging. The spec is correct that the agent loop should not block on event I/O. But "fire-and-forget" and "ground truth" are fundamentally contradictory. You cannot be both.

**Consequences:**
- Lost events mean incomplete execution history (debugging becomes impossible)
- Session projection artifacts are missing (PR number not recorded even though PR was created)
- If conversation resumes after crash, agent sees incomplete history and may repeat actions
- Violates the v2.3 promise that events are "written when things happen, not reconstructed afterward"

**Prevention:**
1. **Flush events synchronously at lifecycle boundaries.** At minimum, flush before: persisting conversation state (pause/complete), writing to the session projection, and returning from the agent loop. The `flush()` method exists in the spec -- use it at these critical points.
2. **Use WAL-backed buffering.** Instead of in-memory buffer only, write events to a local WAL file (append-only, fast) and batch-insert to Postgres asynchronously. On crash recovery, replay the local WAL. This is the pattern used by most serious event log implementations.
3. **Accept the tradeoff explicitly.** If some events (tool.called, llm.response) can be lost without consequence, document which event types are "best effort" vs "guaranteed." Reserve synchronous writes for lifecycle events (agent.started, agent.paused, agent.completed, signal.received) that affect correctness.
4. **Flush on every tool result that produces artifacts.** If a tool has artifact config, its `tool.succeeded` event MUST be flushed synchronously because the session projection depends on it.

**Warning signs:**
- Events table has fewer entries than expected for completed conversations
- Session projection artifacts are intermittently missing
- Gap between `agent.started` and first `tool.called` event is suspiciously large (indicates lost events in between)

**Severity:** CRITICAL -- undermines the core value proposition of the unified event log
**Phase:** Must be addressed in Phase A (EventLog implementation). Define flush policy before implementing the buffer.

---

## Major Pitfalls

Mistakes that cause degraded reliability, difficult debugging, or significant rework.

---

### MAJOR-1: Signal Arrives Between Agent Loop Exit and Conversation Persist

**What goes wrong:**
The pause/resume sequence has a critical window. When the agent calls `wait_for`, the framework must: (1) return tool result to agent, (2) let the agent loop exit, (3) write agent.paused event, (4) set conversation status to "paused", (5) persist conversation to storage, (6) register timeout. Between steps 2 and 5, the conversation is logically paused but the status has not been committed to the database.

If a signal arrives during this window (e.g., the human clicks "approve" in Slack within milliseconds of the agent posting the approval request), the signal handler queries the database, finds the conversation still in "running" status, and queues the signal. But the signal queueing also depends on the conversation record being up-to-date. If the persist in step 5 overwrites the queued signal, the signal is lost.

**Why it happens:**
The spec's signal queueing design stores signals on the conversation record (`queuedSignals: jsonb`). If the persist operation in step 5 does a full row UPDATE (which is the natural pattern), it will overwrite any signals that were queued between steps 2 and 5.

This is the exact same race condition that exists in v2.2 (the "retry-with-backoff hack for the race condition where a thread reply arrives before the workflow starts"), but the v2.3 spec claims to have eliminated it via signal queueing. The race condition has merely moved to a different window.

**Consequences:**
- Lost signals (approval clicks that never wake the conversation)
- User confusion (they clicked approve but nothing happened)
- Silent failure (no error, no log, the signal just disappeared)

**Prevention:**
1. **Use Postgres row-level locking for conversation updates.** All operations that modify the conversation record (persist, signal delivery, signal queueing) should acquire a `FOR UPDATE` lock on the conversation row first. This serializes concurrent modifications.
2. **Write signal queue separately from conversation state.** Use a separate `signal_inbox` table: INSERT the signal there, then the executor checks this table when resuming. This decouples signal delivery from conversation persistence.
3. **Atomic transition to paused.** The persist operation should be a single UPDATE that atomically sets `status = 'paused'` AND appends any pending signals from the signal inbox. Use a CTE:
   ```sql
   WITH pending AS (
     DELETE FROM signal_inbox WHERE conversation_id = $1 RETURNING *
   )
   UPDATE conversations SET
     status = 'paused',
     messages = $2,
     pending_wait = $3,
     queued_signals = queued_signals || (SELECT jsonb_agg(signal) FROM pending)
   WHERE id = $1
   ```
4. **Test this explicitly.** Write an integration test that sends a signal 0ms after the agent calls wait_for. This is the exact scenario that broke v2.2.

**Warning signs:**
- Conversations stuck in "paused" with no pending signals despite user having clicked approve
- Slack approval button clicks that produce no visible effect
- Signal.received events in the event log that correspond to no agent.resumed event

**Severity:** MAJOR -- intermittent signal loss under real-world timing conditions
**Phase:** Must be addressed in Phase A/B (ConversationExecutor + signal handling). Requires careful transaction design.

---

### MAJOR-2: LISTEN/NOTIFY Is Not a Reliable Subscription Mechanism

**What goes wrong:**
The v2.3 spec mentions "LISTEN/NOTIFY or polling for subscriptions" for the event log. Teams often start with LISTEN/NOTIFY because it feels elegant and real-time. But PostgreSQL notifications are ephemeral and have several dangerous failure modes:

1. **Lost during disconnection:** If the listener process restarts, disconnects, or the connection drops, all notifications sent during the disconnection period are permanently lost. There is no replay or catch-up mechanism.
2. **Not delivered during transactions:** If a NOTIFY is executed inside a transaction, it is not delivered until the transaction commits. If the listener is also in a transaction, the notification is buffered until that transaction completes.
3. **Race condition on first listen:** There is a documented race condition when setting up a listener -- notifications committed concurrently with the LISTEN command may or may not be received.
4. **Queue can fill up:** The notification queue (8GB by default) can fill if a listener enters a long transaction, causing all NOTIFYing transactions to fail at commit.
5. **Unreliable over network:** LISTEN/NOTIFY behaves differently over remote connections vs local connections. Over remote/proxied connections, notifications may only arrive after actively executing a query on the connection.

**Consequences:**
- Session projection falls behind (events written but projection never updated)
- Real-time subscribers miss events
- Entire system appears to "freeze" because projections stop updating

**Prevention:**
1. **Use LISTEN/NOTIFY only as an optimization hint.** It tells the subscriber "something happened, go poll now." The subscriber must always have a polling fallback that catches up from the last processed event.
2. **Implement the three-step reconnection pattern:** (a) subscribe with LISTEN, (b) query current state to establish baseline, (c) handle incoming notifications knowing they may duplicate what was just queried.
3. **Poll on a timer regardless.** Every 1-5 seconds, query for new events since last processed. LISTEN/NOTIFY just makes this more responsive by triggering an immediate poll.
4. **Consider skipping LISTEN/NOTIFY entirely for v2.3.** Simple polling with a 1-second interval is sufficient for local dev (the stated target). The EventLog interface supports swapping implementations later.

**Warning signs:**
- Session projection status differs from event log ground truth
- Subscribers work in development but fail intermittently in Docker (network layer difference)
- Events accumulate in the table but projections stop updating

**Severity:** MAJOR -- causes intermittent projection staleness that is hard to reproduce and debug
**Phase:** Should be addressed in Phase A (EventLog subscription implementation). Design for polling-first, LISTEN/NOTIFY as optional enhancement.

**Sources:**
- [PostgreSQL Documentation: NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- [Recall.ai: Postgres LISTEN/NOTIFY does not scale](https://www.recall.ai/blog/postgres-listen-notify-does-not-scale)
- [EDB: How LISTEN and NOTIFY syntax promote high availability](https://www.enterprisedb.com/blog/listening-postgres-how-listen-and-notify-syntax-promote-high-availability-application-layer)

---

### MAJOR-3: History Compaction Loses Critical Information (Summarization Drift)

**What goes wrong:**
The v2.3 spec proposes a three-phase history compaction strategy. Phase 1 (tool output pruning) is well-researched and safe. Phase 2 (structured anchored summarization) is where things go wrong. Claude Code's production experience (2025-2026) has documented extensive failure modes with conversation compaction:

1. **Specification drift:** The summarization model paraphrases exact requirements into "goals" and "intents." After compaction, the agent treats precise specifications as approximate guidelines.
2. **Framework rule paraphrasing:** When compaction occurs, behavioral instructions from the system prompt get paraphrased in the summary. Post-compaction, the agent sees "framework already discussed" in the summary and does not re-read source rules. Paraphrased rules lose precision, causing behavioral drift.
3. **Summaries of summaries degrade exponentially.** The spec tries to address this with "anchored, not regenerated" summaries. But even anchored summaries drift over multiple compaction cycles because each merge operation introduces small inaccuracies that compound.
4. **Dead-end sessions.** If compaction itself fails (the summary exceeds the context window, or the summarization model produces garbage), the conversation may become unrecoverable.

**Consequences:**
- Agent behavior changes after compaction (makes different decisions than it would have with full context)
- File paths and exact error messages lost despite "artifact section populated from event log projection"
- Long-running conversations (spanning multiple compaction cycles) gradually lose coherence
- Impossible to debug because the agent is acting on information you cannot see (the summary replaced the original context)

**Prevention:**
1. **Phase 1 (tool output pruning) should be the primary and sufficient strategy.** The JetBrains NeurIPS 2025 research found observation masking matched LLM summarization quality, was 7% cheaper, and was faster. Summarization actually caused agents to run 13-15% longer. Invest heavily in making Phase 1 work well.
2. **Inject artifact data from event log projection into the summary as structured data, not prose.** The summary should include a machine-readable section:
   ```
   ## Artifacts (from event log -- do not modify)
   - Branch: feature/aes-42
   - PR: #47 (https://github.com/...)
   - Files modified: [api/health.ts, main.ts, api/health.test.ts]
   ```
3. **Test compaction with real conversations.** Save actual conversation histories from v2.2 (with full tool results), apply compaction, then resume the conversation. Does the agent still make correct decisions?
4. **Set compaction trigger at 65-75% context capacity,** not 90%+. Community consensus across Claude Code, Cline, and OpenCode: compacting too late leaves insufficient reasoning room.
5. **Log a diff between pre-compaction and post-compaction context.** Store both versions so you can debug behavioral drift.

**Warning signs:**
- Agent behavior changes noticeably after compaction (e.g., re-does work it already completed)
- Agent asks questions it already answered before compaction
- Token count after compaction is still very high (compaction did not remove enough)
- Agent ignores file paths or error messages that are in the summary

**Severity:** MAJOR -- causes subtle behavioral degradation that is very difficult to diagnose
**Phase:** Should be addressed in Phase A (HistoryManager implementation). Test with real conversation data before declaring it complete.

**Sources:**
- [Claude Code issue #18211: Compaction broken](https://github.com/anthropics/claude-code/issues/18211)
- [Claude Code issue #19739: Systematic failure patterns](https://github.com/anthropics/claude-code/issues/19739)
- [Claude Code issue #5677: Compaction failure unable to reduce context](https://github.com/anthropics/claude-code/issues/5677)
- [Hyperdev: How Claude Code got better by protecting more context](https://hyperdev.matsuoka.com/p/how-claude-code-got-better-by-protecting)

---

### MAJOR-4: Single Service Memory Pressure from Concurrent Agent Loops

**What goes wrong:**
v2.3 consolidates from 3 services to 1 process. Each active agent loop holds: the full conversation message history in memory (~500KB-5MB for long conversations), resolved tool definitions, Anthropic SDK connection state, and any buffered events. With multiple concurrent conversations (dev-agent running a 30-minute implementation while product-agent handles 3 Slack threads), a single Node.js process could easily consume 500MB-2GB of heap.

Node.js has a default V8 heap limit of ~1.7GB (depending on version). Sub-agents compound this -- a dev-agent spawning a researcher and coder means 3 concurrent conversation histories in memory for a single logical workflow.

**Why it happens:**
v2.2 naturally isolated agent memory across separate processes (dev-agent:3004, product-agent:3005). v2.3's single process combines all memory into one heap. The Anthropic SDK's streaming responses also hold buffers in memory during active API calls.

**Consequences:**
- V8 heap exhaustion causes the process to crash (or be OOM-killed by the container runtime)
- All running conversations are aborted simultaneously (blast radius goes from "one agent" to "all agents")
- GC pressure causes increased latency and reduced throughput during multi-conversation periods
- No error isolation -- a memory leak in one agent definition's tool affects all agents

**Prevention:**
1. **Set `--max-old-space-size` explicitly** in the service startup command. Calculate based on expected concurrent conversations * estimated per-conversation memory. Start with 2GB and monitor.
2. **Implement a conversation concurrency limit.** The ConversationExecutor should refuse to start new conversations if `active_count >= max_concurrent`. Return a "busy" response and let the event router retry. This is the equivalent of Temporal's worker task queue capacity.
3. **Track per-conversation memory usage.** Before each agent loop iteration, check `process.memoryUsage().heapUsed`. If approaching the limit, pause the conversation with a "memory pressure" event and resume after other conversations complete.
4. **Implement graceful shutdown with conversation draining.** On SIGTERM: stop accepting new conversations, wait for running conversations to reach a natural pause point (next wait_for or completion), persist state, then exit. Set a hard timeout (e.g., 30 seconds) after which force-persist and exit.
5. **Consider Node.js Worker Threads for isolation** (future). Each agent loop could run in a separate Worker Thread with its own V8 isolate, providing memory isolation without the overhead of separate processes.

**Warning signs:**
- `process.memoryUsage().heapUsed` exceeding 80% of `--max-old-space-size`
- Increasing GC pause times visible in event loop lag monitoring
- OOM kills in container logs
- All conversations failing simultaneously (indicates shared-fate failure)

**Severity:** MAJOR -- causes complete system outages when memory limit is exceeded
**Phase:** Should be addressed in Phase B (single service implementation). Concurrency limits are essential for stability.

---

### MAJOR-5: Temporal Workflow Drain During Migration Has a Long Tail

**What goes wrong:**
The v2.3 spec says "Drain existing Temporal workflows (short-lived, complete naturally)" in Phase C. But v2.2 workflows are NOT always short-lived. The dev-agent workflow includes:
- Approval wait: up to 72 hours
- PR feedback wait: up to 7 days
- Rejection/re-planning loop: unbounded

A workflow that is in `awaiting_approval` status when migration begins could be waiting for up to 72 hours before timing out. A workflow in `awaiting_pr` could wait up to 7 days. You cannot simply "drain" these -- they are actively paused waiting for external signals.

**Why it happens:**
The assumption that "v2.2 workflows are short enough to drain" is incorrect. The workflows themselves contain long pause points. The agent loop portions are 5-30 minutes, but the inter-phase waits are hours to days.

**Consequences:**
- Migration is blocked for up to 7 days waiting for all workflows to drain
- During this window, you must maintain both systems (Temporal + new executor)
- New events (approvals, PR reviews) must be routed to the correct system
- If you force-terminate waiting workflows, users lose work (plans that were approved but not yet executed)

**Prevention:**
1. **Implement a "migration signal" for running workflows.** Add a new signal type to the Temporal workflows that causes them to gracefully terminate and output their current state (conversation history, pending approvals, task context). The v2.3 executor can then reconstruct the conversation from this state dump.
2. **Set a hard migration cutoff date.** Two weeks before migration: stop starting NEW Temporal workflows, route all new events to v2.3. Existing workflows have their full timeout window to complete. After the cutoff, any remaining workflows are terminated with notification to the user.
3. **Dual-mode signal routing during transition.** For the transition period, the event router must check both: (a) is there a Temporal workflow for this conversation ID? Route signal to Temporal. (b) Is there a v2.3 conversation? Route to executor. This requires maintaining the Temporal client alongside the executor.
4. **Test the drain with real timing.** Create a test workflow, put it in `awaiting_approval`, then run the migration procedure. Verify the workflow completes or is gracefully migrated.

**Warning signs:**
- Temporal workflows still running days after "migration complete" declaration
- Users reporting that their approved plans were never executed
- Duplicate PRs from workflows that were migrated but also continued running in Temporal

**Severity:** MAJOR -- blocks the migration or causes data loss during transition
**Phase:** Must be planned for in Phase C (cutover). Requires code changes to v2.2 workflows before v2.3 cutover.

---

### MAJOR-6: Postgres as Job Queue -- MVCC Dead Tuple Accumulation

**What goes wrong:**
Using Postgres as a job queue (via SKIP LOCKED or similar) is a well-documented pattern, but it has a specific failure mode related to MVCC: dead tuples accumulate in the job table's indexes. When workers claim jobs, the UPDATE creates dead tuples. As dead tuples build up in the B-tree index, each subsequent job claim must scan through an increasingly large number of invisible tuples before finding a workable one.

Brandur Leach documented this failure mode at a real company: "every worker trying to lock a job would cycle through this loop 100,000 times" as dead tuple counts grew, with lock acquisition times going from under 0.01 seconds to 0.1+ seconds.

**Why it happens:**
Job queues have a pathological access pattern for MVCC: constant INSERTs (new jobs) and UPDATEs (claiming, completing) on the same small set of rows. Unlike normal OLTP workloads where updates are spread across the table, job queue operations concentrate on the "pending" rows, creating hot spots of dead tuples.

**Consequences:**
- Job claim latency increases over time (from milliseconds to seconds)
- Workers appear to "hang" waiting to acquire a job
- Eventually the system reaches a tipping point where workers cannot claim jobs faster than they are produced
- Cascading failure: queue depth grows, latency increases, more dead tuples accumulate

**Prevention:**
1. **Tune autovacuum specifically for the job/conversation table:** `autovacuum_vacuum_scale_factor = 0.01` (vacuum when 1% of rows are dead, not the default 20%), `autovacuum_vacuum_cost_delay = 0` (no throttling).
2. **Use a separate table for job queueing** (not the conversations table itself). A `conversation_queue` table with minimal columns (id, conversation_id, status, claimed_at) keeps the hot queue small and easy to vacuum.
3. **Periodically DELETE completed queue entries** instead of relying on autovacuum alone. Run `DELETE FROM conversation_queue WHERE status = 'completed' AND completed_at < now() - interval '1 hour'` on a schedule.
4. **Monitor `pg_stat_user_tables` for the queue table:** watch `n_dead_tup`, `last_autovacuum`, and the ratio of dead to live tuples.

**Warning signs:**
- `n_dead_tup / n_live_tup` ratio exceeding 0.5 on queue-related tables
- Job claim query execution time increasing over days/weeks
- Autovacuum not running frequently enough on queue tables

**Severity:** MAJOR -- causes slow degradation that is hard to diagnose until it becomes critical
**Phase:** Should be addressed in Phase A (ConversationExecutor Postgres implementation). Design the queue table with autovacuum tuning from day one.

**Sources:**
- [Brandur: Postgres Job Queues & Failure By MVCC](https://brandur.org/postgres-queues)
- [Inferable: The Unreasonable Effectiveness of SKIP LOCKED](https://www.inferable.ai/blog/posts/postgres-skip-locked)

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or degraded developer experience.

---

### MODERATE-1: Losing Temporal's Retry Configuration Granularity

**What goes wrong:**
The current v2.2 Temporal workflows have carefully tuned retry configurations per activity type:
- Orchestrator activities: 45-minute timeout, 2 retries, 30s initial interval, 2x backoff, non-retryable error types (TokenBudgetExhaustedError, AgentAbortedError)
- Infrastructure activities: 5-minute timeout, 3 retries, 5s initial interval

The v2.3 ConversationExecutor must replicate this granularity. A naive implementation will either retry everything (wasting API tokens on re-running 30-minute agent loops that failed due to budget exhaustion) or retry nothing (failing on transient errors that would have recovered).

**Prevention:**
1. **Implement per-operation retry configuration.** The ConversationExecutor needs retry policies that distinguish between: agent loop failures (expensive, limited retries), infrastructure operations (cheap, more retries), and transient vs. permanent errors.
2. **Port the non-retryable error type list** from the Temporal configuration. `TokenBudgetExhaustedError` and `AgentAbortedError` should immediately fail without retry.
3. **Use exponential backoff with jitter** for retries, not fixed intervals. This prevents thundering herds when multiple conversations fail simultaneously.

**Severity:** MODERATE -- causes either wasted API spend (unnecessary retries) or reduced reliability (missing retries)
**Phase:** Phase A (ConversationExecutor implementation)

---

### MODERATE-2: Agent Definition Version Pinning Creates Orphaned Definitions

**What goes wrong:**
The spec says "Running agents stay pinned to the version they started with." For conversations that pause for days (waiting for approval), the agent definition version at start could be stale by the time it resumes. If the definition has been updated (e.g., prompt fix, new tool), the resumed conversation uses the old version.

This is correct behavior for stability, but it creates operational complexity: you need to maintain all versions of definitions that any running conversation might reference. If you delete or rename an old definition version, all conversations pinned to it will fail on resume.

**Prevention:**
1. **Never delete definition versions in-place.** Mark old versions as deprecated but keep them loadable.
2. **Set maximum conversation lifetime.** After a configurable period (e.g., 14 days), forcefully expire conversations. This bounds the number of definition versions you need to maintain.
3. **Log the definition version on resume.** Make it visible when a conversation is running on a stale definition so operators can decide whether to cancel and restart it.

**Severity:** MODERATE -- causes confusion when resumed conversations behave differently than expected
**Phase:** Phase A (AgentRegistry implementation)

---

### MODERATE-3: Graceful Shutdown Complexity in Single Service

**What goes wrong:**
The single service must handle shutdown gracefully while potentially running multiple agent loops, each in the middle of multi-minute operations. The Node.js process receives SIGTERM, but the agent loops are making Anthropic API calls, executing tools in Docker containers, and writing to the database. Simply killing the process loses all in-flight work.

Docker (and Kubernetes) give a limited grace period (default 10-30 seconds) before sending SIGKILL. Agent loops can run for minutes. The grace period is almost certainly insufficient to wait for all loops to complete.

**Prevention:**
1. **On SIGTERM: immediately stop accepting new conversations** (`server.close()`).
2. **For running conversations: set a "shutting down" flag** that the agent loop checks between tool calls. When set, the agent loop persists current state and exits at the next natural boundary.
3. **For paused conversations: no action needed** (already persisted).
4. **Set Docker's `stop_grace_period` to match expected drain time** (e.g., 60-120 seconds).
5. **Implement a force-persist fallback.** If the grace period is about to expire, persist whatever state is available (even if mid-tool-call) so the conversation can be recovered by the reaper on restart.

**Severity:** MODERATE -- causes work loss during deployments and restarts
**Phase:** Phase B (single service implementation)

---

### MODERATE-4: Event Log Table Growth Is Unbounded

**What goes wrong:**
The `agent_events` table is append-only. Each tool call generates at least 2 events (tool.called + tool.succeeded/tool.failed). Each LLM response generates 1 event. A typical dev-agent conversation produces 50-200 events. With 10 conversations/day, that is 500-2000 events/day. After a year: 180K-730K events.

The events include `payload: jsonb` which contains tool results (potentially large). Without a retention policy, the table grows without bound, degrading query performance and consuming disk.

**Prevention:**
1. **Implement a retention policy from day one.** Archive events older than 30 days to a separate `agent_events_archive` table or delete them.
2. **Partition the events table by month** using Postgres native partitioning. This makes retention trivial (DROP old partitions) and keeps queries on recent data fast.
3. **Consider partitioning by conversation_id** if queries are always scoped to a conversation. Range partitioning by timestamp is simpler to manage.
4. **Index only what you query.** The spec's index on `(conversation_id, sequence)` is correct. Avoid adding indexes on payload fields.

**Severity:** MODERATE -- causes slow degradation over months, but is easy to fix retroactively
**Phase:** Phase A (EventLog schema design). Partitioning is much easier to set up before data exists.

---

### MODERATE-5: Tool Output Pruning May Remove Information Needed for Resume

**What goes wrong:**
Phase 1 history compaction replaces old tool results with "short descriptors." But when a conversation resumes after a pause, the agent may need information from those tool results. For example: the agent read a file, analyzed it, called wait_for to get approval, and now resumes. The file contents have been pruned. The agent knows it "read api/health.ts" but not what was in it.

This is different from the Claude Code failure mode (MAJOR-3) -- here the information was correctly pruned per the rules, but the agent needs it post-resume.

**Prevention:**
1. **Protect messages from the last agent loop run, not just the last N messages.** If the agent ran for 50 tool calls, paused, and has been paused for 3 days, protect all 50 tool calls from that run -- they represent the context the agent was working with.
2. **The `protectedMessages` count should be generous.** 20 messages may not be enough for a dev-agent that reads 10 files and runs 5 commands before pausing. Consider 40-60.
3. **Inject key file contents from the dev container** into the resume context if they were pruned. The agent can re-read files, but this wastes time and tokens.

**Severity:** MODERATE -- causes agents to re-do work or make decisions without full context
**Phase:** Phase A (HistoryManager implementation)

---

### MODERATE-6: Deterministic Conversation IDs Collide Across Agent Types

**What goes wrong:**
The spec uses `{agentDefinitionId}-{correlationKey}` as the conversation ID formula. This is correct for preventing duplicate conversations, but creates a coupling: if two different agent types need to process the same correlation key (e.g., both dev-agent and product-agent reacting to the same Linear issue), they will have different conversation IDs. This is fine.

However, if a conversation is cancelled and the same trigger fires again (e.g., user reassigns the Linear issue to the agent), the `start()` call will find the existing cancelled conversation and return it instead of creating a new one. The spec says "If a conversation with that ID already exists and is running/paused, return the existing ID." It does not say what happens if the conversation is completed or failed.

**Prevention:**
1. **Idempotent start should only apply to running/paused conversations.** For completed/failed/cancelled conversations, either create a new conversation with a version suffix (`dev-agent-ABC-123-v2`) or allow re-starting the same ID (reset status to running, clear messages, start fresh).
2. **Define the behavior explicitly.** The spec has a gap here. Document what happens for each status: running (return existing), paused (return existing), completed (???), failed (???), cancelled (???).

**Severity:** MODERATE -- causes confusion when re-triggering agents for the same issue
**Phase:** Phase A (ConversationExecutor start logic)

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable without major rework.

---

### MINOR-1: Definition File Hot Reload Creates Inconsistent State

**What goes wrong:**
The AgentRegistry uses lazy loading with mtime-based cache invalidation. If a definition file is modified while a conversation is being started, the registry might return the old cached version for the definition lookup but the new version for the tool resolution, creating an inconsistent agent configuration.

**Prevention:** Use a read-through cache that loads definition + tools atomically. Or simply version definitions explicitly and always resolve from the version, not "latest."

**Severity:** MINOR
**Phase:** Phase A (AgentRegistry)

---

### MINOR-2: Signal Dedup ID Not Specified for All Sources

**What goes wrong:**
The spec says signals carry "source + delivery ID" for deduplication. GitHub webhooks provide `X-GitHub-Delivery`, Slack provides `X-Slack-Request-Timestamp`, but timeout signals from internal schedulers and agent-to-agent signals do not have natural delivery IDs. Without a dedup ID, these signals cannot be deduplicated.

**Prevention:** Generate deterministic dedup IDs for internal signals: `timeout-{conversationId}-{waitType}-{timestamp}` and `agent-{parentInstanceId}-{childInstanceId}`.

**Severity:** MINOR
**Phase:** Phase B (adapter implementation)

---

### MINOR-3: YAML Definition Parsing Errors Are Confusing

**What goes wrong:**
Agent definitions use YAML files that reference system prompts in separate .md files. A typo in the YAML (wrong indentation, missing field) or a missing prompt file will cause a runtime error that may not clearly indicate which definition is broken.

**Prevention:** Validate ALL definitions at startup (not lazy load). Fail fast with a clear error message listing the file path and the Zod validation error.

**Severity:** MINOR
**Phase:** Phase A (AgentRegistry)

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|------------|
| Phase A: Framework Core | CRITICAL-1 (JSONB write amplification) | Design persistence strategy before writing code. Consider separate messages table. |
| Phase A: Framework Core | CRITICAL-2 (Stale running detection) | Implement heartbeats from day one. Do not defer to "later." |
| Phase A: Framework Core | CRITICAL-3 (Sequence gaps in events) | Use per-conversation gapless sequences or transaction ID watermarking. |
| Phase A: Framework Core | CRITICAL-4 (Buffered event data loss) | Define flush policy explicitly. Synchronous flush at lifecycle boundaries. |
| Phase A: Framework Core | MAJOR-3 (Compaction drift) | Invest in Phase 1 pruning. Defer Phase 2 summarization until proven necessary. |
| Phase A: Framework Core | MAJOR-6 (MVCC dead tuples on queue) | Tune autovacuum from day one. Use separate queue table. |
| Phase B: Wire & Validate | MAJOR-1 (Signal race between pause and persist) | Row-level locking + atomic status transitions. |
| Phase B: Wire & Validate | MAJOR-4 (Memory pressure) | Implement concurrency limits. Set explicit heap size. |
| Phase B: Wire & Validate | MODERATE-3 (Graceful shutdown) | Implement drain logic before deploying to Docker. |
| Phase C: Cutover | MAJOR-5 (Temporal drain long tail) | Plan migration signals. Set hard cutoff date. |
| Phase D: Cleanup | MODERATE-4 (Event table growth) | Set up partitioning before production data accumulates. |

---

## Aesir-Specific Warnings

These pitfalls are specific to Aesir's existing codebase and architecture.

### The Heartbeat Callback Must Be Preserved

v2.2's `runAgentLoop` already accepts an `onHeartbeat` callback (currently wired to Temporal's `Context.current().heartbeat()`). The v2.3 ConversationExecutor must provide its own heartbeat function that updates `last_heartbeat_at` on the conversation record. This is not a new feature -- it is a critical migration of an existing capability.

### The Dev Container Lifecycle Must Be Managed Per-Conversation

v2.2 manages dev containers via Temporal activities (`setupContainerActivity`, `stopContainerActivity`). In v2.3, the ConversationExecutor must handle container lifecycle. Key edge cases:
- Container must survive across pause/resume (don't stop it on pause if resume is expected within minutes)
- Container must be stopped on conversation timeout or cancellation
- Multiple conversations for the same repo should share a container (not create duplicates)

### The Task Store Data Must Be Migrated

v2.2's `tasks` table contains PR numbers, branch names, approval statuses. The v2.3 session projection replaces this. But during Phase C (cutover), any external systems querying the tasks table (webhooks, signal handlers) must be updated to query `agent_sessions` instead. This is a broader change than just database schema -- it affects the signal routing code that maps GitHub PR events to conversations.

---

## Open Questions Requiring Phase-Specific Research

1. **What is the actual memory footprint of a conversation in Node.js?** The MAJOR-4 pitfall estimates 500KB-5MB, but this needs measurement with real Anthropic SDK payloads. Profile memory during a real dev-agent conversation before setting concurrency limits.

2. **What is the optimal flush interval for the event buffer?** Too frequent = performance overhead. Too infrequent = data loss risk. This needs benchmarking against real event volumes.

3. **Can the conversations table use UNLOGGED for the messages column?** UNLOGGED tables skip WAL, dramatically reducing write amplification. The tradeoff: data is lost on crash (but the conversation can be reconstructed from the event log). This is potentially a significant optimization but needs careful analysis.

4. **Should sub-agent conversations be stored in the same table?** The spec says sub-agents "don't go through the executor" and run inline. But if a sub-agent runs for 10+ minutes, its state is also at risk of process crash. Consider whether sub-agents above a certain duration threshold should be persisted.

---

## Sources Summary

| Topic | Key Source | Confidence |
|-------|-----------|------------|
| JSONB TOAST performance | [pganalyze benchmarks](https://pganalyze.com/blog/5mins-postgres-jsonb-toast), [Evan Jones measurements](https://www.evanjones.ca/postgres-large-json-performance.html) | HIGH |
| JSONB write amplification | [MongoDB engineering analysis](https://dev.to/mongodb/no-hot-updates-on-jsonb-13k7) | HIGH |
| Postgres job queue MVCC failure | [Brandur Leach post-mortem](https://brandur.org/postgres-queues) | HIGH |
| Sequence gap problem | [Event-Driven.io analysis](https://event-driven.io/en/ordering_in_postgres_outbox/) | HIGH |
| LISTEN/NOTIFY limitations | [PostgreSQL official docs](https://www.postgresql.org/docs/current/sql-notify.html), [Recall.ai production issues](https://www.recall.ai/blog/postgres-listen-notify-does-not-scale) | HIGH |
| Heartbeat-based stale detection | [Solid Queue](https://github.com/rails/solid_queue), [River Queue](https://riverqueue.com/docs/maintenance-services) | HIGH |
| Compaction failure modes | [Claude Code issues #18211, #19739, #5677](https://github.com/anthropics/claude-code/issues/18211) | HIGH |
| Idle transaction / vacuum blocking | [PostgreSQL docs](https://postgresqlco.nf/doc/en/param/idle_in_transaction_session_timeout/), [CYBERTEC analysis](https://www.cybertec-postgresql.com/en/idle_in_transaction_session_timeout-terminating-idle-transactions-in-postgresql/) | HIGH |
| Temporal migration strategy | [Temporal Worker Versioning docs](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning) | HIGH |
| Node.js graceful shutdown | [Node.js cluster docs](https://nodejs.org/api/cluster.html) | HIGH |
| Exactly-once vs at-least-once | [Multiple distributed systems sources](https://bravenewgeek.com/you-cannot-have-exactly-once-delivery/) | HIGH |
| Custom workflow engine pitfalls | [Indeed/iWF experience via Long Quanzheng](https://medium.com/@qlong/workflow-should-be-code-but-durable-execution-is-not-the-only-way-519f7682360c) | MEDIUM |
