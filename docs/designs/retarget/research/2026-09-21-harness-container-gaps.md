# Harness and container gaps: inbound contract, version skew, identity, build, health, cost

Date: 2026-09-21. Research brief for the aesir retarget conversation (no issue yet). Builds on `2026-09-16-harness-and-packaging-prior-art.md` (cited as *prior-art §n*) and `2026-09-16-scaling-containerised-agents.md` (cited as *scaling §n*), and answers only the six questions those files leave open. Written from pages fetched this session. `[V]` means verified from a fetched page listed in Sources. `[I]` means inferred, or taken from a search summary of a page that could not be fetched. Pages that failed are named at the top of Sources.

**Summary.** Every hosted platform surveyed pushes work into the container over HTTP; only Anthropic's self-hosted worker pulls, and "idle" there means "exit after a grace period". All three hosted platforms pin a session to the agent version it started on; the durable engines pin executions to a build and drain old builds. Kubernetes gives a pod no way to read its own image digest, so the harness must be told its version by the build or the platform. Managed Agents substitutes placeholders at egress so the sandbox never holds a secret; Foundry and AgentCore issue the container a short-lived identity instead. agentgateway, Envoy's credential injector, and Secretless are the self-hostable equivalents, with SPIRE for the identity half. No tool turns a manifest into an image plus cluster objects in one step; `ko` and `kpack` each do half. Kubernetes probes assume request-serving pods, and AgentCore's `HealthyBusy` is the only busy-aware precedent. Drain is release-the-claim everywhere, and AgentCore is the only vendor to publish a cold-start figure: about two seconds P75 on its snapshot-based V2. Compute is billed per active session on every platform; Managed Agents exposes per-session list cost and active seconds directly. OpenTelemetry carries agent and conversation ids on spans but not on the token-usage metric, and the GenAI conventions remain "Development".

## 1. The harness's inbound contract

**Conclusion.** The minimal contract is one inbound call carrying a session id, one status the platform can read, and one way to say "waiting for input". Hosted platforms implement it as push over HTTP with a health endpoint; Anthropic's self-hosted worker inverts it to pull, and "idle" becomes "exit after `--max-idle`". No platform lets the container declare idle to the router. Idle is inferred from the absence of requests, or from a busy flag the container keeps current.

| System | Direction | Sync or async | "Busy" means | "Waiting for input" means | Follow-up routing |
| --- | --- | --- | --- | --- | --- |
| Managed Agents session API [V] | Push into Anthropic; the client sends events | Async: `POST /v1/sessions/{id}/events` "returns as soon as the events are queued" | Status `running` | `session.status_idle` with `stop_reason` `end_turn`, `requires_action` (plus `event_ids`), or `budget_reached`; on the SSE stream, or webhook `session.status_idled` | Same session id; a `user.message` sent while running is "queued behind earlier events"; `user.interrupt` stops the turn |
| `ant beta:worker` (self-hosted) [V] | Pull: the worker polls the environment queue, or a webhook handler on `session.status_run_started` starts polling | Async work items; tool results posted back | The worker holds a claimed work item | `--max-idle`: "How long to wait after the session goes idle with an `end_turn` stop reason before shutting down. Defaults to `60s`" | The next turn is a new work item; any worker can claim it [I] |
| Foundry hosted agents [V] | Push: the platform routes to the container on port 8088 | Responses: sync, or `background: true` with polling; Invocations: "you define polling or streaming endpoints" | An open request; "Each request resets the idle timer" | No signal; compute is deprovisioned after the idle timeout (2 to 60 min, default 15) and `$HOME` is restored on the next request | `agent_session_id` in the body (Responses) or the query string (Invocations); `FOUNDRY_AGENT_SESSION_ID` injected |
| AgentCore Runtime [V] | Push: `POST /invocations` on `0.0.0.0:8080`, ARM64 | JSON or SSE; `/ws` optional | `GET /ping` returns `HealthyBusy`: "the runtime session is considered active and is kept alive" | `Healthy` on `/ping` plus no requests; idle timeout default 900 s, max lifetime 28800 s on microVMs | Header `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` pins the microVM; a second operation during provisioning returns 409 `RetryableConflictException` |
| A2A 1.0 [V] | Push to the URL on the agent card | `SendMessage` "MUST return immediately with either task information or response message"; `SendStreamingMessage` streams status events | `TASK_STATE_WORKING` | `TASK_STATE_INPUT_REQUIRED` or `TASK_STATE_AUTH_REQUIRED`, both "interrupted" states | A new message "with the same `taskId` and `contextId`"; push notifications need `capabilities.pushNotifications` |
| kagent agent pod [V from issue #2549; the docs site returned 500] | Push: the pod serves A2A on `:8080`; the controller proxies at `kagent-controller:8083/api/a2a/{ns}/{name}/` | A2A semantics | A2A semantics | A2A semantics | Agent card at `/.well-known/agent-card.json` |

Two details matter for a self-hosted design. AgentCore warns that a `time_of_last_update` that advances on every ping "prevents the idle session timeout from ever firing" [V]; a busy flag needs discipline. On self-hosted Managed Agents "your integration is responsible for providing `agent_toolset` results" via `user.tool_result` [V]. The worker owns tool execution while Anthropic owns the loop, the same split that *prior-art §6* and *scaling §2* describe.

## 2. Version pinning across a pause

**Conclusion.** Every hosted platform pins a session to the version it started on and never rolls it forward; a new version only affects new sessions. The durable engines do the same for executions and add a drain signal. Kubernetes gives a pod no way to read its own image digest. The build must put the digest in the manifest, or the platform must inject the version, as Foundry does. The open case is resume after compute was released: AgentCore's pages leave it ambiguous.

| System | Version unit | Paused or in-flight session on a new version | Drain signal | Evidence |
| --- | --- | --- | --- | --- |
| Managed Agents [V] | Agent `version`, incremented per changed update; the session records `agent.id` and `agent.version` | Pinned: only `tools` and `mcp_servers` may change mid-session; `system` "is fixed for the session's lifetime"; after archiving an agent, "existing sessions continue to run" | None documented; sessions list by `agent_id` | agent-setup, session-operations, sessions |
| Foundry [V] | Immutable version = image + cpu and memory + env + protocols | "Each session is bound to a single version at creation time"; `version_indicator` pins explicitly; `FOUNDRY_AGENT_VERSION` injected | None documented. The concept page says "Traffic splitting between versions isn't supported"; the SDK example sets `version_selection_rules` with `traffic_percentage`. Contradiction noted, not resolved | hosted-agents, manage-hosted-sessions, deploy-hosted-agent |
| AgentCore [V] | Immutable runtime version; endpoints point at versions | "existing sessions will continue using the previous version until they terminate"; V2 keeps the old snapshot "until existing sessions end", up to 8 h. Whether a `Stopped` session that resumes on new compute gets the old artifact is not stated [I] | Snapshot deletion after sessions end | lifecycle-settings, sessions, how-it-works |
| Temporal Worker Versioning [V] | Deployment name + Build ID | Pinned: "guaranteed to complete on a single Worker Deployment Version"; Auto-Upgrade moves to the Current version and must be patch-safe; Ramping by percentage | Version status `Draining`, then `Drained` | Min server v1.29.1, TypeScript SDK v1.12; GA status not stated on the page |
| Restate [V] | Immutable deployment endpoint | "Existing requests continue on the original deployment" | `restate deployment describe --extra` shows active invocations; remove at zero, `--force` otherwise | operate/versioning |
| DBOS [V] | Application version = hash of workflow source, or `applicationVersion` | Recovery "only recovers workflows whose version matches the current application version"; run old and new processes side by side | `DBOS.listWorkflows` for the old version; `setLatestApplicationVersion` to roll back | upgrading-workflows |

Kubernetes records the running digest in `status.containerStatuses[].imageID` ("ImageID of the container's image") [V]. The downward API exposes only metadata, node, IPs, and resource fields; the image id is not among them [V]. Two ways follow [I]. Pass the digest in as an environment variable from the manifest; `ko` and kustomize substitute digests into pod specs (section 4). Or read the pod's own status through the API. kagent's `Harness.image` must match `@sha256:` by regex [V], so its manifests already carry the value. Temporal does not document a pinned workflow whose version has no workers [V]; tasks presumably wait until a worker with that Build ID polls [I].

## 3. Per-agent identity and the vault at egress

**Conclusion.** Three mechanisms exist and are not interchangeable. Managed Agents substitutes placeholders at egress, so nothing in the sandbox ever holds the value. The price: anything that signs or exchanges the secret locally breaks, and the feature does not reach self-hosted sandboxes. Foundry and AgentCore hand the container a short-lived identity and vend tokens on demand. The process holds an access token but never a refresh token or a long-lived key. Self-hosted equivalents are a gateway that holds the upstream credential (agentgateway, Envoy credential injector, Secretless) plus a workload identity to reach it (SPIFFE/SPIRE).

| Mechanism | What the container holds | Where the secret is applied | Self-hostable | What you run | Limits stated by the source |
| --- | --- | --- | --- | --- | --- |
| Managed Agents vault, `environment_variable` [V] | "an opaque placeholder"; "The agent never sees the secret value" | "substituted with the real secret at egress"; scoped by `networking.allowed_hosts` and `injection_location` (`header`, `body`) | No | Nothing | "not yet supported with self-hosted sandboxes"; "Substitution is outbound only", an exchanged token "arrives in the sandbox unredacted"; SigV4-style signing fails; 20 credentials per vault; workspace-scoped |
| Managed Agents vault, `mcp_oauth` and `static_bearer` [V] | Nothing; keyed by `mcp_server_url` | "the token is injected automatically" when the connector opens the server; Anthropic refreshes | No | Nothing | First matching vault wins; refresh failures surface as `vault_credential.refresh_failed` |
| Foundry agent identity [V] | An Entra identity per agent, created at deploy; tokens via managed identity | Model, Toolbox MCP endpoint, Azure RBAC; OBO when a user token is present | No | Nothing | Connection placeholders `${{connections.<name>.credentials.<field>}}` are resolved "as a plain environment variable" at sandbox start, while the concept page says "Don't put secrets in container images or environment variables" |
| AgentCore Identity plus Gateway [V] | A workload access token delivered "as payload headers"; `@requires_access_token` passes `access_token: str` into the function | The token vault vends API keys and OAuth tokens (2LO, 3LO with a consent URL); Gateway "Handles credential injection for each tool" | No | Nothing | "Runtime-managed agent identities cannot retrieve workload access tokens directly"; "agents never have direct access to long-term secrets or refresh tokens"; Gateway $0.005 per 1,000 invocations |
| agentgateway [V] | Its own credential to the gateway (JWT, API key, OAuth) | `policies.backendAuth` from inline, `$ENV`, file, or Kubernetes `secretRef`; "the client sends one to the gateway, and the gateway sends a different one to the backend"; MCP, A2A, LLM providers | Yes; Apache 2.0, Linux Foundation | One proxy; on Kubernetes "the built-in controller and Gateway API" | Backend auth "does not decide who is allowed through" |
| Envoy credential injector [V] | Nothing for the upstream | Injects Basic, Bearer, or OAuth2 client-credentials tokens; secrets via SDS; `overwrite` flag | Yes | Envoy as sidecar or egress gateway | Workload auth only; `ext_authz` makes authorisation decisions, it does not inject |
| Secretless Broker [V] | Nothing | A sidecar bound to `127.0.0.1` brokers HTTP Basic, Conjur, and AWS strategies, MySQL, PostgreSQL, SSH | Yes | A sidecar per pod plus a credential provider | HTTP strategies limited to those listed |
| SPIFFE/SPIRE [V] | An SVID (X.509 or JWT) fetched from a Unix socket | Identity only; a gateway maps SVID to upstream credential [I] | Yes | SPIRE Server with a MySQL, SQLite, or Postgres datastore; SPIRE Agent per node; workload attestation via the kubelet | Does not inject credentials |
| Claude Code sandbox proxy (*prior-art §2*) [V] | Sentinel values | `injectHosts`, `tlsTerminate` outside the sandbox | Yes, per process | The CLI's own proxy | Claude Code only |

Cost of the self-hosted stack [I]: agentgateway or Envoy is one stateless Deployment; SPIRE adds a server, a datastore, and a DaemonSet. Anthropic's hosting guidance already recommends "a proxy that injects API keys after the request leaves the container" (*prior-art §6*) [V].

## 4. Manifest to image and cluster objects

**Conclusion.** No surveyed tool goes from a declaration to an image and its deployment objects in one step. `ko` is the closest shape: it reads Kubernetes YAML, builds the referenced images, pushes by digest, and prints the YAML with digests substituted. `kpack` is the other half: a CRD that produces an image and rebuilds on base-image change. kagent separates the two cleanly: the image is an input pinned by digest, the template is a CR, and a controller emits the workload. Layered guidance is a plain `FROM` chain with `ONBUILD` hooks.

| Tool | Input | Output | Emits cluster objects | Digest handling |
| --- | --- | --- | --- | --- |
| kagent `Harness` plus `AgentTemplate` (main) [V] | Image "pinned by sha256 digest" (regex `@sha256:[a-f0-9]{64}`), command, args, substrate policy (`WorkerPoolRef`, `SnapshotPolicy`); template with model, prompt (inline, ConfigMap, or Go template), up to 50 tools, 50 skills, 20 plugins | A controller-managed workload; status carries `DesiredRevision` and `LatestSuccessfulRevision` per Harness | Yes (a released Agent CR yields a Deployment [I, search summary]) | Required on input |
| Foundry `azd deploy` [V] | `azure.yaml` service `host: azure.ai.agent`, `kind: hosted`, protocols, `env`, `sessionConfiguration`; or a source zip | The image built "remotely in Azure Container Registry", pushed; an immutable version; an Entra identity; RBAC | Platform-internal | Tag; "Use unique image tags instead of `:latest`" |
| Cloud Native Buildpacks [V] | Source plus a builder (buildpacks, build base, lifecycle, run base) | OCI image | No | Image only |
| kpack [V] | `Image` CRD with source | OCI image; "schedules rebuilds on source changes and from builder buildpack and builder stack updates" | No; it is a controller that emits images | Rebuild on base change |
| `ko` [V] | Kubernetes YAML with `ko://` import paths | Images pushed; "the resulting resolved YAML" with "the fully-specified image reference"; `ko apply` pipes to `kubectl` | Yes (your YAML, resolved) | Substituted by digest |
| nixpacks [V] | Source | "generates a `Dockerfile`", builds an OCI image | No | Image only |
| Dockerfile [V] | `FROM image@digest`; `ONBUILD` "instructions for when the image is used in a build"; `COPY --from` | Image | No | Digest pin on `FROM` |
| kustomize `images` [V] | `name`, `newName`, `newTag`, `digest` | Transformed resources | Yes | `digest` field |
| Helm OCI [V] | A chart pushed with `helm push ... oci://` | A chart in the same registry as images; "Installing a chart with a digest is more secure than a tag" | Yes | Chart digest; page "not yet updated for Helm 4" |
| Operator pattern [V] | A CRD plus a controller (kubebuilder, Operator SDK, Metacontroller, Kopf, kube-rs, shell-operator) | Whatever the controller reconciles | Yes | Your choice |

A layered-guidance chain [I] is three `FROM` steps. The base is the harness. The organisation layer adds `/etc/claude-code/managed-settings.json` and rules. The agent layer adds the manifest and prompt. `ONBUILD` in the base can copy a conventional `agent/` directory in every downstream build without a per-agent Dockerfile. Docker Agent avoids images entirely by pushing YAML as an OCI artifact (*prior-art §3*) [V].

## 5. Health, drain and wake for a mostly idle harness

**Conclusion.** Kubernetes probes assume request-serving pods. Readiness only removes a pod from Service endpoints, so it says nothing for a poller; liveness must test the loop, not a port. The one vendor precedent for a busy-aware check is AgentCore's `HealthyBusy`. Drain has one shape across Temporal, DBOS, and `ant beta:worker`. Stop polling, finish or cancel in-flight work within a grace period, and release the claim for another replica. Wake from zero is bounded by the KEDA poll interval plus pod start; only AgentCore publishes a cold-start figure.

| Concern | Precedent | What it says | Tag |
| --- | --- | --- | --- |
| Liveness and readiness | Kubernetes probes | Liveness failure: "the kubelet restarts that container"; readiness failure: the controller "removes the Pod's IP address from the EndpointSlices of all Services"; a startup probe gates both | [V] |
| Busy-aware health | AgentCore `/ping` | `Healthy` versus `HealthyBusy`; set `time_of_last_update` only on a real change, or the idle timeout never fires | [V] |
| Health endpoint in a hosted container | Foundry | The protocol libraries "automatically expose a `/readiness` endpoint for platform health checks" | [V] |
| Drain | Temporal worker | "stops polling for new Tasks and allows in-flight Tasks to complete until `shutdownGraceTime` is reached. Any Activities still running at that time stop running and are rescheduled by the Temporal Service when an Activity timeout occurs"; `shutdownForceTime` | [V] |
| Drain | `ant beta:worker` | "cancels any in-flight tool call, posts its error result, and releases the work item before stopping" | [V] |
| Drain | DBOS | "Shutdown does not wait for workflows still running in this process to complete unless `workflowCompletionTimeoutMS` is set"; the workflow "remains `PENDING`" for recovery | [V] |
| Drain window | Kubernetes, AgentCore | 30 s default grace (*scaling §3*); AgentCore "Termination can last up to 15 seconds" | [V] |
| Wake from zero | KEDA | KEDA decides 0 to 1, then "it is the HPA controller who takes the scaling decisions"; activation "only occurs when this value is greater than the set value"; defaults 30 s polling and 300 s cooldown (*scaling §1*) | [V] |
| Wake by webhook | Managed Agents | A handler "wakes on `session.status_run_started` and starts polling"; webhooks retry three times over 5 to 120 s, arrive unordered, and are then dropped | [V] |
| Idle exit | `ant beta:worker` | `--max-idle` default 60 s after `end_turn` | [V] |
| Cold start | AgentCore V2 | "a P75 cold start latency of about 2 seconds from a 200 MB image all the way to 2 GB"; V1 "from roughly 5.4 seconds to nearly 30 seconds"; the snapshot is taken on the first healthy `/ping`, due within 120 s | [V] |
| Cold start | Foundry | "predictable cold starts", no figure; version provisioning "typically takes less than one minute depending on image size" | [V] |
| Cold start | Managed Agents | "the environment's sandbox begins provisioning as soon as the session is created, so the first tool call does not wait on it"; agent-sandbox warm pools bind "in under one second" (*prior-art §3*) | [V] |

On KEDA, wake latency is poll interval plus scheduling plus image pull plus harness start, and scale-down waits at least the 300 s cooldown [I]. A per-session worker that exits after `--max-idle` pays a fresh start per turn; a long-running replica holds memory while idle instead (*scaling §1*) [I].

## 6. Cost attribution

**Conclusion.** All three vendors bill compute per active session and stop the meter when the session idles. Managed Agents also exposes a per-session list cost and `active_seconds`, the most direct attribution surface found. Token cost is attributed by the session object or its events, not by a separate ledger. OpenTelemetry carries agent and conversation ids on spans, but its token-usage metric does not, and the whole GenAI convention set is still "Development".

| Platform | Compute billed | Token attribution | Identifiers available | Caller attribution |
| --- | --- | --- | --- | --- |
| Managed Agents [V] | "$0.08 per session-hour", which "accrues only while the session's status is `running`"; idle not billed | Session `usage.list_cost` and `usage.active_seconds`; a `session.usage` event "immediately before it goes idle"; per-thread usage; `span.model_request_end` carries `model_usage`; budget `max_list_cost` in cents | `agent.id`, `agent.version`, session id, thread id | Agent `metadata`; vault `metadata` (for example `external_user_id`); sessions filter by `agent_id` |
| Foundry [V] | "cpu + memory consumed across all active sessions"; the pricing page shows "$-" placeholders for vCPU-hour and GiB-hour | Model tokens through the project endpoint; Claude in Foundry bills CCUs at $0.01 | `FOUNDRY_AGENT_NAME`, `FOUNDRY_AGENT_VERSION`, `FOUNDRY_AGENT_SESSION_ID` injected; App Insights traces | An isolation key per caller; cost in billing currency needs `Microsoft.Billing/billingProperty/read` |
| AgentCore [V] | v2: $0.1276 per vCPU-hour and $0.0169 per GB-hour, per second, 1 s minimum; "CPU scales to zero during I/O wait"; idle memory reclaimed after 120 s; v1: $0.0895 and $0.00945 | Model billed by the provider, not the runtime | `runtimeSessionId`, runtime version, endpoint ARN | The session is the billing unit; user mapping is "your client backend"; Identity free, Gateway $0.005 per 1,000 invocations |
| OpenTelemetry GenAI [V] | n/a | `gen_ai.client.token.usage` attributes: `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.token.type`, `gen_ai.request.model`, `gen_ai.response.model`, `server.address`, `server.port`; no agent or conversation id | On spans: `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.agent.version`, `gen_ai.conversation.id`, all Conditionally Required and Development; the general `session.id` is also Development | Nothing standard; `gen_ai.conversation.id` must not be a fallback UUID |

Status check, September 2026. The README of `semantic-conventions-genai` says "Status: Development" [V]. The main-repo page says the conventions "have moved" and are "no longer maintained in this repository" [V]. The OpenTelemetry blog gives no timeline [V]. A July 2026 third-party review reports no tagged release in the new repository [I, search summary]. Attributing tokens per agent therefore means aggregating spans, or adding your own attributes to the metric [I].

## 7. Gap check

| Further question | Raised by |
| --- | --- |
| What the harness does when a signal arrives while the platform is provisioning or tearing down that session's compute | AgentCore 409 `RetryableConflictException`; Managed Agents requires `idle` to update or archive |
| Where exchanged or derived tokens live when a tool performs its own OAuth or signing, since egress substitution is "outbound only" | Managed Agents vaults |
| Who owns the per-agent egress allowlist when a credential and an environment each carry one and both must agree | Managed Agents vaults and environments |
| The split of tool execution from the loop when the container executes `agent_toolset` calls and posts `user.tool_result` | Managed Agents reference |
| Ordering and depth guarantees for messages queued behind a running turn, and whether an interrupt is a distinct stop reason | Managed Agents events-and-streaming; A2A `taskId` and `contextId` |
| Which artifact a stopped session resumes on after its compute was released | AgentCore lifecycle versus sessions pages |
| A reconciliation path for wake events, since webhooks are unordered and dropped after three attempts | Managed Agents webhooks |
| Retention and deletion policy for paused conversations and their working files | Foundry 30-day session deletion; Managed Agents delete; AgentCore session validity |
| How a conversation binds to an end user for credential vending when the platform cannot verify the user id | AgentCore `GetWorkloadAccessTokenForUserId`; Foundry `x-ms-user-identity` custom role |
| What an agent card exposes if A2A is served, given that a generated card can leak the system prompt | kagent issue #2549 |
| Whether initialisation happens before or after a start snapshot, and the environment-variable size ceiling that implies | AgentCore V2: "Restoring from a snapshot changes how you structure your agent code" |
| How a budget pause interacts with a tool call in flight, and which settle events are still accepted | Managed Agents budgets |
| How the transcript store represents content withheld by policy (`{"type": "redacted"}`) | Managed Agents reference |

## Sources

Dates are as shown on the page; "n.d." means none shown. Failed fetches: `managed-agents/events` (404; used `events-and-streaming`), `managed-agents/pricing` (404; used `about-claude/pricing`), kagent.dev docs (HTTP 500 three times; used the GitHub issue and a search summary), `agentgateway.dev/docs/llm/` (404; used the backend-authn page), `kubernetes/api` `types.go` (too large to read; used the API reference page).

Anthropic (all Beta, header `managed-agents-2026-04-01`, n.d.)
- Self-hosted sandboxes, ant CLI 1.33.0: https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes
- Start a session: https://platform.claude.com/docs/en/managed-agents/sessions
- Session operations: https://platform.claude.com/docs/en/managed-agents/session-operations
- Session event stream: https://platform.claude.com/docs/en/managed-agents/events-and-streaming
- Reference (event types, worker flags): https://platform.claude.com/docs/en/managed-agents/reference
- Define your agent: https://platform.claude.com/docs/en/managed-agents/agent-setup
- Authenticate with vaults: https://platform.claude.com/docs/en/managed-agents/vaults
- Session budgets: https://platform.claude.com/docs/en/managed-agents/budgets
- Subscribe to webhooks: https://platform.claude.com/docs/en/managed-agents/webhooks
- Pricing, Claude Managed Agents section: https://platform.claude.com/docs/en/about-claude/pricing

Microsoft Foundry
- Hosted agents concepts, ms.date 2026-09-11, updated 2026-09-14: https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents
- Manage hosted agent sessions, ms.date 2026-08-21, updated 2026-09-21: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/manage-hosted-sessions
- Deploy a hosted agent, ms.date 2026-08-17, updated 2026-09-21: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/deploy-hosted-agent
- Hosted agent permissions reference, ms.date 2026-04-21, updated 2026-09-14: https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agent-permissions
- Foundry Agent Service pricing, n.d.: https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/

Amazon Bedrock AgentCore (developer guide, n.d.)
- Service contract: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-service-contract.html
- HTTP protocol contract: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html
- Isolated sessions: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html
- Lifecycle settings: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html
- Versioning and endpoints: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agent-runtime-versioning.html
- microVMs and platform versions: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html
- Runtime overview: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
- Identity overview, credential providers, workload access token, OAuth token: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-overview.html, identity-outbound-credential-provider.html, get-workload-access-token.html, identity-authentication.html
- Gateway: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
- Pricing: https://aws.amazon.com/bedrock/agentcore/pricing/
- AWS blog, The new AgentCore runtime, 2026-09-18: https://aws.amazon.com/blogs/machine-learning/the-new-agentcore-runtime-elastic-optimized-and-consistently-fast-starts/

Protocols and Kubernetes projects
- A2A specification 1.0, n.d.: https://a2a-protocol.org/latest/specification/
- kagent issue #2549, 2026-08-25: https://github.com/kagent-dev/kagent/issues/2549
- kagent `harness_types.go` and `agenttemplate_types.go` on main: https://github.com/kagent-dev/kagent/tree/main/go/api/v1alpha3
- kagent issue #2244, Deployment generation (search summary only): https://github.com/kagent-dev/kagent/issues/2244

Durable engines
- Temporal Worker Versioning, n.d.: https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning and https://docs.temporal.io/worker-versioning
- Temporal TypeScript, Run a Worker process, n.d.: https://docs.temporal.io/develop/typescript/workers/run-worker-process
- DBOS, Upgrading workflows (TypeScript), n.d.: https://docs.dbos.dev/typescript/tutorials/upgrading-workflows
- DBOS class reference, n.d.: https://docs.dbos.dev/typescript/reference/dbos-class
- Restate, Versioning, n.d.: https://docs.restate.dev/operate/versioning

Identity and egress
- SPIFFE overview and SPIRE concepts, n.d.: https://spiffe.io/docs/latest/spiffe-about/overview/ and https://spiffe.io/docs/latest/spire-about/spire-concepts/
- agentgateway README and backend authentication, n.d.: https://github.com/agentgateway/agentgateway and https://agentgateway.dev/docs/standalone/latest/configuration/security/backend-authn/
- Envoy credential injector and external authorization filters, 1.40.0-dev: https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/credential_injector_filter and ext_authz_filter
- CyberArk Secretless Broker README, n.d.: https://github.com/cyberark/secretless-broker

Build and objects
- Cloud Native Buildpacks, Builder, n.d.: https://buildpacks.io/docs/for-app-developers/concepts/builder/
- kpack README, n.d.: https://github.com/buildpacks-community/kpack
- ko, Kubernetes integration, n.d.: https://ko.build/features/k8s/
- nixpacks, How it works, n.d.: https://nixpacks.com/docs/how-it-works
- Dockerfile reference, n.d.: https://docs.docker.com/reference/dockerfile/
- kustomize images transformer, n.d.: https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/
- Helm, Registries, n.d., "not yet updated for Helm 4": https://helm.sh/docs/topics/registries/
- Kubernetes Operator pattern, Probes, Downward API, Pod v1 API reference, n.d.: https://kubernetes.io/docs/concepts/extend-kubernetes/operator/, https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/, https://kubernetes.io/docs/concepts/workloads/pods/downward-api/, https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/
- KEDA 2.20, Scaling Deployments, n.d.: https://keda.sh/docs/2.20/concepts/scaling-deployments/

Observability
- OpenTelemetry GenAI conventions README, agent spans, metrics, n.d.: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/README.md, gen-ai-agent-spans.md, gen-ai-metrics.md
- OpenTelemetry GenAI page on opentelemetry.io (moved notice), n.d.: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- OpenTelemetry session attributes, n.d.: https://opentelemetry.io/docs/specs/semconv/registry/attributes/session/
- OpenTelemetry blog, Inside the LLM call, n.d.: https://opentelemetry.io/blog/2026/genai-observability/
- Hodge, The state of the OpenTelemetry GenAI semantic conventions, July 2026 (secondary, search summary): https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/
