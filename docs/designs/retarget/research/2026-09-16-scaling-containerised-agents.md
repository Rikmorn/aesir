# Scaling containerised agents: execution, routing, memory, packing, observability

Date: 2026-09-16. External research only; the aesir code was not read for this document.

**Summary.** Three execution families can host a long-running LLM tool loop that pauses for days. The first is stateless replicas that claim work from a store. Aesir does this today; so do Temporal workers, DBOS, Inngest and the Managed Agents sandbox workers underneath. The second is stateful actors with sticky routing (Dapr, Orleans, Akka, Cloudflare Durable Objects, Rivet). The third is durable-execution engines that checkpoint each step (Temporal, Restate, Inngest, DBOS). For routing, the queue-claim model needs no placement directory, and one unique index on the delivery id absorbs duplicate webhooks. The actor model needs a placement service, and on Dapr it cannot scale to zero. For memory, every credible system keeps the transcript in a service (Postgres, object store, SQLite-per-actor), never on a Kubernetes volume. A volume is only defensible for a sandbox working directory. For packing, an idle harness is memory-bound, so request little CPU and pack with `MostAllocated`. Run tool execution in a separate gVisor or microVM sandbox that the harness calls; Managed Agents, agent-sandbox, E2B and Modal all use that split. For observability, emit OpenTelemetry GenAI spans (still "Development" status) through a collector to Langfuse or Phoenix. Let the dashboard read from that backend rather than from agents. The governing tradeoff is state locality versus operational surface. Actors and durable engines buy locality and clean pause semantics at the price of one more stateful control plane. The claimed loop keeps Postgres as the only stateful thing and pays with a full history load on every resume.

**Labels.** `[V n]` means verified this session from source n in the list at the end. `[I]` means inferred by me and not read from a source. Where a source carried a date it is in the source list; many vendor pages show none.

## 1. Execution model for a paused-and-resumed loop

**Conclusion.** The queue-claim model is the cheapest to operate, and it is what the durable engines run on internally. The actor model gives the closest fit to "agents as microservices" but adds a placement layer. Durable engines give the cleanest wait-for-days semantics but force the LLM loop into a deterministic step structure. Nothing in Kubernetes natively models "one long-lived logical conversation"; every option maps it onto a Deployment, a StatefulSet, a Job, or an external control plane.

| Model | Where state lives while paused | How it waits | How it resumes | Placement | Replica failure |
| --- | --- | --- | --- | --- | --- |
| (a) Stateless replicas, queue-claim | Store (Postgres, S3) | Row marked waiting; no process | Any replica claims it and reloads history | None; any replica | Claim lease expires, another replica claims [I] |
| (b) Stateful actor, sticky routing | Actor's own store, loaded on activation | Actor deactivates/hibernates; reminders or alarms survive | Next message re-activates it, possibly on another host | Directory or hash ring maps id to host [V 1][V 2][V 5] | Runtime re-activates on a healthy host [V 1][V 2] |
| (c) Durable execution engine | Journal or event history | Handler suspended; a durable timer or signal is registered | Engine replays journal or memoised steps, then continues | Engine assigns to any worker | Replay on another worker [V 11][V 23][V 19] |

### (a) Stateless replicas that claim from a store

This is the aesir design being reconsidered, and it is not exotic. Temporal's workers are your own processes that poll a task queue, dequeue a task, run code, and reply [V 15]. Managed Agents' self-hosted sandbox worker is "a long-running process [that] polls the queue continuously and needs only outbound HTTPS" [V 53]. DBOS checkpoints each step to Postgres and, on restart, resumes every PENDING workflow from its last completed step [V 23][V 24]. The model's costs are a full transcript load per turn and no locality, which matter once transcripts are large [I].

### (b) Stateful actor per conversation

- **Dapr Actors.** The placement service hashes actor type and id so "the same partition (or service instance) is always called for any given actor id" [V 1]. Turn-based concurrency allows one thread inside an actor at a time [V 1]. Reminders fire even when the actor is inactive and re-activate it; timers only fire while active [V 1]. Idle actors are garbage-collected while state outlives them in the state store [V 1]. On failure Dapr "automatically migrates them from failed nodes to healthy ones" [V 1]. Actor hosts cannot scale to zero: Azure's Dapr guidance says `minReplicas` must be at least one when an app hosts actors [V 90, secondary]. A 2022 P0 bug showed actor state errors during KEDA rebalancing; it was fixed, but it is a warning about mixing autoscaling with placement [V 89].
- **Microsoft Orleans.** Virtual actors "always exist" and their existence "is unaffected by the failure of a server" [V 2]. Idle grains are deactivated after `CollectionAge`, default 15 minutes [V 3]. Default placement moved to ResourceOptimized in 9.2; membership detects failure in about 90 seconds [V 2]. Silos run as an ordinary Deployment with a separate clustering provider and a long `terminationGracePeriodSeconds` [V 4]. .NET only.
- **Akka Cluster Sharding.** Messages go through a `ShardRegion` so senders need not know the entity's location [V 5]. Idle entities passivate after 2 minutes by default; `remember-entities` restarts them after a rebalance or crash [V 5]. JVM only.
- **Cloudflare Durable Objects and the Agents SDK.** An object hibernates after 10 seconds of inactivity, provided no timers, awaited fetches, or sockets are open [V 6]. Hibernation discards in-memory state; alarms wake it [V 6]. Hibernated objects incur no duration charge [V 6]. Each object is single-threaded, holds up to 10 GB of SQLite, and there is no cap on object count [V 7]. The Agents SDK makes "the agent's identity (its name) ... the routing key", persists `this.state` to SQLite on every `setState()`, and wakes on requests, WebSocket messages, alarms, or email [V 8]. This is the purest "one addressable stateful process per conversation" model, but it only runs on Cloudflare.
- **Rivet Actors.** Sleep starts after `sleepTimeout`, default 30 s, and a request wakes the actor with restored state [V 9]. The platform may migrate an actor to a new machine, where it "wakes up with its persisted state" [V 9]. Self-hosting supports Kubernetes with a file system, PostgreSQL, or FoundationDB (enterprise) backend [V 10]. The closest open-source equivalent of Durable Objects that runs on your cluster; maturity is the risk [I].

### (c) Durable execution engines

- **Temporal.** A workflow blocks on a signal. On worker failure the execution "picks up where the last recorded event occurred", replaying history against the code's commands [V 11]. Event history is capped at 51,200 events or 50 MB with warnings at 10,240 events or 10 MB, so a long agent loop must Continue-As-New [V 12]. Server is a multi-component cluster plus an external database [V 16].
- **Restate.** Awakeables are one-shot callbacks; an external system resolves them over HTTP at `/restate/awakeables/{id}/resolve` [V 17]. When an invocation has nothing else to do "Restate can suspend it and resume it when the next result arrives" [V 17]. Virtual objects give single-writer concurrency per key and addressable URLs [V 16]. Restate pushes work to services over HTTP rather than having workers poll [V 16]. On Kubernetes it runs as a StatefulSet with RocksDB on a persistent volume and S3 snapshots [V 18]. Running a cluster without snapshots "is not recommended for production" [V 18].
- **Inngest.** "Each step in your function is executed as a separate HTTP request"; previous step results are injected and the function stops after each step [V 20]. `step.waitForEvent()` "suspends completely: no process, no connection, no resources held" and returns `null` on timeout [V 19][V 21]. Self-hosted is a single binary with in-memory Redis and SQLite by default, and optional external Redis and Postgres [V 22].
- **DBOS.** A library, not a server: one database write per step plus two per workflow, and Conductor "is never involved in workflow execution" [V 23]. `DBOS.recv()` waits for a message with a default 60 s timeout; sends from a workflow are exactly-once [V 25]. Workflows must be deterministic and steps idempotent because recovery is replay-based [V 23].

**The determinism catch.** Temporal and DBOS both replay workflow code and require determinism [V 11][V 23]. An LLM call is non-deterministic, so it must be wrapped as an activity or step whose result is memoised, and every tool call likewise [I]. That is workable, but the loop's shape (call, decide, call) becomes a chain of steps whose count is unbounded. That is exactly what Temporal's history limit punishes [V 12]. Inngest's per-step HTTP model and Restate's journal handle unbounded loops more naturally, at the cost of re-entering your handler per step [V 20][V 17].

### Kubernetes primitives and cost of one container per conversation

| Primitive | Fits | Scale to zero | Notes |
| --- | --- | --- | --- |
| Deployment + HPA | (a), (b) hosts | `HPAScaleToZero` is Beta and on by default in v1.37; needs an object or external metric [V 31] | HPA sync period defaults to 15 s [V 91] |
| Deployment + KEDA | (a) | Yes; `minReplicaCount` default 0, `pollingInterval` 30 s, `cooldownPeriod` 300 s [V 27] | Postgres scaler runs a SQL query that must return a number, e.g. count of claimable rows [V 28]; KEDA scales Deployments, StatefulSets, and any CR with a `/scale` subresource [V 26] |
| Job per conversation | one-shot runs | Pods exist only while running | Job retries pods until a success count is met; `suspend: true` deletes active pods [V 32]; a days-long wait leaves a pod alive or needs a new Job per resume [I] |
| StatefulSet | (b) hosts, Restate | No native scale to zero | Stable network identity and a PVC per pod; PVCs are not deleted on scale-down [V 33] |
| Knative | HTTP-triggered (a) | Yes, only with KPA; stable window 60 s, grace period 30 s [V 29][V 30] | Requests buffer at the activator during scale-from-zero [V 29] |

Cost of one container per conversation, in numbers that were verifiable:

- Kubernetes is designed for no more than 110 pods per node [V 38]. A conversation-per-pod design at hundreds of paused conversations needs many nodes just for idle pods [I].
- Pod Overhead is charged per pod by RuntimeClass. The documented Kata Firecracker example adds 120 MiB memory and 250 m CPU per pod on top of container requests [V 39].
- Fly.io: a suspended Machine resumes in "a few hundred ms" versus "~2+ seconds" cold, but suspend needs 2 GB memory or less [V 74]. Stopped or suspended Machines bill only rootfs at $0.15 per GB per 30 days; the smallest running Machine is about $2.02 per month [V 75].
- E2B: pausing saves filesystem and memory at about 4 s per GiB, and resume takes about 1 s [V 69]. Paused sandboxes are kept indefinitely; compute is $0.000014 per vCPU-second and $0.0000045 per GiB-second [V 69][V 70].
- Cloudflare: no duration charge while hibernated [V 6].
- Inferred sizing [I]: a Node.js harness idles at roughly 150 to 300 MB RSS while awaiting the model API. A 16 GB node therefore packs 40 to 60 such pods by memory alone. One process serving many conversations from Postgres holds none of that memory while paused.

## 2. Load balancing

**Conclusion.** Use queue-based dispatch unless you need a live connection per conversation. The ingress that receives a webhook never needs to know where the conversation is. It writes the event to a durable inbox, and any replica claims the wake-up. Push routing to a specific replica needs a placement directory and a way to queue messages behind the current turn. The actor systems provide both; Kubernetes Services provide neither.

**How a message reaches a mid-loop conversation.**

- Queue-claim: the signal is written to the store. If the conversation is paused, it becomes claimable. If it is running, the running worker must notice the new row; Postgres `LISTEN/NOTIFY` or a poll inside the loop are the usual mechanisms [I]. There is no need to reach the specific replica.
- Actor: the router hashes the id to a host, and the runtime enforces one turn at a time [V 1]. A signal therefore queues behind the current turn. Durable Objects route by name to one single-threaded instance [V 7][V 8].
- Durable engine: the engine owns delivery. Temporal signals, Restate awakeables and DBOS `send()` all address a workflow or object by id [V 14][V 17][V 25]. The message persists until the handler consumes it.

**Idempotency when a webhook is delivered twice.** All four producers give you a stable id, and all retry or redeliver.

| Producer | Delivery id | Retries | Response window |
| --- | --- | --- | --- |
| GitHub | `X-GitHub-Delivery`; a redelivery carries the same id [V 42] | Docs describe manual or API redelivery, not automatic retry [V 42] | 2XX within 10 s [V 42] |
| Linear | `Linear-Delivery` UUID v4 [V 43] | Up to 3 retries after 1 min, 1 h, 6 h [V 43] | 5 s; also verify `webhookTimestamp` within a minute [V 43] |
| Slack | `event_id`, "globally unique across all workspaces" [V 44] | 3 retries: nearly immediately, 1 min, 5 min, with `x-slack-retry-num` [V 44] | 2xx within 3 s [V 44] |
| Standard Webhooks | `webhook-id`, unchanged across retries; use as idempotency key [V 41] | Example schedule spans 24 h with jitter [V 41] | Verify `webhook-timestamp` tolerance [V 41] |

The pattern that follows [I]: acknowledge within 3 s, insert `(source, delivery_id)` into an inbox table with a unique index, and dispatch only on insert success. Engine-level dedup exists too. Temporal allows at most one open execution per Workflow Id, and a `Use Existing` conflict policy returns the running one [V 13]. Signals may still arrive twice, so Temporal recommends an application idempotency key in signal inputs [V 14]. DBOS treats an assigned workflow id as an idempotency key and accepts one on `send()` [V 24][V 25]. Aesir's `correlationKey` on `start()` already plays the Workflow Id role; the gap, if any, is on signals [I].

## 3. Memory

**Conclusion.** Treat three tiers separately: the transcript (exact, append-only, short-term), the working files (sandbox filesystem), and long-term memory (facts and notes that outlive a conversation). Every system surveyed keeps the transcript and long-term memory in a service. A Kubernetes volume is only a fit for the working files, and even there a pausable sandbox with its own snapshot is the more common design.

| System | Short-term (transcript, thread) | Long-term (cross-conversation) | Storage |
| --- | --- | --- | --- |
| Claude Agent SDK | JSONL under `~/.claude/projects/<cwd>/`; resume is "same machine only" unless a `SessionStore` mirrors it [V 45][V 46] | Not built in; use the memory tool or your own store | Reference adapters for S3, Redis, Postgres; mirror writes are best-effort, retried up to 3 times, dedupe by `entry.uuid` [V 46] |
| Anthropic memory tool | n/a | Files under `/memories`; Claude issues `view`, `create`, `str_replace`, `insert`, `delete`, `rename` and your handler executes them [V 49] | Client-side; any backend you map the prefix onto [V 49] |
| Managed Agents | Session event history "persisted server-side"; sessions go `idle` while awaiting input [V 52][V 54] | Memory stores are separate resources [V 54] | Anthropic-hosted; sandbox filesystem persists per session [V 52] |
| LangGraph | Checkpointers, thread-scoped; InMemory, SQLite, Postgres [V 57] | Stores, cross-thread [V 57] | Postgres in production [V 57] |
| Letta | Message history persisted; core memory blocks pinned to the system prompt [V 58] | Archival memory, semantically searchable [V 58] | Postgres with pgvector in Docker; the Docker image is "no longer an actively maintained or supported Letta product surface" [V 59] |
| Mem0 OSS v3 | n/a | Single-pass extraction; hybrid semantic, BM25 and entity search [V 61] | Vector store (Qdrant or Postgres + pgvector) plus SQLite history [V 60]; graph memory removed from OSS, Platform-only [V 61] |
| Zep / Graphiti | n/a | Temporal knowledge graph with validity intervals per edge [V 62] | Graph database; hosted Zep or self-hosted Graphiti [V 63] |
| Cloudflare Agents | SQLite per agent, up to 10 GB [V 7][V 8] | Same SQLite | Cloudflare-managed |

Two Anthropic references shape the tiers. Context editing plus the memory tool improved a long-horizon benchmark by 39 % and cut tokens 84 % in a 100-turn task [V 50]. The long-running harness post keeps a JSON feature list, a progress file, and git history as the cross-session state [V 51]. Each session starts by reading them [V 51]. The memory tool page adds server-side compaction as the third lever [V 49]. Together they argue for transcript compaction plus a small set of agent-edited files, not for a vector database, for a coding agent [I].

**What a Kubernetes volume can and cannot do.**

- `ReadWriteOnce` means read-write by a single node; `ReadWriteOncePod` restricts to one pod [V 34]. A network block volume can follow a pod within its zone, but detach and reattach add latency on every reschedule [I].
- Local volumes require PV `nodeAffinity` and "if a node becomes unhealthy, then the local volume becomes inaccessible to the Pod" [V 35]. That is a data-loss path for anything not mirrored elsewhere.
- `emptyDir` is deleted when the pod leaves the node [V 35]. Pods get 30 s by default to shut down before SIGKILL [V 40], which bounds how much unflushed state you can expect to save on eviction.
- StatefulSets give a PVC per pod that survives rescheduling and is not deleted on scale-down [V 33]. That suits a database, not a fleet of thousands of conversations [I].
- Versus a memory service: a service gives concurrent append from any replica, transactional writes, retention policy, and no node coupling [I]. The SDK `SessionStore` contract is a good minimal shape: `append`, `load`, and optional list and delete [V 46]. The volume wins only when the state is a working tree that a sandbox process needs as POSIX files [I].

## 4. Node packing and sandboxes

**Conclusion.** Pack harness pods by memory with small CPU requests and `Burstable` QoS. Keep tool execution in a separate sandbox pod or microVM that the harness calls. Managed Agents, agent-sandbox, E2B, Modal and Daytona all separate the control loop from the sandbox. In the "sandbox is the agent container" design the harness itself is unsandboxed, and the loop's memory pays the sandbox overhead.

**Resource requests for a mostly idle workload.** A pod is `Burstable` when it sets requests without equal limits [V 36]. Under pressure `BestEffort` pods are evicted first, then `Burstable`, then `Guaranteed` [V 36]. For a harness that spends most of its life awaiting a model response, request honest memory and a small CPU share, and let it burst [I]. The scheduler's `NodeResourcesFit` plugin supports `MostAllocated` and `RequestedToCapacityRatio` for bin packing [V 37]. `MostAllocated` "scores the nodes based on the utilization of resources, favoring the ones with higher allocation" [V 37]. The trade is concentration risk on a packed node [I]. Pod Overhead is added to container requests at admission when a RuntimeClass declares it [V 39].

| Sandbox | What it isolates | Boundary | Cost and limits | Kubernetes fit |
| --- | --- | --- | --- | --- |
| gVisor | Syscalls handled by a userspace kernel (Sentry); file access via Gofer [V 64] | Shared host kernel, minimised surface | Extra memory per sandbox; "poor performance for system call heavy workloads" [V 64][V 65] | `runsc` RuntimeClass [V 64]; used by Modal [V 73] and recommended by agent-sandbox for Managed Agents workers [V 56] |
| Kata Containers | Guest Linux kernel in a lightweight VM via KVM [V 66] | Hardware virtualisation | Overhead ranked medium (QEMU) to lowest (Firecracker, Dragonball) [V 66]; example Pod Overhead 120 MiB, 250 m [V 39] | RuntimeClass; needs KVM on nodes [I] |
| Firecracker | microVM VMM on KVM; jailer drops privileges; minimal virtio devices [V 67] | Hardware virtualisation | 5 microVMs per host core per second; snapshots must resume on identical software and hardware [V 67][V 68] | Via Kata, or a platform such as E2B (E2B on Firecracker is from search results, not verified on a primary page) |
| agent-sandbox (kubernetes-sigs) | Singleton pod with stable hostname, persistent storage, pause and resume, warm pools; delegates isolation to gVisor or Kata via RuntimeClass [V 55] | Depends on runtime | API `agents.x-k8s.io/v1beta1`, latest v1.0.2 [V 55] | Native CRD; documented use case hosts Managed Agents workers with `runtimeClassName: gvisor` [V 56] |
| E2B | Full sandbox VM; pause saves filesystem and memory [V 69] | Hosted microVM | ~4 s per GiB to pause, ~1 s to resume; paused sandboxes kept indefinitely; Hobby sessions 1 h, Pro $150/mo with 24 h sessions [V 69][V 70] | External service called over HTTPS |
| Modal Sandboxes | gVisor containers [V 73] | Shared kernel | Default lifetime 5 min, max 24 h, `idle_timeout`; filesystem snapshots kept 30 days, memory snapshots 7 days [V 71][V 72] | External service |
| Fly Machines | Firecracker VMs (from search; not verified on a primary page) | Hardware virtualisation | Suspend at 2 GB or less; resume in a few hundred ms; storage-only billing when stopped [V 74][V 75] | External service |
| Daytona | Container or VM sandboxes; filesystem persists across stop/start; hot snapshots on VM only [V 76] | Runtime-dependent | Auto-stop 15 min, auto-archive 7 days for containers [V 76] | External service |

**Own container or a separate one.** Managed Agents keeps "the orchestration on Anthropic's side" and moves "tool execution into infrastructure you control" [V 53]. Tool inputs and outputs still flow to the control plane [V 53]. The agent-sandbox integration runs a small worker per sandbox that blocks until a dispatcher posts a work item, then executes it under gVisor [V 56]. The same split applies to a self-hosted harness [I]. The harness pod holds credentials and the loop, and can be packed densely. The sandbox pod holds the working tree, runs untrusted commands, and can be paused, warm-pooled, or thrown away. Making the harness container itself the sandbox couples the loop's lifetime to the sandbox's and puts the API key inside the untrusted boundary [I].

## 5. Observability

**Conclusion.** Instrument the harness with OpenTelemetry GenAI conventions, route through a collector, and land traces in an LLM-aware backend. The dashboard reads that backend (or a store the collector exports to); agents never write to the dashboard. The conventions are usable now but carry "Development" status, so pin versions and expect attribute renames.

**Conventions.** The GenAI semantic conventions moved to their own repository and are marked "Status: Development" [V 77]. Model spans are named `{gen_ai.operation.name} {gen_ai.request.model}` and require `gen_ai.operation.name` and `gen_ai.provider.name`; token usage goes in `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` [V 78]. Agent spans define `create_agent`, `invoke_agent`, `execute_tool`, `plan` and `invoke_workflow`; tool spans carry `gen_ai.tool.name` and `gen_ai.tool.call.id` [V 79]. Message content attributes are flagged as likely to contain PII and are opt-in [V 78]. An MCP conventions document exists in the same repository [V 77].

**Anthropic's own tooling.** The Agent SDK produces no telemetry itself; the bundled CLI exports metrics, log events, and beta traces over OTLP when `CLAUDE_CODE_ENABLE_TELEMETRY=1` [V 47]. Span names are `claude_code.interaction`, `claude_code.llm_request`, `claude_code.tool`, `claude_code.tool.execution` and `claude_code.hook`; the SDK injects W3C `TRACEPARENT` so the run nests under your span [V 47]. Content is off by default; `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT` and `OTEL_LOG_RAW_API_BODIES` opt in [V 47]. These span names are Claude-specific, not the GenAI convention names [V 47][V 78]. Metrics default to a 60 s export interval, traces and logs to 5 s, and export errors are silent unless `CLAUDE_CODE_OTEL_DIAG_STDERR=1` [V 47][V 48].

**Collector topology.** The agent pattern runs a collector "alongside the application or on the same host, such as a sidecar or DaemonSet" [V 80]. It is simple, but the docs list "limited scalability" and "inflexible" as cons [V 80]. The gateway pattern centralises credentials and policy at the cost of one more thing to run and added latency [V 81]. No collector at all couples application code to the backend [V 82]. Tail sampling needs the load-balancing exporter keyed by trace id so a trace lands on one collector [V 81]. For one operator, a single DaemonSet or a single gateway Deployment is enough; a sidecar per harness pod multiplies memory across a packed node [I].

| Backend | Ingest | Conventions understood | Self-host footprint | Licence |
| --- | --- | --- | --- | --- |
| Langfuse | OTLP over HTTP at `/api/public/otel`; gRPC "not supported yet" [V 83] | `gen_ai.*`, OpenInference, MLflow, `langfuse.*` [V 83] | Web, worker, Postgres, ClickHouse, Redis or Valkey, S3 [V 84] | Open source core; some add-ons need a licence key [V 84] |
| Arize Phoenix | OTLP gRPC on 4317, HTTP on 6006 `/v1/traces` [V 86] | OpenInference; built on OpenTelemetry [V 85] | Single service; SQLite by default, Postgres supported; Helm chart [V 85][V 86] | Elastic License 2.0 [V 85] |
| OpenLLMetry | Library, exports to any OTLP backend [V 88] | Its own gen-ai attributes; Anthropic instrumented; Python and JS [V 88] | None | Apache-2.0 [V 88] |
| OpenInference Anthropic | Library; `openinference-instrumentation-anthropic` 2.1.5 [V 87] | OpenInference | None | Part of Phoenix ecosystem |

**How the dashboard consumes it [I].** Keep two streams. Telemetry (spans, metrics, events) flows harness → collector → Langfuse or Phoenix, and the dashboard queries that backend's API for traces, tokens, and cost. Domain events (conversation started, waiting, resumed, task completed) stay in the application's own event log in Postgres, which the dashboard already reads. If the backend API is too slow for live views, a collector can fan the OTLP stream to a second exporter feeding the dashboard's own store. Avoid a tool call whose side effect is a dashboard write. It couples the agent to a consumer and duplicates what the trace already carries.

## 6. Recommendation frame

**Conclusion.** Three coherent architectures exist. They differ mainly in what extra stateful component you agree to run. Each has a clear signal that says it is time to move to the next.

| | A. Claimed loop (evolve the current design) | B. Durable engine | C. Actor per conversation |
| --- | --- | --- | --- |
| Execution | Stateless harness replicas claim conversations from Postgres; SKIP LOCKED plus lease [current design] | Harness written as workflow; LLM and tool calls are steps; engine journals them [V 23][V 17][V 20] | Conversation is an actor with sticky routing and idle sleep [V 1][V 8][V 9] |
| Routing | Inbox table with unique delivery id; wake by claim; running loop listens for new rows [I] | Engine addresses workflow or object by id; awakeables or signals [V 17][V 14][V 25] | Placement directory or name-based routing; one turn at a time [V 1][V 7] |
| Memory | Transcript in Postgres or S3 behind a `SessionStore`-shaped adapter [V 46]; long-term memory as files via the memory tool [V 49]; working tree in a sandbox | Journal is the transcript of record; long-term memory as above | Actor's own state store (SQLite per actor on Cloudflare, Postgres on Rivet) [V 7][V 10] |
| Scaling | Deployment + KEDA Postgres scaler to zero [V 27][V 28] | DBOS: same as A; Restate: StatefulSet + PV + S3 [V 18]; Temporal: server cluster + DB [V 16] | Dapr: Deployment with min 1 replica [V 90]; Rivet: control plane + workers [V 10]; Cloudflare: none, but off Kubernetes |
| Sandbox | Separate agent-sandbox pod or hosted E2B per conversation [V 55][V 69] | Same | Same |
| Observability | OTel GenAI spans → collector → Langfuse or Phoenix; dashboard reads backend [V 77][V 83][V 86] | Same, plus engine UI | Same |
| What you operate | Kubernetes, Postgres, collector, one LLM trace backend | A plus the engine (DBOS: nothing extra; Restate: one StatefulSet plus S3; Temporal: several services) | A plus placement or control plane; or a hosted edge platform |
| Move-on signal | Resume latency dominated by history load; need for per-conversation live connections; second operator | Determinism friction or history limits on the loop [V 12]; code-version skew on replay | Need for many live sockets per conversation; sub-second wake with warm state |

**Operating cost for a single operator [I].** A runs on things aesir already has; the additions are a KEDA install, a collector, and one trace backend. Phoenix with Postgres is the lighter backend [V 86]; Langfuse needs ClickHouse, Redis and S3 as well [V 84]. B with DBOS costs almost nothing extra because it is a library on the same Postgres [V 23], but rewrites the loop as steps. B with Restate adds one stateful service and an object store [V 18]. B with Temporal adds the most. C on Kubernetes (Dapr or Rivet) adds a control plane and a placement service to keep healthy. C on Cloudflare removes the cluster entirely, but moves the runtime off the owner's "microservices in a cluster" target.

**The single most important tradeoff.** State locality versus operational surface. Actors and durable engines keep a conversation's state next to its execution and give clean pause semantics. Each adds a stateful control plane you must run, upgrade, and reason about during failures. The claimed loop keeps Postgres as the only stateful thing, and pays with a full history load on every resume and a poll-based wake. Which side wins depends on the ratio of paused to active conversations and on transcript size [I]. The current system can measure both before any migration [I].

## Sources

Dates are as shown on the page; "n.d." means the page showed none.

1. Dapr, Actor runtime features, updated 2026-09-11: https://docs.dapr.io/developing-applications/building-blocks/actors/actors-features-concepts/
2. Microsoft Learn, Orleans overview, updated 2026-06-29: https://learn.microsoft.com/en-us/dotnet/orleans/overview
3. Microsoft Learn, Orleans grain lifecycle, updated 2026-03-30: https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-lifecycle
4. Microsoft Learn, Orleans Kubernetes hosting, updated 2026-06-29: https://learn.microsoft.com/en-us/dotnet/orleans/deployment/kubernetes
5. Akka, Cluster Sharding (typed), version 2.10.22, n.d.: https://doc.akka.io/libraries/akka-core/current/typed/cluster-sharding.html
6. Cloudflare, Durable Object lifecycle, updated 2026-07-03: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
7. Cloudflare, Durable Objects limits, updated 2026-06-01: https://developers.cloudflare.com/durable-objects/platform/limits/
8. Cloudflare, Agents: long-running agents, updated 2026-08-20: https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/
9. Rivet, Actors lifecycle, n.d.: https://rivet.dev/actors/docs/lifecycle/
10. Rivet, Self-host, n.d.: https://rivet.dev/actors/self-host/
11. Temporal, Workflow Execution, n.d.: https://docs.temporal.io/workflow-execution
12. Temporal, Workflow Execution limits, n.d.: https://docs.temporal.io/workflow-execution/limits
13. Temporal, Workflow Id and Run Id, n.d.: https://docs.temporal.io/workflow-execution/workflowid-runid
14. Temporal, Handling Signals, Queries and Updates, n.d.: https://docs.temporal.io/handling-messages
15. Temporal, Workers, n.d.: https://docs.temporal.io/workers
16. Restate, Restate vs Temporal, n.d.: https://restate.dev/vs/temporal
17. Restate, External events (TypeScript), n.d.: https://docs.restate.dev/develop/ts/external-events
18. Restate, Kubernetes deployment, n.d.: https://docs.restate.dev/deploy/server/kubernetes
19. Inngest, Durable agents, n.d.: https://www.inngest.com/docs/learn/durable-agents
20. Inngest, How functions are executed, n.d.: https://www.inngest.com/docs/learn/how-functions-are-executed
21. Inngest, step.waitForEvent reference, n.d.: https://www.inngest.com/docs/reference/functions/step-wait-for-event
22. Inngest, Self-hosting, n.d.: https://www.inngest.com/docs/self-hosting
23. DBOS, Architecture, n.d.: https://docs.dbos.dev/architecture
24. DBOS, Workflows tutorial (TypeScript), n.d.: https://docs.dbos.dev/typescript/tutorials/workflow-tutorial
25. DBOS, Workflow communication (TypeScript), n.d.: https://docs.dbos.dev/typescript/tutorials/workflow-communication
26. KEDA 2.20, Scaling Deployments, StatefulSets and Custom Resources: https://keda.sh/docs/2.20/concepts/scaling-deployments/
27. KEDA 2.20, ScaledObject specification: https://keda.sh/docs/2.20/reference/scaledobject-spec/
28. KEDA 2.20, PostgreSQL scaler: https://keda.sh/docs/2.20/scalers/postgresql/
29. Knative release-1.23, Configuring scale to zero: https://knative.dev/docs/serving/autoscaling/scale-to-zero/
30. Knative release-1.23, KPA-specific settings: https://knative.dev/docs/serving/autoscaling/kpa-specific/
31. Kubernetes v1.37, Feature gates (HPAScaleToZero row): https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/
32. Kubernetes v1.37, Jobs: https://kubernetes.io/docs/concepts/workloads/controllers/job/
33. Kubernetes v1.37, StatefulSets: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/
34. Kubernetes v1.37, Persistent Volumes: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
35. Kubernetes (main), Volumes source (local, emptyDir): https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/concepts/storage/volumes.md
36. Kubernetes v1.37, Pod Quality of Service classes: https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/
37. Kubernetes v1.37, Resource bin packing: https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/
38. Kubernetes v1.37, Considerations for large clusters: https://kubernetes.io/docs/setup/best-practices/cluster-large/
39. Kubernetes, Pod Overhead (stable since v1.24): https://kubernetes.io/docs/concepts/scheduling-eviction/pod-overhead/
40. Kubernetes v1.37, Pod lifecycle (termination): https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
41. Standard Webhooks specification 1.0.0: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
42. GitHub Docs, Best practices for using webhooks, n.d.: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
43. Linear Developers, Webhooks, n.d.: https://linear.app/developers/webhooks
44. Slack Developer Docs, The Events API, n.d.: https://docs.slack.dev/apis/events-api/
45. Claude Agent SDK, Work with sessions, n.d.: https://code.claude.com/docs/en/agent-sdk/sessions
46. Claude Agent SDK, Persist sessions to external storage, n.d.: https://code.claude.com/docs/en/agent-sdk/session-storage
47. Claude Agent SDK, Observability with OpenTelemetry, n.d.: https://code.claude.com/docs/en/agent-sdk/observability
48. Claude Code, Monitoring, n.d.: https://code.claude.com/docs/en/monitoring-usage
49. Claude Platform, Memory tool, n.d.: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
50. Claude blog, Managing context on the Claude Developer Platform, 2025-09-29: https://claude.com/blog/context-management
51. Anthropic Engineering, Effective harnesses for long-running agents, 2025-11-26: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
52. Claude Platform, Managed Agents overview, beta `managed-agents-2026-04-01`: https://platform.claude.com/docs/en/managed-agents/overview
53. Claude Platform, Managed Agents self-hosted sandboxes, beta: https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes
54. Claude Platform, Managed Agents session operations, beta: https://platform.claude.com/docs/en/managed-agents/session-operations
55. kubernetes-sigs/agent-sandbox README, v1.0.2: https://github.com/kubernetes-sigs/agent-sandbox/blob/main/README.md
56. Agent Sandbox docs, Anthropic Managed Agents use case, updated 2026-07-10: https://agent-sandbox.sigs.k8s.io/docs/use-cases/anthropic-managed-agents/
57. LangChain Docs, LangGraph persistence, n.d.: https://docs.langchain.com/oss/python/langgraph/persistence
58. Letta Docs, Core concepts, n.d.: https://docs.letta.com/core-concepts/
59. Letta Docs, Self-hosting, n.d.: https://docs.letta.com/guides/selfhosting/
60. Mem0 Docs, Open source overview, n.d.: https://docs.mem0.ai/open-source/overview
61. Mem0 Docs, OSS v2 to v3 migration, n.d.: https://docs.mem0.ai/migration/oss-v2-to-v3
62. arXiv 2501.13956, Zep: A Temporal Knowledge Graph Architecture for Agent Memory, 2025-01-20: https://arxiv.org/abs/2501.13956
63. Zep Docs, Graphiti welcome, n.d.: https://help.getzep.com/graphiti/getting-started/welcome
64. gVisor, What is gVisor, n.d.: https://gvisor.dev/docs/
65. gVisor, Performance guide, n.d.: https://gvisor.dev/docs/architecture_guide/performance/
66. Kata Containers, Virtualization design, n.d.: https://kata-containers.github.io/kata-containers/design/virtualization/
67. Firecracker, Design, n.d.: https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md
68. Firecracker, Snapshot support, n.d.: https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md
69. E2B Docs, Sandbox persistence, n.d.: https://docs.e2b.dev/sandbox/persistence
70. E2B, Pricing, n.d.: https://e2b.dev/pricing
71. Modal Docs, Sandboxes, n.d.: https://modal.com/docs/guide/sandboxes
72. Modal Docs, Sandbox snapshots, n.d.: https://modal.com/docs/guide/sandbox-snapshots
73. Modal Docs, Security, n.d.: https://modal.com/docs/guide/security
74. Fly.io Docs, Machine suspend and resume, 2025-08-15: https://fly.io/docs/reference/suspend-resume/
75. Fly.io Docs, Pricing (references 2026-01-01 snapshot billing): https://fly.io/docs/about/pricing/
76. Daytona Docs, Persistence, 2026 footer: https://www.daytona.io/docs/en/persistence/
77. OpenTelemetry GenAI semantic conventions README (Status: Development): https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/README.md
78. OpenTelemetry GenAI model spans: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md
79. OpenTelemetry GenAI agent spans: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md
80. OpenTelemetry, Collector agent deployment pattern, n.d.: https://opentelemetry.io/docs/collector/deploy/agent/
81. OpenTelemetry, Collector gateway deployment pattern, n.d.: https://opentelemetry.io/docs/collector/deploy/gateway/
82. OpenTelemetry, No collector pattern, n.d.: https://opentelemetry.io/docs/collector/deploy/other/no-collector/
83. Langfuse, OpenTelemetry integration, n.d.: https://langfuse.com/integrations/native/opentelemetry
84. Langfuse, Self-hosting (v4), n.d.: https://langfuse.com/self-hosting
85. Arize-ai/phoenix README, n.d.: https://github.com/Arize-ai/phoenix
86. Phoenix, Self-hosting configuration, n.d.: https://arize.com/docs/phoenix/self-hosting/configuration
87. PyPI, openinference-instrumentation-anthropic 2.1.5, 2026-09-15: https://pypi.org/project/openinference-instrumentation-anthropic/
88. traceloop/openllmetry README, n.d.: https://github.com/traceloop/openllmetry/blob/main/README.md
89. dapr/dapr issue #4768, Actor autoscaling with KEDA, opened 2022-06-14: https://github.com/dapr/dapr/issues/4768
90. Azure OSS Developer Support blog (secondary), Dapr on Container Apps troubleshooting, 2024-02-12: https://azureossd.github.io/2024/02/12/Container-Apps-General-troubleshooting-with-Dapr-on-Container-Apps/
91. Kubernetes v1.37, Horizontal Pod Autoscaling: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/
