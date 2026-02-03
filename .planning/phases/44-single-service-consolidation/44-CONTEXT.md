# Phase 44: Single Service Consolidation - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

One HTTP service replacing dev-agent:3004, product-agent:3005, and router:3006 -- with unified /events endpoint, management endpoints, integrated worker loop, and graceful shutdown. All framework components from Phases 37-43 are wired together in a single process.

</domain>

<decisions>
## Implementation Decisions

### HTTP framework
- Use Express (not raw `createServer`) -- simplifies routing, middleware, error handling
- All routes in a single file (main.ts bootstrap) -- only 4 routes, not worth modularizing
- Endpoints: `GET /health`, `POST /events`, `GET /conversations/:id`, `POST /conversations/:id/cancel`

### Worker concurrency
- Configurable via `MAX_CONCURRENT_CONVERSATIONS` env var, default 5
- Standard async/await concurrency -- no worker threads (conversations are I/O-bound: Anthropic API calls, MCP tool calls, Docker exec)
- Worker loop claims up to N queued conversations per poll cycle, runs them in parallel via Promise.allSettled
- When at capacity, new conversations stay `queued` in DB and picked up when a slot opens (next poll cycle after any conversation pauses/completes/fails)

### Service migration approach
- Clean break from old services -- no porting of old event handlers (createDevAgentEventsHandler, createProductAgentEventsHandler)
- The adapter -> EventRouter -> executor pipeline (Phases 42-43) replaces all event handling logic
- New main.ts uses only framework components (executor, router, event log, registries, etc.)

### Env var strategy (split with Phase 47)
- Phase 44: introduce new env vars (MAX_CONCURRENT_CONVERSATIONS, WORKER_POLL_INTERVAL_MS, etc.) and remove Temporal-specific vars (TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE)
- Phase 47: broader naming audit -- rename legacy per-agent vars (e.g., PRODUCT_AGENT_ALLOWED_CHANNELS -> SLACK_ALLOWED_CHANNELS) and audit all env vars for tool-level vs agent-level scope
- Update .env.example and docker-compose.yml with new vars in Phase 44

### Health check
- Liveness only -- return 200 if the server can respond, no dependency checks (DB, pg-boss, worker)
- Easy to add readiness checks later if needed

### Graceful shutdown
- On SIGTERM: stop accepting new HTTP connections (server.close())
- Set shutting-down flag checked by worker loop between poll cycles
- Running conversations: let current agent loop iterations complete, persist state at next natural boundary (wait_for, completion)
- Force-persist and exit after configurable grace timeout (Docker stop_grace_period)
- Flush event log before exit

### Docker Compose changes
- Remove 6 services: dev-agent, dev-agent-worker, product-agent, router, temporal, temporal-ui
- Add 1 service: agent-service (port 3004, depends on postgresql + integration services)
- Docker socket mount preserved for DevContainerManager
- Update integration service env vars to point to agent-service:3004/events instead of router:3006/events

### Bootstrap sequence
- env validation -> DB connect -> create AgentRegistry -> create ToolRegistry (register factories) -> create EventLog -> create SessionProjection -> create TimeoutScheduler -> create ConversationExecutor -> create EventRouter -> start Express server -> start worker polling loop -> register shutdown handlers

### Claude's Discretion
- Exact Express middleware choices (JSON body parser, error handler, request logging)
- Worker poll interval default (research suggests 5s)
- Force shutdown timeout value
- Whether to run DB migrations in bootstrap or require them separately

</decisions>

<specifics>
## Specific Ideas

- Per-agent env vars like PRODUCT_AGENT_ALLOWED_CHANNELS are naming baggage from the multi-service era -- they should be scoped to tools/integrations, not agents. Full audit deferred to Phase 47 but the principle is: env vars should reflect what they configure (SLACK_ALLOWED_CHANNELS), not which agent uses them.
- In the future, channel allowlists could move to DB config with agents selecting channels dynamically -- but that's beyond v2.3 scope.

</specifics>

<deferred>
## Deferred Ideas

- Legacy env var naming audit (PRODUCT_AGENT_ALLOWED_CHANNELS etc.) -- Phase 47
- Readiness health check (DB, pg-boss, worker status) -- future enhancement
- Worker thread isolation for memory safety -- not needed for I/O-bound workloads
- Dynamic concurrency scaling based on memory pressure -- future if needed

</deferred>

---

*Phase: 44-single-service-consolidation*
*Context gathered: 2026-02-03*
