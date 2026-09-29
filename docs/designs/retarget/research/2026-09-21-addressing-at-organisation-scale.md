# Addressing agents at organisation scale: registries, gateways and selection

Date: 2026-09-21. Research brief for the retarget conversation. Builds on `2026-09-16-multi-agent-coordination-prior-art.md` §3 (discovery) and `2026-09-21-human-entry-point.md` §1, §2, §4 and §5 (single-product entry points, routing numbers, the 30 to 40 ceiling). Those files cover three agents; this one covers a hundred. Work item: none yet.

Labels: `[V]` I fetched the page this session and the claim is on it; URL in Sources. `[S]` a secondary account of a page I could not fetch, named as such. `[I]` my inference from `[V]` material. The summary and each section's opening "Conclusion" paragraph synthesise the labelled claims beneath them and carry no separate label.

## Summary

Two separate things ship at scale: a registry that lists and governs agents, and a gateway that routes by address and policy. Every vendor control plane I checked inventories agents by owner, publisher, status and version, and searches by keyword; none picks an agent for a caller. Every gateway routes on a name the caller supplies: a path, a prefixed tool name, a topic, or a `model` field, never a model's judgement. An LLM that reads a request and picks an agent exists only inside chat products, bounded to roughly 30 to 40 choices or one use case. Past that bound, vendors ship search-before-select: a gateway-side search returns a handful of candidates and the model chooses among those. Hierarchy ships as parent and child agents or subagents inside one agent; the only router-of-routers specification, AGP, is a sample. Hierarchical addressing schemes are infrastructure ones (DNS, SPIFFE, broker topics, reverse-DNS names, URNs); the human-facing ones (Slack, Linear, Teams, email) are flat. Humans get a store with search, ownership, approval and pinning, plus an `@` picker; no vendor documents a picker limit or duplicate detection. Agent-to-agent authorisation is identity plus policy at the gateway, and schemes declared on the A2A card; no product documents cross-team delegation policy beyond RBAC. Surveys put the average at twelve agents (Salesforce, Feb 2026) and nearly 38% of organisations above 100 (Gravitee, April 2026); Microsoft gates usage filters at 4,000. The owner's assumption is half right: the API-gateway half ships everywhere; the choosing orchestrator is a separate, bounded, chat-only component. No source measures hierarchical routing accuracy past forty agents; the best figure is a trained router at 91.6% over "over 40" agents.

## 1. Registries and control planes

Conclusion: every registry records the same core (name, owner or sponsor, publisher, status, version, description) and searches by keyword; two add semantic search (Gemini, IBM). Only Foundry and Workday put a proxy in front of registered agents, and both proxy by the address the caller already holds. None selects an agent on a caller's behalf. The A2A standard still "does not prescribe a standard API for curated registries" `[V]`.

| Product | Records per agent | Search | Routes or lists | Label |
|---|---|---|---|---|
| Microsoft Agent 365 registry (M365 admin centre) | Four publisher types; export carries "over 30 different items" including Name, Status, Channel, Publisher, Version, Owner, Description, Platform, Instructions; cards for "Total agents", "Agents without owners", "Unmanaged agents" | Search box; filters Status, Publisher Type, Channel, Platform, Data source; Graph API preview | Lists and governs (block, delete, assign owner, pin); no routing | `[V]` ms.date 2026-09-21 |
| Microsoft Entra Agent ID | Identity accounts; sponsor recorded; "agent identities can be paired with agents' user accounts"; blueprints | Entra admin centre shows only agents with an Agent ID | Identity and policy only; "Agent 365 becomes the unified registry and control plane" | `[V]` 2025-11-06, convergence 2026-04-05 |
| Microsoft 365 Agent Store | Publisher, Channel, Last updated, Capabilities, Knowledge, Actions, Certification | Browse "All agents", "Built by your org", "Agents for your team" | Lists; admin approves requests | `[V]` ms.date 2026-04-17 |
| Microsoft Foundry Control Plane | Name, Source, Project, Status (Running, Stopped, Blocked, Unknown), Version, Published as, error rate, cost, tokens, Runs, Entra ID | "unified, searchable table of all AI assets across projects within a subscription"; filter by Source | Lists; for custom agents "Foundry uses API Management to act as a proxy" and "Clients and users must use this URL" | `[V]` 2026-05-06, 2026-07-15 |
| Google Gemini Enterprise Agent Registry | Agents, MCP servers, tools, skills; A2A card skills extracted on registration; URN identifiers scoped by project and location | "keyword, prefix, and semantic searches"; semantic mode "is optimized for orchestrator agents discovering relevant capability bundles" | Lists and resolves; Agent Gallery is the user surface (prior file §2) | `[V]` updated 2026-09-18 |
| Salesforce Agentforce Command Center | "full visibility and control over all your AI agents from a single mission control"; per-agent credits and performance | Not on the page | Observability; routing is inside the primary agent (§4) | `[V]` no date |
| ServiceNow AI Control Tower | AI assets "organized by display name, provider, vendor, managed by, lifecycle phase, state, status, and risk classification"; models, systems, prompts, datasets, MCP servers | Not detailed on the page | Inventory; the orchestrator is a separate component (§4) | `[V]` updated 2026-03-12 |
| IBM watsonx Orchestrate catalogue | Description, capabilities, source, category tags, status labels (New, Preview, Deprecated), evaluation metrics | "keywords or natural language queries"; filters by type, category, application, publisher | Lists; AI Gateway can "scan connected platforms and discover the agents running on them" (Bedrock GA 2026-08-31) | `[V]`; discovery endpoint `[S]` |
| Workday Agent System of Record | Name, description, version, provider, platform, skills, execution modes via `POST /agentDefinition`; security groups per agent | Agent Management Hub | Agent Gateway "validates the appropriate security groups" and forwards agent calls into Workday | `[V]` spec v1.2 (2026.05) |
| UiPath Maestro | An agent is a BPMN Service task; "Maestro invokes these agents by calling REST endpoints" | No catalogue mentioned | Routes by the task in the process model | `[V]` no date |
| AWS AgentCore | Gateway targets: MCP, HTTP, inference; quotas page also lists an "AWS Agent Registry" with discoverable-record search APIs | `x_amz_bedrock_agentcore_search` over tools | Gateway routes (§2); registry contents not documented on fetched pages | `[V]` quotas; registry semantics `[I]` |
| AGNTCY Agent Directory | OASF records: skills, locators, signatures; "distributed peer-to-peer network"; Kademlia DHT | Skill taxonomy "routable in the DHT" | Lists and verifies; no request routing stated | `[V]` GitHub v1.7.0, arXiv 2025-09-23; docs hosts unreachable |
| MCP Registry | `server.json`: reverse-DNS `name`, description, version, packages, remotes | Install-time lookup (prior file §3) | Lists | `[V]` |
| A2A registry work | Discussion #741 proposes `GET /agents/public`, `GET /agents/entitled`, `POST /agents/search`; open since 2025-06-10; May 2026 call to split core from extensions | By capability, in the proposal | Not in the spec; AGP extension is a sample (§4) | `[V]` |

Notes `[V]`: Microsoft's registry counts "Agents without owners" and "Unmanaged agents" as first-class summary tiles and pins at most three agents per user. Foundry's proxy keeps the agent's own auth. Its instruction is to "provide the same authentication mechanism as if you're using the original endpoint." Gemini's registry auto-registers agents deployed on its runtime and needs manual `Service` resources for the rest. `[I]`: the registries converge on the A2A card's fields plus owner and status; the card is the de facto record, the registry API is not standard.

## 2. Gateways

Conclusion: every gateway routes on an explicit address and enforces policy; none runs a model to choose the route. The "search" features are retrieval tools the model calls, and the gateway returns candidates. None documents state about in-flight work beyond MCP sessions. Scale statements are quotas, not design guidance.

| Gateway | Fronts | Routes on | Model in path | Auth and identity | State | Scale statements |
|---|---|---|---|---|---|---|
| agentgateway (Linux Foundation) `[V]` | MCP, A2A, OpenAI-compatible LLM APIs, HTTP, gRPC | Routes and backends in config; "which tools on which MCP targets a caller may reach" | No | JWT, API key, OAuth 2.0, Basic, OIDC; CEL "allow, deny, and require rules"; OPA delegation | None stated | None stated |
| Kong AI Gateway 2.0 `[V]` | LLM providers, MCP servers, A2A | Kong routes; AI MCP Proxy modes passthrough-listener, conversion, listener (binds tools by tag) | No | OAuth2 plugin; ACL on 3.13+ | None stated | None stated |
| Docker MCP Gateway `[V]` | MCP servers from catalogue, OCI, MCP Registry, files | Profiles; tools addressed as `<server>.<tool>` | No | Built-in OAuth; credential injection | None stated | None stated |
| Cloudflare AI Gateway `[V]` | LLM providers | Gateway URL per account and gateway; dynamic routing on "request body, headers, or metadata", rate limit, budget, percentage nodes | No; nodes name a "provider/model" | BYOK; Access | Logs, cache | None stated |
| Cloudflare MCP Server Portals `[V]` | MCP servers | One portal URL; tools renamed `{server_id}_{original_name}` | No | Access policies per user; per-tool allow lists | None stated | "Each portal supports up to 80 MCP servers" |
| AWS AgentCore Gateway `[V]` | Lambda, OpenAPI, Smithy, MCP servers, HTTP targets including A2A, model providers | MCP targets aggregated into one `tools/list`; HTTP targets "address each target individually through path-based routing"; inference by `model` field | No; `x_amz_bedrock_agentcore_search` is a tool the model calls | Inbound OAuth (JWT) or IAM; outbound credential providers; interceptors on JWT claims; Cedar on IAM principals | MCP sessions optional | 1000 gateways per account, 100 targets per gateway, 1000 tools per target; search calls 25 per minute |
| Microsoft Foundry Toolbox `[V]` | MCP, OpenAPI, A2A agents, built-in tools | "single MCP-compatible endpoint"; tool search exposes `tool_search` and `call_tool` | No; search is a meta-tool | Entra ID and OAuth passthrough; versioning | None stated | "A single toolbox can hold hundreds of tools" |
| Foundry Control Plane proxy `[V]` | Registered custom agents | New APIM URL per agent | No | Original scheme passes through; block per agent | None | None stated |
| kagent with agentgateway `[V]` | Agents as CRDs; "Agentgateway acts as a proxy for traffic between tool servers and agents" | Kubernetes Service and card path (prior file §3) | No | "AccessPolicy-based fine-grained authorization for agents and MCP tools" | None stated | None stated |
| Agent Router (formerly Envoy AI Gateway) `[V]` | LLM providers, MCP servers | Per identity: "control over what each identity can discover and invoke" | No | Permissions, quotas, usage attribution | None stated | None stated |
| Solace Agent Mesh `[V]` | A2A over an event broker | Topic `{namespace}/a2a/v1/agent/request/{target_agent_name}` | Orchestrator agent is an LLM (§7); the broker is not | Gateway "retrieve your permission scopes via its AuthorizationService" and stamps them on the message | Broker queues | None stated |
| Solo.io agent mesh `[V]` blog 2025-04-24 | Gateway plus Istio ztunnel plus registry | Card lookup; "deny-all" default | No | SPIFFE workload identity combined with user identity | None stated | None stated |

Hierarchies: no gateway page describes gateways of gateways. AgentCore's model is one gateway with many targets; Toolbox is one endpoint per toolbox; portals cap at 80 servers `[V]`. `[I]`: at a hundred agents each of these holds the set in one namespace and relies on naming prefixes rather than tiers.

## 3. Addressing schemes

Conclusion: infrastructure schemes carry hierarchy in the name; human-facing schemes are flat identifiers resolved by a picker. Nothing standard names an agent by organisation, team and agent; the closest are SPIFFE paths, broker topics, and Gemini's URNs.

| Scheme | Form | Hierarchy | Label |
|---|---|---|---|
| Kubernetes Service DNS | `my-svc.my-namespace.svc.cluster-domain.example`; unqualified names resolve in the pod's namespace | Namespace, then service | `[V]` |
| kagent | Service name plus `/.well-known/agent-card.json` | Inherits Kubernetes | `[V]` prior file §3 |
| A2A Agent Card | `url`, `additionalInterfaces`, `provider`, `version`; well-known URI per domain | Host only | `[V]` spec v1.0.0 |
| MCP Registry | `io.[domain]/[server-name]` reverse-DNS | Publisher, then server | `[V]` |
| SPIFFE | `spiffe://trust-domain/path`, e.g. `spiffe://acme.com/billing/payments`; SVID as X.509 or JWT | Trust domain, then path | `[V]` |
| Entra agent identity | Application and object IDs; optional paired agent user account | Flat within a tenant | `[V]` |
| Agent 365 agent with identity | "Agent's name and email address can be changed in Microsoft 365 admin center"; admins "search for the agent name in the search bar" and pick "the agent user" | Domain only | `[V]` ms.date 2026-08-11 |
| Teams and Copilot mention | "enter @, select your agent from the list"; in a team "team members can '@mention' it in any team channels" | Flat | `[V]` |
| Slack | `<@U0LAN0Z89>` bot user ID; `app_mention` only in channels the app is in | Flat | `[V]` |
| Linear | Agent user in mention and assignee menus | Flat | `[V]` prior file §2 |
| Gemini Agent Registry | `urn:agent:projects-N:projects:N:locations:REGION:agentregistry:services:AGENT_ID`; principals `principal://agents.global.org-ORG.system.id.goog/...` | Organisation, project, location, agent | `[V]` |
| AgentCore Gateway | `https://{gateway-Id}.gateway.bedrock-agentcore.{Region}.amazonaws.com`; ARN per gateway | Account, region, gateway; targets by path | `[V]` |
| NATS subjects | Dot tokens, `*` and `>` wildcards; "app.region.service.entity.action"; "Limit to ~16 tokens and under 256 characters" | Arbitrary depth | `[V]` |
| Solace Agent Mesh | `{namespace}/a2a/v1/agent/request/{name}`; discovery `{namespace}/a2a/v1/discovery/agentcards` | Namespace, then agent | `[V]` v1.28.7 |
| `agent://` URI (paper) | "a trust root ... a hierarchical capability path ... a sortable unique identifier" | Proposed | `[V]` arXiv 2601.14567 |

`[I]`: email and Teams give an agent the same address shape as a person, which is why Agent 365 can put it in the people search. That shape has no room for team or capability; the directory supplies those.

## 4. Selecting among many when the caller does not know the name

Conclusion: three mechanisms ship. An LLM over descriptions inside one bounded set; a search over a catalogue that returns a few candidates; and rule tables for machine events. Hierarchy ships as a parent that delegates to children, subagents inside one agent, or a use case that scopes the orchestrator. Nobody publishes accuracy for two or more tiers.

| Mechanism | Where it ships | Bound stated by the vendor | Label |
|---|---|---|---|
| LLM over descriptions | Copilot Studio (child and connected agents), Agentforce Agent Router over subagents, Microsoft 365 Copilot, ServiceNow orchestrator inside a use case | "more than 30-40 choices"; "five function candidate slots" (prior file §4); Agentforce: "avoid using generic classification criteria that can overlap" | `[V]` prior file; Agentforce `[S]` help page would not load |
| Search, then choose | AgentCore `x_amz_bedrock_agentcore_search`; Foundry `tool_search`; Gemini semantic search "for orchestrator agents"; Anthropic tool search (regex or BM25, up to 10,000 deferred tools, five results by default) | Foundry: with "hundreds of tools" the model is "more likely to select a similar but incorrect tool"; Anthropic: "degrades once you exceed 30–50 available tools" | `[V]` |
| Catalogue UI | Agent Store, Agent Registry search, Gemini gallery, IBM Discover, ServiceNow inventory | None | `[V]` |
| Rule tables for events | Linear triage rules, Jira transitions, GitHub assignment (prior file §5); ServiceNow record triggers select a use case; Maestro service tasks; Salesforce Flow action names the agent | None | `[V]`; Salesforce `[S]` developer blog HTTP 403 |
| Hierarchical routing | Copilot Studio parent over children; Agentforce subagents; ServiceNow use case, then agent; AGP gateways and squads with an "AGP Table" of capability announcements | AGP is a sample spec v1.0.0 in `a2a-samples` | `[V]`; Agentforce `[S]` |

Evidence on limits, all `[V]`: zero-shot GPT-4o over a fixed 12-agent catalogue scores F1 41.5 against 89.6 for a fine-tuned encoder (prior file §4). ACE-Router, a trained history-aware router, reports 91.6% agent selection over "over 40 mainstream agents" and 53.44% on MCP-Universe with a 2,005-tool bank. MoMA describes a two-layer design (category, then agent) over "over 20 expert agents" and gives no hierarchical-versus-flat number. Uno-Orchestra learns decomposition plus dispatch and reports 77.0% macro pass@1. `[I]`: every measured system sits at or below forty candidates per decision; the two-tier claims are design rationale, not measurement.

Catalogue sizes in production `[V]`: Salesforce's Connectivity Report (1,050 IT leaders, October to November 2025) puts the average at twelve agents, and "50% of agents currently operate in isolated silos". Gravitee's April 2026 survey of 750 leaders reports a December 2025 mean of about 37 and "Nearly 38% of organizations now operate more than 100 agents". IBM's June 2026 study of 2,000 executives anticipates "a 38% increase in the number of AI agents deployed" by 2027. The widely quoted "1,600 agents per enterprise" figure appears only in secondary accounts of IBM's Think 2026 material `[S]`. Microsoft's Agent Map disables usage filters above 4,000; the page says "4,000 agents" in one sentence and "4,000 users" in another `[V]`. AWS's quotas allow 1,000 agents per account and 100 targets per gateway `[V]`.

Machine events through an LLM `[V]`: Copilot Studio routes event triggers through generative orchestration (prior file §5). ServiceNow fires a use case by record event or chat and then lets the orchestrator pick among that use case's agents by instructions and "LLM planning". Everyone else names the agent in the rule: Linear, Jira, GitHub, Maestro, and Salesforce Flow `[S]`. Solace gateways turn an inbound request into a task for a named agent; only the orchestrator agent's delegations are model-chosen.

## 5. Humans at scale

Conclusion: the vendors' answer is a store with search and admin curation, a mention picker, and pinning to keep the visible set small. Ownership and retirement are first-class in Microsoft's registry; duplicate detection is not in any product I fetched.

| Product | How a person finds one | How they address it | Ownership and lifecycle | Label |
|---|---|---|---|---|
| Microsoft 365 Copilot and Agent 365 | Agent Store collections; `@` list; up to three admin-pinned agents; Agent Map "groups agents by the platform they were created on" | `@mention`, sidebar, Teams channel mention, email for identity-bearing agents | "Agents without owners" tile; assign, add, remove owner; block, uninstall, delete; usage filters find "unused ones" (tenants below 4,000 agents) | `[V]` |
| Teams app store | "Built for your org" after admin approval; "Built with Power Platform" limited by the tenant's "discovery policy" | Install, then chat or channel mention | Admin manages approved entries | `[V]` ms.date 2026-08-17 |
| Gemini Enterprise | Agent Gallery cards (prior file §2); registry keyword and semantic search | `@agent_name` | Registry lifecycle states; IAM principals per agent | `[V]` |
| IBM watsonx Orchestrate | Discover with natural-language search and filters | Pick from catalogue | Labels New, Preview, Deprecated | `[V]` |
| Linear, Jira, GitHub, Slack | Mention and assignee menus; Jira **Agents** button (prior file §2) | Mention, assign, DM | Workspace admins install | `[V]` prior file |
| Workday | Agent Management Hub | Not a chat surface | "register, configure, activate, and deactivate" | `[V]` |

Vendor guidance on sprawl `[V]`: Entra's stated design goal is to "retire agents without leaving orphaned credentials or permission assignments behind". Microsoft's lifecycle page covers "visibility, access, distribution, and retirement". Foundry's Toolbox rationale is that without a centre "Teams re-implement the same tools independently". Copilot Studio sharing is by security group, individual, or "Everyone in <OrganizationName>", with chat access separate from authoring. Picker limits: no page states a maximum for the Teams or Slack mention list. The only stated cap is Microsoft's three pinned slots: "If a user has more than three pinned agents, users don't see agents with lower priority" `[V]`. `[I]`: at a hundred agents the mention list is a search box. The store's collections ("Built by your org", "Agents for your team") are the hierarchy.

## 6. Agents reaching agents at scale

Conclusion: authorisation lives at the gateway or platform, keyed on the caller's identity and a policy over the target. The A2A card carries the scheme; the gateway carries the decision. Quotas exist as rate limits, not as per-caller budgets, except in Kong's identity tiers. No product documents a cross-team delegation policy; the closest is AGP's policy constraints, which are a sample.

| Product | Who may call which agent | Mechanism | Label |
|---|---|---|---|
| A2A spec v1.0.0 | Card declares `securitySchemes` and `security`; server "MUST NOT reveal existence of resources client is not authorized to access"; `TASK_STATE_AUTH_REQUIRED` mid-task; `signatures` on cards | Per-agent, declared | `[V]` |
| agentgateway | CEL "allow/deny rules over method, path, headers, and JWT claims"; MCP method rules; OPA | Policy on routes | `[V]` |
| AgentCore Gateway | Gateway, tool, operation and parameter levels; JWT claims in interceptors; Cedar on `principal.id`; resource-based policies | Policy per gateway; "deny access by default" advised | `[V]` |
| Cloudflare portals | Access policies; "The MCP server link will only appear in the portal for users who match an Allow policy" | Identity provider groups | `[V]` |
| Kong | ACL on the MCP proxy; OAuth2 scoping; "tiered budgets" via Kong Identity | Policy plus budget | `[V]` |
| Entra Agent ID | "Authenticate incoming messages ... allowing the agent to reliably identify the caller and make authorization decisions"; autonomous versus delegated access | Tokens per agent identity | `[V]` |
| Foundry Control Plane | Block a custom agent; original scheme still applies | Admin switch | `[V]` |
| Copilot Studio | Connected agents (prior file §1); sharing by security group or organisation for chat; collaborators need Environment Maker | Sharing, not delegation policy | `[V]` |
| kagent enterprise and Solo mesh | AccessPolicy CRDs; SPIFFE identity "combined with user identity"; deny-all default | Kubernetes policy | `[V]` |
| Workday | Agent Gateway validates the security groups configured for the agent | Platform policy | `[V]` |
| Solace Agent Mesh | Gateway stamps scopes into message user properties | Broker-side scopes | `[V]` |
| Claude Code | Deny rules for `SendMessage` and `ListAgents`; "a message from another session never counts as your consent" | Harness settings | `[V]` prior file §3, §7 |

Depth evidence is in the prior file §4 (MasDrift: 2.7% unauthorised at one level, 19.8% at three). `[I]`: none of the mechanisms above express "team A may delegate task type X to team B". They express "identity I may call tool or agent T". Cross-team policy is therefore assembled from group membership and tool-level allow lists.

## 7. The owner's assumption, tested

Conclusion: read as "a gateway that routes by address and policy", the assumption matches what ships everywhere. Read as "an LLM that reads a request and picks an agent", it matches only the chat front desks, which are bounded and product-local. Nobody ships the two as one global component.

| Reading | Products | What it is used for | Label |
|---|---|---|---|
| Gateway by address and policy, no model in the path | agentgateway, Kong, Docker MCP Gateway, Cloudflare AI Gateway and portals, AgentCore Gateway, Foundry Toolbox and APIM proxy, Agent Router, Workday Agent Gateway, Solace broker, kagent's agentgateway | Authentication, credential exchange, aggregation into one endpoint, tool-level allow lists, rate limits, audit; the caller names the target | `[V]` |
| LLM reads the request and picks an agent | Copilot Studio orchestrator, Agentforce Agent Router and primary agent, Microsoft 365 Copilot orchestrator, ServiceNow AI Agent Orchestrator, Solace orchestrator agent | A human's sentence in chat, or a use case already selected by rule; bounded to tens of choices | `[V]`; Agentforce `[S]` |
| Search inside the gateway, model chooses among results | AgentCore semantic search, Foundry tool search, Gemini semantic search, Anthropic tool search | Sets past the 30 to 50 bound, tools more than agents | `[V]` |

Microsoft states the split directly: Agent 365 "becomes the unified registry and control plane" and the orchestrators live inside Copilot Studio and Microsoft 365 Copilot `[V]`. Foundry's control plane proxies but does not choose `[V]`. Salesforce's own advice for mission-critical flows is to "declare the routing path explicitly rather than leaving it to inference" (prior file §1) `[V]`. `[I]`: the "global orchestrator" exists as a product only where the vendor also owns the chat surface. There it is one agent among the hundred, not a layer above them.

## What the evidence supports at a hundred agents

**Humans.** Confirmed: every vendor at this scale ships a store or gallery with search, ownership and admin approval `[V]`. The `@` picker is a search box `[V]`. Pinning and collections are how the visible set stays small; Microsoft caps admin pins at three `[V]`. Chat front desks exist but are bounded by their own guidance at 30 to 40 choices `[V]`. Unknown: any measured picker limit, any duplicate detection, and any study of humans choosing among many named agents.

**Machine events.** Confirmed: outside Copilot Studio, events reach an agent by a rule that names it or names a use case `[V]`. ServiceNow is the one product that puts a model in the path after the rule, and only within the use case's agents `[V]`. Confirmed: gateways route events and calls by path, tool name, topic or model field, never by a model's judgement `[V]`. Unknown: routing accuracy for any model-in-the-path event router at scale; no vendor publishes one.

**Agents.** Confirmed: agent-to-agent reach is a card or registry entry plus a gateway policy keyed on the caller's identity `[V]`. The card's `securitySchemes` and the gateway's claims-based rules are the whole mechanism `[V]`. Confirmed: search-before-select is the shipped answer to large tool sets, with Anthropic and Foundry both naming the degradation point in the tens `[V]`. Confirmed: hierarchy ships as parent and child, use case, or subagents (Agentforce, `[S]`), and AGP's capability routing is a sample `[V]`. Unknown: measured accuracy for two or more routing tiers over more than about forty agents, and any product's cross-team delegation policy beyond RBAC `[I]`.

## Sources

Fetched 2026-09-21 unless marked. Dates are as shown on the page.

1. Microsoft Entra, What are agent identities, ms.date 2025-11-06, updated 2026-06-15. https://learn.microsoft.com/en-us/entra/agent-id/what-are-agent-identities
2. Microsoft Entra, Agent Registry convergence with Microsoft Agent 365, ms.date 2026-04-05. https://learn.microsoft.com/en-us/entra/agent-id/agent-registry-convergence
3. Microsoft 365 admin, Agent Registry, ms.date 2026-09-21. https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-registry
4. Microsoft 365 admin, Use Agent Map, ms.date 2026-05-13. https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-map
5. Microsoft 365 admin, Governance and lifecycle actions for agents, ms.date 2026-08-20. https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-actions
6. Microsoft Agent 365 overview, ms.date 2026-08-19. https://learn.microsoft.com/en-us/microsoft-agent-365/overview
7. Microsoft Agent 365, Use and collaborate with agents with their own identity (preview), ms.date 2026-08-11. https://learn.microsoft.com/en-us/microsoft-agent-365/use
8. Microsoft, Agent Store in Microsoft Copilot, ms.date 2026-04-17. https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-agent-store
9. Copilot Studio, Connect and configure an agent for Teams and Microsoft 365 Copilot, ms.date 2026-08-17. https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-add-bot-to-microsoft-teams
10. Copilot Studio, Share agents with other users, ms.date 2026-07-30. https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-share-bots
11. Microsoft Foundry Control Plane overview, ms.date 2026-05-06. https://learn.microsoft.com/en-us/azure/foundry/control-plane/overview
12. Microsoft Foundry, Manage agents at scale, ms.date 2026-07-15. https://learn.microsoft.com/en-us/azure/foundry/control-plane/how-to-manage-agents
13. Microsoft Foundry, Register and manage custom agents, ms.date 2026-05-06, updated 2026-09-01. https://learn.microsoft.com/en-us/azure/foundry/control-plane/register-custom-agent
14. Microsoft Foundry, What is Toolbox, ms.date 2026-07-28. https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/tool-catalog
15. Google Cloud, Agent Registry (Gemini Enterprise Agent Platform), 2026-09-18. https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry
16. Google Cloud, Agent Registry: Register agents; Search for agents, tools, and skills; Key concepts, all 2026-09-18. https://docs.cloud.google.com/agent-registry/register-agents , https://docs.cloud.google.com/agent-registry/search-agents-and-tools , https://docs.cloud.google.com/agent-registry/concepts
17. Salesforce, Agentforce Command Center (no date). https://www.salesforce.com/agentforce/command-center/
18. Salesforce Help, Subagents. Not fetched: page returned a loading screen; claims taken from search-engine snippets of the page, marked `[S]`. https://help.salesforce.com/s/articleView?language=en_US&id=ai.agent_topics.htm&type=5
19. Salesforce Developers blog, Invoke Agentforce agents with Apex and Flow, 2025-04. Not fetched: HTTP 403; `[S]` from search snippets. https://developer.salesforce.com/blogs/2025/04/invoke-agentforce-agents-with-apex-and-flow
20. ServiceNow docs, AI asset inventory, updated 2026-03-12. https://www.servicenow.com/docs/r/intelligent-experiences/ai-control-tower/ai-inventory.html
21. ServiceNow Community developer article, Get familiar with agentic workflows and AI agents (no date on page). https://www.servicenow.com/community/developer-articles/get-familiar-with-agentic-workflows-amp-ai-agent/ta-p/3326559
22. IBM docs, Discovering the catalog (no date). https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=designing-discovering-catalog
23. IBM, New in watsonx Orchestrate: cross-platform agent discovery, GA 2026-08-31. https://www.ibm.com/new/announcements/new-in-ibm-watsonx-orchestrate-cross-platform-agent-discovery-custom-evaluation-and-agentops-agent-goes-ga
24. IBM, Introducing the Agentic Control Plane, 2026-07-02. https://www.ibm.com/new/announcements/introducing-the-agentic-control-plane
25. IBM Agent Connect, Agent discovery. Not fetched: HTTP 404; `[S]` from search snippets. https://connect.watson-orchestrate.ibm.com/acf/discovery/agent-discovery
26. Workday, Agent System of Record API (GitHub), spec v1.2 (2026.05). https://github.com/Workday/asor
27. Workday, Agent System of Record product page (no date). https://www.workday.com/en-us/artificial-intelligence/agent-system-of-record.html (doc.workday.com admin-guide pages returned HTTP 404)
28. UiPath Maestro, Using agents in Maestro; Overview (no date). https://docs.uipath.com/maestro/automation-suite/2.2510/user-guide/using-agents-in-maestro , https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/overview
29. AWS, AgentCore Gateway: overview, core concepts, features, semantic search, using a gateway, fine-grained access control (no dates). https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html and sibling pages `gateway-core-concepts`, `gateway-features`, `gateway-using-mcp-semantic-search`, `gateway-using`, `gateway-fine-grained-access-control`
30. AWS, Quotas for Amazon Bedrock AgentCore (no date). https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html
31. agentgateway: home, GitHub, security docs (no dates). https://agentgateway.dev/ , https://github.com/agentgateway/agentgateway , https://agentgateway.dev/docs/standalone/latest/documentation/configuration/security/
32. Kong, AI Gateway; MCP Traffic Gateway; AI MCP Proxy plugin (no dates; 3.12 and 3.13 version notes). https://developer.konghq.com/ai-gateway/ , https://developer.konghq.com/mcp/ , https://developer.konghq.com/plugins/ai-mcp-proxy/
33. Docker, MCP Gateway docs and GitHub (no dates). https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/ , https://github.com/docker/mcp-gateway
34. Cloudflare, AI Gateway (2026-04-20); Dynamic routing (2026-08-07); Universal endpoint, deprecated (2026-09-14); MCP Server Portals (2026-09-18). https://developers.cloudflare.com/ai-gateway/ , https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/ , https://developers.cloudflare.com/ai-gateway/usage/universal/ , https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/
35. Agent Router, formerly Envoy AI Gateway, docs v1.1 (redirect from aigateway.envoyproxy.io). https://theagentrouter.ai/docs/
36. kagent GitHub README; Solo Enterprise for kagent, About, v0.5.x. https://github.com/kagent-dev/kagent , https://docs.solo.io/kagent/latest/about/ (kagent.dev architecture page returned HTTP 500)
37. Solo.io, An Agent Mesh for Enterprise Agents, 2025-04-24. https://www.solo.io/blog/agent-mesh-for-enterprise-agents
38. Solace Agent Mesh, Architecture overview, v1.28.7; GitHub README. https://solacelabs.github.io/solace-agent-mesh/docs/documentation/getting-started/architecture/ , https://github.com/SolaceLabs/solace-agent-mesh
39. NATS, Subjects. https://docs.nats.io/nats-concepts/subjects
40. SPIFFE, Concepts. https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/
41. Kubernetes, DNS for Services and Pods. https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/
42. Slack, app_mention event. https://docs.slack.dev/reference/events/app_mention
43. A2A, Agent discovery; Specification v1.0.0; Extensions. https://a2a-protocol.org/latest/topics/agent-discovery/ , https://a2a-protocol.org/latest/specification/ , https://a2a-protocol.org/latest/topics/extensions/
44. A2A discussion #741, Agent Registry proposal, opened 2025-06-10. https://github.com/a2aproject/A2A/discussions/741
45. a2a-samples, Agent Gateway Protocol (AGP) extension spec v1.0.0. https://github.com/a2aproject/a2a-samples/blob/main/extensions/agp/spec.md
46. MCP Registry, generic server.json reference. https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md
47. AGNTCY, Agent Directory GitHub v1.7.0; ADS paper arXiv 2509.18787, 2025-09-23. https://github.com/agntcy/dir , https://arxiv.org/abs/2509.18787 (docs.agntcy.org and dir.agntcy.org: DNS lookup failed)
48. Anthropic, Tool search tool (no date). https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
49. ACE-Router, arXiv 2601.08276 v2, 2026-04-19. https://arxiv.org/html/2601.08276
50. MoMA, Towards Generalized Routing, arXiv 2509.07571 v2, 2025-09-11. https://arxiv.org/html/2509.07571
51. Uno-Orchestra, arXiv 2605.05007, 2026-05-06. https://arxiv.org/abs/2605.05007
52. Agent Identity URI Scheme, arXiv 2601.14567, 2026-01-21, revised 2026-07-13. https://arxiv.org/abs/2601.14567
53. Gravitee, State of AI Agent Security Report 2026, April 2026, 750 leaders. https://www.gravitee.io/state-of-ai-agent-security
54. Salesforce, 2026 Connectivity Report announcement, 2026-02-05, 1,050 IT leaders. https://www.salesforce.com/news/stories/connectivity-report-announcement-2026/
55. IBM newsroom, CIOs and CTOs face growing AI control gap, 2026-06-08, 2,000 executives. https://newsroom.ibm.com/2026-06-08-new-ibm-study-finds-cios-and-ctos-face-growing-ai-control-gap-as-enterprise-deployment-scales
56. This repo, `docs/designs/retarget/research/2026-09-16-multi-agent-coordination-prior-art.md` §3, and `2026-09-21-human-entry-point.md` §1, §2, §4, §5.
