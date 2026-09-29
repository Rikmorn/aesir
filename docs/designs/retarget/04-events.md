# Topic 4: events, addressing, and the extension model

Status: seeded 2026-09-16, not started.

## Roberto's position (2026-09-16)

"Let's say GitLab: the harness/container has all the code for the agent to talk to GitLab. The agent builder would likely have to provide their incoming and stable endpoints for auth and webhooks and route them to the agent; in my mind this is all aesir APIs. Once aesir natively supports those platforms internally, the integrations use the same APIs, but the agent builders can kill their side (if they want to; they might have other concerns that force them to own it and they are free to do so)."

## Reading of it

An integration splits into three parts with two owners:

| Part | Owner | Content |
|---|---|---|
| Outbound client | the bundle | tool code that calls the provider's API; credentials come from the vault at egress |
| Inbound adapter | the bundle | turns a delivery into an addressable event: which agent, which session, or a new session |
| Ingress and credentials | aesir | stable public URL and TLS; delivery persisted and deduplicated on the provider's delivery id (GitHub `X-GitHub-Delivery`, Linear `Linear-Delivery`, Slack `event_id`, per `research/2026-09-16-scaling-containerised-agents.md`); retries; routing by declared subscriptions; OAuth callback and token storage with egress substitution |

Two principles follow:

- **First-party integrations use the public extension API.** No privileged internal path. GitHub, Linear and Slack for the first workload are built the way a third party would build GitLab, and the platform API is whatever that needed. This replaces designing the API in the abstract, which was the risk named in `00-as-is.md` (v2.9 built without a workload).
- **Adapters emit addressable events or declare a start.** An event carries a correlation to a session, or it matches a subscription that starts one. Nothing else exists, so no LLM router (finding 3 in `00-as-is.md`).

Precedent from the research: Foundry adds an Invocations endpoint specifically for webhook receivers; Managed Agents' self-hosted worker pulls a queue so the customer's infrastructure needs no inbound endpoint; the Kubernetes agent-sandbox pattern allows ingress only from the dispatcher; Managed Agents treats third-party webhooks that trigger sessions as the customer's application code. Aesir making that first-class is part of the delta in `01-target.md`.

## Questions this topic must answer

1. Manifest fields: inbound subscriptions (provider, event types, secret reference, handler), outbound credential references, OAuth provider configuration.
2. Where the adapter runs: inside the agent container (every delivery wakes it) or in the ingress as a bundle-supplied module (agent containers can stay at zero). This is a topic-3 tradeoff as much as a topic-4 one.
3. Two agents subscribed to the same event (today first registration wins, `packages/agents/src/framework/event-router.ts`).
4. Signature verification: aesir with a builder-registered secret, or the bundle's code on the raw body.
5. What "route them to the agent" means when the agent is a paused session rather than a running container: the inbox and claim model from the scaling research.

## The five questions, answered from the 2026-09-27 research (proposals)

From `research/2026-09-27-events-and-extension-model.md` (93 primary sources; section numbers below refer to it; `[V]` there means a fetched primary source). Each answer is a proposal; the evidence is cited, the choice is mine.

**The shape of the field first.** Every platform that receives third-party webhooks on a builder's behalf (Svix Ingest, Hookdeck, Inngest) owns the public URL and records the delivery before any builder code runs. Agent platforms do not: Foundry's Invocations endpoint is Entra-authenticated so a GitHub delivery needs API Management in front; Managed Agents has no inbound trigger surface at all, only outbound webhooks and cron deployments, and its cookbook receiver is "a Flask or FastAPI route" that calls `sessions.create`; Trigger.dev leaves the route to your app; A2A's push receiver is the client's and the spec says push messages "MUST NOT be considered a reliable delivery mechanism" (§1). So business-tool events as a first-class trigger remain the delta named in `01-target.md`, and the precedents to copy are the webhook-infrastructure products, not the agent platforms.

| Q | Question | Answer proposed | Evidence |
|---|---|---|---|
| 1 | Manifest fields | Inbound: `subscriptions[]` with `source` (a provider, or `agent://<id>` for another agent's events), `type`, a CEL `when` predicate over the event, and either `start.key` (one session per key; duplicate deliveries collapse) or `deliver: signal`. The provider's signing secret is a reference on a per-provider registration, not per subscription. The internal envelope is the CloudEvents attribute set (`id`, `source`, `type`, `subject`, `time`) so filters, dedupe and the outbox share one shape; `data` stays provider-native. Outbound credentials are the connector section below | Svix's per-Source secret and Hookdeck's per-Source type; Inngest's CEL `if` on triggers (CESQL cannot see `data`, so CEL or gjson, not CESQL); CloudEvents `source` plus `id` as the uniqueness rule (§1, §5, §6) |
| 2 | Where the adapter runs | Split it. The platform ingress owns the URL, verifies, persists on `(source, delivery_id)`, and evaluates the `when` predicates, so a delivery that matches nothing never wakes a container. A bundle-supplied adapter runs in the ingress only as a pure function under Hookdeck's constraints (JavaScript or Wasm, no IO, a one-second cap). Anything heavier runs in the agent container after a match | Hookdeck's V8 isolate (1 s, 5 MB, no IO); Svix moved from V8 to QuickJS because isolate setup was about 90% of a 10 ms run; Shopify's Wasm cap of eleven million instructions; Hookdeck's ignored events "will not appear in your list of events or generate delivery attempts" (§3) |
| 3 | Two agents on one event | Copy per subscription with independent retries. Drop first-registration-wins; no platform offers it. If exclusivity is ever needed, express it as a shared `start.key` so the second start collapses on the key | Inngest ("one event can trigger multiple functions"), Svix, Hookdeck ("a copy of the request is routed over every connection"), Knative Triggers, Argo durable consumers all fan out by copy; the only "one target" semantics are Temporal's one open execution per id and Inngest's 24 h event-id dedupe (§2) |
| 4 | Signature verification | In the ingress, from a builder-registered secret; reject before persisting and record the rejection. Ship a generic HMAC verifier (Standard Webhooks `v1`, which also covers Svix's headers) plus the GitHub, Linear and Slack schemes, a `genericWebhook` escape hatch, and the raw body exposed to any bundle transform so a builder can verify a scheme the platform lacks | Svix Ingest and Hookdeck verify per Source and mark failures `rejected`; Inngest hands the raw body to the transform and leaves verification to it, with the documented failure mode that a swallowed error returns 200 and loses the delivery (§1, §3). Provider contracts verified: GitHub `X-Hub-Signature-256`, `X-GitHub-Delivery` stable on redelivery, 10 s ack, no automatic retry; Linear `Linear-Signature`, 60 s timestamp window, `Linear-Delivery`, 5 s ack, retries at 1 min, 1 h, 6 h, an activity expected within 10 s of an agent session event; Slack `X-Slack-Signature` with a 5 min window, `event_id`, 3 s ack, retries immediate, 1 min, 5 min (§1) |
| 5 | Routing to a paused session | A matched event becomes a row in the session's inbox and a claimable wake-up. Correlation is a predicate the session registered when it paused (`wait_for` with a `when` over the later event), stored in the database and evaluated by the ingress per delivery. `LISTEN/NOTIFY` is a latency hint over the poll, never the correctness path. For an agent's own emitted events, the outbox row is written in the same transaction as the side effect (pg-boss's `db` adapter or Graphile's `add_job` in SQL) and the consumer dedupes on the CloudEvents `id`; every implementation surveyed is at-least-once | Inngest's `step.waitForEvent` with `match` or `if` over `event` and `async`, `null` on timeout; Temporal's `signalWithStart` collapses "resume or start"; Trigger.dev and n8n use a per-run token URL instead, which needs the adapter to store the mapping (§5). Outbox: pg-boss 12.35 `db` option, Graphile `add_job`, River `InsertTx`, Debezium's outbox router, Dapr; all at-least-once with consumer dedupe (§4). `LISTEN/NOTIFY`: 8000-byte payload, 8 GB queue then commit failure, connection-bound, PgBouncer transaction pooling "Never"; the commit-time global lock is in every released Postgres, and a January 2026 commit optimises listener wake-ups without touching it (§4) |

Two consequences for the other notes. The `04-events.md` sketch for case B ("resume conversation X when a review lands on PR Y") is a wait registered by the session, not a manifest field, which is what every precedent does and what the claim model in `03-deployment.md` already implies. And the ingress evaluating stored predicates per delivery is a query against the store per webhook, which the capacity model in `03-deployment.md` counts as two statements per delivery; at three hundred deliveries a minute that is ten statements a second.

## Connector tiers: what "free" means for a builder (2026-09-27)

Roberto, 2026-09-27: "Another capability that we might formalise is the difference between platform-supported plugins, like we can build a GH integration and that is 'free' to use, as opposed to something new that would need to have a bundled client with the container and potentially off-platform management for things like OAuth."

Written first from the three-part split above, then revised the same day against `research/2026-09-27-connector-tiers-and-oauth-brokering.md` (52 sources; section numbers below refer to it; `[V]` there means fetched primary source). The inbound mechanics (signatures, fan-out, adapter placement) are the sibling brief's, `research/2026-09-27-events-and-extension-model.md`, and are not repeated here.

### Decompose "free"

For a builder to use a provider from an agent with no provider-side work, someone has to have done each of these. The research checked every "who can own it" cell against the provider's own documentation (§1):

| # | Item | Who can own it | Why, from the provider |
|---|---|---|---|
| 1 | The client code: the tools that call the provider's API | platform, broker or builder | no provider constraint |
| 2 | The inbound adapter: delivery to addressable event | platform or builder | no provider constraint |
| 3 | The registered app or OAuth client (client id, secret, scopes) | exactly one owner per app: platform vendor, operator or builder | a GitHub App is registered "under your personal account or under any organization you own"; a Slack app is created in one workspace and needs "Activate Public Distribution" before others can install it; Linear recommends a dedicated workspace to own the app because "each admin user will have access" |
| 4 | The credentials that registration yields, and their refresh | the app owner, stored by whoever hosts the callback | the secret is minted by the provider to the registrant; refresh needs only the client secret, so the platform can do it for any owner |
| 5 | The redirect URI, consent flow and callback | the platform, always | these are functions of the callback host, not of the registrant; every broker prints one redirect URI under its own domain |
| 6 | The provider-side identity (bot user, App installation) and its installation into the tenant | the app owner defines it; a tenant admin performs the install | GitHub installation tokens act as "@app[bot]" and an org owner installs; each Slack install yields workspace-specific tokens; Linear gives the app "a unique ID for each workspace" |
| 7 | Webhook registration and its signing secret | follows the app owner; the platform hosts the endpoint | GitHub Apps have "built-in, centralized webhooks", one per app |
| 8 | Rate-limit handling | whoever owns the app | a shared broker app pools limits across all its customers (Arcade says so) |
| 9 | App review or marketplace listing | the app owner, usually only if it owns the service | Copilot's verified publisher "owns the underlying service"; Linear's directory rejects "scripts, low-effort/vibe coded or apps built by hobbyists" |

Read off the table: only items 1, 2 and 8 can be owned by someone other than the party who registered the app. Everything else follows the registration, and providers pin that to one owner.

**The catch for a self-hosted platform.** In a hosted product the vendor registered one GitHub App for all its customers, so the registration is done once for everyone and the consent screen carries the vendor's name. Every managed-auth broker that ships such a shared app calls it a development convenience and pushes production users to register their own, because a shared app shares rate limits, brands the consent screen, has fixed scopes and can be revoked by the provider (§2: Nango, Composio, Arcade, Pipedream, Paragon all say so). A self-hosted platform cannot even offer the convenience: the operator registers their own GitHub App, Slack app and Linear application under their own organisation. So the provider-side registration is never free. It is the operator's, once per provider per installation, plus renewal of any secret the provider expires (Copilot's rule for custom connectors: submit the update "one month before your client ID and client secret expire"). What can be free is the code and the generic machinery: callback, vault, refresh, egress injection, ingress hosting. "Platform-supported" means "the platform ships the code and the operator has registered the identity".

Two provider mechanisms turn that registration into a guided flow rather than a runbook (§1, §6): GitHub's App Manifest flow returns `client_id`, `client_secret`, `webhook_secret` and the private key in one conversion call after the user approves a pre-filled registration; Slack's `apps.manifest.create` creates an app from a manifest with a twelve-hour configuration token. Linear has no equivalent and stays a settings-page task.

### The tiers, and the axis that is not a tier

The first-principles draft had three tiers with "does builder code see a token" as the third tier's defining property. The evidence separates the two: every shipped catalogue tiers on who registered the app and who wrote and reviewed the code (§3, §4), and whether code sees a token is decided by the credential kind, not by the tier (§5; the gaps research §3 limit: substitution at egress is outbound-only and cannot do signing or an exchange). Numbering follows the research, bottom to top.

| | Tier 0: bring your own | Tier 1: reviewed | Tier 2: platform-native |
|---|---|---|---|
| Platform provides | vault with write-only secrets, callback URL under its domain, consent flow, refresh, egress substitution or gateway injection, ingress URL, delivery persistence | Tier 0 plus review, catalogue listing, a signed bundle, and optionally a platform-held client for the builder's app | Tier 1 plus the provider app registration (by the operator), the bot identity, webhook registration, client code, adapter, rate-limit handling; the builder writes `uses: <provider>` and a scope list in the manifest |
| Builder provides | client code, adapter, and either a static credential or its own OAuth client registered against the redirect URI the platform prints | the same, plus tool annotations, tests, a test account, privacy and support links, and evidence it owns or may use the API | nothing provider-side; a tenant admin performs the install |
| Builder cannot | skip the label; use a platform-held client; appear in the catalogue | change tools without re-review of their annotations | choose scopes outside the platform app's set (Nango's "fixed scopes" cost) |
| Promotion | review of tools and scopes, tests, ownership or permission for the API, a maintenance commitment | adoption, and the operator's decision to own the app: the registration is re-homed, nothing is rebuilt | n/a |
| Precedent | Claude "Custom" connectors and `custom_connection`; Zapier private integrations; Copilot custom connectors; Home Assistant custom integrations with their logged warning; Docker self-provided images | Claude "Verified"; Copilot independent publisher; Terraform Partner; Grafana community signing; Docker-built images | Copilot standard connectors; Claude Anthropic-built connectors; Composio managed toolkits |

The orthogonal axis, **credential handling**, has three values whatever the tier: substituted at egress (the container sends a placeholder; works for static tokens and OAuth access tokens), vended by a platform exchange (the platform performs the GitHub App JWT-to-installation-token exchange or signs the request; brief 4, `research/2026-09-27-gateway-identity-and-tokens.md`, says which exchanges a gateway can do), or held by the builder's code (the credential kind forces it, and the bundle's card and manifest say so). The third value is Roberto's "off-platform management". It is a labelled property of a bundle, never a separate tier and never forbidden: the research's warning from every mature ecosystem is that a forbidden bottom tier makes builders route around the platform with static tokens in images (§4, §7).

Three consequences:

- **Tier 2 is Tier 1 authored by the platform, with the app registered by the operator.** This keeps the principle already recorded in this note: first-party integrations use the public extension API and there is no privileged path. Claude runs directory and custom connectors "on the same infrastructure"; Docker's catalogue puts both tiers in one registry and strips only the signature from self-provided images (§3). The difference between tiers is who wrote the bundle, who reviewed it, and who is on the hook when the provider changes its API.
- **Whether the platform app is per platform or per tenant is a per-provider decision** (§6). GitHub App rate limits scale with installation size, so one app per installation is fine; a Slack app is per workspace by construction; Google's verification cost (a verified domain, a demo video, an annual third-party security assessment for restricted scopes) argues for one app.
- **The levers that make the bottom tier safe are label, admin gate and default-off** (§4): Home Assistant logs "this component might cause stability problems" for custom integrations; Grafana loads unsigned plugins only when the operator names them; Slack admins can require pre-approval; Claude shows a reminder before a custom connector connects. Aesir's equivalents are the card's tier and credential-handling fields, the registry's status, and the operator's approval at install.

### The MCP authorization spec, and where the token lives

The 2026-07-28 revision settles the client side (§5): the MCP client is the OAuth client; Client ID Metadata Documents are the SHOULD, Dynamic Client Registration is deprecated, pre-registration must remain an option; resource indicators are mandatory; an MCP server "MUST NOT pass through the token it received from the MCP client". It dissolves the provider-app problem only where the provider itself runs a remote MCP server, because then the provider's authorization server owns the app and the harness registers itself as a client. Slack and Linear do ship one (`mcp.slack.com`, `mcp.linear.app` are Anthropic's own vault examples). For a builder's own MCP server fronting GitHub, that server is an OAuth client to the provider and inherits every item in the table.

Where the token lives decides whether the container-never-holds-a-credential rule holds. Three shipped placements (§5): the MCP client inside the agent process (Claude Code: keychain or a credentials file, on the disk the agent can read); the MCP client at the platform with the token injected when the connection opens (Managed Agents: the credential is "keyed by an `mcp_server_url`" and injected at session runtime; the customer registered the client and ran the flow, Anthropic refreshes and injects); the builder's MCP server as OAuth client to the upstream (Cloudflare's library keeps the upstream token "in the encrypted props so the MCP client never sees it"). Only the second is compatible with the rule. So for this platform the harness's MCP client terminates at a platform component that holds the token, or the platform runs the client and the container speaks an unauthenticated internal transport. Managed Agents is the closest shipped precedent for the whole vault, callback, refresh and inject list, and it ships no first-party connectors at the API level: the customer always registers the client.

One rule to carry into the gateway design: a platform that fronts a provider with one static client id "MUST obtain user consent for each dynamically registered client before forwarding" (the confused-deputy rule). What "client" means when every client is the platform's own harness is an open question the research flagged (§8).

### What the provider declaration has to carry

Inferred from the decomposition, and now anchored on the shipped forms (§6: every broker makes bring-your-own a form of client id, client secret, scopes and a printed redirect URI; Nango and Arcade make a new provider a definition rather than code; Copilot's certification manifest names the vault that holds the secret):

- **Authentication kind**: OAuth 2 authorisation code (authorisation URL, token URL, scopes, PKCE, refresh semantics); OAuth 2 client credentials; App-installation exchange (private key reference, installation lookup); static token; or, for a provider that ships a remote MCP server, "the platform's MCP client with pre-registration, CIMD or DCR in that order".
- **Inbound**: signature scheme and header, delivery-id header, acknowledgement window, retry behaviour, and the event types the adapter emits (mechanics in the sibling brief).
- **Identity mapping**: how the provider names the agent (bot user id, App installation id, Linear's `actor=app` user) so the registry's flat alias per tool (`05-proposal.md` Part C) is filled at install rather than by hand.
- **Egress**: the hosts the client code may reach, which is the allowlist G15 asks who owns.
- **Credential handling**: substituted, vended, or held by the bundle's code, so the card can say it.

### What this settles and what it does not

It settles the vocabulary: three tiers by who registers the app and who wrote and reviewed the code, one orthogonal credential-handling axis, the operator's provider registration as the fixed cost at every tier, and the principle that Tier 2 is Tier 1 authored by the platform. It settles the MCP placement: the container is not the MCP client. It does not settle the declaration's schema (the manifest brief, `research/2026-09-27-manifest-schema-precedent.md`), the per-provider choice between one app per installation and one per tenant, how the GitHub manifest flow's returned private key reaches the vault without transiting the builder, or what the confused-deputy rule requires of a platform whose only clients are its own harnesses. Those four are the register entries this section adds.
