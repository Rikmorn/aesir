# Topic 5 proposal: how agents get work, work together, and are found

Status: written 2026-09-21 as a fresh-look proposal, after Roberto's reframing (the job concept is a candidate, not a baseline; "against the grain" meant reaching one agent among a hundred; nothing in the repo is set in stone). It is a proposal for him to read cold and argue with. Nothing is decided.

## How to read this

It rests on the nine research files under `research/`: the four from 2026-09-16 and the five from 2026-09-21. Short names in the source columns: "standards" is `2026-09-21-coordination-standards-landscape.md`, "transports" is `2026-09-21-agent-to-agent-transports.md`, "entry point" is `2026-09-21-human-entry-point.md`, "addressing" is `2026-09-21-addressing-at-organisation-scale.md`, "gaps" is `2026-09-21-harness-container-gaps.md`, and "coordination 09-16" is `2026-09-16-multi-agent-coordination-prior-art.md`. Every claim below is verified there from a fetched primary source unless it says believed or inferred; the file and section are named so the source is one hop away. Aesir's existing code appears only in the last section, as evidence of what exists, per the design-pass rule that the surrounding code is evidence, not authority.

The proposal answers three questions in order: what the durable record of a unit of work is; how agents work together on it; how a caller, human, event or agent, reaches the right agent among many. Constraints come first, because the suggestion is only as good as they are.

## The constraints

| # | Constraint | Source |
|---|---|---|
| C1 | Claude Code, Linear, GitHub and Slack all speak MCP; none speaks A2A. Each business tool has its own, unshared agent-session model: Linear's sessions with `elicitation` and `prompted`, Slack's `agent_view` sessions, GitHub's Agent HQ through GitHub Apps with an unpublished protocol. "Claude in Slack" spawns a session from an `@Claude` mention | standards §5 |
| C2 | Exactly one foundation-governed durable job record exists: A2A's Task (v1.0, 2026-03-12; Agentic AI Foundation since 2026-08-27). MCP's Tasks extension has the same shape minus grouping and artifacts, is opt-in, and no client in the community matrix supports it. IBM's ACP was archived into A2A; the 2023 Agent Protocol is dormant; LangChain's run and thread are alive but vendor-bound | standards §1, §2 |
| C3 | Every live standard is orchestration: a caller opens a task and waits, streams, polls or receives a webhook. Publish and subscribe exists only as transport under an orchestrator; conversation handoff exists only inside vendor SDKs. No documented production choreography among LLM agents was found; the event-mesh vendors put an orchestrator on their bus | standards §3; transports §4 |
| C4 | A2A's reach beyond a named counterparty is unproven: an audit found zero of fifty advertised endpoints answering a task. Practitioner critiques converge on "MCP plus an orchestrator" for your own agents and A2A for a named counterparty | standards §4 |
| C5 | At a hundred agents two separate things ship: a registry that lists and governs (name, owner, status, version, description, skills; keyword search, some semantic) and a gateway that routes by the address the caller supplies and enforces policy. No gateway puts a model in the route. An LLM that picks an agent exists only inside chat products, bounded at roughly 30 to 40 choices. Past that, vendors ship search-before-select. Microsoft states the split: Agent 365 is "the unified registry and control plane"; the orchestrators live in the chat products | addressing §1, §2, §4, §7 |
| C6 | Delegation depth is where authorisation is lost: unauthorised actions 0.4% for a single agent, 2.7% at one supervisor level, 11.7% at two, 19.8% at three. Vendor caps: Managed Agents one level, Claude Code three. Anthropic bounded its orchestrator rather than replacing it, and moved the plan into a script for large runs because "every result goes into a context window" | entry point §4; transports §5 |
| C7 | No protocol addresses a callee that is not a live process. The reference A2A SDKs persist the task record, not the execution; the executor exits at `INPUT_REQUIRED` and the next message on the same task starts a new execution; a resubscribe with no live bus returns the stored snapshot | transports §1 |
| C8 | "Ask a human" is the same in every framework: a tool call ends the turn with a typed request, state is durable and keyed by an id, a correlated message resumes it, and the human's channel is the tool they already use. Linear's `elicitation` activity and `prompted` webhook are that contract | coordination 09-16 §4; entry point §2 |
| C9 | Identity between agents is a per-agent workload identity plus a bearer token, declared on the card and enforced at the gateway. A2A payloads carry no user identity. Human authorisation propagates one hop in shipped systems; nothing enforces it at hop two | transports §6; addressing §6 |
| C10 | Machine events are routed by a rule that names the agent in every work-tool product; Copilot Studio is the one product that routes events through its LLM orchestrator | entry point §5; addressing §4 |

Two constraints from the earlier topics also bind: the loop runs in stateless replicas that claim a durable conversation from a store and release it on pause (`03-deployment.md`), and inbound events enter through one ingress with a durable inbox deduplicated on the provider's delivery id (`04-events.md`).

## Part A: the record of a unit of work

**Suggestion.** Adopt A2A's Task as the schema of the durable job record, stored by the platform in one place, and add four fields the standard leaves to the client.

The A2A Task carries everything C2 lists as the settled shape: a server-minted `taskId`; a `contextId` that groups related tasks and messages; a closed state set, `SUBMITTED`, `WORKING`, the interrupted `INPUT_REQUIRED` and `AUTH_REQUIRED`, and the terminal `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`, with the rule that a terminal task cannot restart; artifacts; history; a per-task push notification configuration. Both reference SDKs persist it to a database (transports §1). Adopting the shape, not necessarily the wire protocol, costs nothing now and makes the A2A endpoint in Part B an endpoint rather than a migration later.

The four additions, each with its reason:

| Field | Why | Source |
|---|---|---|
| `stopReason` on the interrupted state: `end_turn`, `requires_action` with the ids it waits on, `budget_reached`, `timeout` | Every vendor session model converged on a pause state with a typed reason; A2A has the state but not the reason; LangChain's run adds `timeout` as a status | standards §2; gaps §1 |
| `caller`: who opened the task, agent or human, with the identity the gateway verified | Completion delivery and authorisation both key on it; A2A leaves the caller to the client | transports §6 |
| `origin`: the originating human request text and its tool reference, copied down every hop | MasDrift's source re-anchoring is the one defence with a measured effect, at 6.6% to 19.3% more tokens; nothing in a protocol carries it | entry point §4; transports §6 |
| `completionRecord`: the final status and summary written on the row itself, whether or not delivery succeeded | A2A never says what happens when the push target is gone; the row as the durable record is the only shipped answer besides Dapr's outbox | transports "Implications" |

What the record does not carry, by choice:

- **No negotiation states.** No standard has a counter-proposal, and the evidence for it is a scenario suite, not a workload. A callee that cannot take the work returns `REJECTED`; a callee that needs more returns `INPUT_REQUIRED` to the caller. Both are A2A-native.
- **No group entity.** Parallel work is several tasks sharing one `contextId`, which A2A defines. The join policy (all, any, majority) is the caller's wait, not a stored object; no protocol expresses one and every system treats it as application logic (transports "Implications").
- **No human assignee.** A human enters through C8, as a question on a task, never as a task's owner. That removes the peer directory, the human handoff and the operator channel in one move. Confirmed by Roberto on 2026-09-21: the human-as-agent concept from before the pivot is noise unless current standards have it, and they do not; a human in the loop is reached through applications (GitHub, Slack, Telegram, email, whatever the workload uses). The channel list is open: each channel is a bundle's inbound adapter and outbound tool (`04-events.md`), and the ask-and-answer contract is channel-agnostic, which is the one idea from ADR-0008 worth carrying (classify by intent, reply by origin).

**Verdict on aesir's task concept, since you asked for one.** The shape was right and the schema is not worth keeping. The research confirms three of its mechanisms as ahead of the standards: the completion dispatcher with the orphan record, the result written on the row, and the lookup of the caller's current conversation so a completion survives the caller's own restart. (2026-09-27: the code survey confirmed all three exist, with implementation defects listed in `07-path.md`; "keep the mechanism" means keep the shape and rewrite the implementation.) It contradicts the rest: an own status enum where a foundation one now exists, a handshake pause and counter-proposal with no counterpart anywhere, groups as entities, a human as assignee, and a depth cap of five against vendor caps of one and three. Keep the three mechanisms; take the schema from A2A.

## Part B: how agents work together

**Suggestion.** Bounded orchestration over the record, with three ways to reach a callee and no choreography. Depth two, default one.

**The one shape.** A caller opens a task for a named callee, pauses durably, and is resumed by the completion signal. The callee runs a fresh conversation for the task, ends its turn with `INPUT_REQUIRED` when it needs the caller or a human, and ends with a terminal state. The tree of tasks under one `contextId` is the record of the composite job, in the store, readable by the dashboard and by anyone holding the id. That is C3's orchestration with C7's sleeping callee, and it keeps the single view that every choreography loses.

**Three transports, one record, shipped in this order.**

1. **In-platform.** The caller's tool writes the task and starts the callee's conversation through the store; the dispatcher signals completion. No HTTP between agents. This is what critiques recommend for your own agents (C4) and what the claimed loop already implies.
2. **A2A endpoint.** Each agent, or the gateway on its behalf, serves an Agent Card and `SendMessage` in both forms: blocking for a bounded call, `returnImmediately` for a job with push delivery to the caller's ingress. The callee behaves as the JavaScript SDK does: exit at `INPUT_REQUIRED`, snapshot on resubscribe (C7). Ship it when a named external counterparty exists or when the human's harness needs it (Part C); until then it is an adapter over transport 1 waiting to be written.
3. **Subscriptions.** An agent's manifest may subscribe to domain events another agent emits, matched by the same ingress rules as webhooks (C10), with a transactional outbox on the emitter so an event is not lost when the emitting turn fails after its side effect. Ship it only when a workload shows two agents that should react to each other without a caller; the first two-agent workload joins them through Linear instead, which is choreography through the business tool and needs none of this.

**Humans inside a job.** The callee ends its turn with `INPUT_REQUIRED` and a typed request; the platform writes the question into the tool thread the job came from (Linear `elicitation`, a PR review request, a Slack thread); the answer arrives as an event correlated by task and context id and resumes the task (C8). Approval before a declared high-risk tool uses the same pause. There is no operator channel; the human's coordinating surface is Part C.

**Bounds.** Delegation depth one, enforced by the platform (C6; decided by Roberto on 2026-09-27, see Part B continued). A token budget per task tree. A timeout on every pause, delivered as a signal. A maximum fan-out per task. These are manifest fields, enforced by the platform, not prompt guidance.

**What this rejects, and why.** Peer handoffs between equals: never, on the evidence (coordination 09-16 §2). An LLM anywhere in the machine-event path: never (C10). An organisation-wide LLM orchestrator: no such product ships; the choosing orchestrators are bounded components inside chat products (C5). A separate durable-execution engine or actor system underneath: not needed while the claimed loop holds (`03-deployment.md`).

## Part C: reaching one agent among a hundred

**Suggestion.** Your assumption is half right, and the right half is the whole answer. Build a registry and a gateway, keep any model out of the route, and give each of the three kinds of caller its own way in.

**The two components.** A **registry** holds one card per agent in the A2A Agent Card shape plus the two fields every vendor registry adds, owner and status: name, description, skills, endpoint, security schemes, version (addressing §1). It lists, searches and governs; it never picks. A **gateway** exposes the agents behind one address, authenticates the caller, enforces who may reach which agent, injects credentials at egress, and routes by the address the caller supplies (addressing §2). Together they are the "global orchestrator that acts like an API gateway", and there is no model in either.

**Naming.** Hierarchical in the infrastructure, flat where a tool needs a flat handle. An agent's canonical address is `organisation/team/agent`, the shape SPIFFE paths, Kubernetes namespaces and Gemini's URNs use (addressing §3). The same agent has a flat alias per tool: a Linear agent user, a Slack bot user, a GitHub App. The registry maps between them.

**Three callers, three answers.**

| Caller | How it reaches the agent | Model in the path | Source |
|---|---|---|---|
| A machine event (webhook, schedule, another agent's event) | A rule. The agent's manifest declares subscriptions by event type and correlation; the ingress matches and starts or resumes. Two subscribers to one event both receive it unless the manifest declares exclusivity | None | C10 |
| An agent | By address. The caller names the callee from its manifest's allow-list, or asks the registry for candidates matching a skill and picks from the handful returned. The gateway checks the caller's identity against the callee's policy | Only over a handful, after a search | C5, C9 |
| A human | Through the tool they are in: mention or assign, which at scale is a search box over the registry, as it is in Teams, Slack and Linear. Or through their own harness over MCP: list and search agents, open a task, read a task, answer a question, cancel. The harness's own model is the front desk, bounded by search-before-select | Only in the human's harness, over search results | C1, C5, entry point §3 |

**What the human's harness gets, precisely.** Aesir serves one MCP server (C1 says that is the protocol all four tools share): `agents.search`, `tasks.create`, `tasks.get`, `tasks.answer`, `tasks.cancel`, each a plain `tools/call` on the current stateless revision. A job that takes days is a task id the human's harness holds and polls later; Claude Code already backgrounds calls over two minutes and delivers the result as a notification (entry point §3). A question the agent raises on Tuesday reaches the human through the tool thread (Part B), not through the harness, because the harness session is not durable and the 2026-07-28 revision removed server-initiated requests (transports §2). When the MCP Tasks extension gains client support, the same server exposes the same jobs through it with no change to the record.

**At a hundred agents.** Teams are namespaces; the registry's search and each tool's picker work over a namespace first; pinning and collections keep the visible set small, as every vendor does (addressing §5). No caller, human or agent, ever chooses over the full catalogue with a model: the registry returns a handful, and the choosing happens over that. The threshold where a keyword search stops being enough and an embedding search is needed is unknown; the shipped numbers put degradation in the tens (addressing §4), so the trigger is "more than about forty agents in one namespace".

**What this does not build.** A chat surface. An organisation-wide orchestrator agent. Capability routing by an LLM over the catalogue. A registry API of its own invention: the record is the card, and when A2A settles a registry API (open since 2025-06) the registry exposes it.

## Part C, continued: reuse cluster service discovery, and let the harness ask

Roberto, 2026-09-21: "same way as we have service discovery in a cluster, we would need the same for agents (perhaps same mechanisms can be used?) harness could speak to it if an agent is wondering what else is available and if they need to delegate work?"

**Short answer.** Yes for three of the five needs, no for two, and there is one trap. Cluster service discovery answers where an agent is, how names nest, and who may reach whom. It does not answer what an agent is or which agent can do a thing. And under a claimed loop with scale-to-zero, "no endpoints" does not mean "unavailable", so the health half of service discovery is wrong for agents.

| Need | Cluster mechanism | Fits | Source |
|---|---|---|---|
| Where is agent X | One Kubernetes Service per agent; DNS `agent.team.svc`; kagent does exactly this and serves the card on the Service | Yes, as-is, for transport 2 (the A2A endpoint). Transport 1 never needs it: the caller writes a task and the callee's replicas claim it | coordination 09-16 §3; addressing §3 |
| How names nest | Namespace as team, cluster as organisation; SPIFFE paths and Gemini URNs carry the same three levels | Yes | addressing §3 |
| Who may call whom | NetworkPolicy at the network layer; the gateway's policy at the request layer (agentgateway's CEL rules over JWT claims; kagent enterprise `AccessPolicy` CRDs; Solo's mesh with SPIFFE identity) | Yes, at the gateway, not in DNS | addressing §2, §6 |
| What agent X is: description, skills, owner, status, version, security schemes | Not in DNS or Services. The A2A card at `/.well-known/agent-card.json` carries the first five; owner and status are labels or a CRD field, which is what every vendor registry adds | No; the card is the record, the Service only locates it | addressing §1, §3 |
| Which agent can do Y | Not a discovery primitive anywhere: DNS, Consul and Kubernetes answer "where is X", not "who can do Y"; Consul's tags and prepared queries are the closest and are operator-authored labels | No; this is the search tier over cards | coordination 09-16 §3 |

**The registry as a derived view, not a second source of truth.** The clean way to reuse the cluster is the one kagent and Gemini use: the agent's manifest becomes a cluster object (a CRD, or a labelled Service with the card as a ConfigMap), and a controller watches those objects and aggregates their cards into the registry. Gemini auto-registers what its runtime deploys and needs a manual `Service` resource for the rest; kagent's `Agent` CRD yields a Deployment and a Service, and the controller proxies A2A at `/api/a2a/{namespace}/{name}/` (addressing §1; transports §3). Aesir's build already emits cluster objects (G4 in `02-harness.md`); the registry entry is one more emitted object, and the controller reads it back. Nothing is registered by hand. The pattern of watching labelled objects to build a target list is Prometheus-style label discovery (believed; not re-verified this session).

**The trap.** Service discovery equates "healthy" with "has ready endpoints". A claimed-loop agent scaled to zero by KEDA has no endpoints and is fully available: its paused conversations are in the store and its next claim scales it up (`03-deployment.md`; gaps §5 says readiness is meaningless for a poller anyway). So an agent's availability is its registry status, active or retired, plus the store, never its endpoint count. Transport 2 inherits the cost: an A2A call to a zero-replica agent needs the gateway to buffer while the agent scales up, which is Knative's activator problem (scaling research §1). One more reason transport 1 ships first.

**The harness asking what is available.** Yes, and through the same two tools the human's harness gets, so there is one platform API, not two:

1. `agents.search(query, scope)` returns a handful of cards (name, description, skills, address) from the set the calling agent's manifest allows. The manifest field is `delegation.allow`, a list of namespaces or names, default empty. Empty means the agent cannot delegate, which the evidence says is the right default for most workloads (coordination 09-16 §6). The search never returns the whole catalogue; the model chooses over the handful. This is Anthropic's tool-search pattern applied to agents (addressing §4), with the A2A card as the description.
2. `tasks.create(agent, brief, context)` opens the task under the caller's `contextId`, copies `origin` down, and enforces depth, fan-out and budget from the manifest. The caller then waits durably. From the model's side that is one search, one pick, one call, one pause.

Two cautions that follow from the research. Cards are authored in the manifest, never generated from the prompt: kagent's generated card leaked a system prompt into the discovery endpoint (G22). And a card's description is text the caller's model reads, so registry write access is the build pipeline only, and cards should be signed as A2A `signatures` and AGNTCY's signed records allow; a card another team can edit is a prompt-injection path (inferred).

**What this settles.** The registry and gateway from Part C are cluster objects plus one controller plus agentgateway, which is an Agentic AI Foundation project that speaks MCP, A2A and the model APIs and runs on the Kubernetes Gateway API (addressing §2). Aesir builds the controller, the card schema in the manifest, and the two tools. It builds no discovery protocol of its own.

## Part B, continued: teams and the human (2026-09-27)

Roberto asked how a human talks to a team of coordinating agents and whether it goes through "a coordinator, almost like a project manager". Answered in `05-coordination.md` 5c from `research/2026-09-27-human-to-agent-team-patterns.md`. What changes in this proposal:

- **The project manager is Part B's caller.** Every shipped team product gives the human one counterpart, the lead, and the lead is a role one agent plays under a manifest flag; no product has a team object. So "speaking to a team" is direct addressing of a lead whose manifest names its members. Nothing new is built; the manifest gains a lead flag beside `delegation.allow`.
- **Depth one, decided.** Part B said two, default one. Managed Agents, Agentforce and Claude Code all enforce one level, and MasDrift's unauthorised-action rate climbs from 2.7% to 11.7% at the second. Roberto, 2026-09-27: "I can definitely see the point for single level depth. I find it difficult to think of any use case, coding or not, that really needs more than single depth; if an agent needs to defer as part of a loop, the orchestrator or coordinator can always fill that role." So depth one is enforced by the platform, a member that needs more work done asks its coordinator or the human through the record and never delegates onward, and depth two leaves the register.
- **For coding work, the record beats the lead.** The largest 2026 study (260 configurations) puts centralised coordination at −3.1% on SWE-bench Verified and −19.2% on Terminal-Bench, with 285% token overhead and negative returns once the single agent exceeds about 45%; shared-record peers score +10.5 points on SWE-bench at about half the cost. Workloads A and C are coding work and the work tool is the record. A lead is the shape for breadth-first work with a weak single-agent baseline, gated on parallelisability, few tools and that baseline.
- **Member questions land in the record under the member's task id, never relayed by the lead.** Copilot Studio documents the loss when the parent relays ("a brand-new query"); Linear's per-session `elicitation`, Symphony's `Human Review` state and Managed Agents' cross-posting with `session_thread_id` keep the thread. This is the "humans inside a job" paragraph above, with the correlation requirement made explicit.
- **Two additions the best products ship and this proposal now carries:** the task tree readable in the tool and the dashboard with each member's trace (Claude Code's task list and agent panel, Devin's child session links), and a signal to a member for steering (Claude Code, Devin, Managed Agents' `user.interrupt`).

## What this means for what exists

The fresh look applied to the code, briefly, so the cost is visible. Verified against the map in `05-coordination.md`.

| Existing | Disposition | Reason |
|---|---|---|
| Claim, heartbeat, pause and resume; the event log; the ingress and inbox from topic 4 | keep the mechanism; rewrite the implementation | the mechanism under every part above; the 2026-09-27 code survey found a heartbeat that fires only after a model response, no interrupt, stranded and lost signals, and a transcript stored as one rewritten document (`07-path.md`) |
| `TaskSignalDispatcher`, orphan record, `completion_result` on the row, parent-conversation lookup | keep the mechanism | Part A's verdict; ahead of the standards |
| `tasks` status enum, `counter_proposed`, the handshake pause, `task_groups` as entities | replace with the A2A lifecycle plus the four fields; groups become sibling tasks in one context and a wait | Part A |
| `MAX_DELEGATION_DEPTH = 5` | two, default one | C6 |
| Entity directory with capability embeddings and `directory:find` | becomes the registry: cards, owner, status, keyword search; embeddings return only when a namespace passes about forty agents | Part C |
| Human as `assignee_type`, `reach_via`, human handoff, operator chat | drop | Part A, C8 |
| `spawn_agent` in-process | keep; the cross-container bounded call is A2A transport 2 when it comes | Part B |
| `communication:ask`, `reply`, `ReplyContext`, the Linear `elicitation` mapping | keep; this is C8 built | Part B |
| Materialisation forward sync | the bundle's outbound tools | `04-events.md` |
| The LLM router and the hardcoded signal map | delete; replaced by subscriptions and correlation | C10; `00-as-is.md` finding 3 |
| New | registry and cards; gateway with policy and egress injection; the MCP server for harnesses; later the A2A endpoint and the outbox | Parts B and C |

## The suggestion in one paragraph, and its assumptions

Store one job record per unit of work in A2A's Task shape with a stop reason, a caller, an origin and a completion record; run bounded orchestration over it at depth two with in-platform delegation first, an A2A endpoint when a named counterparty needs it, and subscriptions only when a workload needs them; put a registry of cards and a policy gateway in front of the agents, keep every model out of the route, and give events a rule table, agents an address plus search, and humans the tool they are in plus their own harness over MCP.

The assumptions it rests on, and what changes if each is wrong:

1. **The first workload is tool-embedded**, one agent or two joined through Linear. If it is a chat-first product, Part C's ranking changes and a front desk of aesir's own becomes worth evaluating, with the costs recorded in `05-coordination.md` 5b.
2. **A2A stays the only foundation job record through 2027.** If MCP Tasks gains client support, the harness side gets native async and Part C's cost drops; the record does not change, because the two shapes are the same minus grouping and artifacts.
3. **No external agent runtime needs to call aesir agents in the first year.** If one does, transport 2 moves earlier; the record is already card-and-task shaped, so it is an endpoint, not a migration.
4. **No namespace passes about forty agents soon.** If one does, add the search tier before any routing by a model, never routing over the full catalogue.
5. **The claimed loop stays the execution model.** If topic 3 chooses actors, a "direct call" becomes a call to a live process; the record, the bounds and the addressing are unchanged.
6. **You are the end user, the builder and the administrator for the first workload.** If a second team arrives, the registry's owner and status fields and the gateway's policy are where multi-tenancy lands (G10 in `02-harness.md`), and nothing in the record changes.

## Cost of the next change

- The next agent: a manifest with a card, subscriptions and an allow-list; a build; a registry entry. No platform change.
- The next human surface (a colleague on Cursor or ChatGPT): an MCP client. No platform change.
- The next external counterparty: transport 2's endpoint configuration for that agent. No record change.
- The next event source: an ingress adapter in a bundle and subscription rules. No routing code.
- The next namespace past forty agents: the search tier on the registry. No caller changes.

## What to decide now and what to register

Decide now, in the exploration sense of taking a position the later topics build on: the record shape (Part A), bounded orchestration with in-platform delegation first (Part B), the registry-and-gateway split with no model in the route (Part C), and no front desk of aesir's own.

Register, each with the condition that raises it: a team as a platform object (a human must address a team without knowing its lead, or two leads must share members); subscriptions with an outbox (a workload with two agents that should react without a caller); the A2A endpoint (a named counterparty, or the harness needing it); the search tier (a namespace past about forty agents); enforced re-anchoring beyond one hop (depth two in production, and the IETF or A2A shipping something to enforce it); the MCP Tasks extension on the harness server (a client that supports it).

## Three questions, when you have caught up

1. Does the three-caller answer in Part C, events by rule, agents by address plus search, humans by tool and by harness, match the problem you had in mind with "a hundred agents"? If your picture was a single component that both lists and chooses, the evidence says the two are always separate, and I would want to know what the single component buys.
2. Is a platform-held record in A2A's shape acceptable, or do you want the pure microservice form where each agent owns its tasks and callers hold ids? I recommend against the pure form: it loses the single view of a composite job, and the research found no production instance of it among LLM agents.
3. The workload. Candidate C in `01-target.md`, product conversation to tickets then issue to PR, joined through Linear, exercises Parts A and B without building transports 2 or 3, and Part C at a scale of two.
