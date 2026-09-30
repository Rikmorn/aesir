# Topic 0: the runtime as it is, and the forces on it

Status: drafted 2026-09-16. Gate-one material for the retarget; the later topics cite it rather than re-derive it.

## Scope and what was read

Read in the 2026-09-16 session: `packages/agents/src/framework/agent-registry.ts`, `tool-registry.ts`, `event-router.ts`, `packages/agents/src/router/slow-path.ts`, `packages/platform/src/sandbox/` (headers of `docker-sandbox.ts` and `dev-container.ts`), `packages/agents/src/shared/tools/codebase/run-command.ts`, `packages/agents/definitions/dev-agent/definition.yaml`, `docker-compose.yml` (service list), ADRs 0001 to 0005, 0010 and 0013, `docs/reference/design-vision.md`, and every backlog note (retired in #98; `git show 1b6d6ce9:docs/backlog/`). Line counts and grep hits were measured with the commands named in the tables.

Not read: the bodies of `worker-loop.ts`, `conversation-executor.ts`, `history-manager.ts` and `run-agent-loop.ts`; the integrations' internals; the dashboard; the knowledge, identity, retrieval and schedule services; the test scenarios. Claims about those are labelled believed.

## The map as-is

One Node process (`agent-service` in compose) hosts every agent. It loads definitions from disk, resolves each definition's tool references to bound tool objects, and runs a tool-use loop against the Anthropic API. Conversations are rows in Postgres; stateless workers claim runnable ones with `FOR UPDATE SKIP LOCKED`, heartbeat while running, and release on pause. Events arrive from three integration services over HTTP, are normalised by adapters, and are routed to a start or a signal.

| Fact | Evidence | Label |
|---|---|---|
| One process hosts all agents; ADR-0005 chose this over a service per agent because every surveyed framework parameterises one runtime | `docs/adr/0005-single-agent-service.md` | verified |
| A definition is `definitions/<id>/definition.yaml` plus `prompt.md`; the registry validates with Zod, caches by mtime, and requires the directory name to equal `id` | `agent-registry.ts` | verified |
| Tool references (`namespace:tool_name`) resolve to factories bound to a per-conversation context; unknown references fail at resolve time | `tool-registry.ts` | verified |
| Every tool a definition lists is sent to the model on every call | `run-agent-loop.ts:226`, `:356` | verified |
| Tool references registered in code | 58 (`grep -c 'register(' packages/agents/src/framework/tool-factories.ts`) | verified |
| Tools the dev-agent definition lists | 35 (`grep -c '^  - [a-z]*:' definitions/dev-agent/definition.yaml`) | verified |
| Definition directories, of which `test-*` scenario agents | 32, 26 (`ls packages/agents/definitions`) | verified |
| Conversations are claimed with `SKIP LOCKED` | `worker-loop.ts:986` | verified |
| For a dev conversation the worker spawns a Docker container named by conversation id from `aesir-dev-env:latest`, clones the repo into it and pushes git credentials | `worker-loop.ts:237` to `:280`, `:1271`; `dev-container.ts` | verified |
| The agent service reaches Docker over the host socket and runs as root to do so | `docker-compose.yml:270`, `:324`; `git show 1b6d6ce9:docs/backlog/dev-agent-container-runs-as-root.md` | verified |
| The codebase tools exec into that container; the loop itself runs in the shared service | `run-command.ts` | verified |
| Start routing is deterministic: YAML `triggers` build an event-type to agent-id map | `event-router.ts`, `loadStartRules` | verified |
| Signal routing is a constant in framework code mapping signal types to `dev-agent` or `product-agent` | `event-router.ts`, `SIGNAL_AGENT_MAP` | verified |
| An event with no correlation key, or no rule, goes to a Haiku tool-use loop with five routing tools and a 285-line system prompt | `event-router.ts:167`, `slow-path.ts`, `router/system-prompt.ts` | verified |
| GitHub PR review events and pass-through events always take that path | `adapters/github.ts:137`, `adapters/pass-through.ts:28` | verified |
| Agents call integrations over MCP HTTP, never by SDK import; each integration owns webhooks, OAuth, and outbound calls | ADR-0004; `packages/integrations/*` layout | ADR verified; layout believed from `AGENTS.md` |
| Tasks, delegation with an accept/reject/counter-propose handshake, task groups, `wait_for_task`, and completion dispatch are the collaboration layer | ADR-0009, ADR-0010; `packages/agents/src/shared/tools/task/` | verified |
| Human delegation, materialisation policy and operator chat were designed into the schema and deferred | ADR-0010 consequences; `git show 1b6d6ce9:docs/backlog/human-collaboration.md` | verified |
| Ollama in compose serves embeddings only; no local model does inference | `packages/agents/src/shared/embedding/ollama.ts`; `.env.example:187` | verified |

Sizes, non-test TypeScript lines, measured 2026-09-16 with `find ... -name '*.ts' | grep -v .test. | xargs cat | wc -l` per package:

| Package | Lines |
|---|---|
| agents | 29,410 (tests 22,520) |
| integrations | 21,657 |
| dashboard | 16,786 |
| platform | 3,593 |
| worker-loop.ts alone | 2,821 |

## Forces

What is coming: the retarget itself, which reverses the deployment unit (ADR-0005), reopens the agent taxonomy (ADR-0013 already calls the orchestrator/sub-agent split an artefact), and drops the human-collaboration direction (#21).

What is expensive today, measured: 35 tool schemas per model call for the dev agent; every PR review routed by an LLM; a 2.8k-line worker loop that owns claiming, sandbox setup, and execution; 26 of 32 definitions existing to exercise delegation scenarios rather than to do work.

What the operator said matters: a usable target with a path and milestones; the harness and how it builds, over agent guidance; containers as the unit of packaging, deployment and isolation; no LLM in routing; no human-handoff subsystem and no operator chat; coordination is the open gap; support services for chat, job and trace data.

What was never tested: v2.9 bet that the platform was complete and only agent intelligence remained. No real workload ran end to end against it before the project went dormant (recorded in the reset-session notes and `docs/learnings/`; the learnings file was not re-read this session).

## Findings

Ranked by blast radius. Each names what it works against and what it costs.

1. **The container is inverted.** The container is a per-conversation sandbox that tools exec into; the harness sits outside it in a shared process with root access to the host socket. The retarget moves the harness inside. Cost today: the security boundary is the host, not the agent; a compromised sandbox reaches the socket. Works against isolation by default.
2. **Tool exposure is total.** Selection is data (the YAML list) but exposure is everything selected, on every call. Cost: context spent on tools the turn cannot use, and a permission surface as wide as the list. Works against "declarative configuration as data" in spirit: the data cannot express "when".
3. **Addressing is the routing problem.** Deterministic routing works exactly when an event carries a correlation key; the LLM router exists to guess one when it does not. Signal-to-agent mapping is a constant in framework code, so a new agent that receives signals is a code edit. Works against "config is data" and against ADR-0002's own intent that the fast path handles the common case.
4. **The collaboration layer dominates without a workload.** The task namespace is the largest tool family; the handshake, groups and dispatcher were validated by scenario agents, not by a real delegation. Cost: the most complex code has the least evidence. ADR-0013 already doubts the taxonomy it serves.
5. **Integrations couple two jobs.** Each service owns inbound (webhooks, OAuth, dedupe, correlation) and outbound (tool calls). The retarget can move outbound into the harness as bundled tools; inbound needs a stable endpoint and one credential store and stays a service. Treating "integrations" as one thing hides this split.
6. **The claim model is the part worth keeping.** `SKIP LOCKED` claims, heartbeats, queued signals and full-history pause/resume are what make agents start and stop safely. Any container design either carries this mechanism inside or replaces it with a durable-execution equivalent. Not a defect; a constraint on topic 3.

## Corrections to the brief

- "An agent runner that we feed YAML files to": correct, and the runner is one process for all agents by decision, not by accident (ADR-0005).
- Containers are not absent; they are a tool. The proposal changes what the container is, not whether there is one.
- "Harness" is the right term. Anthropic's bundled API reference (cache dated 2026-06-24) splits agent building into who supplies the harness ("the agent loop + context management") and who supplies the deployment; Claude Code is a harness, the Agent SDK is that harness as a library, and Managed Agents is Anthropic supplying both. The live docs are being checked by the research thread.
- Bundling the model in the container has no precedent here; only embeddings run locally. Park it until an open-weights workload exists.

## Open questions carried forward

- Why aesir rather than Managed Agents or Claude Code on a schedule (topic 1).
- One harness image with per-agent bundles, or an image per agent (topic 3).
- What replaces the collaboration layer for the first workload (topic 5).
