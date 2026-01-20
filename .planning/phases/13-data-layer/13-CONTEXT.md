# Phase 13: Data Layer - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

PostgreSQL schema structure with encrypted credential storage replacing .tokens/ files. Create platform, integrations, observability schemas with migrations. Migrate existing OAuth token from .tokens/ to database. Delete .tokens/ directory.

</domain>

<decisions>
## Implementation Decisions

### Schema Organization

- **Package ownership**: 1:1 mapping between packages and schemas (platform schema for platform package, integrations schema for integrations package, etc.)
- **No shared tables**: Each package manages its own state. Data sharing happens via APIs/events, not direct table access
- **Cross-schema FKs**: Allowed for now — pragmatic choice, revisit after observing real access patterns
- **Table naming**: Plural nouns (credentials, configurations, agent_executions)
- **Column naming**: snake_case (created_at, user_id, access_token) — PostgreSQL native, ORM handles camelCase mapping
- **Per-schema migration tracking**: Each schema has its own migrations table (platform.schema_migrations, integrations.schema_migrations)

### Primary Keys & IDs

- **Prefixed IDs**: Format `prefix_<24-char-nanoid>` (e.g., cred_abc123xyz..., exec_def456...)
- **Stored as**: TEXT/VARCHAR with app-generated values
- **Benefits**: Human-readable, self-describing in logs, supports branded types in TypeScript

### Standard Columns

- **Timestamps**: All tables have created_at, updated_at, deleted_at (soft deletes)
- **updated_at management**: Claude's discretion per-table based on access patterns and ORM capabilities

### Data Types

- **Prefer normalized columns**: JSONB only for truly dynamic metadata, not for semi-structured data that could be columnar
- **Enums**: TEXT with CHECK constraints — database-enforced but easier to modify than PostgreSQL ENUM types
- **Indexes**: Contextual decisions, Claude surfaces reasoning before adding indexes

### ORM & Tooling

- **ORM/client selection**: Deferred to research phase — Drizzle, Kysely, Prisma all candidates
- **Connection pooling**: ORM built-in pooling (PgBouncer deferred as infra concern)
- **Type generation**: ORM-derived types from schema definition

### Migration Strategy

- **Migration format**: SQL files primary, TypeScript scripts when needed for data transformations
- **Per-package migrations**: Each package has its own migrations/ directory
- **File naming**: Timestamp prefix (20260120143022_create_credentials.sql)
- **Idempotency**: Tracking table prevents re-run (simplest), formal idempotency discipline for production later
- **Rollback strategy**: Forward-only during development, revisit for production
- **Transactions**: Default transactional, per-migration opt-out for operations like CREATE INDEX CONCURRENTLY
- **Execution**: Manual command for now (`pnpm migrate`), CI/CD integration in Phase 21
- **Both levels supported**: Root-level for full-project deploys, per-package for isolated deployments
- **Migration ordering**: Claude's discretion based on actual schema dependencies
- **Seed data**: Separate seeds/ directory, never run in production
- **Migration runner**: Use existing tools (ORM's tool or standalone), no custom scripts

### Credential Migration from .tokens/

- **Approach**: Manual data insertion during phase work — only one credential exists
- **No fallback period**: Straight cut-over, .tokens/ deleted immediately after insert
- **No migration script**: Too simple to warrant automation

### Access Patterns

- **Data access pattern**: Direct ORM queries — no premature repository/service abstraction
- **Credential caching**: Short TTL cache to reduce DB round-trips
- **Token refresh**: Owned by each integration, encapsulated in integration module (e.g., getLinearCredential() checks expiry and refreshes if needed)
- **Multi-tenancy**: Schema supports multiple workspaces (workspace_id), single workspace used initially
- **Transaction management**: Mix of explicit caller transactions and internal service transactions, depends on operation
- **Read replicas**: Connection abstraction supports primary + replica from the start
- **Error handling**: Exceptions for Phase 13 (Result types deferred to Phase 15)
- **Query logging**: Development only, full queries with parameters
- **Connection string**: Separate components (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME) — better for secret injection
- **Per-package connections**: Each package manages its own DB connection — maximum flexibility while patterns emerge
- **Health checks**: Deferred to production phases

### Claude's Discretion

- ORM/client selection (evaluate during research)
- updated_at trigger vs application code (per-table decision)
- Index creation (surface reasoning before adding)
- Migration ordering across packages
- Specific table schemas within the decided conventions

</decisions>

<specifics>
## Specific Ideas

- "Each package should manage its own state and even have their own tables that are not shared. If data needs to be shared it should be through API or events" — enables future polyglot persistence
- "Per-package connections for now, connection pool issues can be solved with infra PgBouncer" — prefer flexibility during development
- "Pragmatic during development, conservative for production" — migration discipline evolves with maturity

</specifics>

<deferred>
## Deferred Ideas

- **Credential encryption at rest**: Discussed briefly, explicitly deferred — not critical at this stage
- **PgBouncer connection pooling**: Infrastructure concern, solve at infra layer if needed
- **Database health checks**: Production concern, handle in later phases
- **Result types for DB errors**: Phase 15 (Code Quality) scope

</deferred>

---

*Phase: 13-data-layer*
*Context gathered: 2026-01-20*
