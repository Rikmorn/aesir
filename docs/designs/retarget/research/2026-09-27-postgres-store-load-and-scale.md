# Postgres as the only stateful component: load, saturation and the escalation ladder

Date: 2026-09-27. External research only; this repository's source was not read. Extends `2026-09-16-scaling-containerised-agents.md` §1 (claimed-loop family), §2 (inbox with a unique delivery id) and §6 (state locality versus operational surface). Where that document said the claimed loop "pays with a full history load on every resume", this one puts numbers on the payment.

**Summary.** At the shapes described here the database load is small: the model in §7 puts the organisation scale (100 agents, thousands of paused conversations) at roughly 200 queries per second and 2.5 MB/s of transcript reads, two to three orders of magnitude under what Postgres queue libraries and DBOS have measured on a single node. What hurts a Postgres-only agent store is not query rate but churn and growth: dead tuples on the rows that claims and heartbeats rewrite, message and event tables growing at about 100 GB a month at that scale, dashboard scans over the log, and the connection count crossing the default 100. The precedents' ladder is consistent and none of them left Postgres for the hot queue below thousands of tasks per second: batch and tune first, add a pooler, partition and drop, push large bodies to object storage, move analytics to a column store.

**Labels.** `[V n]` verified this session from source n. `[S n]` secondary: a search summary, a forum post, or a page I could only partly read. `[I]` inferred by me. Formulas show their inputs; every computed number is `[I]` unless a source is cited.

## 1. What durable-execution and agent platforms use as the store

**Conclusion.** Two camps. Postgres-only engines (DBOS, Hatchet, Windmill, pg-backed queues) get tens of thousands of operations per second from one node by batching and by keeping the claimable set small. Platforms that also serve dashboards over high-volume telemetry (Trigger.dev, Langfuse, LangSmith) all moved that telemetry to ClickHouse and large blobs to object storage; Trigger.dev and Inngest keep the hot queue in Redis. Temporal is the outlier that recommends leaving Postgres altogether at scale, because its persistence is "chatty by design" [V 5].

| Platform | Store | Hot | Cold | Published throughput or sizing | First thing moved off Postgres |
| --- | --- | --- | --- | --- | --- |
| Temporal | Cassandra, MySQL or PostgreSQL; Elasticsearch for visibility [V 1] | Mutable state per history shard, task queues | Event history | `numHistoryShards` "is immutable and will be ignored after the first run"; set for "worst case peak load" [V 1]. Adding shards "requires a rebuild and a migration" [V 4]. History capped at 51,200 events or 50 MB, warning at 10,240 or 10 MB [V 2][V 3]. Shilkov's load test: 25,000 workflows took 28 min on 1 shard, gains flattened past 8 shards, 32,768 shards evicted the pod for memory [V 6]. Staff: "Many users run with PostgreSQL in production" but "there is a limit to how far you can scale on a single DB server"; Cassandra "is still the most scalable option" (2022, 2025) [V 5] | Everything: Quo hit "the single-writer wall" on Aurora ("Persistence latency would creep up under bursts. Vacuum would fall behind") and moved to Cassandra [V 8]; PlanetScale sharded Temporal on Vitess/MySQL at 40k to 200k QPS [V 7] |
| Inngest | Postgres plus Redis; single binary defaults to SQLite plus in-memory Redis [V 11] | Queue, flow control and "incremental function run state" in Redis [V 11] | Apps, functions, events, run results, step outputs in Postgres [V 11] | "each Inngest server only runs `100` queue workers"; "Large table growth can hurt performance for loading or searching runs or events" [V 11] | Queue was never in Postgres |
| Trigger.dev | Postgres, Redis, ClickHouse, MinIO, s2-lite [V 13] | Run queue in Redis since v4 [V 14]; realtime streams | Runs in Postgres; logs and spans in ClickHouse [V 15] | Webapp machine "3+ vCPU, 6+ GB RAM" [V 13]; ClickHouse "scales to much higher volumes" [V 13] | Queues to Redis (Apr 2025): "much faster with higher throughput ... mainly because we moved our internal queues from Postgres to Redis" [V 14]; then logs to ClickHouse (Oct 2025) because the table "kept growing" and indexing every attribute path was impractical [V 15][V 16] |
| DBOS | Postgres only ("system database") [V 17] | Queue state, workflow status | Step checkpoints | "one database write per step ... plus two additional database writes per workflow" [V 17]. 144K writes/s and 43K workflows/s on `db.m7i.24xlarge` (96 vCPU, 384 GB, 120K IOPS); 12.1K queued workflows/s on one queue, 30.6K partitioned [V 18]. Beyond that, "sharding workflows across multiple Postgres databases" [V 17] | Nothing; CockroachDB is offered for multi-region, at ~117 wf/s on 3 nodes versus ~122 on one Postgres [V 20] |
| Hatchet | Postgres only after removing RabbitMQ [V 25] | Task queue tables | Task history | ">20k tasks per minute (>1 billion per month)", bursts "over 5k tasks/second, which corresponds to roughly 25k transactions/second" on "the largest instance type that CloudSQL offers" [V 25]. Earlier design: "500 to 1k tasks/second" [V 22] | Nothing; went the other way. Fixes were buffering "once every 10ms", identity columns instead of UUIDs, staggered pollers [V 25][V 22] |
| Restate | RocksDB per partition, Bifrost replicated log, S3 snapshots [V 26] | Journals, virtual-object state, timers in RocksDB [V 26] | Snapshots in S3 | Log "is the primary durability layer"; RocksDB state "can always be rebuilt from the log" [V 26] | Not applicable; never used a SQL store |
| Windmill | Postgres queue: "stateless API servers and workers pulling jobs from a Postgres queue" [V 29] | Queue table | Completed jobs | Queue overhead "~50ms" per job [V 29]; on `m4.large`, 40 lightweight tasks: Hatchet 1.2 s, Windmill dedicated 2.1 s, Temporal 3.0 s, Airflow 116 s (2025) [V 27][V 28] | Nothing published |
| LangGraph Platform | Postgres plus Redis [V 30] | Task queue "with 'exactly once' semantics" in Postgres; Redis is "a pub-sub broker" for streaming [V 30] | Threads, runs, checkpoints, long-term memory [V 30] | No sizing published. "Over long conversations, checkpoints accumulate. This can increase latency and storage costs" [V 31] | Nothing |
| LangSmith / Langfuse | Postgres, ClickHouse, Redis, blob storage [V 33][V 34] | Redis queue and cache | Traces in ClickHouse; artifacts in blobs | Langfuse: ingestion p95 "up to 50 seconds" by summer 2023 from IOPS exhaustion; prompt retrieval p95 7 s under ingestion load [V 34] | Traces to ClickHouse, raw events to S3, ingestion behind a Redis queue (Dec 2024) [V 34] |

Anthropic Managed Agents and OpenAI publish no storage design; skipped as instructed.

## 2. Postgres as a job queue: measured throughput and failure modes

**Conclusion.** A `SKIP LOCKED` queue on one commodity node does 10k to 50k jobs per second when claims are batched, and a few hundred to a few thousand when each job is its own round-trip. The documented failure modes are all about churn, not throughput: dead tuples in the claim path, an O(n) claim query, synchronised pollers, one global lock at every `NOTIFY` commit, and connection count.

| Library | Claim mechanism | Wake | Published number | Notable design choice |
| --- | --- | --- | --- | --- |
| Graphile Worker | `SKIP LOCKED` [V 36] | `LISTEN/NOTIFY` [V 36] | ~15,600 jobs/s unbatched, ~184,000 batched, avg latency 4.2 ms; i9-14900K with the DB local [V 35] | Local queue of 500 per worker; batching is an 11× gain [V 35] |
| River (Go) | `SKIP LOCKED`, "batch selects and updates" [V 38] | `NOTIFY` for "sub-millisecond" wake [V 38] | ~46k jobs/s with 2,000 goroutines on an M2 MacBook Air [V 37]; ~10k/s in 2023 [V 38] | Bulk insert via `COPY FROM` [V 38] |
| pgmq | Visibility timeout; "exactly once delivery ... within a visibility timeout" [V 42] | Poll | 16 vCPU/30 GB: 150k writes/s and 30k reads/s at 22-byte messages in batches of 100; 1 KB single messages: 10k writes/s with 50 writers, 7.6k reads/s with 100 readers; 1 vCPU/4 GB: "thousands" [S 43] | `shared_buffers` at 60 percent, "aggressive vacuuming" [S 43]; archive tables; pg_partman option [V 42] |
| Oban (Elixir) | Fetch per queue with a 5 ms dispatch cooldown; jobs/s ≈ `(1000 / cooldown) * limit` [V 44] | Postgres PubSub or Erlang PG [V 44] | Not published | Stager runs every 1,000 ms [V 44] |
| Solid Queue (Rails 8) | `FOR UPDATE SKIP LOCKED` [V 40] | Poll: workers 0.1 s, dispatchers 1 s [V 40] | HEY: "about 20 million jobs per day, using 800 workers", MySQL at 32 CPUs/64 GB with two replicas (2024) [V 41] | Separate `ready`, `scheduled`, `claimed`, `failed` tables; concurrency controls "introduce significant overhead" [V 40] |
| pg-boss (Node) | `SKIP LOCKED` [V 46] | Poll | Not published | v10: each queue is "a child table in a partitioning hierarchy"; `maintain()`; `priority:false` for large queues [V 46] |
| Que (Ruby) | Advisory locks, "held in memory" [V 45] | Poll | Not published; "bottleneck is CPU, not I/O" [V 45] | Warns bloat comes from long transactions [V 45] |
| Procrastinate (Python) | `SELECT FOR UPDATE` [V 47] | `LISTEN` plus fallback poll [V 47] | Regression benchmarks only [V 47] | Pool must hold one connection per concurrent job plus one for `LISTEN` [V 47] |
| Cross-library harness | Public-API adapters on `postgres:18.3`, 4 CPUs | | pgque 39.9k, awa 14.2k, pgmq 11.3k, pg-boss 2.4k, river 501, oban 284, procrastinate 269 jobs/s [V 48] | Default settings only; River's own figure is 46k, so treat as "out of the box on 4 CPUs" [I]. pgmq "anti-scales past 16 workers" [V 48] |

Failure modes and what the libraries do:

- **Dead tuples and long transactions.** Brandur's 2015 incident: a long transaction pinned 247,311 dead rows; lock time rose from under 0.01 s to over 0.1 s; a 60,000-job backlog "evaporates in the blink of an eye" once the transaction was killed [V 39]. Que's README repeats the lesson: keep every transaction on that database short [V 45]. Tembo runs aggressive autovacuum on queue stacks [S 43]. Autovacuum defaults are a 0.2 scale factor plus 50 tuples, 1 min naptime and 3 workers; scale factor and threshold are settable per table [V 55].
- **The hot head of the queue.** Hatchet's first design ranked queued rows with a window function: 159 ms at 10,000 queued, and at 25,000 a worker "stopped receiving tasks entirely" because the claim took longer than its 333 ms poll [V 22]. Fix: compute order at write time so the claim is near constant time [V 22]. `SKIP LOCKED` itself is documented as the tool "to avoid lock contention with multiple consumers accessing a queue-like table" and gives "an inconsistent view of the data" [V 52].
- **Thundering herd.** "(1) many tasks in the backlog, (2) many workers, (3) workers long-polling the task tables at approximately the same time" produced a CPU spiral at ~25k tx/s; jittered start and 10 ms write buffering fixed it [V 25][V 22].
- **Index bloat.** Hatchet moved high-volume tables to identity columns because UUID keys "caused some headaches ... trying to delete batches of data and prevent index bloat" [V 25]. Brandur credits B-tree deduplication (v13) and `REINDEX CONCURRENTLY` (v12) with making Postgres queues healthier than in 2015 [V 38].
- **`LISTEN/NOTIFY`'s global lock.** A `NOTIFY` in a transaction takes "AccessExclusiveLock on object 0 of class 1262 of database 0" at commit, serialising all commits; Recall.ai traced three outages in March 2025 to it with "tens of thousands of simultaneous writers" and removed it in a day [V 49]. DBOS measured a naive one-NOTIFY-per-write stream at 2.9K writes/s and 60K/s after buffering notifications into batch transactions, with a fallback poll for lost notifications [V 19]. The docs add: the queue is 8 GB, "transactions calling `NOTIFY` will fail at commit" when full, payloads under 8000 bytes, and a long transaction on a listening session blocks cleanup [V 51]. The "Optimize LISTEN/NOTIFY" patch was withdrawn from the PG19 commitfest on 2025-08-07 [V 50]; a search summary claimed it landed in PG19, which the commitfest page contradicts, so do not plan on a core fix [S 50].
- **Connections.** `max_connections` defaults to 100 and sizes shared memory [V 60]; a backend starts "at around 5 MB" and grows [V 62]; cloud tiers cap at 500 or as low as 20 to 25 [V 62]. Cybertec's ceiling: `min(num_cores, parallel_io_limit) / (session_busy_ratio × avg_parallelism)` [V 63]. PgBouncer transaction pooling (default pool 20, `max_client_conn` 100) forbids "any session-based features" [V 64], which includes `LISTEN` [I]; Hatchet says external poolers "are great" and warns of "connection storms" [V 24].
- **Poll interval versus latency.** Solid Queue polls at 0.1 s [V 40], Oban stages every 1 s with notify on top [V 44], Graphile and River use `NOTIFY` to reach millisecond wake and keep a poll as fallback [V 36][V 38]. The claim must finish well inside the interval or pollers pile up [V 22].

## 3. Transcript storage

**Conclusion.** A live transcript is bounded by the context window, so the reload-on-resume cost is bounded too: about 0.7 MB at 200K tokens and 3.5 MB at 1M tokens. The on-disk history of a coding agent is much larger than its live context and is dominated by tool output and envelope, not by conversation. Store one row per message with `JSONB` payloads, push large tool results to object storage, and keep the live window bounded by compaction; do not store one document per conversation and rewrite it on every append.

Size in practice:

- Claude tokens "approximately" equal "3.5 English characters" [V 68]; current models carry a 1M-token window (Haiku 4.5: 200K) and 128K output [S 69]. So 200K tokens ≈ 700 KB and 1M ≈ 3.5 MB of UTF-8 text; code and JSON tokenise denser, so bytes per token are nearer 3 [I].
- Claude Code session files on disk are a proxy for uncompacted history: one corpus of 875 files totalled 1.6 GB, median 304 KB, p90 644 KB, largest 586 MB, and "Growth is driven by tool output, not by how much you typed" [V 72]. Another: 423 MB over 732 transcripts, ~13 MB/day, gzip 2.8× [V 71]. A dissected 70 MB session was ~54 percent JSON envelope, ~25 percent tool results, ~12 percent base64 images, ~4 percent thinking and ~3 percent conversation text [V 70]. That 70 MB exceeds any context window, so on-disk history and live context are different quantities; the live window stays bounded by compaction [I].

Storage options and their limits:

| Option | Mechanics | Cost on append | Cost on load | Verdict |
| --- | --- | --- | --- | --- |
| One row per message, `JSONB` payload | Values over ~2 kB are compressed or moved to TOAST chunks of ~2000 bytes; field limit 1 GB [V 53] | One small insert; large tool results land in TOAST | Index range scan on `(conversation_id, seq)` plus TOAST fetches [I] | Default choice [I] |
| One `JSONB` document per conversation | Same TOAST rules | MVCC writes a new tuple version of the whole document, so a 1 MB transcript appended 20 times per turn writes ~20 MB and leaves 20 dead 1 MB versions for vacuum [I] | One fetch | Avoid past a few hundred KB [I] |
| `bytea` compressed blob | Same TOAST rules; app-level gzip at ~2.8× [V 71] | Whole-blob rewrite | One fetch plus decompress | Only for archived, immutable history [I] |
| Object storage with a Postgres pointer | S3 holds bodies; Postgres holds ids, sizes, offsets | Two writes, ordering to manage | One GET per body | What Langfuse (raw events to S3), LangSmith (blob storage for artifacts) and Trigger.dev (MinIO "for large payloads and outputs") do [V 34][V 33][V 13] |

The LangGraph Postgres checkpointer is the reference shape for "full state every step": `checkpoints` holds `JSONB` metadata, `checkpoint_blobs` holds `BYTEA` keyed by `(thread_id, checkpoint_ns, channel, version)` so an unchanged channel is not rewritten, and `checkpoint_writes` holds pending writes [V 32]. Its docs still warn that checkpoints "accumulate" and recommend pruning [V 31].

When reload-on-resume becomes the bottleneck. Read volume is `R = A × S` per minute for A turns per minute at S bytes; if the loop reloads per iteration instead of per claim it is `A × I × S`. At A = 150/min and S = 1 MB, R = 150 MB/min = 2.5 MB/s, well inside one node's read bandwidth and inside `shared_buffers` if the hot set is cached [I]. The real cost is per-turn latency (decode of a megabyte of JSON) and buffer churn from p99 transcripts near 3.5 MB [I]. Compaction is the lever: it bounds S, and it lets archived messages leave the hot table for cold storage [I]. §7 tabulates R at three scales.

## 4. The append-only event log

**Conclusion.** Insert throughput is not the constraint at these scales; growth and retention are. Partition by time with `pg_partman`, keep indexes minimal, insert in batches, and drop partitions instead of deleting rows. Move the log to a column store when the dashboard's aggregations, not the writers, dominate the database.

- **Single-node insert rates.** Hatchet on an M3 Max: 2,284 rows/s single-connection single inserts, 16,654 with 20 connections, 79,927 with buffered 100-row batches, 92,133 with continuous `COPY`, at a latency cost of ~18 ms per buffered write [V 23]. Citus in 2017: 1,075 single inserts/s, ~3k batched, over 10k with `COPY` on a small instance [V 66]. DBOS: 144K writes/s on 96 vCPU [V 18]. The docs: `COPY` "is almost always faster than using `INSERT`" and one transaction per batch [V 59].
- **`synchronous_commit = off`** returns success before the WAL reaches disk; the risk window is "three times `wal_writer_delay`" [V 58]. On NVMe a 2026 measurement found it "gives at most 15%, not 10x" [V 67]. Batching, not durability, is the lever [I].
- **Write amplification.** Every index adds an index write per insert and blocks HOT updates on the indexed columns [V 54]. Trigger.dev left Postgres for spans precisely because indexing "every possible attribute path wasn't feasible" [S 15][V 16]. Keep the log's indexes to `(conversation_id, seq)` and the partition key; never index into the payload [I].
- **Partitioning and retention.** `DROP TABLE` or `DETACH PARTITION` "is far faster than a bulk operation" and avoids the vacuum cost of `DELETE`; the planner handles "up to a few thousand partitions fairly well" if queries prune [V 56]. `pg_partman` premakes time partitions and drops or detaches by retention with a background worker, on PostgreSQL 14+ [V 57]. pgmq offers pg_partman-backed queues; pg-boss v10 partitions per queue [V 42][V 46].
- **Buffered append versus per-event insert.** Hatchet's 10 ms flush and ~10× batching gain [V 25][V 24]; Graphile's 11× [V 35]; DBOS's 20× on notification batching [V 19]. The cost is up to one flush interval of latency and a small window of unflushed events on crash, which a durable inbox already covers [I].
- **When the log leaves Postgres.** Langfuse: IOPS exhaustion and 50 s ingestion p95 (2023), moved Dec 2024 [V 34]. Trigger.dev: table "kept growing", "counting rows ... became hard", analytics "could threaten the operational stability", moved Oct 2025 with 200 ms p95 on tens of thousands of rows in ClickHouse [V 16][V 15]. Both moved the analytical read path, not the transactional writes [V 34][V 16].

## 5. Connection and poller arithmetic

**Formulas [I].** For N replicas polling every T seconds, C concurrent claims heartbeating every H seconds, K KEDA `ScaledObject`s on a 30 s interval [V 65], A turns per minute each issuing Q_t queries, and W inbound webhooks per minute each issuing two statements:

```
QPS_poll  = N / T                 (zero while scaled to zero)
QPS_hb    = C / H,  C = A × D / 60   (D = seconds a claim is held)
QPS_keda  = K / 30
QPS_turn  = A × Q_t / 60,  Q_t = 3 + 2I + E_t / B
QPS_inbox = 2W / 60
Connections ≈ N × pool + dashboard pool + K + housekeeping
```

Q_t counts one claim, one transcript load, one release, two message rows per iteration (I iterations), and E_t events written in batches of B. §7 uses I = 10, E_t = 30, B = 1 or 10.

- **Connection cost.** ~5 MB per backend at start [V 62]; `max_connections` default 100 with three reserved [V 60]; scale factor from `work_mem` per sort per connection [V 63]. Andres Freund's 2020 study of idle-connection cost and snapshot scalability (fixed in part in PG14) is the canonical source; I could not fetch it this session, so no numbers from it here [S 74].
- **Where a pooler becomes mandatory.** When `N × pool` approaches half of `max_connections`, or when replicas scale from zero in bursts and produce connection storms [V 24][I]. Transaction pooling breaks `LISTEN`, so the wake channel needs one direct connection per replica outside the pooler [V 64][I].
- **What a wake channel buys.** With `NOTIFY`, polling drops to a fallback interval (Procrastinate, Graphile, River, Oban all keep the fallback) [V 47][V 36][V 38][V 44]; the cost is a pinned session per listener and the commit-time global lock, which at hundreds of notifying commits per second is invisible and at thousands is not [V 49][V 19]. A single `NOTIFY` per flushed batch, not per event, is the DBOS pattern [V 19].
- **Published poller counts.** Temporal's TypeScript worker defaults to `min(10, maxConcurrentWorkflowTaskExecutions)` workflow pollers and the same for activities, with 40 and 100 concurrent executions and a 10 s sticky timeout [V 9]; polls are 60 s long polls against the frontend, not the database [S 10]. Inngest runs 100 queue workers per server [V 11]. Solid Queue at HEY: 800 workers on 74 VMs against one MySQL primary [V 41].

## 6. The escalation ladder

**Conclusion.** Every step below has a named precedent and a measurable trigger. The first four keep Postgres as the only stateful component; the fifth adds object storage, which the memory model in the earlier document already assumed; steps six to eight are the point where §6 of that document's "state locality versus operational surface" tradeoff flips.

| Step | Trigger (symptom) | Operating cost | Precedent |
| --- | --- | --- | --- |
| 1. Tune: partial index on claimable rows, narrow lease table, `fillfactor` for HOT heartbeats, per-table autovacuum, batch event inserts | Claim p95 approaching the poll interval; `n_dead_tup` climbing on the claim table; an autovacuum "running for more than ~1 hour" [V 24] | None beyond a migration | Hatchet's write-time ordering and 10 ms buffer [V 22][V 25]; Solid Queue's separate `claimed_executions` [V 40]; HOT rules [V 54] |
| 2. Pooler (PgBouncer or PgCat, transaction mode) | Connections past ~50 percent of `max_connections`; storms on scale-from-zero | One stateless process; `LISTEN` needs a bypass | Hatchet [V 24]; 37signals runs the queue in its own database [V 41] |
| 3. Read replica for the dashboard | Dashboard queries at the top of `pg_stat_statements` by total time | Replication lag; `hot_standby_feedback` "may result in undesirable table bloat" on the primary [V 61] | 37signals: primary plus two replicas [V 41] |
| 4. Partition the event log and inbox; retention by drop | Log past tens of GB; `DELETE`-based retention causing vacuum storms | `pg_partman` and a retention policy | pgmq, pg-boss v10 [V 42][V 46]; docs [V 56] |
| 4b. Analytics to a column store | Aggregations over the log threaten OLTP; per-attribute indexes infeasible | ClickHouse cluster plus a Redis or queue hop | Langfuse Dec 2024 [V 34]; Trigger.dev Oct 2025 [V 15][V 16]; LangSmith [V 33] |
| 5. Transcript bodies and large tool results to object storage | Database size dominated by TOAST; backup and restore times; p99 transcript loads slow | Two-phase writes; lifecycle rules | Langfuse S3, LangSmith blobs, Trigger.dev MinIO [V 34][V 33][V 13] |
| 6. Hot queue to a dedicated component (Redis Streams, NATS JetStream) or a queue library that stays on Postgres | Thousands of tasks/s; thundering herd despite jitter and batching | A second stateful system; transactional enqueue is lost | Trigger.dev v4 to Redis (Apr 2025) [V 14]; Inngest from day one [V 11]; Hatchet stayed and removed RabbitMQ [V 25] |
| 7. Shard or distributed SQL (Citus, CockroachDB, Yugabyte) | The single-writer wall: latency creeping under bursts, vacuum falling behind at peak [V 8] | Cross-shard queries, coordinator, ops | PlanetScale/Vitess for Temporal at 200k QPS [V 7]; Quo to Cassandra [V 8]; DBOS on CockroachDB gains only past 3 nodes [V 20]; Citus targets multi-tenant and time-series [V 73] |
| 8. Durable-execution engine | You are re-implementing journals, replay and signals | Per the earlier document §1(c) | Temporal, Restate, DBOS [V 26][V 17] |

## 7. A capacity estimate the operator can check

**Assumptions [I]**, shared by all three scales: I = 10 loop iterations per turn; E_t = 30 events per turn (3 per iteration); average message 3 KB, average event 1 KB, so 90 KB written per turn; turn held for D = 90 s; heartbeat H = 10 s; poll T = 2 s; one KEDA `ScaledObject`; each replica holds a pool of 10; Q_t = 53 unbatched or 33 with events batched per iteration. Growth uses the average rate; QPS uses the peak. A "turn" is one claim-to-release cycle; a conversation paused for days costs nothing until a signal makes it claimable.

| Input | Single operator | Team | Organisation |
| --- | --- | --- | --- |
| Agents | 5 | 30 | 100 |
| Replicas N (max) | 2 | 6 | 20 |
| Turns per minute, average / peak (A) | 0.5 / 5 | 5 / 30 | 30 / 150 |
| Paused conversations (P) | 20 | 500 | 5,000 |
| Live transcript size (S) | 300 KB | 600 KB | 1 MB |
| Inbound webhooks per minute (W) | 5 | 60 | 300 |
| Dashboard QPS | 1 | 5 | 20 |
| Assumed instance | 2 vCPU, 4 GB | 4 vCPU, 16 GB | 8 vCPU, 32 GB, pooler |

Peak queries per second by kind (formulas in §5):

| Kind | Single operator | Team | Organisation |
| --- | --- | --- | --- |
| Polls `N / T` | 1.0 | 3.0 | 10.0 |
| KEDA `1 / 30` | 0.03 | 0.03 | 0.03 |
| Heartbeats `(A × D / 60) / H` | 7.5 claims → 0.75 | 45 → 4.5 | 225 → 22.5 |
| Turn work `A × 53 / 60` (batched `A × 33 / 60`) | 4.4 (2.8) | 26.5 (16.5) | 132.5 (82.5) |
| Inbox `2W / 60` | 0.2 | 2.0 | 10.0 |
| Dashboard | 1 | 5 | 20 |
| **Total** | **~7.4 (5.8)** | **~41 (31)** | **~195 (145)** |

Transcript reads, growth and connections:

| Measure | Single operator | Team | Organisation |
| --- | --- | --- | --- |
| Read bytes per minute at peak `A × S` | 1.5 MB | 18 MB (0.3 MB/s) | 150 MB (2.5 MB/s) |
| Hot set: concurrent transcripts `C × S` | 2.3 MB | 27 MB | 225 MB |
| All paused transcripts `P × S` | 6 MB | 300 MB | 5 GB |
| Turns per month `A_avg × 43,200` | 21,600 | 216,000 | 1,296,000 |
| Growth per month `turns × 90 KB` (messages / events) | 1.9 GB (1.3 / 0.6) | 19 GB (13 / 6.5) | 117 GB (78 / 39) |
| Growth per year without retention | ~23 GB | ~230 GB | ~1.4 TB |
| Connections `N × 10 + dashboard + 1` | 26 | 71 | 221 |
| Notifying commits per second, one `NOTIFY` per iteration batch `A × I / 60` | 0.8 | 5 | 25 |

Against published limits: the organisation peak of ~195 QPS is under 1 percent of Hatchet's 25k tx/s on the largest CloudSQL [V 25], of pgmq's 10k single-message writes/s on 16 vCPU [S 43], or of Graphile's 15.6k unbatched jobs/s on a desktop [V 35]; Solid Queue's 20M jobs/day is ~230 jobs/s average [V 41]. So query rate is fine on all three instance sizes [I]. The things that are not automatically fine [I]:

- Connections at the organisation scale exceed the default 100 [V 60]; a pooler or a pool of 3 per replica is required (step 2).
- Growth at 117 GB/month means partitioning and retention on events from the start (step 4), and compaction plus cold storage for messages (step 5) inside the first year.
- Heartbeats at 22.5/s produce ~1.9M dead tuples a day on a 5,000-row lease table; the per-table threshold `50 + 0.2 × 5,000 = 1,050` [V 55] triggers autovacuum roughly every minute, which is acceptable only if the heartbeat column is unindexed and the page has room for HOT [V 54]. Keep the lease in its own narrow table.
- The dashboard's 20 QPS are the only analytical reads; if they scan the event log they will be the first thing in `pg_stat_statements` (steps 3, 4b).

What to measure first, to replace each assumption: I and E_t from event counts per turn; S from `pg_column_size` of the live transcript at p50 and p99; D from claim-to-release timestamps; A from claims per minute over a week; message and event sizes from `pg_column_size` histograms; growth from `pg_total_relation_size` sampled weekly; connections from `pg_stat_activity`; QPS by kind from `pg_stat_statements` `calls` deltas; dead tuples from `pg_stat_user_tables.n_dead_tup` on the lease table.

## Sources

Dates are as shown on the page; "n.d." means the page showed none.

1. Temporal, Cluster configuration reference (`numHistoryShards`), n.d. https://docs.temporal.io/references/configuration
2. Temporal, Self-hosted defaults, n.d. https://docs.temporal.io/self-hosted-guide/defaults
3. Temporal, Event history limits, n.d. https://docs.temporal.io/workflow-execution/event
4. Temporal, Production readiness checklist, n.d. https://docs.temporal.io/self-hosted-guide/production-checklist
5. Temporal Community, "PostgreSQL: good option for persistence in production?", 2022-10-08 and 2025-01-22. https://community.temporal.io/t/postgresql-good-option-for-persistence-in-production/6153
6. M. Shilkov, "Choosing the Number of Shards in Temporal History Service", 2021-05-25. https://mikhail.io/2021/05/choose-the-number-of-shards-in-temporal-history-service/
7. PlanetScale, "Temporal workflows at scale: Part 2, Sharding in production", 2022-12-14. https://planetscale.com/blog/temporal-workflows-at-scale-sharding-in-production
8. Quo, "Outgrowing Postgres and Moving to Cassandra", 2026-07-10. https://www.quo.com/blog/postgres-to-cassandra/
9. Temporal TypeScript SDK, `WorkerOptions`, n.d. https://typescript.temporal.io/api/interfaces/worker.WorkerOptions
10. Temporal Community, "Recommended settings for workflow and activity pollers count", 2022-08-08. https://community.temporal.io/t/what-are-the-recommended-settings-for-workflow-and-activity-pollers-count/5617
11. Inngest, Self-hosting, n.d. https://www.inngest.com/docs/self-hosting
12. Trigger.dev, Self-hosting overview, n.d. https://trigger.dev/docs/self-hosting/overview
13. Trigger.dev, Self-hosting with Docker, n.d. https://trigger.dev/docs/self-hosting/docker
14. Trigger.dev, "v4 beta", 2025-04-09. https://trigger.dev/blog/v4-beta-launch
15. Trigger.dev changelog, "Logs moved to ClickHouse", 2025-10-23. https://trigger.dev/changelog/logs-moved-to-clickhouse
16. ClickHouse, "How Trigger.dev is using ClickHouse to scale observability", 2026-07-09. https://clickhouse.com/blog/trigger-dev-scaling-observability
17. DBOS, Architecture, n.d. https://docs.dbos.dev/architecture
18. DBOS, "Benchmarking How Workflow Execution Scales on Postgres", 2026-04-23. https://www.dbos.dev/blog/benchmarking-workflow-execution-scalability-on-postgres
19. DBOS, "Postgres LISTEN/NOTIFY Actually Scales", 2026-07-24. https://www.dbos.dev/blog/postgres-listen-notify-scalability
20. Cockroach Labs, "Embedded Durable Execution with DBOS", 2026-07-08. https://www.cockroachlabs.com/blog/embedded-durable-execution-dbos-cockroachdb/
21. Hatchet, Documentation home, n.d. https://docs.hatchet.run/home
22. Hatchet, "An unfair advantage: multi-tenant queues in Postgres", 2024-04-18. https://hatchet.run/blog/multi-tenant-queues
23. Hatchet, "The fastest Postgres inserts", 2025-05-15. https://hatchet.run/blog/fastest-postgres-inserts
24. Hatchet, "The startup's Postgres survival guide", 2026-07-22. https://hatchet.run/blog/postgres-survival-guide
25. Hacker News, "Show HN: Hatchet v1", 2025. https://news.ycombinator.com/item?id=43572733
26. Restate, Architecture reference, n.d. https://docs.restate.dev/references/architecture
27. Windmill, Benchmark methodology, "last run in 2025". https://www.windmill.dev/docs/misc/benchmarks/competitors
28. Windmill, Benchmark results (Python), n.d. https://www.windmill.dev/docs/misc/benchmarks/competitors/results/python
29. Windmill, README, n.d. https://github.com/windmill-labs/windmill
30. LangChain, "Self-host standalone servers", n.d. https://docs.langchain.com/langsmith/deploy-standalone-server
31. LangChain, LangGraph persistence, n.d. https://docs.langchain.com/oss/python/langgraph/persistence
32. LangGraph, `checkpoint-postgres/base.py` schema, n.d. https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-postgres/langgraph/checkpoint/postgres/base.py
33. LangChain, LangSmith architectural overview, n.d. https://docs.langchain.com/langsmith/architectural-overview
34. Langfuse, "Langfuse v3 infrastructure evolution", 2024-12-17. https://langfuse.com/blog/2024-12-langfuse-v3-infrastructure-evolution
35. Graphile Worker, Performance, n.d. https://worker.graphile.org/docs/performance
36. Graphile Worker, Documentation, n.d. https://worker.graphile.org/docs
37. River, Benchmarks, n.d. https://riverqueue.com/docs/benchmarks
38. B. Leach, "River: a Fast, Robust Job Queue for Go + Postgres", 2023-11-20. https://brandur.org/river
39. B. Leach, "Postgres Job Queues and Failure Recovery" (dead tuples), 2015-05-18. https://brandur.org/postgres-queues
40. Rails, Solid Queue README, n.d. https://github.com/rails/solid_queue
41. 37signals, "Solid Queue 1.0 released", 2024-09-26. https://dev.37signals.com/solid-queue-v1-0/
42. pgmq, README, n.d. https://github.com/pgmq/pgmq
43. Scaling Postgres ep. 295 summarising Tembo, "Over 30k messages per second on Postgres", 2023-12; original at https://tembo.io/blog/mq-stack-benchmarking (not fetchable this session). https://www.scalingpostgres.com/episodes/295-30k-messages-per-second-queue/
44. Oban, module documentation, n.d. https://oban.hexdocs.pm/Oban.html
45. Que, README, n.d. https://github.com/que-rb/que
46. pg-boss, README and release 10.0.0, n.d. https://github.com/timgit/pg-boss ; https://github.com/timgit/pg-boss/releases/tag/10.0.0
47. Procrastinate, Discussions, n.d. https://procrastinate.readthedocs.io/en/stable/discussions.html
48. hardbyte, PostgreSQL job queue benchmarking harness, n.d. https://github.com/hardbyte/postgresql-job-queue-benchmarking
49. Recall.ai, "Postgres LISTEN/NOTIFY does not scale", 2025-07-01. https://www.recall.ai/blog/postgres-listen-notify-does-not-scale
50. PostgreSQL commitfest 55/5912, "Optimize LISTEN/NOTIFY", withdrawn 2025-08-07. https://commitfest.postgresql.org/55/5912
51. PostgreSQL docs, NOTIFY. https://www.postgresql.org/docs/current/sql-notify.html
52. PostgreSQL docs, SELECT locking clause. https://www.postgresql.org/docs/current/sql-select.html
53. PostgreSQL docs, TOAST. https://www.postgresql.org/docs/current/storage-toast.html
54. PostgreSQL docs, Heap-Only Tuples. https://www.postgresql.org/docs/current/storage-hot.html
55. PostgreSQL docs, Automatic vacuuming configuration. https://www.postgresql.org/docs/current/runtime-config-autovacuum.html
56. PostgreSQL docs, Table partitioning. https://www.postgresql.org/docs/current/ddl-partitioning.html
57. pg_partman, README, n.d. https://github.com/pgpartman/pg_partman
58. PostgreSQL docs, Asynchronous commit. https://www.postgresql.org/docs/current/wal-async-commit.html
59. PostgreSQL docs, Populating a database. https://www.postgresql.org/docs/current/populate.html
60. PostgreSQL docs, Connection settings. https://www.postgresql.org/docs/current/runtime-config-connection.html
61. PostgreSQL docs, Hot standby. https://www.postgresql.org/docs/current/hot-standby.html
62. B. Leach, "How to Manage Connections Efficiently in Postgres", 2018-10-15. https://brandur.org/postgres-connections
63. Cybertec, "Tuning max_connections in PostgreSQL", 2020-04, updated 2023-02-22. https://www.cybertec-postgresql.com/en/tuning-max_connections-in-postgresql/
64. PgBouncer, Configuration, n.d. https://www.pgbouncer.org/config.html
65. KEDA, PostgreSQL scaler, n.d. https://keda.sh/docs/latest/scalers/postgresql/
66. Citus Data, "Faster bulk loading in Postgres with copy", 2017-11-08. https://www.citusdata.com/blog/2017/11/08/faster-bulk-loading-in-postgresql-with-copy/
67. H. Asatryan, "PostgreSQL Write Performance: What the Benchmarks Won't Tell You", 2026-04-12. https://dev.to/haikasatryan/postgresql-write-performance-what-the-benchmarks-wont-tell-you-mm7
68. Anthropic, Glossary (tokens), n.d. https://platform.claude.com/docs/en/about-claude/glossary
69. Claude Code `claude-api` skill, model table cached 2026-06-24 (context windows and output limits); secondary to the Models API.
70. ithiria894, "I Dissected a 70MB Claude Code Session. 93% Was Noise", 2026-04-07. https://dev.to/ithiria894/93-of-a-claude-code-session-is-noise-heres-the-proof-n0m
71. anthropics/claude-code issue #81065, "Compress session transcripts on disk", 2026-07-25. https://github.com/anthropics/claude-code/issues/81065
72. deja-vu guide, "Session files on disk", n.d. https://vshulcz.github.io/deja-vu/guide/session-files-on-disk.html
73. Citus docs, "What is Citus?", n.d. https://docs.citusdata.com/en/stable/get_started/what_is_citus.html
74. A. Freund, "Analyzing the Limits of Connection Scalability in Postgres", Microsoft, 2020-10; not fetchable this session, cited for existence only. https://techcommunity.microsoft.com/blog/adforpostgresql/analyzing-the-limits-of-connection-scalability-in-postgres/1757266
