# Topic 3: packaging, deployment and scale

Status: seeded 2026-09-21 from the 2026-09-16 scaling and harness research, as the summary Roberto asked for of "the container and harness conversation". Positions here are proposals. The gap register that spans topics 2 and 3 is in `02-harness.md` under "State of the topic and gaps".

## What was read

`research/2026-09-16-scaling-containerised-agents.md` in full; `research/2026-09-16-harness-and-packaging-prior-art.md` §3, §5 and §6. No aesir code was read for this note beyond what `00-as-is.md` records. Every claim below is verified in those files unless labelled believed; the files carry the primary sources.

## Positions the research supports

| Question | Position | Evidence | Label |
|---|---|---|---|
| Execution family | Keep the claimed loop (stateless harness replicas claim conversations from Postgres with `SKIP LOCKED` and a lease). It is what Temporal workers, DBOS and the Managed Agents self-hosted worker do underneath. Move to a durable engine or actors only on a named signal | scaling §1, §6 | verified |
| Where a paused conversation lives | In the store, never on a volume. A volume is defensible only for a sandbox working tree | scaling §3 | verified |
| How a message reaches a conversation | Write it to a durable inbox; any replica claims the wake-up; a running loop notices new rows by `LISTEN/NOTIFY` or a poll. No placement directory | scaling §2 | verified pattern; aesir's signal path not re-read |
| Duplicate deliveries | One unique index on `(source, delivery_id)`; acknowledge within the provider's window (Slack 3 s, Linear 5 s, GitHub 10 s) | scaling §2 | verified |
| Unit of the image | One harness image (or a small family), pinned by digest, referenced from a per-agent manifest. Image-per-agent only for agents needing native tooling the base lacks | harness §5 | verified |
| Unit of compute | The session, not the agent. Every surveyed platform provisions per session and holds state idle; a container per agent type still needs the per-session story, which the claimed conversation is | harness §6 | verified |
| Sandbox | Separate from the harness: a sandbox pod or microVM the harness calls (gVisor or Kata via RuntimeClass, or agent-sandbox with warm pools). The harness pod holds the loop and credentials and packs densely; the sandbox holds the working tree | scaling §4 | verified |
| Packing | Small CPU requests, honest memory, `Burstable`, `MostAllocated` bin packing. Idle Node harness at roughly 150 to 300 MB RSS | scaling §4 | verified guidance; RSS figure inferred there |
| Scale to zero | Deployment plus KEDA Postgres scaler (`minReplicaCount` 0, poll 30 s, cooldown 300 s); the query counts claimable rows | scaling §1 | verified |
| Credentials | Never in the image or the agent's environment; an egress proxy or gateway injects them after the request leaves the container (Anthropic's hosting guidance, Claude Code's sandbox proxy, Docker MCP Gateway) | harness §6 | verified |
| Observability | OpenTelemetry GenAI spans from the harness through a collector to Langfuse or Phoenix; the dashboard reads the backend; domain events stay in the event log | scaling §5 | verified; conventions still "Development" status |
| Cost | Tokens dominate compute by an order of magnitude; packaging buys reproducibility and isolation, not savings | harness §6 | verified |

## The recommendation frame from the research

Three coherent architectures (scaling §6): A, the claimed loop evolved; B, a durable engine (DBOS the cheapest, Temporal the heaviest); C, an actor per conversation (Dapr, Rivet, or Cloudflare off-cluster). They differ in the extra stateful component you agree to run. A runs on what aesir has plus KEDA, a collector and one trace backend. The governing tradeoff is state locality versus operational surface. The move-on signals for A are resume latency dominated by history load, a need for live per-conversation connections, or a second operator.

Roberto's "agents are services in a cluster" fits A with one Deployment per agent image behind a Service (`07-path.md`). What a call to that Service does is decided in `05-coordination.md` §5a, not here.

## What this topic still has to decide

The 2026-09-21 gaps research (`research/2026-09-21-harness-container-gaps.md`) answered G1 to G6; the positions it supports are in `02-harness.md` under "What the 2026-09-21 research says". What remains for this topic:

1. **One Deployment per agent image, or one harness Deployment that pulls any bundle.** The research favours one image; whether each agent gets its own Deployment (a Service to call, per-agent scaling and identity) or shares one (denser packing, one rollout) is open. The 5a transport question depends on it, and so does G1: a Service per agent implies a push endpoint on the harness; a shared pool needs none.
2. **Where the adapter runs** (`04-events.md` question 2): in the ingress as a bundle-supplied module, or in the agent's container.
3. **The version policy per agent** (G2): pinned by default, with auto-upgrade as the manifest opt-in; and the hard case G18, what a conversation resumes on after its compute was released.
4. **The egress gateway** (G3): agentgateway-shaped, one for model, tool and agent-to-agent traffic; SPIRE deferred.
5. **The build** (G4): a `ko`-shaped CLI first, a controller later.
6. **Wake latency, measured** (G5): the number that decides between a long-running replica and a per-session worker.
7. **The new gaps G13 to G25**, in particular G13 (a signal during provisioning or teardown), G17 (queue ordering behind a running turn) and G19 (wake-event reconciliation), which are correctness questions for the claim model.

## Database load: what loads the store, where it saturates, and the ladder (2026-09-27)

Roberto, 2026-09-27: "I'm a bit worried on the load placed on the DB, it might be fine, just not sure how it would truly scale." Written first from the shape alone, then revised the same day against `research/2026-09-27-postgres-store-load-and-scale.md` (74 sources; section numbers below refer to it; `[V]` there means fetched primary source, and every computed number shows its formula). The as-is query profile, as evidence of one instance of the shape and not as the baseline, comes from `research/2026-09-27-claim-model-code-survey.md` when it lands.

**The answer in three sentences.** Query rate is not the problem: the research's capacity model puts an organisation of a hundred agents with five thousand paused conversations at about two hundred statements per second and 2.5 MB/s of transcript reads, two to three orders of magnitude under what Postgres queue libraries and DBOS have measured on one node (§7). What hurts a Postgres-only agent store is churn and growth: dead tuples on the rows that claims and heartbeats rewrite, message and event tables growing at roughly a hundred gigabytes a month at that scale, dashboard scans over the log, and the connection count crossing the default hundred. Every precedent that kept Postgres as its queue took the same ordered steps, and none left it for the hot queue below thousands of tasks per second (§6).

### The shape under analysis

Postgres is the only stateful component. It holds the durable conversations (transcripts that pause for days), the inbox of inbound deliveries deduplicated on a delivery id, the job records, the append-only event log, and the work queue itself: stateless harness replicas poll for runnable conversations, claim one with `FOR UPDATE SKIP LOCKED` and a lease, heartbeat while they run a turn, and release on pause. An autoscaler polls a count query to scale replicas from zero. Every resume reloads the transcript.

### What touches the store, and what each is proportional to

| Load | Proportional to | Statement kind | Cost when nothing is running |
|---|---|---|---|
| Claim polling | replicas × (1 / poll interval) | indexed select with `SKIP LOCKED`, returns no rows most of the time | present; this is the idle chatter |
| Autoscaler query | scaled objects × (1 / 30 s) | count over claimable rows | present, and negligible: one scaled object is 0.03 per second (§5) |
| Heartbeats | active claims × (1 / heartbeat interval) | one-row update on a hot row | none |
| Turn I/O | active turns × statements per model call (load context, append message, append events, write usage) | small writes; one read whose size is the transcript | none |
| Resume | resumes × transcript size | the one large read | none |
| Inbox | inbound deliveries | insert against a unique index | proportional to business-tool activity, not to agent count |
| Signals and wakes | signals | insert, plus `NOTIFY` or a poll | small |
| Job records | delegations | insert and update | small |
| Event log | every state change | append-only insert; the table never shrinks on its own | growth, not rate, is the issue |
| Dashboard | humans looking | reads across everything | none; a read replica removes it from the primary |

Two things follow before any measurement, and the research confirms both:

1. **A paused conversation costs nothing.** Load is proportional to active turns and to the count of infrastructure that polls, never to the number of conversations waiting. The design's promise, pause on Tuesday and resume on Thursday, is the case in which the store is idle. This is why the claimed-loop family chose a relational store (scaling research §1) and why the actor family's placement service is the thing it avoids.
2. **The store is not on the token path.** A model call takes seconds; a turn issues a handful of statements around it. The research's formula (§5): turn statements per second = turns per minute × (3 + 2 × iterations + events ÷ batch) ÷ 60. At the organisation scale (150 turns per minute at peak, ten iterations each, thirty events, unbatched) that is 132 statements per second, or 82 with events batched per iteration. Measured single-node ceilings for comparison: 25,000 transactions per second on Hatchet's largest CloudSQL instance, 15,600 unbatched jobs per second for Graphile Worker on a desktop, 144,000 writes per second for DBOS on 96 vCPUs (§1, §2). So the work is under one percent of what one node does. Idle chatter is smaller still: twenty replicas polling every two seconds are ten statements per second.

### The capacity model at three scales

From §7, with the assumptions stated there (ten iterations per turn, thirty events, 3 KB messages, 1 KB events, a 90 s claim, 10 s heartbeats, a 2 s poll, a pool of ten per replica). Replace any input with a measurement and the arithmetic follows.

| | Single operator | Team | Organisation |
|---|---|---|---|
| Agents / max replicas / peak turns per minute / paused | 5 / 2 / 5 / 20 | 30 / 6 / 30 / 500 | 100 / 20 / 150 / 5,000 |
| Peak statements per second, all kinds (events batched) | ~7 (6) | ~41 (31) | ~195 (145) |
| Transcript reads at peak | 1.5 MB/min | 18 MB/min | 150 MB/min (2.5 MB/s) |
| Growth per month, messages plus events | 1.9 GB | 19 GB | 117 GB |
| Connections, ten per replica plus dashboard | 26 | 71 | 221 |
| Notifying commits per second, one per iteration batch | 0.8 | 5 | 25 |
| Assumed instance | 2 vCPU, 4 GB | 4 vCPU, 16 GB | 8 vCPU, 32 GB, with a pooler |

### Where the shape breaks, in the order the evidence puts it

The first-principles draft of this section ranked transcript reads second and `LISTEN/NOTIFY` fifth. The evidence demotes both: a live transcript is bounded by the context window (about 0.7 MB at 200K tokens, 3.5 MB at 1M, §3), so the read volume is small and the cost is the harness's decode latency, not the store's I/O; and `NOTIFY`'s commit-time global lock is invisible at tens of notifying commits per second and only bites at thousands (§2). What remains, ranked:

| # | Failure | Why it happens here | The fix, with its trigger | Precedent |
|---|---|---|---|---|
| 1 | Growth | 117 GB a month at organisation scale, 1.4 TB a year without retention (§7); `DELETE`-based retention causes vacuum storms; per-attribute indexes on a log are infeasible | Partition the event log and inbox by time with `pg_partman` and drop partitions for retention (also G20's mechanism); keep the log's indexes to the conversation and sequence plus the partition key; move analytical reads to a column store when they threaten the primary | Trigger.dev moved logs to ClickHouse in Oct 2025 because the table "kept growing"; Langfuse moved traces to ClickHouse and raw events to S3 in Dec 2024 after a 50 s ingestion p95 (§1, §4) |
| 2 | Connections | 221 at organisation scale against a default `max_connections` of 100; replicas scaling from zero produce connection storms | A pooler in transaction mode at about half of `max_connections`, or a pool of three per replica. Verified caveat: transaction pooling forbids session features, which includes `LISTEN`, so the wake channel needs one direct connection per replica outside the pooler (§2, §5) | Hatchet ("connection storms"); 37signals runs Solid Queue on its own database with two replicas (§2, §6) |
| 3 | Dead tuples from heartbeats and claims | 22.5 heartbeats per second on a 5,000-row lease table produce about 1.9 million dead tuples a day; autovacuum fires roughly every minute at that table's threshold (§7); a long transaction anywhere pins them | Keep the lease in its own narrow table with `fillfactor` room for HOT updates and the heartbeat column unindexed; per-table autovacuum settings; no long transactions on that database | Brandur's 2015 incident (247,311 dead rows, lock time up 10×); Que's README; Solid Queue's separate `claimed_executions` table (§2) |
| 4 | The claim query | An O(n) claim (a window function over the queued set) took 159 ms at 10,000 queued rows and starved workers at 25,000 | Compute order at write time so the claim is near constant time; a partial index on claimable rows; jittered pollers | Hatchet's redesign (§2) |
| 5 | Dashboard scans | The only analytical reads; at 20 per second over the log they are the first thing in `pg_stat_statements` | A read replica when they top the statement stats; a column store when aggregations threaten OLTP | 37signals primary plus two replicas; Langfuse and Trigger.dev (§6) |
| 6 | Transcript storage shape | One `JSONB` document per conversation rewrites the whole document on every append under MVCC: a 1 MB transcript appended twenty times per turn writes 20 MB and leaves twenty dead versions (§3) | One row per message with `JSONB` payloads; large tool results to object storage; compaction bounds the live window. Never a document per conversation past a few hundred KB | LangGraph's checkpointer dedupes blobs by channel version for this reason; Langfuse, LangSmith and Trigger.dev push bodies to object storage (§3) |
| 7 | `LISTEN/NOTIFY` | A global lock at commit; three outages at Recall.ai with tens of thousands of writers; an optimisation patch was withdrawn in Aug 2025 and a Jan 2026 commit optimises listener wake-ups without touching the lock, so treat it as present in every version you can deploy | Batch notifications (DBOS: 2,900 writes per second naive, 60,000 batched) and keep a fallback poll; at 25 notifying commits per second here it is a non-issue | DBOS, Recall.ai, the commitfest record (§2) |

Two levers that are not levers: `synchronous_commit = off` gains at most 15% on NVMe (§4), and a dedicated queue component below thousands of tasks per second buys nothing the precedents needed (§6). Batching is the lever: 10× to 20× across Hatchet, Graphile and DBOS.

### The escalation ladder, with triggers

From §6, each step with its symptom and a named precedent. The first four keep Postgres as the only stateful component.

1. **Tune**: partial index on claimable rows, narrow lease table, `fillfactor` for HOT heartbeats, per-table autovacuum, event inserts batched with a 10 ms flush. Trigger: claim p95 approaching the poll interval, dead tuples climbing, an autovacuum running past an hour.
2. **Pooler** in transaction mode, `LISTEN` bypassed. Trigger: connections past half of `max_connections`, or storms on scale-from-zero.
3. **Read replica** for the dashboard. Trigger: dashboard queries top `pg_stat_statements` by total time.
4. **Partition** the event log and inbox; retention by dropping partitions. Trigger: the log past tens of GB. **4b.** Analytics to a column store when aggregations threaten the primary.
5. **Transcript bodies and large tool results to object storage.** Trigger: database size dominated by TOAST, backup and restore times, slow p99 transcript loads.
6. **Hot queue to a dedicated component** or a queue library that stays on Postgres. Trigger: thousands of tasks per second and a thundering herd despite jitter and batching. Trigger.dev took this step in Apr 2025; Hatchet went the other way and removed RabbitMQ.
7. **Shard or distributed SQL.** Trigger: the single-writer wall, latency creeping under bursts and vacuum falling behind at peak. Quo moved Temporal's persistence to Cassandra in Jul 2026 for exactly this; PlanetScale sharded it on Vitess at 40k to 200k QPS.
8. **A durable-execution engine.** Trigger: you are re-implementing journals, replay and signals.

### What this means for the decisions on the table

- **The deployment shape's effect on the store is connections, not query rate.** The first-principles draft called the shape the largest lever on idle load; with the numbers, idle polling is ten statements per second at twenty replicas and does not matter. What the shape multiplies is the replica floor times the pool size, which is the connection count in row 2. One Deployment per agent with a floor of one replica each is a hundred pools at organisation scale; a shared pool is as many as the work needs. Brief 2 (`research/2026-09-27-deployment-shape-and-cost.md`) costs the rest.
- **Transcript placement is settled enough to state:** one row per message, large tool results out of line, compaction bounding the live window. It is a joint harness and store decision (G9 in `02-harness.md`); the store's side is now known.
- **Partition the event log and inbox from day one.** Cheap before there is data, expensive after, and step 4 of every precedent's ladder.
- **Keep the lease in its own narrow table** from day one for the same reason (row 3).
- **Do not change the execution family for load reasons.** Durable engines and actor systems have a store too, and Temporal's is the one the research found people leaving Postgres for, because its persistence is "chatty by design" (§1). The move-on signals for the claimed loop remain latency and locality, not throughput (scaling research §6).

### What to measure first

Nine measurements replace the model's assumptions (§7): iterations and events per turn from event counts; the live transcript at p50 and p99 with `pg_column_size`; claim-to-release duration; claims per minute over a week; message and event size histograms; relation sizes sampled weekly; connections from `pg_stat_activity`; statements by kind from `pg_stat_statements` call deltas; dead tuples on the lease table from `n_dead_tup`. The code survey supplies the first of these for the current instance.

## Deployment shape: one Deployment per agent, or a shared harness pool (2026-09-27)

Item 1 of "What this topic still has to decide" now has its inputs, from `research/2026-09-27-deployment-shape-and-cost.md` (56 sources; section numbers below refer to it; `[V]` there means a fetched primary source, and every computed number shows its formula). The decision is Roberto's; this section lays out what the evidence says and where it points.

### What ships

No surveyed product uses one Deployment per agent as its scaling unit except kagent's v0.10 line, and kagent's v1.0.0-alpha releases (2026-09-18 to 2026-09-27) replace it with a `WorkerPool` per namespace, a per-session actor that "pins one prepared revision", and a golden snapshot per template revision (§1). Every hosted platform places compute per *session*: Foundry ("hosted agents scale per session, not per replica"; "there's no replica count to configure and no warm pool to size"), AgentCore (a microVM per session), Managed Agents (any worker in an environment claims the next turn), the Agent SDK's long-running pattern (a pool of containers with session affinity). Knative, Cloud Run and Temporal's Worker Controller place per *version*. So the per-agent Deployment is a Kubernetes-native convenience, not an industry pattern; the per-version Deployment is, and it exists to isolate versions, not agents.

### The cost model

Assumptions stated in §2 (20 turns per minute platform-wide, 30 s turns, 20 concurrent turns per pool replica, a 5 min KEDA cooldown, a 64 MiB thin harness, a 1 s claim poll, two connections per replica and one per ScaledObject). Replace any number and the arithmetic follows.

| Quantity | 10 agents, per agent | 10 agents, pool | 100 agents, per agent | 100 agents, pool |
|---|---|---|---|---|
| Warm pods | 10 | 2 | 63 | 2 |
| Idle memory, thin harness | 690 MiB | 138 MiB | 4.4 GiB | 138 MiB |
| KEDA scaler queries per minute | 60 | 6 | 453 | 6 |
| Claim-loop queries per minute | 600 | 120 | 3,793 | 120 |
| Idle Postgres connections | 30 | 5 | 226 | 5 |
| API objects | 70 | 7 | 700 | 7 |
| Rollouts per harness release | 10 | 1 | 100 | 1 |
| Wake from zero | mean about 20 s, worst about 65 s, paid by every cold agent on every wake | only when the whole platform is idle | same | same |

Two measured inputs behind it: a Node 22 hello-world container idles at 16 to 23 MiB working set; the same process with HTTP clients and a Postgres pool constructed measured 58 MiB on the researcher's machine, with no published Linux figure (§2). If the harness instead spawned a Claude Code subprocess per session, active memory would be 1 GiB per active turn in both shapes and the difference would stay in the idle floor. The KEDA Postgres scaler holds one unbounded connection per ScaledObject and polls every 30 s; the HPA controller skips metric computation at zero replicas, so at zero only KEDA's poll runs (§2, verified in code).

### Version pinning, identity, hybrids

- **Pinning across a pause** (G2, G18). Kubernetes keeps old ReplicaSets only at zero replicas, so pinned-by-default in the per-agent shape means a Deployment per (agent, version) kept until its last paused conversation ends, drained by a zero-open-pinned count, which is what Temporal's Worker Controller automates. In the pool a retained version is a bundle in the registry, loaded beside the new one because Node caches modules by resolved path, or pulled by digest at claim time (§3). Pinned-by-default is cheap only in the pool.
- **Identity** (G7). ServiceAccount and NetworkPolicy attach to pods, so the per-agent shape gets both for free. The pool must carry identity per claimed row: a TokenRequest for the agent's own ServiceAccount per turn, presented to the egress gateway, which is Lambda's model (a trusted host, "slots are only ever used for a single function", up to 8,000 functions per host). Per-agent egress then needs the L7 gateway rather than NetworkPolicy, which G3 already requires (§4). The residual is the blast radius: a compromised pool pod can request tokens for every ServiceAccount its RBAC allows (G27).
- **Hybrids that ship** (§5). Everyone running many agents on shared infrastructure ends up with a pool plus a per-session unit plus a warm layer: kagent's pool, actor and snapshot; agent-sandbox's warm pod pool; AgentCore's snapshot cold start at about 2 s; Managed Agents' environment pool with a sandbox per claimed session; Temporal's per-version Deployments with per-version scalers. A pool per trust tier with a dedicated Deployment for agents with native dependencies is the natural composition and not observed as a product.

### Recommendation criteria (from §6), and where they point

One Deployment per agent wins when the agent count is small and stays small (roughly ten or fewer), when agents need distinct base images or native dependencies, or when per-agent identity and egress must be Kubernetes-native for audit. The pool wins when the count is fifty or more or version churn is high, when the paused-to-active ratio is high (above about twenty, because every wake of a cold agent pays 20 to 65 s in the per-agent shape and about 1 s in a warm pool), or when the harness is thin. Either shape, with the hybrid, when a minority of agents need native dependencies or a higher trust tier, or when cold wake under 5 s is required, which neither meets from zero with KEDA's poll.

**Where the evidence points (proposal, not the decision).** The product statement in `01-target.md` is "run it and scale it as defined" for an organisation of agents; `05-proposal.md` designs for a hundred; the harness is thin by design (`07-path.md`, the loop behind a model port); and the workload pauses for days, so the paused-to-active ratio is high by construction. Three of the pool's four conditions hold before a line is written, and the one shipped per-agent precedent abandoned the shape this month. The per-agent shape's remaining argument, Kubernetes-native identity, is answered by TokenRequest plus the gateway that G3 needs anyway. So: **a shared harness pool per trust tier, with a dedicated Deployment only for an agent whose bundle needs a native dependency or a distinct base image.** What changes if the assumptions are wrong: if the first workload runs on the Claude Agent SDK as the harness (option D in `02-harness.md`), the 1 GiB per session floor removes the density argument and the per-session shape (Foundry, AgentCore) becomes the comparison; if a second operator needs per-agent audit at the Kubernetes layer, the per-agent shape returns for that tenant.

Consequences for the other notes: G1's inbound contract stays store-only (the pool has no Service per agent; transport 2's A2A endpoint is served by the gateway on the agent's behalf); the database section above gets the pool's connection count (five at organisation scale against 226); the manifest's `Harness.substrate.workerPoolRef` (candidate B in `02-harness.md`) is the field that names the pool; and the registry's "zero endpoints does not mean unavailable" trap in `05-proposal.md` is moot in the pool, because the agent's availability was never an endpoint count.
