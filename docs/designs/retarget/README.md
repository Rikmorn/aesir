# Retarget 2026-09: index

Issue: not yet filed. A `change-request` issue on Rikmorn/aesir is opened once topic 1 settles what the request is; until then this file is the index.

## What this is

Exploration and analysis, written down so the work survives across sessions. Nothing here is a build commitment. Roberto, 2026-09-16: "i'm not expecting us to build anything just yet, i want to explore the topics, analyse what if anything we should change, what it should change to, and write it down somewhere."

The direction under exploration, in his words: aesir remains an agent platform, but "how we decided to go about it is not great". Agents should be bundled and distributed as containers and handled like microservices. The centre of the work is the harness (the executable that gives the model its tools, guidance, memory and context strategies, declared in a manifest at build time), not the agent guidance itself. Routing that needs an LLM is a defect. The task, handoff and directory machinery should be reconsidered; handoff to humans and operator-to-agent chat are out. Coordination between agents is the acknowledged gap. Support services (where chat, job and trace data go) matter.

## Method

Each topic is one note in the design-pass evaluation shape (`design-pass`, a skill retired in #94): scope and what was read, the map as-is, forces, findings with evidence, proposals with pattern cards, and a disposition per proposal. A disposition is a proposal until topic 7 integrates them and the result is registered as ADRs and issues. Every claim is labelled verified (read in code, ran a command) or believed. The existing design vision and ADRs are inputs to be re-read under the new lens, not constraints on it.

## The spec site

`site/index.html`, built from `spec/` (nine linked pages: overview diagram, what the 2026-09-27 research changed, systems, job record, addressing, harness and container, flows, protocols, decisions and reading map) is the visual specification of the proposal. Regenerated 2026-09-28 from the notes as they stood after the 2026-09-27 session; `scripts/docs-builder/build.py` assembles the pages from the `spec/*.html` bodies and the shared chrome. `design.md` gives the commands for the local set and for the publishable set, whose note links are rewritten to `notes/`. Three diagrams were added: the two deployment shapes side by side (`changes.html`), a human working with a team (`flows.html#team`), and the three-object manifest (`harness.html#manifest`). Open it locally; the pages link back to every note and research file. A private published copy is at https://claude.ai/artifact/FkL97rZc9PdP9zp1iCcGiw with the notes alongside.

## Topics

| # | Topic | Note | Status |
|---|---|---|---|
| 0 | As-is map and forces | `00-as-is.md` | drafted 2026-09-16 |
| 1 | Target and reason to exist | `01-target.md` | open |
| 2 | The harness: what it owns, build or reuse, the manifest | `02-harness.md` | seeded 2026-09-16; gap register and positions for G1 to G6 added 2026-09-21; 2026-09-27: three manifest candidates (B proposed), tool exposure and the model port checked against the vendors, positions for G2 to G25, new gaps G26 to G31 |
| 3 | Packaging, deployment and scale | `03-deployment.md` | seeded 2026-09-21; 2026-09-27: database load answered with a capacity model at three scales and the escalation ladder; deployment shape costed, the evidence pointing at a shared pool per trust tier (Roberto's decision) |
| 4 | Events and addressing; the extension model | `04-events.md` | seeded 2026-09-16; 2026-09-27: the five inbound questions answered (subscriptions with CEL predicates, split adapter, copy per subscription, verification in the ingress, wait predicates stored and evaluated per delivery); connector tiers (bring-your-own, reviewed, platform-native) with the credential-handling axis and the MCP token placement |
| 5 | Coordination: agent-to-agent transport, and the human entry point | `05-coordination.md` | opened 2026-09-21; 2026-09-27: 5c, speaking to a team of agents (lead as a role, the record for coding work, depth one) |
| 5p | The proposal: job record, collaboration model and addressing at scale, written fresh from the standards with the task layer as one candidate | `05-proposal.md` | written 2026-09-21; 2026-09-27: Part B continued (teams, depth one enforced, the record over a lead for coding), two register rows, the keep-the-mechanism verdict qualified |
| 6 | Support services: traces, events, chat and job records, dashboard | `06-support-services.md` | not started |
| 7 | The path: milestones, what is kept, ADRs and issues re-read | `07-path.md` | seeded 2026-09-16; 2026-09-27: the code survey's findings, nine defects the redesign must not inherit |

Order matters: 1 decides the acceptance test everything else is judged by; 2 and 3 are Roberto's centre; 4 and 5 depend on 2 and 3; 6 depends on all of them; 7 integrates.

## Research inputs

External prior art, dispatched 2026-09-16, one file each under `research/`:

- `2026-09-16-harness-and-packaging-prior-art.md`: terminology, Anthropic's surfaces (Agent SDK, Managed Agents), container-packaged agents in the wild, manifest precedent, image-per-agent versus one image. Feeds topics 2 and 3. Landed 2026-09-16.
- `2026-09-16-scaling-containerised-agents.md`: execution model for a paused loop, load balancing, memory placement, node packing and sandboxes, observability. Feeds topics 3 and 6. Landed 2026-09-16.
- `2026-09-16-multi-agent-coordination-prior-art.md`: coordination taxonomy, failure evidence, discovery, humans as a primitive, orchestrator versus process. Feeds topic 5. Landed 2026-09-16.
- `2026-09-16-graph-engineering-for-agents.md`: "graph engineering" as Roberto means it, centred on arXiv 2604.11378 (a planner-produced, immutable execution DAG inside the harness with scheduled dispatch and layered recovery), related plan-as-DAG work, production harnesses that structure runs, the evidence, and what a manifest would declare; knowledge graphs as a short disambiguation. Feeds topic 2. Re-weighted and dispatched 2026-09-16; landed the same evening.

Dispatched 2026-09-21, one file each under `research/`:

- `2026-09-21-agent-to-agent-transports.md`: A2A and MCP as call contracts for a durable callee; how the cluster-native agent platforms transport calls, jobs and events; Claude Code's evolution past a single orchestrator; identity between agents. Feeds topic 5a. Landed 2026-09-21; integrated in `05-coordination.md` and G7 in `02-harness.md`.
- `2026-09-21-human-entry-point.md`: one entry point versus named agents in the tool; the human's own harness as orchestrator over MCP; the extra hop's cost; where the front desk's state lives; the two meanings of operator. Feeds topic 5b. Landed 2026-09-21; integrated in `05-coordination.md`.
- `2026-09-21-harness-container-gaps.md`: the inbound contract, version pinning across a pause, vault at egress, manifest-to-image build, health and drain, cost attribution; plus any further gaps found. Feeds topics 2, 3 and 6. Landed 2026-09-21; positions for G1 to G6 and the new gaps G13 to G25 recorded in `02-harness.md`.

Dispatched 2026-09-21, later the same day, after Roberto's reframing (the job concept is a candidate, not a baseline; "against the grain" meant addressing among a hundred agents; fresh look, no aesir baggage):

- `2026-09-21-coordination-standards-landscape.md`: every live standard or protocol for agent coordination and collaboration (A2A and MCP by pointer; ACP, AGNTCY, ANP, the Agent Protocols, AG-UI, vendor session models, business-tool agent APIs, Kubernetes CRDs, IETF drafts), which define a durable job record, what collaboration model each assumes, what has merged or died, and what Claude Code, Linear, GitHub and Slack speak today. Feeds `05-proposal.md`. Landed 2026-09-21.
- `2026-09-21-addressing-at-organisation-scale.md`: registries and control planes, gateways, addressing schemes, selection among many agents, humans and agents at scale, and Roberto's "global orchestrator as API gateway" assumption tested. Feeds `05-proposal.md`. Landed 2026-09-21.

Dispatched 2026-09-27, session 3, ten in parallel, after Roberto's three questions (database load, speaking to a team, connector tiers) and the seven briefs he asked for on 2026-09-21. Briefs carry no aesir vocabulary; nine of the ten read no aesir code.

- `2026-09-27-manifest-schema-precedent.md`: field references for ten products; declare versus provide per field; three candidate manifest skeletons. Feeds topic 2. Landed.
- `2026-09-27-deployment-shape-and-cost.md`: one Deployment per agent versus a shared pool; precedents; cost model at 10 and 100 agents; pinning; identity; hybrids; recommendation criteria. Feeds topic 3. Landed.
- `2026-09-27-events-and-extension-model.md`: adapter hosting, signatures, fan-out, placement, the Postgres outbox, manifest syntax for correlation. Feeds topic 4. Landed; the five questions answered in `04-events.md`.
- `2026-09-27-gateway-identity-and-tokens.md`: agentgateway from docs and code; credential kind × mechanism matrix; per-agent identity; fallbacks; allowlists; a spike list. Feeds topics 2, 4, 6. Landed.
- `2026-09-27-tool-exposure-and-model-port.md`: vendor tool search, measured degradation, manifest shapes; the model port options checked; the intersection measured. Feeds topic 2. Landed.
- `2026-09-27-support-services-and-security.md`: retention, cost attribution, redaction; description injection, sandbox boundary, approval gates; a fifteen-row threat list. Feeds topic 6. Landed.
- `2026-09-27-claim-model-code-survey.md`: read-only survey of the runtime bodies; verdicts on G13, G17, G19 and the five kept mechanisms; the query profile. Feeds topic 7. Landed.
- `2026-09-27-postgres-store-load-and-scale.md`: what the durable-execution platforms store and moved; queue benchmarks and failure modes; transcript storage; the event log; poller arithmetic; the ladder; a capacity model. Feeds topic 3. Landed.
- `2026-09-27-human-to-agent-team-patterns.md`: lead-mediated, artefact-mediated, handoff and no-team-object patterns; the project-manager model tested; where questions meet; what is measured; accountability. Feeds topic 5. Landed.
- `2026-09-27-connector-tiers-and-oauth-brokering.md`: what makes an integration free; managed-auth brokers; how agent platforms and mature ecosystems tier connectors; the MCP authorization spec; bring-your-own; a tier model. Feeds topic 4. Landed.

Internal inputs: `docs/reference/design-vision.md`, `docs/adr/`, `docs/backlog/`, the three v3.x direction documents in `docs/research/`, and the scenario-suite state recorded on issue #2.

## Positions so far

Product statement and the delta against Managed Agents: `01-target.md`. Manifest declares, cluster provides; model agnosticism as a principle via a model port with adapters, Anthropic first: `02-harness.md`. First-party integrations use the public extension API: `04-events.md`. Claimed loop kept, one harness image by digest, session as the unit of compute, sandbox separate from the harness: `03-deployment.md`. The task row is the record and call, job and event are transports over it, with A2A as the wire form and no choreography; the end user reaches agents through the business tool and through their own harness over MCP, with no front-desk agent: `05-coordination.md`. The fresh-look proposal, A2A's Task as the record with four added fields, bounded orchestration at depth two, and a registry plus a policy gateway with no model in the route: `05-proposal.md`. Added 2026-09-27, all proposals: the store is not the bottleneck and the ladder is known (`03-deployment.md`); the evidence points at a shared harness pool per trust tier (`03-deployment.md`); a team is a lead agent addressed directly, depth one enforced, and for coding work the record beats a lead (`05-coordination.md` 5c); connectors tier by who registers the provider app and who wrote and reviewed the code, with credential handling as an orthogonal axis and the container never the MCP client (`04-events.md`); the manifest takes the three-object shape kagent and Managed Agents converged on (`02-harness.md`).

## Decisions so far

Two.

1. Roberto, 2026-09-21: the human-as-agent concept from before the pivot is dropped; a human in the loop is reached through applications (GitHub, Slack, Telegram, email, whatever the workload uses), never modelled as an agent, assignee or directory entity. Recorded in `05-proposal.md` Part A.
2. Roberto, 2026-09-27: delegation depth is one. Roberto, 2026-09-27: "I can definitely see the point for single level depth. I find it difficult to think of any use case, coding or not, that really needs more than single depth; if an agent needs to defer as part of a loop, the orchestrator or coordinator can always fill that role." A member that needs more work done asks its coordinator, or the human through the record; it never delegates onward. Recorded in `05-proposal.md` Part B and `05-coordination.md` 5c; depth two leaves the register.

Everything else in the notes is a proposal.
