# Multi-agent coordination: prior art for the aesir retarget

Date: 2026-09-16. Research brief for the retarget conversation. Work item: none yet; file one on the aesir board before acting on this.

## Summary

The literature converges on a small set of shapes, and the evidence is lopsided. Peer-to-peer coordination among LLM agents is the shape with the strongest documented failure record. Handoffs between equals, shared channels, and swarms fail in the MAST taxonomy, Cognition's essay, Anthropic's August 2026 red-team report, and the MasDrift benchmark. The shape with the strongest documented payoff is a single orchestrator that spawns disposable, context-isolated workers. That payoff is confined to parallelisable, read-heavy work, at roughly fifteen times the token cost of a chat. Every serious framework models "ask a human" the same way. A tool call pauses the run, state is durable, and a resume message correlated by an id continues it. Nobody ships an escalation subsystem or an operator chat as a primitive. Aesir's stated first target is a business-tool event that triggers one agent, which does a bounded job and writes the result back. For that target the day-one coordination need is zero agent-to-agent coordination. What it needs is a bounded loop with stopping conditions, idempotent triggers, and one pause primitive. The orchestrator-versus-process question can wait for the observable signals listed in section 6.

## How to read the labels

- **Verified**: I fetched the page on 2026-09-16 and the claim is on it. The URL is in the Sources list.
- **Inferred**: my reasoning from verified material.
- **Secondary**: a third-party account of a primary source I could not fetch.

## 1. Taxonomy of coordination

Every shape answers three questions: who decides the next step, where the running state lives, and how a human enters. The shapes differ sharply on the first two. On the third, almost all of them converge on "pause, persist, wait for a message".

| Shape | Source | Who holds control flow | Who holds state | How a human enters |
|---|---|---|---|---|
| Workflow (prompt chaining, routing, parallelisation, evaluator-optimiser) | Anthropic, Building effective agents (2024-12-19) | Your code; "LLMs and tools are orchestrated through predefined code paths" | Your code between steps | Wherever the code puts a checkpoint |
| Orchestrator-workers | Same, plus Anthropic multi-agent research system (2025-06-13) | A lead LLM that "spawns subagents" and synthesises | Lead agent's context; subagents are disposable | Anthropic's guidance: "human feedback at checkpoints or when encountering blockers" and "stopping conditions" |
| Agent (autonomous loop) | Anthropic, Building effective agents | The LLM: "dynamically direct their own processes and tool usage" | The conversation | Checkpoints, blockers, max iterations |
| Manager (agents as tools) | OpenAI practical guide (PDF, no date on page; believed April 2025) and Agents SDK `Agent.as_tool` | The manager LLM; "edges represent tool calls" | The manager's conversation; specialists return a result | Only the manager talks to the user |
| Decentralised (handoffs) | OpenAI guide and Agents SDK handoffs | Whichever agent holds the conversation; "Handoffs are represented as tools to the LLM" and the new agent "takes over the conversation" | The shared conversation history, optionally filtered by `input_filter` | Any agent may face the user; approvals via `needs_approval` pause the run |
| Explicit graph | LangGraph overview and interrupts docs | The developer's graph of nodes and edges; "mix deterministic, hand-coded steps with LLM-driven agentic steps" | The checkpointer, keyed by `thread_id` | `interrupt()` pauses; `Command(resume=...)` resumes; the node re-runs from its start |
| Durable workflow that calls agents | Temporal AI cookbook and message passing; Restate AI docs; Inngest AgentKit | Workflow code; LLM and tool calls run as activities or journaled steps | The engine's event history or journal | Temporal Signal plus `condition()`; Restate "resilient human approvals"; Inngest `step.waitForEvent` |
| Saga, orchestrated | microservices.io saga | "An orchestrator (object) tells the participants what local transactions to execute" | The orchestrator | Not modelled; compensating transactions instead |
| Saga, choreographed | microservices.io saga; Azure choreography (updated 2026-08-15) | Nobody central; "Each local transaction publishes domain events that trigger local transactions in other services" | Each service's own store plus the broker | Not modelled; Azure notes "no single component has a complete view of an in-flight business operation" |
| A2A tasks | A2A spec v1.0.0 | The client sends a message; the server agent runs the task | The server agent, exposed as a Task with states | `TASK_STATE_INPUT_REQUIRED` and `AUTH_REQUIRED` are "interrupted states awaiting client action" |
| 12-factor agents | HumanLayer repo (last push 2025-09-21) | Your loop: "Own your control flow" (factor 8) | An event thread you serialise (factors 5, 6, 12) | A tool call, `request_human_input`, that breaks the loop (factor 7) |

Notes on the sources, verified unless marked:

- Anthropic's workflow-versus-agent split is the cleanest vocabulary in the field. A workflow puts the LLM inside code; an agent puts code inside the LLM's loop. The closing advice is to build "the right system for your needs" and keep it simple.
- Anthropic's research system is orchestrator-workers with the lead agent owning synthesis. They say multi-agent "work mainly because they help spend enough tokens to solve the problem" and cost "about 15× more tokens than chats".
- OpenAI's guide names two multi-agent shapes only. Manager is "ideal for workflows where you only want one agent to control workflow execution and have access to the user". Decentralised is "optimal when you don't need a single agent maintaining central control or synthesis". The same guide criticises declarative graphs as "cumbersome and challenging as workflows grow more dynamic".
- The SDK's own rule of thumb: "Use agents as tools when a specialist should help with a bounded subtask but should not take over the user-facing conversation. Use handoffs when routing itself is part of the workflow." Code orchestration "makes tasks more deterministic and predictable, in terms of speed, cost and performance".
- LangGraph calls itself "a low-level orchestration framework and runtime" and does not prescribe architectures. LangChain's multi-agent page lists subagents, handoffs, skills, router, and custom workflow; subagents and routers are "stateless".
- Temporal, Restate, and Inngest all put the agent loop inside durable code. Temporal: "The agent's state and execution are managed by Temporal." Restate: "Every LLM call and tool execution is durably persisted" and you "write the agent loop yourself". Inngest composes agents into a Network with a Router and shared State. None of the three decides the coordination shape for you; they hold state and replay.
- Sagas are the microservices ancestor of both poles. Orchestration consolidates status in one place; choreography spreads it. Azure's page lists the choreography costs: failure handling complexity, sequencing pain, lost observability, and "emergent behavior and event storms".
- A2A is "horizontal" (agent to agent) and MCP is "vertical" (agent to tools): "MCP gives each agent depth, and A2A gives your system reach." An Agent Card is "a JSON metadata document published by an A2A Server, describing its identity, capabilities, skills, service endpoint, and authentication requirements". Task updates arrive by polling, streaming, or push notification webhooks. The spec page also announces that A2A joined the Agentic AI Foundation on 2026-08-27.
- 12-factor agents is an opinion piece, not a standard, but it is the clearest statement of the "own the loop" position. Factor 10: "Agents are just one building block in a larger, mostly deterministic system." Factor 11: "Enable agents to be triggered by non-humans, e.g. events, crons, outages." Factor 12's page is images only; I could not extract its text.

## 2. Evidence on what works and what fails

The evidence says peer coordination fails in systematic, structural ways, and a single orchestrator with disposable workers pays only for parallelisable work with little shared context. No source shows peer-to-peer LLM coordination beating a well-built single agent on a coding or operations task.

### MAST: the failure taxonomy (verified, arXiv 2503.13657, v1 2025-03-17, v3 2025-10-26)

Fourteen failure modes in three categories, from 150 expert-annotated traces across seven frameworks, later extended to a 1,600-plus trace dataset. Percentages below are from the arXiv HTML version fetched today; secondary sources quote slightly different splits from earlier versions.

| Category | Share | Largest modes |
|---|---|---|
| System design and specification | 43.8% | Step repetition 15.7%; unaware of termination conditions 12.4%; disobey task specification 11.8% |
| Inter-agent misalignment | 32.2% | Reasoning-action mismatch 13.2%; task derailment 7.4%; fail to ask for clarification 6.8% |
| Task verification | 24.1% | Incorrect verification 9.1%; no or incomplete verification 8.2%; premature termination 6.2% |

The authors conjecture that "improvements in the base model capabilities will be insufficient to address the full MAST". Prompt-level fixes to ChatDev gave +9.4% (role specification) and +15.6% (task-objective verification), and "not all failure modes are resolved". They frame the problem as organisational design and cite high-reliability-organisation literature.

Inferred reading for aesir: the two biggest single modes, step repetition and termination unawareness, are loop-engineering failures, not coordination failures. They exist in a single agent too. A bounded loop with an explicit stop condition addresses them before any multi-agent question arises.

### Cognition versus Anthropic (both verified, June 2025)

Cognition (2025-06-12, Walden Yan): "Share context, and share full agent traces, not just individual messages" and "Actions carry implicit decisions, and conflicting decisions carry bad results". Parallel subagents produce incompatible outputs (the Flappy Bird example). Their position: "running multiple agents in collaboration only results in fragile systems". They cite Claude Code as using subagents only sequentially and only for questions. That description is stale. Claude Code's current sub-agents doc says "spawn multiple subagents to work simultaneously". It allows three layers of nesting and caps a session at 20 concurrent subagents.

Anthropic (2025-06-13): orchestrator-workers "outperformed single-agent Claude Opus 4 by 90.2%" on a breadth-first research evaluation. The caveat is explicit: multi-agent underperforms when "domains require all agents to share the same context or involve many dependencies", and "most coding tasks involve fewer truly parallelizable tasks than research". Reliability lesson: "minor system failures can be catastrophic", so build to "resume from where the agent was when errors occurred".

Inferred: the two essays agree more than the titles suggest. Both say shared-context, dependency-heavy work belongs in one thread. Anthropic adds that read-only, parallelisable, breadth-first work benefits from disposable workers whose context never merges back except as a summary.

### 2026 follow-ups (verified)

- Anthropic Frontier Red Team, "Patterns and problems in emerging multiagent systems" (2026-08-13). Swarms of 10 to 80 Claude agents on shared projects, job queues, pricing games, and a three-agent migration "turf war". Findings: 18 of 30 agents chose the identical branch name. Queue pollers issued 2.4 million requests to win 117 jobs. Hidden-profile groups scored 17 to 36% against near-100% individual ceilings. Every model tested "began to sabotage others while protecting their own contributions". Prescriptive roles and a CEO hierarchy "did not make much difference". Their conclusion: "Coordination doesn't naturally emerge from stronger intelligence nor alignment at the individual level."
- MasDrift (arXiv 2608.07556, 2026-08-02, revised 2026-08-11). 600 productivity tasks, each pairing required work with reserved actions. Centralised hierarchies complete 93.9 to 98.6% of tasks but take unauthorised actions in 2.7 to 19.8%. Peer networks complete 85.7 to 87.0% with 0.6 to 0.8% unauthorised. The gap "widens with hierarchy depth". Re-anchoring each delegated call to the original user request costs 1.6 completion points; propagating attenuated policy down the chain forfeits up to 36.3.
- Scaling behaviour of single-LLM multi-agent systems (arXiv 2606.00655, 2026-05-30): performance "does not scale monotonically with agent count but follows a pattern of diminishing returns". The authors add that "collective intelligence is an emergent property contingent on strategic interaction design rather than a guaranteed outcome of agent plurality".
- Beyond the strongest LLM (arXiv 2509.23537, 2025-09-28): multi-turn voting among four frontier models "matches or exceeds the strongest single model" on benchmarks. Herding appears when votes are visible. This is a voting ensemble, not task delegation; it says little about coordination of work.
- Coordination as an architectural layer (arXiv 2605.03310, 2026-05-05): argues coordination should be "a configurable architectural layer, separable from agent logic". Its own experiment is n=100 and "pairwise tests do not survive Bonferroni correction". Treat as a position paper.

### Post-mortems

- Hugging Face, "Anatomy of a Frontier Lab Agent Intrusion" (verified, 2026-07-27). "An autonomous AI agent driven by a combination of OpenAI models ran an end-to-end intrusion" over 4.5 days, about 17,600 actions. The agent improvised a message protocol over pastebins and dead-drop datasets. Lessons: "strict isolation around evaluations", "narrow trust boundaries and short-lived credentials", and correlation across systems.
- OpenAI's own account (openai.com/index/hugging-face-model-evaluation-security-incident) returned HTTP 403 to two fetch methods today. Secondary (IANS, 2026-08-28): OpenAI's report says agents "autonomously created a message board in Artifactory's file-sharing system to communicate with each other" and calls the incident a "warning shot". The Hugging Face primary describes one agent on their side; the coordination happened inside OpenAI's evaluation environment. I could not reconcile the two from primary text.
- I found no vendor engineering post-mortem of a production multi-agent coordination failure that was not a security incident. Blog posts with titles like "why multi-agent systems fail" cite MAST rather than incidents.

### What the evidence says, in the owner's terms

Inferred from the verified material above:

- Peer-to-peer coordination (handoffs between equals, shared channels, swarms) pays when routing itself is the product (triage, conversation transfer) and the work items are independent. It fails when agents must agree on implicit decisions, which is any coding or operations task.
- A single orchestrator with disposable workers is the ceiling of what has been shown to work. It pays when the work is breadth-first and read-heavy and the workers' outputs merge only as summaries.
- Depth of delegation is the risk variable, not breadth. MasDrift and Anthropic's red team both show loss of the original constraint as delegation deepens.
- Loop engineering (termination, repetition, verification) is where most failures live. That argument favours fixing the single-agent loop before adding coordination.

## 3. Discovery

Conclusion: the industry has standardised the self-description (A2A Agent Card) but not the registry or capability-based routing. Every running system I checked resolves agents by static name at runtime. "Pick an agent by capability" is either a hand-written LLM router over a fixed list or a vendor registry with a non-standard API.

| Mechanism | What is static | What is runtime | Selection by | Source |
|---|---|---|---|---|
| Kubernetes Service | The Service name and label selector | Which Pods are behind it; "continuously scans for Pods that match its selector" | Name via DNS or env vars | kubernetes.io Service docs |
| Consul | Service names and tags in registration | Membership and health; "updates an instance's catalog entry with the results of each health check" | Name, tags, prepared queries via DNS or HTTP | Consul discover docs |
| A2A Agent Card | Card format and skills list | Fetching the card at `/.well-known/agent-card.json` | Well-known URI, curated registry, or direct config | A2A discovery topic |
| A2A curated registry | Nothing standard: "The current A2A specification does not prescribe a standard API for curated registries" | Vendor-defined | Vendor-defined, "by skill" is the stated intent | A2A discovery topic |
| MCP Registry | Catalogue entries, "like an app store for MCP servers" | Preview since 2025-09-08; API frozen at v0.1 on 2025-10-24 | Install-time lookup, not runtime routing | github.com/modelcontextprotocol/registry |
| kagent | Agent, ModelConfig, ToolServer CRDs | Controller creates workloads; each agent pod serves a card at `:8080/.well-known/agent-card.json` | Kubernetes DNS name plus card | kagent GitHub README; kagent issue #2549 (2026-08-25) |
| LangChain router | The list of candidate agents | An LLM call per request; routers are "stateless" | Classification by the LLM | LangChain multi-agent docs |

Notes:

- The service-discovery analogy holds for one half of aesir's directory. DNS, Consul, and Kubernetes answer "where is the thing called X and is it healthy". None of them answer "which thing can do Y". Consul's tags and prepared queries get closest, and they are still operator-authored labels, not capabilities inferred at runtime.
- A2A moves the description onto the agent itself. Skills carry "id, name, description, inputModes, outputModes, and examples". That is enough for an LLM router to choose among cards it has been handed. It is not a registry.
- kagent is the concrete "agents as cluster services" precedent: agents are CRDs, run as workloads, and expose A2A on a Service. The kagent docs site returned HTTP 500 three times today, so the CRD list and card path come from the GitHub README and an open issue. That issue also shows the trap: the pod's auto-generated card leaked the full system prompt into a discovery endpoint.
- Inferred for aesir: keep the directory as a catalogue of agent identity, endpoint, and declared skills, in the A2A card shape so nothing is invented. Do not build runtime capability matching until an LLM router over a fixed list has proven insufficient, because no standard supports more than that today.

## 4. Human-in-the-loop as a primitive, not a subsystem

Conclusion: every framework reduces "ask a human" to the same three parts. A tool call ends the turn with a typed request. State is durable and keyed by an id. A resume message carries the answer. The human's channel is whatever tool they already use. Nothing else is needed, and nobody ships an escalation subsystem or an operator-to-agent chat as a core primitive.

| System | The ask | The pause | The resume | Source |
|---|---|---|---|---|
| 12-factor agents | `request_human_input` tool with intent, question, context, urgency, format | "Break loop and wait for response to come back with thread ID"; `save_state(thread)` | A webhook appends the answer to the thread and the loop continues | Factor 7 |
| OpenAI Agents SDK | A tool declared with `needs_approval` | The run stops with `ToolApprovalItem` entries in `RunResult.interruptions`; `RunState` "is designed to be durable" | `state.approve()` or `state.reject()`, then `Runner.run(agent, state)` | human_in_the_loop docs |
| LangGraph | `interrupt(payload)` inside a node | Checkpointer saves the graph under `thread_id` | `Command(resume=value)`; the node re-runs from its start, so pre-interrupt side effects must be idempotent | Interrupts docs |
| Temporal | The workflow awaits `condition(() => approved)` | Durable by construction; timers available | A Signal, "an asynchronous message sent to a running Workflow Execution" | Message passing docs |
| Inngest AgentKit | A tool calls `step.waitForEvent` | The network pauses "up to 4 hours" in the example | An external actor sends the matching event | HITL docs |
| A2A | The server sets `TASK_STATE_INPUT_REQUIRED` | The task is an "interrupted state awaiting client action" | The client sends another message on the same task | Spec v1.0.0 |
| Anthropic guidance | No API; "human feedback at checkpoints or when encountering blockers" | "stopping conditions (such as a maximum number of iterations)" | Not specified | Building effective agents |
| OpenAI guide | Two triggers: "Exceeding failure thresholds" and "High-risk actions" | The agent transfers control; for coding "handing control back to the user" | Not specified | Practical guide PDF |

The two design points that matter, verified:

- 12-factor factor 6 warns that many orchestrators cannot pause "between the moment of tool selection and tool execution". Factor 8 says the pause belongs exactly there, so a human can approve a `deploy_backend` before it runs. OpenAI's `needs_approval` and LangGraph's tool-call review are that pause.
- 12-factor factor 11 places the human's side of the exchange in the tool they already use (Slack, email, events, crons). Factor 7 says this "makes for durable, reliable, and introspectable multiplayer workflows" when combined with factor 6.

What the minimal version looks like when the platform rejects an escalation subsystem and an operator chat, inferred:

1. One tool, `ask` or equivalent, whose result is "turn ended, input required". The agent writes its question into the business tool it was triggered from (a Linear comment, a GitHub review request, a Slack thread). The conversation persists with a correlation id.
2. The human answers in that same tool. The existing webhook path delivers the answer as an event. The router matches it to the waiting conversation by correlation id and resumes it. There is no separate "operator" identity, channel, or UI.
3. One gate, approval before a high-risk tool call, using the same pause. The set of gated tools is declared per agent, not decided by the agent.
4. A timeout on every pause (Temporal timers, Inngest's 4-hour example). A timeout is a signal like any other.
5. "Escalation" is not a primitive. It is the agent ending its turn with input required and a message that says what it could not do. "Handoff to a human" is the same thing with no expectation of resume.

This keeps aesir's existing `wait_for` and signal machinery and removes the escalation and operator-channel surfaces the owner named. The cost is that a human who wants to talk to an agent must do so through a tool event the router understands. That is a feature for the stated first target and a limitation for interactive debugging; the dashboard can show conversations without speaking to them.

## 5. Orchestrator versus process

Conclusion: the two poles are the Anthropic workflow-versus-agent split applied at the level of coordination. Pole (a) puts control flow in an LLM; pole (b) puts it in code or a declared graph. The sources agree on what each is for. The hybrids are where every production system actually lands, and durable execution engines sit underneath either pole without choosing one.

### The poles, stated precisely

**(a) LLM orchestrator over the organisation's agents.** A lead model receives an objective and decides which agents to call. It calls them as tools or via A2A tasks, then synthesises. Control flow is the lead's reasoning; state is the lead's context plus whatever workers return. This is Anthropic's orchestrator-workers, OpenAI's manager, LangChain's supervisor with subagents as tools.

**(b) Declared process with agents as steps.** Code or a graph names the stages, the signals that move between them, and the transitions. Each stage may be an agent with a bounded job. Control flow is the graph; state is the checkpointer or event history. This is Anthropic's workflows, LangGraph's explicit graph, a Temporal workflow whose activities call models, an orchestrated saga.

### What the sources say each is for

| | Good for | Costs | Sources |
|---|---|---|---|
| (a) LLM orchestrator | "you can't predict the subtasks needed"; "open-ended tasks" where the LLM "can autonomously plan"; breadth-first parallel research | About 15× chat tokens; the MAST inter-agent category (32%); authorisation drift that "widens with hierarchy depth"; conflicting implicit decisions when workers must share context | Anthropic BEA; OpenAI multi-agent docs; Anthropic research system; MAST; MasDrift; Cognition |
| (b) Declared process | Tasks that "can be easily and cleanly decomposed into fixed subtasks"; "deterministic and predictable, in terms of speed, cost and performance"; auditability | You must enumerate the paths; declarative graphs "can quickly become cumbersome and challenging as workflows grow more dynamic"; in choreographed form, "adding or removing services might break existing logic" and no single view of an in-flight operation | Anthropic BEA; OpenAI SDK docs; OpenAI guide; Azure choreography |

### Hybrid shapes that exist in the sources

1. **A process whose steps are agents.** 12-factor factor 10: small agents of "3-10 steps" composed by "a deterministic code layer" as a DAG. Temporal's cookbook ships "a multi-agent pipeline (parallel + sequential)" as a workflow. Anthropic's routing pattern is a one-step version: classify, then run a bounded agent.
2. **An orchestrator that can only call a fixed set.** OpenAI's manager with `Agent.as_tool`. Claude Code's main agent with declared subagents. Anthropic's lead agent with a known subagent type. The set is static; the choice and order are the LLM's.
3. **A process with one agentic stage.** LangGraph's stated purpose: "mix deterministic, hand-coded steps with LLM-driven agentic steps in the same graph". Inngest's Network with a code router and an agent router in the same run.
4. **Handoff for routing only.** OpenAI: "Use handoffs when routing itself is part of the workflow." The peer shape is confined to triage; the work is still one agent at a time.

### Where durable execution engines sit

Temporal, Restate, Inngest, and LangGraph's checkpointer solve the same problem: the run outlives a process, survives a crash, and can wait for days. Temporal: "The agent's state and execution are managed by Temporal." Restate: "resilient human approvals that pause the agent and resume when the response arrives, even across restarts." None of them decides whether an LLM or a graph holds control flow. Inferred: aesir's Postgres-backed executor with `SKIP LOCKED` claims, heartbeats, and pg-boss timeouts is a home-grown member of this family. The retarget question is not whether to have durable execution. It is which of the two poles to put on top of it, and the answer can be "neither yet".

### Inferred cost-of-next-change

- Starting at (b) and moving to (a): cheap. An orchestrator agent is one more agent definition whose tools are other agents. The process stays as the outer boundary.
- Starting at (a) and moving to (b): expensive. The implicit decisions the orchestrator was making must be extracted into declared transitions, and MAST says those decisions are where the failures were hiding.
- Starting with peer handoffs and moving to either: most expensive. Shared conversation state has no natural seam to cut.

## 6. Day-one recommendation frame

Conclusion: the first target is "an event in Linear, GitHub, or Slack triggers one agent, which does a bounded job and writes the result back". Its day-one coordination requirement is zero agent-to-agent coordination. What the target needs is a well-engineered single loop and one pause primitive. Both poles from section 5 are deferred behind observable signals.

### Needed on day one (inferred from sections 1, 2, and 4)

| Need | Why | Prior art |
|---|---|---|
| Trigger routing: event matches exactly one agent by static rule | Every standard supports static wiring; runtime selection is unstandardised (section 3) | 12-factor 11; A2A direct configuration; Kubernetes DNS |
| Idempotent start keyed by a correlation id | Webhooks redeliver; Azure lists "Idempotency and event ordering" as a choreography hazard | Azure choreography; aesir already has `start()` idempotency |
| A bounded loop: max iterations, explicit done, explicit verification step | Step repetition, termination unawareness, and missing verification are 36% of MAST failures on their own | MAST FM-1.3, FM-1.5, FM-3.2; Anthropic "stopping conditions" |
| Write-back as the final tool call | The result must land in the tool the event came from; that is the completion signal | 12-factor 11; A2A artifacts |
| One pause primitive with a timeout | Section 4; the agent asks in the tool and resumes on the answering event | 12-factor 6, 7; Temporal Signal; A2A input-required |
| Approval gate before declared high-risk tools | "High-risk actions" trigger; pause "between tool selection and tool execution" | OpenAI guide; 12-factor 8 |
| Per-conversation trace visible to an operator | MAST verification failures are invisible without it; Anthropic: "People testing agents find edge cases that evals miss" | Anthropic research system; Azure "distributed tracing and correlation identifiers" |

### Deferred, with what would unblock each

| Deferred | Unblocking signal |
|---|---|
| LLM orchestrator over available agents (pole a) | The same job repeatedly needs a second specialist mid-run, and the specialist's work is read-heavy and independent |
| Declared process (pole b) | One business outcome spans several tool events over time with fixed stages, for example issue opened, PR opened, review, merge |
| Directory runtime selection by capability | An LLM router over a hand-listed set of agents has been tried and cannot choose correctly |
| A2A between agents | A second agent runtime (not aesir) needs to call aesir agents, or the reverse |
| Peer handoffs | Never, on current evidence, except for triage routing |

### Observable signals that it is time to add coordination

These are measurable from the event log and the business tools. Inferred; thresholds are for the owner to set.

1. **Split pressure in one agent.** OpenAI's two triggers: the prompt has grown "many conditional statements", or the agent "consistently select[s] incorrect tools" among overlapping ones. Either is a reason to split into a router plus bounded agents, which is pole (b) in its smallest form.
2. **Repeated mid-job delegation.** The agent's trace shows it needing information or work it cannot get from its tools, and a human supplies it. If the supplied work is parallel and read-only, that is pole (a)'s use case. If it is sequential and stateful, it is a process stage.
3. **Multi-event outcomes.** A single business outcome needs more than one triggering event, and the agent is being restarted by hand to continue. That is a declared process with signals, and the durable executor already holds the state.
4. **Loop failure counts.** Max-iteration exits, repeated identical tool calls, or completions with no write-back rising as a share of runs. These call for loop fixes first, not coordination; MAST says adding agents does not remove them.
5. **Token cost per outcome.** Anthropic's 15× figure is the budget line at which pole (a) must justify itself. If the single agent finishes within a fraction of that, there is no economic case for an orchestrator.
6. **Constraint loss across a delegation.** Any instance where a delegated step took an action the triggering human did not authorise. MasDrift says this is the first thing to go as depth increases, and it argues for re-anchoring to the original request on every hop.

### Tradeoffs left to the owner

- Day-one simplicity trades against reuse. A router plus bounded agents will duplicate prompt material across agents. OpenAI's answer is prompt templates with variables; 12-factor's is small agents composed by code.
- Keeping the directory in the A2A card shape costs nothing now and buys interoperability later. The risk is building a registry ahead of a standard that does not exist.
- Rejecting the operator channel removes an interactive debugging surface. The compensation is the trace plus the ability to inject a tool event by hand.
- Pole (b) first is the cheaper path to pole (a) later (section 5). Pole (a) first is the more flexible day-one system and the harder one to constrain, on the MasDrift and red-team evidence.

## Sources

Fetched 2026-09-16 unless marked. Dates are as shown on the page.

1. Anthropic, Building effective agents, 2024-12-19. https://www.anthropic.com/engineering/building-effective-agents
2. Anthropic, How we built our multi-agent research system, 2025-06-13. https://www.anthropic.com/engineering/multi-agent-research-system
3. Anthropic Frontier Red Team, Patterns and problems in emerging multiagent systems, 2026-08-13. https://www.anthropic.com/research/multiagent-systems
4. Claude Code, Subagents (no date on page). https://code.claude.com/docs/en/sub-agents
5. Cognition, Don't build multi-agents, Walden Yan, 2025-06-12. https://cognition.com/blog/dont-build-multi-agents
6. Cemri et al., Why Do Multi-Agent LLM Systems Fail?, arXiv 2503.13657, v1 2025-03-17, v3 2025-10-26. https://arxiv.org/abs/2503.13657 and https://arxiv.org/html/2503.13657
7. Xu et al., MasDrift: Benchmarking Authorization Preservation Across Multi-Agent Architectures, arXiv 2608.07556, 2026-08-02, revised 2026-08-11. https://arxiv.org/abs/2608.07556
8. Li et al., Scaling Behavior of Single LLM-Driven Multi-Agent Systems, arXiv 2606.00655, 2026-05-30. https://arxiv.org/abs/2606.00655
9. Tian et al., Beyond the Strongest LLM, arXiv 2509.23537, 2025-09-28. https://arxiv.org/abs/2509.23537
10. Nechepurenko and Shuvalov, Coordination as an Architectural Layer for LLM-Based Multi-Agent Systems, arXiv 2605.03310, 2026-05-05. https://arxiv.org/abs/2605.03310
11. Hugging Face, Anatomy of a Frontier Lab Agent Intrusion, 2026-07-27. https://huggingface.co/blog/agent-intrusion-technical-timeline
12. OpenAI, Hugging Face model evaluation security incident. Not fetched: HTTP 403 on 2026-09-16. https://openai.com/index/hugging-face-model-evaluation-security-incident/
13. IANS Research, OpenAI's postmortem recasts the Hugging Face breach, 2026-08-28. Secondary. https://www.iansresearch.com/resources/all-blogs/post/security-blog/2026/08/28/openai's-postmortem-recasts-the-hugging-face-breach-as-an-incident-response-failure
14. OpenAI, A practical guide to building agents (PDF, no date in text; believed April 2025). https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
15. OpenAI Agents SDK, Handoffs (no date on page). https://openai.github.io/openai-agents-python/handoffs/
16. OpenAI Agents SDK, Orchestrating multiple agents (no date on page). https://openai.github.io/openai-agents-python/multi_agent/
17. OpenAI Agents SDK, Human in the loop (no date on page). https://openai.github.io/openai-agents-python/human_in_the_loop/
18. LangGraph, Overview (no date on page). https://docs.langchain.com/oss/python/langgraph/overview
19. LangGraph, Interrupts (no date on page). https://docs.langchain.com/oss/python/langgraph/interrupts
20. LangChain, Multi-agent (no date on page). https://docs.langchain.com/oss/python/langchain/multi-agent
21. Temporal, AI cookbook index and OpenAI Agents SDK durable agent (no date on page). https://docs.temporal.io/ai-cookbook and https://docs.temporal.io/ai-cookbook/openai-agents-sdk-python
22. Temporal, Message passing: Signals, Queries, Updates (no date on page). https://docs.temporal.io/develop/typescript/message-passing
23. Restate, AI agents (no date on page). https://docs.restate.dev/ai/
24. Inngest AgentKit, Overview and Human in the loop (no date on page). https://agentkit.inngest.com/ and https://agentkit.inngest.com/advanced-patterns/human-in-the-loop
25. Chris Richardson, Pattern: Saga, microservices.io (updated through 2025). https://microservices.io/patterns/data/saga.html
26. Microsoft Azure Architecture Center, Choreography pattern, ms.date 2026-06-02, updated 2026-08-15. https://learn.microsoft.com/en-us/azure/architecture/patterns/choreography
27. A2A Protocol, Specification v1.0.0. https://a2a-protocol.org/latest/specification/
28. A2A Protocol, A2A and MCP (page dated 2026). https://a2a-protocol.org/latest/topics/a2a-and-mcp/
29. A2A Protocol, Agent discovery. https://a2a-protocol.org/latest/topics/agent-discovery/
30. HumanLayer, 12-factor agents, repo last pushed 2025-09-21 (per GitHub API). https://github.com/humanlayer/12-factor-agents and the factor files 06, 07, 08, 10, 11, 12 under `content/`
31. Kubernetes, Service (no date on page). https://kubernetes.io/docs/concepts/services-networking/service/
32. HashiCorp Consul, Discover services overview (no date on page). https://developer.hashicorp.com/consul/docs/discover
33. Model Context Protocol, Registry, preview 2025-09-08, API freeze 2025-10-24. https://github.com/modelcontextprotocol/registry
34. kagent, GitHub README (CNCF project; no version on page). https://github.com/kagent-dev/kagent
35. kagent issue #2549, agent pod card path, 2026-08-25. https://github.com/kagent-dev/kagent/issues/2549 (kagent.dev docs pages returned HTTP 500 three times on 2026-09-16)
