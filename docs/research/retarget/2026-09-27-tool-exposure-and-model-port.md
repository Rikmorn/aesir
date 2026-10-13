# Tool exposure and the model port: what shipped harnesses and vendors do

Date: 2026-09-27. Research brief for the retarget, topic 2. Extends `02-harness.md` §"Model agnosticism", §"The pattern: port and adapter for the model", §"Options for the adapters", and gap register row G8. Issue not yet filed.

**Summary.** Both questions have moved since `02-harness.md` was written. On tool exposure, "defer by default and search" is now a first-party API feature at Anthropic (November 2025) and OpenAI (gpt-5.4 and later; Azure ships the same), and the default behaviour of Claude Code, which defers MCP tools once their descriptions pass 10% of the context window. The vendors agree on the mechanics: every definition is still sent, deferred ones are stripped from the cached prefix, discovered ones are appended at the tail so the cache survives. The measured case against sending 35 schemas per call is real but smaller than the folklore: two peer-reviewed benchmarks put the loss at 8 to 19 points when a handful of similar tools are added, and 7 to 85 percent when the catalogue grows to hundreds; Anthropic's own figure is 79.5 to 88.1 percent on its MCP evaluation for Opus 4.5. On the model port, option B (the Vercel AI SDK) exposes far more of the Anthropic surface than the notes assumed, including tool search, compaction, mid-conversation tool changes and task budgets, at the price of a new major every six to eight months (v7 shipped 2026-06-25). Option C (a translation proxy) keeps the levers only on its passthrough route, which is not translation; the translated route is the intersection, and a supply-chain compromise of LiteLLM in March 2026 is a data point on the sidecar's own risk. Option A is smaller than it looks because two vendors now converge on the same primitives (deferred tools, opaque compaction items, opaque reasoning items, tool namespaces), and the capability-declaration precedents (LiteLLM's `supports_*` map, OpenRouter's `supported_parameters`) show what the adapter contract should carry. Labels: **[V]** verified from the cited source in this session, **[S]** secondary (a search summary, or the cached `claude-api` skill reference dated 2026-06-24), **[I]** inferred.

---

## Part 1: tool exposure

### 1. Vendor mechanisms

**Anthropic tool search tool** [V, docs 2026-09-27]. Two server-side variants: `tool_search_tool_regex_20251119` (Claude writes Python `re.search()` patterns, 200 characters max) and `tool_search_tool_bm25_20251119` (natural-language queries, 500 characters max). Undated aliases resolve to the latest. The client still sends every tool definition on every request; `defer_loading: true` excludes a tool from the system-prompt prefix, and at least one tool (normally the search tool) must stay non-deferred. A search returns `tool_reference` blocks (default 5, `limit` 1 to 10,000), which the API expands into full definitions inline in the conversation body, so the prefix and its cache are untouched. Expanded references persist through the history, so later turns need no re-search. Up to 10,000 deferred tools per request. Search covers names, descriptions, argument names and argument descriptions. Not metered as a server tool; loaded definitions bill as input tokens. `defer_loading` and `cache_control` on the same tool return a 400. Strict-mode grammar is built from the full toolset, so the two compose. A client can implement its own search (embeddings, for example) by returning `tool_reference` blocks in an ordinary `tool_result`. Supported from Opus 4.5, Sonnet 4.5 and Haiku 4.5 onward; Opus 4.1 and earlier lack it. Public beta on 2025-11-24, no beta header today [V, release notes and tool reference]. Vendor guidance: use it from 10 tools or 10k tokens of definitions; keep the 3 to 5 most-used tools non-deferred; namespace by prefix (`github_`, `slack_`) so one search matches a group; add a system-prompt sentence naming the available categories.

Stated figures [V, docs and the 2025-11-24 engineering post]: a five-server MCP setup (GitHub, Slack, Sentry, Grafana, Splunk) costs about 55k tokens before work starts; tool search "typically reduces this by over 85 percent"; selection "degrades once you exceed 30–50 available tools". On the internal MCP evaluation, Opus 4 went from 49% to 74% and Opus 4.5 from 79.5% to 88.1% with tool search on; the post's worked example is about 77k tokens down to about 8.7k.

Related Anthropic surfaces [V]: the MCP connector's `mcp_toolset` entry carries `default_config: {enabled, defer_loading}` and per-tool `configs`, giving allowlist, denylist and deferral per server or per tool. Client toolsets (`computer_toolset_20260801`, `browser_toolset_20260801`, GA 2026-08-19) are one entry with a fixed member set; `configs` sets `enabled` and `defer_loading` per member, and the toolset defers and expands as a unit. Mid-conversation tool changes (`tool_addition`, `tool_removal` attached to a system message, beta header `mid-conversation-tool-changes-2026-07-01`, Opus 4.8) add or remove tools between turns without a cache miss; additions reference tools declared up front with `defer_loading` [S, seen in the Vercel provider doc rather than Anthropic's page].

**Claude Code** [V, changelog fetched 2026-09-27, current release 2.1.283]. Version 2.1.7: "Enabled MCP tool search auto mode by default... When MCP tool descriptions exceed 10% of the context window, they are automatically deferred and discovered via the MCPSearch tool". 2.1.9 added `auto:N` for the percentage. 2.1.121 added `alwaysLoad` per MCP server to skip deferral. 2.1.267: tools that connect mid-session arrive as deferred definitions so the cache survives. 2.1.70: behind a third-party gateway (`ANTHROPIC_BASE_URL`) it disables `tool_reference` blocks; 2.1.72 lets `ENABLE_TOOL_SEARCH` force it on anyway. 2.1.76 fixed deferred tools losing their schemas after compaction. 2.1.126: built-ins such as WebSearch and WebFetch are themselves deferred for subagents. The MCP docs page confirms tool search is the default, disabled by `ENABLE_TOOL_SEARCH=false`, a custom base URL, or pre-4.5 models on Vertex; without it a `WaitForMcpServers` tool takes the connection wait. Observed in this session [V]: the harness listed deferred tools by name only, with the notice that their schemas are not loaded and a direct call fails with `InputValidationError`; `ToolSearch` accepts a keyword query or `select:<name>,<name>` and returns the schemas as an inline `<functions>` block. Subagent frontmatter scopes tools with a `tools` allowlist and a `disallowedTools` denylist, including `mcp__<server>` patterns; the built-in Explore and Plan subagents deny Write and Edit [V]. Plan mode is a phase gate: read and explore, edits blocked until the plan is approved [V].

**OpenAI** [V, docs 2026-09-27]. The function-calling guide: "Aim for fewer than 20 functions available at the start of a turn at any one time, though this is just a soft suggestion", and defer large or infrequent tools with tool search. `tool_choice` has an `allowed_tools` form (mode `auto` or `required` over a listed subset) whose stated purpose is to narrow the callable set while keeping the `tools` list byte-stable for the prompt cache. The tool search guide: add `{"type": "tool_search"}` and mark functions `defer_loading: true`; functions can sit inside a `namespace` (name, description, nested tools) and MCP servers can be deferred too. For an individually deferred function the model still sees its name and description, so "tool search is mostly deferring the parameter schema"; for a namespace it sees only the namespace's name and description. Hosted search (`execution: "server"`) returns `tool_search_call` and `tool_search_output` items with `call_id: null`; client-executed search (`execution: "client"`, with a parameters schema you define) has the application return the `tool_search_output`, and may return tools that were never in the request. Loaded tools are injected at the end of the context to preserve the cache; an `additional_tools` developer item can add tools at a chosen point. Guidance: "Keep each namespace to fewer than 10 functions". Models: gpt-5.4 and later. No separate price stated. Prompt caching is automatic (1,024-token minimum on GPT-5.6+; reads 0.1×, writes 1.25×), and tool-definition changes invalidate it [V].

**Azure Foundry** [V, page dated 2026-07-15]: the same `tool_search` on the Azure OpenAI Responses API, gpt-5.4 and later, with the same hosted and client variants. The page distinguishes it from "tool search in a Foundry Agent Service toolbox", which discovers tools configured in a versioned toolbox [S, not fetched].

**AWS AgentCore Gateway** [V, devguide]: a gateway created with semantic search enabled exposes a tool `x_amz_bedrock_agentcore_search` taking `{query}`, called through ordinary MCP `tools/call`; "the response returns a list of tools that are relevant to the query". Semantic search can only be enabled at creation. The index is a vector index over tool names, descriptions and input schemas [S, AWS blog via search]. No latency figures are published on the page [V, absence]. Supports MCP 2026-07-28 request metadata.

**Google Gemini** [S/V]: the Vertex function-calling reference caps a request at 128 function declarations [S, search summary of the reference page; the page itself did not render]; the Gemini API error "At most 512 function declarations can be specified" is quoted in gemini-cli issue #19083 (2026-02-14, closed not planned) [V]. Modes AUTO, ANY, NONE, VALIDATED, plus `allowed_function_names` [V, ai.google.dev]. No search-before-select mechanism appears in the API docs fetched [V, absence].

**MCP** [V, spec 2026-07-28]: `tools/list` is paginated with an opaque cursor and a server-chosen page size; list results carry `ttlMs` and `cacheScope`. Servers "SHOULD return tools in a deterministic order" because it "improves LLM prompt cache hit rates". The set "MAY vary by the authorization presented on the request" (scope-filtered tool lists). `server/discover` returns capabilities and an `instructions` string. There is no protocol-level tool search or tool-group construct; aggregators are told to prefix names by server. **GitHub MCP server** [V/S]: `--toolsets` or `GITHUB_TOOLSETS` select from about 24 named toolsets (`repos`, `issues`, `pull_requests`, `actions`, `code_security`, ...), `--tools` selects individual tools, `--read-only` drops write tools, and the remote server takes an `X-MCP-Toolsets` header. `--dynamic-toolsets` / `GITHUB_DYNAMIC_TOOLSETS=1` (beta) exposes meta tools (`list_available_toolsets`, `get_toolset_tools`, `enable_toolset`) so the model enables a group on demand [S, GitHub docs and search summary; the README no longer documents it]. The README and the GitHub Docs page disagree on the default set (five toolsets versus three) [V].

### 2. Harness patterns and who uses them

| Pattern | Mechanism | Shipped in |
|---|---|---|
| Per-phase tool sets | A read-only set while planning; the full set while editing | Claude Code plan mode and Explore/Plan subagents [V]; Cline Plan/Act, where Plan "cannot modify any files or execute commands" and each mode may use a different model [V] |
| Static allow/deny per agent | Frontmatter lists, MCP server globs | Claude Code subagents `tools` / `disallowedTools` [V]; GitHub MCP `--toolsets` [V] |
| Deferred by default, searched subset | Names visible (OpenAI) or nothing visible (Anthropic) until a search; expansion appended at the tail | Anthropic tool search, OpenAI/Azure tool search, Claude Code `ToolSearch` [V] |
| Toolsets as one declared unit | A named group with per-member enable/defer | Anthropic client toolsets and `mcp_toolset` configs; OpenAI namespaces; GitHub toolsets [V] |
| Meta-tool router | `enable_toolset(name)`; `call_tool(name, args)` | GitHub dynamic toolsets [S]; Claude Code `ToolSearch select:` [V] |
| Retrieval over descriptions | Embedding or BM25 index, top-k into context | AgentCore semantic search [V]; Anthropic custom search with embeddings [V]; RAG-MCP paper [V] |
| Progressive disclosure | Lightweight identifiers in context, full detail loaded on use | Anthropic "Effective context engineering" (2025-09-29): "bloated tool sets that cover too much functionality" is "one of the most common failure modes" [V]; skills (description in context, file on demand) [S] |
| Code execution as tool access | The model writes code that calls tools; results filtered before they reach context | Anthropic programmatic tool calling: `allowed_callers: ["code_execution_20260120"]`; "improved performance by an average of 11% while using 24% fewer input tokens" on BrowseComp and DeepSearchQA [V]; the 2025-11-24 post reports 43,588 to 27,297 tokens (37%) on a research task [V]. Anthropic "Code execution with MCP" (2025-11-04): tools as a filesystem of TypeScript modules with a `search_tools` function and detail levels; worked example 150,000 to 2,000 tokens [V]. Cloudflare Code Mode (2025-09-26): MCP tools compiled to a TypeScript API, two tools exposed, code run in V8 isolates; no numbers published [V] |

### 3. Measured degradation

| Source | Setup | Result |
|---|---|---|
| Rabinovich and Anaby-Tavor, "On the Robustness of Agentic Function Calling", 2025-04-01 [V] | BFCL subset expanded from 2.7 to 5.6 tools per case by adding about 3 semantically related tools | Accuracy fell 8 to 19 points across nine models: Claude 3.5 Sonnet 91.5 to 84.5; GPT-4o-mini 92.5 to 76.5; Granite 3.1 8B 94.5 to 77.0 |
| LongFuncEval (IBM), 2025-04-30 [V] | Catalogue grown from 8,192 to 120,000 tokens, about 49 to 741 tools | Drops "from 7.59% to 85.58% (excluding Mistral-large)"; GPT-4o 11 to 13%; Llama 3.1 70B 44 to 73%; position bias at large sizes |
| RAG-MCP, 2025-05-06 [V] | 1 to 100 MCP servers, one relevant; Qwen-max | Above 90% success below about 30 servers, variable at 31 to 70, degraded beyond; retrieval raised accuracy 13.62% to 43.13% and cut prompt tokens 2,133.84 to 1,084 |
| "How Many Tools Should an LLM Agent See?" (Meta), 2026-05-23 [V] | Retrieval depth K tuned per query; Claude Sonnet 4.6 on BFCL | 93.1% selection accuracy at K≈2.2 versus 87.1% at fixed K=5; BM25 at K≈7.4 matches K=50 coverage (90.3% versus 90.8%) |
| Anthropic, 2025-11-24 [V] | Internal MCP evaluation | Opus 4 49 to 74%; Opus 4.5 79.5 to 88.1% with tool search |
| BFCL V4 (last update 2026-04-12) [V] | "Multiple function" category gives 2 to 4 function documents per query | It does not measure large catalogues; the Meta paper says so too |

**Token cost formula.** Tools cost `T = Σ s_i ≈ N × s̄` input tokens per call, before any reply. Two measured anchors for `s̄`: LongFuncEval's catalogues give about 165 tokens per tool (8,192/49; 120,000/741) for compact schemas [V]; Anthropic's "about 72k tokens for 50+ tools" gives up to about 1,400 per tool for MCP-server-grade schemas [V]. For N = 35 at 800 tokens, T ≈ 28k per call; over a 40-step run that is 1.12M input tokens, $5.60 at Opus 5 uncached input or about $0.56 as cache reads at 0.1× plus one write [V prices from the `claude-api` skill and the caching page]. Caching removes most of the money, not the context occupancy or the selection effect; the prefix still has to be re-read on every call, and any tool-definition change invalidates tools, system and messages together [V].

Worked figures for a 40-step run at Opus 5 input prices ($5 per MTok uncached, $0.50 cached read, $6.25 cache write) [S prices, V arithmetic]:

| Tools sent per call | s̄ = 165 tokens (compact) | s̄ = 800 tokens (typical MCP) | s̄ = 1,400 tokens (rich MCP) | Share of a 200k window at s̄ = 800 |
|---|---|---|---|---|
| 5 pinned (search on) | 0.8k per call; $0.17 uncached, $0.02 cached | 4k; $0.80 / $0.08 | 7k; $1.40 / $0.14 | 2% |
| 35 (today's shape) | 5.8k; $1.16 / $0.12 | 28k; $5.60 / $0.56 | 49k; $9.80 / $0.98 | 14% |
| 100 (aggregated servers) | 16.5k; $3.30 / $0.33 | 80k; $16.00 / $1.60 | 140k; $28.00 / $2.80 | 40% |

Read across a row and the money is small once cached; read down a column and the window share is what tool search is really buying back. Anthropic's "context bloat" framing and OpenAI's "fewer than 20" both point at the middle column.

### 4. What a manifest could declare

| Shape | Declaration | Borrowed from |
|---|---|---|
| A. Static list | `tools: [name, ...]` per agent; optional `deny` | Claude Code subagent `tools` / `disallowedTools`; GitHub `--tools` |
| B. Pinned core plus searchable rest | `tools: {pinned: [...], searchable: [...], search: bm25 \| regex \| embedding, alwaysLoad: [server]}`; every tool still built into the image and sent; `pinned` maps to non-deferred, the rest to `defer_loading` | Anthropic `defer_loading` and "keep 3–5 non-deferred"; OpenAI `defer_loading`; Claude Code `auto:N` and `alwaysLoad` |
| C. Named toolsets with phase gates | `toolsets: {name: {description, tools, defer}}`, `phases: {plan: [read sets], edit: [all]}`; a phase switch is a `tool_addition` / `tool_removal` system message on Anthropic, a namespace on OpenAI | GitHub toolsets; OpenAI namespaces ("fewer than 10 functions" each); Anthropic client toolsets `configs`; Cline Plan/Act; Claude Code plan mode |

Shape B is the one both vendors have converged on and is the cheapest to map to either API. Shape C adds the per-phase gate that neither API provides natively but both let a harness implement without a cache miss. The two compose: a toolset can be searchable.

---

## Part 2: the model port

### 5. Option B checked: the Vercel AI SDK and its peers

**Version and cadence** [V, npm registry 2026-09-27]. `ai` 7.0.118, published 2026-09-27. Majors: 4.0.0 on 2024-11-18, 5.0.0 on 2025-07-31, 6.0.0 on 2025-12-22, 7.0.0 on 2026-06-25, so a major every six to eight months, and 291 releases on the 7.0.x line in three months. Provider interface: `LanguageModelV4` (`specificationVersion: 'V4'`, `doGenerate`, `doStream`, `supportedUrls`); 5.0 moved V1 to V2, 6.0 to V3, 7.0 to V4 [V]. Headline breaks [V, migration guides]: 5.0 renamed `parameters` to `inputSchema`, `providerMetadata` (input side) to `providerOptions`, `maxTokens` to `maxOutputTokens`; 6.0 removed `CoreMessage`, added per-tool `strict`, made Responses the Azure default; 7.0 requires Node 22, is ESM-only, renamed `system` to `instructions`, renamed the lifecycle callbacks, restructured file parts, moved telemetry to `@ai-sdk/otel`, and changed tool `context`. Bundle: `ai` 462 kB minified, 116 kB gzipped, three dependencies; `@ai-sdk/anthropic` 4.0.65 unpacks to 2.5 MB [V]. For a server-side harness the bundle size is not a constraint; the churn is.

**Anthropic coverage** [V, provider doc source, 79 kB]. Exposed through `providerOptions.anthropic` or provider-defined tools: `cacheControl` with the 1-hour TTL; `thinking` adaptive (with `display`) and budget-based; `effort` low to max; `contextManagement.edits` for `clear_tool_uses_20250919`, `clear_thinking_20251015` and `compact_20260112`; on-demand `compaction: {type: 'summarize'}` and threshold compaction; server tools for web search (20260318, 20260209), web fetch, code execution (20260120, 20250825), tool search BM25 and regex, memory, text editor, bash, computer toolset 20260801, advisor 20260301; `deferLoading` per tool and a custom search that returns `tool-reference` parts from `toModelOutput`; `structuredOutputMode` (`outputFormat`, `jsonTool`, `auto`); citations; PDF; Files API and `container`; `mcpServers`; `safeguards` and `fallbacks`; mid-conversation system messages with `effort` and `toolChanges`; `taskBudget`; `speed` (fast mode); `inferenceGeo`; agent skills. Not present in the doc [V, grep]: `eager_input_streaming`, `input_examples`, and the preserved-thinking controls (`prefix_mismatch_behavior`). The doc's cache-minimum table stops at Opus 4.5 and Haiku 4.5 and omits the 512-token minimum of the 5-series [V, compared with Anthropic's caching page], a concrete instance of documentation lag. The escape hatches are real and layered: `providerOptions` at call, message and part level; `providerMetadata` back on parts and the finish event [V].

**OpenAI coverage** [V]. Responses is the default since 5.0 (`openai.chat` opts back). Exposed: `reasoningEffort` none to max, reasoning summaries, `previousResponseId`, `conversation`, `store`, `promptCacheOptions` (`mode`, `ttl`); built-in web search, file search, code interpreter, image generation, computer use, MCP, local shell, shell; strict JSON schema by default. GPT-6 and later reject `temperature`, `topP`, `logprobs`.

**OpenAI-compatible provider** [V]: `baseURL`, `headers`, `queryParams`; chat with tools and streaming, structured outputs, reasoning tokens, `video_url`. LM Studio is the worked example; Ollama and llama.cpp sit in community providers; vLLM is not mentioned.

**Peers at the same layer.**

| Library | Abstracts | Lag risk | Escape hatch |
|---|---|---|---|
| LangChain.js 1.x [V] | `initChatModel("provider:model")`; standard params; tool calling, structured output, multimodal, reasoning | Provider packages track vendors separately; the featured table has four capability columns (stream, tool calling, `withStructuredOutput`, multimodal) | Constructor options and integration-specific fields |
| Mastra model router [V PR 2025-09-30; counts from docs] | `provider/model` strings over 7,618 models and 210 providers; fallbacks | Wraps the AI SDK's OpenAI-compatible model class with a models.dev registry; inherits AI SDK spec churn; provider-native features only where the OpenAI dialect has a slot | Config object (`url`, `apiKey`, `headers`) |
| LlamaIndex.TS [S/I] | `Settings.llm`; chat, complete, streaming; OpenAI, Azure, Ollama, HF, Replicate listed | Smaller provider set; capability metadata per LLM class [I] | Provider constructor options |
| OpenRouter [V, live `/api/v1/models`] | One OpenAI-format API; per-model `supported_parameters` (for claude-sonnet-4.6: `tools`, `tool_choice`, `reasoning`, `reasoning_effort`, `response_format`, `structured_outputs`, `verbosity`, ...) and `input_modalities` | Hosted; Anthropic levers reach it only as OpenAI-format fields; `cache_control` on content parts is translated to `prompt_cache_breakpoint` and back | Vendor fields on content parts |
| Portkey gateway [V README claims] | OpenAI-compatible unified API and native passthrough; 1,600+ models, 45+ providers; TypeScript; "<1ms", 122 kB | Same intersection problem as any gateway | Passthrough route |
| Token.js [V] | Client-side TypeScript, OpenAI format, 12+ providers | Feature matrix marks 9 of 12 providers with function calling; release date not visible | None documented |

### 6. Option C checked: translation proxies

**LiteLLM** [V, docs 2026-09-27]. Two routes. The unified `/v1/messages` accepts Anthropic format and routes to "all LiteLLM supported providers"; the page documents thinking (`budget_tokens`, `summary` forwarded downstream), cache usage fields, tools, `tool_choice` and streaming, and says nothing about images, PDFs, server tools or MCP at that endpoint [V, absence]. The `/anthropic/*` passthrough forwards the native body with no translation, adds virtual-key auth, cost tracking and logging, and supports beta headers, batches and `count_tokens`. For OpenAI-format calls, unsupported params raise unless `drop_params` is set, and "any non-openai param is provider specific and passes it in as a kwarg". The model map declares 43 distinct `supports_*` keys, including `supports_tool_search`, `supports_anthropic_compaction`, `supports_mid_conversation_system`, `supports_prompt_cache_breakpoint`, `supports_thinking_cache_preservation` and `supports_fast_mode` [V, `model_prices_and_context_window.json`]. Footprint: a Python service; Postgres is required for virtual keys and spend tracking, Redis "once you run more than one instance". Benchmark: four instances at 4 CPU and 8 GB served 1,170 requests per second at 111.73 ms average, about 2 ms of proxy overhead. Cadence: eight tags in three days across five parallel stable branches and a dev line (`v1.104.0-dev.2` current) [V, year not shown on the page]. Known incident: versions 1.82.7 and 1.82.8 on PyPI (2026-03-24) carried a credential stealer in a `.pth` file after a compromised Trivy CI action leaked publishing credentials; remediation was credential rotation, "CI/CD v2", and cosign-signed images from v1.83.0-nightly [V, LiteLLM security post]. The deploy page now says to pin image tags [V].

**Bifrost** (Go) [V README, docs summary]: `/v1/chat/completions`, an `/anthropic` base URL that the Anthropic SDK can point at, `/genai`; model-prefix routing (`openai/gpt-4o-mini` through the Anthropic SDK); claims 11 µs overhead at 5k RPS on a t3.xlarge; npx, Docker, Helm, or as a Go library; `anthropic-beta` headers must be allowlisted in settings. The docs say the Anthropic integration "supports all features that are available in both the Anthropic SDK and Bifrost core functionality" and do not enumerate what a cross-provider call drops [V, absence]. Releases are coordinated across core (v1.10.4) and transport (v2.2.3) on consecutive days [V].

**agentgateway** (Rust) [V]: an OpenAI-compatible API in front of OpenAI, Anthropic, Bedrock, Gemini, Vertex and any OpenAI-format custom provider; the Anthropic provider takes native `/v1/messages` passthrough with header injection, or a Chat Completions request "converted to the Messages format, and thinking history is carried across turns only when the client sends back `reasoning_signature`"; `thinking.type` and `output_config.format` are supported. Standalone YAML or Kubernetes Gateway API, with an MCP gateway and A2A in the same binary.

**Configuration models** [V]: LiteLLM keeps a `model_list` in `proxy_config.yaml` (and a model must be declared there before batch costs can be tracked on the passthrough); Bifrost offers a web UI, an API, or a file; agentgateway is flat YAML standalone or Gateway API resources on Kubernetes. All three want their own credential store, which is the vault question from `02-harness.md` §"Where the model is" arriving through a second door.

**What runtime pluggability costs.** Every gateway offers two things under one name. Passthrough keeps every lever and swaps nothing: the harness still speaks Anthropic to Anthropic. Translation swaps providers and keeps the intersection of two dialects plus whatever vendor fields the translator has hand-mapped (`cache_control` to `prompt_cache_breakpoint` at OpenRouter; `reasoning_signature` at agentgateway; kwargs pass-through at LiteLLM). Claude Code shows the cost from the client side: behind a gateway it turns off `tool_reference` blocks (2.1.70) and needs `ENABLE_TOOL_SEARCH` forced to keep tool search (2.1.72) [V]. Anthropic's own tool-search page notes Bedrock's Converse API cannot carry it at all [V].

### 7. Option A checked: what an own port must define

Derived from the two wire formats and the open-weights servers [V unless marked].

- **Content blocks.** Text, image, document (PDF), tool use, tool result, and three opaque kinds that must round-trip unchanged: thinking blocks (signed, model-bound on Anthropic) or reasoning items (`encrypted_content` on OpenAI); compaction blocks (signed, Anthropic `compact-2026-09-04`) or compaction items (encrypted, OpenAI `/responses/compact`); server-tool use and results, including `tool_reference`. The port carries them as `provider_opaque` with the adapter name and never edits them.
- **Tool calls and results.** Id, name, JSON input, `caller` (direct or code execution), error flag; all parallel results in one message (Anthropic); `namespace` on OpenAI calls. Declarations carry `strict`, `defer`, `allowed_callers`, `input_examples`, `eager_input_streaming` as optional per-adapter fields.
- **Stop reasons.** Anthropic `end_turn`, `max_tokens`, `tool_use`, `pause_turn`, `refusal` (with `stop_details`), `stop_sequence`; OpenAI `status` plus `incomplete_details` and function-call items. Normalise to completed, needs-tools, paused, truncated, refused, error, and keep the raw value.
- **Usage.** Input and output; cache creation and cache read (Anthropic); cached and reasoning tokens (OpenAI); server-tool counts; `speed`, `inference_geo`.
- **Streaming.** A normalised event stream over each vendor's SSE; tool-input deltas (`input_json_delta`, or `response.function_call_arguments.delta`) accumulated inside the adapter, since Anthropic's eager streaming hands validation to the client.
- **Cache control.** Explicit breakpoints (up to 4, order tools, system, messages) versus automatic plus `prompt_cache_key` and `allowed_tools`, versus server-side prefix caching that is not billed (vLLM). Model it as a hint the adapter maps or ignores.
- **Thinking.** Adaptive plus `effort` (and `display`) versus `reasoning.effort` plus summaries; legacy `budget_tokens`; forced `tool_choice` rejected on Fable 5.1 and Opus 5.5 [S, skill].
- **Server tools.** Declared per adapter with dated type strings; the harness asks for a capability (web search), the adapter picks the version.
The same surface, as the three wire shapes an adapter has to bridge [V unless marked]:

| Port surface | Anthropic Messages | OpenAI Responses | OpenAI-compatible servers (vLLM, llama.cpp, Ollama) |
|---|---|---|---|
| Opaque reasoning | `thinking` block, signed, model-bound; pass back unchanged | `reasoning` item with `encrypted_content`; pass back unchanged | `reasoning_content` field, plain text, not signed; `--reasoning-format` decides (llama.cpp) |
| Opaque summary of history | `compaction` block, signed | compaction item, encrypted; `/responses/compact` | None; the harness summarises |
| Tool declaration extras | `strict`, `defer_loading`, `allowed_callers`, `input_examples`, `eager_input_streaming`, `cache_control` | `strict`, `defer_loading`, `namespace`, `allowed_tools` on `tool_choice` | `strict` sometimes; parser flags on the server |
| Tool call shape | `tool_use` {id, name, input, caller, toolset_name} | `function_call` item {call_id, name, namespace, arguments string} | Chat `tool_calls[]` with arguments string |
| Multiple results | All `tool_result` blocks in one user message | One `function_call_output` item per call [I] | One `tool` message per call [I] |
| Stop | `stop_reason` enum plus `stop_details` | `status` plus `incomplete_details` | `finish_reason` (`stop`, `length`, `tool_calls`) [I] |
| Cache lever | Up to 4 explicit breakpoints; tools, system, messages order | Automatic; `prompt_cache_key`, `prompt_cache_options.ttl` | Server prefix cache, no request field |
| Thinking lever | `thinking: {type: adaptive, display}`, `output_config.effort` | `reasoning: {effort, summary}` | `reasoning_effort` passed to the chat template [V llama.cpp]; server budget flags |
| Server tools | Dated `type` strings in `tools` | Typed tool objects (`web_search`, `file_search`, `mcp`, ...) | None |
| System prompt mid-turn | `role: system` in `messages` (Opus 4.8+) | `developer` items [I]; `additional_tools` with `role: developer` [V] | System messages anywhere, template-dependent [I] |

- **Capability declaration.** Precedents: LiteLLM's `supports_*` map (43 keys); OpenRouter's per-model `supported_parameters` and `input_modalities`; the AI SDK, which has no capability flags on the provider interface beyond `supportedUrls` and keeps a hand-maintained per-model table in the docs (image input, object generation, tool usage, computer use, web search, tool search, compaction) [V]; LangChain "model profiles" from 1.1 [S]; Anthropic's Models API `capabilities` field since March 2026 [S, skill]; MCP `server/discover` capabilities as the protocol-level analogue [V]. LiteLLM's `drop_params` is the opposite policy: drop silently at runtime. A manifest that asks for compaction against an adapter that lacks it should fail the build, and the LiteLLM key list is a usable starting vocabulary.

### 8. The intersection, measured

Dates are Anthropic release-note dates unless marked [V, release notes fetched 2026-09-27].

**Anthropic-only today:** memory tool (beta 2025-09-29); context editing `clear_tool_uses` and `clear_thinking` (2025-09-29); tool use examples `input_examples` (no beta header since 2026-02-17); fine-grained tool streaming (2025-06-11, now `eager_input_streaming`); programmatic tool calling via `allowed_callers` (2025-11-24, no header since 2026-02-17); task budgets (beta 2026-04-16); advisor tool (beta 2026-04-09); mid-conversation system messages (2026-05-28) with per-message effort and `clear_at`; mid-conversation tool changes (beta 2026-07-01) [S]; client toolsets for computer and browser use (2026-08-19); document citations; explicit cache breakpoints and the 1-hour TTL; on-demand compaction with kept recent turns and background mode (beta 2026-09-14); `pause_turn`; `speed`, `inference_geo`, `fallbacks`, safeguards [V, Vercel doc and skill].

**Both, with a different shape:** tool search (Anthropic 2025-11-24, regex or BM25 with server-side expansion; OpenAI gpt-5.4+, namespaces, hosted or client-executed, tail injection); compaction (signed block versus encrypted item and a compact endpoint); reasoning (adaptive thinking plus effort versus `reasoning.effort` plus summaries; both require opaque items passed back unchanged); prompt caching (explicit versus automatic; both 0.1× reads and 1.25× writes on the newest models); structured outputs and strict tools (both GA); web search, code execution, computer use, MCP connector (both); PDF and files (both); parallel-call control; tool choice (`allowed_tools` has no Anthropic equivalent, `any`/`tool` are gone on the newest Claude models). OpenAI-only: server-side conversation state (`previous_response_id`, `conversations`), file search.

**Universal, including open-weights servers:** system prompt, text and base64 images, JSON Schema tool declarations, tool calls and results, SSE streaming, max tokens, stop sequences, usage counts. Sampling parameters are no longer universal: GPT-6+ rejects `temperature` [V] and the Fable 5 family rejects them [S]. Open-weights wire formats [V]: vLLM serves OpenAI chat, completions and Responses plus Anthropic `/v1/messages` and `/v1/messages/count_tokens`; tool calling needs `--enable-auto-tool-choice` and a `--tool-call-parser`; the Anthropic endpoint's reasoning handling is still being hardened (issues #29915, #58647) [S]. llama.cpp's server is "Anthropic Messages API compatible" alongside OpenAI chat, with `--reasoning-format`, `--reasoning-effort` and `--reasoning-budget` flags and `--jinja` tool calling. Ollama speaks OpenAI chat with tools, JSON mode, vision and reasoning, no `tool_choice`, a non-stateful Responses endpoint and no Anthropic endpoint. So an "OpenAI-compatible" adapter reaches all three, an Anthropic-format adapter reaches two, and on all three the cache and thinking levers are server flags rather than request fields.

---

## Matrix 1: tool-exposure mechanisms

| Mechanism | Who searches | Model sees at turn start | Cache effect | Limits | Measured effect | Precedent |
|---|---|---|---|---|---|---|
| Static full list | Nobody | All N schemas | Stable prefix; any change invalidates all | Gemini 128 or 512 declarations [S/V] | Baseline; 8 to 19 points lost per few added similar tools [V] | BFCL, most agents |
| Static allow/deny per agent or phase | Author | The allowed subset | Stable per phase; a phase switch is a full miss unless done as `tool_addition` | None | Not separately measured | Claude Code subagents, plan mode; Cline; GitHub `--toolsets` |
| Server-side search, deferred tools (Anthropic) | Model via regex or BM25 server tool | Pinned tools only | Prefix untouched; expansions appended | 10,000 deferred; 200/500-char queries | 79.5 to 88.1% (Opus 4.5); over 85% token cut | Anthropic API, Claude Code |
| Server-side search, namespaces (OpenAI, Azure) | Model via hosted `tool_search` | Names and descriptions of functions or namespaces, no schemas | Tail injection preserves cache | gpt-5.4+; "fewer than 10 per namespace" | Not published | OpenAI Responses |
| Client-side search or retrieval | Harness (embeddings, BM25, gateway) | Pinned tools plus a search tool | Same as above when results are appended | Your index | 13.62 to 43.13% (RAG-MCP); K≈2 beats K=5 by 6 points (Meta) | AgentCore, OpenAI client mode, Anthropic custom search |
| Meta-tool router | Model calls `enable_toolset` | Group names | Enabling a group changes the list: a miss unless deferred | Group granularity | Not published | GitHub dynamic toolsets, Claude Code `ToolSearch select:` |
| Code execution as access | Model writes code | A code tool plus tool stubs | Results filtered before context | Sandbox required | 11% better, 24% fewer input tokens (Anthropic); 98.7% example | Anthropic PTC, Cloudflare Code Mode |

## Matrix 2: model-port options against the levers

| Lever | A. Own port with official SDKs | B. Vercel AI SDK | C. Translation proxy (translated route) |
|---|---|---|---|
| Explicit cache breakpoints, 1-hour TTL | Full | `cacheControl` [V] | Passthrough only; translated route maps to `prompt_cache_breakpoint` where the dialect allows [V] |
| Adaptive thinking, effort, display | Full | Full [V] | `thinking` forwarded, `summary` preserved (LiteLLM) [V]; agentgateway carries history only via `reasoning_signature` [V] |
| Compaction (threshold, on demand, background) | Full | Threshold and on-demand [V]; background not seen [I] | LiteLLM declares `supports_anthropic_compaction` [V]; not documented on the unified route |
| Context editing | Full | Full [V] | Not documented [V, absence] |
| Tool search and `defer_loading` | Full | `deferLoading`, custom `tool-reference` [V] | Claude Code disables `tool_reference` behind gateways [V] |
| Programmatic tool calling | Full | `allowedCallers` present [V] | Not documented |
| Server tools (web, code, computer, MCP connector) | Full | Full, dated versions [V] | Not documented on unified route; passthrough only |
| Mid-conversation system and tool changes | Full | Both [V] | LiteLLM `supports_mid_conversation_system` key exists [V]; tool changes not documented |
| Task budgets, advisor, fast mode, safeguards | Full | All four [V] | Not documented |
| `eager_input_streaming`, `input_examples`, preserved-thinking controls | Full | Not in the provider doc [V] | Passthrough only |
| OpenAI Responses state, compaction, allowed_tools | Full | State and caching [V]; `allowed_tools` not seen [I] | LiteLLM translates OpenAI params broadly [V] |
| Open-weights servers | One OpenAI-format adapter covers vLLM, llama.cpp, Ollama [V] | OpenAI-compatible provider [V] | Native; this is the case C exists for |
| Capability declaration | You define it; LiteLLM's 43 keys are a vocabulary | None on the interface; a docs table [V] | LiteLLM `supports_*` [V]; OpenRouter `supported_parameters` [V] |
| Lag and churn | Your maintenance, no lag | A major every 6 to 8 months; features ship fast, docs lag (cache table) [V] | Multiple releases a day (LiteLLM); passthrough has no lag, translation does |
| Extra process and risk | None | None | Sidecar per pod or a shared gateway; Postgres and Redis for LiteLLM features; the 2026-03-24 supply-chain compromise [V] |

## Recommendation criteria

Conditions, not a decision.

- **Option A wins** when the manifest will ask for Anthropic-shaped levers by name (compaction blocks, deferred tools, programmatic tool calling, mid-conversation changes), when a fake adapter for deterministic tests matters, and when the port can be kept to the primitives both vendors now share: opaque round-trip blocks, deferred tools with tail expansion, a capability list per adapter. The cost is the adapter code and its upkeep, about the size of the Anthropic and OpenAI wire formats plus one OpenAI-compatible variant for open-weights servers.
- **Option B wins** when breadth of providers on day one matters more than a stable interface, and the team accepts a major-version migration every six to eight months and the occasional gap between a vendor feature and its `providerOptions` key. Its Anthropic coverage today is close to complete, so the lag argument in `02-harness.md` §"Options for the adapters" is weaker than written; the churn argument is stronger.
- **Option C wins** when several harness images, or non-harness callers, must share credentials, budgets and audit at one egress point, and when swapping the model without a rebuild is a hard requirement. It should then run in passthrough mode for the first-party provider and translation mode only for the open-weights case, with the manifest's capability check deciding which levers are allowed on the translated route. Treat it as an egress concern (`02-harness.md` §"Where the model is") rather than the port.
- **On tool exposure**, shape B in §4 is the floor for a 30-to-40-tool agent: pinned core, searchable rest, every schema still built into the image. Add shape C's phase gates only if a workload shows edit-phase tools misfiring during planning; the measured loss from a handful of extra tools is 8 to 19 points, which a pinned set of five and a search tool already avoids.

## What this changes in `02-harness.md`

- §"Options for the adapters", row B: "the library's abstraction and its lag behind provider features" understates the coverage and misplaces the cost. The Anthropic provider exposes the compaction, tool search, mid-conversation and budget levers today [V]; the cost is a major version every six to eight months and per-feature documentation lag, not missing features.
- §"Options for the adapters", row C: "runtime pluggability with no rebuild" holds only on the translated route, which drops the Anthropic-only column of §8. Passthrough keeps the levers but swaps nothing. The row should name the two routes.
- §"The pattern: port and adapter for the model", "what it costs": the intersection is now measurable. Both vendors share opaque round-trip items, deferred tools with tail expansion, and a dated server-tool vocabulary, so the port can be built on those shared primitives rather than on the lowest common denominator.
- Gap register G8: the question "by phase or by search" has a shipped answer at both vendors: search by default with a pinned core, phase gating as a harness policy on top. The row can move from open to "candidate shapes in §4; measurement needed against the chosen workload (G12)".
- New consideration for §"Where the model is": Claude Code's behaviour behind a gateway (`tool_reference` disabled, tool search off unless forced) [V] is evidence that an egress proxy must be transparent at the wire level, or the harness loses levers it never asked the proxy to touch.

## Sources

Fetched 2026-09-27 unless the date is the source's own.

1. Anthropic, Tool search tool, https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
2. Anthropic, Tool reference (client toolsets, tool definition properties), https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference
3. Anthropic, MCP connector (`mcp_toolset` configs), https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
4. Anthropic, Programmatic tool calling, https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling
5. Anthropic, Prompt caching, https://platform.claude.com/docs/en/build-with-claude/prompt-caching
6. Anthropic, Compaction overview, https://platform.claude.com/docs/en/build-with-claude/compaction
7. Anthropic, Release notes, https://platform.claude.com/docs/en/release-notes/overview
8. Anthropic engineering, Advanced tool use, 2025-11-24, https://www.anthropic.com/engineering/advanced-tool-use
9. Anthropic engineering, Code execution with MCP, 2025-11-04, https://www.anthropic.com/engineering/code-execution-with-mcp
10. Anthropic engineering, Effective context engineering for AI agents, 2025-09-29, https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
11. Claude Code CHANGELOG (raw, release 2.1.283), https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
12. Claude Code docs: MCP, https://code.claude.com/docs/en/mcp; permission modes, https://code.claude.com/docs/en/permission-modes; subagents, https://code.claude.com/docs/en/sub-agents
13. OpenAI, Function calling, https://developers.openai.com/api/docs/guides/function-calling
14. OpenAI, Tool search, https://developers.openai.com/api/docs/guides/tools-tool-search
15. OpenAI, Prompt caching, https://developers.openai.com/api/docs/guides/prompt-caching; Conversation state, https://developers.openai.com/api/docs/guides/conversation-state; Compaction, https://developers.openai.com/api/docs/guides/compaction
16. Microsoft Learn, Use tool search with the Azure OpenAI Responses API, ms.date 2026-07-15, https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/tool-search
17. AWS, Search for tools in your AgentCore gateway with a natural language query, https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-using-mcp-semantic-search.html
18. Google, Gemini API function calling, https://ai.google.dev/gemini-api/docs/function-calling; gemini-cli issue #19083, 2026-02-14, https://github.com/google-gemini/gemini-cli/issues/19083
19. MCP specification 2026-07-28: tools, https://modelcontextprotocol.io/specification/2026-07-28/server/tools; pagination, https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination; discovery, https://modelcontextprotocol.io/specification/2026-07-28/server/discover
20. GitHub MCP server README, https://github.com/github/github-mcp-server; GitHub Docs, Configuring toolsets, https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/configure-toolsets
21. Cloudflare, Code Mode, 2025-09-26, https://blog.cloudflare.com/code-mode/
22. Cline docs, Plan and Act, https://docs.cline.bot/features/plan-and-act
23. BFCL leaderboard (V4, updated 2026-04-12), https://gorilla.cs.berkeley.edu/leaderboard.html; category definitions, https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html
24. Rabinovich, Anaby-Tavor, On the Robustness of Agentic Function Calling, 2025-04-01, https://arxiv.org/abs/2504.00914
25. Kate et al. (IBM), LongFuncEval, 2025-04-30, https://arxiv.org/abs/2505.10570
26. Gan, Sun, RAG-MCP, 2025-05-06, https://arxiv.org/abs/2505.03275
27. Repantis et al. (Meta), How Many Tools Should an LLM Agent See?, 2026-05-23, https://arxiv.org/abs/2605.24660
28. Vercel AI SDK: Anthropic provider source, https://raw.githubusercontent.com/vercel/ai/main/content/providers/01-ai-sdk-providers/05-anthropic.mdx; OpenAI provider, https://ai-sdk.dev/providers/ai-sdk-providers/openai; OpenAI-compatible, https://ai-sdk.dev/providers/openai-compatible-providers; custom providers (V4 spec), https://ai-sdk.dev/providers/community-providers/custom-providers; migration guides 5.0, 6.0, 7.0, https://ai-sdk.dev/docs/migration-guides; npm registry for `ai` and `@ai-sdk/anthropic`; bundlephobia for `ai@7.0.118`
29. LangChain.js, Models, https://docs.langchain.com/oss/javascript/langchain/models; Chat integrations, https://docs.langchain.com/oss/javascript/integrations/chat
30. Mastra, Models, https://mastra.ai/docs/models; model router PR #8235 (merged 2025-09-30), https://github.com/mastra-ai/mastra/pull/8235
31. LlamaIndex.TS, LLMs, https://developers.llamaindex.ai/typescript/framework/modules/models/llms
32. OpenRouter, models API (live JSON), https://openrouter.ai/api/v1/models; prompt caching, https://openrouter.ai/docs/features/prompt-caching
33. Portkey gateway README, https://github.com/Portkey-AI/gateway; Token.js README, https://github.com/token-js/token.js
34. LiteLLM: `/v1/messages`, https://docs.litellm.ai/docs/anthropic_unified; Anthropic passthrough, https://docs.litellm.ai/docs/pass_through/anthropic_completion; input params, https://docs.litellm.ai/docs/completion/input; deploy, https://docs.litellm.ai/docs/proxy/deploy; benchmarks, https://docs.litellm.ai/docs/benchmarks; security update March 2026, https://docs.litellm.ai/blog/security-update-march-2026; model map, https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json; releases, https://github.com/BerriAI/litellm/releases
35. Bifrost README and releases, https://github.com/maximhq/bifrost; Anthropic SDK integration, https://docs.getbifrost.ai/integrations/anthropic-sdk/overview
36. agentgateway README, https://github.com/agentgateway/agentgateway; Anthropic provider, https://agentgateway.dev/docs/standalone/main/llm/providers/anthropic/; providers, https://agentgateway.dev/docs/standalone/latest/llm/providers/
37. vLLM, Online serving, https://docs.vllm.ai/en/latest/serving/online_serving/; Claude Code integration, https://docs.vllm.ai/en/stable/serving/integrations/claude_code/
38. llama.cpp server README, https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md
39. Ollama, OpenAI compatibility, https://docs.ollama.com/api/openai-compatibility
40. Cached reference: Claude Code `claude-api` skill, cached 2026-06-24 (pricing, model behaviour, beta headers), marked [S] where used
