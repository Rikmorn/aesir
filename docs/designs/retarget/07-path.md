# Topic 7: the path

Status: seeded 2026-09-16 with a first sketch of the package shape the positions imply, written as a curiosity answer at the end of session 1. Not a plan; nothing is decided; topics 3 and 5 can change it materially.

## The package shape if the positions stand

| Today | Becomes | Note |
|---|---|---|
| `packages/agents/src/shared/agent-loop`, `framework/history-manager`, `framework/lifecycle-hooks`, the bundled tool implementations | **`harness`** (new): the executable inside the agent container: loop behind a model port, context management, tool execution, hooks and skills loading, the message API, a client for the conversation store's claim and pause | The loop already binds only the Messages client, so the port is a refactor, not a rewrite |
| `packages/agents/definitions/*` (YAML plus prompt) and `AgentRegistry` | **agent bundles** (manifest, guidance layers, bundled tool code) plus a **build** tool that produces an image from a manifest and emits cluster objects | The registry's validation becomes the manifest schema at build; loading from disk into one process disappears |
| `framework/conversation-executor`, the claim SQL in `worker-loop.ts`, `event-log`, `timeout-scheduler`, `schedule-registry`, `session-projection` | **platform services**: conversation store with the claim, heartbeat and pause model; event log; scheduler | The part of today's runtime to protect; it moves behind an API the harness calls |
| `framework/event-router`, `router/*`, the integrations' webhook and OAuth halves | **ingress** and **vault**: stable endpoints, delivery persisted and deduplicated on the provider's delivery id, routing by declared subscriptions, OAuth callbacks, credentials substituted at egress | The LLM slow path is deleted; the hardcoded signal map is replaced by subscriptions in manifests |
| `packages/integrations/{linear,github,slack}` (three services, their MCP tool endpoints, their schemas) | Split: inbound adapters and outbound tool code become **first-party bundles** built on the public extension API; the services as long-running processes go | The largest reshaping by lines; correlation tables fold into the ingress inbox and the store |
| `packages/platform/src/sandbox` (dev container manager over the host socket) | A **sandbox runtime** the harness calls (a separate pod or microVM), not the agent's own container | Removes root and the host socket from the agent boundary |
| `packages/agents/src/shared/tools/task/*`, tree budgets, task groups, the dispatcher | A **graph runtime** (nodes, edges, joins, budgets, signals, bounds, audit), in the harness or as a platform service, keeping the graph-essential parts | Depends on topic 5; the handshake, peer discovery and human handoff are the candidates to drop |
| `packages/observability` | OpenTelemetry emission in the harness plus a collector and a backend the dashboard reads | The package is small today |
| `packages/dashboard` | Stays a separate service (ADR-0012); reads the store and the telemetry backend instead of agents' tables | The task and delegation graph UI stays if the graph runtime stays |
| `packages/platform` (config, db, logging), `packages/types`, `packages/test-utils` | Stay as shared libraries; `types` carries the manifest schema and the event contracts | |
| `packages/agents` as a whole | Hollows out into the rows above | The scenario suite that exercises the collaboration layer is mostly retired or rewritten as deterministic tests against a fake model adapter |
| `docker-compose.yml` | Postgres, ingress, vault and egress, scheduler, dashboard, collector and backend, a sandbox runtime, and N built agent images; Kubernetes objects emitted by the build for a cluster | From one agent service plus three integration services to a platform plus images |

What is kept as content rather than as packages: the Postgres schemas for conversations and events, the adapters' normalisation logic (moved into bundles), the tool implementations (moved into bundles or the harness), every `prompt.md` (the agent guidance layer), `PROMPT_GUIDE.md`, and the dashboard.

## Still to do in this topic

Milestones from today's tree to the first usable workload; the order that keeps the system runnable at each step; the re-read of the thirteen ADRs and the open issues; the change-request issue.

## What the code survey found (2026-09-27)

`research/2026-09-27-claim-model-code-survey.md` read the runtime bodies the retarget had never read (`worker-loop.ts`, `conversation-executor.ts`, `history-manager.ts`, `run-agent-loop.ts`, the task, group and signal-matching services, the dispatcher, the schema), against `master` at e5b69e1f, read-only, every statement labelled verified or inferred with `file:line`. It is evidence for the path, not design input: Roberto's instruction for the session was to let no current code bias the design. Its use here is to say what the redesign must not inherit and what "keep the mechanism" means once the code has been read.

**The five mechanisms the proposal keeps all exist** (survey §5): the claim as one `FOR UPDATE SKIP LOCKED` statement with a 30 s heartbeat and a 5 min stale sweep; the completion dispatcher; the orphan record; the completion result on the task row; the lookup of the parent's current conversation by parent task id at completion time, which survives a parent re-trigger. The verdict in `05-proposal.md` Part A stands: the shape was right. What the survey adds is that the implementation has correctness gaps the redesign should treat as requirements rather than carry over.

**Defects not to inherit**, ranked by blast radius:

| # | Finding | Evidence | Why it matters for the path |
|---|---|---|---|
| 1 | The transcript is one `JSONB` document on the conversation row, loaded whole on every claim (`RETURNING *`) and rewritten whole at every boundary; the resumed history is serialised as JSON into a single user message | survey §1, §6, §7 | This is the storage shape the store research says to avoid past a few hundred KB (MVCC rewrites the whole document and leaves dead versions). The redesign's transcript is one row per message with bodies out of line (`03-deployment.md`, G9) |
| 2 | The heartbeat fires only after a model response, so any single tool call, sandbox setup or 429 back-off over five minutes is swept and the conversation can be double-claimed; the first worker's results are then discarded but its tokens and side effects are spent | survey §1 | The lease must be renewed by a timer independent of the loop, and a tool call must carry an abort signal (G17) |
| 3 | No interrupt exists: cancel flips the row while the turn keeps running; `task_cancelled` is checked only after the loop; the `AbortController` is used only by drain; a tool in flight receives no signal | survey §3 | G17's redesign position |
| 4 | A signal to a running conversation is queued but delivered only if the turn ends in a matching `wait_for`; a completing turn strands its queued signals; a lost-update window exists between the post-loop re-read and the consume; the pre-loop consume path is unreachable | survey §2 | G13's redesign position: consume at every boundary, conditional write |
| 5 | Nothing sweeps `waiting` rows: a `wait_for` without a timeout waits forever, and signals queued on a waiting row are not examined until another signal resumes it | survey §4 | G19's redesign position |
| 6 | SIGTERM never releases claims explicitly; a turn that does not reach an abort check before the pool closes leaves the row `running` until the 5 min sweep | survey §1 | Drain must release claims (G5's position already says so) |
| 7 | The group "lock" is a `FOR UPDATE` outside any transaction, so it does not serialise concurrent evaluations as its comment claims | survey §5 | Groups are dropped in the proposal (siblings under one `contextId`); if a join policy ever returns, it is a transaction |
| 8 | Phase 2 summarisation is unreachable from the worker (no model client is passed), so compaction is pruning only; the session projection's tool-artifact extraction never fires (payload key `toolName` versus `tool_name`) | survey §6, §7 | Two features the repo believes it has and does not; the harness's compaction is a fresh design (`02-harness.md` question 1) |
| 9 | The worker-loop unit tests for pause, completion and timeout scheduling are all `it.skip`; the only end-to-end coverage of queued-signal delivery is a Docker integration flow excluded from `pnpm test`; no test covers mid-turn signal injection, cancellation, ordering, or two workers racing one row | survey §8 | The deterministic tests the design-pass testability lens asks for do not exist for the claim model; the redesign writes them first, against a fake model adapter |

**The query profile**, as one instance of the shape (survey §6): idle steady state is about two statements per five seconds per process plus pg-boss's 2 s pollers; the event log flushes globally every second or at a hundred events as two non-atomic inserts; every pause, completion and failure rewrites the whole `messages` column. The store research's capacity model (`03-deployment.md`) assumed ten iterations and thirty events per turn; the survey gives the current per-turn statement shape so those two inputs can be measured rather than assumed.

**What this changes in the verdict.** "Keep the mechanism" becomes "keep the mechanism, rewrite the implementation against the G13, G17 and G19 positions, with the tests first". The migration cost in the package table above is unchanged; the risk that the existing code could be lifted into the harness or the store as-is is now known to be low, which argues for the path treating the conversation store as a fresh service with the old schema as a reference, not a starting point.
