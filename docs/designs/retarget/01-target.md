# Topic 1: the target and the reason to exist

Status: open, 2026-09-16. Waiting on Roberto's choice of workload and on the research thread that checks Anthropic's current surfaces.

## Why this topic is first

v2.9 declared the platform complete without a workload ever running end to end. A second platform rebuild with no workload is the same bet. Every later topic (harness, deployment, events, coordination) is judged by what the first usable workload needs; without it, each topic optimises for generality and the path never ends.

## The purpose as recorded

`socials/thesis.md` (gitignored, Feb 2026) is the outward statement. Its problem: frameworks treat agents as request-response loops, and real work spans days, pauses for humans, survives crashes, and moves between agents. Its four core ideas, and where the new direction stands on each:

| Thesis idea | New direction | Status |
|---|---|---|
| Conversations are durable rows, claimed like jobs; pause on Tuesday, resume on Thursday with full context | Not addressed in the brief; the container model must carry it or replace it (topic 3) | constraint, kept |
| Agents are configuration, not code | The manifest is this idea with a build step | kept, repackaged |
| Coordination is first-class: delegation, directory, completion signals, shared knowledge | Directory "has something there"; handoff to humans and operator chat are out; orchestrator versus process is the open gap | doubted |
| The platform provides mechanism, agents provide intelligence | Unchanged | kept |

The doubted idea was the thesis's stated differentiation against OpenClaw-style loops ("depth: durable execution, multi-agent delegation, event-driven routing, structured coordination"). Dropping or shrinking it is defensible, but then the reason to exist has to be restated. Candidates: the same declarations Managed Agents offers (tools, MCP, skills, sandbox, scheduling, rosters, memory) composed per agent in a manifest, on a runtime and model the operator owns (Roberto, 2026-09-16; see `02-harness.md`); agents as role-shaped coworkers living in the organisation's tools rather than a coding product; the container giving isolation and operability the frameworks do not.

## Why not the alternatives

To be answered with the research thread. From Anthropic's bundled API reference (cache dated 2026-06-24, read this session; live docs pending): Managed Agents supplies the harness and the deployment, with per-session sandboxes, MCP, skills, scheduled deployments, multi-agent rosters, memory stores and credential vaults. The Claude Agent SDK supplies the Claude Code harness as a library, self-hosted. Claude Code itself runs unattended from a scheduler or a GitHub Action. Linear's agent-session API (the `linear.agent_session.created` trigger the dev agent uses today) is Linear's own path for third-party agents; other vendors already ship issue-to-PR agents on it (believed).

The question aesir must answer for its first workload: what does the operator get that the shortest path with those tools does not? Acceptable answers include ownership (self-hosted, model-agnostic, no vendor loop), a role the vendors do not ship, or a cross-tool workflow no single vendor spans. "We built it" is not one.

## Candidate first workloads

Each is something the repo has already attempted. What it exercises decides which topics it stresses.

| Workload | Trigger and result | Exercises | Crowding |
|---|---|---|---|
| A. Issue to pull request | Linear issue assigned to the agent; research, code, tests in a sandbox; PR; wait for review; address feedback; merged; status back in Linear | harness with bash, git and GitHub tools; sandbox; durable wait over days; addressing for review signals; Linear inbound | high: coding agents from several vendors do this on Linear's API (believed) |
| B. Product conversation to tickets | Slack thread with a product agent; requirements; Linear tickets; follow-ups over days | chat-style session; Slack inbound and outbound; Linear outbound; persistent identity and memory; no sandbox | medium: Slack assistants exist; a persistent role with product memory is less common |
| C. A after B, joined through the tool | B creates tickets; A picks them up; no delegation call between agents | everything in A and B; coordination through the business tool only | as A |
| D. Scheduled role | A schedule fires an agent that triages, reports or checks something; result posted to Slack or Linear | schedule trigger; outbound only; no webhooks; cheapest deployment shape | low to medium |

A is what the operator would use daily and what the harness topic most needs. D is the smallest thing that is usable and deployable, and it exercises none of the hard parts. C is the first workload where two agents exist without a coordination layer, which is the cheapest test of whether the collaboration machinery is needed at all.

## What "usable" has to mean

A proposal for the acceptance test, to be fixed once the workload is chosen:

- The operator deploys aesir with one agent to their own cluster or host and wires it to their tools without editing framework code.
- The agent does its job unattended for weeks: events reach it, it pauses and resumes across restarts, failures are visible, nothing is lost.
- Adding a second agent is a manifest, a build and a deploy; no framework change.
- The operator can see what every agent did, what it cost, and why it stopped, from one place.
- Everything above is exercised by a deterministic test where the mechanism is concerned, and by a scenario where behaviour is.

## Open

- Which workload is first (Roberto).
- The reason-to-exist statement, one paragraph, after the research lands.
- Whether "usable for the operator" is the bar, or "usable by a second team", which brings #26 (auth, monitoring, environments) forward.

## Product statement (Roberto, 2026-09-16)

"It is ultimately an agent platform: build your own agent, give it an environment, declare it (tools, skills, guidance, permissions, memory, context, bundled code) and we run it and scale it as defined. We can enrich our harness and the build tools; this should enable extension." First heard of Managed Agents in this session and said it "is ringing true with what we're trying to do and own".

## Managed Agents, precisely, and the delta

Verified from Anthropic's bundled API reference (cache dated 2026-06-24) and the research thread's live fetch on 2026-09-16 (`research/2026-09-16-harness-and-packaging-prior-art.md` §2):

| Managed Agents | What it is | Aesir's position |
|---|---|---|
| Agent | Versioned config: model, system, tools, `mcp_servers`, skills, multiagent roster; sessions pin a version | The manifest, plus a build that produces an image |
| Environment | `cloud` (Anthropic's sandbox) or `self_hosted` (your worker polls a queue and runs bash and file tools) | The container, self-hosted always |
| Session | A run; event stream; idles awaiting input; hard dollar budget | The conversation; must be durable across the container's life (topic 3) |
| Vault | `mcp_oauth`, `static_bearer`, `environment_variable` credentials, substituted at egress, never visible in the sandbox | Adopt the pattern (topic 4, topic 6) |
| Memory stores, deployments (cron), outcomes | Separate resources | Later; declare in the manifest, provide from the cluster |
| The loop | Always on Anthropic's orchestration layer, even self-hosted | Ours, in the harness |
| Inbound events | "Ordinary application code on your side" | First-class: business-tool events trigger agents (topic 4) |
| Packaging and build | None; agent is config on Anthropic's runtime | An image from a manifest |
| Data retention | Not eligible for zero data retention | Self-hosted: the operator's policy |

The reason to exist, as a delta: the loop is yours (model choice, infrastructure, retention), inbound is first-class, and the unit of distribution is an image. Everything else in the statement Managed Agents also offers, so it is not the differentiation; it is the table stakes.

## Personas and first-workload scope

Two personas now exist: the agent builder, who writes a manifest and bundle, and the operator, who runs aesir. Roberto is both for the first workload; "usable" is judged for that single person, not for a second team (#26 stays deferred).

The statement names the whole Managed Agents surface. The first workload takes a subset: agent, environment, session, vault, and inbound. Memory stores, cron deployments, outcomes and multi-agent rosters are declared later, once the subset runs.
