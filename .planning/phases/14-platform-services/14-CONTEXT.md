# Phase 14: Platform Services - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Core platform services for webhook handling, execution tracking, and dependency injection. Includes webhook idempotency, agent execution recording, sync cursor persistence, LangGraph checkpoint cleanup, factory-based service creation, and layer boundary enforcement.

</domain>

<decisions>
## Implementation Decisions

### Execution Tracking
- Simple status granularity: started, completed, failed (three states)
- Minimal metadata: agent type, issue ID (as string, not FK), timestamps
- Store explicit duration_ms field alongside timestamps for faster queries
- Mark failed with last known state (capture which step/node failed)
- Include workspace_id column for multi-tenant filtering
- Index on (status, started_at) for efficient queries on recent failures
- Webhook handler creates execution record (not agent entry point)

### Cleanup & Retention
- Single retention period via RETENTION_DAYS env var (default: 14 days)
- Cleanup handles all time-bound data: LangGraph checkpoints, execution records, webhook dedup records
- Both scheduled + manual trigger (scheduled job plus npm script)
- Delete in batches of 1000 to avoid long-running transactions
- Detailed logging: log each deleted ID for audit trail
- Dry-run mode via --dry-run flag to preview deletions
- Protect in-progress executions: skip records with "started" status regardless of age
- Logs only for metrics (no separate programmatic return)

### DI Patterns
- Simple factory functions: createCredentialStore({ db, logger, config })
- Options object signature (named, extensible)
- Hybrid instantiation: create base services at startup, wrap with per-request context (child instances)
- Throw on invalid config (fail fast at startup)
- Import each factory individually (no bundled services module)
- Accept logger in options (explicit, testable)
- Refactor existing credential store to match new pattern
- Add Biome rule for layer boundary enforcement (in addition to TypeScript project references)
- Document testing pattern in CLAUDE.md and sync to cursor settings
- Eager service creation at startup (not lazy)
- Shared database client passed to all services
- Services expose health() method for aggregated /health endpoint
- Services expose close() method for graceful shutdown on SIGTERM
- Configuration passed as dependency (not imported from env)
- Service wiring lives in each app's main.ts (not shared bootstrap)

### Webhook Idempotency
- PostgreSQL table for now (defer Redis/cache to productionalization backlog)
- 1 hour TTL for deduplication records
- Return 200 OK with X-Duplicate: true header for duplicates
- Per-source scoping: (source, delivery_id) composite key
- Atomic insert-or-skip: INSERT ... ON CONFLICT DO NOTHING, check affected rows
- Log duplicates at debug level
- Uniqueness strategy decided per source: use delivery ID header if available, otherwise Claude determines best fallback per integration
- Async processing: respond 202 Accepted, dispatch to Temporal workflow

### Claude's Discretion
- Failure handling strategy for cleanup mid-run
- Scheduled cleanup mechanism (Temporal workflow vs external cron)
- Service shape (classes vs plain objects) based on abstraction needs and DX
- Interface exports vs inferred types from factory returns
- Child instance state sharing pattern
- Generic vs concrete service types
- Duplicate detection ordering relative to signature validation per source

</decisions>

<specifics>
## Specific Ideas

- "PG for now, can add a cache at a later time" for webhook dedup — note as productionalization task
- Layer boundary enforcement should use Biome rule for clearer errors than TypeScript alone
- Testing documentation should cover both human developers and Claude/Cursor (keep settings in sync)
- Webhook uniqueness must adapt to each source's capabilities — if delivery ID header exists, use it; otherwise find something else that gives uniqueness

</specifics>

<deferred>
## Deferred Ideas

- Redis/cache layer for webhook deduplication (productionalization task)

</deferred>

---

*Phase: 14-platform-services*
*Context gathered: 2026-01-20*
