# Deployment shape and cost: one Deployment per agent versus one shared harness pool

Date: 2026-09-27. Research brief for the retarget conversation. Builds on `2026-09-16-scaling-containerised-agents.md` (cited as *scaling §n*) and `2026-09-21-harness-container-gaps.md` (cited as *gaps §n*). No source code from this repository was read. `[V]` means verified from a fetched primary source listed in Sources; `[S]` means secondary only; `[I]` means inferred by me. Where a number is computed, the formula and inputs are shown.

**Summary.** Every hosted agent platform surveyed places compute per *session*, not per agent or per replica: Foundry and AgentCore give each session its own VM, Managed Agents hands sessions to any worker in an environment, and kagent's new alpha line pins each session to a Substrate actor drawn from a worker pool. Per-agent Deployments survive as the shipped kagent v0.10 model, as Knative's per-Revision Deployments, and as Temporal's per-Build-ID Deployments; all three exist to isolate *versions*, not agents. For a Node.js harness whose idle footprint is tens of MiB, the two shapes differ by one to two orders of magnitude in idle memory, KEDA polling and Postgres connections at 100 agents (32×, 75× and 45× on the assumptions in §2), and by a factor of 100 in the number of rollouts. The pool's costs are elsewhere: per-agent identity must be minted per claimed row, per-agent egress needs an L7 proxy rather than NetworkPolicy, and running an old bundle means loading it beside the new one. The hard version-pinning case (paused on A, compute at zero, B rolled out) is cheap only in the pool: a retained version there is a registry artefact, whereas in the per-agent shape it is a Deployment per `(agent, version)` that must be kept until its last paused conversation ends, which is exactly what Temporal's Worker Controller automates. The decision turns on four measured quantities: agent count, the paused-to-active ratio, wake-latency tolerance, and whether any agent needs native dependencies or a distinct base image.

## 1. Precedents for each shape

**Conclusion.** No surveyed product ships "one Deployment per agent" as its scaling unit except kagent's v0.10 line. The others either place per session (Foundry, AgentCore, Managed Agents, kagent v1 alpha, Agent SDK long-running pattern) or per version (Knative, Cloud Run, Temporal). The per-agent Deployment is therefore a Kubernetes-native convenience, not an industry pattern; the per-version Deployment is.

| System | Unit of deployment | Unit of scaling | Unit of identity | Version rollout | In-flight or paused work |
| --- | --- | --- | --- | --- | --- |
| kagent v0.10.x (latest v0.10.2, 2026-09-23) [V] | One Deployment per `Agent` CR; the controller hard-codes `RollingUpdate{MaxUnavailable: 0, MaxSurge: 1}` "in all agent Deployments" (issue #2253) | The Deployment's replicas | The pod; a Service exposes the agent (A2A on `:8080`, *gaps §1*) | Rolling update of that Deployment | Pods replaced; no session pin [I] |
| kagent v1.0.0-alpha1..5 (2026-09-18 to 2026-09-27) [V] | `Agent` pairs an `AgentTemplate` and a `Harness`; `Harness.substrate.workerPoolRef` "references a WorkerPool in the resource's namespace"; the image is "pinned by sha256 digest" | Per session: a `Session` "pins one prepared revision and names one Substrate Actor", created "initially suspended" | The Actor; "Every Actor mounts a Substrate `DurableDir` at `/data`" | A new revision; sessions keep the revision they pinned | Idle work "pauses the actor on its node" for `INPUT_REQUIRED`/`AUTH_REQUIRED`; "terminal work suspends it and records the exact external snapshot" |
| Claude Agent SDK, hosting guide [V] | A container running your app; "One agent session maps to one subprocess" | Subprocesses per container, bounded by RAM: `agents per host = (host RAM - overhead) / (per-session RAM ceiling)`; "1 GiB RAM, 5 GiB disk, and 1 CPU per agent is a reasonable starting point" | The container; per-tenant isolation by `cwd`, `CLAUDE_CONFIG_DIR`, `settingSources: []`, and "per-tenant egress rules at your proxy" | "The bundled binary is pinned to the SDK package version"; no session pin | Long-running pattern: "pin each session to one container using consistent hashing on `sessionId`"; hybrid pattern: ephemeral containers that "hydrate from a `SessionStore`" |
| Managed Agents self-hosted worker [V] | `ant beta:worker poll` (always-on) or `ant beta:worker run` (per session); CLI 1.35.0 | Work items: the worker "claims work items assigned to the environment" | The environment; the model and version live on the agent, not the environment | Agent `version` pinned per session (*gaps §2*); the worker image is yours and unpinned | Any worker may claim the next turn; `--max-idle` 60 s (*gaps §1*); `work.poller()` can spawn "a sandbox for each claimed session" |
| Azure AI Foundry hosted agents [V] | An immutable agent version: "a snapshot of the container image, resource allocation, environment variables, and protocol configuration" | "Hosted agents scale per session, not per replica"; "There's no replica count to configure and no warm pool to size" | "dedicated Microsoft Entra ID (agent identity)" per agent | "An agent endpoint serves one version at a time and routes 100% of its traffic to that version" | Idle 2 to 60 min (default 15); then "Platform provisions new compute and restores persisted state"; session deleted after 30 days idle |
| AWS AgentCore Runtime [V] | An agent runtime = one container image; versions and endpoints hang off it | "each user session runs in a dedicated microVM"; Instances allow "multiple collaborating agents on a shared instance" | "assigns distinct identities to AI agents" | New version; "existing sessions will continue using the previous version until they terminate" (*gaps §2*) | `Stopped` after 15 min idle or 8 h; "a new compute is provisioned" on the next invoke; the version it gets is not stated |
| Temporal workers [V] | A worker binary polling a Task Queue; "all Workers listening to a Task Queue must register all Workflows, Activities, and Nexus Operations that live on that Queue" | Worker processes per task queue | Deployment name + Build ID | Pinned or AutoUpgrade per workflow type; Draining then Drained (*gaps §2*) | "When a Worker Process goes down, the messages remain until the Worker recovers" |
| Temporal Worker Controller (GA) [V] | A `WorkerDeployment` CR; the controller does "Creation of versioned Deployment resources" | Per version: "Attach HPAs or other custom scalers to each versioned Deployment" | Build ID per Deployment (`TEMPORAL_WORKER_BUILD_ID`) | `Manual`, `AllAtOnce`, `Progressive` with `rampPercentage` steps | "Automatically scales down and cleans up old versions once they are drained" |
| LangGraph Platform / LangSmith Deployment [V] | One image from `langgraph.json`; "You can specify one or more graphs in the configuration file" | Stateless API replicas plus queue workers; "each queue worker is configured to execute a set number of concurrent runs (`N_JOBS_PER_WORKER`, by default 10)" | The deployment | New revision = new image; "Configure shutdown draining and sufficient termination windows so in-flight runs can finish" | A sweeper "runs every 2 minutes" and re-queues runs that "breached their heartbeat window" |
| Dapr Agents [V] | A Dapr app; `target_app_id` routes to another app, `None` means "in-process invocation", so agents can share an app or each be one | Actors: "Thousands of agents run on demand on a single core machine with double-digit millisecond latency when scaling from zero" | Dapr app-id | App rollout; workflow replay | `DurableAgent` runs as a Dapr Workflow with "Persistent workflow state management across sessions and failures"; actor hosts cannot scale to zero (*scaling §1*) |
| Knative Serving [V] | A Revision, "an immutable snapshot of code and configuration"; `MakeDeployment(rev)` creates one Deployment named `<revision>-deployment` | Per Revision, KPA to zero | The Revision's pods | Route splits traffic by percentage and tag | Activator queues requests "if a `Knative Service` is scaled-to-zero" and forwards them once up; inactive Revisions garbage-collected after 48 h since create or 15 h since last active, keeping at least 20 |
| Cloud Run [V] | A revision | "each Cloud Run revision is automatically scaled to the number of instances needed"; idle instances kept "up to 15 minutes" | A service account per service | "Cloud Run starts enough instances of the new revision before directing traffic to it" | Old instances may exceed limits "for a grace period ... up to 15 minutes, or up to the value specified in the request timeout" |

Two details deserve emphasis. Foundry's model is the purest "compute follows the session": "Compute follows the session, not the individual request" and billing is "cpu + memory consumed across all active sessions, so oversizing multiplies cost by your concurrency" [V]. And kagent's move between September releases is the only case of a Kubernetes agent project abandoning Deployment-per-agent; its replacement is a pool per namespace plus a snapshot per template revision plus an actor per session [V]. Its Substrate dependency is at `v0.3.0-alpha1` [V], so treat the model as direction, not as a shipped baseline.

## 2. Cost model at 10 and 100 agents

**Conclusion.** For a thin Node.js harness, idle memory per warm pod is tens of MiB, so the per-agent shape's cost is not memory but multiplicity: one ScaledObject, one Postgres connection, one claim loop and seven API objects per agent. At 100 agents with modest traffic the per-agent shape runs about 63 warm pods, 450 KEDA queries and 3,800 claim queries per minute against Postgres, and holds about 226 idle connections; the pool runs 2 pods, 6 KEDA queries and 120 claim queries per minute, and 5 connections. If the harness spawns a Claude Code subprocess per session, active memory is 1 GiB per active turn in both shapes and the difference stays in the idle floor.

### Measured inputs

| Quantity | Value | Source and label |
| --- | --- | --- |
| Node 22 `node:http` hello-world container, idle cgroup working set | 15.9 MiB (Alpine 3.22, Node 22.22.3), 22.9 MiB (Ubuntu 26.04, Node 22.22.1); WS = `max(0, memory.current - inactive_file)`; report 2026-09-27 | Third-party benchmark with published method [V of its own report] |
| Node 22.23.2 idle RSS, bare | 39.1 MiB (three runs) | Measured this session on darwin arm64 with `process.memoryUsage().rss`; not a Linux cgroup figure |
| Same, plus an HTTP server, a keep-alive HTTPS agent and `fetch` loaded | 51.3 MiB | Measured this session, as above |
| Same, plus `pg` 8.23.0 `Pool` constructed, unconnected | 58.5 MiB | Measured this session, as above; no published Node-with-Postgres-client figure was found |
| Agent SDK per-session floor when each session is a `claude` subprocess | "1 GiB RAM ... is a reasonable starting point"; "a floor, not the ceiling" | [V] |
| Pause container per pod | about 1 MiB | [S] |
| Idle Postgres backend, server side | "below 2 MiB" with huge pages (PG 12/13, 2020) | [V] |
| Default pods per node | `MaxPods = 110` in kubelet defaults; cluster design limits "No more than 110 pods per node ... 150,000 total pods ... 300,000 total containers" | [V] |
| Pod IPs per node | GKE: a /24 (256 addresses) per node at 110 pods, "more than twice as many available IP addresses as the maximum number of Pods"; EKS managed node groups cap `maxPods` at 110 below 30 vCPUs and 250 above | [V] |
| etcd | 1.5 MiB request limit; 2 GiB default quota; "8 GiB is a suggested maximum" | [V] |
| KEDA polling | "KEDA will check each trigger source on every ScaledObject every 30 seconds"; `cooldownPeriod` 300 s; the HPA "asks for a metric every few seconds (as defined by `--horizontal-pod-autoscaler-sync-period`, usually 15s), then this request is routed to KEDA Metrics Server, that by default queries the scaler"; `useCachedMetrics` default `false` | [V] |
| HPA at zero replicas | `if currentReplicas == 0 { ... "scaling is disabled since the replica count of the target is zero" }` with no metric computation, so at zero only the KEDA poll runs | [V code] |
| KEDA Postgres scaler | Opens one `*sql.DB` in the constructor and keeps it; no `SetMaxOpenConns`/`SetMaxIdleConns`; each poll runs `QueryRowContext(ctx, s.metadata.Query)`; activates when `num > ActivationTargetQueryValue` | [V code] |
| KEDA operator | "only one operator instance will be active"; `KEDA_SCALEDOBJECT_CTRL_MAX_RECONCILES` default 5 | [V] |
| Deployment rollout | `maxSurge` and `maxUnavailable` default 25 %; `revisionHistoryLimit` keeps 10 old ReplicaSets at zero replicas; `progressDeadlineSeconds` 600 | [V] |
| HPA | sync 15 s; tolerance 10 %; downscale stabilisation 5 min; "For scaling up there is no stabilization window" | [V] |
| Firecracker density (for the per-session-VM comparison) | "memory overhead of less than 5MB per container, boots to application code in less than 125ms, and allows creation of up to 150 MicroVMs per second per host"; "up to 8000 functions on a server" | [V] |

### Assumptions (replace each number)

- `A` = 20 active turns per minute platform-wide; `T` = 0.5 min mean turn; `C` = 20 concurrent turns per pool replica; `P` = 1,000 paused conversations (paused rows cost no compute in either shape).
- Turns are spread evenly across `N` agents, so an agent's arrival rate is `λ = A / N` per minute and the chance it has a warm pod is `1 - e^(-λ × cooldown)` with `cooldown` = 5 min [I; Poisson arrivals].
- `M_idle` = 64 MiB per thin harness replica (anchored on 23 MiB Linux WS for hello-world and 58 MiB darwin RSS with clients loaded); `O_pod` = 5 MiB per pod (pause plus shim and cgroup accounting) [I].
- Claim loop polls Postgres every 1 s per warm replica (60 queries per minute); `LISTEN/NOTIFY` would remove most of this [I].
- Each harness replica holds 2 idle Postgres connections; each ScaledObject holds 1 (from the scaler code).
- Pool minimum 2 replicas for availability; per-agent minimum 0 (KEDA `minReplicaCount` 0).
- Seven API objects per scaled unit: Deployment, ReplicaSet, Service, ServiceAccount, ScaledObject, HPA, NetworkPolicy [I].

### Results

Formulas: warm pods `W = N × (1 - e^(-5A/N))` (per agent) or `max(2, ceil(A × T / C))` (pool); idle memory `W × (M_idle + O_pod)`; KEDA queries per minute `W × 6 + (N - W) × 2` (per agent) or `6` (pool); claim queries `W × 60`; connections `N + 2W` (per agent) or `1 + 2W` (pool); objects `7N` or `7`.

| Quantity | N = 10, per agent | N = 10, pool | N = 100, per agent | N = 100, pool |
| --- | --- | --- | --- | --- |
| Warm pods | 10.0 | 2 | 63.2 | 2 |
| Idle memory, thin harness | 690 MiB | 138 MiB | 4.4 GiB | 138 MiB |
| Active memory, SDK-subprocess regime | `A × T × 1 GiB` = 10 GiB in both shapes | same | 10 GiB in both shapes | same |
| KEDA scaler queries per minute | 60 | 6 | 453 | 6 |
| Claim-loop queries per minute | 600 | 120 | 3,793 | 120 |
| Idle Postgres connections (server-side MiB at 2 MiB each) | 30 (60 MiB) | 5 (10 MiB) | 226 (453 MiB) | 5 (10 MiB) |
| API objects | 70 | 7 | 700 | 7 |
| Rollouts per harness release | 10 | 1 | 100 | 1 |
| Nodes for pods alone (110 per node) | 1 | 1 | 1 | 1 |
| Wake latency, warm | claim poll ≈ 1 s + history load | same | same | same |
| Wake latency, from zero | KEDA poll 0 to 30 s (mean 15) + schedule ≈ 1 s + image pull (cached 1 to 3 s, cold 10 to 30 s [I]; AgentCore's published analogue is 2 s P75 on V2 and 5.4 to 30 s on V1, *gaps §5*) + Node start ≈ 1 s + first claim ≈ 1 s → mean ≈ 20 s, worst ≈ 65 s | Only when the whole platform is idle | Any of the 37 cold agents pays it on every wake | Only when the whole platform is idle |

Control-plane cost is real but small at these counts: 700 objects at a few KiB each is a few MiB of etcd against a 2 GiB quota [I], and 100 HPAs cost the HPA controller 400 evaluations per minute [V sync period]. The costs that scale with `N` and bite are the KEDA connections and queries (one held connection per ScaledObject, no pool limits in the scaler [V]) and the claim polling from warm pods. A hundred pods claiming every second is 63 queries per second for nothing [I]; both shapes should wake claimers by `LISTEN/NOTIFY` or by a webhook-driven scale call, as Managed Agents' webhook handler does (*gaps §5*).

## 3. Version pinning mechanics in both shapes

**Conclusion.** Kubernetes has no primitive that keeps an old version's pods alive until their work ends: a rolling update kills old pods, and old ReplicaSets are kept only at zero replicas [V]. Every precedent that pins work to a version therefore runs one Deployment per version (Temporal Worker Controller, Knative Revisions) or pins at the session and provisions compute on demand (Foundry, AgentCore, kagent alpha). The pool makes pinned-by-default cheap because a retained version is a bundle, not a workload.

| System | How a paused execution stays on version A after B rolls out | Drain signal | Cost of a retained version |
| --- | --- | --- | --- |
| Temporal Worker Versioning + Worker Controller [V] | Pinned workflows are "guaranteed to complete on a single Worker Deployment Version"; tasks wait in the queue for a Build-ID-A poller ("the messages remain until the Worker recovers"); the controller keeps the versioned Deployment and "Automatically scales down and cleans up old versions once they are drained" | `Draining` while "open pinned Workflows" exist; `Drained` when "All the pinned Workflows that were running on it are closed"; "drainage status is updated only periodically" | A Deployment with ≥ 1 replica for as long as any pinned workflow is open, days included; a per-version HPA can shrink it but not to zero without HPAScaleToZero [I] |
| Managed Agents [V, *gaps §2*] | The session records `agent.version`; `system` "is fixed for the session's lifetime"; the loop runs on Anthropic's side, so the self-hosted worker image is not the pinned artefact | None documented | None on your side |
| Foundry [V] | "Each session is bound to a single version at creation time"; on resume the platform "provisions new compute and restores persisted state" on that version [I: the binding is stated, the resume path's version is not restated] | None; the endpoint serves one version at a time | Platform-internal |
| AgentCore [V, *gaps §2*] | "existing sessions will continue using the previous version until they terminate"; V2 keeps the old snapshot "until existing sessions end"; what a `Stopped` session gets on new compute is not stated | Snapshot deletion after sessions end | Platform-internal |
| Knative Revisions [V] | An old Revision keeps its own Deployment at zero replicas; a tagged Route still reaches it and the activator scales it from zero; GC waits 48 h since create, 15 h since last active, and keeps at least 20 | Route references | One Deployment and Service at zero replicas per version |
| kagent v1 alpha [V] | Each Session "pins one prepared revision"; a suspended session resumes from "the exact external snapshot" | Not documented in the pages read | A snapshot in object storage (`snapshotPolicy.location`) |

**Per-agent Deployment shape.** Pinned-by-default means one Deployment per `(agent, version)`, each with a ScaledObject whose query filters on both, and a controller or script that deletes the pair when the count of open conversations pinned to it reaches zero [I]. That count is the drain signal, the same role Temporal's `Drained` plays [V]. Cost per retained version: 7 objects, 2 KEDA queries per minute, 1 held Postgres connection, and 0 pods until a wake; the wake then pays the from-zero latency in the table in §2. At 100 agents with 3 live versions each that is 2,100 objects, 600 queries per minute and 300 idle connections from KEDA alone [I, formula `3N × (7, 2, 1)`].

**Shared pool shape.** The pool must run bundle A and bundle B in the same process family. Three mechanisms exist [I]: (a) load each `(agent, version)` bundle from a version-specific path, which works because Node caches modules "based on their resolved filename" [V], so two versions coexist; (b) run each bundle in a `worker_thread` or child process for fault isolation, at the cost of a per-turn spawn; (c) pull the bundle at claim time as an OCI artefact by digest with `oras` [V that ORAS pulls arbitrary artefacts] and cache it on the node. All three break when a bundle needs native dependencies or a different base image; that agent then needs its own image and a per-version pool or per-agent Deployment [I]. Cost of a retained version: registry storage and a cache entry; no objects, no polling, no connections.

## 4. Identity and network policy per shape

**Conclusion.** Kubernetes identity and network policy attach to the pod: `spec.serviceAccountName` selects one ServiceAccount, and NetworkPolicy selects pods by label [V]. The per-agent Deployment gets both for free. The pool must carry identity per claimed row, and every shared-runtime precedent does exactly that: the runtime has one host identity and the workload's identity is a claim it is handed.

| Mechanism | Granularity | What a shared pool can do with it |
| --- | --- | --- |
| ServiceAccount and bound tokens [V] | Per pod; tokens are "short-lived, automatically rotating", mounted as a projected volume, with audiences and expiry | Request a token for the *agent's* ServiceAccount per turn through the TokenRequest API (`create` on `serviceaccounts/token`; `kubectl create token my-sa --bound-object-kind="Pod"`) and present it to downstream services and the egress gateway [I on the pattern, V on the API] |
| NetworkPolicy [V] | Per pod by label, namespace, or CIDR; cannot do "Targeting of services by name", "Anything TLS related", or explicit deny | Nothing per agent; per-agent egress needs an L7 proxy with a per-identity allowlist (agentgateway, Envoy; *gaps §3*) |
| SPIFFE/SPIRE k8s attestor [V] | Selectors are `k8s:ns`, `k8s:sa`, `k8s:pod-label`, `k8s:container-name`, `k8s:container-image`, `k8s:pod-uid`; the attestor works "retrieving the workload's pod ID from its cgroup membership, then querying the kubelet" | One SVID per pool pod; agent identity must travel as a claim inside the request, not as the SVID |
| Cloud Run service identity [V] | Set on the service: "The identity (a service account) that the Cloud Run instance uses"; "User-managed service account (recommended)" | A per-service pool is the Cloud Run unit; no sub-service identity |
| AWS Lambda on Firecracker [V] | "Lambda automatically assumes your execution role when you invoke your function"; hosts run "up to 8000 functions on a server"; "Slots are only ever used for a single function" | The canonical shared host with per-workload identity: the host is trusted, each slot carries one function's role |
| Cloudflare Workers [V] | "A single instance of the runtime can run hundreds or thousands of isolates"; "Each isolate's memory is completely isolated" | Per-script bindings inside one process |
| Foundry and AgentCore [V] | "dedicated Microsoft Entra ID (agent identity)" per agent; AgentCore "assigns distinct identities to AI agents" | Per-agent identity issued by the platform, compute per session; the identity is not a Kubernetes object |
| Managed Agents vaults (*gaps §3*) [V] | Credentials scoped per agent; the environment worker is shared across agents | Not available to self-hosted sandboxes, which is the gap the pool would have to fill with a gateway |

The pool's identity story is therefore Lambda's: a trusted host, a per-row identity minted at claim time, and an egress gateway that maps that identity to upstream credentials (*gaps §3*). Its weakness is the blast radius. A pool pod that is compromised can request tokens for every agent's ServiceAccount its RBAC allows [I], whereas a per-agent pod holds one. Splitting the pool per trust tier (§5) bounds that.

## 5. Hybrid shapes that ship

**Conclusion.** Everyone who runs many agents on shared infrastructure ends up with a pool plus a per-session unit plus a warm layer. The differences are where the warm layer sits (pod, snapshot, or min-instances) and whether the per-session unit is a VM, an actor, or a subprocess.

| Hybrid | Who ships it | What it buys |
| --- | --- | --- |
| Worker pool per namespace + per-session actor + per-revision golden snapshot | kagent v1 alpha: `WorkerPool` per namespace, `Session` pins a revision and an Actor, "Golden snapshot ready" per template revision [V] | Pinned sessions without per-version pods; suspend and resume from snapshot; one pool to roll |
| Warm pod pool claimed per session | agent-sandbox `SandboxWarmPool`: a sandbox "can be assigned in milliseconds rather than waiting for a cold pod to schedule and start" [V]; Managed Agents on agent-sandbox (*scaling §4*) | Sub-second wake for the sandbox half; the loop stays elsewhere |
| Snapshot-based cold start per session | AgentCore V2 snapshot on first healthy ping, ~2 s P75 (*gaps §5*) [V]; Instances for "multiple collaborating agents on a shared instance" [V] | Per-session VMs with pool-like start times; a shared instance for agent teams |
| Environment pool serving many agents, per-session sandbox on demand | Managed Agents: one `poll` worker per environment; `run` or `work.poller()` "spinning up a sandbox for each claimed session" [V] | One pool to operate; isolation opt-in per session |
| Per-version Deployments with per-version autoscalers | Temporal Worker Controller: "Attach HPAs or other custom scalers to each versioned Deployment" [V]; Knative Revisions [V] | Safe rollouts with pinned work; the pool is per version, not per agent |
| Long-running container pool with session affinity | Agent SDK: "run a pool of containers behind a load balancer and pin each session to one container using consistent hashing on `sessionId`" [V] | Many sessions per container; warm subprocesses via `startup()`/`prewarm()` |
| Min-instances warm floor per service | Cloud Run minimum instances; idle instances kept "up to 15 minutes" [V] | Dedicated warm capacity only for the services that need it |
| Pool per trust tier, dedicated Deployment for native dependencies | Not observed as a product; the natural composition of the above [I] | Bounds the token blast radius in §4 and keeps the pool's bundle loader pure-JS |

## 6. Recommendation criteria

**Conclusion.** Measure four things before choosing: `N` (agent types), `P / (A × T)` (paused per concurrently active), the wake-latency budget for a resumed conversation, and whether any bundle needs a native dependency. Each condition below names the number or precedent it rests on.

**One Deployment per agent image wins when:**

1. `N` is small and stays small, roughly `N ≤ 10`, because the per-agent overheads in §2 (60 KEDA queries per minute, 30 connections, 10 rollouts) are tolerable there and grow linearly; kagent v0.10 shipped this shape and its v1 alpha line replaces it with a pool [V].
2. Agents need distinct base images or native dependencies, since the pool's bundle loader (§3) cannot host them [I]; Foundry and AgentCore also treat the image as the agent's unit for this reason [V].
3. Per-agent identity and egress must be Kubernetes-native for audit, because ServiceAccount and NetworkPolicy attach to pods [V] and a pool would need TokenRequest plus an L7 gateway instead (§4).

**One shared harness pool wins when:**

1. `N ≥ 50` or version churn is high, because a pinned version costs the pool a registry artefact and costs the per-agent shape 7 objects, 2 queries per minute and a held connection per `(agent, version)` (§3); at 100 agents and 3 live versions that is 2,100 objects and 300 idle connections for zero pods [I].
2. The paused-to-active ratio is high (`P ≫ A × T`, say above 20), because paused rows cost nothing in either shape but every *wake* of a cold agent pays 20 to 65 s in the per-agent shape and about 1 s in a warm pool (§2); Managed Agents, LangGraph and Temporal all run this shape for the same reason [V].
3. The harness is thin (tens of MiB idle) rather than a 1 GiB subprocess per session, because then the pool's density advantage is real and the memory argument for per-session VMs (Foundry, AgentCore) does not apply [V for the 1 GiB floor, measured for the thin figure].

**Either shape, with the hybrid from §5, when:**

1. A minority of agents have native dependencies or a higher trust tier: pool for the rest, dedicated Deployment for those [I].
2. Wake latency under 5 s is required for cold agents: neither shape meets it from zero with KEDA's 30 s poll; a webhook-driven scale call or a min-replica floor is needed regardless (*gaps §5*) [V for the poll, I for the remedy].

## Sources

Dates are as shown on the page or as read on 2026-09-27; "n.d." means none shown. Failed fetches: kagent.dev docs (HTTP 500), kagent `manifest_builder.go` at the paths given by search (404; the tree at `main` no longer has it, so issue #2253 is the code citation), `docs.langchain.com/langsmith/deployment-architecture` (404), Medium (403), Microsoft Tech Community mirror of the Freund post (no body), Kubernetes TokenRequest API reference (served CSIDriver content; the admin page was used instead).

1. Claude Agent SDK, Hosting the Agent SDK, n.d.: https://code.claude.com/docs/en/agent-sdk/hosting
2. Claude Platform, Managed Agents self-hosted sandboxes, beta, CLI 1.35.0: https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes
3. Microsoft Learn, Hosted agents in Foundry Agent Service, ms.date 2026-09-11, updated 2026-09-14: https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents
4. AWS, AgentCore Runtime isolated sessions, n.d.: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html
5. AWS, Host agent or tools with AgentCore Runtime, n.d.: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
6. Temporal, Workers, n.d.: https://docs.temporal.io/workers
7. Temporal, Task Queue, n.d.: https://docs.temporal.io/task-queue
8. Temporal, Worker Versioning, n.d.: https://docs.temporal.io/worker-versioning and https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning
9. Temporal, Kubernetes Worker Controller, n.d.: https://docs.temporal.io/production-deployment/worker-deployments/kubernetes-controller
10. temporalio/temporal-worker-controller README (main): https://github.com/temporalio/temporal-worker-controller
11. Knative, Serving architecture, release-1.23: https://knative.dev/docs/serving/architecture/
12. Knative, Target burst capacity: https://knative.dev/docs/serving/load-balancing/target-burst-capacity/
13. Knative, Configuring scale to zero: https://knative.dev/docs/serving/autoscaling/scale-to-zero/
14. Knative, Revision GC config options and `config/core/configmaps/gc.yaml` (main): https://knative.dev/docs/serving/revisions/revision-admin-config-options/ and https://github.com/knative/serving/blob/main/config/core/configmaps/gc.yaml
15. knative/serving `pkg/reconciler/revision/resources/deploy.go` and `names/names.go` (main): https://github.com/knative/serving/tree/main/pkg/reconciler/revision/resources
16. Knative specs, Serving overview (main): https://github.com/knative/specs/blob/main/specs/serving/overview.md
17. Google Cloud, Cloud Run instance autoscaling, n.d.: https://docs.cloud.google.com/run/docs/about-instance-autoscaling
18. Google Cloud, Cloud Run service identity, n.d.: https://docs.cloud.google.com/run/docs/securing/service-identity
19. kagent issue #2253, rollout strategy in `SharedDeploymentSpec`, 2026-07-15: https://github.com/kagent-dev/kagent/issues/2253
20. kagent releases (v0.10.0 2026-09-04 through v1.0.0-alpha5 2026-09-27): https://github.com/kagent-dev/kagent/releases
21. kagent `go/api/v1alpha3/harness_types.go` and `runtime_types.go` (main, read via the GitHub API): https://github.com/kagent-dev/kagent/tree/main/go/api/v1alpha3
22. kagent `docs/architecture/runtime-and-lifecycle.md` and `docs/architecture/sandboxes.md` (main): https://github.com/kagent-dev/kagent/tree/main/docs/architecture
23. LangChain Docs, Application structure, n.d.: https://docs.langchain.com/langsmith/application-structure
24. LangChain Docs, Scalability and resilience, n.d.: https://docs.langchain.com/langsmith/scalability-and-resilience
25. LangChain Docs, Self-host standalone servers, n.d.: https://docs.langchain.com/langsmith/deploy-standalone-server
26. dapr/dapr-agents README (main): https://github.com/dapr/dapr-agents
27. Dapr Docs, Dapr Agents core concepts, n.d.: https://docs.dapr.io/developing-ai/dapr-agents/dapr-agents-core-concepts/
28. Kubernetes v1.37, Considerations for large clusters: https://kubernetes.io/docs/setup/best-practices/cluster-large/
29. kubernetes/kubernetes `pkg/kubelet/apis/config/v1beta1/defaults.go` (master): https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/apis/config/v1beta1/defaults.go
30. Kubernetes, kube-controller-manager reference: https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/
31. Kubernetes v1.37, Horizontal Pod Autoscaling: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/
32. kubernetes/kubernetes `pkg/controller/podautoscaler/horizontal.go` (master): https://github.com/kubernetes/kubernetes/blob/master/pkg/controller/podautoscaler/horizontal.go
33. Kubernetes v1.37, Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
34. Kubernetes v1.37, Network Policies: https://kubernetes.io/docs/concepts/services-networking/network-policies/
35. Kubernetes v1.37, Service Accounts: https://kubernetes.io/docs/concepts/security/service-accounts/
36. Kubernetes v1.37, Managing Service Accounts: https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/
37. Google Cloud, GKE flexible Pod CIDR, n.d.: https://docs.cloud.google.com/kubernetes-engine/docs/how-to/flexible-pod-cidr
38. AWS, EKS choosing an instance type, n.d.: https://docs.aws.amazon.com/eks/latest/userguide/choosing-instance-type.html
39. etcd v3.5, System limits: https://etcd.io/docs/v3.5/dev-guide/limit/
40. KEDA 2.20, ScaledObject specification: https://keda.sh/docs/2.20/reference/scaledobject-spec/
41. KEDA 2.20, Scaling Deployments: https://keda.sh/docs/2.20/concepts/scaling-deployments/
42. KEDA 2.20, Concepts: https://keda.sh/docs/2.20/concepts/
43. KEDA 2.20, Operate: cluster: https://keda.sh/docs/2.20/operate/cluster/
44. kedacore/keda `pkg/scalers/postgresql_scaler.go` (main): https://github.com/kedacore/keda/blob/main/pkg/scalers/postgresql_scaler.go
45. dsegan/docker-memory-overhead README (branch `trunk`, report 2026-09-27): https://github.com/dsegan/docker-memory-overhead
46. Node.js, Modules: CommonJS modules, Caching (page shows v26.10.0): https://nodejs.org/api/modules.html
47. Andres Freund, Analyzing the limits of connection scalability in Postgres, 2020-10-08: https://www.citusdata.com/blog/2020/10/08/analyzing-connection-scalability/
48. Agache et al., Firecracker: Lightweight Virtualization for Serverless Applications, NSDI '20: https://www.usenix.org/system/files/nsdi20-paper-agache.pdf
49. AWS, Lambda execution role, n.d.: https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html
50. Cloudflare, How Workers works, n.d.: https://developers.cloudflare.com/workers/reference/how-workers-works/
51. spiffe/spire, Kubernetes workload attestor (main): https://github.com/spiffe/spire/blob/main/doc/plugin_agent_workloadattestor_k8s.md
52. Agent Sandbox docs, n.d.: https://agent-sandbox.sigs.k8s.io/docs/
53. ORAS docs, n.d.: https://oras.land/docs/
54. Secondary: A. Singh, How pause containers skew your Kubernetes CPU/memory metrics, Medium, n.d.: https://medium.com/@amolsingh.singh23/digging-deeper-how-pause-containers-skew-your-kubernetes-cpu-memory-metrics-c50f3832cbe0
55. Secondary (search summary only): tesserix agentic-registry kagent adapter on pkg.go.dev: https://pkg.go.dev/github.com/tesserix/agentic-registry/adapters/kagent
56. Local measurements this session: `mem_base.mjs`, `mem_http.mjs`, `pgmeasure/mem_pg.mjs` and `model.py` in the session scratchpad; Node v22.23.2, darwin arm64, `pg` 8.23.0.
