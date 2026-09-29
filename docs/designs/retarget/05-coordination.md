# Topic 5: coordination between agents, and the human entry point

Status: opened 2026-09-21 on Roberto's brief. Evaluation-mode note (`.claude/skills/design-pass/SKILL.md`). Gate one material: scope, map, forces, and the sub-problems framed with draft options. Three research files were dispatched the same day and are integrated below where they have landed; sections that wait on them say so. Nothing here is decided.

## Reframing (2026-09-21, after Roberto read the summary)

Three corrections from Roberto that change how to read the rest of this note.

1. **The job concept was a thought, not a position.** He asked for a critical view: if it does not work, or other protocols and standards for coordination and collaboration exist, he wants to read them and see a suggestion. So the task layer mapped below is one candidate, not the baseline. The suggestion is written as its own note, `05-proposal.md`, after two more research files land (`research/2026-09-21-coordination-standards-landscape.md`, `research/2026-09-21-addressing-at-organisation-scale.md`).
2. **"Against the grain" meant scale, not surface.** Reaching one agent is trivial. In an organisation of a hundred agents, reaching the right one is the challenge; his assumption is a "global orchestrator" that acts "almost like an API gateway". That is a discovery and routing question, and a gateway with a registry is a different thing from the LLM front desk evaluated as option B in 5b. 5b's evidence on B stands for what it tested; it does not answer the question he asked. The addressing research does.
3. **Fresh look.** Nothing in the repo is set in stone; he prefers a design made without aesir's baggage, judged against what he uses every day and what others do. The as-is map below is kept as evidence of what exists, per the design-pass rule that the surrounding code is evidence, not authority.

He has not yet read the notes; the gate questions at the end wait until he has.

**Decided by Roberto later the same day:** humans are never agents, assignees or directory entities; a human in the loop is reached through applications. Gate question 4 and the human-handoff rows below are settled by that; `05-proposal.md` carries the position. He also confirmed the registry-plus-gateway-plus-search reading of "a hundred agents" and asked whether cluster service discovery can be reused; the answer is in `05-proposal.md`, "Part C, continued".

## Roberto's brief (2026-09-21, condensed)

- The Claude Code shape, one orchestrator directing every sub-agent, "doesn't scale particularly well". The existing job (task) concept "might be interesting" at a lower level. He expects "both event driven and direct calls between agents (they're basically just services in a cluster anyway)". Research requested.
- For humans and agents, he now thinks an orchestrator between them makes sense, and that the direct human-to-agent design aesir implemented "goes against the grain of current state of the art", with complexity that buys nothing.
- Later the same session: "being api/mcp first will also open an opportunity to have the orchestrator or the gateway to the agents be the preferred chat application on the operator ... I could use you [Claude Code] to coordinate with fully remote agents."

## Corrections from the earlier pointer

The 2026-09-16 pointer in this file framed the topic as "an LLM orchestrator that mediates, or a declared process whose steps are agents", with a day-one position of zero agent-to-agent coordination. That framing stands as one axis. The brief adds two others: the transport between agents (call, job, event) and the human entry point. The three are separable and this note keeps them apart. The "graph engineering" material stays in `02-harness.md`.

## Scope and what was read

Read this session, in code: `packages/agents/src/shared/tools/task/types.ts` (transitions, depth limits), `delegate-task.ts` (input schema, tool description), `packages/agents/src/framework/wait-for-task-tool.ts`, `packages/agents/src/shared/services/task-signal-dispatcher.ts` (header and types), `packages/agents/src/shared/services/materialization/forward-sync.ts` (header), `packages/agents/src/shared/db/schema.ts` (tasks, task_handoffs, entity_directory, work_correlations, the status enums), the tool directory listings under `shared/tools/`. ADRs 0008, 0009, 0010, 0013 in full. The three 2026-09-16 research files in full.

Not read: `task-service.ts`, `group-service.ts`, `signal-matching.ts`, the bodies of the other twelve task tools, `spawn-agent.ts`, `request-human-input.ts`, the dashboard's delegation graph. Claims about those are labelled believed.

## Map as-is: the task primitive Roberto calls the job concept

One sentence: a task is a durable row that records a unit of work, who asked for it, who owns it, and how it ended, independent of any conversation and of any external artefact. Delegation creates one and starts the target's conversation; completion signals the delegator's current conversation. The record lives in Postgres, not in any agent's context.

| Component | What it is | Evidence | Label |
|---|---|---|---|
| `agents.tasks` | `parent_id`, `group_id`, `creator_type/id` and `assignee_type/id` (each `agent` or `human`), `status`, `title`, `objective`, `depth`, `completion_result` JSONB | `schema.ts:361` to `:408` | verified |
| Status lifecycle | `created → active | counter_proposed`; `counter_proposed → active | cancelled`; `active → paused | completed | cancelled`; `paused → active | cancelled`. The enum also carries `failed`, which the tool-layer transition table does not name; the dispatcher treats it as terminal | `types.ts:11` to `:18`; `schema.ts:332`; `task-signal-dispatcher.ts:56` | verified; who sets `failed` not read |
| Handoffs | `task_handoffs` with `handoff_type` in `completion, pause, delegation, escalation` and a JSONB context; framework stores, never pattern-matches | `schema.ts:346`, `:418`; ADR-0009 | verified |
| `delegate_task` | Input: `targetEntityId`, `description` (the brief), optional `parentTaskId`, `budgetAllocation`, `materialization` (`transparent` to Linear). Creates the task, starts the target's conversation with a `<delegation>` block, tells the caller to `wait_for` type `task_handshake` for 30 s | `delegate-task.ts:25` to `:54`, `:108` to `:114` | verified |
| Handshake | Target answers accept, reject or counter-propose; the delegator resolves a counter-proposal through `wait_for_task`'s `action` | ADR-0010; `wait-for-task-tool.ts:41` to `:49` | verified |
| `wait_for_task` | `taskId`, `timeout` in hours or days, auto-registers `task_completion`, `task_failure`, `task_timeout`; a separate tool from `wait_for` so the failure path cannot be forgotten | `wait-for-task-tool.ts:7` to `:12` | verified |
| `TaskSignalDispatcher` | On a terminal status of a delegated task, signals the parent task's current active conversation; evaluates a group policy first when `group_id` is set; at-most-once, with `completion_result` on the row as the durable record and an orphan event when no conversation is active | `task-signal-dispatcher.ts:1` to `:16` | verified |
| Groups | `task_groups` with `all_required`, `any_sufficient`, `majority`; terminal group states `satisfied, unsatisfiable, cancelled, settled` | `schema.ts:297`; `task-signal-dispatcher.ts:60` | verified (policy names from ADR-0010; group service not read) |
| Bounds | `MAX_TASK_DEPTH = 5`, `MAX_DELEGATION_DEPTH = 5`, `MAX_SUBTASKS_PER_PARENT = 10`; tree budgets flow down the delegation tree | `types.ts:32`, `:41`, `:44`; `tree-budget-tool.ts` (not read) | verified constants; budgets believed |
| Entity directory | `type`, `name`, `description`, `capabilities[]` with a pgvector embedding, `reach_via`, `status`; seeded from YAML | `schema.ts:531` to `:560`; ADR-0010 | verified |
| Work correlations | `(entity_type, entity_id) → conversation_id, agent_id, status` with `active, waiting, completed, failed, superseded`; unique per entity and conversation. The addressing table from an external artefact to a conversation | `schema.ts:585` to `:611` | verified; the `work:*` tools are absent from production YAML (#11) |
| Materialisation | Forward sync of task status to a Linear issue for tasks with a materialisation record; composes beside the dispatcher | `forward-sync.ts:1` to `:9` | verified header |
| Tool surface | 14 task tools, 2 directory, `spawn_agent` and `request_human_input` under coordination, `wait_for` and `wait_for_task` in the framework, 3 communication tools | `ls shared/tools/*`; `grep 'name: "' shared/tools/task/*.ts` | verified |
| Sub-agents | `spawn_agent` runs a worker inside the parent's conversation and budget, sharing its `correlationId`; workers get no task tools | ADR-0009 consequences, ADR-0010 | verified in ADR; code not read |

Two facts from the map matter for everything below.

1. **The composite job's state is in the store, not in an agent's context.** Each delegator holds only its own children in context; the tree, the budgets, the group policies and the results are rows. That is the property the Claude Code orchestrator lacks and the property choreography loses (Azure, "no single component has a complete view of an in-flight business operation", research 09-16 §1).
2. **A delegation is two durable pauses.** Handshake (30 s) and completion (hours or days). Every pause is a claim release and a full history reload on resume. The accept and reject legs have a counterpart in A2A, whose `REJECTED` is a terminal task state; counter-propose has no protocol state anywhere, and the nearest shape is a `Message` exchange before any task exists (`research/2026-09-21-agent-to-agent-transports.md` §1 and the implications table, verified).

## Forces

- **What is coming.** Agents become container images behind Services (topic 3). The claim model stays or is replaced by an execution family that keeps its guarantees (`00-as-is.md` finding 6). First-party integrations move to the public extension API (`04-events.md`). The first workload is still unchosen (`01-target.md`); candidate C, product conversation to tickets then issue to PR, is the first with two agents.
- **What is expensive today, measured.** 26 of 32 definitions exist to exercise delegation (`00-as-is.md`). Two pauses per delegation. The largest tool family has the least real-workload evidence (`00-as-is.md` finding 4).
- **What Roberto said matters.** Both events and direct calls between agents. Agents as services. No LLM in routing. No human-handoff subsystem. MCP and API first, so that his own chat harness can be the coordinator.
- **What the evidence says (research 09-16 §2).** Peer coordination among LLM agents has the strongest failure record; orchestrator with disposable workers has the strongest payoff, confined to breadth-first read-heavy work at about fifteen times chat cost; depth of delegation, not breadth, is where authorisation is lost; most failures are loop-engineering failures that exist in a single agent too.

## 5a. Agent-to-agent communication

Integrated 2026-09-21 from `research/2026-09-21-agent-to-agent-transports.md` (60 sources; `[V n]` fetched, `[S n]` secondary, `[I]` inferred). Section numbers below refer to that file.

### The claim under test: "an orchestrator does not scale"

Stated precisely, the Claude Code shape has five limits. Which ones bind depends on what "scale" means.

| Limit | Mechanism | Evidence | Binds when |
|---|---|---|---|
| Results merge into one context | Every worker's summary lands in the orchestrator's window; the window is the ceiling on fan-out and depth | Anthropic's own words on its workflows page: "Claude is the orchestrator: it decides turn by turn what to spawn or assign next, and every result goes into a context window" (§5, verified) | Many workers, or workers with large outputs |
| Liveness coupling | The job lives as long as the orchestrator's session; a worker cannot outlive it or wake it later | Agent teams: one team per session, teammates die with the lead, not restored by `/resume`; background sessions exist as a research preview (§5, verified) | Any wait longer than a session, such as a review over days |
| Hard caps | Three layers of nesting, twenty concurrent sub-agents; Managed Agents caps delegation at one level, 25 concurrent threads and 20 roster agents | §5, verified from the sub-agents and multiagent pages | Fan-out above twenty, or delegation chains above three |
| Cost | Three to ten times single-agent tokens (Anthropic, Jan 2026); about fifteen times chat (research 09-16) | §4, §5 | Always; a budget line, not a wall |
| Authorisation drift | Constraints attenuate with each hop; hierarchies take unauthorised actions more often as depth grows | MasDrift (research 09-16 §2; the depth numbers are in 5b) | Depth above one |

What Anthropic did about these limits is the useful evidence (§5, verified): it bounded the orchestrator rather than replacing it. Background subagents answer context pollution; `SendMessage` gives subagents a mailbox and a sibling roster so results are not only upward; agent teams give a handful of long-running peers a shared task list and mailboxes; cross-session messaging reaches other machines; dynamic workflows move the plan into a script for "dozens to hundreds of agents per run", because with subagents and teams "every result goes into a context window". Managed Agents chose hard caps over deeper trees. The research's verdict on the brief: the evidence "supports bounding the orchestrator, not abandoning it".

The first two limits are the ones "services in a cluster" fixes, and aesir's task tree already fixes them: the record is in the store, and a delegator pauses instead of staying live. The last three are properties of delegation itself and move with it.

What the evidence does not support is the step from "the orchestrator has limits" to "peers coordinating through events and calls". Peer shapes fail on implicit decisions (Cognition), agree on the same branch name eighteen times out of thirty (Anthropic red team), and lose the single view of an in-flight operation (Azure). The 09-21 search for the missing counter-evidence found none: "zero documented production choreography among LLM agents"; Confluent argues for "a central orchestrator" over the bus, Solace runs an `OrchestratorAgent` on its mesh, and Dapr's event-driven pattern is an orchestrator choosing agents (§4, verified). The distinction that resolves this: **control in one context** is the scaling problem; **the record in one place** is the benefit worth keeping. Aesir's task tree is the second without the first. Any transport design below has to keep it.

### Three primitives, and where aesir stands

Microservices use three shapes of communication. Agents map onto the same three, with one difference: an agent's "call" can take days, so the durable one is the default rather than the exception. Across the field no protocol carries all three; A2A and the MCP Tasks extension cover call and job, brokers cover event, and only Dapr Agents ships all three plus an outbox (§4, verified). The guidance found says one thing three ways: start with a call, promote to a job when the work is long or needs input, add a broker only for decoupling.

| Primitive | Shape | Lifetime | In aesir today | In the field (§1, §4) |
|---|---|---|---|---|
| Call: agent as tool | Synchronous, bounded, result returned to the caller's turn | Seconds to minutes; caller stays live | `spawn_agent`: a worker in the same conversation and budget, in-process only. No cross-container form (verified, ADR-0009, ADR-0010) | A2A `Message` reply to a blocking send; MCP `tools/call`; Dapr service invocation; Claude Code foreground `Agent` |
| Job: agent as task | Asynchronous, durable; caller pauses, callee signals completion | Minutes to days | `delegate_task` + `wait_for_task` + dispatcher, in-store (verified) | A2A `Task` with push notifications or resubscribe, "designed for (potentially very) long-running tasks"; MCP Tasks extension with `tasks/get` polling; Dapr workflow instance id; Agent Framework continuation token |
| Event: publish and subscribe | Fire-and-forget fan-out; subscribers start or resume by declared subscription | Any | Only for integration webhooks (`triggers` in YAML). No agent-emitted domain events. `notify` addresses humans (verified, `00-as-is.md`; ADR-0008) | Dapr pub/sub with a state outbox; NATS Cotal's durable per-agent inbox, where "a message to a busy or offline agent waits on the stream"; Solace topics |

The question is not which one to have. It is whether all three are the same record with three ways to create it, or three mechanisms.

### Direct calls when the callee is a paused row

"Direct call" assumes a live process to call. In the claimed-loop family (topic 3, option A) an agent is a queue of conversations, not a process. Under one Deployment per agent image (`07-path.md`), a Service does exist per agent, so a call can land on a replica. What the replica does with it is the design choice.

A2A is the standard that models both shapes, and it is silent on a callee that is not a live process (§1, verified). The reference SDKs make the gap concrete: the task record survives a restart with a database store, the execution does not, and neither SDK restarts one. The JavaScript SDK's behaviour is the one to copy: the executor exits at `INPUT_REQUIRED`, the next message on the same `taskId` starts a new execution, and a resubscribe with no live bus returns the stored snapshot so clients can "reconnect to a long-running task after server restart, executor pause, or an INPUT_REQUIRED bus-sleep window". That is aesir's claim model described from the wire: a paused conversation is a task in an interrupted state whose execution has exited.

- **Bounded call.** The replica runs a fresh short conversation to completion and returns the result in the response. A2A's default blocking send, which "MUST wait until the task reaches a terminal state or an interrupted state"; OpenAI's agent-as-tool. The cross-container form of `spawn_agent`. Cost: the caller's turn is held open; a timeout is mandatory (the Agent Framework client defaults to 60 s); nothing is durable if either side dies mid-call.
- **Job call.** The replica creates a task, starts a conversation, and returns the task id (`returnImmediately`). Completion arrives by push notification to the caller's ingress, which becomes a signal to the caller's paused conversation. A2A's push-notification shape and aesir's dispatcher with HTTP in between. A2A never says what happens when the webhook target is gone; aesir's orphan record and `completion_result` on the row are its own answer, and the research calls the dispatcher "the only outbox-like piece besides Dapr's".
- **Event.** The callee's manifest subscribes to a domain event the caller emits; ingress matches and starts or resumes. Same subscription mechanism as webhooks (`04-events.md`), with agents as a fourth source. Needs an outbox so an emitted event is not lost when the emitting turn fails after the side effect (pattern: transactional outbox; Dapr's state outbox is the one shipped instance, §3 verified).

Under all three, the unit of record is the task row and the unit of transport is whatever reaches a replica or the store. That is the concrete version of "the job concept at a lower level". The gaps research (`research/2026-09-21-harness-container-gaps.md` §1, verified) sharpens the fork: every hosted platform pushes into the container over HTTP, only Anthropic's self-hosted worker pulls, and A2A's `SendMessage` must return at once with either a task or a message. Choosing a push endpoint per agent is the same decision as G1 in `02-harness.md`.

MCP is not a candidate for the agent-to-agent leg. Its current revision (2026-07-28) removed sessions, server-initiated requests and stream resumability; a plain `tools/call` "cannot represent a job that takes days"; the Tasks extension is opt-in on both sides, poll-first, and the community client matrix lists no client supporting it (§2, verified). MCP's place is the human-harness side in 5b, and even there with the limits recorded below.

### Findings

1. **The record is right; counter-propose is the unproven part.** The task row, the dispatcher with its orphan record, `completion_result`, budgets and depth bounds are confirmed by the field (implications table, verified): the row is the A2A and MCP durable handle, the focused brief matches Managed Agents ("Tools, MCP servers, and context are not shared") and Claude Code, and the dispatcher exceeds what A2A specifies. The accept and reject legs map onto A2A's `REJECTED`; counter-propose has no protocol state in any system. Cost of the handshake as built: one extra durable pause and a 30 s wait per delegation. Candidate: keep reject as a terminal outcome the callee can return, drop the separate handshake pause and counter-propose.
2. **There is no cross-container call, and A2A is the shape it would take.** `spawn_agent` is in-process. Once agents are images, the bounded call and the job call are both native A2A shapes on the agent's Service, with the JS SDK's snapshot-on-resubscribe as the durable model. This is the same wire protocol topic 5b's option C would expose to external callers, so one protocol serves both.
3. **Agent-emitted events do not exist, and nobody has shown choreography working.** Every trigger is a webhook. Candidate workload C (`01-target.md`) joins two agents through Linear, which is choreography through the business tool and the cheapest test of whether agent-to-agent events are needed at all. If they are, the shape is a subscription in the callee's manifest plus an outbox on the emitter; the field's own event meshes still put an orchestrator on top.
4. **Addressing is split across three tables.** `work_correlations`, `tasks`, and the integrations' own `task_correlations` (ADR-0009). Topic 4's inbox and subscriptions would replace the first and third. Not a 5a decision, but the three-table split is what "direct call" would have to address through. NATS Cotal's durable per-agent inbox is the same idea as topic 4's inbox (§3, verified).
5. **The directory is a catalogue, not a router.** Capability embeddings exist, but selection by capability is what no standard supports (research 09-16 §3; confirmed §4). The A2A Agent Card covers identity, endpoint and declared skills; keeping the directory in that shape costs nothing and buys the wire protocol for external callers. G22 in `02-harness.md` records the leak risk of a generated card.
6. **The depth cap is above every vendor's.** Aesir allows five levels of cross-agent delegation; Managed Agents allows one, Claude Code three, and MasDrift's unauthorised-action rate rises from 2.7% at one level to 11.7% at two (5b). Candidate: two, with one as the manifest default.
7. **Identity between agents is per-agent workload identity plus a bearer token; human authorisation carries one hop.** A2A payloads "don't carry user or client identity information directly"; Foundry and AgentCore propagate the user one hop (on-behalf-of, three-legged OAuth); RFC 8693 makes nested actor claims "informational only"; nothing shipped enforces the originating request at hop two (§6, verified). This answers G7 in `02-harness.md`: the egress gateway from G3 identifies the calling agent, and the originating request text travels in the brief, which is MasDrift's source re-anchoring at a token cost of 6.6% to 19.3%.
8. **The delegator's own wait surviving its restart is the client's problem in every protocol.** Aesir's lookup of the parent task's current active conversation is one answer, and the research names it as such. Keep it.

### Options

**Option 1: one record, three transports.** Keep the task row as the unit. In-store delegation stays for agents on the same platform. Add the bounded call and the job call as the agent Service's A2A API, and agent-emitted events as a fourth subscription source through the same ingress.

- Pattern: durable task record with an orchestrated saga per tree (Richardson, orchestrated saga; the task tree is the saga log). Transports as ports and adapters over that record; A2A v1.0 as the wire form, with the JS SDK's snapshot-on-resubscribe for the sleeping callee (§1, verified); a transactional outbox for emitted events (Dapr, §3).
- Why here: keeps the single view (finding 1 above) while giving Roberto's two shapes; one wire protocol for agent-to-agent and for external callers.
- Where it appears in aesir: the task row and dispatcher; the ingress inbox from `04-events.md`; A2A and the outbox are new here.
- Cost: three code paths that must create an equivalent row; the A2A task lifecycle (`SUBMITTED`, `WORKING`, `INPUT_REQUIRED`, `AUTH_REQUIRED`, `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`) and aesir's status enum must be reconciled, including cancellation, which A2A says "is not guaranteed"; group policies stay application logic because no protocol expresses them; the outbox is new.

**Option 2: the agent's API is the only contract.** No shared task table across agents. Each agent owns its tasks behind its Service; callers hold the task id and receive push notifications. The platform provides ingress, vault, and the store per agent, nothing cross-agent.

- Pattern: pure microservices with A2A between them; choreographed saga.
- Why here: the closest fit to "services in a cluster"; interoperates with non-aesir agents by construction.
- Where it appears in aesir: nowhere; the dispatcher and groups would go.
- Cost: no single view of a composite job (Azure's choreography cost); group policies and tree budgets become each caller's problem; the dashboard's delegation graph has no source; A2A leaves the "webhook target gone" case undefined, so each agent reinvents the orphan record. On the 09-16 evidence this is the shape with the worst documented failures for LLM agents, and the 09-21 search found no production instance of it.

**Option 3: no cross-agent coordination on day one.** One agent per workload; sub-agents only in-process; two agents join only through the business tool (workload C). Keep the task table for a single agent's own work tracking. Add option 1's transports when the observable signals fire (research 09-16 §6).

- Pattern: single bounded loop plus one pause primitive; the routing workflow (Anthropic, "Building effective agents"); "start with the simplest approach that works, and add complexity only when evidence supports it" (Anthropic, Jan 2026, §4 verified).
- Why here: the research's day-one position; the workload has not been chosen; the collaboration layer has no real-workload evidence.
- Where it appears in aesir: the dev-agent path from a Linear trigger to a PR, before any delegation.
- Cost: nothing is learned about cross-agent transport until a workload needs it; the 14-tool task family idles or is cut to the record-keeping subset.

Options 1 and 3 compose: 3 is what ships first, 1 is the shape it grows into. Option 2 is a fork. The cost-of-next-change reading from the 09-16 research applies: starting from a declared record and adding transports is cheap; starting from peers and adding a record is expensive.

### What to keep, make optional, or drop in the task layer (candidates, not decisions)

| Part | Candidate disposition | Reason |
|---|---|---|
| Task row, `completion_result`, handoffs | keep | the record; the A2A and MCP durable handle |
| Dispatcher, orphan handling | keep | the completion signal; exceeds what A2A specifies |
| Groups and policies | keep, behind option 1 | the joins; application logic in every system; `any_sufficient` is the join SGH excludes (`02-harness.md`) |
| Depth and subtask bounds, tree budgets | keep; lower the delegation depth to two, default one | finding 6 |
| Handshake pause and counter-propose | drop; keep reject as a terminal outcome | finding 1 |
| Directory capability embeddings and `find` | drop; keep the card-shaped catalogue | finding 5 |
| Human as assignee, `reach_via`, human handoff | drop | Roberto's brief; research 09-16 §4; 5b |
| `spawn_agent` | keep in-process; add the cross-container bounded call under option 1 | finding 2 |
| Materialisation forward sync | fold into the bundle's outbound tools | `04-events.md`: the bundle owns outbound |

## 5b. The human entry point

Integrated 2026-09-21 from `research/2026-09-21-human-entry-point.md` (46 sources; labels there are `[V]` fetched, `[I]` inferred, `[S]` secondary). Section numbers below refer to that file.

### The premise, checked

Roberto: direct human-to-agent addressing "goes against the grain of current state of the art". The research splits the field in two camps that do not overlap (§1, §2, verified). Work-tool vendors ship direct addressing and nothing above it: Linear, Jira with Rovo, GitHub's cloud agent, Cursor, Devin, Codex and Slack all make the human name the agent, and what sits above the agents is a picker plus rule-based triggers (triage rules, transitions, columns, labels). Enterprise-assistant vendors ship a front desk as the product: Copilot Studio, Agentforce and Microsoft 365 Copilot put one entry agent over specialists chosen by description, always in a chat pane, never inside an issue tracker. Aesir's target is tool-embedded (`01-target.md`), so for that surface direct addressing is the grain, not against it.

Two vendors say why they chose direct addressing (§2, verified). Linear: the agent gets "a dedicated user to represent the agent inside the workspace", and delegation keeps the human assigned because "an agent cannot be held accountable". Atlassian: "most agent work today happens in one-off chats that never make it back to where the work lives and is coordinated".

What aesir implemented and Roberto is rejecting is a third thing: humans and agents as peers in one directory, with human delegation and operator chat designed into the schema (ADR-0010 consequences). No product ships that (§7): every one separates the person who asks from the person who governs. Dropping it is consistent with the field. It does not by itself argue for a front desk.

### Two meanings of "operator"

The research's vocabulary (§7): **end user** for the person who asks, in chat or in a work item; **administrator** for the person who governs and reads traces. Aesir's earlier "operator-to-agent chat" meant the administrator using the end user's surface, which no product ships. The `01-target.md` personas map as builder plus administrator (both Roberto) and end user (Roberto again for the first workload). This note uses the research's two words from here on.

### Options

**A. Direct through the business tool.** The end user assigns or mentions a specific agent; the event reaches it; the agent asks and answers in the same thread. Aesir's current path, minus the peer directory and the operator chat.

- Pattern: the workspace-member agent (Linear's agent sessions; Jira's Agents section; GitHub's cloud agent). 12-factor factor 11, trigger from where the human already is; factor 7, contact humans with a tool call (research 09-16 §4).
- Why here: the first workload is tool-embedded; the durable channel for a question asked on Tuesday and answered on Thursday is the tool's thread, and the state stays in the work item where the end user can read it (§6).
- Where it appears in aesir: `communication:ask` and `reply` with `ReplyContext` (ADR-0008); `wait_for` and the signal path. Linear's contract for exactly this is verified in §2: session states `pending, active, error, awaitingInput, complete, stale`, activities `thought, action, elicitation, response, error`, and the human's reply arriving as a `prompted` webhook. Aesir already speaks this contract: the `ask` intent becomes a Linear `elicitation` activity when an agent session is active (`packages/agents/src/shared/communication/denormalizer.ts:99`, intent map at `:196`), and the `agent_session.prompted` webhook becomes the `agent_prompt` domain event (`packages/agents/src/adapters/linear.ts:11`, `:121`). Verified 2026-09-21.
- Cost: no cross-agent view for the end user; picking an agent is the human's job; automation above the agents is a rule table. Unknown (closing section, "What the evidence supports for each shape"): how many named agents a picker tolerates; no user study exists either way.

**B. A front-desk agent aesir builds.** One agent receives every human message, interprets it, delegates through the task layer, and reports back. Roberto's earlier "orchestrator".

- Pattern: Copilot Studio's generative orchestration over connected agents; Agentforce's primary agent with Atlas routing; OpenAI's manager (§1, verified).
- Why here: one identity to talk to; the end user need not know the roster; intent held in one place.
- Where it appears in aesir: nowhere; it would be a new agent definition whose tools are `delegate_task` and the communication tools.
- Cost, in the vendors' own words and the measured numbers (§1, §4, verified): "extra orchestration hops" of latency; selection degrades past "30-40 choices of action"; "Subagents don't inherently know they're part of an orchestration" and "send messages directly to the user"; a specialist's question to the user "goes back to the parent planner as a brand-new query"; citations lost on the way back; separate transcripts to correlate. MasDrift Table 3, undefended: unauthorised actions 0.4% for a single agent, 2.7% at one supervisor level, 11.7% at two, 19.8% at three; a front desk over a specialist is L1 and a specialist with its own worker is L2. Zero-shot LLM routing over a fixed 12-agent catalogue scores F1 41.5 (exact match 19.0) against 89.6 for a fine-tuned classifier. No vendor documents a delegation that outlives the turn, and none puts the front desk inside a work tool. And it is a chat product, which the brief said not to build. It must never interpret machine events, or it is the LLM router (`00-as-is.md` finding 3) under another name; Copilot Studio is the one product that does route events through its LLM orchestrator (§5), and that is the shape aesir calls a defect.

**C. API and MCP first; the end user's own harness is the orchestrator.** Aesir exposes the platform API (start a job for agent X, list jobs, answer a question, cancel) as an MCP server, and optionally each agent's A2A card. Claude Code, the Claude apps, ChatGPT or Slack becomes the front desk. Aesir builds no chat surface and no orchestrator agent. Roberto's later thought.

- Pattern: agent as MCP tool. Verified precedents (§3): Docker Agent's `serve mcp`, where "each agent becomes a separate tool in the MCP client"; AgentCore Runtime's MCP endpoint; Foundry's A2A tool behind an MCP-compatible toolbox endpoint. Every harness checked is a remote MCP client with OAuth: Claude Code (HTTP recommended, `claude mcp login`, dynamic client registration), the Claude apps (custom connectors), ChatGPT developer mode (secondary source only), AgentCore.
- Why here: Roberto is end user, builder and administrator for the first workload and already lives in Claude Code. MCP has the two primitives C needs, with a caveat the two research files disagree on and the later spec settles. The entry-point file read the 2025-06-18 and 2025-11-25 revisions (elicitation as a server-initiated request; tasks with `tasks/list`). The transport file read the current revision, 2026-07-28 (`research/2026-09-21-agent-to-agent-transports.md` §2, verified against modelcontextprotocol.io/specification/latest): MCP is now stateless, server-initiated requests are gone, elicitation rides a retry pattern in which the server returns an input-required result and the client re-issues the call with the answers, and tasks moved to an opt-in extension (`io.modelcontextprotocol/tasks`) with `tasks/get` polling and `tasks/update` for input, `tasks/list` removed, and no client in the community matrix supporting it. This note follows the later revision. Claude Code moves an MCP call still running after two minutes to a background task and delivers the result as a notification (v2.1.212 and later), supports elicitation, and its `SendMessage` reaches cloud sessions and other machines (entry-point §3, verified); that backgrounding is the harness's own mechanism, not the Tasks extension.
- Where it appears in aesir: nowhere yet; the ingress and the store from topic 4 are the backend it would front.
- Cost (entry-point §3 and transport §2, verified unless marked): no harness documents resuming a server-side task from a later session; the Tasks extension has no recorded client support, so building on it today means writing both ends; a plain `tools/call` cannot represent a job that takes days and senders "SHOULD always enforce a maximum timeout"; with server-initiated requests gone, a remote agent's question reaches the human only while the human's client is retrying that call, so a question raised on Tuesday cannot be pushed to a harness on Thursday; AgentCore sessions expire and return 404; Claude Code teams are "not restored" by `/resume`; cross-session messages are "plain text only" and "never count as your consent". Inferred: a three-day job in C needs the platform to hold the task and a client that polls it later, which the extension permits and no harness ships. So C cannot be the only channel. Elicitation in the Claude apps and ChatGPT is unverified. Model choice moves to the human's harness, which is fine for the human side and irrelevant for the agents.

### How they compose

A is the durable channel and exists; the research adds that it is the only shape work-tool vendors ship and that its state is the one the end user can read. C is a client of the same platform API that A's ingress and store already need, and gives the end user a coordinating surface without aesir building one. B competes with C and loses on the evidence: it costs a hop, a delegation level (2.7% to 11.7% unauthorised actions from L1 to L2), a routing accuracy problem, and a chat product, for a benefit C gives through a harness the human already runs.

The hybrid the enterprise assistants converge on (§5) is the one A plus C already is: `@agent` when the human names one, the assistant otherwise. In aesir the "assistant" is the end user's own harness. Claude Code does the same internally: `@"name (agent)"` guarantees a named subagent runs; otherwise the main agent picks by description.

The composition that follows from the brief and the evidence is **A plus C, and no B**, with the platform API designed once for both: the same call that starts a job from a Linear event starts it from an MCP tool.

Two consequences for other topics. The platform API is a topic 4 and topic 6 deliverable, not a 5b one; 5b only says it must exist and be MCP-shaped, with tasks and elicitation in mind. And the agent-to-agent transport in 5a and the human-to-platform transport in 5b are the same decision seen from two callers; whichever wire protocol wins in 5a should be the one C exposes, or there are two.

### Findings

1. **The peer directory for humans is the part to drop, not direct addressing.** ADR-0010's human-as-entity, `reach_via`, human handoff and operator chat go; the ask-in-tool, answer-in-tool path stays and matches Linear's `elicitation` and `prompted` contract.
2. **A front desk is the LLM router unless it is confined to human language.** Every work-tool product keeps the LLM inside the named agent and routes events by rule; Copilot Studio is the exception and the cautionary case. Any design for B needs the boundary written down: it sees human messages only, never webhooks.
3. **C is extension-ready and harness-not-ready for jobs that outlive a session.** The MCP Tasks extension and the retry-pattern elicitation exist on paper; no client supports the extension and no harness resumes a server-held task later. The platform must hold the task and offer `tasks/get`-shaped polling with `tasks/update` for answers, and expose the same job over A2A for agent callers (5a finding 2); the harness side improves on its own schedule. Until then the Thursday answer arrives through A.
4. **Delegation kept the human accountable in Linear's model.** The agent is a delegate; the human stays assignee. Workload A's trigger (`01-target.md`, "issue assigned to the agent") should be read as "issue delegated to the agent", which is what Linear's assignee menu does (§2, verified).

## Questions for Roberto (the gate)

1. **5a, the vocabulary.** Do call, job and event as three transports over one task record match what you mean by "event driven and direct calls"? If "direct call" means a synchronous HTTP request to a running agent process, say so; that pushes topic 3 toward the actor family, which the 09-16 scaling research costed.
2. **5a, the handshake.** Are you attached to the separate handshake pause and to counter-propose? Reject exists in A2A as a terminal state and stays; counter-propose exists nowhere, and the handshake costs a pause per delegation.
6. **5a, the depth cap.** Five levels is above every vendor's cap (Managed Agents one, Claude Code three) and MasDrift's numbers climb steeply at two. Two, with one as the default, is the proposal.
3. **5b, the surface.** For the first workload, does the end user reach the agent through the business tool (A), through your own harness over MCP (C), or both? "Both" is the composition this note argues for; "C only" fails the durable-question case, now verified: no harness resumes a server-held task from a later session.
4. **5b, the word.** When you say orchestrator for humans, do you mean an agent aesir runs (B) or the gateway your harness talks to (C)? The later message reads as C. If B is still on the table, the boundary in finding 2 needs your agreement.
5. **The workload.** Every option above is judged against a workload that is still unchosen. Candidate C in `01-target.md` (two agents joined through Linear) is the one that exercises this topic without building any of it.

## Research dispatched 2026-09-21

- `research/2026-09-21-agent-to-agent-transports.md`: A2A task lifecycle versus a durable callee; MCP's long-running and elicitation support; how Dapr Agents, Solace Agent Mesh, kagent, Agent Framework, ADK, AgentCore and LangGraph Platform transport calls; the three primitives across systems; Claude Code's evolution past a single orchestrator; identity between agents.
- `research/2026-09-21-human-entry-point.md`: products with one entry point versus named agents in the tool; shape C precedents; evidence on the extra hop; hybrids; where the front desk's state lives; the two meanings of operator.

Integration status: both files landed 2026-09-21 and are integrated; 5a from the transport file, 5b from the entry-point file, with the MCP revision discrepancy between them resolved in favour of the later spec. The harness-gaps file's §1 is cross-referenced from 5a.

## 5c. Speaking to a team of agents (2026-09-27)

Roberto, 2026-09-27: "there are a fair amount of patterns here, but to me, there are two main ones: direct to agent and communicating with swarms; how do others handle this? I don't really have a baseline example of speaking to a swarm of coordinating agents, but I would imagine it would go through some coordinator, almost like a project manager of sorts."

Written first from first principles, then revised the same day against `research/2026-09-27-human-to-agent-team-patterns.md` (61 sources; section numbers below refer to it; `[V]` there means fetched primary source). Section 5b settled the catalogue case, one human and many unrelated agents, with no front desk of the platform's own. This section is the team case: several agents working one job.

### Three meanings of "swarm", and the one that matters

The word is used three ways and only one is Roberto's. Verified in §1c: for OpenAI, LangGraph and Microsoft a *swarm* is a handoff shape, one conversation moving between agents with "the last agent" holding the human, and the user's reply "returns to the agent that requested it". Anthropic's red team uses the word for ten to eighty peers on one project, and documents that shape failing. A *fleet* is many independent agents on unrelated jobs, which is 5b's catalogue and the registry's business. A *team* is several agents coordinating on one piece of work, and that is the question here. No vendor ships the peers-coordinating meaning as a product (§1c, inferred there).

### What a human can address in a team

Three things, and every shipped pattern is a choice among them. The research confirms the taxonomy against thirteen products (§1a, §1b, §1d):

| Addressable thing | What it is | Roberto's picture | What the field reports |
|---|---|---|---|
| A **member** | one agent in the team, reached directly | "direct to agent" | Ships as the *extra* line in the best team products: Claude Code lets you "talk to any teammate directly without going through the lead"; Devin's children each have "its own session link". Managed Agents is the exception: "your client posts no messages" in a subagent thread |
| A **lead** | one agent whose job is the plan, the assignments, the status and the human liaison; members are its delegates | "a coordinator, almost like a project manager" | The default counterpart in every vendor that ships a team primitive (§1a, §2). Always a role one agent plays under a configuration flag (`coordinator`, `team-lead`, `SUPERVISOR`, `manager_agent`), never a platform object with its own address |
| The **record** | the artefact that holds the job: an issue tree, a pull request, a shared task list; agents and the human read and write it | not named in the brief; candidate C in `01-target.md` is this | How coding-agent fleets ship: Symphony over Linear ("one workspace per issue identifier", a run ends at a `Human Review` state), Claude Code's shared task list, Paperclip's issues (§1b) |

### The lead is already in the proposal, under another name

`05-proposal.md` Part B is bounded orchestration: a caller opens tasks for named callees under one `contextId`, waits durably, and is resumed by completions. When the caller is an agent a human addressed directly, that agent *is* the lead. So Roberto's project manager is not a new object and not the rejected front desk. The front desk was a platform-run chooser over the whole catalogue, unbounded and with a measured routing problem. A lead is one named agent, addressed directly, with its team in its manifest's allow-list. The research states the same conclusion from the other side: "communicating with a team is, in every shipped product, communicating with one agent that delegates" (§6).

What the team case adds beyond single-agent direct addressing is four things. Each now has evidence.

1. **A member's question to the human.** Three routes ship (§3). Through the lead, which loses the thread: Copilot Studio documents that a one-way "inform" makes the user's reply "a brand-new query" and that the parent "can't see the subagent's exchange with the user". Through the artefact, which keeps it: Linear's `elicitation` per session and Symphony's `Human Review` state. Through a correlated platform event, which also keeps it: Managed Agents cross-posts a subagent's request "to the primary thread with `session_thread_id`"; Agent Framework's `RequestInfoEvent` carries a `request_id` and "routes the response to the executor that sent the original request". Part B already chose the artefact route (`INPUT_REQUIRED` into the origin thread). The evidence adds one requirement: the question lands under the *member's* task id, and the lead reads the record rather than relaying. That is what gets correlation for free and keeps the lead out of that exchange (§3, inferred there).
2. **Visibility without asking.** A shared record the human reads ships in Claude Code (the task list, Ctrl+T), Symphony (the Linear issue) and Paperclip (issues), and human-readable member traces ship in Devin (the parent reads "the full trajectories") and Claude Code (transcripts in the agent panel) (§6). The task tree under one `contextId` is that record for this platform; it surfaces in the tool as sub-issues or a checklist and in the dashboard as the tree with each member's trace.
3. **Steering a member mid-run.** Ships: Claude Code (select a teammate, message it, Escape interrupts its turn), Devin (message a child, sleep or terminate it), Managed Agents (`user.interrupt` with `session_thread_id`) (§1a). For this platform it is a signal on the member's task, and it needs the interrupt semantics G17 asks about.
4. **Accountability and identity.** The human stays the assignee in the work tool and the agent is "added as a contributor" (Linear, §5). In team products members run under the lead's permission mode and session-scoped credentials, a denied member "can't relay it to another teammate to bypass the check", and Symphony's spec says "do not pass tracker credentials through the coding-agent child environment" (§5), which is the vault-at-egress rule from `03-deployment.md` stated by a vendor. `origin` (Part A) travels down every hop.

### What is measured, and what it does to the stance

This is the part first principles could not supply (§4, all `[V]`):

| Finding | Number | Source |
|---|---|---|
| A lead multiplies cost | 3 to 15 times a single agent's tokens (Anthropic); about 7 times for Claude Code teams in plan mode; 285% overhead for centralised coordination | Anthropic research system; Claude Code costs; Scaling Agent Systems, N=260 configurations |
| A lead pays only on breadth-first, low-baseline work | centralised +80.8% on financial reasoning, −3.1% on SWE-bench Verified, −19.2% on Terminal-Bench, −50.3% on PlanCraft; negative returns once the single agent exceeds about 45% accuracy; tool-heavy tasks (16 tools) suffer | Scaling Agent Systems v3, 2026-04-08 |
| A lead amplifies errors | 4.4× for centralised, 7.8× decentralised, 17.2× independent | same |
| Depth is where authorisation goes | unauthorised actions 2.7% at one level, 11.7% at two, 19.8% at three | MasDrift (5b) |
| Shared-record peers beat a planner on coding | +10.5 percentage points on SWE-bench Verified at about half the cost per task; Anemoi 52.7% against 43.6% on GAIA | arXiv 2606.10662; Anemoi v3 |
| Every vendor with a team primitive caps depth at one | Managed Agents "only delegate to one level"; Agentforce "Agent A>Agent B, not Agent A->B->C"; Claude Code "No nested teams" | §5 |

Two consequences for the proposal:

- **Depth.** `05-proposal.md` Part B said depth two, default one. Three vendors independently enforce one, and MasDrift's curve climbs steeply at two. Decided by Roberto the same day: Roberto, 2026-09-27: "I can definitely see the point for single level depth. I find it difficult to think of any use case, coding or not, that really needs more than single depth; if an agent needs to defer as part of a loop, the orchestrator or coordinator can always fill that role." One level, enforced by the platform; a member that needs more asks its coordinator or the human through the record and never delegates onward. Depth two is no longer registered; the hop-two authorisation gap (G30) is moot unless this decision is revisited.
- **The default for coding work is the record, not a lead.** Workloads A and C in `01-target.md` are coding work. The 2026 numbers put a planner below the single agent on SWE-bench and shared-record peers above both. The work tool already is the record. So a lead is the shape for breadth-first work with a weak single-agent baseline (research, triage across many sources), and the artefact is the shape for coding. Anthropic's own placement agrees: teams for work where members "need to share findings, challenge each other, and coordinate on their own"; a single session or subagents "for sequential tasks, same-file edits, or work with many dependencies" (§1a).

### Options

**1. Lead as a role, no team object.** A team is a lead agent whose manifest carries a lead flag and lists its members in `delegation.allow`; the record is the task tree; the human addresses the lead as any agent.
- Pattern: bounded orchestrator (Part B); the manifest flag is Managed Agents' `multiagent.type: coordinator` with a roster, Bedrock's `agentCollaboration: SUPERVISOR`, Claude Code's `team-lead` (§6).
- Why here: it is what every shipped team is, and it needs nothing beyond Part B and one manifest field.
- Where it appears: Part B; new as a manifest field.
- Cost: the human has to know which agent is the lead; two leads cannot share members' state except through the record.
- Cost of the next change: a new team is a new lead manifest.

**2. A team as a platform object.** A team address that resolves to a lead, a membership list the registry holds, a team-scoped task list, a team card.
- Pattern: a second addressable kind in the registry.
- Why here: it would let a human address a team without knowing its lead.
- Where it appears: nowhere; the research found "no product addresses a team as an object" (§6). Managed Agents addresses the session whose primary thread is the coordinator; Claude Code has "one team per session".
- Cost: a second entity with its own lifecycle and policy, for a counterpart the human's tools do not have.
- Cost of the next change: a new team is a registry entry plus a lead manifest.

**3. Artefact-mediated only.** No lead. Agents are joined through the business tool; the human speaks to the issue.
- Pattern: choreography through the record; Symphony over Linear is the shipped instance (§1b).
- Why here: candidate C in `01-target.md`; it needs no coordination machinery, and for coding work it is the shape the numbers favour.
- Where it appears: the first workload's design.
- Cost: no party holds the plan; the artefact's structure is the coordination; it does not scale to work that needs a plan revised mid-flight.
- Cost of the next change: a new participant is a new agent with a subscription on the tool.

### Stance, revised against the evidence

Option 3 for the first workload and for coding work generally; option 1 for breadth-first work where the single agent is weak, gated by the Scaling paper's three criteria (parallelisable, few tools, single-agent baseline under about 45%); option 2 registered with the condition "a human needs to address a team without knowing its lead, or two leads need to share members". Whichever shape, the four additions hold: member questions land in the record under the member's id, the record is readable without asking the lead, a per-member line for steering exists, and depth is one (decided, Roberto 2026-09-27).

The first-principles stance survived on shape and moved on two points. It had option 1 as the default and option 3 as the first workload; the numbers put option 3 first for coding and make option 1 the gated exception. It accepted the proposal's depth two; the vendors' one-level convergence and the drift curve say one.

Assumptions this rests on, and what changes if wrong: that the first workload is coding work (if it is triage or research across sources, option 1 is the default and the gate criteria apply); that the Scaling paper's 45% threshold transfers from its benchmarks to business-tool work (it is the only measured threshold; treat it as a prior to be replaced by the workload's own numbers); that Linear's one-delegate-per-issue model tolerates several agents on one issue (the research notes several delegates on one issue is undocumented; Codegen's agent creates sub-issues and assigns itself, secondary source).

### The two patterns, side by side

| | Direct to agent | Communicating with a team |
|---|---|---|
| What the human addresses | one agent | the record (coding work), or the lead (breadth-first work) |
| Where the human's message lands | the agent's task | the issue, or the lead's task |
| Who is accountable in the tool | the human assignee; the agent is a contributor | the same; the lead is a contributor too |
| How an agent's question reaches the human | `INPUT_REQUIRED` into the origin thread | the same, from whichever member asks, under the member's task id |
| What the platform adds | nothing beyond Parts A to C | a lead flag and `delegation.allow` on the manifest; the task tree surfaced in the tool and dashboard with member traces; a signal to a member for steering; depth one enforced |
| Cost | one agent's tokens | 3× to 15× for a lead; for shared-record peers on coding, about half a planner's cost |
| What it rejects | a front desk | a team object, until a condition raises it; a lead as the default for coding |
