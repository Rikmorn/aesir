# Agent-to-agent transports: prior art for the aesir retarget

Date: 2026-09-21. External research only; the aesir code was not read for this document. Builds on `2026-09-16-multi-agent-coordination-prior-art.md` (coordination), `2026-09-16-scaling-containerised-agents.md` (scaling) and `2026-09-16-harness-and-packaging-prior-art.md` (harness). Cited below by short name and section.

**Labels.** `[V n]` means I fetched source n today and the claim is on the page. `[S n]` means a secondary source, used where the primary could not be fetched. `[I]` means inferred by me and not read from a source.

## Summary

A2A v1.0 is the only standard that models both "agent as tool" and "agent as job" [V 1][V 2]. A tool call is a `Message` reply to a blocking send; a job is a `Task` with interrupted states, streaming and push. The spec says nothing about a callee that is not a live process. Both reference SDKs tie streaming and resubscription to an in-process queue, and only the task record can be persisted [V 5][V 8][V 9]. MCP's 2026-07-28 revision removed sessions, server-initiated requests and stream resumability [V 12]. Long-running work now lives in an opt-in Tasks extension that no listed client supports [V 10][V 18]. Every cluster platform offers some mix of synchronous call, task handle and broker topic; only Dapr ships all three plus an outbox [V 23][V 25]. The event-mesh vendors put an orchestrator on top of the bus, and I found no documented production choreography among LLM agents [V 26][V 39]. Claude Code bounded its orchestrator rather than replacing it: background subagents, a `SendMessage` mailbox, an experimental team, and scripted workflows [V 43][V 44][V 46]. Managed Agents caps delegation at one level and 25 threads [V 48]. Identity between agents is per-agent workload identity plus bearer tokens; A2A payloads carry no identity by design [V 50][V 52][V 54]. Re-anchoring authorisation to the originating human has no shipped multi-hop implementation: RFC 8693 makes nested actors "informational only" [V 56][V 58].

## 1. A2A v1.0 as the direct-call contract for a durable callee

**Conclusion.** A2A models both shapes. A `Message` reply to the default blocking send is "agent as tool". A `Task` with push notifications is "agent as job", suited to work "lasting minutes, hours, or even days" [V 2][V 3]. The protocol is silent on restarts and on a callee that sleeps. The SDKs make the gap concrete: a running execution is an in-process object, and only the task record can be persisted.

Lifecycle, verified on the spec and the two topic pages [V 1][V 2][V 3]:

| Concern | What v1.0 says |
| --- | --- |
| States | `SUBMITTED`, `WORKING`; terminal `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`; interrupted `INPUT_REQUIRED`, `AUTH_REQUIRED` |
| Terminal rule | Once terminal a task "cannot restart"; refinements "must initiate a new task within the same `contextId`" |
| `taskId` vs `contextId` | `taskId` is server-generated per task; `contextId` "logically groups multiple related Task and Message objects"; "Agents MUST reject messages containing mismatching contextId and taskId" |
| Multi-turn | A client "optionally attach[es] the `taskId` to a subsequent message to indicate that it continues that specific task"; `referenceTaskIds` hint at prior tasks; follow-ups can create "distinct, parallel tasks" in one context |
| Message vs task | Message for "transactional interactions" needing "no long-running processing or complex state"; task when the capability "needs substantial, trackable work over a longer period"; agents may be message-only, task-generating, or hybrid |
| Blocking | `SendMessageConfiguration.returnImmediately`; default "MUST wait until the task reaches a terminal state or an interrupted state"; non-blocking "MUST return immediately after creating the task" |
| Streaming | `SendStreamingMessage` over SSE; `SubscribeToTask` re-attaches after a dropped connection |
| Push | `TaskPushNotificationConfig{url, token, authentication}`, create/get/list/delete per task; server POSTs a `StreamResponse`; client then "typically use[s] the `GetTask` RPC"; server must validate webhook URLs against SSRF and authenticate with bearer, API key, HMAC or mTLS; client verifies signatures, timestamps, nonces, JWKS |
| Cancel | "The server will attempt to cancel the task, but success is not guaranteed"; idempotent |
| History | `historyLength` on get and list: unset, 0, or a maximum |
| Duration | "Async First"; "Designed for (potentially very) long-running tasks and human-in-the-loop interactions"; no bound stated |
| Restart | Not addressed anywhere on the three pages |

The v0.x field was `configuration.blocking`; v1.0 renamed it `returnImmediately`, and the Python handler computes `blocking = not return_immediately` [V 1][V 8].

How the reference SDKs implement it:

- **Python** [V 5][V 6][V 7][V 8][V 9]. `AgentExecutor.execute` reads the request context and publishes `Task`, `Message`, status and artifact events to an `EventQueue`; `cancel` "should attempt to stop the task ... and publish a `TaskStatusUpdateEvent` with state `TASK_STATE_CANCELED`". `TaskStore` ships as `InMemoryTaskStore` and `DatabaseTaskStore` (SQLAlchemy; persists id, context, status, artifacts, history, metadata as JSON; "does not handle event persistence or message queues"). `InMemoryQueueManager` "is used for a single binary management ... requires all incoming interactions for a given task ID to hit the same binary instance ... needs a distributed approach for scalable deployments". There is no other queue manager in `src/a2a/server/events/`. Resubscribe "Requires the task and its queue to still be active"; a missing queue raises `TaskNotFoundError`. Cancel calls `producer_task.cancel()` on the local producer only. On client disconnect the handler continues "consuming and persisting events in the background". Push has `InMemory` and `Database` config stores and a `BasePushNotificationSender`.
- **JavaScript** [V 4][V 10]. `AgentExecutor{execute, cancelTask}` publishes to an `ExecutionEventBus`. `TaskStore`, bus and bus manager are constructor-injected "so you can back them with a database, a cache, or a message broker". Resubscribe with no live bus returns the stored snapshot and closes the stream. The code comment says this "lets clients reconnect to a long-running task after server restart, executor pause, or an INPUT_REQUIRED bus-sleep window". Cancel with no bus marks the stored task cancelled directly. Blocking waits for the full drain, except `AUTH_REQUIRED`, which returns a snapshot and detaches.

So: the task *record* survives a restart with a database store. The *execution* does not, and neither SDK restarts an executor [I]. The JS SDK's "bus-sleep window" is the nearest thing to a sleeping callee. The executor exits at `INPUT_REQUIRED`, and the next message on the same `taskId` starts a new execution [V 10]. Microsoft's `A2AAgent` client shows the client side [V 30]. It stores `context_id`, `task_id` and `task_state` in the session. On `INPUT_REQUIRED` the next message continues that `task_id`; otherwise the prior id goes in `reference_task_ids`. Long tasks surface as a continuation token to poll or resubscribe, and the default read timeout is 60 s. The page notes "stream reconnection ... not stream resumption from a specific point".

## 2. MCP as the other candidate contract

**Conclusion.** The current revision is 2026-07-28, and it made MCP stateless [V 12]. A plain `tools/call` cannot represent a job that takes days. The request dies with its stream, and senders "SHOULD always enforce a maximum timeout" [V 16][V 17]. The Tasks extension can, on paper: unlimited TTL is allowed, the handle is durable, and `input_required` pauses for input [V 10][V 11]. It is opt-in on both sides, applies only to `tools/call`, is poll-first, and the client matrix records no client support [V 11][V 18].

Changes in 2026-07-28 that bear on long-running work [V 12][V 13][V 14][V 15][V 16][V 17][V 20]:

| Feature | State after 2026-07-28 |
| --- | --- |
| Sessions | `Mcp-Session-Id` and the `initialize` handshake removed; every request carries version and capabilities in `_meta`; cross-call state uses "explicit, server-minted handles passed as ordinary tool arguments" |
| Server-initiated requests | Removed; elicitation, sampling and roots ride the MRTR pattern: server returns `InputRequiredResult{inputRequests, requestState}`, client retries the original request with `inputResponses`; designed to work "without requiring a shared storage layer across server instances or requiring stateful load balancing"; `requestState` is "attacker-controlled" and must be integrity-protected |
| Stream resumability | "Resumable SSE streams via `Last-Event-ID` are not supported"; "A broken response stream loses the in-flight request; clients MUST re-issue it" |
| Progress | `progressToken` and `notifications/progress` on the request's own response stream; receivers "MAY choose to reset the timeout clock" on progress but "SHOULD always enforce a maximum timeout" |
| Cancellation | On Streamable HTTP, closing the response stream is the cancel signal |
| Elicitation | Form mode (flat schema) and URL mode (out-of-band, for credentials and OAuth); the server "may need to block until the request is fulfilled" in URL mode |
| Sampling | Deprecated (SEP-2577); "New implementations SHOULD NOT adopt it"; it had a tools-in-sampling loop |
| Tasks | Moved to extension `io.modelcontextprotocol/tasks`; blocking `tasks/result` replaced by `tasks/get` polling plus `tasks/update` for input; `tasks/list` removed; servers may return a task "unsolicited" |
| Tracing | OpenTelemetry `traceparent`, `tracestate`, `baggage` conventions in `_meta` |

Tasks extension detail [V 10][V 11]:

- States `working`, `input_required`, `completed`, `failed`, `cancelled`; the last three are terminal.
- "A server MUST NOT return `CreateTaskResult` until the task is durably created", meaning "until a `tasks/get` for the returned `taskId` would resolve".
- `ttlMs` is "null for unlimited. The server may discard the task after the TTL elapses"; `pollIntervalMs` is a hint the server may enforce.
- "The following methods currently support task-augmented execution: tools/call".
- `notifications/tasks` is optional and rides `subscriptions/listen`; polling is the default.
- No statement on restarts, multi-instance deployments, or maximum duration.
- Stated fits: "CI pipelines, batch data processing, or model training jobs that take minutes or hours". Also approval gates, and wrapping "an API that already uses job IDs".

Against the A2A project's positioning [V 19]: it calls MCP tools "typically primitives with well-defined, structured inputs and outputs" that "perform specific, often stateless, functions". It says an A2A skill can be exposed over MCP "when the skills are well-defined and can be called in a tool-like, stateless way". That page predates the Tasks extension, which now covers a paused, input-required job [I]. MCP still lacks a conversation grouping like `contextId`, a per-task webhook, first-class artifacts, and an agent card [I]. MCP now has one thing A2A does not: a stateless retry pattern for "ask the caller's user" that needs no server state [V 13].

## 3. Platforms that run agents as cluster services

**Conclusion.** Every platform reduces to three transports: an HTTP call, a task or run handle, and a broker topic. When the callee is idle, Foundry, AgentCore and Dapr workflows re-hydrate state onto fresh compute. The rest assume a live server behind a service name. Completion reaches the caller by blocking, polling a handle, an SSE stream, a webhook, or a reply topic. Only Dapr ships an outbox.

| Platform | Transport | Call shape | Callee idle or asleep | Caller learns of completion | Outbox |
| --- | --- | --- | --- | --- | --- |
| Dapr Agents [V 23][V 24][V 25] | Pub/sub CloudEvents, service invocation, Dapr Workflow, actors | `runner.run()` "responds immediately with an instance ID"; `subscribe` routes topic messages via `@message_router`; `serve` exposes `POST /agent/run`, `GET /agent/instances/{id}`; the synchronous `Agent` is deprecated | `DurableAgent` is a workflow: "runs autonomously in the background until completion", replay-based rehydration | Poll instance status, or the broadcast and per-agent topics an orchestrator (LLM, random, round-robin) listens on | Yes: state outbox writes state and a marker "atomically in the same state store"; any Dapr broker; competing consumers recommended |
| Solace Agent Mesh [V 26][V 27][V 28] | A2A over broker topics: request `{ns}/a2a/v1/agent/request/{agent}`, status and response topics keyed by gateway or delegating agent plus task id, discovery `{ns}/a2a/v1/discovery/agentcards` | "The delegating agent publishes a request on the event broker; the receiving agent subscribes and responds"; `OrchestratorAgent` "Tracks outstanding tasks" and "Aggregates responses" | Agent Hosts publish an AgentCard "on startup and periodically"; offline behaviour not documented on the pages fetched; broker queueing is the obvious mechanism [I] | Streaming status updates then a final response on the caller's topic | Broker only; Python repo archived 2026-09-17, docs now at docs.solace.com (2026.09.17.0001) |
| kagent [V 29][S 31] | A2A on the controller; agents referenced as tools by type `Agent` with name and namespace [S 31]; `x-kagent-agent-instance-id` header selects an instance [V 29] | Agent-as-tool over A2A | `stored_task.go` keeps "private gateway-to-runtime continuation state" for `InputRequired` and `AuthRequired` only; `hitl.go` defines a `kagent.dev/extensions/hitl/v1` extension with `tool_approval_request`, `ask_user_request` and `NestedHITLRequest` "for approval propagation from child agents" | A2A response or stream | None found; kagent.dev returned HTTP 500 three times today, as on 2026-09-16 |
| Microsoft Agent Framework [V 30][V 32][V 33] | `A2AAgent` wraps a remote agent as `AIAgent`; workflows of executors, edges and supersteps | `RunAsync` blocks; `AllowBackgroundResponses` returns a continuation token to poll | Checkpoints at each superstep capture "pending requests and responses"; `RequestPort` pauses and emits `RequestInfoEvent`; File or Cosmos storage survives restarts | Poll the token, resubscribe to the stream, or resume the workflow with `responses` | No; a Foundry state store holds "framework checkpoints" |
| Foundry Hosted Agents [V 34] | Responses, Invocations, Invocations WebSocket, A2A v1.0, Activity | Responses `background: true` with platform polling; Invocations is "Arbitrary JSON in, arbitrary JSON out" for a "Webhook receiver (GitHub, Stripe, Jira, etc.)" | Per-session sandbox idles after 2 to 60 min and resumes with `$HOME` restored; "Background mode lets work continue after the initiating request returns. Resilient execution preserves work after the hosting process stops." | Poll, SSE, or endpoints you define | Durable key-value state store; no outbox |
| Google ADK [V 35][V 36] | `A2AServer` exposes; `RemoteA2aAgent` is "an ADK client-side proxy" placed in `sub_agents` | "just like interacting with a local tool"; sync or async not stated | Not addressed | Remote returns a message or task | No |
| Bedrock AgentCore [V 37] | A2A on port 9000 at `/`, MCP on 8000 at `/mcp`; "transparent proxy layer" passing JSON-RPC through `InvokeAgentRuntime` | Sample client uses `streaming=False` with a 300 s timeout; 409 `RetryableConflictException` "Session operation in progress" implies one operation per session at a time [I] | Session microVM; harness §3 covers 8 h and 14 day limits | Response or stream | No |
| LangGraph Platform [V 38] | `RemoteGraph` is "a client-side interface ... as if it were a local graph"; add as a node | `invoke`, `stream`, async variants; thread via `config`; UUID thread ids required with a checkpointer | Server-side checkpointer per thread | Return value; interrupt propagation across the boundary not documented | No |
| Kafka patterns [V 39][V 40] | Topics per stage; Confluent: Flink orchestrator picks an agent with an LLM and "publishes the message to an HTTP endpoint associated with the identified agent"; agents "write updates back to the agent messages topic" | HTTP call from the orchestrator, event back | Consumers restart from offset [I] | Feedback loop: "continues routing messages until the agent workflow is complete" | Not mentioned; Red Hat uses consumer groups as guardrails and `traceId`/`sessionId` |
| NATS [V 41][V 42] | Synadia Agent Protocol: request to `agents.prompt.{agent}.{owner}.{name}`, streamed chunks, heartbeats every 30 s, offline after three misses; Cotal: multicast `cotal.<space>.chat.>`, unicast per-agent JetStream inbox, anycast JetStream work queue | Request/reply (SAP); durable message (Cotal) | Cotal unicast: "A message to a busy or offline agent waits on the stream and is delivered when the agent frees up. Nothing is lost." | Reply, or the inbox | JetStream is the durable log; no application outbox |

## 4. The three primitives

**Conclusion.** Sync call, async job and event exist across the field, but no protocol carries all three. A2A and MCP Tasks cover call and job; brokers cover event. The guidance that exists says one thing three ways. Start with a call, promote to a job when work is long or needs input, and add a broker only for decoupling. Choreography among LLM agents remains undocumented in production: even the event-mesh vendors add an orchestrator.

| System | Sync call (agent as tool) | Async job (task with completion signal) | Event (pub/sub fan-out) |
| --- | --- | --- | --- |
| A2A v1.0 [V 1][V 2] | `Message` reply; blocking send | `Task` + push config or resubscribe | None |
| MCP 2026-07-28 [V 11][V 12] | `tools/call` | Tasks extension; `tasks/get` polling | `subscriptions/listen` carries server change notifications only |
| Dapr Agents [V 23][V 24] | Service invocation | Workflow instance id | Pub/sub topics plus outbox |
| Solace [V 27] | None | Request topic, status and response topics | Discovery broadcast |
| Agent Framework [V 30][V 32] | `RunAsync` | Continuation token; checkpointed workflow | `RequestPort` to the outside |
| Foundry Hosted [V 34] | Responses | `background: true`; resilient tasks | Invocations as inbound webhook |
| Claude Code [V 43][V 44][V 46] | Foreground `Agent` | Background subagent; workflow `agent()` | `SendMessage` mailbox; shared task list |
| Managed Agents [V 48] | None stated | `send_to_agent` to a persistent thread; `agent.thread_message_received` back | Session event stream |
| NATS Cotal [V 42] | Anycast work queue | Unicast durable inbox | Multicast subject |

Guidance found, quoted:

- A2A: the message-versus-task rule in section 1 [V 2].
- MCP: the "When to use Tasks" list [V 10].
- ADK: use A2A when the remote agent is "a separate, standalone service" or owned by different teams [V 35]. Also when agents span "different programming languages or agent frameworks". Keep local sub-agents for "performance-critical, tightly-coupled operations" and "shared context".
- Dapr: "Start with simpler patterns like Augmented LLM and Prompt Chaining for well-defined tasks where predictability is crucial" [V 24].
- Anthropic: "Start with the simplest approach that works, and add complexity only when evidence supports it"; multi-agent costs "3-10x more tokens" [V 49].
- Claude Code [V 46]: subagents, "A few delegated tasks per turn". Teams, "A handful of long-running peers". Workflows, "Dozens to hundreds of agents per run".

Choreography evidence beyond Azure: none found. Confluent argues the opposite (2025-05-01) [V 39]: "Instead of agents making ad hoc decisions ... a central orchestrator acts as the parent node". Solace runs an `OrchestratorAgent` on the mesh [V 28]. Dapr's event-driven multi-agent pattern is an orchestrator choosing agents [V 23]. Cotal supports peer topologies but describes no production deployment [V 42]. Red Hat's Kafka design is a fixed pipeline of consumer groups, not agents deciding routes [V 40]. Net: zero documented production choreography among LLM agents; the coordination file §2 evidence on peer failure stands unchallenged [I].

## 5. Claude Code's own evolution beyond a single orchestrator

**Conclusion.** Anthropic kept the orchestrator and bounded it. Each feature answers a named limit of the turn-by-turn lead. The limits are context pollution, blocking, results that only flow upward, other machines, and a context window that cannot hold hundreds of results. Managed Agents applies hard caps rather than deeper trees.

| Feature | Mechanism (verified) | Limit it answers, in the vendor's words |
| --- | --- | --- |
| Subagents [V 43][V 47] | Own context; results summarised to the caller; background by default with a restricted tool set; nesting "three layers below the main conversation" (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); "20 subagents can run concurrently" (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, v2.1.217+); SDK adds `maxBudgetUsd`; `isolation: worktree` | "Use one when a side task would flood your main conversation with search results, logs, or file contents you won't reference again" |
| `SendMessage` between subagents [V 43] | Subagents "can message other subagents or the main conversation"; a sibling roster is injected; resume by agent id | Results otherwise return only to the launcher [I] |
| Agent teams [V 44] | Experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; lead plus teammates, each a full session; mailbox JSON at `~/.claude/teams/{team}/inboxes/{agent}.json`; shared task list at `~/.claude/tasks/{team}/` with file locking and dependencies; one team per session, no nested teams, lead fixed; not available under `-p` or the SDK; a teammate "can't approve a permission prompt" | "Use agent teams when teammates need to share findings, challenge each other, and coordinate on their own"; "significantly more tokens" |
| Cross-session messaging [V 45] | `ListAgents` and `SendMessage` over a per-session Unix socket; across machines via Anthropic servers with Remote Control; plain text only; loops throttled; one-shot `notify_when_idle` with a 12 h expiry | "When one session settles a question another is blocked on" |
| Background sessions and agent view [V 51] | A supervisor daemon; "Background sessions don't need any terminal open to keep working"; isolated worktrees; research preview | Sessions tied to a terminal [I] |
| Dynamic workflows [V 46] | A JavaScript script with `agent()`, `pipeline()`, `parallel()`; 16 concurrent agents by default, 1,000 per run, 4,096 items per call; no mid-run user input; resumable by replaying saved results | "With subagents, skills, and agent teams, Claude is the orchestrator: it decides turn by turn what to spawn or assign next, and every result goes into a context window" |
| Managed Agents multiagent [V 48][V 49] | Coordinator with `agent_toolset_20260401` and a `multiagent.agents` roster (agent ids, `self`, one `advisor`); `list_agents` and `send_to_agent`; "Threads are persistent"; "A maximum of 25 concurrent threads"; "The coordinator can only delegate to one level of agents"; 20 unique roster agents; shared sandbox and vault, tools and MCP not shared | Blog (2026-01-23): context protection, parallelisation, specialisation; "3-10x more tokens" |

Whether `send_to_agent` blocks is not stated; the event model (`agent.thread_message_sent`, then `agent.thread_message_received` on the primary thread) reads as asynchronous [I].

## 6. Identity and trust between agents

**Conclusion.** Callee authentication is standard: the card or endpoint declares schemes, and the caller presents a bearer token, API key, SigV4 or mTLS. Per-agent identity is a product in Entra and AgentCore, and SPIFFE gives the workload-level equivalent. Propagating the originating human's authorisation is one hop deep in shipped systems (Foundry OBO, AgentCore 3LO); multi-hop re-anchoring exists only in a draft.

| System | Caller authentication | Human authorisation across hops |
| --- | --- | --- |
| A2A [V 1][V 50] | `securitySchemes` and `security` on the card (OAuth2, OIDC, API key, HTTP, mTLS); "Credentials must be transmitted in standard HTTP headers"; "the A2A server is responsible for authorizing the request", per skill; `AUTH_REQUIRED` for secondary credentials obtained "outside of the A2A protocol itself"; W3C trace context recommended | "A2A protocol payloads ... don't carry user or client identity information directly"; no on-behalf-of defined |
| MCP [V 12][V 14] | The MCP Authorization spec (OAuth); URL-mode elicitation for third-party OAuth; token passthrough forbidden; `requestState` must bind "the authenticated principal"; the OAuth Client Credentials and Enterprise-Managed Authorization extensions | User identity from the `sub` claim, one hop |
| Foundry and Entra Agent ID [V 34][V 52] | Every hosted agent "gets its own dedicated Microsoft Entra ID (agent identity)"; agents "can accept requests from other clients, users, and agents" secured by Entra tokens; agent identities are distinct from service principals and built "for scale and ephemerality" | OBO "If a user token is present"; otherwise the agent's own identity; an "agent user" account pairs one-to-one when systems need a user |
| AgentCore Identity [V 53][V 54][V 55] | Workload identity with an ARN; inbound SigV4 or JWT authorizer; token vault; every request verified "even from callers within the same trust domain" | 3LO consent per provider; "impersonation flow where agents can access resources using credentials provided to them"; logs carry "both the agent identity and any associated user context" |
| SPIFFE [V 57] | X.509 or JWT SVIDs from the Workload API after node or workload attestation; automatic rotation | Not addressed |
| agentgateway [V 59] | Proxies MCP, A2A and LLM APIs; JWT and API key auth; CEL-based RBAC per tool | Not detailed on the README |
| kagent [V 29] | `x-kagent-agent-instance-id`; a `go/api/authorization` package exists | `NestedHITLRequest` propagates approvals from child agents to the caller |

Re-anchoring implementations: RFC 8693 (2020) defines the `act` claim, nested chains, and `may_act` [V 56]. It then rules that "Prior actors identified by any nested `act` claims are informational only and are not to be considered in access control decisions". WorkOS (2026-04-27) draws the conclusion: the standard gives a chain for audit, not for enforcement [V 58]. HDP (arXiv 2604.04522, 2026-04-06) proposes a token that "binds a human authorization event to a session" [V 60]. Each agent's delegation becomes "a signed hop in an append-only chain". It is an Internet-Draft, and the abstract reports no evaluation. Nothing shipped enforces the originating request at hop two or deeper [I].

## Implications for aesir

Mapping onto the task primitive (ADR-0009, ADR-0010), with what the evidence confirms, contradicts, or leaves open.

| Aesir element | Nearest prior art | Verdict |
| --- | --- | --- |
| Task row independent of any conversation | A2A `Task` with `contextId`; MCP task with durable `taskId`; kagent `stored_task` | Confirms. A2A requires "Agents MUST generate a unique taskId"; MCP requires the task be "durably created" before the handle returns [V 1][V 11]. Aesir's row is that handle. |
| `task:delegate` starts the target with a focused brief, never the delegator's history | Managed Agents: "Tools, MCP servers, and context are not shared"; Claude Code subagents receive only the prompt; ADK guidance on standalone services | Confirms [V 48][V 47][V 35]. |
| Accept, reject, counter-propose | A2A `REJECTED` (terminal) and `INPUT_REQUIRED` (interrupted); hybrid agents that "use messages for negotiation" before a task | Partial. Counter-propose has no state; the nearest is a `Message` reply before any task, or `INPUT_REQUIRED` back to the delegator [V 2] [I]. |
| `wait_for_task` registers completion, failure, timeout | A2A push config plus resubscribe; MCP `tasks/get` polling; Agent Framework continuation token | Confirms the shape. Nobody standardises the timeout leg; A2A leaves it to the client, MCP to `ttlMs` [V 3][V 11]. |
| `TaskSignalDispatcher` fires on terminal status to the parent's active conversation, orphan if none | A2A push notification sender; Dapr outbox; JS SDK "bus-sleep window" | Confirms and exceeds. A2A never says what happens when the webhook target is gone; Dapr is the only platform with an outbox [V 25]. The orphan record is aesir's own answer [I]. |
| `completion_result` on the task row | A2A artifacts plus final status message; MCP `result` on `completed` | Confirms [V 1][V 10]. |
| Task groups: all_required, any_sufficient, majority | A2A parallel tasks in one `contextId`; Claude Code `parallel()`; Cotal anycast | Leaves open. No protocol expresses a group policy; it is application logic everywhere [I]. |
| Max delegation depth 5 | Managed Agents one level; Claude Code three; MasDrift drift "widens with hierarchy depth" (coordination §2) | Contradicts loosely. Every vendor cap is lower than five [V 48][V 43]. |
| No long-lived process per agent | A2A and MCP assume a live server; SDKs tie execution to a process; Foundry and Dapr rehydrate on demand | Confirms the gap is real and that the platforms solve it below the protocol, not in it [V 8][V 34][V 23]. If aesir exposes A2A, the JS SDK's snapshot-on-resubscribe behaviour is the model to copy [I]. |
| Directory with natural-language capabilities | A2A card `skills`; Solace card broadcast; NATS `$SRV.PING.agents` | Confirms coordination §3: identity and endpoint are standard, capability routing is not [V 27][V 41]. |
| Human approval from the originating tool | MCP MRTR and URL elicitation; Agent Framework `RequestPort` saved in checkpoints; kagent `NestedHITLRequest` | Confirms coordination §4; kagent's nested approval is the only shipped cross-agent approval propagation found [V 29]. |
| Owner's doubt that one orchestrator scales | Claude Code moved the plan into a script; Managed Agents capped threads at 25 and depth at one | Supports bounding the orchestrator, not abandoning it [V 46][V 48]. |

Open after this research:

- A delegator's wait surviving the delegator's own restart is the client's problem in every protocol; aesir's parent-task lookup is one answer.
- Authorisation deeper than one hop has no shipped enforcement.
- The MCP Tasks extension has no recorded client support, so building on it today means writing both ends.

## Sources

Fetched 2026-09-21. Dates as shown on the page; "no date" where none appears.

1. A2A Protocol, Specification v1.0.0 (announcement banner 2026-08-27). https://a2a-protocol.org/latest/specification/
2. A2A Protocol, Life of a task (no date). https://a2a-protocol.org/latest/topics/life-of-a-task/
3. A2A Protocol, Streaming and asynchronous operations (no date). https://a2a-protocol.org/latest/topics/streaming-and-async/
4. a2aproject/a2a-js, README (protocol v1.0.0). https://github.com/a2aproject/a2a-js
5. a2aproject/a2a-python, README (SDK 1.0). https://github.com/a2aproject/a2a-python
6. a2a-python, `agent_executor.py`. https://raw.githubusercontent.com/a2aproject/a2a-python/main/src/a2a/server/agent_execution/agent_executor.py
7. a2a-python, `database_task_store.py`, and directory listings of `server/tasks` and `server/events`. https://raw.githubusercontent.com/a2aproject/a2a-python/main/src/a2a/server/tasks/database_task_store.py
8. a2a-python, `default_request_handler.py`. https://raw.githubusercontent.com/a2aproject/a2a-python/main/src/a2a/server/request_handlers/default_request_handler.py
9. a2a-python, `in_memory_queue_manager.py`. https://raw.githubusercontent.com/a2aproject/a2a-python/main/src/a2a/server/events/in_memory_queue_manager.py
10. a2a-js, `default_request_handler.ts`. https://raw.githubusercontent.com/a2aproject/a2a-js/main/src/server/request_handler/default_request_handler.ts
11. Model Context Protocol, Tasks extension overview and `ext-tasks` spec 2026-07-28. https://modelcontextprotocol.io/extensions/tasks/overview and https://raw.githubusercontent.com/modelcontextprotocol/ext-tasks/main/specification/2026-07-28/tasks.md
12. MCP, Specification 2026-07-28 and Key changes. https://modelcontextprotocol.io/specification/latest and https://modelcontextprotocol.io/specification/2026-07-28/changelog
13. MCP, Multi round-trip requests. https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
14. MCP, Elicitation. https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
15. MCP, Progress. https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/progress
16. MCP, Cancellation. https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/cancellation
17. MCP, Streamable HTTP and Transports overview. https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
18. MCP, Extension support matrix (community-maintained). https://modelcontextprotocol.io/extensions/client-matrix
19. A2A Protocol, A2A and MCP (page references 2026-08-27). https://a2a-protocol.org/latest/topics/a2a-and-mcp/
20. MCP, Sampling (deprecated in 2026-07-28). https://modelcontextprotocol.io/specification/2026-07-28/client/sampling
21. Dapr Agents, documentation index (lists the section's pages). https://docs.dapr.io/developing-ai/dapr-agents/
22. Tigera, How AI agents communicate: understanding the A2A protocol for Kubernetes, 2026-03-10 (consulted; carries no kagent detail). https://www.tigera.io/blog/how-ai-agents-communicate-understanding-the-a2a-protocol-for-kubernetes/
23. Dapr Agents, Core concepts. https://docs.dapr.io/developing-ai/dapr-agents/dapr-agents-core-concepts/
24. Dapr Agents, Agentic patterns, and dapr/dapr-agents README. https://docs.dapr.io/developing-ai/dapr-agents/dapr-agents-patterns/ and https://github.com/dapr/dapr-agents
25. Dapr, Outbox pattern. https://docs.dapr.io/developing-applications/building-blocks/state-management/howto-outbox/
26. Solace Agent Mesh, docs.solace.com (2026.09.17.0001). https://docs.solace.com/Agent-Mesh/agent-mesh.htm
27. Solace Agent Mesh (Python, archived 2026-09-17), Architecture overview v1.28.7. https://solacelabs.github.io/solace-agent-mesh/docs/documentation/getting-started/architecture/
28. Solace Agent Mesh, Orchestrator, and SolaceLabs/solace-agent-mesh README. https://solacelabs.github.io/solace-agent-mesh/docs/documentation/components/orchestrator/
29. kagent, `go/api/a2a/stored_task.go`, `hitl.go`, `routing.go`, and `go/api` listing. https://github.com/kagent-dev/kagent/tree/main/go/api/a2a (kagent.dev docs returned HTTP 500 three times today)
30. Microsoft Agent Framework, A2A agent service, ms.date 2026-09-16. https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/agent-services/a2a
31. Secondary: web search snippets for kagent agents-as-tools and the controller A2A endpoint. https://kagent.dev/docs/kagent/concepts/agents/ (not fetched)
32. Microsoft Agent Framework, Human-in-the-loop, ms.date 2026-07-16. https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop
33. Microsoft Agent Framework, Checkpoints, ms.date 2026-09-16, and Workflow capabilities, ms.date 2026-07-29. https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints
34. Microsoft Foundry, Hosted agents, ms.date 2026-09-11. https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents
35. Google ADK, A2A introduction (ADK TypeScript 2.0 GA banner). https://adk.dev/a2a/intro/
36. Google ADK, A2A quickstart (consuming). https://adk.dev/a2a/quickstart-consuming/
37. Amazon Bedrock AgentCore, Deploy A2A servers in AgentCore Runtime. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a.html
38. LangSmith, Use RemoteGraph. https://docs.langchain.com/langsmith/use-remote-graph
39. Confluent, How to build a multi-agent orchestrator using Flink and Kafka, 2025-05-01. https://www.confluent.io/blog/multi-agent-orchestrator-using-flink-and-kafka/
40. Red Hat Developer, How Kafka improves agentic AI, 2025-06-16 (updated 2025-07-30). https://developers.redhat.com/articles/2025/06/16/how-kafka-improves-agentic-ai
41. NATS blog, What's old is new: a NATS-native protocol for AI agents, 2026-05-25. https://nats.io/blog/nats-native-protocol-for-ai-agents/
42. NATS blog, Coordinating teams of AI agents in real time on NATS and JetStream (Cotal), 2026-08-01. https://nats.io/blog/coordinating-ai-agent-teams-on-nats/
43. Claude Code, Subagents. https://code.claude.com/docs/en/sub-agents
44. Claude Code, Orchestrate teams of Claude Code sessions (as of v2.1.178). https://code.claude.com/docs/en/agent-teams
45. Claude Code, Message your other Claude Code sessions (v2.1.224+). https://code.claude.com/docs/en/cross-session-messaging
46. Claude Code, Orchestrate subagents at scale with dynamic workflows. https://code.claude.com/docs/en/workflows
47. Claude Agent SDK, Subagents in the SDK. https://code.claude.com/docs/en/agent-sdk/subagents
48. Claude Platform, Managed Agents multiagent orchestration (beta `managed-agents-2026-04-01`). https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration
49. Anthropic, Building multi-agent systems: when and how to use them, 2026-01-23. https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
50. A2A Protocol, Enterprise-ready features. https://a2a-protocol.org/latest/topics/enterprise-ready/
51. Claude Code, Agent view (research preview). https://code.claude.com/docs/en/agent-view
52. Microsoft Entra, What are agent identities, ms.date 2025-11-06 (updated 2026-06-15). https://learn.microsoft.com/en-us/entra/agent-id/what-are-agent-identities
53. Amazon Bedrock AgentCore Identity, Overview. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-overview.html
54. Amazon Bedrock AgentCore Identity, Features. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/key-features-and-benefits.html
55. Amazon Bedrock AgentCore Identity, Example use cases. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-use-cases.html
56. RFC 8693, OAuth 2.0 Token Exchange, January 2020. https://www.rfc-editor.org/rfc/rfc8693.html
57. SPIFFE, Overview. https://spiffe.io/docs/latest/spiffe-about/overview/
58. WorkOS, AI agents and the multi-hop delegation problem, 2026-04-27. https://workos.com/blog/oauth-multi-hop-delegation-ai-agents
59. agentgateway, GitHub README (agentgateway.dev/docs returned HTTP 404). https://github.com/agentgateway/agentgateway
60. HDP: A Lightweight Cryptographic Protocol for Human Delegation Provenance, arXiv 2604.04522, 2026-04-06. https://arxiv.org/abs/2604.04522

Not fetched: the Ping Identity token-exchange page (HTTP 404) and the kagent.dev docs (HTTP 500). The Dapr Agents pages at the old `developing-applications` path returned HTTP 404; the `developing-ai` path above supersedes them.
