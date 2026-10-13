# Retarget research

What do prior art, live standards and published measurements say about remaking aesir as a platform for agents packaged and run as containers? The reports answer it for the harness and its manifest, deployment and scale, events and connectors, coordination, and support services.

## Issues served

The `retarget` design in `docs/designs/retarget/`, which has no issue yet. When PM plans it, add the issues it becomes here.

## Reports

Each line ends with the retarget topic the report feeds; `docs/designs/retarget/README.md` §Topics numbers them. A report that names a note bare, such as `02-harness.md`, means the note in `docs/designs/retarget/`.

Dispatched 2026-09-16, external prior art:

- [2026-09-16-harness-and-packaging-prior-art.md](2026-09-16-harness-and-packaging-prior-art.md): terminology, the Agent SDK and Managed Agents, container-packaged agents, manifest precedent, one image or one per agent. Topics 2 and 3.
- [2026-09-16-scaling-containerised-agents.md](2026-09-16-scaling-containerised-agents.md): running a paused loop, load balancing, memory placement, node packing, sandboxes, observability. Topics 3 and 6.
- [2026-09-16-multi-agent-coordination-prior-art.md](2026-09-16-multi-agent-coordination-prior-art.md): coordination taxonomy, failure evidence, discovery, humans as a primitive, orchestrator versus process. Topic 5.
- [2026-09-16-graph-engineering-for-agents.md](2026-09-16-graph-engineering-for-agents.md): a planner-produced execution DAG inside the harness (arXiv 2604.11378), related plan-as-DAG work, and what a manifest would declare. Topic 2.

Dispatched 2026-09-21: three briefs, then two more the same day after Roberto reframed the job concept as a candidate, not a baseline:

- [2026-09-21-agent-to-agent-transports.md](2026-09-21-agent-to-agent-transports.md): A2A and MCP as call contracts for a durable callee, how cluster-native agent platforms carry calls, jobs and events, and identity between agents. Topic 5a.
- [2026-09-21-human-entry-point.md](2026-09-21-human-entry-point.md): one entry point versus named agents in the tool, the human's own harness as orchestrator over MCP, and the extra hop's cost. Topic 5b.
- [2026-09-21-harness-container-gaps.md](2026-09-21-harness-container-gaps.md): the inbound contract, version pinning across a pause, vault at egress, manifest-to-image build, health and drain, cost attribution. Topics 2, 3 and 6.
- [2026-09-21-coordination-standards-landscape.md](2026-09-21-coordination-standards-landscape.md): every live agent-coordination standard, which define a durable job record, and what has merged or died. Topic 5p.
- [2026-09-21-addressing-at-organisation-scale.md](2026-09-21-addressing-at-organisation-scale.md): registries, gateways, addressing schemes, selection among many agents, and "global orchestrator as API gateway" tested. Topic 5p.

Dispatched 2026-09-27, ten in parallel: Roberto's three questions on database load, speaking to a team, and connector tiers, and the seven briefs he asked for on 2026-09-21. The briefs carry no aesir vocabulary, and nine of the ten read no aesir code:

- [2026-09-27-manifest-schema-precedent.md](2026-09-27-manifest-schema-precedent.md): field references for ten products, declare versus provide per field, and three candidate manifest skeletons. Topic 2.
- [2026-09-27-deployment-shape-and-cost.md](2026-09-27-deployment-shape-and-cost.md): one Deployment per agent versus a shared pool, with precedents, a cost model, pinning and identity. Topic 3.
- [2026-09-27-events-and-extension-model.md](2026-09-27-events-and-extension-model.md): adapter hosting, signatures, fan-out, placement, the Postgres outbox, and correlation in the manifest. Topic 4.
- [2026-09-27-gateway-identity-and-tokens.md](2026-09-27-gateway-identity-and-tokens.md): agentgateway from docs and code, credential kind by mechanism, per-agent identity, and a spike list. Topics 2, 4 and 6.
- [2026-09-27-tool-exposure-and-model-port.md](2026-09-27-tool-exposure-and-model-port.md): vendor tool search and its measured degradation, and the model port options checked. Topic 2.
- [2026-09-27-support-services-and-security.md](2026-09-27-support-services-and-security.md): retention, cost attribution, redaction, the sandbox boundary, approval gates, and a threat list. Topic 6.
- [2026-09-27-claim-model-code-survey.md](2026-09-27-claim-model-code-survey.md): a read-only survey of aesir's runtime bodies, with verdicts on gaps G13, G17 and G19 and the kept mechanisms. Topic 7.
- [2026-09-27-postgres-store-load-and-scale.md](2026-09-27-postgres-store-load-and-scale.md): what durable-execution platforms store, queue benchmarks, transcript storage, the escalation ladder, and a capacity model. Topic 3.
- [2026-09-27-human-to-agent-team-patterns.md](2026-09-27-human-to-agent-team-patterns.md): lead-mediated, artefact-mediated and handoff patterns, the project-manager model tested, and accountability. Topic 5.
- [2026-09-27-connector-tiers-and-oauth-brokering.md](2026-09-27-connector-tiers-and-oauth-brokering.md): managed-auth brokers, how mature ecosystems tier connectors, the MCP authorization spec, and a tier model. Topic 4.

## Earlier inputs

The v3.x direction documents, written in 2026-02 before the retarget began. They are inputs the retarget re-reads, not research done for it, and each one's banner names the issues that track its direction.

- [3.0-domain-modeling.md](3.0-domain-modeling.md): the v3.0 vision, domain modelling.
- [3.1-human-collaboration.md](3.1-human-collaboration.md): the v3.1 vision, human collaboration.
- [3.2-strategy-composition.md](3.2-strategy-composition.md): the v3.2 vision, strategy composition.
