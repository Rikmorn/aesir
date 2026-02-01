# Architecture Patterns: Unified Agent Framework (v2.3)

**Domain:** Agentic development platform -- replacing Temporal workflows + 3 persistence stores with a unified conversation-based framework
**Researched:** 2026-02-01
**Overall confidence:** HIGH (codebase analysis) / MEDIUM (external patterns)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [ConversationExecutor as Temporal Replacement](#2-conversationexecutor-as-temporal-replacement)
3. [Event Log Integration with Drizzle ORM](#3-event-log-integration-with-drizzle-orm)
4. [Single Service Consolidation](#4-single-service-consolidation)
5. [Agent Registry + Definition Loading](#5-agent-registry--definition-loading)
6. [Conversation History as JSONB](#6-conversation-history-as-jsonb)
7. [Migration Sequence: Temporal to Custom Orchestration](#7-migration-sequence-temporal-to-custom-orchestration)
8. [Data Flow: Full Pause/Resume Cycle](#8-data-flow-full-pauseresume-cycle)
9. [Suggested Build Order](#9-suggested-build-order)
10. [Component Interface Summary](#10-component-interface-summary)
11. [Performance Implications](#11-performance-implications)
12. [Sources and Confidence Assessment](#12-sources-and-confidence-assessment)

---

## 1. Executive Summary

v2.3 removes Temporal as the orchestration layer and replaces it with a Postgres-backed `ConversationExecutor` that treats the agent loop as the only state machine. Three disconnected persistence stores (`execution_traces`, `tasks`, `context_snapshots`) converge into a unified event log with reactive session projections. Per-agent services (dev-agent:3004, product-agent:3005, router:3006) merge into a single HTTP service with an agent registry.

The core architectural bet: **Postgres is sufficient for Aesir's durability requirements.** Temporal provides enterprise-grade durable execution (replay, distributed task queues, visibility queries), but Aesir uses approximately 5% of those capabilities. The actual requirements are: persist conversation state, route signals to paused conversations, enforce timeouts, detect stale executions, and ensure at-least-once processing. Postgres can handle all of these with well-established patterns.

**Key finding from research:** The `SELECT FOR UPDATE SKIP LOCKED` pattern used by PgBoss, Solid Queue (Rails), DBOS, and Inngest is the battle-tested approach for Postgres-backed job queues. It provides exactly the concurrency control needed: only one worker processes a conversation at a time, other workers skip locked rows and pick up different work.

**What changes and what stays the same:**

| Layer | Current (v2.2) | Target (v2.3) | Risk |
|-------|----------------|---------------|------|
| Agent loop | `runAgentLoop()` | Unchanged | None |
| Orchestration | Temporal workflows | ConversationExecutor (Postgres) | MEDIUM |
| Persistence | 3 stores (traces, tasks, snapshots) | Event log + session projection | LOW |
| Services | 4 containers (dev-agent, worker, product-agent, router) | 1 container | LOW |
| Agent config | Hardcoded constants | Declarative YAML + prompt.md | LOW |
| Signal handling | 5 typed Temporal signals | Freeform IncomingEvent + adapters | LOW |
| Tool registry | Inline toolkit factories | Centralized registry with factories | LOW |
| Context persistence | LLM summaries at activity boundaries | Full conversation history (compacted) | MEDIUM |

---

## 2. ConversationExecutor as Temporal Replacement

### 2.1 What Temporal Currently Provides

Reading the current `orchestrator-workflow.ts` (613 lines), Temporal provides:

1. **Durable signal waits** (`wf.condition(() => state.approval !== null, "72 hours")`) -- conversation pauses until external event or timeout
2. **Activity retries** (`maximumAttempts: 2`, exponential backoff) -- restart agent loop on failure
3. **Phase machine** (pre_approval -> awaiting_approval -> post_approval -> awaiting_pr -> addressing_feedback -> complete) -- deterministic state transitions
4. **Heartbeat detection** (`heartbeatTimeout: "5 minutes"`) -- detect stuck activities
5. **Signal handlers** (4 typed signals: planApproval, prFeedback, prCompletion, escalationResolved)
6. **Workflow queries** (orchestratorStatusQuery for current phase/PR info)

Of these, **items 1, 2, 4, and 5 are essential**. Item 3 (phase machine) is the thing v2.3 explicitly removes -- the agent loop replaces it. Item 6 is replaced by the session projection.

### 2.2 The Postgres-Backed Executor Pattern

**Confidence: HIGH** (verified across DBOS, PgBoss, Solid Queue, Inngest)

The pattern has three components:

**Component A: Job Queue (replaces Temporal task queue)**

```sql
-- Conceptual, not literal SQL
SELECT id, conversation_id FROM conversations
WHERE status = 'queued'
ORDER BY updated_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

- `FOR UPDATE` locks the row -- no other worker can claim it
- `SKIP LOCKED` means other workers skip locked rows and find different work
- Transaction commit releases the lock
- If the worker crashes, the transaction rolls back and the row becomes available again

**Component B: Signal Routing (replaces Temporal signals)**

When a webhook arrives:

```
1. Adapter normalizes payload -> IncomingEvent
2. Router resolves conversation ID from correlation key
3. Load conversation from DB
4. If paused + matching wait type:
   - Append signal as user message to messages[]
   - Set status = "queued" (ready to resume)
   - Worker picks it up via Component A
5. If running or not yet paused:
   - Append to queued_signals[] JSONB column
   - Checked when agent next calls wait_for
```

**Component C: Timeout Enforcement (replaces Temporal timers)**

Two options, both viable for Aesir's scale:

| Option | How | Pros | Cons |
|--------|-----|------|------|
| **Polling (recommended)** | Worker scans for `WHERE status = 'paused' AND timeout_at < NOW()` every 30s | Simple, no dependencies, works everywhere | 30s worst-case latency on timeout |
| pg_cron | Scheduled function runs timeout check | Exact timing | Requires extension, adds operational surface |

**Recommendation: Polling.** Aesir's timeouts are 24h, 72h, 7d. A 30-second check interval means worst-case 30 seconds of delay on a 72-hour timeout. The simplicity wins decisively.

### 2.3 Concurrency Control: The Critical Invariant

**The invariant: exactly one agent loop runs per conversation at any time.**

Temporal enforces this automatically (one workflow execution per workflow ID). The Postgres executor must enforce it explicitly.

The approach:

1. **Conversation status column** acts as a state lock:
   - `queued` -- waiting for a worker to pick it up
   - `running` -- a worker is executing the agent loop
   - `paused` -- waiting for an external signal
   - `completed` / `failed` -- terminal states

2. **Worker claims a conversation** by atomically updating `status = 'running'` within the `SELECT FOR UPDATE SKIP LOCKED` transaction. If two workers try to claim the same conversation, only one succeeds.

3. **Heartbeat column** (`last_heartbeat_at`) is updated by the worker every N seconds during agent loop execution. A separate sweep query detects stale conversations:

```sql
UPDATE conversations
SET status = 'queued', last_heartbeat_at = NULL
WHERE status = 'running'
  AND last_heartbeat_at < NOW() - INTERVAL '5 minutes';
```

This provides at-least-once execution. If a worker crashes, the conversation is re-enqueued after the heartbeat timeout.

### 2.4 The `wait_for` Tool: Framework-Intercepted Sentinel

The `wait_for` tool is the mechanism by which agents pause conversations. It is NOT a normal tool -- the framework intercepts it before execution.

**How it integrates with `runAgentLoop()`:**

The current `runAgentLoop()` has a tool execution loop (lines 489-567 in `run-agent-loop.ts`). The framework needs to detect `wait_for` tool calls and exit the loop:

```
1. LLM returns tool_use block with name "wait_for"
2. Framework intercepts BEFORE executing the tool
3. Framework returns tool_result: "Conversation paused. Waiting for: {type}"
4. Framework sets a flag to exit the loop after sending the tool_result
5. Agent loop completes normally with the tool_result in conversation history
6. Executor persists conversation (messages include the wait_for + result)
7. Executor sets status = "paused", pendingWait = { type, metadata }
```

**Key design decision:** The `wait_for` tool result IS added to the conversation history before persisting. When the agent resumes, it sees:

```
[assistant]: I need human approval for this plan. [tool_use: wait_for({type: "approval"})]
[user]: [tool_result: "Conversation paused. Waiting for: approval"]
[user]: "Plan approved by John Smith. Feedback: 'Looks good, proceed.'"
```

The agent has full context of what it was doing, why it paused, and what the response was.

**Integration point with existing `runAgentLoop()`:**

The current loop does NOT need modification for `wait_for` to work. The executor can achieve this by:

1. Registering `wait_for` as a regular tool whose `execute` function sets a side-channel flag
2. After each tool execution cycle, checking the flag
3. If set, the executor breaks out of the agent loop by using the existing `abortSignal`

Alternatively, `runAgentLoop()` could be extended with a new option: `messages?: Anthropic.MessageParam[]` to accept a pre-populated conversation history for resume (the spec notes this need). This is a minimal change -- the current `buildInitialMessage` logic is bypassed when `messages` is provided.

### 2.5 Failure Modes and Mitigations

| Failure | Detection | Recovery | v2.2 Equivalent |
|---------|-----------|----------|-----------------|
| Worker crashes mid-loop | Heartbeat timeout (5 min) | Re-enqueue conversation | Temporal activity retry |
| DB connection lost during persist | Write failure throws | Agent loop re-runs on next pickup | Temporal event history |
| Signal arrives for wrong conversation | `pendingWait.type` mismatch | Log and reject signal | Temporal signal typing |
| Duplicate signal (webhook retry) | Dedup by signal source + ID | No-op, return success | Webhook idempotency layer |
| Conversation stuck in "running" | Heartbeat sweep query | Re-enqueue after timeout | Temporal heartbeat timeout |
| Total timeout exceeded | Polling check on `timeout_at` | Wake with timeout signal | Temporal `wf.condition` timeout |

### 2.6 What Temporal Capabilities Are Genuinely Lost

Being honest about tradeoffs:

| Temporal Capability | Impact on Aesir | Mitigation |
|---------------------|-----------------|------------|
| **Deterministic replay** | Cannot replay exact execution sequence for debugging | Event log provides full trace (better than replay for debugging) |
| **Workflow versioning** | Cannot run v1 and v2 workflows side-by-side | Agent definition versioning serves the same purpose |
| **Visibility queries** | Cannot use Temporal UI for workflow inspection | Session projection + admin API provide equivalent data |
| **Distributed task queues** | Cannot scale workers across machines | Postgres `FOR UPDATE SKIP LOCKED` supports multiple workers on same DB |
| **Activity retry with backoff** | Must implement retry logic manually | Agent loop already has rate-limit retry (3 attempts, 30s backoff); executor adds outer retry |

**Assessment:** None of these are blockers. The event log + session projection provides better observability than Temporal's visibility queries for Aesir's use case (agent behavior debugging). Distributed scaling is not needed at current volume.

---

## 3. Event Log Integration with Drizzle ORM

### 3.1 Schema Design

The spec defines three new tables (Appendix B.3). They map to the existing Drizzle ORM pattern used throughout Aesir (`pgSchema("agents")` + table definitions).

**New tables replacing existing ones:**

| New Table | Replaces | Purpose |
|-----------|----------|---------|
| `agent_events` | `execution_traces` | Append-only event stream with tool results |
| `agent_sessions` | `tasks` | Materialized projection (status, artifacts) |
| `conversations` | `context_snapshots` | Full conversation state + message history |

The `agent_events` table has a unique constraint on `(conversation_id, sequence)` ensuring monotonic ordering per conversation. This is the primary query pattern and the main index.

### 3.2 Write Path: Buffered Batch Inserts

**Confidence: HIGH** (same pattern as existing `trace-recorder.ts`, proven at Aesir's scale)

The current `trace-recorder.ts` already implements buffered fire-and-forget writes. The event log follows the same pattern but fixes the gap (tool results ARE recorded).

```
Agent loop executes tool
  -> onToolCall callback fires
  -> EventLog.append({ type: "tool.called", ... })  // void, non-blocking
  -> Tool executes
  -> onToolResult callback fires
  -> EventLog.append({ type: "tool.succeeded", ... })  // void, non-blocking

Background:
  Buffer accumulates events
  Every 100ms OR when buffer hits 50 events:
    Batch INSERT into agent_events
    Update agent_sessions projection
```

**Key implementation detail:** The `append()` method is synchronous (void return). Events are buffered in memory and flushed periodically. The `flush()` method is called explicitly at conversation pause points and shutdown.

**Drizzle ORM integration:** Batch insert uses Drizzle's `.insert().values([...])` syntax. The existing pattern in `task-store.ts` and `trace-recorder.ts` confirms this works with the `agents` schema.

### 3.3 Read Path: Filtered Queries

Event queries use the spec's `EventQueryOpts` interface:

```typescript
// Query by conversation (primary pattern)
db.select().from(agentEvents)
  .where(eq(agentEvents.conversationId, conversationId))
  .orderBy(agentEvents.sequence);

// Query by type (observability)
db.select().from(agentEvents)
  .where(and(
    eq(agentEvents.conversationId, conversationId),
    inArray(agentEvents.type, ["tool.succeeded", "tool.failed"])
  ));
```

The `(conversation_id, sequence)` index handles the primary query pattern efficiently. Per-conversation event counts are expected to be 100-500 (based on current `execution_traces` data: 100-500 traces per task, 10-50 tasks/day from `cost-tracking.ts`).

### 3.4 LISTEN/NOTIFY Analysis

**Confidence: MEDIUM** (researched Drizzle ORM support, found gap)

The spec mentions `LISTEN/NOTIFY or polling for subscriptions`. Research finding: **Drizzle ORM does NOT support LISTEN/NOTIFY natively.** The Drizzle connection uses `node-postgres` (`pg`) under the hood, and LISTEN/NOTIFY requires a dedicated raw `pg.Client` connection that stays open for notification delivery.

**Options:**

| Option | How | Complexity |
|--------|-----|------------|
| **Polling (recommended for v2.3)** | Session projection queries `agent_sessions` on interval | Trivial |
| Raw pg Client | Maintain separate connection outside Drizzle for LISTEN/NOTIFY | Medium -- connection lifecycle management |
| pg-listen library | Wrapper around pg LISTEN/NOTIFY with reconnection | Low -- but adds dependency |

**Recommendation: Polling for v2.3.** The `subscribe()` method on EventLog is used by the session projection (which is the only subscriber in v2.3 scope). Polling the events table every 100ms for new events per active conversation is sufficient and avoids adding a separate connection management layer.

The `EventLog.subscribe()` interface is designed so that a LISTEN/NOTIFY implementation can be swapped in later without changing callers. The interface abstracts the delivery mechanism.

### 3.5 Session Projection: Reactive Updates

The `agent_sessions` table is a materialized view of the event stream. It replaces the `tasks` table with reactively computed fields instead of imperatively set fields.

**How it updates:**

```
Event arrives: tool.succeeded for "github:create_pull_request"
  -> Session projection checks: does this tool have artifact config?
  -> Yes: artifact key = "github:pr"
  -> Extract result.data from event payload
  -> UPSERT agent_sessions SET artifacts = jsonb_set(artifacts, '{github:pr}', ...)
```

**What this replaces in the current codebase:**

Currently, `parsePrInfoFromTrace()` in `orchestrator-activities.ts` (line ~60) scans the agent's trace array after the loop completes looking for `github_create_pull_request` tool calls. If the agent creates a PR in an unexpected phase, the parsing misses it. The event log approach records the PR data when the tool succeeds -- no scanning, no phase assumptions.

---

## 4. Single Service Consolidation

### 4.1 What Gets Merged

Currently 4 agent-related containers in `docker-compose.yml`:

| Container | Port | Entry Point | Purpose |
|-----------|------|-------------|---------|
| `dev-agent` | 3004 | `dist/dev-agent/main.js` | HTTP for dev-agent events |
| `dev-agent-worker` | none | `dist/dev-agent/worker.js` | Temporal worker |
| `product-agent` | 3005 | `dist/product-agent/main.js` | HTTP + embedded Temporal worker |
| `router` | 3006 | `dist/router/main.js` | Event classification |

These become **one container**:

| Container | Port | Entry Point | Purpose |
|-----------|------|-------------|---------|
| `agent-service` | 3004 | `dist/main.js` | HTTP + worker polling loop |

### 4.2 HTTP Router Composition

All three current services use Node.js `http.createServer()` (not Express). The dev-agent `main.ts` shows the pattern:

```typescript
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") { ... }
  if (req.method === "POST" && req.url === "/events") { ... }
});
```

The merged service adds routes:

```
GET  /health                        -- combined health check
POST /events                        -- webhook events (from integrations)
GET  /conversations/:id             -- query conversation state
POST /conversations/:id/cancel      -- cancel a conversation
```

This is straightforward composition -- a single `createServer` with a URL matcher. No Express needed, no additional dependency.

### 4.3 Docker Compose Migration

**Removed services:** `dev-agent`, `dev-agent-worker`, `product-agent`, `router`, `temporal`, `temporal-ui`

**Modified services:**

| Service | Change |
|---------|--------|
| `nginx` | Remove routing for `/agent/`, `/router/`; add single route to `agent-service` |
| Integration services | Change `ROUTER_URL` from `http://router:3006/events` to `http://agent-service:3004/events` |

**New service:**

```yaml
agent-service:
  build: { context: ., dockerfile: Dockerfile }
  container_name: aesir-agent-service
  user: root  # Docker socket for DevContainerManager
  depends_on:
    postgresql: { condition: service_healthy }
    linear-integration: { condition: service_healthy }
    github-integration: { condition: service_healthy }
    slack-integration: { condition: service_healthy }
  environment:
    # Same as current dev-agent + product-agent combined
    # MINUS all TEMPORAL_* vars
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  command: ["node", "dist/main.js"]
  ports: ["3004:3004"]
```

**Net reduction:** 6 services removed (dev-agent, dev-agent-worker, product-agent, router, temporal, temporal-ui), 1 added (agent-service). Total service count drops from 10 to 5 (postgresql, 3 integrations, agent-service, nginx).

### 4.4 Bootstrap Sequence

The single service `main.ts` bootstrap order matters for dependency injection:

```
1. Load environment config (Zod validation, fail fast)
2. Connect to PostgreSQL (Drizzle ORM)
3. Run migrations (optional, can be gated by env flag)
4. Create AgentRegistry (lazy-loading from definitions/)
5. Create ToolRegistry, register all tool factories
6. Create EventLog (Postgres-backed, buffered writes)
7. Create SessionProjection (subscribes to EventLog)
8. Create ConversationExecutor (uses EventLog, AgentRegistry, ToolRegistry)
9. Create EventRouter (loads start rules from AgentRegistry)
10. Start HTTP server (routes to EventRouter, Executor)
11. Start worker polling loop (claims queued conversations)
12. Register graceful shutdown (flush EventLog, close DB)
```

**Key integration point:** Step 5 (ToolRegistry) needs the `DevContainerManager` for codebase tools. The current `worker.ts` creates this with Docker socket access. The merged service inherits this -- same Docker socket mount, same container manager initialization.

---

## 5. Agent Registry + Definition Loading

### 5.1 Lazy Loading with mtime Invalidation

**Confidence: HIGH** (well-established pattern: Logstash, Metricbeat, OpenCode)

Agent definitions live in `packages/agents/definitions/`, one directory per agent. The registry loads on first `get()` call and caches. Cache invalidation uses file `mtime` (modification time):

```
registry.get("dev-agent"):
  1. Check in-memory cache for "dev-agent"
  2. If cached:
     a. stat() the definition file
     b. Compare mtime to cached mtime
     c. If unchanged: return cached definition (fast path)
     d. If changed: reload from disk, update cache
  3. If not cached:
     a. Read definition.yaml + prompt.md
     b. Parse YAML, validate with Zod schema
     c. Assemble AgentDefinition object
     d. Cache with mtime
     e. Return
```

**Why NOT file watchers (fs.watch/chokidar):**

| Concern | File Watcher | mtime Check |
|---------|-------------|-------------|
| Cross-platform reliability | fs.watch is unreliable on Docker volumes, NFS | `stat()` works everywhere |
| Resource usage | Holds inotify/kqueue handles per file | Zero idle cost |
| Complexity | Event handler, debouncing, error recovery | Single `stat()` call |
| Docker compatibility | Known issues with bind mounts | Works reliably |

The mtime check adds ~1ms of latency per `get()` call (filesystem stat). Given that `get()` is called once per conversation start (not per tool call), this is negligible.

### 5.2 Schema Validation

Each definition file is validated against a Zod schema on load:

```typescript
const AgentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  model: z.string(),
  temperature: z.number().optional().default(0),
  tools: z.array(z.string()),           // Validated against ToolRegistry
  subAgents: z.record(z.string()).optional(),
  maxIterations: z.number(),
  tokenBudget: z.number(),
  history: z.object({
    pruneThreshold: z.number(),
    protectedMessages: z.number(),
    summaryThreshold: z.number(),
    summaryModel: z.string(),
  }),
  triggers: z.array(z.object({ event: z.string() })).optional(),
});
```

**Validation timing:** On load (first `get()` or cache invalidation). Invalid definitions throw immediately -- fail fast, loud error in logs. This matches Aesir's existing pattern (env validation via Zod fails at startup).

### 5.3 Version Pinning

When a conversation starts, the executor records the `agentDefinitionVersion` from the definition. On resume, the executor loads the definition by `id + version`:

```
registry.get("dev-agent", "1")
```

If the version file has been updated to "2" between pauses, the resumed conversation still uses version "1". This prevents mid-conversation behavior changes -- the agent that resumes is the same agent that paused.

**Implementation:** The registry caches by `id:version` composite key. Multiple versions of the same agent can coexist in cache.

---

## 6. Conversation History as JSONB

### 6.1 TOAST Performance Analysis

**Confidence: MEDIUM** (researched Postgres JSONB internals, applied to Aesir's expected data)

PostgreSQL stores JSONB using TOAST (The Oversized Attribute Storage Technique). When a JSONB column exceeds ~2KB, Postgres compresses and stores it out-of-line. The concern: does this affect performance for conversation histories that grow to 50-200KB?

**Aesir's expected conversation sizes:**

| Conversation Type | Turns | Estimated Size | TOAST Behavior |
|-------------------|-------|----------------|---------------|
| Product agent (short) | 5-20 turns | 10-30KB | Out-of-line, compressed |
| Dev agent (simple task) | 20-50 iterations | 30-80KB | Out-of-line, compressed |
| Dev agent (complex task) | 50-100 iterations | 80-200KB | Out-of-line, compressed |
| Dev agent after compaction | Any | 20-60KB | Out-of-line, compressed |

**The performance concern:**

TOAST has write amplification. Updating a JSONB column rewrites the entire TOAST value, not just the changed part. For a 100KB conversation, every message append means rewriting 100KB.

**Why this is acceptable for Aesir:**

1. **Write frequency is low.** The conversation is only written at two points: (a) when the agent calls `wait_for` (pause), and (b) when the conversation completes. During agent execution, the conversation lives in memory. There is NOT a write per tool call.

2. **Single read + single write per execution cycle.** The executor reads the conversation once (on resume), runs the agent loop entirely in memory, and writes once (on pause/complete). This is 2 I/O operations per execution cycle, regardless of conversation size.

3. **History compaction limits growth.** The three-phase compaction strategy (tool output pruning at 80K tokens, structured summary at 120K tokens) keeps conversation sizes bounded. A compacted 200-message conversation is typically 20-60KB.

4. **The alternative is worse.** Normalizing messages into separate rows (one row per message) adds JOIN complexity, loses atomic consistency (partial writes), and makes the resume path slower (N queries instead of 1).

### 6.2 Size Estimates

Anthropic's message format includes content blocks. A typical tool-use turn:

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "I'll read the configuration file..." },
    { "type": "tool_use", "id": "toolu_01...", "name": "read_file", "input": {"path": "config.ts"} }
  ]
}
```

Plus the tool result:

```json
{
  "role": "user",
  "content": [
    { "type": "tool_result", "tool_use_id": "toolu_01...", "content": "export const config = {...}" }
  ]
}
```

**Per-iteration size estimate:**
- Assistant turn with tool call: ~200-500 bytes (reasoning + tool use block)
- Tool result: 100-10,000 bytes (depends on file size)
- After pruning (old turns): 200-500 bytes (reasoning kept, result replaced with descriptor)

**Total estimate for a 50-iteration dev agent conversation:**
- Raw (no compaction): ~150KB (average 3KB per iteration with file contents)
- After Phase 1 pruning: ~40KB (keep 20 recent messages raw, prune older tool results)
- After Phase 2 summary: ~25KB (oldest section replaced with structured summary)

### 6.3 Mitigation: LZ4 Compression (Optional)

PostgreSQL's default TOAST compression is pglz (moderate compression, moderate speed). For better compression on JSONB:

- **pglz (default):** ~40% compression ratio on JSON. No configuration needed.
- **lz4 (Postgres 14+):** Faster compression/decompression, similar ratio. Set with `ALTER TABLE ... ALTER COLUMN ... SET COMPRESSION lz4`.

Aesir uses Postgres 15 (from `docker-compose.yml`: `postgres:15-alpine`), so lz4 is available.

**Recommendation:** Use default pglz for v2.3 launch. Monitor TOAST sizes via `pg_column_size()`. Switch to lz4 if write latency becomes an issue. This is a DBA-level change, not a code change.

---

## 7. Migration Sequence: Temporal to Custom Orchestration

### 7.1 Drain Strategy

Temporal workflows in Aesir are short-lived relative to most Temporal deployments:

| Workflow | Typical Duration | Max Duration |
|----------|-----------------|--------------|
| Dev agent (with approval) | 1-72 hours | 7 days (feedback timeout) |
| Dev agent (autonomous) | 5-30 minutes | 45 minutes (activity timeout) |
| Product agent | 5-60 minutes | 24 hours (conversation timeout) |

**Drain approach:**
1. Stop routing NEW events to Temporal workflows (redirect to v2.3 executor)
2. Let existing workflows complete naturally (max 7 days)
3. After drain period, verify no running workflows via Temporal UI
4. Remove Temporal infrastructure

**This is straightforward because:**
- No long-running workflows (everything completes within 7 days)
- No workflow dependencies (workflows don't spawn other workflows)
- Feature flag on the event router: `USE_V23_EXECUTOR=true` switches all new events

### 7.2 Gotchas

| Gotcha | Impact | Mitigation |
|--------|--------|------------|
| In-flight workflows during cutover | Existing workflows need Temporal to complete | Keep Temporal running for drain period (7 days) |
| Temporal DB shares PostgreSQL | Temporal's `temporal` database shares the same Postgres instance | Temporal stores data in its own schemas; dropping Temporal services doesn't affect Aesir schemas |
| Signal handlers registered at workflow start | Can't change signal routing mid-workflow | Only affects draining workflows; new conversations use executor |
| Temporal worker shutdown | Must gracefully finish current activity before stopping | Docker Compose `stop_grace_period: 60s` gives activity time to complete |
| Database migration timing | Old tables must exist for drain period, new tables for v2.3 | Create new tables first, drop old tables after drain completes |

### 7.3 Phase Sequence

```
Phase A: Build framework (parallel with v2.2 running)
  - All new code in src/framework/ and definitions/
  - New DB tables created alongside old ones
  - Nothing breaks, nothing changes for v2.2

Phase B: Wire and validate
  - Build single main.ts that can run alongside old services
  - Integration test: start -> pause -> signal -> resume
  - Smoke test with real LLM calls

Phase C: Cut over
  - Set USE_V23_EXECUTOR=true
  - New events go through v2.3 executor
  - Monitor both systems during drain period
  - After 7 days: verify Temporal is empty

Phase D: Clean up
  - Remove Temporal services from Docker Compose
  - Remove @temporalio/* from package.json
  - Delete packages/agents/src/shared/temporal/
  - Delete per-agent main.ts and worker.ts
  - Drop old DB tables (tasks, context_snapshots, execution_traces)
  - Update CLAUDE.md
```

**Effort estimates per phase:**

| Phase | Duration | Risk | Blockers |
|-------|----------|------|----------|
| A: Build | 3-5 days | LOW | None -- greenfield |
| B: Wire | 2-3 days | MEDIUM | Integration testing requires all services running |
| C: Cut over | 1 day + 7-day drain | LOW | Just a flag flip |
| D: Clean up | 1-2 days | LOW | Mechanical deletion |

---

## 8. Data Flow: Full Pause/Resume Cycle

### 8.1 Complete Trace: Webhook to wait_for to Resume

```
PHASE 1: Initial Start
=======================

1. Linear webhook fires (issue.agent_session.created)
   -> POST /events on agent-service:3004

2. Adapter normalizes:
   IncomingEvent { type: "linear.agent_session.created", correlationKey: "{issueId}", ... }

3. EventRouter checks start rules:
   - dev-agent definition has trigger: { event: "linear.agent_session.created" }
   - Construct conversation ID: "dev-agent-{issueId}"

4. executor.start({
     agentDefinitionId: "dev-agent",
     conversationId: "dev-agent-{issueId}",
     message: "Resolve Linear issue AES-42: 'Add /healthz endpoint'",
   })

5. Executor creates conversation record:
   INSERT INTO conversations (id, status, messages, ...)
   VALUES ("dev-agent-{issueId}", "queued", '[{"role":"user","content":"..."}]', ...)

6. Executor appends event:
   EventLog.append({ type: "agent.started", conversationId: "dev-agent-{issueId}" })

7. HTTP handler returns 200 to webhook (non-blocking)

PHASE 2: Agent Execution
=========================

8. Worker polling loop picks up queued conversation:
   SELECT ... FROM conversations WHERE status = 'queued' FOR UPDATE SKIP LOCKED

9. Worker updates: status = "running", last_heartbeat_at = NOW()

10. Worker loads AgentDefinition from registry:
    registry.get("dev-agent", "1")

11. Worker resolves tools:
    toolRegistry.resolve(definition.tools, { containerManager, agentId, ... })

12. Worker calls runAgentLoop({
      systemPrompt: definition.systemPrompt,
      tools: resolvedTools,
      messages: conversation.messages,  // <-- NEW: pre-populated history
      maxIterations: definition.maxIterations,
      tokenBudget: ...,
      onToolCall: (call) => eventLog.append({ type: "tool.called", ... }),
    })

13. Agent loop runs:
    - LLM reasons, calls tools
    - EventLog records tool.called / tool.succeeded events
    - Session projection updates reactively (artifacts)
    - Heartbeat fires every 30s (onHeartbeat callback)

PHASE 3: Pause via wait_for
=============================

14. Agent decides it needs approval:
    LLM returns: tool_use { name: "wait_for", input: { type: "approval", reason: "..." } }

15. Framework intercepts wait_for:
    a. Returns tool_result to conversation: "Conversation paused. Waiting for: approval"
    b. Sets exit flag

16. Agent loop exits (returns AgentLoopResult)

17. Executor persists:
    UPDATE conversations
    SET status = 'paused',
        messages = $fullHistory,  -- includes wait_for call + result
        pending_wait = '{"type":"approval","metadata":{...}}',
        updated_at = NOW()
    WHERE id = "dev-agent-{issueId}"

18. EventLog.append({ type: "agent.paused", ... })
19. EventLog.flush()  -- guarantee events are persisted

PHASE 4: Signal Arrives (hours/days later)
==========================================

20. Slack webhook fires (block_actions.approve button click)
    -> POST /events on agent-service:3004

21. Adapter normalizes:
    IncomingEvent {
      type: "approval",
      data: { approved: true, feedback: "Looks good" },
      correlationKey: "{issueId}",
      message: "Plan approved by John Smith. Feedback: 'Looks good.'"
    }

22. EventRouter resolves:
    - Construct conversation ID: "dev-agent-{issueId}"
    - Load conversation: status = "paused", pendingWait.type = "approval"
    - Signal type "approval" matches pendingWait.type

23. executor.signal("dev-agent-{issueId}", {
      type: "approval",
      data: { approved: true, feedback: "Looks good" },
    })

24. Executor updates conversation:
    UPDATE conversations
    SET status = 'queued',
        messages = messages || '[{"role":"user","content":"Plan approved by..."}]',
        pending_wait = NULL,
        updated_at = NOW()
    WHERE id = "dev-agent-{issueId}"

25. EventLog.append({ type: "signal.received", ... })
26. EventLog.append({ type: "agent.resumed", ... })

27. HTTP handler returns 200 to webhook

PHASE 5: Resumed Execution
===========================

28. Worker polling loop picks up queued conversation (same as step 8)

29. Worker applies history compaction if needed (definition.history config)

30. runAgentLoop({ messages: compactedHistory })
    - Agent sees EVERYTHING: prior research, plan, wait_for, approval message
    - Continues naturally from where it left off

31. Agent completes (no more wait_for calls, final text output)

32. Executor updates:
    UPDATE conversations SET status = 'completed', messages = $final, updated_at = NOW()

33. EventLog.append({ type: "agent.completed", ... })
```

### 8.2 Failure Points in the Flow

| Step | Failure | Consequence | Recovery |
|------|---------|-------------|----------|
| 5 | DB write fails | Conversation never created | Webhook retry delivers same event; executor.start() idempotent |
| 9 | Worker crashes after claiming | Conversation stuck in "running" | Heartbeat sweep re-enqueues after 5 min |
| 16 | Agent loop errors (LLM failure) | Conversation in "running" with partial trace | Heartbeat sweep re-enqueues; agent loop has retry-backoff |
| 17 | DB write fails on pause | Conversation state lost | Agent loop must re-run from last persisted state |
| 24 | DB write fails on signal | Signal not delivered | Webhook retry re-delivers signal |
| 29 | History compaction fails | Conversation too large for context window | Fallback: aggressive pruning or error with escalation |

### 8.3 Signal Queueing: Race Condition Fix

The product agent currently has a retry-with-backoff hack for signals that arrive before the workflow starts. The `orchestrator-workflow.ts` also has timing-sensitive signal handling.

v2.3 fixes this structurally:

```
Signal arrives for conversation "product-agent-{threadTs}":
  Case 1: Conversation doesn't exist yet
    -> Router creates conversation via executor.start() with the event as initial message
    -> No signal needed -- the message IS the conversation starter

  Case 2: Conversation exists, status = "running"
    -> Append to queued_signals JSONB column
    -> When agent calls wait_for, executor checks queued_signals BEFORE pausing
    -> If matching signal exists: pop from queue, append as user message, continue running

  Case 3: Conversation exists, status = "paused", matching wait type
    -> Normal resume flow (steps 22-27 above)
```

This eliminates all timing-dependent retries. The signal is either the conversation starter, queued for later, or delivered immediately.

---

## 9. Suggested Build Order

Based on dependency analysis and risk mitigation:

### Phase A: Framework Core (no existing code changes)

| Step | Component | Dependencies | Effort | Risk |
|------|-----------|-------------|--------|------|
| A1 | DB schema + migrations | None | 0.5 day | LOW |
| A2 | EventLog (append, query, flush) | A1 | 1 day | LOW |
| A3 | SessionProjection | A1, A2 | 0.5 day | LOW |
| A4 | AgentRegistry + definition loading | None | 1 day | LOW |
| A5 | ToolRegistry (factory registration, resolve) | None | 0.5 day | LOW |
| A6 | HistoryManager (pruning + summarization) | None | 1.5 days | MEDIUM |
| A7 | ConversationExecutor (start, signal, cancel, worker loop) | A1-A5 | 2 days | MEDIUM |
| A8 | wait_for tool | A7 | 0.5 day | LOW |

**Critical path:** A1 -> A2 -> A7. Everything else can be built in parallel.

### Phase B: Integration (wiring to existing infrastructure)

| Step | Component | Dependencies | Effort | Risk |
|------|-----------|-------------|--------|------|
| B1 | Agent definition files (YAML + prompt.md) | A4 | 1 day | LOW |
| B2 | Event adapters (Slack, GitHub, Linear) | None | 1 day | LOW |
| B3 | Event router (adapted from current router module) | A4, A7 | 1.5 days | MEDIUM |
| B4 | Single main.ts service | A1-A8, B1-B3 | 1 day | LOW |
| B5 | Integration tests (start -> pause -> signal -> resume) | B4 | 1 day | MEDIUM |

### Phase C: Cut Over

| Step | Action | Dependencies | Effort | Risk |
|------|--------|-------------|--------|------|
| C1 | Feature flag: new events -> v2.3 executor | B5 passing | 0.5 day | LOW |
| C2 | Drain Temporal workflows (monitor for 7 days) | C1 | 0 (calendar time) | LOW |
| C3 | Smoke test: full dev-agent + product-agent flows | C1 | 1 day | MEDIUM |

### Phase D: Cleanup

| Step | Action | Dependencies | Effort | Risk |
|------|--------|-------------|--------|------|
| D1 | Delete Temporal code (shared/temporal/) | C2 verified empty | 0.5 day | LOW |
| D2 | Delete per-agent services (main.ts, worker.ts, api/) | D1 | 0.5 day | LOW |
| D3 | Remove @temporalio/* from package.json | D1, D2 | 0.5 day | LOW |
| D4 | Drop old DB tables, update Docker Compose | D1-D3 | 0.5 day | LOW |

**Total estimated effort:** 15-18 days of development + 7 days drain period.

---

## 10. Component Interface Summary

### New Components

| Component | Interface | Creates | Consumes |
|-----------|-----------|---------|----------|
| `ConversationExecutor` | start(), signal(), get(), cancel(), list(), close() | Conversations, events | AgentRegistry, ToolRegistry, EventLog |
| `EventLog` | append(), query(), subscribe(), flush(), close() | agent_events rows | DB connection |
| `SessionProjection` | get(), list() | agent_sessions rows | EventLog subscription |
| `AgentRegistry` | get(), list() | In-memory cache | Definition files (YAML + MD) |
| `ToolRegistry` | register(), resolve() | ToolDefinition arrays | Tool factory functions |
| `EventRouter` | handle() | RouteResult | AgentRegistry (triggers), ConversationExecutor |
| `HistoryManager` | compact() | Compacted message array | AgentDefinition.history config |
| Event Adapters (x3) | transform() | IncomingEvent | Raw webhook payloads |

### Modified Components

| Component | Current | Change |
|-----------|---------|--------|
| `runAgentLoop()` | Accepts `initialMessage` + `context` | Add optional `messages` parameter for pre-populated history |
| `spawn_agent` tool | Inline sub-agent configs | Uses AgentRegistry + ToolRegistry to resolve sub-agent definitions |
| Smart router module | Uses `workflowClient` (Temporal) | Uses `ConversationExecutor` instead |
| Docker Compose | 10 services | 5 services (remove Temporal, consolidate agents) |

### Unchanged Components

| Component | Why Unchanged |
|-----------|---------------|
| `runAgentLoop()` (core loop) | The agent loop runtime is the foundation; only the entry point changes |
| All tool implementations | Tools are execution logic; their definitions move to ToolRegistry but implementations stay |
| MCP client (`callMcpTool`) | Integration communication protocol unchanged |
| Integration packages (x3) | Independent services, no Temporal dependency |
| DevContainerManager | Container lifecycle management unchanged |
| Platform package | Config, logging, DB connection unchanged |

---

## 11. Performance Implications

### 11.1 Expected Load Profile

Based on current system metrics (from `cost-tracking.ts` comments and Temporal workflow observations):

| Metric | Current (v2.2) | Expected (v2.3) | Change |
|--------|----------------|------------------|--------|
| Concurrent conversations | 1-5 | 1-5 | Same |
| Events per conversation | 100-500 | 100-500 | Same (event log replaces traces) |
| Conversation persistence writes | 3-5 per task (activity boundaries) | 2 per task (pause + complete) | Fewer writes |
| Signal routing latency | 100-500ms (Temporal scheduling) | <50ms (direct DB update + poll) | Faster |
| Agent loop startup | 200ms (Temporal activity scheduling) | <10ms (in-process) | Much faster |

### 11.2 Bottleneck Analysis

| Operation | Current Bottleneck | v2.3 Bottleneck | Assessment |
|-----------|-------------------|-----------------|------------|
| Webhook -> agent start | Temporal workflow scheduling (100-500ms) | DB insert + poll interval (30s worst case) | Trade-off: higher worst-case latency, but simpler |
| Signal delivery | Temporal signal + condition wake (100ms) | DB update + poll interval (30s worst case) | Worse worst-case; mitigate with LISTEN/NOTIFY later |
| Agent resume | Fresh agent loop + context summary read | Full history load from JSONB | Better (richer context), but larger payload |
| Event recording | Buffered batch INSERT (current pattern) | Same pattern (unchanged) | Same |

**The 30-second polling interval** is the main performance regression. Temporal's signal delivery is near-instant; polling adds up to 30 seconds of latency. For Aesir's use case (approval responses take minutes to hours), this is acceptable. For more time-sensitive use cases, LISTEN/NOTIFY can be added later.

**Recommendation:** Start with 5-second polling interval for the worker loop (not 30 seconds). This gives responsive signal delivery (5s worst case) at the cost of slightly more DB queries. At 1 query per 5 seconds, this is ~12 queries/minute -- trivial for Postgres.

### 11.3 Scaling Considerations

| Scale | Approach |
|-------|----------|
| 1-10 concurrent conversations | Single worker, 5s polling. Current setup. |
| 10-50 concurrent conversations | Multiple workers (same process, concurrent loops). `FOR UPDATE SKIP LOCKED` distributes. |
| 50-200 concurrent conversations | Multiple worker processes. Same DB, same pattern. |
| 200+ concurrent conversations | LISTEN/NOTIFY for event-driven wakeup. Consider SQS/EventBridge. |

Aesir is currently at 1-5 concurrent conversations. The Postgres-backed approach is appropriate for 10-100x current scale without architectural changes.

---

## 12. Sources and Confidence Assessment

### Sources Used

| Source | Type | Confidence | Used For |
|--------|------|------------|----------|
| Codebase analysis (orchestrator-workflow.ts, run-agent-loop.ts, schema.ts, task-store.ts, docker-compose.yml, all main.ts files) | Primary | HIGH | Current architecture understanding |
| v2.3 spec (2.3-spec.md, 1712 lines) | Primary | HIGH | Target architecture |
| [DBOS: Postgres for Everything](https://www.dbos.dev/blog/postgres-durable-execution) | Official blog | HIGH | SELECT FOR UPDATE SKIP LOCKED pattern |
| [Armin Ronacher: Absurd Postgres Workflows](https://lucumr.pocoo.org/2024/11/18/absurd-workflows/) | Blog | MEDIUM | Postgres-as-job-queue patterns |
| [PgBoss: Postgres job queue](https://github.com/timgit/pg-boss) | Open source | HIGH | Polling + SKIP LOCKED implementation |
| [Solid Queue (Rails)](https://github.com/rails/solid_queue) | Open source | MEDIUM | Postgres job queue patterns |
| Drizzle ORM documentation | Official | HIGH | LISTEN/NOTIFY gap, batch insert patterns |
| PostgreSQL TOAST documentation | Official | HIGH | JSONB performance characteristics |

### Confidence Assessment

| Area | Confidence | Reason |
|------|-----------|--------|
| ConversationExecutor pattern | HIGH | `FOR UPDATE SKIP LOCKED` is battle-tested across PgBoss, Solid Queue, DBOS |
| Event log design | HIGH | Direct application of existing trace-recorder pattern with fixes for known gaps |
| Single service consolidation | HIGH | Mechanical change -- all services already use same `createServer()` pattern |
| Agent registry | HIGH | Simple file loading + mtime caching, well-established pattern |
| JSONB performance | MEDIUM | Theoretical analysis backed by Postgres documentation, but no load testing on Aesir's actual data |
| Migration sequence | MEDIUM | Drain strategy is sound but depends on no long-running workflows being stuck |
| Polling vs LISTEN/NOTIFY | MEDIUM | Polling is correct for v2.3 scale; LISTEN/NOTIFY gap in Drizzle is a real constraint |

### Open Questions

1. **Worker polling interval:** 5 seconds recommended, but needs tuning based on actual webhook delivery patterns. Too frequent = wasted queries. Too infrequent = noticeable signal delivery latency.

2. **History compaction trigger:** The spec says 80K tokens for pruning threshold. Needs empirical validation with real dev-agent conversations to confirm this is the right threshold.

3. **Conversation cleanup policy:** When should completed conversations be archived? The spec mentions retention but doesn't specify a policy. Without cleanup, the conversations table grows indefinitely.

4. **Multiple workers in single process:** The spec implies a single worker loop, but for resilience, the service should support concurrent conversation processing. Needs a worker pool design (e.g., `Promise.allSettled` with N concurrent workers).

5. **Error escalation path:** When a conversation fails repeatedly (agent loop errors on every attempt), what is the escalation mechanism? Temporal has retry policies with max attempts. The executor needs equivalent logic.
