# Events, addressing, and the extension model: standards and shipped products

Date: 2026-09-27. External research only; this repository's source code was not read. Builds on `04-events.md` ("Reading of it" and "Questions this topic must answer") and on `research/2026-09-16-scaling-containerised-agents.md` §2 (the inbox table keyed on the provider's delivery id).

**Summary.** Every shipped platform that receives third-party webhooks on a builder's behalf owns the public URL and records the delivery before any builder code runs. They differ on two axes. First, who verifies the provider's signature: Svix Ingest and Hookdeck verify in the ingress from a per-source secret the builder registers, while Inngest hands the raw body to a builder-written transform and leaves verification to it. Second, where the adapter runs: Inngest, Svix and Hookdeck run builder JavaScript inside the ingress under a sandbox with hard limits (QuickJS or a V8 isolate, one second, no IO); Knative and Argo run adapters as separate pods; Foundry, Managed Agents, Trigger.dev and A2A leave the receiver to the builder's own code. Fan-out is a copy per subscription with independent retries everywhere; no surveyed platform offers first-match-wins. Correlation to an existing run is either an expression over the event (Inngest CEL `match`/`if`) or a per-run token the run mints and the adapter maps to (Trigger.dev, n8n, Temporal). For an agent's own events, a Postgres outbox in Node.js is well-trodden (pg-boss `db`, Graphile `add_job`), gives at-least-once, and should not depend on `LISTEN/NOTIFY` for correctness: the commit-time global lock is still in every released Postgres, and delivery is bound to a connection.

**Labels.** `[V n]` fetched primary source n from the list at the end. `[S n]` secondary. `[I]` inferred by me. Dates are as shown on the page; "n.d." means none.

## 1. How platforms host third-party inbound adapters

**Conclusion.** Two families. Webhook infrastructure (Svix, Hookdeck, Inngest) owns the URL, persists first, then runs builder code in a sandbox. Agent platforms (Foundry, Managed Agents, Trigger.dev) own no inbound surface for third parties, or expose one that only the builder's own code can speak to. Kubernetes eventing (Knative, Argo) sits between: the adapter is platform-shaped but runs as its own pod.

| Platform | Adapter code runs | Public endpoint | Signature verification | Match existing run vs start new | Retry, dead-letter, replay |
| --- | --- | --- | --- | --- | --- |
| Inngest | JavaScript transform `(evt, headers, queryParams, raw)`; "runs on Inngest's servers so there is no added load or cost to your infra"; runtime unspecified [V 1] | Inngest generates "a uniquely generated URL" per webhook [V 1] | Not by Inngest; "return the signature and raw request body string in your transform" and verify in the function [V 1] | Start: function trigger `event` plus CEL `if` [V 4]. Resume: `step.waitForEvent` with `match` (dot path equality) or `if` over `event` and `async` [V 2]. Dedupe: event `id`, 24 h [V 3] | Function-level retries; a transform returning 400 makes the provider retry, a caught error does not [V 1]; Replay re-runs failed functions [V 5]; ordering not documented [I] |
| Trigger.dev | Your app's route; guides show Next.js and Remix handlers calling `tasks.trigger`; Hookdeck suggested for logging and replay [V 6] | Yours [V 6] | Yours [I] | Resume: `wait.createToken()` then `wait.forToken(id)`; the token has a `url`, a POST to it completes the token with the body as output; default timeout `10m`; `idempotencyKey` on the token [V 7]. Start: `tasks.trigger` with `idempotencyKey`, 30 d default TTL [V 8] | Task retries; no inbound dead-letter (no inbound surface) [I] |
| Foundry hosted agents | Your container image; "Webhook receiver (GitHub, Stripe, Jira, etc.)" is the listed use for the Invocations protocol [V 9] | Platform: `{project_endpoint}/agents/{name}/endpoint/protocols/invocations`, Entra-authenticated [V 9] | Not the platform; the Telegram sample "places API Management in front of the hosted agent webhook" [V 10]; verification is APIM policy or container code [I] | "session ID is the primary concept. The client manages the session ID directly"; no platform-managed history on Invocations [V 9]. Classic: Logic Apps trigger runs outside the agent and does Create Thread + Create Run, or Create Run into an existing thread [V 11] | None documented for Invocations [I]; per-session VM sandbox, idle timeout 2 to 60 min, default 15 [V 9] |
| Managed Agents | Your code. Webhooks are outbound only (Anthropic notifying you) [V 12]. The cookbook's receiver is "a Flask or FastAPI route that your alerting system calls", which then calls `sessions.create` [V 14] | Yours. No inbound third-party trigger surface exists; the only platform-side trigger is scheduled deployments [V 12][V 13] | n/a inbound. Outbound uses Standard Webhooks headers and a `whsec_` secret [V 12] | Your code decides start vs `sessions.events.send` [V 14] | Outbound: up to 3 attempts, jittered 5 to 120 s, then "the event is dropped"; "Ordering is not guaranteed"; dedupe on `event.id` [V 12] |
| Svix Ingest | Svix; a Source "generates an endpoint you can share with a webhook provider"; `https://api.svix.com/ingest/api/v1/source/src_[id]/in/[token]` [V 15] | Svix [V 15] | Svix, from the provider's secret stored per Source; supports github, slack, stripe, shopify and others; forwards only if valid; `genericWebhook` skips [V 15] | Fan-out to Destinations; correlation is the destination's job [I] | Immediately, 5 s, 5 m, 30 m, 2 h, 5 h, 10 h, 10 h; 15 s window; endpoint disabled after 5 days of failure; `webhook-delivery: abort-message`; manual retry, recover-from-date, replay [V 18] |
| Svix transformations | JavaScript `handler(webhook)` may set `method`, `url`, `payload`, `headers`, `cancel`; runs on Svix infrastructure [V 16]. Engine moved from V8 (deno_core) to QuickJS via rquickjs, with a memory limit and an interrupt handler [V 17] | Svix | n/a (outbound side) | n/a | Same as above |
| Hookdeck | JavaScript ES6 in "a V8 isolate"; limit "1 second", "5 MB" code, "cannot perform any IO", no promises [V 22] | Hookdeck, one URL per Source [V 20] | Hookdeck, per Source type (Stripe, GitHub, Shopify, Slack, Linear, generic HMAC) [V 20]; failed verification marks the request `rejected` [V 21] | Filters and transformations per connection; correlation is the destination's job [I] | Linear or exponential; 50 attempts or 7 days; Issues as dead-letter; replay creates a new event per connection [V 24] |
| Zapier | Zapier; polling every 1 to 15 min with dedupe on cached `id` per Zap [V 26][V 28]; REST Hook: subscribe with `targetUrl`, unsubscribe, `perform`, `performList` [V 27] | Zapier, one target URL per active Zap [V 27] | Not documented [V 27] | One Zap = one flow; no mid-run wait [I] | Not documented on these pages |
| Make | Make; polling with `epoch`, `lastDate` or `lastID`, order `asc`/`desc`, 3200-record cap [V 29]; instant trigger fires per arrival [V 30] | Make; shared or dedicated webhook URL [V 31] | `verification` directive is a challenge handshake; no HMAC mention [V 31] | One scenario per webhook [I] | Queue: 667 items per 10,000 credits, max 10,000, excess rejected; "process data in order" option [V 32] |
| n8n | The workflow; Webhook node with test and production URLs, auth basic/header/JWT/none, raw body option [V 33] | n8n [V 33] | Generic Webhook node: none beyond auth [V 33]. GitHub Trigger node creates the hook with `randomBytes(32)` as secret and returns 401 when `verifySignature` fails [V 35] | Resume: Wait node `$execution.resumeUrl`, unique per execution, with auth options [V 34] | Not on these pages |
| Knative Eventing | A Source CR runs its own pod ("keeps a Pod running"); GitHubSource registers with `accessToken`, validates with `secretToken`, emits `dev.knative.source.github.*` [V 36][V 37]; alpha [V 38] | The source's own Service [I] | The source (GitHubSource `secretToken`) [V 37] | Trigger `filters`: `exact`, `prefix`, `suffix`, `cesql`, `all`, `any`, `not` [V 40]; no run correlation; the sink decides [I] | `delivery`: `retry`, `backoffPolicy`, `backoffDelay`, `deadLetterSink` on Trigger, Subscription, Broker [V 41]; Kafka broker `delivery.order` `ordered` or `unordered`, default unordered [V 42]; the docs say to "prefer native Broker implementations" over the channel-based default [V 43] |
| Argo Events | EventSource pod, Service `<name>-eventsource-svc`, needs an Ingress; registers the GitHub hook via `apiToken`; `webhookSecret` validates [V 44][V 45]; publishes CloudEvents to the EventBus [V 46] | The EventSource Service plus your Ingress [V 44] | The EventSource [V 45] | Sensor `dependencies` by `eventSourceName` and `eventName`; conditions `A || B`, `A && B` [V 48]; filters `expr`, `data` (gjson), `context`, `time`, `script` [V 49] | JetStream subjects `default.<eventsourcename>.<eventname>`, durable consumer per sensor, `maxAge` retention [V 47]; NATS at-least-once; sensor caches delivered ids for 5 min [V 48] |

**Envelopes.** CloudEvents v1.0.3-wip requires `id`, `source`, `specversion`, `type`; "Producers MUST ensure that `source` + `id` is unique" and "Consumers MAY assume that Events with identical `source` and `id` are duplicates"; `subject` exists for suffix filtering; the spec defines format, not delivery [V 51]. The Subscriptions API (0.1-wip) names six mandatory filter dialects plus optional SQL [V 52]. CESQL 1.0.0 evaluates attributes only: it "doesn't support the handling of the `data` field" [V 53]. Standard Webhooks 1.0.0 signs `msg_id.timestamp.payload` with HMAC-SHA256 (`v1,` base64) or Ed25519 (`v1a,`), carries `webhook-id`, `webhook-timestamp`, `webhook-signature`, and says to "use the `webhook-id` header as an idempotency key" [V 54]. Svix's `svix-id`, `svix-timestamp` and `svix-signature` are "Svix-branded aliases" of those headers with identical values, so one verifier covers both [V 19].

**The provider side of the contract.**

| Provider | Signature | Delivery id | Ack window | Retries | Notes |
| --- | --- | --- | --- | --- | --- |
| GitHub | `X-Hub-Signature-256`, `sha256=` HMAC hex over the raw body; use `timingSafeEqual` [V 55] | `X-GitHub-Delivery`, same on redelivery [V 56] | 2XX within 10 s [V 56] | "GitHub does not automatically redeliver failed deliveries"; redeliver via API [V 57] | Headers include `X-GitHub-Event`, `X-GitHub-Hook-ID`, `X-GitHub-Hook-Installation-Target-Type/-ID`; payloads capped at 25 MB [V 58]; a GitHub App registration has one webhook URL and one secret [V 59] |
| Linear | `Linear-Signature`, HMAC-SHA256 hex of the raw body; reject `webhookTimestamp` older than 60 s [V 60] | `Linear-Delivery` UUID v4 [V 60] | 200 within 5 s [V 60] | 3 retries at 1 min, 1 h, 6 h [V 60] | `AgentSessionEvent` actions `created` (mention or delegation) and `prompted` (user message in `agentActivity.body`); `agentSession.id`, `issue`, `comment`, `promptContext`, `guidance`; send an activity within 10 s or the session is marked unresponsive [V 61][V 62] |
| Slack | `X-Slack-Signature` = `v0=` HMAC-SHA256 hex of `v0:timestamp:body`; 5-minute window [V 64] | `event_id`, "globally unique across all workspaces" [V 63] | 2xx within 3 s [V 63] | Nearly immediately, 1 min, 5 min; `x-slack-retry-num`, `x-slack-retry-reason` [V 63] | 30,000 events per workspace per app per hour; disabled at over 95 % failures in 60 min [V 63]. Socket Mode replaces the Request URL with a WebSocket, acks by `envelope_id`, allows 10 connections, and is barred from the Marketplace [V 65] |

## 2. Fan-out to several subscribers

**Conclusion.** Every platform that fans out does so by copying the event once per subscription and retrying each copy on its own. Interest is declared by event name plus a filter. Nobody offers exclusivity or first-match-wins; the closest things are Argo's AND condition (which consumes only the latest event per dependency) and an engine that allows one open run per id, which is exclusivity on the target, not among subscribers.

| Platform | One event, two consumers | Interest declaration | Exclusivity | One fails, one succeeds |
| --- | --- | --- | --- | --- |
| Inngest | "One event can trigger multiple functions"; contrasted with queues "where only one worker can consume a single message" [V 3] | Event name plus CEL `if` on the trigger [V 4] | None [V 3] | "an issue with one function will not affect the other(s)"; Replay targets only the failed ones [V 5] |
| Svix | Every endpoint whose event-type and channel filters match; "you can send each message to multiple channels" [V 66] | `filterTypes` and channels per endpoint [V 66] | None [V 66] | Per-endpoint retry schedule and disabling [V 18] |
| Hookdeck | "a copy of the request is routed over every connection attached to that source" [V 25]; one Event per connection [V 21] | JSON filter per connection over body, headers, query, path with `$gte`, `$in`, `$or`, `$startsWith` and others; non-matching becomes an ignored event with no attempts [V 23] | None [V 25] | Each Event has its own attempts and retry rule; Issues per failed event [V 21][V 24] |
| Knative | Each matching Trigger receives its own copy from the Broker [V 39] | `filters` dialects, CESQL over attributes [V 40] | None [V 39] | `delivery` and `deadLetterSink` per Trigger or Subscription [V 41] |
| Argo Events | Durable consumer per Sensor on the same subject [V 47] | Sensor dependency (`eventSourceName`, `eventName`) plus filters; AND uses "the latest events from each dependencies" [V 48][V 49] | None; on NATS one Sensor cannot reference the same dependency twice [V 48] | Independent consumers; sensor-side 5-min id cache [V 48] |
| Managed Agents (outbound) | Delivered to every endpoint subscribed to the type at emission time; no backfill [V 12] | Event-type list per endpoint [V 12] | None | "For each endpoint and event", 3 attempts [V 12] |
| Zapier, Make, n8n | One URL per Zap, scenario, or workflow; fan-out means N registrations with the provider, or one flow forwarding [V 27][V 31][I] | Per flow | n/a | Independent flows [I] |
| Temporal | A Signal addresses one Workflow Id; `signalWithStart` starts it if absent [V 67][V 92] | Signal name in code [V 67] | One target per id; not a pub/sub | n/a; dedupe Signals with "a custom idempotency key that you send as part of your own signal inputs" [V 93] |

## 3. Adapter placement tradeoff

**Ingress-side adapters, and how they are sandboxed.**

| Host | Language and engine | Limits | Can it do IO |
| --- | --- | --- | --- |
| Hookdeck transformations | JavaScript ES6, "a V8 isolate" [V 22] | 1 s, 5 MB code, no async [V 22] | "cannot perform any IO, or access any external resources such as the network or file system" [V 22] |
| Svix transformations | JavaScript, QuickJS via rquickjs, replacing V8 whose isolate setup cost was "around 90%" of a 10 ms run [V 17] | `set_memory_limit`, `set_interrupt_handler`; "possible for a request to take longer than the expected duration" [V 17] | No network per the post [V 17] |
| Inngest transforms | JavaScript on Inngest's servers; engine and limits undocumented [V 1] | Undocumented [V 1] | Undocumented [V 1] |
| Cloudflare Workers for Platforms | "Run untrusted code written by your customers, or by AI, in a secure hosted sandbox"; per-customer CPU and subrequest limits [V 68]; "Each isolate's memory is completely isolated" and starts "around a hundred times faster than a Node process" [V 69] | Per-tenant CPU time [V 68] | Yes, governed by outbound Workers [V 68] |
| Shopify Functions | Any language compiling to WebAssembly [V 70] | 11 million instructions, 256 kB module, 128 kB in, 20 kB out, no randomness or clock [V 70] | Network needs explicit enablement [V 70] |
| Knative sources, Argo EventSources | Whole pods with the platform's own adapter code [V 36][V 44] | Pod resources | Yes |

**Consumer-side adapters.** Managed Agents: the receiver is your Flask route and it calls `sessions.create` [V 14]. Foundry: the container receives the raw payload on Invocations, but the endpoint is Entra-authenticated, so a GitHub-style delivery needs API Management in front [V 9][V 10]. A2A 1.0.0: the client hosts the push receiver, configures `url`, `token`, `authentication`, should re-fetch the task rather than trust the payload, and the spec says messages "MUST NOT be considered a reliable delivery mechanism for critical information" [V 71]. Kubernetes agent-sandbox: a "default-deny `NetworkPolicy`" allows ingress only from the dispatcher, which POSTs `{session_id, work_id}` to the pod; nothing else can reach it [V 72]. Slack Socket Mode removes the public URL altogether [V 65].

**What each placement buys [I], with the evidence that supports it.**

- Scale to zero. An ingress-side filter means a delivery that matches no subscription never wakes a container; Hookdeck's ignored events "will not appear in your list of events or generate delivery attempts" [V 23]. A consumer-side adapter wakes the container for every delivery, including the ones it discards. Foundry pays this per session with a VM cold start [V 9].
- Isolation. Ingress-side builder code runs inside the operator's trust boundary, so every host that does it constrains the language (JavaScript or Wasm), forbids IO, and caps time and memory [V 17][V 22][V 70]. Consumer-side code is already inside the builder's container and needs nothing extra.
- Who breaks what. Ingress-side platforms record the request before rules run, so a broken transform produces a visible failed or rejected event rather than a lost delivery [V 21]. Inngest's guidance shows the failure mode: a transform that swallows an error returns 200 and "you will have to handle the failed event manually" [V 1]. A consumer-side adapter that crashes after the provider's ack window has passed loses the delivery unless the platform persisted it first [I].
- Cost of the second placement. Svix measured the V8 isolate's setup at roughly 10 ms per run and moved to QuickJS to get to about 1 ms [V 17]. That is the price of running tenant JavaScript per delivery in the hot path.

## 4. Transactional outbox on Postgres in Node.js

**Conclusion.** Enqueue in the caller's transaction, deliver at-least-once, and dedupe at the consumer on the event id. That is what every implementation does, including the Go and CDC ones. The Node.js libraries already offer the transactional enqueue; the choice is between a job table the platform owns and a generic outbox with a relay.

| Implementation | Enqueue in caller's transaction | Delivery semantics | Ordering | Relay and scaling | What you operate |
| --- | --- | --- | --- | --- | --- |
| pg-boss 12.35 (Node) | `db` option: "Send or complete jobs inside your existing transaction with adapters for Drizzle, Knex, Kysely and Prisma"; custom adapter implements the `pg` interface [V 73][V 74] | At-least-once with `retryLimit` (default 2), `retryDelay`, `retryBackoff`, `expireInSeconds` (default 15 min), `deadLetter`, `singletonKey`; optional transactional completion [V 74][V 75] | "always fetched in priority order", then creation [V 74] | Workers poll; `pollingIntervalSeconds` default 2, minimum 0.5; heartbeats refresh claims [V 75] | Postgres only |
| Graphile Worker (Node) | `graphile_worker.add_job()` is SQL; the docs show it inside a trigger function, so it commits with the row [V 76]; `job_key` with `replace`, `preserve_run_at`, `unsafe_dedupe` [V 77] | Retries to `max_attempts` (default 25) [V 76]; "Never lose a job" [V 78] | `priority` ascending [V 76] | `LISTEN/NOTIFY`: "Jobs start in milliseconds" [V 78] | Postgres only; inherits NOTIFY limits below |
| pgmq v1.10.0 (extension) | SQL functions `send`, `read`, `pop`, `archive`, `delete`; callable inside your transaction [V 79][I] | "exactly once" within the visibility timeout, then visible again [V 79] | Not stated [V 79] | Consumers poll `read(vt)` [V 79] | Postgres extension install |
| Plain outbox table plus relay | `INSERT` into the outbox in the same transaction [I] | At-least-once; consumer dedupes on id [I] | Per aggregate if the relay preserves insertion order [I] | Relay polls, or wakes on `NOTIFY`; limits below [V 80][V 81] | Your relay |
| Debezium 3.6 outbox router (CDC) | Row in `outbox` with `id`, `aggregatetype`, `aggregateid`, `type`, `payload`; insert and delete in the same transaction because the WAL carries the insert [V 85][V 87] | At-least-once: the connector "continues reading the WAL where it last left off" after a stop; the `id` header allows "efficient duplicate detection by consumers" [V 86][V 87] | `aggregateid` is the Kafka key, so one aggregate's events share a partition [V 85][V 87] | Logical decoding via `pgoutput` or `decoderbufs`; WAL retention grows while stopped [V 86] | Kafka, Kafka Connect, a replication slot |
| Watermill SQL (Go) | Publisher "accepts both *sql.DB and *sql.Tx" [V 88] | Claims `ExactlyOnceDelivery` and `GuaranteedOrder`; warns that long-running transactions delay delivery [V 88] | Guaranteed per topic [V 88] | Poll, `PollInterval` default 1 s [V 88] | Postgres only |
| River (Go) | `Client.InsertTx`; the docs' motivating bug is a worker reading a row before it commits [V 89] | At-least-once; `JobCompleteTx`: "A successful commit guarantees that the job will never rerun" [V 90] | Priority and scheduled time [I] | pgx driver; notification mechanism not on the pages read [V 89] | Postgres only |
| Dapr outbox | "The state and a transaction marker are written atomically in the same state store" [V 91] | "Dapr retries, ensuring reliable at-least-once delivery" [V 91] | Broker-dependent [I] | Sidecar publishes to `outboxPublishPubsub` and `outboxPublishTopic` [V 91] | Dapr control plane plus a broker |

**Postgres `LISTEN/NOTIFY` limits, with sources.**

- Payload: "In the default configuration it must be shorter than 8000 bytes" [V 80].
- Transactional: notifications "are not delivered until and unless the transaction is committed"; identical payloads in one transaction collapse to one [V 80].
- Queue: 8 GB in a standard installation; when full, "transactions calling `NOTIFY` will fail at commit" [V 80].
- Connection-bound: `LISTEN` registers "the current session"; registrations "are automatically cleared when the session ends"; the client must stay connected and poll `PQnotifies` or equivalent [V 81]. PgBouncer's feature table lists `LISTEN` as "Never" under transaction pooling [V 82].
- Global lock at commit: Recall.ai (2025-07-01) traced a throughput collapse to `PreCommit_Notify` taking an `AccessExclusiveLock` in `async.c`, serialising commits; they removed `NOTIFY` from the path [V 83]. Commit 282b1cde (Jacobson, committed by Lane, 2026-01-15) builds a shared channel map to stop waking uninterested listeners and reports "integer multiples" of throughput; its message does not mention the lock [V 84]. A search-result summary places it in PostgreSQL 19, which is not released [S 84]. Treat the lock as present in every version you can deploy today [I].

## 5. The two-subscriber and correlation cases, concretely

**Conclusion.** Three shapes cover the brief's cases: a start subscription (event type plus predicate), a wait registered by a paused session (correlation key plus predicate), and an internal subscription on a CloudEvents-shaped envelope. The manifest declares the first and third; the second is created at runtime by the session, as every precedent does. Sketches are proposals [I]; the precedent column is verified.

```yaml
# A. "start me when a Linear issue is delegated to my agent user"
subscriptions:
  - source: linear                      # provider adapter; secret ref lives with the provider registration
    type: AgentSessionEvent
    when: "event.action == 'created' && event.data.agentSession.appUser.id == self.appUserId"
    start:
      key: "event.data.agentSession.id" # one session per Linear agent session; duplicate deliveries collapse
```

```yaml
# B. registered by a running session, not by the manifest:
#    "resume conversation X when a review lands on PR Y"
wait_for:
  type: github.pull_request_review
  when: "async.data.pull_request.number == 42 && async.data.repository.full_name == 'org/repo'"
  timeout: 7d
```

```yaml
# C. "wake me when agent B emits tickets.created in context Z"
subscriptions:
  - source: agent://b                   # CloudEvents source
    type: tickets.created               # CloudEvents type
    when: "event.subject == 'Z'"        # CloudEvents subject carries the context
    deliver: signal                     # into the session whose context is Z, else start
```

| Need | Closest existing syntax | Why it fits |
| --- | --- | --- |
| A predicate over event data at start time | Inngest trigger `if`: `"event.data.billingPlan == 'enterprise' && event.data.amount > 1000"` (CEL, boolean) [V 4] | CEL is non-Turing-complete and evaluates data, not only attributes; Knative CESQL cannot see `data` [V 53]; Argo's `data` filter uses gjson paths with `and`/`or` [V 49] |
| Correlate a later event to a paused run | Inngest `step.waitForEvent({ event, match: "data.userId", if: "event.data.userId == async.data.userId", timeout })`, returning `null` on timeout [V 2] | The pause itself registers the predicate; no directory of running containers is needed |
| Address a run by id and start it if absent | Temporal `signalWithStart(workflow, { workflowId, signal, signalArgs })` [V 67]; "if there is a running Workflow Execution with the given Workflow Id, it will be Signaled. Otherwise, a new Workflow Execution starts" [V 92] | Collapses "resume X or start" into one operation keyed on the correlation |
| A per-run callback URL instead of a predicate | Trigger.dev token `url` completed by POST; n8n `$execution.resumeUrl` [V 7][V 34] | Simpler, but the adapter must store the mapping from provider object to token |
| Fan-out with attribute filters | Knative Trigger `filters: [{exact: {type: tickets.created}}, {exact: {subject: Z}}]` [V 40] | Exactly the internal case C when events are CloudEvents |
| Two dependencies must both arrive | Argo Sensor `conditions: "A && B"`, using the latest event per dependency [V 48] | The only precedent for joining two subscriptions |
| Trigger parameterisation | Argo `parameters[].src.dependencyName/dataKey/contextKey` to `dest` JSON path [V 50] | Shows how a manifest maps event fields into the start payload |

## 6. Implications for the five open questions (proposals)

Each item answers the numbered question in `04-events.md` "Questions this topic must answer". Marked as proposals; the evidence is cited, the design choice is mine [I].

1. **Manifest fields.** Inbound: `subscriptions[]` with `source` (provider or `agent://id`), `type`, a CEL `when`, and either `start.key` or `deliver: signal`; the provider's signing secret is a reference on a per-provider registration, not per subscription, matching Svix's per-Source secret and Hookdeck's per-Source type [V 15][V 20]. Outbound credential and OAuth fields are the sibling brief's. Use the CloudEvents attribute set (`id`, `source`, `type`, `subject`, `time`) as the internal envelope so filters, dedupe and the outbox share one shape [V 51]. Keep `data` provider-native; every product that transforms payloads does so in an optional step, not the envelope [V 16][V 22].
2. **Where the adapter runs.** Split it. The platform ingress does what the infrastructure products do: own the URL, verify, persist on `(source, delivery_id)` per the inbox pattern in the scaling research §2, and evaluate `when` predicates. A bundle-supplied adapter runs in the ingress only as a pure function with Hookdeck's constraints (JavaScript or Wasm, no IO, one-second cap) [V 22][V 70]. Anything heavier runs in the agent container after a match. This keeps containers at zero for non-matching deliveries [V 23] and keeps builder code out of the trust boundary except under a sandbox [V 17].
3. **Two agents on one event.** Copy per subscription with independent retries, as every platform does [V 3][V 25][V 39][V 47]. Drop first-registration-wins; no precedent offers it. If exclusivity is ever needed, express it as a `start.key` that both agents share so the second start collapses on the key, the way Temporal's one-execution-per-id and Inngest's 24 h event `id` behave [V 3][V 92].
4. **Signature verification.** In the ingress, from a builder-registered secret, as Svix Ingest and Hookdeck do; reject before persisting and record the rejection [V 15][V 21]. Provide a generic HMAC verifier (Standard Webhooks `v1`) plus GitHub, Linear and Slack schemes, and a `genericWebhook` escape hatch for providers without one [V 15][V 54]. Keep the raw body available to any bundle transform so a builder can verify a scheme the platform lacks, which is Inngest's model [V 1].
5. **Routing to a paused session.** A matched event becomes a row in the session's inbox and a claimable wake-up; a running session sees it on its next loop iteration or via a wake signal. Correlation is a predicate the session registered when it paused (`wait_for`), stored in the database, and evaluated by the ingress on each delivery, which is Inngest's `waitForEvent` shape [V 2]. Avoid depending on `LISTEN/NOTIFY` for correctness; use it, if at all, as a latency hint over a poll [V 80][V 81][V 83]. For the agent's own emitted events, write the outbox row in the same transaction as the side effect (pg-boss `db` or Graphile `add_job`), and dedupe on the CloudEvents `id` at the consumer [V 74][V 76][V 51].

## Sources

1. Inngest, Webhooks, n.d.: https://www.inngest.com/docs/platform/webhooks
2. Inngest, step.waitForEvent reference, n.d.: https://www.inngest.com/docs/reference/functions/step-wait-for-event
3. Inngest, Events, n.d.: https://www.inngest.com/docs/events
4. Inngest, Writing expressions, n.d.: https://www.inngest.com/docs/guides/writing-expressions
5. Inngest, Fan-out jobs, n.d.: https://www.inngest.com/docs/guides/fan-out-jobs
6. Trigger.dev, Webhook guides overview, n.d.: https://trigger.dev/docs/guides/frameworks/webhooks-guides-overview
7. Trigger.dev, Wait for token, n.d.: https://trigger.dev/docs/wait-for-token
8. Trigger.dev, Idempotency, n.d.: https://trigger.dev/docs/idempotency
9. Microsoft Learn, Hosted agents in Foundry Agent Service, ms.date 2026-09-11: https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents
10. Microsoft Learn, Foundry Hosted Agents (Agent Framework), ms.date 2026-09-19: https://learn.microsoft.com/en-us/agent-framework/hosting/foundry-hosted-agent
11. Microsoft Learn, Trigger a Foundry Agent using Logic Apps (classic), ms.date 2026-01-06: https://learn.microsoft.com/en-us/azure/foundry-classic/agents/how-to/triggers
12. Claude Platform, Managed Agents: Subscribe to webhooks, beta `managed-agents-2026-04-01`: https://platform.claude.com/docs/en/managed-agents/webhooks
13. Claude Platform, Managed Agents overview, beta: https://platform.claude.com/docs/en/managed-agents/overview
14. Claude Cookbook, SRE incident response agent with Managed Agents, n.d.: https://platform.claude.com/cookbook/managed-agents-sre-incident-responder
15. Svix Docs, Receiving webhooks with Ingest, n.d.: https://docs.svix.com/ingest/receiving-with-ingest
16. Svix Docs, Transformations, n.d.: https://docs.svix.com/transformations
17. Svix Blog, Improving JavaScript webhook transformations, 2025-12-09: https://www.svix.com/blog/improving-transformations/
18. Svix Docs, Retries, n.d.: https://docs.svix.com/retries
19. Svix Docs, Verifying webhooks with the Svix libraries, n.d.: https://docs.svix.com/receiving/verifying-payloads/how
20. Hookdeck Docs, Sources, n.d.: https://hookdeck.com/docs/sources
21. Hookdeck Docs, Requests, n.d.: https://hookdeck.com/docs/requests
22. Hookdeck Docs, Transformations, n.d.: https://hookdeck.com/docs/transformations
23. Hookdeck Docs, Filters, n.d.: https://hookdeck.com/docs/filters
24. Hookdeck Docs, Retries, n.d.: https://hookdeck.com/docs/retries
25. Hookdeck Docs, Connections, n.d.: https://hookdeck.com/docs/connections
26. Zapier Platform, Triggers, n.d.: https://docs.zapier.com/platform/build/trigger
27. Zapier Platform, REST Hook trigger, n.d.: https://docs.zapier.com/platform/build/hook-trigger
28. Zapier Platform, Deduplication, n.d.: https://docs.zapier.com/platform/build/deduplication
29. Make Developers, Trigger (polling), n.d.: https://developers.make.com/custom-apps-documentation/app-components/modules/trigger
30. Make Developers, Instant trigger (webhook), n.d.: https://developers.make.com/custom-apps-documentation/app-components/modules/instant-trigger
31. Make Developers, Webhooks component, n.d.: https://developers.make.com/custom-apps-documentation/app-components/webhooks
32. Make Help, Webhooks, n.d.: https://help.make.com/webhooks
33. n8n Docs, Webhook node, n.d.: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
34. n8n Docs, Wait node, n.d.: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/
35. n8n source, `GithubTrigger.node.ts` (master), read 2026-09-27: https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Github/GithubTrigger.node.ts
36. Knative, Event sources, n.d.: https://knative.dev/docs/eventing/sources/
37. knative-extensions/eventing-github, `githubsource_types.go` (main), read 2026-09-27: https://github.com/knative-extensions/eventing-github/blob/main/pkg/apis/sources/v1alpha1/githubsource_types.go
38. knative-extensions/eventing-github README (Alpha), read 2026-09-27: https://github.com/knative-extensions/eventing-github
39. Knative, Brokers, n.d.: https://knative.dev/docs/eventing/brokers/
40. Knative 1.23, Triggers: https://knative.dev/docs/eventing/triggers/
41. Knative, Event delivery, n.d.: https://knative.dev/docs/eventing/event-delivery/
42. Knative, Knative Broker for Apache Kafka, n.d.: https://knative.dev/docs/eventing/brokers/broker-types/kafka-broker/
43. Knative, Channel based broker, n.d.: https://knative.dev/docs/eventing/brokers/broker-types/channel-based-broker/
44. Argo Events, GitHub event source setup, n.d.: https://argoproj.github.io/argo-events/eventsources/setup/github/
45. argoproj/argo-events, `examples/event-sources/github.yaml` (master), read 2026-09-27: https://github.com/argoproj/argo-events/blob/master/examples/event-sources/github.yaml
46. Argo Events, EventSource concept, n.d.: https://argoproj.github.io/argo-events/concepts/event_source/
47. Argo Events, JetStream EventBus, n.d.: https://argoproj.github.io/argo-events/eventbus/jetstream/
48. Argo Events, More about sensors and triggers, n.d.: https://argoproj.github.io/argo-events/sensors/more-about-sensors-and-triggers/
49. Argo Events, Filters introduction, n.d.: https://argoproj.github.io/argo-events/sensors/filters/intro/
50. Argo Events, Parameterization tutorial, n.d.: https://argoproj.github.io/argo-events/tutorials/02-parameterization/
51. CloudEvents specification v1.0.3-wip: https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
52. CloudEvents Subscriptions API 0.1-wip: https://github.com/cloudevents/spec/blob/main/subscriptions/spec.md
53. CloudEvents SQL Expression Language 1.0.0: https://github.com/cloudevents/spec/blob/main/cesql/spec.md
54. Standard Webhooks specification 1.0.0: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
55. GitHub Docs, Validating webhook deliveries, n.d.: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
56. GitHub Docs, Best practices for using webhooks, n.d.: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
57. GitHub Docs, Handling failed webhook deliveries, n.d.: https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
58. GitHub Docs, Webhook events and payloads, n.d.: https://docs.github.com/en/webhooks/webhook-events-and-payloads
59. GitHub Docs, Using webhooks with GitHub Apps, n.d.: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps
60. Linear Developers, Webhooks, n.d.: https://linear.app/developers/webhooks
61. Linear Developers, Agents: getting started, n.d.: https://linear.app/developers/agents
62. Linear Developers, Agent interaction, n.d.: https://linear.app/developers/agent-interaction
63. Slack Developer Docs, The Events API, n.d.: https://docs.slack.dev/apis/events-api/
64. Slack Developer Docs, Verifying requests from Slack, n.d.: https://docs.slack.dev/authentication/verifying-requests-from-slack/
65. Slack Developer Docs, Using Socket Mode, n.d.: https://docs.slack.dev/apis/events-api/using-socket-mode/
66. Svix Docs, Channels, n.d.: https://docs.svix.com/channels
67. Temporal, Message passing (TypeScript SDK), n.d.: https://docs.temporal.io/develop/typescript/message-passing
68. Cloudflare, Workers for Platforms, n.d.: https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/
69. Cloudflare, How Workers works, n.d.: https://developers.cloudflare.com/workers/reference/how-workers-works/
70. Shopify, Functions API reference and limitations, n.d.: https://shopify.dev/docs/api/functions/latest
71. A2A Protocol specification 1.0.0: https://a2a-protocol.org/latest/specification/
72. Agent Sandbox docs, Anthropic Managed Agents use case, updated 2026-09-25: https://agent-sandbox.sigs.k8s.io/docs/use-cases/anthropic-managed-agents/
73. pg-boss 12.35.0, home: https://pgboss.io/
74. pg-boss, Jobs API (`send` options): https://pgboss.io/api/jobs
75. pg-boss, Workers API (`work` options): https://pgboss.io/api/workers
76. Graphile Worker, SQL `add_job`, n.d.: https://worker.graphile.org/docs/sql-add-job
77. Graphile Worker, `addJob` (library), n.d.: https://worker.graphile.org/docs/library/add-job
78. Graphile Worker, home, n.d.: https://worker.graphile.org/
79. pgmq README (v1.10.0 image tag), read 2026-09-27: https://github.com/pgmq/pgmq
80. PostgreSQL 18, NOTIFY: https://www.postgresql.org/docs/current/sql-notify.html
81. PostgreSQL 18, LISTEN: https://www.postgresql.org/docs/current/sql-listen.html
82. PgBouncer, Features (pooling mode table), n.d.: https://www.pgbouncer.org/features.html
83. Recall.ai, Postgres LISTEN/NOTIFY does not scale, 2025-07-01: https://www.recall.ai/blog/postgres-listen-notify-does-not-scale
84. postgres/postgres commit 282b1cde, "Optimize LISTEN/NOTIFY via shared channel map and direct advancement", 2026-01-15: https://github.com/postgres/postgres/commit/282b1cde
85. Debezium 3.6, Outbox event router: https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
86. Debezium 3.6, PostgreSQL connector: https://debezium.io/documentation/reference/stable/connectors/postgresql.html
87. Debezium blog, Reliable microservices data exchange with the outbox pattern, 2019-02-19: https://debezium.io/blog/2019/02/19/reliable-microservices-data-exchange-with-the-outbox-pattern/
88. Watermill, SQL Pub/Sub, n.d.: https://watermill.io/pubsubs/sql/
89. River, Transactional enqueueing, n.d.: https://riverqueue.com/docs/transactional-enqueueing
90. River, Transactional job completion, n.d.: https://riverqueue.com/docs/transactional-job-completion
91. Dapr, How-to: enable the transactional outbox pattern, n.d.: https://docs.dapr.io/developing-applications/building-blocks/state-management/howto-outbox/
92. Temporal, Sending messages, n.d.: https://docs.temporal.io/sending-messages
93. Temporal, Handling messages, n.d.: https://docs.temporal.io/handling-messages
