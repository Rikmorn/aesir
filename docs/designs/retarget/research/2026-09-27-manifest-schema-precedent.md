# Manifest schema precedent

Date: 2026-09-27. Research brief for topic 2, question 3 in `../02-harness.md` ("The manifest schema"), extending `2026-09-16-harness-and-packaging-prior-art.md` §4 "Manifest precedent". Every claim carries a tag: **[V]** verified from a primary source fetched this session (URL in Sources), **[S]** secondary source only, **[I]** inferred. Product names below are the vendors' names, not the platform under design.

**Summary.** Ten products were read from their schema files or API references. No two share a schema, but seven fields recur in almost all of them: name and description, model, instructions, a tools list, MCP server references, skills, and a delegation list. Only kagent gives the runtime its own object: its v1.0.0-alpha1 release (2026-09-18) shipped `Harness` (image plus loop policy), `AgentTemplate` (behaviour) and an `Agent` that pairs them. This corrects the 2026-09-16 research, which had these objects on an unreleased branch with a label-selector attachment; the shipped API dropped the selector for the pairing object. Managed Agents and the OpenAI Agents API separate behaviour from the sandbox environment but keep the loop opaque; Managed Agents adds session (pin, overrides, budget) and deployment (schedule) as further objects. Foundry and AgentCore fuse image, resources, environment variables and idle timeout into one immutable version and carry no behaviour manifest at all. Docker Agent puts everything in one YAML (sixteen top-level keys and thirty hook events at v1.144.0) and separates build from deploy only through `${env.VAR}` substitution and run-time `flavors` patches. Triggers live outside the agent object in every product that has them. Bounds vary most: Docker Agent has the richest (iterations, consecutive calls, shared cost/token/time pots), Managed Agents caps list cost in cents per session, Claude Code has `maxTurns`, the OpenAI SDK defaults `max_turns` to 10, and the hosting platforms bound only idle and lifetime. Nobody has a manifest field for layered guidance; kagent's `promptTemplate.dataSources` (ConfigMap includes) and Docker's `add_prompt_files` are the nearest. Three candidate schemas follow in §5; candidate B (three objects) matches the two products designed for this problem.

## 1. Field references

### 1.1 Docker Agent (was cagent) [V]

Name: "Docker Agent is included in Docker Desktop 4.63 and later. In Docker Desktop versions 4.49 through 4.62, this feature was called cagent." Schema: `agent-schema.json` at the repository root (title "Docker Agent Configuration"; `version` enum `"0"`–`"16"`), generated from `pkg/config/latest/types.go` with `pkg/config/v0`–`v15` for older versions. Release read: v1.144.0, 2026-09-25.

| Level | Fields |
| --- | --- |
| Top level | `version`, `agents` (map, ≥1), `models`, `providers`, `mcps`, `rag`, `commands`, `skills`, `toolsets` (reusable maps), `metadata{author, license, readme, description, version, tags}`, `permissions{allow, ask, deny}`, `runtime{sandbox, network_allowlist, safety}`, `budget{max_cost, max_tokens, max_time}`, `budgets` (named shared pots), `flavors` (JSON-merge-patch overlays applied at run), `evaluators` |
| `agents.<name>` identity and prompt | `description`, `welcome_message`, `instruction` (string or list) or `instruction_file` (local relative paths only; "not OCI/URL sources"), `add_prompt_files`, `add_prompt_files_depth`, `add_date`, `add_environment_info`, `commands`, `use_commands`, `structured_output` |
| model | `model` (`provider/model` or a `models` key), `fallback{models, retries, cooldown}`, `harness{type: claude-code|codex|pi|opencode, model, effort, agent, thinking}` (delegate the loop to an external CLI) |
| tools | `toolsets[]`, `use_toolsets`, `code_mode_tools`, `readonly` (filter to read-only-annotated tools), `add_description_parameter`; per toolset: `type` (27 types in the v1.144.0 schema incl. `mcp`, `mcp_catalog`, `a2a`, `scheduler`, `webhook`, `memory`, `rag`, `shell`, `filesystem`), `tools[]` (include list), `instruction` (`{ORIGINAL_INSTRUCTIONS}` placeholder), `defer` (`true` or tool names; exposes `search_tool`/`add_tool`), `readonly`, `model` (per-toolset model routing), `ref` (`docker:` catalog or `mcps` key), `command`/`args`/`env`/`remote`, `allow_list`/`deny_list` (paths), `allowed_domains`/`blocked_domains`, `allow_private_ips`, `timeout`, `lifecycle{profile, required, startup_timeout, call_timeout, restart, max_restarts, backoff}` |
| delegation | `sub_agents[]`, `handoffs[]` (names, OCI refs, URLs; "pin external OCI references to an immutable digest"), `force_handoff` (deterministic routing; no cycles) |
| bounds | `max_iterations` (resumable with approval), `max_consecutive_tool_calls` (default 5), `budgets[]` (names; "agents sharing a budget name share one pot, so a fan-out cannot multiply the ceiling"), top-level `budget` (run-wide, terminal stop, `budget_exceeded` event) |
| context | `session_compaction` (default true), `compaction_threshold` (0.9), `compaction_model`, `num_history_items`, `max_old_tool_call_tokens`, `max_tool_result_tokens`, `cache{enabled, path}` |
| skills, hooks, safety | `skills` (`true`, `local`, URLs, names, inline `{name, description, instructions, context: fork, allowed_tools, toolsets}`), `use_skills`; `hooks` (30 event keys as of v1.144.0, e.g. `pre_tool_use`, `tool_guard`, `before_llm_call`, `before_compaction`, `subagent_stop`, `on_max_iterations`; hook `type: command|builtin|model|evaluator`, `matcher` regex, `preempt_yolo`); `safety: strict|balanced|restricted|autonomous`; `redact_secrets` (default on) |

`memory` toolset: SQLite at `~/.cagent/memory/<config-name>/memory.db`, shared by all agents in one config unless `path` is set. `scheduler` toolset: `create_schedule` with `in:`/`at:`/`every:` specs; "Schedules only fire while the session is running ... and are not persisted across restarts." `webhook` toolset is outbound only.

### 1.2 kagent v1.0.0-alpha5 (2026-09-27), `go/api/v1alpha3` [V]

CRDs in `helm/kagent-crds/templates` at the tag: `agents`, `agenttemplates`, `harnesses`, `modelconfigs`, `modelproviderconfigs`, `remotemcpservers`, `sandboxtemplates`. No `Memory` or `ToolServer` CRD; memory is a Harness field. Release notes since alpha1 (2026-09-18): "add API v2 configuration CRDs", "AgentTemplate preparation and immutable revisions", "AgentInstance suspend and resume", "auto-suspend AgentInstances and add checkpoints", "fork AgentInstances from checkpoints", "Initial Claude Code Support", "Initial Codex Support", "add BYO A2A harness", "support microvm sandboxes", "add scheduled runs". `AgentInstance` appears in the notes as an imperative lifecycle object ("imperative AgentInstance lifecycle", "use ate-api actor templates") and is not among the CRDs.

| Object | Fields |
| --- | --- |
| `Agent.spec` | exactly one of `template` (inline `AgentTemplateSpec`) or `templateRef`; exactly one of `harness` (inline) or `harnessRef`. Status: `desiredRevision`, `latestSuccessfulRevision`, `warnings[]` ("non-blocking compatibility decisions made while compiling this Agent"), `conditions` |
| `AgentTemplate.spec` ("portable agent behavior") | `modelConfig` ref ("required by managed harnesses and optional for BYO"), `description`, `systemPrompt` or `systemPromptFrom{name, key}` (ConfigMap), `outputSchema` or `outputSchemaFrom`, `promptTemplate.dataSources[]{name, alias}` (Go template, `include("source/key")`), `tools[]` ≤50 each exactly one of `mcp{server: RemoteMCPServer ref, tools[] ≤50, requireApproval}` or `subAgent{name, description, templateRef (Shared: "compiled into the parent's runtime") or agentRef (Dedicated over A2A, "not supported yet")}`, `skills[]` ≤50 `{name, source}`, `plugins[]` ≤20 `{source, skills[]}`. `source` is exactly one of `oci` (`@sha256:` required), `git{url, commit}` (full SHA), `bucket.s3{endpoint, bucket, key, versionId, region}`, plus `path` |
| `Harness.spec` ("a reusable runtime and its infrastructure policy") | exactly one of `kagent{memory{modelConfigRef, ttlDays}, compaction{compactionInterval, overlapSize, tokenThreshold, eventRetentionSize, summarizer{modelConfigRef, promptTemplate}}}`, `codex{}`, `claude{}`, `byo{}` (must set `workload.command`); `workload{image (digest-pinned), command, args}`; `env[]` ≤100 `{name, value or credentialRef (Secret key)}`; `substrate{workerPoolRef, snapshotPolicy{location}}`. `status.capabilities` is controller-written, "not user-authored": `nativeAgentTools`, `maxNativeAgentDepth`, `dedicatedAgentTools`, `mcpInjection`, `streaming`, `interruption`, `inputRequired`, `approvals`, `structuredOutput`, `inputModalities`, `outputModalities`, `resume`, `checkpoint` |
| `SandboxTemplate.spec` | `workload{image (digest)}`, `env[]`, `substrate` ("Creating one does not allocate a user sandbox") |
| `ModelConfig.spec` | `model`, `provider` (default OpenAI; OpenAI, Anthropic, AzureOpenAI, Ollama, Gemini, GeminiVertexAI, AnthropicVertexAI, Bedrock, SAPAICore, Foundry, Mistral blocks), `apiKeySecret`/`apiKeySecretKey` or `apiKeyPassthrough` (forward the inbound A2A bearer), `defaultHeaders`, TLS |

The July 2026 proposal (issue #2366) put `harnesses.include` on the template and `allowedAgentTemplates.selector` on the harness. Neither field exists in v1alpha3; the `Agent` object carries the pairing.

### 1.3 Managed Agents, beta `managed-agents-2026-04-01` [V]

| Object | Fields |
| --- | --- |
| Agent (`POST /v1/agents`) | `name` (≤256, required), `model` (string or `{id, effort: low|medium|high|xhigh|max, speed: standard|fast, inference_geo}`; required), `system` (≤100 000), `description` (≤2048), `tools[]` (≤128 tools): `agent_toolset_20260401{default_config{enabled, permission_policy}, configs[]{name: bash|edit|read|write|glob|grep|web_fetch|web_search, enabled, permission_policy: always_allow|always_ask|auto; web_fetch/web_search add allowed_domains or blocked_domains ≤64, max_content_tokens, user_location}}`, `mcp_toolset{mcp_server_name, default_config, configs[]{name, enabled, permission_policy}}`, `custom{name, description, input_schema}` (client-executed; session idles on call); `mcp_servers[]` ≤20 `{type: url, name, url}` ("every server must be referenced by an mcp_toolset"); `skills[]` `{type: anthropic|custom, skill_id, version}`; `multiagent{type: coordinator, agents[] 1–20 of id, {type: agent, id, version}, {type: self}, {type: advisor, model}}`; `metadata` ≤16 pairs. Response adds `id`, `version` (int from 1, increments on change), `created_at`, `updated_at`, `archived_at` |
| Session | `agent`: id string (latest), `{type: agent, id, version}` (pinned) or `{type: agent_with_overrides, id, version?, model, system, tools, mcp_servers, skills}` (full replacement, never merged); `environment_id`; `initial_events` ≤50; `budget{type: limit, max_list_cost{amount: cents as string, currency: USD}}` (stop reason `budget_reached`); `vault_ids[]`. The deployments page lists memory stores, files and GitHub repositories as deployment-level attachments; the 2026-09-16 research places memory stores at session level too |
| Environment (unversioned) | `name`, `config{type: cloud|self_hosted, packages{apt, cargo, gem, go, npm, pip}, networking{type: unrestricted|limited, allowed_hosts, allow_mcp_servers, allow_package_managers}}` |
| Deployment (schedule) | `name`, `agent`, `environment_id`, `initial_events` (≥1), `schedule{type: cron, expression, timezone}`, `budget` (copied per run); pause, unpause, archive; run records with `error.type` |
| Webhook endpoint (workspace) | URL (HTTPS 443), event types, `whsec_` secret; three attempts, unordered, dropped after the third |

Delegation bounds: "The coordinator can only delegate to one level of agents"; ≤20 unique roster agents; "A maximum of 25 concurrent threads is supported"; roster versions are snapshotted when the coordinator is saved. `ant apply agent.md` takes YAML frontmatter plus a body that becomes `system`, and records ids in `claude-lock.json`.

### 1.4 Claude Code subagent frontmatter (page cites v2.1.281) and agent teams [V]

Keys: `name`, `description` (required); `tools`, `disallowedTools`, `model` (alias, id or `inherit`), `permissionMode` (`default|acceptEdits|auto|dontAsk|bypassPermissions|plan|manual`), `maxTurns` (partial output, resumable), `skills` (preloaded in full), `mcpServers` (names or inline configs), `hooks`, `memory` (`user|project|local`, directories under `agent-memory/<name>/`), `background`, `omitClaudeMd`, `effort`, `isolation: worktree`, `color`, `initialPrompt`, `experimental.cacheTtl`. The markdown body is the system prompt. Scope precedence: managed settings, `--agents` JSON, `.claude/agents/`, `~/.claude/agents/`, plugin. Agent teams: opt in with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; `teammateMode: in-process|auto|tmux|iterm2`; "One team per session"; "No nested teams"; teammates start with the lead's permission mode and cannot be given one at spawn; a teammate spawned from a subagent definition takes its `tools`, `model` and body but not `skills`; hooks `TeammateIdle`, `TaskCreated`, `TaskCompleted`; `~/.claude/teams/{name}/config.json` is runtime state, "don't ... pre-author it".

### 1.5 OpenAI: SDK `Agent` (code) and Agents API (hosted config) [V unless marked]

| Surface | Fields |
| --- | --- |
| Agents SDK `Agent` dataclass (code) | `name`, `instructions` (string or callable), `prompt`, `handoff_description`, `handoffs[]`, `model`, `model_settings` (`temperature`, `max_tokens`, `tool_choice`, `parallel_tool_calls`, `truncation`, `reasoning`, `context_management`, `timeout`, `retry`, ...), `tools[]`, `mcp_servers[]`, `mcp_config{convert_schemas_to_strict, failure_error_function, include_server_in_tool_names}`, `input_guardrails`, `output_guardrails`, `output_type`, `hooks`, `tool_use_behavior`, `reset_tool_choice`. `Runner.run(max_turns=DEFAULT_MAX_TURNS)`; `DEFAULT_MAX_TURNS = 10` (`src/agents/run_config.py:45`); `RunConfig` adds `sandbox`, `tool_execution`, `nest_handoff_history` |
| Agents API (hosted config; header `OpenAI-Beta: agents=v1`; `POST /v1/agents/sessions`) | `agent{model, instructions, tools[]: programmatic_tool_calling, mcp{server_label, transport}, web_search; multi_agent{enabled, max_concurrent_subagents (default 6)}}`; `environment{type: openai_hosted|self_hosted}`: self-hosted adds `workspace_directory`, `capability_directories` (≤32 absolute paths searched for `SKILL.md`); OpenAI-hosted adds `packages`, `setup_commands`, `files`, `env`, `network.access: enabled|disabled|restricted` with `allowed_domains` (1–100 exact hosts), `environment_template_id`. Self-hosted executor: `codex exec-server --remote <url> --environment-id <id>` over an outbound WebSocket. "Subagents inherit configured MCP tools, their credentials and allowed tools" and share one filesystem. US-only, no ZDR. Agents can also be saved and reused by id with versions **[S]** (guide pages fetched show only the inline form) |
| Responses API `prompt{id, version, variables}` | Deprecated: "Prompt creation will be de-emphasized beginning June 3, 2026, and `v1/prompts` is scheduled to shut down on November 30, 2026" |
| Agent Builder (hosted graph) | Agent node: instructions, tools, model configuration, output format, evals; node types Start, Agent, Note, File search, Guardrails, MCP, If/else, While, Human approval, Transform, Set state. "scheduled to shut down on November 30, 2026" |

### 1.6 Microsoft Foundry hosted agents and AWS AgentCore Runtime [V]

Foundry `azure.yaml` (reference `ms.date` 2026-09-17), `azure.ai.agent` service: `host`, `kind: hosted|prompt|voice`, `name` ("Reusing a name creates a new version"), `displayName`, `description`, `project`, `language: docker`, `uses[]` (dependency graph), `protocols[]{protocol: responses|invocations|invocations_ws|a2a|activity, version}`, `env` (`${VAR}` resolved by azd at deploy; `${{connections.<name>.credentials.<field>}}` resolved by the platform at sandbox start), `container.resources{cpu "0.25"–"4.0", memory 0.5Gi–8.0Gi}`, `startupCommand`, `toolboxes[]`, `codeConfiguration{runtime, entryPoint, dependencyResolution}`, `image` (prebuilt), `metadata`, `agentCard{description, version, skills[]{id, name, description, tags, examples}}`, `agentEndpoint{protocols, authorizationSchemes[{type: Entra|BotServiceRbac}], versionSelector.versionSelectionRules}`, `policies[{type: rai_policy, raiPolicyName}]`, `memoryStores[]{name, chatModel, embeddingModel, options{...}}`, `sessionConfiguration.idleTimeoutSeconds`. Sibling services: `azure.ai.project` (model `deployments`, `network`), `azure.ai.connection{category, target, authType, credentials}`, `azure.ai.toolbox{tools[]{type, connection}}`, `azure.ai.skill{instructions}`, `azure.ai.routine` ("a trigger (schedule or event) and an action that invokes an agent"). REST `HostedAgentDefinition`: `kind`, `container_configuration.image`, `cpu`, `memory`, `protocol_versions[]`, `environment_variables`, `session_configuration.idle_timeout_seconds` (120–3600, default 900), `rai_config`. "Each call to create a version produces an immutable agent version"; an endpoint "routes 100% of its traffic to that version" (`FixedRatio` rule); a session may pin `version_indicator{type: version_ref, agent_version}`; draft versions never receive traffic. Platform-injected env: `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME`, `FOUNDRY_AGENT_VERSION`, `FOUNDRY_AGENT_SESSION_ID`, `APPLICATIONINSIGHTS_CONNECTION_STRING`.

AgentCore `CreateAgentRuntime`: `agentRuntimeName`*, `agentRuntimeArtifact`* (union `containerConfiguration{containerUri}` (ECR) or `codeConfiguration{code (S3), entryPoint[1–2], runtime: PYTHON_3_10..3_14|NODE_22}`), `roleArn`*, `networkConfiguration{networkMode: PUBLIC|VPC, networkModeConfig{subnets, securityGroups, requireServiceS3Endpoint}}`, `protocolConfiguration{serverProtocol: MCP|HTTP|A2A|AGUI}`, `authorizerConfiguration{customJWTAuthorizer{discoveryUrl, allowedAudience, allowedClients, allowedScopes, customClaims, allowedWorkloadConfiguration, ...}}`, `environmentVariables` ≤50, `lifecycleConfiguration{idleRuntimeSessionTimeout (60–1 209 600 s, default 900), maxLifetime (default 28 800)}`, `requestHeaderConfiguration.requestHeaderAllowlist` ≤20, `filesystemConfigurations[]` ≤5 (`sessionStorage`, `efsAccessPoint`, `s3FilesAccessPoint`, `capacityProviderVolume`), `capacityProviderConfiguration`, `platformVersion`, `description`, `clientToken`, `tags`. Response: `agentRuntimeArn`, `agentRuntimeId`, `agentRuntimeVersion`, `status`, `workloadIdentityDetails`. "Versions are immutable once created"; `DEFAULT` endpoint follows latest, named endpoints pin. AgentCore CLI `agentcore.json` (the starter toolkit is legacy): `runtimes[]` `AgentEnvSpec{name, build: CodeZip|Container, entrypoint, codeLocation, runtimeVersion, networkMode, networkConfig, protocol, envVars, instrumentation.enableOtel, authorizerType: AWS_IAM|CUSTOM_JWT, authorizerConfiguration, requestHeaderAllowlist, lifecycleConfiguration, executionRoleArn, tags, buildContextPath, customDockerBuildArgs}` beside top-level `memories`, `credentials`, `evaluators`, `onlineEvalConfigs`, `agentCoreGateways`, `policyEngines`, `mcpRuntimeTools`.

### 1.7 Google ADK Agent Config, Letta `.af`, A2A Agent Card [V]

ADK (`src/google/adk/agents/config_schemas/AgentConfig.json`; docs say "experimental", Gemini models only, Python and Java): top level is one of `LlmAgentConfig`, `LoopAgentConfig`, `ParallelAgentConfig`, `SequentialAgentConfig`, `BaseAgentConfig`. `LlmAgentConfig`: `agent_class`, `name`*, `description`, `sub_agents[]{config_path or code}`, `before_agent_callbacks`/`after_agent_callbacks[]{name}` (fully qualified Python names; "YAML cannot pass constructor args"), `model` or `model_code{name}`, `instruction`*, `static_instruction`, `disallow_transfer_to_parent`, `disallow_transfer_to_peers`, `input_schema`, `output_schema`, `output_key`, `include_contents`, `tools[]{name, args}` (built-in name or fully qualified path), `before_model_callbacks`, `after_model_callbacks`, `before_tool_callbacks`, `after_tool_callbacks`, `generate_content_config`. `LoopAgentConfig` adds `max_iterations`.

Letta `.af` (V1 schema, `letta/schemas/agent_file.py` on the `archive` branch; the `letta` repository README says "The current source code lives in `letta-ai/letta-code`" and the `agent-file` README still links the retired `main` path): `AgentFileSchema{agents[], groups[], blocks[], files[], sources[], tools[], mcp_servers[], skills[], metadata, created_at}`. `AgentSchema` = `CreateAgent` (name, system, llm and embedding config, tool rules, environment variables) plus `id`, `in_context_message_ids`, `messages[]`, `files_agents[]`, `group_ids`, `tool_ids`, `source_ids`, `folder_ids`, `block_ids`, `identity_ids`. `GroupSchema{agent_ids, shared_block_ids, manager_config}` where the manager is round-robin, `supervisor`, `dynamic{termination_token, max_turns}`, `sleeptime{sleeptime_agent_frequency}` or `voice_sleeptime`. `ToolSchema` carries source code and JSON schema; `SkillSchema{name, files, source_url}`; `MCPServerSchema{server_type, server_name, server_url, stdio_config}`. "When you export agents with secrets, the secrets are set to `null`." The file is a runtime snapshot (it carries messages), not a build input.

A2A `AgentCard` 1.0 (`specification/a2a.proto` is normative): `name`*, `description`*, `supported_interfaces[]`*`{url*, protocol_binding* (JSONRPC, GRPC, HTTP+JSON), tenant, protocol_version*}`, `provider{url*, organization*}`, `version`*, `documentation_url`, `capabilities`*`{streaming, push_notifications, extensions[]{uri, description, required, params}, extended_agent_card}`, `security_schemes` (map; api key, HTTP, OAuth2, OIDC, mTLS), `security_requirements[]`, `default_input_modes`*, `default_output_modes`*, `skills[]`*`{id*, name*, description*, tags*, examples, input_modes, output_modes, security_requirements}`, `signatures[]{protected, signature, header}`, `icon_url`. "Skills ... is largely a descriptive concept."

## 2. Build-time, deploy-time, or platform-fulfilled

| Product | Baked into an artefact | Bound at deploy or session start | Declared, fulfilled by shared infrastructure | Distinguishes them? |
| --- | --- | --- | --- | --- |
| Docker Agent [V] | The whole YAML, pushed as one OCI artefact; `instruction_file` and prompt files resolved at load | `${env.VAR}` in models, MCP headers and webhooks; `flavors` patches; `runtime.*` are defaults the CLI overrides | None declared; MCP catalog servers run through the gateway; `memory` is a local SQLite path | No object boundary; only the `${env}` and `flavors` mechanisms |
| kagent [V] | `Harness.workload.image` and every `ArtifactSource` (digest, commit or object version); `AgentTemplate` compiles to an immutable revision | `Harness.env[].credentialRef`, `substrate.workerPoolRef`, `snapshotPolicy`; `Agent` chooses the pairing | `Harness.kagent.memory` (embedding `ModelConfig`), `compaction`, `RemoteMCPServer` refs, `ModelConfig` secrets | Yes, by object; `status.capabilities` reports what the runtime can honour |
| Managed Agents [V] | Nothing is an image; the agent is a versioned record | Session: `agent` pin or overrides, `environment_id`, `budget`, `vault_ids`, memory stores; deployment: `schedule` | Environment `networking`, `packages`; vaults; memory stores; webhooks at workspace level | Yes: agent / environment / session / deployment |
| Claude Code [V] | The `.md` file in the repository or user directory | `mcpServers` names resolve against settings at launch; `memory` scope chosen, storage created by the CLI | Settings hierarchy, managed policy files | No; a single-user tool. Teams config is runtime state |
| OpenAI [V] | SDK: everything is code. API: nothing is an image | API: `agent` and `environment` per session; `capability_directories` must already exist in the sandbox | Hosted sandbox `packages`, `network`, `environment_template_id`; self-hosted executor registration | Agent versus environment, both per session |
| Foundry [V] | The container image | The version fuses image, `cpu`, `memory`, `environment_variables`, `protocol_versions`, `idle_timeout_seconds`; a change is a new immutable version; `${{connections...}}` resolve at sandbox start | `connection`, `toolbox`, `skill`, `routine`, `memoryStores`, agent identity, endpoint | Partially: deploy values are frozen into the artefact's version |
| AgentCore [V] | `containerUri` or S3 code | Version fuses artefact, network, protocol, auth, env, lifecycle; endpoints pin versions | `memories`, `credentials`, `agentCoreGateways`, `policyEngines` in `agentcore.json` | Same fusion as Foundry |
| ADK [V] | YAML loaded with the code | None | None | No deploy notion |
| Letta `.af` [V] | A runtime snapshot including messages | Secrets re-bound on import | Tools carry source; MCP servers by URL | Neither build nor deploy |
| A2A card [V] | Served at runtime | `url` and `security_schemes` are deployment facts | None | The published half only |

## 3. How each expresses the eleven concerns

| Concern | Docker Agent | kagent | Managed Agents | Claude Code | OpenAI (SDK / API) |
| --- | --- | --- | --- | --- | --- |
| Tool availability | Static `toolsets`, `tools[]` include list, `readonly`, `defer` + `search_tool`, per-toolset model, `allow_list`/`deny_list` paths | `tools[]` bindings; `mcp.tools[]` subset ("harnesses that cannot enforce a partial selection may expose the whole server and report a warning") | Toolset with per-tool `enabled`; `mcp_toolset` per server; `custom` client-executed | `tools`, `disallowedTools` (deny removes whole tool); `skills` preloaded | SDK `tools`, `mcp_servers`, `tool_use_behavior`; API tool types, subagents inherit MCP |
| Triggers | `scheduler` toolset, in-session only; `webhook` outbound | `scheduledrun` API package; A2A inbound | Deployment `schedule` (cron, tz); webhooks are outbound notifications | None | None in the agent; sessions are driven by input |
| Delegation and bounds | `sub_agents`, `handoffs`, `force_handoff`; no depth field; shared budget pots bound fan-out cost | `subAgent` binding, Shared or Dedicated; `maxNativeAgentDepth` reported by the controller | Roster 1–20, depth 1, 25 concurrent threads, `self`, `advisor` | `Agent` tool; teams: no nesting, one team per session | SDK `handoffs`; API `max_concurrent_subagents` (6) |
| Bounds | `max_iterations`, `max_consecutive_tool_calls`, `budget{max_cost, max_tokens, max_time}` | None in spec | Session `budget.max_list_cost` (cents string), `budget_reached` | `maxTurns` | `max_turns` (10), `ModelSettings.timeout`, `max_tokens` |
| Version policy | `metadata.version`, OCI tag or digest; digest advised for sub-agents | Immutable revisions; digest-pinned images and artefacts | Integer `version`, optimistic concurrency, session pin, roster snapshot | Git | API: versions **[S]**; SDK: code |
| Published card | `a2a` toolset consumes cards; `metadata` for the registry | A2A gateway (release notes) | None | None | None |
| Memory and context | `memory` toolset path; `session_compaction`, thresholds, models, tool-result caps | `Harness.kagent.memory`, `compaction` (interval or token threshold) | Memory stores at session; server-side compaction, no knobs | `memory: user|project|local`; auto memory | SDK `context_management`, `nest_handoff_history`; API server-side |
| Guidance and skills | `instruction_file`, `add_prompt_files` (+depth), `skills`, inline skills | `systemPromptFrom`, `promptTemplate.dataSources` includes, `skills`, `plugins` | `system`, `skills{id, version}` | body, `skills`, `omitClaudeMd`; CLAUDE.md tiers are runtime | `instructions`; API `capability_directories` |
| Hooks | 30 events, four hook types | None | None | `hooks` in frontmatter; team hooks | SDK `hooks`, guardrails; API none |
| Permissions | `permissions{allow, ask, deny}` with argument patterns; `safety` modes | `requireApproval` per binding | `permission_policy` per tool: `always_allow|always_ask|auto` | `permissionMode` | SDK guardrails; API none exposed |
| Sandbox | `runtime{sandbox, network_allowlist}` | `Harness.workload`, `substrate`, `SandboxTemplate` | Environment `networking`, `packages`; self-hosted worker | Client sandbox settings | `environment` per session |

| Concern | Foundry | AgentCore | ADK | Letta `.af` | A2A card |
| --- | --- | --- | --- | --- | --- |
| Tool availability | `toolboxes[]` by name; toolbox is one MCP endpoint | Gateways as separate resources | `tools[]{name, args}` | `tools[]` with source and schema, `tool_rules` | `skills[]` are descriptive |
| Triggers | `azure.ai.routine` (schedule or event → agent) | None | None | None | None |
| Delegation | `a2a` protocol; `conversationEngine` for voice wrappers | A2A protocol | `sub_agents`, `disallow_transfer_to_parent/peers` | `groups` with manager types, `dynamic.max_turns` | None |
| Bounds | `idle_timeout_seconds` 120–3600; `cpu`, `memory` | `idleRuntimeSessionTimeout`, `maxLifetime` | `LoopAgent.max_iterations` | `max_turns` on dynamic manager | None |
| Version policy | Immutable versions, drafts, `versionSelector` 100% to one, session `version_indicator` | Immutable versions, `DEFAULT` and named endpoints | Git | `metadata`, `created_at` | `version` string, `signatures` |
| Published card | `agentCard` in `azure.yaml` | None | None | None | Is the card |
| Memory and context | `memoryStores` (not attached automatically); `$HOME` per session; state store | `memories`; `sessionStorage` filesystem | None | `blocks`, `in_context_message_ids` | None |
| Guidance and skills | `azure.ai.skill`; code | Code | `instruction`, `static_instruction` | `system`, `skills` | None |
| Hooks | None | None | six callback lists | None | None |
| Permissions | Entra identity, RBAC, `authorizationSchemes`, `rai_policy` | IAM role, JWT authorizer | None | Approval fields on messages | `security_schemes` |
| Sandbox | `image`, `cpu`, `memory`, VNet | `containerUri`, `networkMode`, `filesystemConfigurations` | None | None | None |

## 4. The settled core and the singletons

Recurring across seven or more of the ten [V]: `name` and `description` (all ten); `model` (seven; absent where the model is in code: Foundry, AgentCore, A2A); instructions or system prompt (seven); a tools list (eight, counting Foundry's `toolboxes`); MCP server references (eight, counting Foundry connections and ADK's `McpServer` def); skills (seven); a delegation list (seven: `sub_agents`, `subAgent`, `multiagent`, `Agent` tool, `handoffs`, `sub_agents`, `groups`); a version field (all ten, in three unrelated senses: server-incremented integer, artefact digest, free string); a permission or approval knob (six); a declared memory store or scope (seven, in three unrelated shapes). Hooks appear in four (Docker, Claude Code, ADK callbacks, OpenAI SDK). Context-management knobs appear in four (Docker, kagent Harness, OpenAI SDK, Letta). Triggers appear in four, as a sibling object (Managed Agents deployments, Foundry routines, kagent scheduled runs) or as a tool the agent calls (Docker scheduler), never as a field of the agent.

Singletons worth stealing or avoiding [V]: Docker `flavors` (run-time overlays), `force_handoff`, `redact_secrets`, `defer` with `search_tool`, shared budget pots, `add_prompt_files_depth`; kagent `promptTemplate.dataSources`, `outputSchema`, controller-written `status.capabilities`, `substrate.snapshotPolicy`; Managed Agents `inference_geo`, `advisor`, `agent_with_overrides`, cents-as-string budget; Claude Code `isolation: worktree`, `omitClaudeMd`, `experimental.cacheTtl`; OpenAI `max_concurrent_subagents`, `capability_directories`; Foundry `agentCard` inside the deployment file, `versionSelector`, `${{connections...}}` resolved at sandbox start; AgentCore `requestHeaderAllowlist`, `platformVersion`; ADK `disallow_transfer_to_*`, `output_key`; Letta messages inside the manifest; A2A `tenant`, `signatures`.

## 5. Candidate manifests for a container-packaged agent

Each skeleton names the precedent per field. "Declare" means the field is a reference the platform resolves; "provide" means the value is baked or bound.

### Candidate A: one document (Docker Agent shape)

```yaml
version: "1"                                   # Docker `version`: schema-versioned file
metadata: {name: triage, description: "...", version: 1.4.0, tags: [eng]}   # Docker metadata; A2A name/description/version
harness: {image: ghcr.io/org/harness@sha256:...}    # kagent HarnessWorkload.image; Docker's `harness` delegates to an external CLI instead
model: {ref: anthropic/claude-sonnet-5, effort: high, fallback: [anthropic/claude-haiku-4-5]}  # Docker model+fallback; MA model{id,effort}
instruction_file: prompt.md                    # Docker instruction_file; MA `ant apply` body
add_prompt_files: [AGENTS.md]                  # Docker: the only layering field in any manifest
toolsets:                                      # Docker toolsets: type, tools, readonly, defer
  - {type: mcp, ref: mcps.linear, tools: [get_issue, save_issue], defer: true}
  - {type: builtin, name: codebase, readonly: false}
mcps: {linear: {remote: {url: "${env.LINEAR_MCP_URL}"}, headers: {Authorization: "Bearer ${secret.linear}"}}}  # Docker mcps; ${env} is the deploy seam
skills: [local, ./skills/triage]               # Docker skills; MA skills{id,version}
sub_agents: [researcher@sha256:...]            # Docker sub_agents by digest; MA roster pins version
limits: {max_iterations: 40, max_consecutive_tool_calls: 5, budget: {max_cost: 2.00, max_tokens: 400000, max_time: 30m}}  # Docker
context: {session_compaction: true, compaction_threshold: 0.8, compaction_model: haiku, max_tool_result_tokens: 4000}  # Docker only
memory: {type: store, ref: team-memory}        # declared; Docker uses a SQLite path, kagent puts memory on the Harness
hooks: {pre_tool_use: [...], before_compaction: [...]}   # Docker 30 events; Claude Code hooks
permissions: {allow: [read_*], ask: ["shell:cmd=git push*"], deny: ["shell:cmd=rm -rf*"]}  # Docker; MA permission_policy
triggers:                                      # no precedent inside an agent object; MA deployments and Foundry routines are siblings
  - {schedule: {expression: "0 9 * * 1-5", timezone: Europe/Lisbon}, message: "Triage the inbox"}
  - {event: linear.issue.created, filter: {team: ENG}}
runtime: {sandbox: true, network_allowlist: [api.linear.app], idle_timeout: 15m}   # Docker runtime; Foundry idle 2–60 min
flavors: {prod: {limits: {budget: {max_cost: 10.00}}}}   # Docker flavors: JSON merge patch chosen at run
```

Declare versus provide: `${env.*}` and `${secret.*}` are provided at deploy; `memory.ref` and `triggers` are declarations the build turns into objects; everything else is baked. There is no boundary between runtime policy and behaviour, so a harness change rebuilds every agent.

### Candidate B: three objects (kagent v1alpha3 shape; Managed Agents agent / environment / session)

```yaml
kind: Harness                                  # kagent HarnessSpec; MA environment
metadata: {name: std-2026-09}
spec:
  workload: {image: ghcr.io/org/harness@sha256:..., command: [harness, poll]}   # kagent HarnessWorkload
  loop: {compaction: {tokenThreshold: 120000, eventRetentionSize: 20, summarizer: {modelRef: haiku}}}  # kagent compaction; Docker compaction_*
  memory: {backend: team-memory, ttlDays: 90}  # kagent Harness.kagent.memory: runtime policy, not behaviour
  hooks: {...}                                 # baseline hooks (Docker hooks.d, Claude Code managed settings)
  substrate: {workerPoolRef: default, snapshotPolicy: {location: s3://...}}   # kagent RuntimeSubstratePolicy
  egress: {allowedHosts: [api.anthropic.com], gateway: egress-gw}   # MA networking.limited; Docker network_allowlist
  env: [{name: MODEL_KEY, credentialRef: {name: model, key: key}}]  # kagent RuntimeEnvVar: value or credentialRef
# status.capabilities is controller-written (kagent): approvals, structuredOutput, maxNativeAgentDepth, resume, checkpoint
---
kind: AgentTemplate                            # kagent AgentTemplateSpec; MA agent; Claude Code frontmatter
metadata: {name: triage}
spec:
  modelConfig: {ref: sonnet-5, effort: high}   # kagent ModelConfig ref; MA model{id,effort}
  description: "..."
  systemPromptFrom: {configMap: triage-prompt, key: prompt.md}   # kagent; MA frontmatter body
  promptTemplate: {dataSources: [{name: org-guidance}]}          # kagent include("org-guidance/rules.md"): the guidance-layer seam
  tools:                                                          # kagent ToolBinding: exactly one of mcp | subAgent
    - mcp: {server: linear, tools: [get_issue, save_issue], requireApproval: false}
    - subAgent: {name: researcher, description: "...", templateRef: researcher}   # Shared (compiled in) or Dedicated (A2A)
  skills: [{name: triage, source: {oci: ghcr.io/org/skills@sha256:..., path: triage}}]   # kagent ArtifactSource: oci | git | bucket
  outputSchema: {...}                          # kagent; Docker structured_output
  bounds: {maxTurns: 40, budget: {maxListCost: "200", currency: USD}, maxDepth: 1}   # Claude Code maxTurns; MA cents string; MA depth 1
  permissions: {default: always_allow, tools: {bash: auto}}   # MA permission_policy
---
kind: Agent                                    # kagent AgentSpec pairs template and harness; MA session + deployment add bindings
metadata: {name: triage-prod}
spec:
  templateRef: {name: triage}
  harnessRef: {name: std-2026-09}
  overrides: {model: {effort: medium}}         # MA agent_with_overrides (full replacement, never merged)
  versionPolicy: pinned                        # MA session pin; Foundry version_indicator; alternative: auto-upgrade
  triggers: [{schedule: {expression: "0 9 * * 1-5", timezone: Europe/Lisbon}, message: "..."}, {event: linear.issue.created}]  # MA deployment; Foundry routine
  scaling: {min: 0, max: 4, idle: 15m}         # KEDA; Foundry idle 2–60 min; AgentCore idleRuntimeSessionTimeout
  card: {publish: true}                        # A2A AgentCard; Foundry agentCard
```

Declare versus provide: the Harness provides the image and runtime policy; the AgentTemplate declares behaviour against references (`modelConfig`, `server`, `templateRef`, `dataSources`) that the cluster resolves; the Agent binds the two and adds deploy-time facts. kagent's `warnings[]` and `status.capabilities` show where template-to-harness compatibility gets reported.

### Candidate C: services graph with a referenced definition (Foundry `azure.yaml` shape)

```yaml
name: eng-agents
services:
  model-anthropic: {host: model, provider: anthropic, baseUrl: "...", credential: "${secret.anthropic}"}   # Foundry project deployments + connection
  linear-conn: {host: connection, category: RemoteTool, target: https://mcp.linear.app, authType: OAuth2, credentials: {token: "${LINEAR_TOKEN}"}}  # Foundry azure.ai.connection
  dev-tools: {host: toolbox, uses: [linear-conn], tools: [{type: mcp, connection: linear-conn}, {type: codebase}]}   # Foundry azure.ai.toolbox
  team-memory: {host: memory-store, ttlSeconds: 0}   # Foundry memoryStores; MA memory stores
  triage:
    host: agent
    uses: [model-anthropic, dev-tools, team-memory]   # Foundry `uses`: the dependency graph
    image: ghcr.io/org/harness@sha256:...             # Foundry `image` (prebuilt) or `project:` + Dockerfile
    definition: {$ref: ./agents/triage.md}           # MA `ant apply` markdown: frontmatter (model, tools, skills, multiagent) + body
    protocols: [{protocol: a2a, version: "1.0"}]      # Foundry protocols; AgentCore serverProtocol
    env: {LINEAR_MCP: "${{connections.linear-conn.target}}"}   # Foundry: resolved at sandbox start, never echoed back
    container: {resources: {cpu: "1", memory: 2Gi}}   # Foundry; AgentCore has no sizing
    sessionConfiguration: {idleTimeoutSeconds: 900}   # Foundry; AgentCore lifecycleConfiguration
    agentEndpoint: {versionSelector: {rules: [{version: "7", traffic: 100}]}}   # Foundry: one version at a time
    agentCard: {description: "...", skills: [{id: triage, name: Triage, description: "..."}]}   # Foundry agentCard → A2A
  nightly-triage: {host: routine, trigger: {schedule: "0 9 * * 1-5"}, action: {agent: triage, message: "..."}}   # Foundry routine; MA deployment
```

Declare versus provide: every sibling service is a declaration the platform fulfils, wired by `uses`; the agent entry provides image, resources and protocols; behaviour is a leaf file. Foundry freezes `env` and idle timeout into the immutable version, so a configuration change is a new version.

### What a build emits from each

| Cluster object | A: one document | B: three objects | C: services graph |
| --- | --- | --- | --- |
| Image | Per agent: `FROM harness@digest` plus `COPY agent/` | Per Harness only; templates become ConfigMaps or an OCI artefact mounted at start | Per agent when `project:` has a Dockerfile; none when `image:` is prebuilt |
| Deployment or pool label | Per agent, replicas from `runtime` | Per Agent; `harnessRef` selects the pool, `templateRef` the mounted revision | Per agent service |
| Service | Only if a push protocol is declared (none by default) | Only if `card.publish` or a push protocol | Always: Foundry gives every agent an endpoint |
| ScaledObject | From `runtime.idle_timeout` and the store queue | From `scaling` | From `sessionConfiguration` |
| CronJob | Per `triggers[].schedule` | Per `Agent.triggers[].schedule` | Per `routine` service |
| NetworkPolicy | From `runtime.network_allowlist` plus MCP hosts | From `Harness.egress` plus template MCP hosts | From connections' `target` hosts |
| Secret references | `${secret.*}` → ExternalSecret | `credentialRef` → ExternalSecret | connection `credentials` → ExternalSecret |
| Registry card | From `metadata` | From `card` plus template `description` and skills | From `agentCard` |

### Tradeoffs

| Question | A | B | C |
| --- | --- | --- | --- |
| Files per agent | One | Three, two of them shared | One graph, one referenced definition |
| Harness upgrade rebuilds | Every agent image | The Harness image only; Agents re-pair | Every agent with a Dockerfile |
| Prompt edit rebuilds | The agent image | A template revision (ConfigMap or artefact), no image | The definition file; a new version |
| Who checks harness–behaviour fit | Nobody; runtime errors | A controller writes `status.capabilities` and `warnings` (kagent) | The platform validates protocols at deploy (Foundry) |
| Version pin granularity | One artefact digest | Harness digest and template revision independently, per Agent | One immutable version per agent, 100% traffic |
| Where secrets bind | `${secret}` at load | `credentialRef` on Harness and Agent | connection services, resolved at sandbox start |
| Closest shipping precedent | Docker Agent (the only single-file manifest covering the whole list) | kagent v1alpha3; Managed Agents | Foundry azure.yaml; Managed Agents `ant apply` files |
| Cost to start | Lowest: one parser, one build | Highest: three schemas and a reference resolver; a controller later | Medium: a graph resolver and per-host handlers |

## Sources (all read 2026-09-27)

1. Docker Agent docs, https://docs.docker.com/ai/cagent/ (naming note, Docker Desktop 4.63)
2. Docker Agent schema, https://raw.githubusercontent.com/docker/docker-agent/main/agent-schema.json; `pkg/config/latest/types.go`; release v1.144.0 (2026-09-25) via GitHub API
3. Docker Agent configuration docs (`docs/configuration/{agents,tools,hooks,budget,permissions,sandbox}/index.md`) and tool docs (`docs/tools/{scheduler,webhook,memory,a2a}/index.md`), github.com/docker/docker-agent main
4. kagent `go/api/v1alpha3/{agent,agenttemplate,harness,runtime,sandboxtemplate,modelconfig}_types.go` and `helm/kagent-crds/templates` at tag v1.0.0-alpha5; releases page (v1.0.0-alpha1 2026-09-18 to alpha5 2026-09-27), github.com/kagent-dev/kagent
5. kagent issue #2366, "Proposal: split agent configuration into Harness and AgentTemplate CRDs" (2026-07-30). The docs page kagent.dev/docs/kagent/examples/agent-harness/ returned HTTP 500 twice and was not read
6. Managed Agents: platform.claude.com/docs/en/managed-agents/agent-setup; /api/beta/agents/create; /managed-agents/sessions; /multiagent-orchestration; /environments; /scheduled-deployments; /webhooks (beta header `managed-agents-2026-04-01`)
7. Claude Code: code.claude.com/docs/en/sub-agents (cites v2.1.281); code.claude.com/docs/en/agent-teams
8. OpenAI Agents SDK: openai.github.io/openai-agents-python/ref/agent/, /ref/model_settings/, /ref/run/, /running_agents/; `src/agents/run_config.py` line 45 (`DEFAULT_MAX_TURNS = 10`), github.com/openai/openai-agents-python main
9. OpenAI Agents API: developers.openai.com/api/docs/guides/agents-api/overview (and `.md`), /quickstart, /multi-agent, /architecture, /environments/self-hosted, /environments/openai-hosted; developers.openai.com/api/docs/guides/tools-skills; the stored-agent claim is from search summaries of developers.openai.com/api/docs/guides/agents only [S]
10. OpenAI deprecations: developers.openai.com/api/docs/guides/prompting (reusable prompts); developers.openai.com/api/docs/guides/node-reference (Agent Builder shutdown 2026-11-30)
11. Microsoft Foundry: learn.microsoft.com/en-us/azure/foundry/agents/concepts/azure-yaml-reference (ms.date 2026-09-17); /concepts/hosted-agents (2026-09-11); /how-to/author-azure-yaml (2026-07-01); /how-to/manage-hosted-agent (2026-08-17); /how-to/deploy-hosted-agent (2026-08-17); /how-to/manage-hosted-sessions (2026-08-21)
12. AWS AgentCore: docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateAgentRuntime.html and the sub-object pages (AgentRuntimeArtifact, ContainerConfiguration, CodeConfiguration, ProtocolConfiguration, LifecycleConfiguration, AuthorizerConfiguration, CustomJWTAuthorizerConfiguration, NetworkConfiguration, FilesystemConfiguration, RequestHeaderConfiguration); devguide agents-tools-runtime.html and agent-runtime-versioning.html; github.com/aws/agentcore-cli `docs/configuration.md`
13. Google ADK: adk.dev/agents/config/; `src/google/adk/agents/config_schemas/AgentConfig.json`, github.com/google/adk-python main
14. Letta: github.com/letta-ai/agent-file README; docs.letta.com/guides/agents/agent-file; `letta/schemas/agent_file.py` on the `archive` branch of github.com/letta-ai/letta (the `main` README redirects to letta-ai/letta-code)
15. A2A: a2a-protocol.org/latest/specification/ (1.0.0); `specification/a2a.proto`, github.com/a2aproject/A2A main
