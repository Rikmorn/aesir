# Harness and packaging prior art

Date: 2026-09-16. Research brief for the aesir retarget conversation (no issue yet). Written from fetched primary sources. Every claim is tagged **[V]** or **[I]**. **[V]** means verified from a page fetched this session, with the URL in Sources. **[I]** means inferred, or taken from a search-engine summary of a page that could not be fetched.

**Summary.** "Harness" is the right word for the executable the owner wants to build. Anthropic, OpenAI, and the 2026 literature use it for the runtime that wraps a model and makes it act: loop, tools, context management, permissions, hooks. It is the wrong word for the container. Anthropic already ships that harness as the Agent SDK and documents running it in Docker and Kubernetes. Its hosted variant, Managed Agents, treats an "agent" as a versioned config, not an image. Across twelve systems surveyed, the dominant pattern is one generic runtime image plus a declared agent bundle. Docker Agent, kagent, Managed Agents, the OpenAI Agents API, Cloudflare, and Mastra all work this way. Image-per-agent is the pattern of platforms that host arbitrary customer code (Foundry, AgentCore, LangGraph). The strongest counterargument to "agent as microservice" is that the natural unit of a container is the session, not the agent. Every platform surveyed provisions compute per session and holds state idle for minutes to hours. Anthropic and AWS both report that token cost dwarfs compute by an order of magnitude.

## 1. Terminology

**Conclusion.** Keep "harness" for the executable inside the container. Call the container an "environment" or "sandbox" (Anthropic and OpenAI both do), and call the declared bundle an "agent definition" or "manifest". Do not call the image a harness; only kagent does that, and only on an unreleased branch.

### How the word is used

| Source | Usage | Tag |
| --- | --- | --- |
| Agent SDK overview (code.claude.com) | "Build production AI agents with Claude Code as a library." "The Agent SDK gives you the same tools, agent loop, and context management that power Claude Code." The word "harness" does not appear on the page; the owner's remembered phrasing ("same harness/infrastructure") is not the current wording. The page links "Agent harness design" to the June 2026 blog. | [V] |
| "Effective harnesses for long-running agents", Anthropic Engineering, Justin Young, 26 Nov 2025 | "The Claude Agent SDK is a powerful, general-purpose agent harness adept at coding, as well as other tasks that require the model to use tools." | [V] |
| Managed Agents overview | "Pre-built, configurable agent harness that runs in managed infrastructure." "Claude Managed Agents provides the harness and infrastructure for running Claude as an autonomous agent. Instead of building your own agent loop, tool execution, and runtime..." Note that Anthropic separates *harness* from *infrastructure*. | [V] |
| "A harness for every task: dynamic workflows in Claude Code", claude.com blog, 2 Jun 2026 | "While the default Claude Code harness is built for coding, it is also useful for many other types of tasks." "Claude can now write its own harness on the fly." | [V] |
| "Building effective agents", Anthropic, 19 Dec 2024 | Neither "harness" nor "scaffold" appears. Uses "framework" (a library that "can obscure the underlying prompts"), "workflow" (predefined code paths), "agent" (LLM directs its own process), "augmented LLM". | [V] |
| OpenAI Agents API overview | "The Agents API gives your application access to the Codex harness through an OpenAI-managed API." "OpenAI manages sessions, orchestration, context compaction, and recovery while your application provides tools and chooses its execution environment." | [V] |
| "Unlocking the Codex harness: how we built the App Server", OpenAI, 4 Feb 2026 | "The Codex harness is the agent loop and logic that underlies all Codex experiences." Page returned 403; quote is from a search summary. | [I] |
| "Harness Engineering: Anatomy, Architecture, and Evolution of Coding Agents", Wavestone AI Lab, arXiv 2609.00006, Jul 2026 | "An agent is a model plus a harness. The harness is everything except the model: the runtime that couples an LLM to the world, its loop, its tools, its context, its safety controls, its orchestration, and its extension surfaces." Distinguishes: *scaffold* = the structural code (loop, registries); *harness* = "the shipped runtime artifact that embeds it"; *framework* = "a library the developer imports"; *evaluation harness* wraps an agent to test it, "opposite direction"; *orchestrator* coordinates harnesses without its own loop. Credits Trivedy (LangChain) and Hashimoto for popularising the term in early 2026. | [V] |
| "What makes a harness a harness", arXiv 2606.10106, 8 Jun 2026 | Proposes an inclusion/exclusion test, applied to Claude Code, Codex CLI, Aider, Cline, OpenHands, SWE-agent. Separates harness from framework, SDK, IDE plugin, evaluation harness, orchestrator. Abstract only fetched. | [V] |
| SWE-bench and SWE-agent | SWE-bench's own execution scaffold is called "the harness" (evaluation sense). SWE-agent introduced the agent-computer interface and is the most cited agent-side "scaffold". Both from the Wavestone paper's search summary, not from the SWE-bench docs. | [I] |
| Martin Fowler site, Böckeler, "Harness Engineering, first thoughts", 17 Feb 2026 | Describes harness engineering as "tooling and practices we can use to keep AI agents in check"; warns the term will be diluted. | [V] |
| kagent `main`, `go/api/v1alpha3/harness_types.go` | "Harness defines a reusable agent runtime and infrastructure policy." Spec has an OCI image "pinned by sha256 digest", command, args, env, substrate policy, and "AllowedAgentTemplates selects AgentTemplates this Harness admits." Not in the v0.10.1 release notes (8 Sep 2026). | [V] |
| Docker Agent YAML reference | `harness` field: "Delegate to external coding CLI" (that is, Claude Code or Codex as a sub-runtime). | [V] |

### Vocabulary to adopt

| Term | Meaning in current usage | Use it for |
| --- | --- | --- |
| Harness (agent harness) | The runtime around the model: loop, tools, context management, permissions, hooks, subagents. A "runtime the developer works inside of". | The executable the owner is building or reusing. |
| Agent runtime | Near-synonym for harness, preferred by Kubernetes-side projects (kagent, agent-sandbox "AI agent runtimes"). | Interchangeable; pick one and stay consistent. |
| Framework | A library you import to assemble an agent (LangChain, Agent Framework, ADK). | Not what the owner means. |
| Scaffold | The structural loop code, or (older usage) the whole agent-side wrapper in SWE-bench papers. | Avoid; ambiguous. |
| Evaluation harness | Wraps an agent to score it (SWE-bench). | Only in test contexts. |
| Environment / sandbox | Where a session's tools execute: container, microVM, or pod. Both Anthropic and OpenAI use "environment" as a first-class API object. | The container. |
| Agent (definition) | Model + system prompt + tools + MCP servers + skills, versioned. | The manifest. |
| Session | A running instance of an agent in an environment. | The conversation. |

## 2. Anthropic's own surfaces, September 2026

**Conclusion.** Anthropic ships the harness (Agent SDK), a written recipe for containerising it, and a reference dev container. Managed Agents adds a hosted loop with a self-hostable sandbox. It does not ship a maintained base image, an inbound event router, a cross-container scheduler, or a build step that bakes a manifest into an image. Those are the parts the owner would build.

### Agent SDK [V]

- Runs the agent loop for you in Python and TypeScript. "To drive the same agent loop from another language, run the CLI as a subprocess with the `-p` flag."
- Capabilities table: built-in tools (read, write, edit, run commands, web search), hooks, subagents, MCP, permissions, sessions (resume, fork), "Skills, commands, and memory: load automatically from your project's `.claude/` and from `~/.claude/`, same as Claude Code", plugins.
- Hosting page: "The Agent SDK spawns and supervises a `claude` CLI subprocess that owns a shell, a working directory, and session files on disk." One session = one subprocess. The subprocess "does not listen on the network"; your app exposes the port.
- Four documented session patterns: ephemeral container per task, long-running container holding many subprocesses, hybrid (ephemeral container hydrated from a `SessionStore`), multi-agent container. Cookbook has "deployable code for local Docker, Modal, and Kubernetes".
- Local state that dies with the container: transcripts under `~/.claude/projects/`, CLAUDE.md files, working-directory artifacts. `SessionStore` mirrors transcripts only.
- Multi-tenant isolation: `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, per-tenant `CLAUDE_CONFIG_DIR` and `cwd`, per-tenant egress rules.
- Sizing: "1 GiB RAM, 5 GiB disk, and 1 CPU per agent is a reasonable starting point." OTEL via environment variables. Bundled native binary pinned to the SDK package version.
- Cost: "Anthropic token cost typically dominates container infrastructure cost by an order of magnitude or more. A minimally provisioned container runs roughly $0.05 per hour."
- Known limits: no top-level session timeout, memory growth over long sessions, no per-subagent wall-clock deadline.
- Licensing: commercial terms; products must not be branded "Claude Code"; no claude.ai login for third-party agents.

### Claude Code guidance layering [V]

| Layer | Mechanism | Precedence / loading |
| --- | --- | --- |
| Instructions | CLAUDE.md at managed policy (`/etc/claude-code/CLAUDE.md`), user (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md` or `./.claude/CLAUDE.md`), local (`./CLAUDE.local.md`) | Concatenated, broadest first; ancestors at launch, subdirectories on demand; `@path` imports to depth four; HTML comments stripped. |
| Rules | `.claude/rules/*.md` and `~/.claude/rules/`, optional `paths:` frontmatter | Unscoped rules load at launch with CLAUDE.md priority; path-scoped rules load when a matching file is read. |
| Auto memory | `~/.claude/projects/<project>/memory/MEMORY.md` plus topic files | First 200 lines or 25 KB of the index every session; not loaded into subagents. |
| Skills | `SKILL.md` with frontmatter (`description`, `allowed-tools`, `context: fork`, `paths`, arguments) in user, project, nested, enterprise, plugin, or account scope | Description always in context; body on invocation; `!`command`` injection. |
| Subagents | `.claude/agents/*.md`: frontmatter `name, description, tools, disallowedTools, model, permissionMode, maxTurns, skills, mcpServers, hooks, memory, background, omitClaudeMd, effort, isolation`; markdown body is the system prompt | Managed > `--agents` flag > project > user > plugin. |
| Hooks | "User-defined shell commands, HTTP endpoints, MCP tool calls, LLM prompts, or subagents that execute automatically at specific points"; 30+ events; handler types `command, http, mcp_tool, prompt, agent` | Configured in settings at any scope, plugin `hooks.json`, or skill/subagent frontmatter; exit 2 blocks. |
| Settings | `managed-settings.json` or console > `claude --settings` > `.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json` | Higher overrides lower; arrays such as `claudeMdExcludes` merge. |
| Sandbox | Seatbelt on macOS; bubblewrap + socat on Linux; network via a proxy outside the sandbox with domain allowlists; credential masking with `injectHosts` and `tlsTerminate` | Enforced by the client, unlike CLAUDE.md. |
| AGENTS.md | Not read directly; `@AGENTS.md` import or symlink. | |

### Managed Agents [V unless marked]

- Beta, header `managed-agents-2026-04-01`. Four concepts: Agent, Environment, Session, Events. "Claude Managed Agents is stateful by design"; not eligible for ZDR or HIPAA BAA.
- Agent fields: `name`, `model` (`id`, `effort`, `speed`, `inference_geo`), `system`, `tools`, `mcp_servers`, `skills`, `multiagent`, `description`, `metadata`. Versioned on every change; `ant apply agent.md` takes a markdown file with YAML frontmatter and the prompt as body.
- Tools: `agent_toolset_20260401` = bash, read, write, edit, glob, grep, web_fetch, web_search, each with `enabled` and `permission_policy`; custom tools are client-executed ("your code runs the operation, and the result flows back"); MCP via the MCP connector; MCP tunnels in research preview.
- Environments: Anthropic cloud sandbox, or self-hosted. Self-hosted splits "Claude model and orchestration" (Anthropic) from "tool execution, filesystem and processes, network egress" (yours). Pull-based work queue: always-on `ant beta:worker poll`, or webhook-triggered. Per-session container example: `ENTRYPOINT ["ant", "beta:worker", "run"]`, one work item then exit. Environment key authorises only queue polling. Filesystem: `/workspace/skills/<name>/`, `/mnt/memory/<store>/` synced about every 15 s. No `file` or `github_repository` resources on self-hosted.
- Kubernetes integration (agent-sandbox docs, 10 Jul 2026): a dispatcher long-polls the queue, creates a `SandboxClaim` against a `SandboxWarmPool`, posts the session id to the worker pod's `:8080` listener, which execs `ant beta:worker run`; default-deny `NetworkPolicy` with egress only to DNS and `api.anthropic.com`.
- Pricing: token rates plus $0.08 per active session-hour, idle not billed. From third-party summaries; the Anthropic pricing page was not fetched. [I]

### Dev container [V]

- Install via the Dev Container Feature `ghcr.io/anthropics/devcontainer-features/claude-code:1.0` on any base image.
- The `anthropics/claude-code/.devcontainer` reference (Dockerfile, `devcontainer.json`, `init-firewall.sh` needing `NET_ADMIN`/`NET_RAW`) "is provided as a working example rather than a maintained base image".
- Policy inside the image: copy `managed-settings.json` to `/etc/claude-code/`; `DISABLE_AUTOUPDATER=1` and pin `@anthropic-ai/claude-code@X.Y.Z`; `.mcp.json` at repo root; non-root user for `--dangerously-skip-permissions`.

### Rebuild versus reuse

| Concern | If the owner builds his own harness | If he wraps the Agent SDK in his image | If he uses Managed Agents self-hosted |
| --- | --- | --- | --- |
| Loop, compaction, prompt caching | Rebuild | Reuse | Reuse (Anthropic side) |
| Bash, file, grep, web tools | Rebuild | Reuse | Reuse |
| MCP client incl. OAuth 2.1 flow | Rebuild | Reuse | Reuse via connector/tunnels |
| Hooks, permissions, sandbox proxy, credential masking | Rebuild | Reuse | Partial (permission policies only) |
| Guidance layering (CLAUDE.md, rules, skills, subagents) | Rebuild | Reuse (`settingSources`) | Skills only; no CLAUDE.md tiers |
| Session persistence across hosts | Build | `SessionStore` adapter (transcripts only) | Reuse |
| Inbound event routing, correlation, queue | Build | Build | Build (webhook or poll) |
| Multi-agent scheduling across containers | Build | Build | `multiagent` roster, single session |
| Image build that bakes a manifest | Build | Build | Not applicable |
| Model choice | Any | Claude only | Claude only |

## 3. Container-packaged agents in the wild

**Conclusion.** All twelve systems exist as of this week. Three were renamed: cagent to Docker Agent, Vertex AI Agent Engine to Agent Runtime under Agent Platform, Azure AI Foundry to Microsoft Foundry. Only five make a container image the unit a developer ships per agent. The rest ship a generic runtime and a declared bundle.

| System | Unit of packaging | Tools: bundled, MCP, or sidecar | Guidance layering | State and memory | Inbound messages | Deploy and scale |
| --- | --- | --- | --- | --- | --- | --- |
| Docker Agent (cagent) [V] | YAML file, pushed as an OCI artifact; "does not require building a traditional Docker image"; runs on the local `docker agent` binary | Built-in toolsets in-process (`filesystem, shell, file, git, memory, fetch, script, api, scheduler, webhook, a2a`, more); `mcp` via stdio command, remote URL, or `ref: docker:name` from the catalog, which runs the server as a container through the MCP Gateway | `instruction` / `instruction_file`, `add_prompt_files`, `skills`, `hooks`, `commands`, sub-agents | `memory` toolset is "persistent key-value storage (SQLite)"; `session_compaction`, `compaction_threshold`, `num_history_items`, `max_old_tool_call_tokens` | TUI, `api` HTTP server, ACP, MCP mode, `webhook` toolset | Runs where the binary runs; Docker Desktop integration; no orchestration story of its own |
| Docker MCP Gateway + Catalog [V] | Each MCP server is a Docker image (`mcp/` namespace on Hub, 200 to 300+ servers) | Sidecar model: gateway spawns servers "in isolated Docker containers with restricted privileges, network access, and resource usage" and "injects any required credentials"; OAuth flows built in | Not applicable | Not applicable | Client connects over stdio (default), streaming HTTP on 8080, or SSE | Docker Desktop, WSL2, or Docker CE; can run "independently" |
| kagent [V, plus I] | Released (v0.10.1): `Agent` CRD, Declarative (YAML: system prompt, `ModelConfig`, MCP tool refs) run by an ADK-based engine image, or BYO container image. On `main`: `Harness` (image by digest + substrate policy) admits `AgentTemplate` (model, prompt, tools, skills, plugins) | MCP servers "run as separate deployments, allowing multiple agents to share tools"; `RemoteMCPServer` CRD; built-in k8s/istio/helm/argo/prometheus MCP server | System prompt in CR or `SystemPromptFrom` ConfigMap; skills and plugins on the template | `Memory` CRD; controller database for sessions; "agent substrate" with `SandboxAgent` for sandboxed instances | A2A (release notes reference A2A responses; ACP shim for substrate) [I on protocol detail] | kubectl and GitOps; CNCF project, Apache 2.0 |
| Dapr Agents [V] | Python service per agent, deployed "as independent services within Dapr's sidecar architecture" | `@tool` decorator in-process; `MCPClient` for MCP | Prompt in code | `ConversationDaprStateMemory` over 28 state stores; `DurableAgent` built on Dapr Workflow, which uses virtual actors | `runner.run()`, pub/sub CloudEvents `runner.subscribe()`, FastAPI `runner.serve()` | Kubernetes with sidecar; actors give scale-to-zero |
| Kubernetes SIG agent-sandbox [V] | `Sandbox` CRD: "a single, stateful pod with a stable identity and persistent storage"; `SandboxTemplate`, `SandboxClaim`, `SandboxWarmPool`; v1.0.2 | Out of scope: "does NOT define agents, their tools, prompts, or reasoning logic" | Out of scope | Persistent volume survives restarts; pause/resume | Whatever the pod runs; Anthropic's dispatcher pattern posts to `:8080` | gVisor or Kata via `RuntimeClass`; warm pools bind "in under one second" |
| Google ADK + Agent Runtime [V] | Agent Runtime: source directory plus dependencies uploaded, platform builds; Cloud Run and GKE: developer-built container image with `adk api_server` or FastAPI; BYOC listed | Function tools in code; MCP toolsets; A2A | Instructions in code | Managed Sessions and Memory Bank services | REST query/stream, A2A | Serverless autoscale on Agent Runtime |
| OpenAI Agents SDK + Agents API [V] | SDK: your process. Agents API: agent = "model plus instructions, tools, and MCP servers"; environment = optional sandbox (OpenAI-hosted or self-hosted directories) | Programmatic tools executed by your app; MCP over HTTP; hosted web search; skills from "capability directories" | Instructions and skills | "The Agents API retains session state"; SDK stores state "in your storage and SDK sessions" | Sessions API (`/v1/agents/sessions`) | Managed by OpenAI; billed at model rates plus "standard container rates" for hosted sandboxes |
| Microsoft Agent Framework + Foundry Hosted Agents [V] | Container image per agent version in Azure Container Registry; versions immutable; Python and C# | Foundry Toolbox exposed as one MCP endpoint (Code Interpreter, Bing, OpenAPI, MCP, A2A, Skills); framework-agnostic | In code | Per-session VM-isolated sandbox; `$HOME` and `/files` persisted across idle; conversations stored in Foundry; durable key-value state store | Responses (OpenAI-compatible), Invocations (arbitrary JSON, "webhook receiver"), Invocations WebSocket, A2A, Activity for Teams | "Scale per session, not per replica"; idle timeout 2 to 60 min; billed on CPU + memory of active sessions; per-agent Entra identity; GA, page dated 11 Sep 2026 |
| Cloudflare Agents SDK [V] | One Worker script; each agent is a Durable Object instance with a unique id | `@callable()` RPC methods; "multi-server MCP client"; AI SDK tools | In code | Per-instance SQLite (`cf_agents_state`); hibernates when idle; "exactly one instance per ID" | HTTP `fetch()`, WebSocket, email routing, scheduled alarms, RPC | `wrangler deploy`; "an agent that is 99% dormant and 1% active still costs you 100% of a server" on VMs, versus billing only when awake |
| Mastra [V] | `mastra build` emits a self-contained Node server (Hono, port 4111) you run anywhere: VM, container, Lambda, Vercel, Cloudflare | Tools discovered from `tools/**`; MCP client and server support (not fetched; from product knowledge) [I] | In code | Storage adapters (LibSQL, Postgres) [I]; Mastra Platform hosts it | REST `/api/...`, OpenAPI at `/api/openapi.json` | Any Node host; Mastra Platform |
| Amazon Bedrock AgentCore Runtime [V] | ARM64 container image, `0.0.0.0:8080`, `POST /invocations`, `GET /ping` (or MCP on 8000, A2A on 9000, AG-UI) | AgentCore Gateway and Identity for outbound OAuth "on behalf of users or autonomously" | In code | "Each user session runs in a dedicated microVM"; sessions up to 8 h (microVM) or 14 days (Instances); filesystem persists across stop/resume; AgentCore Memory | HTTP, WebSocket `/ws`, MCP, A2A, AG-UI; `HealthyBusy` keeps a session alive | Serverless; CPU billed only when active ($0.0895 per vCPU-hour, $0.00945 per GB-hour); "I/O wait and idle time is free" |
| LangGraph / LangSmith Agent Server [V] | `langgraph build` turns `langgraph.json` into a Docker image per project | In code | In code | Requires Postgres (threads, runs, long-term memory, task queue) and Redis (streaming) | REST: assistants, threads, runs | Docker, Compose, Kubernetes; licence key checked at startup |

## 4. Manifest precedent

**Conclusion.** The owner's list (tools, memory strategy, context management, skills, hooks, MCP config, guidance layers) is fully covered by exactly one shipping manifest: Docker Agent's YAML. Anthropic's two formats cover tools, MCP, skills, hooks (Claude Code only), memory scope, and model. Both use "YAML frontmatter plus markdown prompt", which is aesir's `definition.yaml` plus `prompt.md` in one file. No standard covers context-management strategy except Docker Agent; no standard covers guidance layering, which every system treats as a runtime concern, not a manifest field.

| Field the owner wants | Claude Code subagent `.md` [V] | Managed Agents agent [V] | Docker Agent YAML [V] | kagent `AgentTemplate` + `Harness` (main) [V] | Foundry hosted agent [V] | AgentCore [V] | A2A Agent Card [V] | MCP `server.json` [V] | AGENTS.md [V] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Model | `model`, `effort` | `model{id,effort,speed,inference_geo}` | `model`, `fallback` | `ModelConfig` ref | in code | in code | no | no | no |
| Tools (bundled) | `tools`, `disallowedTools` | `agent_toolset_20260401` with per-tool enable and policy; `custom` | `toolsets` (25+ built-in types) | no (harness image provides) | Toolbox MCP | no | `skills[]` (capabilities, not tools) | no | no |
| MCP config | `mcpServers` (names or inline) | `mcp_servers` | `type: mcp` with `command`, `remote.url`, or `ref: docker:` | `Tools` refs to `RemoteMCPServer` | Toolbox endpoint | Gateway | no | is the MCP server's own manifest: `packages` (npm, pypi, oci, nuget, cargo, mcpb), `remotes`, `environmentVariables{isSecret}` | no |
| Memory strategy | `memory: user/project/local` | memory stores mounted at `/mnt/memory` (session level) | `memory` toolset (SQLite) | `Memory` CRD (released API) | state store, `$HOME` | AgentCore Memory | no | no | no |
| Context management | no | server-side compaction, no knobs | `session_compaction`, `compaction_threshold`, `compaction_model`, `num_history_items`, `max_old_tool_call_tokens`, `max_tool_result_tokens` | no | no | no | no | no | no |
| Skills | `skills` (preloaded) | `skills` | `skills`, `use_skills` | `Skills` | Toolbox Skills | no | no | no | no |
| Hooks | `hooks` | no | `hooks` (tool_guard, pre/post_tool_use, session, compaction, llm call events) | no | no | no | no | no | no |
| Guidance layers | `omitClaudeMd`; CLAUDE.md tiers are a runtime concern | `system` only | `instruction`, `instruction_file`, `add_prompt_files` | `SystemPrompt`, `SystemPromptFrom` ConfigMap, `PromptTemplate` | in code | in code | no | no | is itself one layer; "closest AGENTS.md to the edited file wins" |
| Permissions | `permissionMode` | `permission_policy` per tool | `readonly`, hook `permission_request` | no | Entra identity, RBAC | IAM, Identity | `securitySchemes` | no | no |
| Limits | `maxTurns` | rate limits | `max_iterations`, `max_consecutive_tool_calls`, budget | no | cpu, memory, idle timeout | lifecycle settings | no | no | no |
| Sub-agents | `Agent(type)` in `tools`, `isolation: worktree` | `multiagent` roster | `sub_agents`, `handoffs` | no | no | no | no | no | no |
| Runtime image | no | `environment` object | `harness` (external CLI) | `Harness.image` by digest | ACR image per version | ECR image | no | `packages[].registryType: oci` | no |
| Inbound protocol | no | events API | `api`, ACP, MCP, `webhook` | A2A | Responses, Invocations, A2A, Activity | HTTP, MCP, A2A, AG-UI | `supportedInterfaces`, `capabilities` | `remotes[].transport` | no |
| Versioning | file in git | server-side `version`, optimistic concurrency | OCI tag, signed | CRD generation | immutable versions | versioned endpoints | `version` | exact semver only, "latest" rejected | git |

### Emerging standards, stated plainly

- **A2A Agent Card 1.0** (Agentic AI Foundation since 27 Aug 2026): served at `/.well-known/agent-card.json`; declares `name, description, supportedInterfaces, version, capabilities, skills, securitySchemes, defaultInputModes, provider, signatures`. It "does not declare tools, memory systems, or prompts". It is a discovery and transport contract, not a build manifest. [V]
- **AGENTS.md** (Agentic AI Foundation): plain markdown, no required fields, nested files with closest-wins; 60k+ repos. Claude Code reads it only through an import. It is a guidance layer, not a manifest. [V]
- **MCP `server.json`** (schema 2025-12-11): identity, `packages` or `remotes`, runtime hints, environment variables with `isSecret`. This is the closest thing to a tool-bundle manifest and already supports `oci` packages. [V]
- **agent.yaml conventions**: no cross-vendor standard. Docker Agent YAML, kagent CRDs, Managed Agents markdown frontmatter, and Claude Code subagent frontmatter are four independent designs that converge on the same core (model, prompt, tools, MCP, skills). [V]

## 5. Image per agent versus one harness image plus a declared bundle

**Conclusion.** Build one harness image (or a small family of tool-bundle variants), version it by digest, and reference it from a per-agent manifest. Reserve image-per-agent for agents that need native tooling the base lacks. This is what Docker Agent, kagent's new `Harness`, Managed Agents, the OpenAI Agents API, Cloudflare, and Mastra do. The image-per-agent systems are hosting platforms whose customers bring arbitrary code.

| Pattern | Systems | Evidence |
| --- | --- | --- |
| One runtime, declared bundle | Docker Agent (YAML as OCI artifact on a shared binary); kagent Declarative today, `Harness` + `AgentTemplate` on main; Managed Agents (agent is config, environment worker image is the generic `ant`); OpenAI Agents API; Cloudflare (one Worker, N Durable Objects); Mastra (one server, N agents); Agent SDK long-running pattern (one container, N subprocesses) | Sections 2 and 3 [V] |
| Image per agent | Foundry Hosted Agents (image per immutable version); AgentCore Runtime (ARM64 image per runtime); LangGraph (`langgraph build` per project); kagent BYO; ADK on Cloud Run/GKE | Section 3 [V] |
| Image per session, generic | Managed Agents self-hosted per-session container; agent-sandbox warm pools; AgentCore microVM per session; Foundry sandbox per session | Section 3 [V] |

### Costs

| Cost | Image per agent | One harness image + manifest |
| --- | --- | --- |
| Build pipeline | One build, scan, and registry push per agent change; Foundry makes every version immutable, so even a prompt edit is a new image. | One build per harness release; agent changes are a manifest commit. Docker Agent signs the artifact instead. |
| Image sprawl and pull time | N images to patch when the base changes; kagent's release notes show BYO sample images needing re-bases when the substrate moved. | One image to patch; warm pools (agent-sandbox, Foundry) amortise the pull. |
| Secrets per tool | Each image carries its own tool credentials, or each deployment must be given them. Foundry: "Don't put secrets in container images or environment variables." | Credentials live outside the image: Docker MCP Gateway injects them, Claude Code's sandbox proxy masks them, Anthropic's hosting guidance routes outbound calls "through a proxy that injects API keys after the request leaves the container." |
| Cold start | Per-agent image pull plus boot; Agent Autopsy measured "CRD reconciliation, pod scheduling, container pull, boot sequence" before useful work. | Shared image is usually cached; still pays subprocess start. Agent SDK: `startup()` to pre-warm. |
| Versioning the harness independently | Impossible without rebuilding every agent image. | kagent pins `Harness.image` "by sha256 digest" and the manifest names it; Agent SDK pins the CLI to the SDK package version. |
| Dependency isolation | Strong: each agent gets exactly its toolchain. | Weak: base image must carry the union, or use variants. Docker Agent sidesteps this by running MCP tools as separate containers. |
| Blast radius of a harness bug | Contained per agent, at the price of many rebuilds. | Every agent at once; mitigated by digest pinning and staged rollout. |

## 6. Counterarguments

**Conclusion.** The microservice analogy holds for build, distribution, and observability, and breaks on the unit of deployment. A microservice's unit is the service; an agent's unit is the session. Every platform surveyed provisions compute per session, and Anthropic's own hosting page opens with "Hosting it is not like hosting a stateless API wrapper."

### State per conversation and long-running loops

- Agent SDK hosting: "Every running agent is a long-lived process tied to local state, which shapes how you allocate resources, persist sessions, and scale across tenants." Transcripts, CLAUDE.md, and working files "do not survive a container restart, a scale-down, or a move to a different node." [V]
- AgentSysBench (arXiv 2608.15127, 15 Aug 2026): "production sessions hold state idle for minutes to hours between active steps"; "sandbox working-set memory peaking at 28 GB per session"; "non-LLM components dominating latency in 5 of 10 applications". [V]
- Foundry: "Hosted agents scale per session, not per replica." AgentCore: "each user session runs in a dedicated microVM". agent-sandbox: a `Sandbox` is "a single, stateful pod with a stable identity". [V]
- Implication: a container per agent *type* still needs a per-session story (working directory, config dir, transcript store). aesir's Postgres-claimed conversation is that story today; a container does not replace it.

### Cost is tokens, not compute

- Agent SDK hosting: token cost "dominates container infrastructure cost by an order of magnitude or more"; "a minimally provisioned container runs roughly $0.05 per hour, while a single long agent session can spend dollars in tokens." [V]
- Token growth: agent loops re-bill prior context each step, so a 10-step run costs more than 10 single calls (dev.to token-economics posts, secondary). [I]
- Implication: container packaging buys reproducibility and isolation, not savings. Optimising context management (compaction thresholds, tool-result pruning) moves the bill; optimising pods does not.

### Containers mostly idle waiting on the model API

- Cloudflare: "An agent that is 99% dormant and 1% active still costs you 100% of a server." Its answer is hibernation with SQLite state and wake-on-event. [V]
- AgentCore: CPU "billed only during active processing"; "I/O wait and idle time is free". [V]
- Agent Autopsy, "Containerized Agents Run up a Bill!", 13 Apr 2026: "Ten agents meant ten pods, ten PVCs, ten separate CPU/mem reservations" while idle; proposes a shared runner where "idle agents cost nothing because there's no goroutine when there's no work", trading away "POSIX filesystems, browser automation, local sidecars". [V]
- AgentCgroup (arXiv 2602.09345, search summary): initialisation 31 to 48 percent of task time, LLM reasoning 26 to 44 percent. [I]
- Advocates' answer: pack many sessions per container (Agent SDK long-running pattern with consistent hashing on `sessionId`), or let the platform bill per active session (Foundry, AgentCore). Both are "one image, many sessions", not "one container, one agent".

### Secrets and OAuth per bundled tool

- MCP authorization (spec 2025-06-18): HTTP transports use OAuth 2.1 with the MCP client as the OAuth client; "Implementations using an STDIO transport SHOULD NOT follow this specification, and instead retrieve credentials from the environment"; tokens are audience-bound and "MCP servers MUST NOT pass through the token". [V]
- So a GitHub tool bundled in-process means the container process holds a GitHub token, per tenant, in its environment. Anthropic's guidance: "keep tool credentials out of the agent environment. Route outbound calls through a proxy that injects API keys after the request leaves the container." Claude Code's sandbox implements exactly this with sentinel values and `injectHosts`. Docker MCP Gateway and Foundry Toolbox centralise OAuth outside the agent for the same reason. [V]
- Foundry gives every agent its own Entra identity and supports on-behalf-of flows; AgentCore Identity does the same. Neither puts the credential in the image. [V]
- Implication: "bundled, not a service" is fine for the *implementation* (the code runs in-process), but the *credential* still wants a proxy or gateway, which is a service.

### Inbound webhooks need a stable public endpoint

- A container per agent does not give an agent an address; a router in front does. Foundry adds a dedicated endpoint and an "Invocations" protocol specifically for "webhook receiver (GitHub, Stripe, Jira, etc.)". Cloudflare addresses agents by Durable Object id. [V]
- Managed Agents self-hosted deliberately inverts the direction: the worker pulls a queue so "your infrastructure" needs no inbound endpoint; the agent-sandbox pattern uses a `NetworkPolicy` that allows ingress "only from the dispatcher". [V]
- Implication: aesir's existing webhook receiver plus Postgres queue is the pull model already. Containers change how work is executed, not how it arrives.

### Other breaks in the analogy

- Multi-tenant leakage: the SDK reads `CLAUDE.md` and auto memory from the filesystem, so "those files can leak one tenant's context into another tenant's session" unless `settingSources` and config dirs are isolated. Microservices do not have this class of bug. [V]
- No natural timeout: "A session does not time out on its own." Health checks that assume request/response semantics misfire; AgentCore invented `HealthyBusy` for this. [V]
- Compliance: Managed Agents is "not currently eligible for Zero Data Retention"; the OpenAI Agents API is US-only in beta with no ZDR (search summary). Stateful hosted loops carry data-residency consequences that stateless services do not. [V] [I]
- Advocates for the analogy: Foundry lists "containerization, web server setup, security, memory persistence, scaling, instrumentation, and version rollbacks" as what the platform absorbs; kagent argues agents should be "defined, versioned, and rolled out with kubectl and GitOps"; Docker argues for OCI distribution and signing. All three still model compute per session underneath. [V]

### What survives

The parts of the owner's idea that the evidence supports:

- OCI as the distribution unit for a harness image and, separately, for MCP tool images (Docker Catalog, `server.json` `oci` packages).
- OpenTelemetry inherited from the environment (Agent SDK, Foundry, AgentCore).
- Network policy per container (agent-sandbox, Claude Code sandbox proxy).
- A manifest that names its harness by digest (kagent).
- Skills, hooks, and guidance as files the harness loads from a well-known layout (Claude Code, Managed Agents `/workspace/skills`).

## Sources

Anthropic

- Agent SDK overview, code.claude.com/docs/en/agent-sdk/overview (no date shown; fetched 2026-09-16)
- Hosting the Agent SDK, code.claude.com/docs/en/agent-sdk/hosting (no date shown; references SDK v0.3.234)
- How Claude remembers your project, code.claude.com/docs/en/memory (references v2.1.239)
- Settings files and precedence, code.claude.com/docs/en/settings (no date shown)
- Hooks reference, code.claude.com/docs/en/hooks (references v2.1.267)
- Skills, code.claude.com/docs/en/skills (references v2.1.273)
- Subagents, code.claude.com/docs/en/sub-agents (references v2.1.271)
- Configure the sandboxed Bash tool, code.claude.com/docs/en/sandboxing (references v2.1.224)
- Development containers, code.claude.com/docs/en/devcontainer (no date shown)
- Claude Managed Agents overview, platform.claude.com/docs/en/managed-agents/overview (beta header 2026-04-01)
- Define your agent, platform.claude.com/docs/en/managed-agents/agent-setup (example dates 2026-04-03)
- Tools, platform.claude.com/docs/en/managed-agents/tools
- Self-hosted sandboxes, platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes (ant CLI 1.33.0)
- Effective harnesses for long-running agents, anthropic.com/engineering/effective-harnesses-for-long-running-agents (26 Nov 2025)
- Building effective agents, anthropic.com/engineering/building-effective-agents (19 Dec 2024)
- A harness for every task, claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code (2 Jun 2026)
- Managed Agents pricing (secondary, not fetched from Anthropic): truefoundry.com/blog/claude-managed-agents-pricing; verdent.ai/guides/claude-managed-agents-pricing

Terminology

- Barbaste et al., Harness Engineering: A Source-Code Study of Eleven Systems, arxiv.org/html/2609.00006 (Jul 2026)
- de Macedo, What makes a harness a harness, arxiv.org/abs/2606.10106 (8 Jun 2026)
- Böckeler, Harness Engineering, first thoughts, martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html (17 Feb 2026)
- OpenAI, Unlocking the Codex harness, openai.com/index/unlocking-the-codex-harness/ (4 Feb 2026; page returned 403, quoted via search)
- OpenAI, Harness engineering: leveraging Codex in an agent-first world, openai.com/index/harness-engineering/ (11 Feb 2026; via InfoQ, 21 Feb 2026)
- OpenAI Agents API overview, developers.openai.com/api/docs/guides/agents-api/overview (public beta reported 10 Sep 2026)
- OpenAI Agents guide, developers.openai.com/api/docs/guides/agents

Container-packaged systems

- Docker Agent docs, docs.docker.com/ai/cagent/ (Docker Desktop 4.49 to 4.62 naming note)
- Docker Agent configuration, distribution, tools, hooks: github.com/docker/docker-agent, `docs/configuration/agents`, `docs/concepts/distribution`, `docs/configuration/tools`, `docs/configuration/hooks` (main, fetched 2026-09-16)
- Docker MCP Gateway, docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/ and github.com/docker/mcp-gateway
- Docker MCP Catalog, docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/
- kagent, github.com/kagent-dev/kagent (README; `go/api/v1alpha3/harness_types.go`, `agenttemplate_types.go` on main; releases v0.10.0 4 Sep 2026, v0.10.1 8 Sep 2026)
- Dapr Agents core concepts, docs.dapr.io/developing-ai/dapr-agents/dapr-agents-core-concepts/ (modified 11 Sep 2026)
- Kubernetes SIG agent-sandbox, github.com/kubernetes-sigs/agent-sandbox (v1.0.2); Anthropic Managed Agents use case, agent-sandbox.sigs.k8s.io/docs/use-cases/anthropic-managed-agents/ (10 Jul 2026)
- Google ADK deploy, adk.dev/deploy/ and adk.dev/deploy/agent-runtime/; Agent Platform docs, docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/ (updated 2026-09-16)
- Microsoft Foundry hosted agents, learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents (ms.date 2026-09-11, updated 2026-09-14)
- Cloudflare Agent class internals, developers.cloudflare.com/agents/runtime/lifecycle/agent-class/ (17 Aug 2026); Long-running agents, developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/ (20 Aug 2026)
- Mastra server and deployment, mastra.ai/docs/deployment/mastra-server and mastra.ai/docs/deployment/overview (no date)
- Amazon Bedrock AgentCore Runtime, docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html, runtime-service-contract.html, runtime-http-protocol-contract.html; pricing, aws.amazon.com/bedrock/agentcore/pricing/
- LangSmith self-hosted Agent Server, docs.langchain.com/langsmith/deploy-standalone-server

Standards

- A2A specification 1.0, a2a-protocol.org/latest/specification/ (AAIF announcement 27 Aug 2026)
- AGENTS.md, agents.md
- MCP registry server.json, github.com/modelcontextprotocol/registry, `docs/reference/server-json/generic-server-json.md` (schema 2025-12-11)
- MCP Authorization, modelcontextprotocol.io/specification/2025-06-18/basic/authorization

Counterarguments

- Chang et al., From LLM Inference to Agentic Workloads (AgentSysBench), arxiv.org/abs/2608.15127 (15 Aug 2026)
- Kent, Agent Autopsy: Containerized Agents Run up a Bill!, agentautopsies.substack.com/p/agent-autopsy-pod-mode (13 Apr 2026)
- AgentCgroup, arxiv.org/pdf/2602.09345 (search summary only)
- Token economics of long-running agent loops, dev.to/arihantdeva (search summary only)
