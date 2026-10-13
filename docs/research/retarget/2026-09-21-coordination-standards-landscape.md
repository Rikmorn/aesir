# Coordination standards landscape: what exists, what it models, what survives

Date: 2026-09-21. External research only; no aesir code was read. Companion to `2026-09-21-agent-to-agent-transports.md` (A2A and MCP in depth; cited as "transports §n") and `2026-09-16-multi-agent-coordination-prior-art.md` §1 and §3 (cited as "coordination §n").

**Labels.** `[V n]` means I fetched source n today and the claim is on the page. `[S n]` means a secondary account, or a page a companion file fetched and I did not re-fetch; the companion's own labels apply there. `[I]` means inferred by me. Pages I could not fetch are listed at the end of Sources.

## Summary

Two protocols govern the field, and both now live in one foundation. A2A v1.0 (2026-03-12) is the only foundation-governed specification defining a durable unit of work with states, identity, grouping, input-required, cancel, artifacts and completion delivery [V 1][V 2]. MCP's Tasks extension has the same shape but is opt-in, poll-first and unsupported by any listed client [S transports §2]. Every other job model has merged into A2A (IBM's ACP, archived 2025-08-27), gone quiet (the 2023 Agent Protocol), or stayed vendor-bound (LangChain, Anthropic, OpenAI, Linear) [V 6][V 15][V 17][V 27][V 28][V 30]. AGNTCY, ANP and NLIP model transport, identity, discovery and envelopes; AG-UI and Zed's Agent Client Protocol model the agent-to-human surface; none models a job [V 8][V 13][V 18][V 23][V 25]. Every live standard assumes a live server per agent and a waiting caller; pub/sub is transport-only and conversation handoff is SDK-only [I]. "Many agents in one organisation" is handled by AGNTCY's directory, kagent's namespaces and vendor caps, never by A2A or MCP themselves [V 9][V 33][S transports §5]. Standards bodies are forming, not shipping [V 35][V 36]. The IETF agentproto BoF backed a working group but rejected its scope; the first WIMSE agent-identity WG draft is dated 2026-09-15. Practitioner critiques converge on "MCP plus an orchestrator" for your own agents and A2A only for a named external counterparty [V 45][V 46]. One audit found zero of fifty advertised A2A endpoints answered a task [V 45]. Of the owner's four daily tools, all speak MCP and none speaks A2A; each business tool has its own, unshared agent-session model [V 30][V 31][V 42][V 43].

## 1. Inventory

**Conclusion.** Twenty-six candidates reduce to four kinds [I]. Two are job protocols (A2A, MCP Tasks). One is a transport-and-directory stack (AGNTCY). The rest are identity or envelope efforts with no job semantics, and vendor or business-tool session models converging on one shape without sharing a schema.

| Standard | Governs | Version and status | Models | Notable implementations | Alive? |
| --- | --- | --- | --- | --- | --- |
| A2A | Agentic AI Foundation (AAIF), Growth Stage, from 2026-08-27 [V 1][V 2] | v1.0 shipped 2026-03-12 [V 2]; "over 150 organizations" [V 1] | Task, Message, `contextId`, Agent Card, streaming, push, `INPUT_REQUIRED`, artifacts [S transports §1] | Python and JS SDKs, Foundry, AgentCore, ADK, Solace, kagent [S transports §3] | Alive |
| MCP core | AAIF founding project, 2025-12-09 [V 19] | 2026-07-28: sessions removed, MRTR, Tasks moved to extension [S transports §2]; roadmap 2026-08-22 [V 3] | Tools, resources, prompts, elicitation; no job in core | Claude Code, Copilot, Claude, VS Code, goose [V 4][V 42][V 43] | Alive |
| MCP Tasks extension | AAIF | `io.modelcontextprotocol/tasks`, 2026-07-28; no client in matrix [S transports §2] | Task with `working`, `input_required`, terminal states, `ttlMs`, `tasks/get` polling | None listed [S transports §2] | Moving |
| MCP Apps | AAIF | Spec 2026-01-26; SDK v1.1.2 [V 4][S 4a] | `ui://` resources linked to tools, postMessage JSON-RPC dialect, sandboxed iframe | Claude, Claude Desktop, VS Code Copilot, M365 Copilot, goose, Postman [V 4] | Alive; UI only |
| ACP (IBM BeeAI) | Was Linux Foundation AI & Data | Archived 2025-08-27: "ACP is now part of A2A under the Linux Foundation!" [V 5][V 6] | Run (7 states), `session_id`, await and resume, message parts, agent manifest [V 6][V 7] | BeeAI migrated to A2A [S 6a] | Absorbed |
| AGNTCY | Linux Foundation (LF Projects) from 2025-07-29; Cisco, Dell, Google Cloud, Oracle, Red Hat [V 8]; not on the AAIF project list [V 21] | SLIM Internet-Draft -02 (2026-07-07), `slimctl` v2.3.3 (2026-09-17); ADS draft -02 (2026-07-06); OASF 1.1.1 [V 9][V 10][V 11][V 12] | Transport (gRPC, HTTP/2, HTTP/3, MLS groups), directory records with skill taxonomy, identity badges as verifiable credentials; no job record | Carries A2A and MCP payloads; ADS indexes MCP, A2A and AgentSpec modules [V 9][V 11] | Alive |
| ANP | Community project; W3C AI Agent Protocol CG hosts its white paper [V 13][V 14] | ANP 1.1; vNext drafts; pushed 2026-09-20; 1,433 stars [V 13] | `did:wba` identity, agent description, discovery, meta-protocol negotiation, groups and federation | None named on the site [V 13] | Alive, niche |
| Agent Protocol (AIEF, 2023) | AI Engineer Foundation [V 15] | OpenAPI 3.0.1, unversioned; last push 2025-04-08 [V 15] | Task, Step (`created`, `running`, `completed`, `is_last`), Artifact over REST | Auto-GPT, Forge [V 15] | Quiet since 2025-04 |
| Agent Protocol (LangChain, 2024) | LangChain [V 17] | Unversioned OpenAPI; pushed 2026-09-18 [V 17] | Runs, threads, store, streaming, webhook, `on_disconnect`, cancel | "LangGraph Platform implements a superset" [V 17] | Alive as LangGraph's API |
| AG-UI | CopilotKit (first party) [V 18] | 1.0 protocol freeze 2026-09-17; 16k stars [V 18] | Run, thread, message, tool-call and state events; interrupt outcome with resume; subagent events | Agent Framework, ADK, Strands, AgentCore, Mastra, Pydantic AI, LangGraph, CrewAI; Claude Agent SDK as community [V 18] | Alive; agent-to-user |
| A2UI | Google | v0.9 [S 41] | Declarative generative UI | Flutter, CopilotKit [S 41] | Alive; UI only |
| Agent Client Protocol (Zed) | `agentclientprotocol` org, Apache 2.0, GOVERNANCE.md; 4.3k stars [V 25] | Unversioned on the pages fetched | `session/new`, `session/load`, `session/prompt`, `session/update`, `session/request_permission`, `session/cancel`, plans; JSON-RPC over stdio; remote "work in progress" [V 25] | Zed; Claude Code via a Zed-maintained adapter [V 26] | Alive; editor-to-agent |
| Agent Skills | Anthropic, released as open standard [V 22]; not an AAIF project [V 21] | Released 2025-12-18 [S 22a] | `SKILL.md` folder with progressive disclosure | Claude Code, Codex, Copilot, Cursor, Gemini CLI, goose and others [V 22] | Alive; not coordination |
| AGENTS.md, goose, agentgateway, Agent Router | AAIF [V 21] | Listed projects | Instruction file; an agent; two gateways | Not coordination protocols [I] | Alive |
| NLIP | Ecma TC56 [V 23] | ECMA-430 to 434 and TR/113, December 2025 [V 23] | Natural-language message envelope; bindings for HTTP, WebSocket, AMQP; security profiles | `nlip_server`, `nlip_sdk`; AI Alliance community [V 23][S 24] | Alive; adoption unshown |
| Managed Agents (Anthropic) | Vendor | Beta `managed-agents-2026-04-01` [V 27] | Agent, environment, session, events, threads; webhooks | Anthropic platform | Vendor de facto |
| Agents API (OpenAI) | Vendor | Public beta 2026-09-10, `OpenAI-Beta: agents=v1` [V 28][S 53] | Agent, environment, session, turns, items; webhooks | OpenAI platform; Assistants API sunset 2026-08-26 [S 53] | Vendor de facto |
| Linear Agent Interaction | Linear | Developer Preview [V 30] | Agent session with six states, activities, `prompted` follow-ups, delegate role | Linear apps | Business-tool de facto |
| Slack agent surfaces | Slack | `agent_view`, Agent Sessions API; `assistant_view` bridged [V 31][S 32] | Agent session per thread, status, stop, context events | Slack apps | Business-tool de facto |
| kagent | CNCF Sandbox since 2025-05-22 [V 33] | v1.0.0-alpha1 2026-09-18 [V 33] | CRDs `Agent`, `ModelConfig`, `ToolServer`, `RemoteMCPServer`, `Memory`; v2 adds `AgentTemplate`, `AgentInstance` with suspend and resume, A2A gateway, persisted A2A tasks, MCP tasks gateway [V 33] | Kubernetes | Alive |
| agent-sandbox | Kubernetes SIG Apps [V 34] | v1.0.3 2026-09-17; API `v1beta1` [V 34] | `Sandbox`, `SandboxTemplate`, `SandboxClaim`, `SandboxWarmPool`; pause and resume; no protocol | Kubernetes | Alive |
| IETF agentproto | IETF, proposed charter in external review [V 35] | BoF 2026-07-23; telechat 2026-10-08 [V 35] | "Agentic dialog management protocol" for context propagation across intermediaries | None yet | Forming |
| IETF identity drafts | WIMSE WG and individuals [V 36] | `draft-ietf-wimse-aims-00` 2026-09-15 (WG); AIP -03, Samsung architecture -00, others individual [V 36][S 37] | Agent authentication, delegation chains, capability tokens | None shipped [S transports §6] | Moving |
| W3C community groups | W3C CGs [V 14][V 38] | AI Agent Protocol CG (no reports); Agent Identity Registry CG 2026-04-24; ATP CG proposed 2026-06-04 | Identity, trust, discovery; ANP white paper | None | Forming |
| Eclipse LMOS | Eclipse Foundation [V 39] | Protocol "work in progress and contains empty sections"; repos pushed 2026-09-21 [V 39] | W3C Thing Description agent descriptions, DIDs, discovery, registries | LMOS runtime | Alive as runtime; protocol draft |
| Open Agent Specification | Oracle | AG-UI integration announced Dec 2025 [S 40] | Declarative agent and workflow schema | Oracle tooling | Not coordination |

Notes on the inventory:

- ACP's absorption is complete [V 5][V 6][V 7]. The banner, the archived repository and the run lifecycle page remain; the migration guide the README links to returned 404 twice today.
- AGNTCY's three specifications are individual Internet-Drafts by Cisco authors, not working-group documents [V 10][V 11]. The `agntcy.org`, `docs.agntcy.org`, `dir.agntcy.org` and `spec.slim.agntcy.org` hosts did not resolve today; GitHub and the datatracker were used instead.
- Three unrelated things are called ACP: IBM's Agent Communication Protocol (absorbed), Zed's Agent Client Protocol (alive), and OpenAI's Agentic Commerce Protocol (out of scope) [I].
- The MCP roadmap (2026-08-22) names five areas [V 3]. They are agentic messaging primitives "through Tasks, subscriptions, and progress notifications", HTTP-native transport, agent identity via DPoP and Workload Identity Federation, improved primitives, and SDK experience. It states no target date.

## 2. The job record

**Conclusion.** Only A2A's Task and MCP's Tasks extension are foundation-governed records with the full field set [I]. A2A's is stable and persisted by both reference SDKs; MCP's is moving. The remaining records are either vendor-bound, event streams, or dead.

| Specification | Identity and grouping | States | Input required | Cancel | Artifacts | Completion delivery | Stable to adopt as schema? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A2A Task [S transports §1] | `taskId` server-generated; `contextId` groups tasks and messages; `referenceTaskIds` | `SUBMITTED`, `WORKING`, `INPUT_REQUIRED`, `AUTH_REQUIRED`; terminal `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`; terminal tasks cannot restart | Yes, interrupted state; client continues on the same `taskId` | Yes, best effort, idempotent | Yes, first-class `Artifact` | Blocking return, SSE stream, resubscribe, per-task push webhook | Yes; v1.0 since 2026-03-12; `DatabaseTaskStore` persists it |
| MCP Tasks extension [S transports §2] | `taskId`; no grouping context | `working`, `input_required`; terminal `completed`, `failed`, `cancelled` | Yes, via `tasks/update` | Yes | No; `result` on completion | `tasks/get` polling; optional `notifications/tasks` | No; extension, no client support, roadmap still reshaping |
| ACP Run [V 7] | `run_id`; optional `session_id` | `created`, `in-progress`, `awaiting`, `cancelling`, `cancelled`, `completed`, `failed` | Yes, `await_resume`; timeout moves to `failed` | Yes, two-step | Message parts | Sync, streaming, or poll | No; archived, mapped onto A2A |
| AIEF Task and Step [V 15] | `task_id`, `step_id`; no grouping | Step: `created`, `running`, `completed`; `is_last` | No | No | Yes, `artifact_id`, `file_name`, `relative_path` | Client drives each step | No; dormant since 2025-04 |
| LangChain Run [V 17] | `run_id`, `thread_id` | `pending`, `error`, `success`, `timeout`, `interrupted`; thread `idle`, `busy`, `interrupted`, `error` | Yes, `interrupted` on the thread | Yes, `POST /runs/{id}/cancel` | Store items, not artifacts | Stream, `webhook`, `on_disconnect: cancel or continue` | Partly; unversioned, vendor-defined, but complete and live |
| AG-UI Run [V 18] | `runId`, `threadId` | `RunStarted`, `RunFinished` with `outcome`, `RunError` | Yes, `outcome.interrupts`; resume by a new run with `resume` | Not an event; client-side | State snapshots and deltas | Event stream | No; 1.0 is an event schema, not a stored record |
| Managed Agents session [V 27] | Session id; threads within a session | `idle`, `running`, `rescheduling`, `terminated`; finishing work goes `idle`, not `terminated` | Yes, `idle` with `stop_reason`; `user.tool_confirmation` | `user.interrupt` | Session files | SSE stream; webhooks (three attempts, no replay, unordered) | No; beta, vendor |
| OpenAI Agents API session [V 28] | Session id; turns; items | `working`, `idle`, `requires_action` [S 28a][V 28] | Yes, `requires_action` | Cancel the active turn | Items and files | Stream; webhooks `agent.session.turn.completed`, `.failed`, `.cancelled`, `agent.session.idle` | No; public beta since 2026-09-10 |
| Linear agent session [V 30] | Session per mention or delegation; issue and comment context | `pending`, `active`, `error`, `awaitingInput`, `complete`, `stale`; derived from the last activity | Yes, `elicitation` activity; user replies as `prompted` | Not documented | Response activity; external URL | Webhook `AgentSessionEvent` in; activities out | No; Developer Preview, Linear-only |
| Slack agent session [V 31] | Session per thread | `processing` and others; stop "does not update automatically" | Via messages | `agent_session_stopped` on user stop | Messages, canvases | Events API | No; surface in migration, `assistant_view` bridged |
| kagent `AgentInstance` [V 33] | Kubernetes resource | "lifecycle contracts" with "atomic state transitions"; suspend and resume | "pause actor on input-required" | Kubernetes delete | A2A artifacts | A2A gateway; persisted A2A tasks | No; alpha, an implementation of A2A |

No specification carries a counter-proposal state, a policy over sibling tasks, a timeout leg owned by the record, or who may cancel [I]. None says what happens to the record when the executor dies [I]. The transports file reaches the same gaps from the SDK side (transports "Implications" table).

Where A2A and MCP Tasks agree, the shape is an opaque server-minted id, a closed state set with one interrupted state, and a terminal rule [S transports §1][S transports §2]. Completion is by pull (poll or resubscribe) with push as an option. That intersection is the conservative schema [I].

## 3. Collaboration models the standards assume

**Conclusion.** Every live job protocol assumes a live server per agent and a caller that waits, streams or polls [I]. Brokers appear only as transports underneath (SLIM, NATS, Kafka, NLIP's AMQP binding). Conversation handoff is a vendor SDK feature, not a wire standard. Only AGNTCY, kagent and the vendor platforms say anything about many agents in one organisation.

| Standard | Deployment assumed | Shape | Many agents in one organisation |
| --- | --- | --- | --- |
| A2A [S transports §1][S coordination §3] | Live HTTP server per agent, card at a well-known URI | Orchestration: caller sends, waits, subscribes or receives push; parallel tasks share a `contextId` | Nothing standard: "does not prescribe a standard API for curated registries"; no namespaces, quotas or hierarchy |
| MCP [S transports §2][V 3] | Server per tool or agent; client-side loop; stateless core | Orchestration by tool call; MRTR for "ask the caller's user"; `subscriptions/listen` for change notices only | None in spec; roadmap adds agent identity (DPoP, workload federation) |
| ACP (IBM) [V 7] | REST server per agent | Orchestration with await | None; absorbed |
| AGNTCY [V 8][V 9][V 10][V 11] | SLIM nodes as a broker; agents publish records to a directory | Request-reply, pub/sub, fire-and-forget, streaming, MLS groups; A2A or MCP as payload | Yes: directory with skill and domain taxonomies, signed records, identity badges; "making A2A agents and MCP servers discoverable through AGNTCY directories" |
| ANP [V 13] | Peer-to-peer over the web with DIDs | Direct chat, groups, federation; negotiation of application protocols | Federation semantics; no organisational model |
| NLIP [V 23] | Envelope over HTTP, WebSocket or AMQP | Multi-turn conversation; AMQP binding permits a broker [I] | Security profiles only |
| AG-UI [V 18] | Frontend connects to one agent endpoint | Client-side loop; `SubagentStarted` and `SubagentFinished` events surface delegation | None |
| LangChain Agent Protocol [V 17] | Server hosting assistants | Orchestration; threads; background runs; webhook | Store namespaces |
| Zed ACP [V 25] | Agent as editor subprocess | Editor drives prompt turns; permission requests flow back | None |
| Managed Agents [V 27][S transports §5] | Vendor-hosted sessions | Coordinator to threads, one level, 25 threads; `send_to_agent`; session webhooks | Caps, rate limits, budgets; agents versioned per organisation |
| OpenAI Agents API [V 28][S 53] | Vendor-hosted sessions and environments | Sessions, turns; "coordination across multiple agents" claimed in the launch coverage [S 53] | Not stated on the pages fetched |
| Linear [V 30] | Agent is a webhook receiver plus API client | Delegation from a human: `delegate` role, `created` and `prompted` webhooks; reply as activities | One app per agent with scopes; no agent-to-agent |
| Slack [V 31] | Agent is an Events API receiver | Session per thread; stop button; context events | One app per agent; MCP restricted to directory-published or internal apps |
| kagent [V 33][S transports §3] | Server per agent in a Kubernetes namespace | Agents as tools over A2A; HITL pause on input-required; `NestedHITLRequest` | Namespaces; CRDs per agent; instance selection header |
| agent-sandbox [V 34] | One stateful pod per sandbox | No protocol; pause and resume | Templates, claims, warm pools |

The coordination file's taxonomy holds: handoffs (OpenAI SDK), supervisor loops and explicit graphs are framework features that no wire standard defines [S coordination §1]. The transports file found no documented production choreography among LLM agents [S transports §4]. Nothing fetched today changes either finding [I].

## 4. Convergence and death

**Conclusion.** The last eighteen months consolidated two protocols into one foundation and killed or stalled the older job protocols [I]. Identity and dialog management moved into standards bodies that have not shipped. Critiques do not propose a rival protocol; they propose using less of A2A.

| Date | Event |
| --- | --- |
| 2025-04-08 | Last push to the AI Engineer Foundation Agent Protocol [V 15] |
| 2025-05-19 and 2025-07-23 | AWS and Microsoft publish "inter-agent communication on MCP" using sampling, resumable streams and elicitation [V 49][V 50] |
| 2025-05-22 | kagent accepted as CNCF Sandbox [V 33] |
| 2025-07-29 | AGNTCY joins the Linux Foundation [V 8] |
| 2025-08-27 | IBM's ACP archived; "now part of A2A" [V 5][V 6] |
| 2025-09-03 | Zed ships a Claude Code adapter for its Agent Client Protocol and asks Anthropic to "adopt ACP directly" [V 26] |
| 2025-10-28 | GitHub announces Agent HQ [V 43] |
| 2025-12-09 | AAIF formed with MCP, goose, AGENTS.md [V 19] |
| 2025-12-10 | Ecma approves the NLIP suite [V 23][S 24] |
| 2026-01-26 | MCP Apps specification [V 4] |
| 2026-02-04 | Claude and Codex available in Agent HQ (public preview) [V 43] |
| 2026-02-17 | Slack MCP server and Real-time Search API announced [V 31] |
| 2026-03-12 | A2A v1.0 [V 2] |
| 2026-04-24 and 2026-06-04 | W3C Agent Identity Registry CG; Agent Trust Protocol CG proposed [V 38] |
| 2026-05-18 | AAIF reports 190 member organisations [V 20] |
| 2026-07-23 | IETF agentproto BoF: 154 for and 51 against a working group; scope as written 38 for, 124 against [V 35] |
| 2026-07-28 | MCP removes sessions and server-initiated requests; deprecates sampling; Tasks becomes an extension [S transports §2] |
| 2026-08-13 | InfoWorld: MCP "didn't delete" sessions, "handed it to the model" [V 51] |
| 2026-08-22 | MCP roadmap: agentic messaging primitives, identity, HTTP-native transport [V 3] |
| 2026-08-27 | A2A joins AAIF as a Growth Stage project [V 1][V 2]; Axios reported it on 2026-08-17 [S 52] |
| 2026-09-09 | heym.run audit: 0 of 50 advertised A2A endpoints answered a task [V 45] |
| 2026-09-10 | OpenAI Agents API public beta; Assistants API sunset 2026-08-26 [S 53] |
| 2026-09-15 | `draft-ietf-wimse-aims-00`, first WG-adopted agent auth draft [V 36] |
| 2026-09-17 | AG-UI 1.0 freeze; agent-sandbox v1.0.3; Solace Python repo archived (transports §3) [V 18][V 34] |
| 2026-09-18 | kagent v1.0.0-alpha1 with persisted A2A tasks and suspend or resume [V 33] |

AAIF today: six listed projects (MCP, goose, AGENTS.md, agentgateway, A2A, Agent Router) and eight working groups, including Identity & Trust and Workflows & Process Integration [V 21]. The projects page shows no stages; the A2A blog names "Growth Stage" [V 2]. AGNTCY and Agent Skills are not listed [V 21]. Growth claims vary by source: 190 members in May, "more than 250" in August coverage [V 20][S 52].

Standards bodies: the agentproto charter targets a use-cases draft in December 2026 and an architecture draft in February 2027 [V 35]. A protocol draft follows in March 2027, with IESG submission in March 2028. The BoF minutes record that "the upcoming MCP spec removes protocol-level sessions" and that "A2A already has a `context id` primitive shared across agents" [V 35]. The W3C AI Agent Protocol CG "will publish Specifications" and lists none [V 14]. The Samsung architecture draft asks for "globally unique message identifiers, correlation identifiers, expiration, retry, delivery status, and duplicate detection" [V 36]. It also asks that delegation preserve "the original principal and each authorized delegation step".

Critiques, with what each proposes:

- fka.dev (2025-09-11): A2A "quietly faded"; "adoption beats architecture"; use MCP [V 47].
- Credal (2026-03-06): A2A stalled on differentiation and "managing two protocols"; proposes a secured MCP registry [V 46].
- Glukhov (undated, cites April 2026): "overhyped when it is presented as mandatory"; "Security Is The Biggest Unresolved Question"; "MCP for tools. A2A for agents." [V 48].
- Predoaia et al., arXiv 2607.23884 (2026-07-26): MCP is "comparatively lightweight" but needs "explicit application-layer handling of conversational state and task lifecycle" [V 44]. A2A gives "protocol-level abstractions for tasks and lifecycle" at "substantially greater implementation and coordination complexity".
- heym.run (2026-09-09): "A capability claim is a string until somebody calls it"; proposes "MCP plus an orchestrator", A2A only for "a named counterparty" [V 45].
- InfoWorld (2026-08-13): after 2026-07-28 the model carries the handle; proposes authorising every handle per caller, short lifetimes, idempotency keys [V 51].
- The AWS and Microsoft "coordination on MCP" recipes rest on sampling and resumable streams, which the 2026-07-28 revision deprecated or removed [V 49][V 50][S transports §2]. Those recipes no longer describe the current protocol [I].

## 5. What the owner's daily tools speak

**Conclusion.** MCP is the only protocol shared by Claude Code, Linear, GitHub and Slack [I]. None of the four speaks A2A. Each business tool exposes its own agent-session model, similar in shape (session per mention, status, stop, reply in place) but unshared.

| Tool | MCP client | MCP server | A2A | Own agent model | Other |
| --- | --- | --- | --- | --- | --- |
| Claude Code [V 42] | Yes: stdio, HTTP, SSE (deprecated), WebSocket; elicitation; v2 runtime on revision 2026-07-28; channels push events in (research preview) | Yes: `claude mcp serve` over stdio | Not documented | Subagents, `SendMessage`, teams, workflows (transports §5) | Zed's Agent Client Protocol via a Zed-maintained adapter, not native [V 26]; Agent Skills [V 22]; runs as "Anthropic Claude" in Agent HQ through a GitHub App [V 43]; "Claude in Slack" spawns a cloud session from an `@Claude` mention [V 42] |
| Linear [V 30] | No evidence [I] | Yes: `https://mcp.linear.app/mcp`, Streamable HTTP, OAuth 2.1 with dynamic client registration; read-only variant | Not documented | Agent Interaction: sessions, activities, `delegate`, webhooks; Developer Preview | Anthropic's own docs use `mcp.linear.app` as the MCP example for Managed Agents [V 27] |
| GitHub [V 43] | Yes: Copilot cloud agent accepts `local`, `stdio`, `http`, `sse`; tools only; no OAuth remote servers; GitHub and Playwright servers on by default | Yes: `https://api.githubcopilot.com/mcp/`, 20+ toolsets | Not documented | Agent HQ: assign issues or `@mention` Copilot, Claude or Codex; agent returns a PR and a review request; third-party agents install as GitHub Apps; integration protocol not published | AGENTS.md; Agent Skills; MCP registry in VS Code [V 22][V 43] |
| Slack [V 31] | No evidence [I] | Yes: `https://mcp.slack.com/mcp`, Streamable HTTP, confidential OAuth, no SSE, no dynamic registration; only directory-published or internal apps; partner clients Claude.ai, Claude Code, Perplexity, Cursor | Not documented | `agent_view` and Agent Sessions API; `agent_session_started`, `agent_session_stopped`, `app_context_changed`; `assistant_view` bridged, deprecation reported for 2027-02 [S 32] | Real-time Search API [V 31] |

What interoperates without adapters today [I from the table]: an MCP client (Claude Code, Copilot cloud agent, Managed Agents) can call all three business tools' servers. Nothing lets one of these tools hand a job to another agent runtime over a shared job protocol. A job that spans Linear, GitHub and Slack is stitched together by the agent's own record, keyed by the tool ids each surface returns.

## What the evidence supports as a job record and a collaboration model

**Job record.** The standards support one durable shape, and A2A's Task is its canonical form [S transports §1]. It has a server-minted task id, a grouping context id, artifacts, and a closed state set with one interrupted state and a terminal rule. Completion is by pull, with push as an option. MCP's Tasks extension is the same shape minus grouping and artifacts, and it is still moving [S transports §2]. ACP's runs were mapped onto A2A rather than kept [V 5][V 6]. LangChain's run and thread objects are the nearest live alternative [V 17]. They add three things A2A leaves to the client: a `timeout` status, a `webhook` on the run, and `on_disconnect`. The vendor session models (Anthropic, OpenAI, Linear, Slack) converge on `idle` or `awaitingInput` as the pause state, with a stop reason [V 27][V 28][V 30]. That supports treating "waiting for input" as a first-class state rather than an error [I]. Unsettled: no standard names a counter-proposal, a sibling-group policy, who may cancel, or what happens to the record when the executor dies [I]. Identity is out of scope for A2A by design and only beginning at the IETF [S transports §6][V 36].

**Collaboration model.** Every live standard is orchestration: a caller opens a task and waits, streams, polls or receives a webhook [I]. Delegation with handoff of the whole conversation appears only inside vendor SDKs [S coordination §1]. Publish-subscribe appears only as transport under an orchestrator (AGNTCY, NATS, Kafka) [S transports §4]. Organisation-scale concerns are answered outside the job protocols: AGNTCY for directory and identity, Kubernetes namespaces and CRDs for placement, vendor caps for depth and concurrency [V 9][V 33][S transports §5]. Unsettled: the IETF has agreed the problem (context propagation across intermediaries) but not the scope [V 35]. MCP's roadmap promises messaging primitives without a date [V 3]. A2A's adoption claims are contested by an endpoint audit, so its reach beyond a named counterparty is unproven [V 45].

## Sources

Fetched 2026-09-21. Dates as shown on the page; "no date" where none appears.

1. A2A Protocol blog, A New Chapter for A2A: Joining the Agentic AI Foundation, 2026-08-27. https://a2a-protocol.org/latest/blog/2026/08/27/a-new-chapter-for-a2a-joining-the-agentic-ai-foundation/
2. A2A Protocol blog index (v1.0 post 2026-03-12; Growth Stage). https://a2a-protocol.org/latest/blog/
3. MCP blog, The New MCP Roadmap, 2026-08-22, and blog index. https://blog.modelcontextprotocol.io/posts/mcp-roadmap/
4. MCP Apps overview (spec link 2026-01-26; client list). https://modelcontextprotocol.io/extensions/apps/overview. 4a (secondary): search snippets naming `io.modelcontextprotocol/ui` and SDK v1.1.2.
5. Agent Communication Protocol site (banner). https://agentcommunicationprotocol.dev/
6. i-am-bee/acp README and GitHub API (archived 2025-08-27; pushed 2025-08-25). https://github.com/i-am-bee/acp. 6a (secondary): a2aprotocol.ai BeeAI migration write-ups; the linked migration guide returned 404 at `github.com` and `raw.githubusercontent.com`.
7. ACP, Agent run lifecycle. https://agentcommunicationprotocol.dev/core-concepts/agent-run-lifecycle
8. Linux Foundation press, AGNTCY joins the Linux Foundation, 2025-07-29. https://www.linuxfoundation.org/press/linux-foundation-welcomes-the-agntcy-project-to-standardize-open-multi-agent-system-infrastructure-and-break-down-ai-agent-silos
9. AGNTCY GitHub org, `slim`, `oasf`, `identity`, `dir-spec`, `slim-spec`, and `slim` releases (v2.3.3, 2026-09-17). https://github.com/agntcy
10. IETF, draft-mpsb-agntcy-slim-02, 2026-07-07. https://datatracker.ietf.org/doc/draft-mpsb-agntcy-slim/
11. IETF, draft-mp-agntcy-ads-02, 2026-07-06. https://datatracker.ietf.org/doc/draft-mp-agntcy-ads/
12. OASF schema browser (1.1.1). https://schema.oasf.outshift.com/
13. Agent Network Protocol site and repository, plus GitHub API (pushed 2026-09-20). https://agent-network-protocol.com/ and https://github.com/agent-network-protocol/AgentNetworkProtocol
14. W3C AI Agent Protocol CG page and w3c-cg/ai-agent-protocol repository. https://www.w3.org/groups/cg/agentprotocol/ and https://github.com/w3c-cg/ai-agent-protocol
15. AI-Engineer-Foundation/agent-protocol repository, `schemas/openapi.yml`, GitHub API (pushed 2025-04-08). https://github.com/AI-Engineer-Foundation/agent-protocol
16. agentprotocol.ai (community guide, no date). https://agentprotocol.ai/
17. langchain-ai/agent-protocol repository, `openapi.json`, GitHub API (pushed 2026-09-18). https://github.com/langchain-ai/agent-protocol
18. AG-UI docs, Events, repository, and release 2026-09-17. https://docs.ag-ui.com/ and https://github.com/ag-ui-protocol/ag-ui/releases
19. Linux Foundation press, Formation of the Agentic AI Foundation, 2025-12-09. https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
20. Linux Foundation press, AAIF adds 43 new members, 2026-05-18. https://www.linuxfoundation.org/press/agentic-ai-foundation-adds-43-new-members-as-enterprise-and-government-adoption-of-open-agent-standards-accelerates
21. aaif.io home and projects. https://aaif.io/ and https://aaif.io/projects/
22. agentskills.io overview. https://agentskills.io/. 22a (secondary): Unite.AI and Simon Willison on the 2025-12-18 release.
23. nlip-project GitHub org and `nlip_spec` (ECMA-430 to 434, TR/113, December 2025). https://github.com/nlip-project
24. Secondary: Ecma International press and TC56 pages (socket closed on three attempts). https://ecma-international.org/technical-committees/tc56/
25. Agent Client Protocol overview and repository. https://agentclientprotocol.com/protocol/overview and https://github.com/agentclientprotocol/agent-client-protocol
26. Zed blog, Claude Code: Now in Beta in Zed, 2025-09-03. https://zed.dev/blog/claude-code-via-acp
27. Claude Managed Agents: Overview, Start a session, Session operations, Reference, Webhooks (beta `managed-agents-2026-04-01`). https://platform.claude.com/docs/en/managed-agents/overview
28. OpenAI Agents API: Overview, Run and continue sessions, Manage sessions, Observability. https://developers.openai.com/api/docs/guides/agents-api/overview. 28a (secondary): search snippet for `working` and `idle` statuses.
29. Not fetched: OpenAI, Introducing the Agents API (HTTP 403). https://openai.com/index/introducing-the-agents-api/
30. Linear, Agents, Agent Interaction, and MCP server docs. https://linear.app/developers/agents, https://linear.app/developers/agent-interaction, https://linear.app/docs/mcp
31. Slack: AI overview, Developing AI apps, MCP server, changelog 2026-02-17, changelog 2026-07-02, `agent_session_stopped` reference. https://docs.slack.dev/ai, https://docs.slack.dev/ai/mcp-server/, https://docs.slack.dev/changelog/2026/02/17/slack-mcp/
32. Secondary: automagik-dev/omni issue #914 on `assistant_view` deprecation in February 2027; search snippets on `agents.sessions.*`.
33. kagent repository, releases, v1.0.0-alpha1 notes (2026-09-18), CNCF project page (Sandbox, 2025-05-22). https://github.com/kagent-dev/kagent/releases and https://www.cncf.io/projects/kagent/
34. kubernetes-sigs/agent-sandbox repository and releases/latest via GitHub API (v1.0.3, published 2026-09-17). https://github.com/kubernetes-sigs/agent-sandbox
35. IETF agentproto charter (external review, telechat 2026-10-08) and IETF 126 BoF minutes, 2026-07-23. https://datatracker.ietf.org/doc/charter-ietf-agentproto/ and https://datatracker.ietf.org/doc/minutes-126-agentproto-202607230700/
36. IETF drafts: draft-ietf-wimse-aims-00 (2026-09-15), draft-klrc-aiagent-auth-03 (replaced), draft-ni-wimse-ai-agent-identity-02 (expired), draft-singla-agent-identity-protocol-03 (2026-06-09), draft-daniel-ai-agent-internet-architecture-00 (2026-08-14). https://datatracker.ietf.org/doc/draft-ietf-wimse-aims/
37. Secondary: datatracker search hits for draft-prakash-aip-00, draft-gudlab-agentid-protocol-00, draft-duda-agent-id-framework-00.
38. W3C: Agent Identity Registry Protocol CG call for participation, 2026-04-24; Agent Trust Protocol CG proposal, 2026-06-04. https://www.w3.org/community/agent-identity/2026/04/24/call-for-participation-in-agent-identity-registry-protocol-community-group/
39. Eclipse LMOS protocol introduction and GitHub org repos via API (pushed 2026-09-21). https://eclipse.dev/lmos/docs/lmos_protocol/introduction/
40. Secondary: Oracle blogs on Open Agent Specification and its AG-UI integration.
41. Secondary: Google Developers Blog and InfoQ (2026-07) on A2UI v0.9.
42. Claude Code docs: MCP, and Channels (research preview). https://code.claude.com/docs/en/mcp and https://code.claude.com/docs/en/channels
43. GitHub: github-mcp-server README; Copilot docs, Extend coding agent with MCP; About third-party coding agents; GitHub Blog, Introducing Agent HQ, 2025-10-28; Pick your agent, 2026-02-04. https://github.com/github/github-mcp-server and https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents
44. Predoaia et al., A Comparative Study of MCP and A2A for Inter-Agent Coordination in LLM-Based Systems, arXiv 2607.23884, 2026-07-26. https://arxiv.org/abs/2607.23884
45. heym.run, A2A Protocol vs MCP: What 50 Endpoints Answered, 2026-09-09. https://heym.run/blog/a2a-vs-mcp
46. Credal, What happened to A2A Protocol?, Jessica Shen, 2026-03-06. https://credal.ai/blog/what-happened-to-a2a-protocol
47. fka.dev, What happened to Google's A2A?, 2025-09-11. https://blog.fka.dev/blog/2025-09-11-what-happened-to-googles-a2a/
48. Glukhov, Google A2A Protocol in 2026: Adoption, Hype, and Reality (no date). https://www.glukhov.org/ai-systems/comparisons/a2a-protocol-2026-adoption/
49. AWS Open Source Blog, Inter-Agent Communication on MCP, 2025-05-19. https://aws.amazon.com/blogs/opensource/open-protocols-for-agent-interoperability-part-1-inter-agent-communication-on-mcp/
50. Microsoft for Developers, Can You Build Agent2Agent Communication on MCP? Yes!, 2025-07-23. https://developer.microsoft.com/blog/can-you-build-agent2agent-communication-on-mcp-yes/
51. InfoWorld, MCP didn't remove sessions, it handed them to the model, 2026-08-13. https://www.infoworld.com/article/4208733/mcp-didnt-remove-sessions-it-handed-them-to-the-model.html
52. Secondary: Axios, AI agents inch toward interoperability, 2026-08-17; Forbes, 2026-08-19.
53. Secondary: MarkTechPost, OpenAI launches the Agents API in public beta, 2026-09-10, and related coverage of the Assistants API sunset.

Not fetched today: `agntcy.org`, `docs.agntcy.org`, `dir.agntcy.org`, `spec.slim.agntcy.org` (DNS failure); Ecma International pages (socket closed); `openai.com` (HTTP 403); the BeeAI ACP-to-A2A migration guide (HTTP 404 at two paths); `linear.app/docs/mcp-server` (HTTP 404; `/docs/mcp` used instead).
