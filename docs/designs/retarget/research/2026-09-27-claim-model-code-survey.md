# Claim model: code survey

Date: 2026-09-27. Tree: `master` at e5b69e1f, `packages/agents/src` unmodified. Read-only. Feeds `02-harness.md` (G13, G17, G19) and `05-proposal.md` ("keep the mechanism").

Paths are relative to `packages/agents/src/`. Every statement is **verified** (I read the cited lines) unless marked **inferred** (reasoned from adjacent code) or **believed** (general knowledge, not checked here). No live database queries were run.

## Summary

The claim and lease exist as described: a single `FOR UPDATE SKIP LOCKED` statement, a 30 s heartbeat, a 5 min stale threshold, and a stale sweep on every poll. All five "keep the mechanism" pieces exist in code.

**G19 holds.** There is no wake message to drop. The signal write itself sets `status = 'queued'`, and the 5 s poll is the reconciliation.

**G13 partly holds.** A signal to a running conversation is durably queued on the row. Delivery is conditional on the turn ending in a matching `wait_for`. A turn that completes strands its queued signals. One narrow lost-update window exists at the pause-point consume.

**G17 does not hold for interrupts and partly holds for ordering.** Nothing pre-empts a running turn; cancel and `task_cancelled` both wait for the turn to end. Queued signals keep arrival order but are consumed first-match-by-type, one per wake, with no depth limit.

Three findings the redesign should not inherit unexamined: the group "lock" is a `FOR UPDATE` outside any transaction; the session projection's tool-artifact extraction never fires (payload key mismatch); Phase 2 summarisation is unreachable from the worker loop. The unit tests for pause, completion and timeout scheduling in the worker loop are all `it.skip`.

## 1. The claim path

**Claim SQL** (verified, `framework/worker-loop.ts:981-998`). One statement, run via `db.execute` outside any explicit transaction (autocommit):

```sql
WITH claimable AS (
  SELECT id FROM agents.conversations WHERE status = 'queued'
  ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT n)
UPDATE agents.conversations
SET status = 'running', claimed_by = $worker, claimed_at = NOW(),
    last_heartbeat_at = NOW(), updated_at = NOW()
FROM claimable WHERE agents.conversations.id = claimable.id
RETURNING agents.conversations.*
```

- `n` is `concurrencyLimit - running.size` (`:2688`).
- `RETURNING *` returns the whole row, including the `messages` JSONB. The full transcript loads on every claim.
- The locking clause precedes `LIMIT`. Postgres accepts either order (believed).
- Indexes on `conversations`: `status`, `agent_definition_id`, `parent_conversation_id` (partial), `task_id` (partial), one tree-budget index. None on `created_at` (verified, `shared/db/schema.ts:140-145`; migrations 0000, 0002, 0005, 0022).

**Lease columns** (verified, `schema.ts:93-98`): `claimed_by text`, `claimed_at timestamptz`, `last_heartbeat_at timestamptz`, `retry_count` (default 0), `max_retries` (default 2).

**Heartbeat** (verified, `worker-loop.ts:1705-1725`):
- `UPDATE ... SET last_heartbeat_at = now() WHERE id = $conv AND claimed_by = $worker`, fire-and-forget.
- At most once per `heartbeatIntervalMs` (default 30 000, `:195`).
- Fires only from `onHeartbeat`, which `run-agent-loop.ts:526` calls after each LLM response.
- No heartbeat during a tool call, during sandbox setup or clone (`:1264-1275`), or during the 429 back-off sleeps of 30 s, 60 s, 120 s (`run-agent-loop.ts:361-428`).

**Stale threshold and sweep** (verified, `worker-loop.ts:847-969`):
- Every poll first selects `status = 'running' AND last_heartbeat_at < now() - staleThresholdMs` (default 300 000, `:196`).
- A stale row goes back to `queued` with `retry_count + 1` and the claim cleared (`:862-872`), or to `failed` when `retry_count >= max_retries` (`:910-920`). An `agent.stale_recovered` event is appended.
- The sweep runs in every worker process on every poll (`:2685`).

**Crashed worker** (verified): nothing else reclaims. The row stays `running` with `claimed_by` set until a live worker's sweep sees the heartbeat age exceed 5 min.

- Inferred: a slow but live turn (one LLM call or tool call over 5 min) is swept too. A second worker can then claim and run the same conversation concurrently.
- The first worker's heartbeat is conditional on `claimed_by` (`:1718`), so it cannot re-claim. Its results are discarded by the ownership check after the loop (`:1917-1930`). Its tokens and tool side effects are already spent.
- This contradicts the invariant stated at `:10`.

**SIGTERM** (verified, `service/main.ts:538-590`):
- Order: stop timers, close SSE, `server.close()`, `timeoutScheduler.close()`, `executor.stopWorker(drainTimeoutMs)`, `eventLog.close()`, `pool.end()`, `process.exit(0)`.
- `drainTimeoutMs = max(FORCE_SHUTDOWN_TIMEOUT_MS - 5000, 5000)`, default 25 s (`shared/env/config.ts:70`).
- Drain (`worker-loop.ts:2737-2788`) clears the poll timer and waits for `running` to empty, checking every 500 ms. At the deadline it calls `controller.abort()` on each in-flight conversation.
- The abort is observed at the top of each loop iteration, before each tool execution, and by the in-flight Anthropic request (`run-agent-loop.ts:249, 293, 369, 559`). A tool call in flight is not cancelled: `toolDef.execute(input)` receives no signal (`:601`).
- An aborted loop returns `status: "aborted"`. The worker re-enqueues the row as `queued` with the claim cleared and messages persisted (`worker-loop.ts:2526-2552`).
- There is no "release my claims" statement at shutdown. A turn that does not reach an abort check before `pool.end()` leaves the row `running`, to be swept after 5 min.
- A force exit with code 1 fires at `FORCE_SHUTDOWN_TIMEOUT_MS`, default 30 s (`main.ts:584-590`).

## 2. A signal arriving mid-turn or during claim (G13)

Verdict: **partly holds**. Durably queued, conditionally delivered.

**Write path** (verified, `framework/conversation-executor.ts:379-585`). `signal()` runs a transaction, locks the row `FOR UPDATE`, then branches on status:
- `running` or `queued`: append to the `queued_signals` JSONB array; set `pending_cancellation = true` for `task_cancelled` (`:551-577`).
- `waiting`: reject if the type does not match `pending_wait` (`:428-444`); else append the message, set `status = 'queued'`, clear `pending_wait` (`:509-525`).
- Terminal: reject (`:579-584`).
- Dedup by `source:deduplicationId` against `delivered_signal_ids`, capped at 100 FIFO (`:398-417`).

**The running loop never reads `queued_signals`** (verified). `run-agent-loop.ts` and the worker's callbacks (`worker-loop.ts:1735-1877`) contain no such read.

**After the loop**, in order (verified):
1. Ownership check (`:1917-1930`).
2. `pending_cancellation` re-read. If set, terminate as `cancelled` without consulting `queued_signals` (`:1984-2072`).
3. If `wait_for` triggered: re-read `queued_signals` under a `claimed_by` predicate (`:2079-2087`); take the first entry matching the new wait (`:2101-2105`); either consume it and re-enqueue as `queued` (`:2141-2154`), or pause as `waiting` leaving `queued_signals` untouched (`:2195-2207`).
4. If the loop completed: write `completed` without touching `queued_signals` (`:2291-2302`).

**Between claim and first LLM call** (verified):
- The row is already `running`, so the signal is queued.
- The pre-loop consume (`:1532-1588`) reads the claim-time snapshot `conv.queued_signals` and requires `conv.pending_wait` to be non-null.
- Inferred: no transition in the read code leaves a `queued` row with a non-null `pending_wait`. `signal()` clears it on resume (`:514`); pause sets it only with `status = 'waiting'`; the sweep touches `running` rows only. So the pre-loop path is not reached.
- A signal arriving here is first seen at the post-loop re-read, and only if the turn ends in a matching `wait_for`.

**Between last tool result and release** (verified statements, inferred race):
- Committed before the `SELECT` at `:2079`: handled as in step 3.
- Committed between that `SELECT` and the `UPDATE` at `:2141-2154`: overwritten, because that `UPDATE` writes `queued_signals` from the earlier read unconditionally (lost update).
- Committed between the `SELECT` and the pause `UPDATE` at `:2195-2207`: survives on the now-`waiting` row, but is not examined until a later matching `wait_for`.
- Committed after the completion `UPDATE`: rejected. Committed before it: remains on the completed row, never delivered.

**Non-matching signal to a waiting row** is rejected, not queued (`:428-444`). The dispatcher records `deliveryStatus: "failed"` in that case (`shared/services/task-signal-dispatcher.ts:562-563`).

## 3. Ordering and interrupt (G17)

Verdict: ordering **partly holds**; interrupt **does not hold**.

**Order** (verified):
- Appends happen under the row lock, so `queued_signals` is in commit order (`conversation-executor.ts:553-556`).
- Consumption is `findIndex` on type, plus `taskId` or `groupId` when the wait carries them (`framework/signal-matching.ts:22-59`). One signal per wake (`worker-loop.ts:2101-2105`).
- A later matching signal is delivered before an earlier non-matching one, which lingers.

**Depth** (verified): no cap on `queued_signals`; no code trims it. `delivered_signal_ids` is capped at 100 (`conversation-executor.ts:415-417`).

**Interrupt** (verified): none.
- `task_cancelled` sets `pending_cancellation` at write time (`:517, :564`). The worker checks it only after the loop returns (`worker-loop.ts:1987-1995`).
- When the signal was queued on a running row, its message is never injected: termination at `:1997-2009` precedes the queued-signal consume. The "one turn to clean up" text is seen only when the signal resumed a waiting row.
- `executor.cancel()` flips the row to `cancelled` and clears the claim immediately (`:646-655`) while the loop keeps running. The turn ends naturally; its results are discarded by the ownership check.
- The `AbortController` is used only by drain (`worker-loop.ts:2696, 2775-2777`).
- No priority field exists on `Signal` (`framework/types.ts:636-649`).

## 4. Dropped wakes (G19)

Verdict: **holds** for signals; **no sweep** exists for waiting rows.

- There is no LISTEN/NOTIFY anywhere in the agents package (verified by grep). The only lock primitive is `pg_advisory_xact_lock` in `router/router.ts:114`.
- The signal write is the wake. `status = 'queued'` is set in the same transaction as the message append (`conversation-executor.ts:509-525`). Any worker's next poll claims it (`worker-loop.ts:2678-2711`; `pollIntervalMs` default 5000; one poller per process; `WORKER_POLL_INTERVAL_MS` in `config.ts:69`).
- A crash after commit changes nothing. No worker polling means the row waits.

**Timeouts** (verified, `framework/timeout-scheduler.ts:200-254`):
- pg-boss job with `startAfter` and `singletonKey = conversationId`. The handler calls `executor.signal` with the original wait type.
- pg-boss 12.32.0 polls each queue every 2000 ms by default (`node_modules/.pnpm/pg-boss@12.32.0/node_modules/pg-boss/dist/attorney.js:568-570`) and retries a failed handler twice (`plans.js:87`).
- Its NOTIFY fast path needs a `db.listen` function. The adapter exposes only `executeSql` (`timeout-scheduler.ts:91-107`), so pg-boss runs polling-only (`notifier.js:44`).

**Reconciliation** (verified): the stale sweep covers `running` rows only. Nothing re-examines `waiting` rows. A `wait_for` without `timeout` waits indefinitely. Signals queued on a waiting row are not looked at until another signal resumes it.

## 5. The "keep the mechanism" verdict

All five exist (verified).

**Completion dispatcher**: `task-signal-dispatcher.ts:431-599`. Wired through `taskService.setDispatcher` (`main.ts:288-303`); invoked after the task write commits (`task-service.ts:281-297`, `:402-422`). Signals `task_completion` or `task_failure` to the parent's conversation. Group tasks go through policy evaluation instead (`:445-456`, `:202-399`).

**Orphan record**: when no active parent conversation exists, `completion_result.deliveryStatus = "orphaned"` is written on the task row, and a `signal.orphaned` event is appended under the synthetic conversation id `orphan-<taskId>` (`:505-548`).

**Completion result on the row**: `tasks.completion_result` JSONB (`schema.ts:385-388`) holds `signalType`, `payload`, `writtenAt`, `deliveryStatus`, `targetConversationId` (`:69-75`). Written on every path (`:510-518`, `:566-574`, `:419-427`).

**Lookup of the parent's current conversation**: `executor.findActiveForTask(task.parent_id)` (`:503`) selects `conversations WHERE task_id = $parentTask AND status IN ('running','waiting','queued') ORDER BY created_at DESC LIMIT 1` (`conversation-executor.ts:823-845`).
- Resolution is by parent *task* id at completion time, not a conversation id stored at delegation. It survives a parent re-trigger that carries the same `task_id` (`:274`; `router.ts:179-186`).
- Caveat: the parent id is `parentTaskId ?? ctx.taskId` (`shared/tools/task/delegate-task.ts:146`). A delegator without a task creates a root task, and the dispatcher returns at `:459-461` with nobody to signal.

**Claim and lease**: section 1.

**Caveat on the group path**: the "lock" at `:209-211` is `db.execute(SELECT ... FOR UPDATE)` on the pool, not inside `db.transaction`. In autocommit the row lock ends with the statement (believed, standard Postgres). It does not serialise concurrent evaluations as the comment at `:200` claims.

## 6. The database query profile

Constants: pool `max: 20` (`main.ts:86`). One worker loop per process (`conversation-executor.ts:103-147`). `concurrencyLimit` from `MAX_CONCURRENT_CONVERSATIONS`, default 5 (`config.ts:68`, `main.ts:257`; the worker-loop default of 3 is overridden). Heartbeat and stale use the worker-loop defaults; `main.ts` does not pass them. "Tx" means inside `db.transaction`.

| Trigger | Statement | Table | Kind | Tx | Where |
|---|---|---|---|---|---|
| Poll, every 5 s per process | stale scan `status='running' AND last_heartbeat_at < now()-300s` | conversations | select | no | `worker-loop.ts:852-857` |
| Poll, per stale row | requeue or fail; event append (buffered) | conversations | update | no | `:862-872`, `:910-920` |
| Poll, if capacity > 0 | claim CTE + `RETURNING *` (whole row incl. `messages`) | conversations | select+update | single stmt | `:981-998` |
| Heartbeat, ≤ 1 per 30 s, after an LLM response only | `SET last_heartbeat_at WHERE id AND claimed_by` | conversations | update | no, fire-and-forget | `:1707-1725`; `run-agent-loop.ts:526` |
| Execution start | `MAX(sequence)` for `initSequence` | agent_events | select | no | `event-log.ts:266-273` |
| Execution start, if `task_id` | task, latest handoff, all handoffs | tasks, task_handoffs ×2 | select ×3 | no | `worker-loop.ts:1150-1156` |
| Execution start, if resumed | flush, then events after `last_persisted_sequence` | agent_events | select | no | `:620-628`; `event-log.ts:276-306` |
| Execution start, top-level only | current identity documents | identity_documents | select | no | `:1243-1246`; `identity-service.ts:143` |
| Execution start, tree budget | root activation; refresh on resume | conversations | update; select | no | `:1302-1309`; `tree-budget.ts:136-140` |
| Execution start and each terminal transition | correlation status | work_correlations | update | no, fire-and-forget | `:1098`; `correlation-service.ts:176-186` |
| Execution start | session row for artifacts | agent_sessions | select | no | `:1661`; `session-projection.ts:224-228` |
| Execution start, sandbox agents | container records (8 statements in `platform/src/sandbox`, not read) | platform.* | mixed | – | `:1268-1275` |
| Pre-loop signal consume (path not reached, §2) | messages, `pending_wait`, `queued_signals` | conversations | update | no | `:1569-1577` |
| Per LLM call | none direct; `llm.response` event and content row buffered; tree-budget recursive-CTE propagate per response when active | conversations | update | no, fire-and-forget | `:1802-1813`; `tree-budget.ts:66-81` |
| Per LLM call, once | warning flag | conversations | update | no, fire-and-forget | `:1831-1837` |
| Per tool call | `tool.called` and `tool.succeeded/failed` buffered (output cut to 2000 chars); MCP events buffered; plus the tool's own queries | agent_events | – | – | `:1746-1785`, `:1359-1371` |
| Per `delegate_task` call | parent task; parent budget; insert task; `executor.start` tx; read+write `active_delegations` | tasks, conversations | select ×3, insert, update, +tx | mixed | `delegate-task.ts:151-308` |
| Event-log append | none; flush after 1000 ms or at 100 buffered | – | – | – | `event-log.ts:113-116`, `:257-262` |
| Event-log flush (global, all conversations) | multi-row insert, then content insert | agent_events, agent_event_content | insert ×2 | no (sequential, not atomic) | `:147-177` |
| Forced flush | at pause, complete, fail, cancel, signal-resume, reopen, query | as above | insert | no | `worker-loop.ts:2110, 2220, 2312`; `executor.ts:541, 667, 763` |
| Session projection, lifecycle events | upsert on `agent.started`; update on completed/paused/resumed/reopened; fired in memory before the event is persisted | agent_sessions | insert/update | no | `session-projection.ts:64-137`; `event-log.ts:253-254` |
| Session projection, `tool.succeeded` | none: handler reads `payload.toolName`, worker writes `tool_name` | – | – | – | `session-projection.ts:140`; `worker-loop.ts:1779` |
| Signal write, any status | lock row; append or resume | conversations | select FOR UPDATE, update | yes | `conversation-executor.ts:379-585` |
| Signal write, resume path adds | pg-boss cancel; `MAX(sequence)`; forced flush | pgboss.job, agent_events | update, select, insert | partly | `:447-453`, `:528-541`; `timeout-scheduler.ts:277` |
| Pause | full `messages` rewrite, `pending_wait`, claim cleared | conversations | update | no | `worker-loop.ts:2195-2207` |
| Pause with timeout | pg-boss `send` | pgboss.job | insert | no | `timeout-scheduler.ts:247-254` |
| Pause-point consume | flush; full `messages` rewrite, `queued_signals`, `status='queued'` | conversations | update | no | `:2110-2154` |
| Post-loop, always | ownership check; `pending_cancellation` | conversations | select ×2 | no | `:1918-1923`, `:1987-1993` |
| Post-loop, if a signal was consumed | read and write `active_delegations` | conversations | select, update | no | `:1942-1965` |
| Complete | full `messages` rewrite; flush; schedule state if cron | conversations, schedule_state | update | no | `:2291-2312`, `:2332-2363` |
| Fail or retry | full `messages` rewrite; flush | conversations | update | no | `:2389-2401`, `:2467-2480` |
| Task terminal transition | old status; update (or update + handoff insert) | tasks, task_handoffs | select, update, insert | update path no; handoff path yes | `task-service.ts:234-273`, `:345-390` |
| Dispatcher, per-task path | task; active parent conversation; signal tx; `completion_result` | tasks, conversations | select ×2, tx, update | mixed | `dispatcher.ts:439, 503, 561, 566-574` |
| Dispatcher, orphan path | `completion_result`; `MAX(sequence)`; flush | tasks, agent_events | update, select, insert | no | `:510-537` |
| Dispatcher, group path | `FOR UPDATE` outside a tx; group state ×2 (group + tasks); status; signal tx; `completion_result` | task_groups, tasks | select ×5, update ×2, tx | mixed | `:209-211`, `:231`, `:239`, `:351`, `:359` |
| Compaction | none; Phase 2 LLM call unreachable from the worker (no `anthropicClient` passed) | – | – | – | `worker-loop.ts:1662-1668`; `history-manager.ts:855-866` |
| Other pollers | pg-boss `work()` per queue every 2000 ms (timeout queue, dedup cleanup, schedule queues; count not read); supervise every 60 s | pgboss.* | select/update | – | `attorney.js:568-570, 591`; `main.ts:489-491` |
| Other timers | knowledge cleanup, hourly | knowledge_entries | delete | no | `main.ts:308-319` |
| Inbound webhook | dedup `INSERT ... ON CONFLICT DO NOTHING`; task path: tx with `pg_advisory_xact_lock` + task + active conversation | processed_webhook_events, tasks, conversations | insert; select ×2 | task path yes | `webhook-filter.ts:69-70`; `router.ts:110-134` |

## 7. Transcript size

**Storage** (verified):
- The transcript is one `messages` JSONB array on the conversation row (`schema.ts:83`), LZ4-compressed (`migrations/0002_add_executor_columns.sql:29`).
- It is loaded whole on every claim (`RETURNING *`) and rewritten whole at every boundary (§6).
- The event log is a separate lean record. Payloads are cut to 10 KB (`event-log.ts:40, 115`); tool outputs to 2000 chars before append (`worker-loop.ts:1781`). `llm.response` text blocks go to `agent_event_content` uncut (`:1812`; `event-log.ts:246-251`).

**Resume shape** (verified, `worker-loop.ts:1686-1690`):
- A resumed run serialises the compacted history as JSON into one user message (`context = JSON.stringify(messagesForLoop)`), followed by "Continue the conversation from where you left off."
- The persisted array is then `[...currentMessages, ...result.messages.slice(1)]` (`:1936`). The JSON blob is dropped from storage but is the prompt the model sees.

**Measurement** (verified):
- `estimateMessageTokens` is `ceil(chars/4)` plus 4 per message (`history-manager.ts:97-156`). It runs before the pre-compaction flush (`worker-loop.ts:1598`) and in `compact`.
- Per-call `token_count_input/output` land on `llm.response` events (`:1809-1810`). `subtree_consumed` accumulates per tree (`tree-budget.ts:66-81`).
- No byte-size measurement of `messages` exists in the read files.

**Thresholds** (verified, per definition):
- `dev-agent`: prune 80 000, protected 20, summary 120 000. `product-agent`: prune 30 000, protected 10, summary 50 000. Both `claude-haiku-4-5-20251001` (`definitions/*/definition.yaml`).
- Phase 1 runs at `>= pruneThreshold` (`history-manager.ts:811`): duplicate file reads replaced; head+tail 500+1500 tokens for file and integration reads; descriptors for search and command tools (`:458-587`).
- Phase 2 needs `prunedTokens > summaryThreshold` and a client. The worker passes none, so it returns the pruned result with a warning (`:855-866`).

## 8. Tests as evidence

Unit tests mock the database. The integration suite is excluded from `pnpm test` (`packages/agents/vitest.config.ts:9`) and runs via root `test:integration` (`package.json:13`, Docker).

**Q2, tested**:
- `conversation-executor.test.ts` "signal() -- queue for running": "queues signal when conversation is running" (`:716`); "returns { action: queued }" (`:734`).
- `worker-loop.test.ts` "queued signal consumption" (`:1027, :1068, :1117`) exercises the pre-loop path with `pending_wait` set.
- Integration Flow 4 "queues signal when conversation not yet waiting, delivers on pause" (`framework/__integration__/lifecycle-flows.integration.test.ts:335-366`, mocked agent loop) exercises the post-loop re-read end to end.

**Q2, untested**:
- The post-loop re-read at unit level. "execution -- wait_for pause" is `it.skip` ×3 (`worker-loop.test.ts:687-826`); "execution -- completion" `it.skip` ×3 (`:613-686`); "timeout scheduling" `it.skip` ×4 (`:1203-1385`).
- A signal injected while `runAgentLoop` is in flight; the lost-update window; signals stranded on completion.
- `pending_cancellation` and the one-turn cancellation: no mention in either test file.

**Q3, tested**: `signal-matching.test.ts:13-89` (type membership, multi-type, old format, `taskId` scoping); dedup at `conversation-executor.test.ts:757, :777`; abort re-enqueue at `worker-loop.test.ts:1149`.

**Q3, untested**: order with several queued signals; first-match skip-over; the 100-entry cap; `cancel()` against a running turn (`:909-970` check the row write only).

**Q4, tested**: "stale recovery" ×4 (`worker-loop.test.ts:512-595`); "claiming" ×5 (`:316-391`, string checks on the SQL text); timeout handler (`timeout-scheduler.test.ts:209, :246`); integration Flow 3 timeout (`lifecycle-flows...:262`).

**Q4, untested**: two workers racing one row (no concurrent claim test; integration uses one executor); the sweep racing a live slow worker; waiting rows without timeout; pg-boss retry on handler failure.

**Q5**: dispatcher paths are well covered (`task-signal-dispatcher.test.ts:219-1183`, including orphan `:354`, delivered `:401`, failed `:437`, and group policies). `task-service.test.ts` has no test of the dispatcher callback (grep for `setDispatcher` and `onTaskUpdate` returns nothing). `group-service.test.ts` covers `evaluatePolicy` only.

## Not read

- `framework/agent-registry.ts`, `tool-registry.ts`, `schema.drizzle.ts`.
- `identity-service.ts` beyond the query line; `correlation-service.ts` `register()`.
- `platform/src/sandbox/*` (only grepped for statement count).
- `spawn-agent.ts` beyond a grep: sub-agents run as a nested `runAgentLoop` inside the parent's claim (`:11, :160`).
- `wait-for-group-tool.ts`; the respond, clarify and answer task tools; `schedule-registry.ts`; the materialisation services; `knowledge-service.ts`.
- `router/router.ts` outside `:80-200`; the integration test setup (`:1-170`) and its mocks.
- pg-boss beyond greps of `attorney.js`, `notifier.js`, `plans.js`; the Drizzle transaction driver.
- Postgres lock and autocommit semantics are stated as believed. No query was run against a database.
