# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-19)

**Core value:** Maintainable, scalable foundation for end-to-end automated development workflows
**Current focus:** Phase 17 - GitHub Extraction (in progress)

## Current Position

Phase: 17 of 22 (GitHub Extraction)
Plan: 3 of TBD in current phase
Status: In progress
Last activity: 2026-01-21 - Completed 17-03-PLAN.md

Progress: [#############       ] 81% (57 plans complete)

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |

## Performance Metrics

**Velocity:**
- Total plans completed: 57 (v2.0)
- Average duration: ~6 min
- Total execution time: ~379 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 10-foundation-setup | 4/4 | ~44 min | ~11 min |
| 11-monorepo-setup | 4/4 | ~41 min | ~10 min |
| 12-observability | 8/8 | 78 min | 10 min |
| 13-data-layer | 6/6 | 38 min | 6 min |
| 14-platform-services | 8/8 | 14 min | 2 min |
| 15-code-quality | 8/8 | 111 min | 14 min |
| 16-linear-extraction | 11/11 | 55 min | 5 min |
| 17-github-extraction | 3/TBD | 5 min | 2 min |

**Recent Trend:**
- Last 5 plans: 17-03 (1 min), 17-02 (2 min), 17-01 (2 min), 16-11 (10 min), 16-10 (7 min)
- Trend: Phase 17 progressing rapidly - webhook infrastructure complete

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.0]: 3-layer architecture (Platform -> Integrations -> Agents)
- [v2.0]: Biome over ESLint/Prettier for speed
- [v2.0]: MCP for agent-integration communication (LLM calls only)
- [v2.0]: pino for logging, dotenv-flow for config
- [v2.0]: 13 smaller phases to avoid gaps experienced in v1
- [10-01]: --legacy-peer-deps for npm due to LangChain peer dependency conflicts
- [10-01]: Allow PascalCase for variables (Zod schemas) in Biome naming convention
- [10-01]: 49 Biome violations deferred for future cleanup (noNonNullAssertion, noExplicitAny)
- [10-02]: dotenv-flow with default_node_env: development to handle missing NODE_ENV
- [10-02]: Presence-only validation for secrets (.min(1), no format patterns)
- [10-02]: Dual export: env (raw vars) + config (typed nested object)
- [10-03]: Full project tsc --noEmit in pre-commit (staged-only type checking is fundamentally broken)
- [10-03]: Biome native --staged flag eliminates need for lint-staged
- [10-03]: .vscode/settings.json tracked in git for consistent team settings
- [10-04]: CLAUDE.md as comprehensive single file (251 lines)
- [10-04]: Cursor rules use .mdc format with frontmatter in .cursor/rules/ directory
- [11-01]: pnpm@9.15.0 as package manager (replaces yarn)
- [11-01]: TypeScript project references with composite builds
- [11-01]: Pre-commit hooks disabled during migration (re-enable in 11-04)
- [11-01]: Vitest projects mode for monorepo testing
- [11-02]: Layer dependencies encoded: common (leaf) -> platform -> integrations -> agents
- [11-02]: workspace:* protocol for internal dependencies
- [11-02]: Agents layer references integrations, not platform directly
- [11-03]: 129 TypeScript files migrated to 4 packages (common, platform, integrations, agents)
- [11-03]: src/ preserved as src_old/ for reference during import fixes
- [11-03]: Orphan files (phase-1.test.ts, old index.ts) moved to _legacy/ for review
- [11-04]: Shared types moved to common (IssueStatus, Sandbox, BoundActivities)
- [11-04]: State module moved from platform to common (cross-layer contract)
- [11-04]: Temporal activities moved from platform to agents (orchestration layer)
- [11-04]: Integrations re-exports platform types for agents access
- [12-01]: pino v10 (latest) for structured logging
- [12-01]: 16-char nanoid for correlation IDs (shorter, collision-resistant)
- [12-01]: Explicit redaction paths over ** wildcards (performance)
- [12-02]: Export as createPinoLogger (new) to maintain createLogger backward compat
- [12-02]: Conditionally spread redaction for exactOptionalPropertyTypes
- [12-02]: Cache component log levels at module load
- [12-03]: pino-http middleware with custom genReqId for correlation
- [12-03]: Local TemporalLoggerInterface type (no @temporalio/worker dependency)
- [12-03]: Temporal adapter adds temporal: true marker to logs
- [12-04]: Use createPinoLogger explicit import during migration
- [12-04]: Manual timing with durationMs field replaces startTimer pattern
- [12-04]: Keep env.ts console.error (intentional pre-logger startup errors)
- [12-05]: Component naming follows agents:subsystem:module pattern
- [12-05]: Pre-existing lint issues (noNonNullAssertion) out of scope for migration
- [12-06]: TraceEntry type separate from pino Logger (used by TraceStore for workflow debugging)
- [12-06]: createPinoLogger alias for backward compatibility during migration
- [12-07]: Per-request correlation via child loggers in webhook handlers
- [12-08]: Runtime.install at module level before any Temporal operations
- [12-08]: Dist cleanup is local-only since dist/ is gitignored
- [13-01]: 24-char nanoid for prefixed IDs (better collision resistance than UUIDv4)
- [13-01]: Separate DB env vars over DATABASE_URL (better for Kubernetes secret injection)
- [13-01]: CREDENTIAL_ENCRYPTION_KEY optional (allow running without encryption during setup)
- [13-02]: uniqueIndex with .where() for partial indexes in Drizzle
- [13-02]: workspace_id as text without FK to avoid cross-schema migration ordering issues
- [13-02]: Created observability package for Phase 14 agent_executions
- [13-03]: schema.drizzle.ts files for drizzle-kit (CJS bundler can't resolve workspace:* dependencies)
- [13-03]: IF NOT EXISTS for CREATE SCHEMA for idempotent migrations
- [13-03]: Direct DB connection in seed script to avoid full environment validation
- [13-04]: AES-256-CBC with unique IV per encryption for security
- [13-04]: iv:ciphertext hex format for encrypted token storage
- [13-04]: Soft-delete existing credential when storing new one for same workspace+provider
- [13-04]: Type contract tests for credential-store (full integration requires database)
- [13-05]: Retain legacy file functions with @deprecated for migration support
- [13-05]: Database-first with file fallback in OAuth flow during transition
- [13-05]: Use Awaited<ReturnType<>> for type annotations on dynamic import results
- [13-06]: Direct DB connection in migration script to avoid full environment validation
- [13-06]: Migration script inlines schema definition to prevent triggering config validation
- [13-06]: File fallback removed from OAuth flow (database is sole storage)
- [14-02]: Biome noRestrictedImports for layer boundary enforcement (clearer DX than TS project refs alone)
- [14-01]: Status enum as text with values array (not pgEnum) for simpler migration
- [14-01]: Composite index on (status, started_at) for querying recent failures
- [14-01]: RETENTION_DAYS defaults to 14 days
- [14-03]: ON CONFLICT DO NOTHING with RETURNING for atomic webhook deduplication
- [14-03]: Duplicates logged at debug level (expected behavior, not error)
- [14-04]: Warn (not error) when execution not found for complete/fail - defensive against race conditions
- [14-04]: Duration calculated server-side by fetching started_at from DB
- [14-05]: Raw pg Pool for cross-schema queries (integrations.*, observability.*, public.*)
- [14-05]: Thread ID pattern: approval-{issue_id} derived from existing codebase
- [14-05]: Delete order for checkpoints: writes -> blobs -> checkpoints (dependency order)
- [14-06]: Use onConflictDoUpdate for atomic cursor upsert
- [14-06]: Return boolean from clear() to indicate whether cursor existed
- [14-07]: Services created at startup, not per-request (single db connection shared)
- [14-07]: workspace_id hardcoded to ws_default for single-tenant MVP
- [14-07]: WebhookServices interface optional for backward compatibility
- [14-08]: Use single legacyStore instance for deprecated functions (performance)
- [14-08]: Type assertion for NodePgDatabase to PostgresJsDatabase (compatible interfaces)
- [15-01]: exactOptionalPropertyTypes handled with conditional property assignment
- [15-01]: Error code convention: LAYER_COMPONENT_ERROR (INT_, PLT_, AGT_)
- [15-01]: ValidationError httpStatus always returns 400 (Bad Request)
- [15-01]: toAppError preserves existing AppError instances (no double-wrapping)
- [15-02]: CredentialStore interface methods return ResultAsync for explicit error handling
- [15-02]: Legacy deprecated functions unwrap Results to maintain backward compatibility
- [15-02]: delete() now returns boolean (true=deleted, false=not found) instead of void
- [15-02]: Errors logged at wrap point with full context before returning
- [15-05]: Removed `export * from @aesir/common` from platform to prevent namespace pollution
- [15-05]: Observability hides db internals (only ExecutionTracker service is public API)
- [15-05]: Common uses `export *` with section headers (sub-modules have explicit exports)
- [15-05]: Re-exports from dependencies placed at end of file for clarity
- [15-04]: Zod validation after signature verification but before processing
- [15-04]: Non-AgentSession webhooks ignored without validation error (graceful handling)
- [15-04]: PRReviewEvent kept as deprecated alias for backward compatibility
- [15-03]: PLT_* prefix for platform errors, OBS_* prefix for observability errors
- [15-03]: health() and close() remain Promise-based (lifecycle methods not service boundaries)
- [15-03]: Execution tracking failures logged but don't fail request (best-effort)
- [15-06]: Exclude duplicate exports check in knip (agent alias intentional for LangGraph)
- [15-06]: SDK types as devDependencies in agents (type-only imports from @linear/sdk etc)
- [15-06]: db/scripts excluded from knip (migration scripts with inline dependencies)
- [15-06]: pino-pretty in ignoreDependencies (pino transport, not direct import)
- [15-07]: IntegrationServiceError separate from CredentialError (semantic clarity)
- [15-07]: Idempotency check failures are best-effort (don't block webhook processing)
- [15-07]: @langchain/core in dependencies not devDependencies (runtime import in exported mock-llm)
- [15-08]: Platform exports only its own modules without blanket re-export from @aesir/common
- [15-08]: Consumers import from @aesir/common directly for proper package boundaries
- [15-08]: @langchain/core added as platform devDependency to support mock-llm.ts
- [16-01]: packages/integrations/* pattern added to pnpm-workspace.yaml for nested integration packages
- [16-01]: Express over Hono for HTTP framework (familiar patterns, pino-http compatibility)
- [16-01]: Self-contained env validation per integration package (dotenv-flow + zod at package level)
- [16-01]: Linear-specific PostgreSQL schema namespace (linear.*) for full data isolation
- [16-01]: HTTP status mapping based on error codes (401 webhook/token, 400 oauth, 500 API)
- [16-04]: LinearConfig renamed to LinearOAuthConfig (naming conflict with env config type)
- [16-04]: WebhookPayloadBase.data optional (not all webhook types use it)
- [16-04]: Explicit | undefined for optional types with exactOptionalPropertyTypes
- [16-02]: Linear credentials table has no provider field (Linear-specific, workspace_id unique only)
- [16-02]: schema.drizzle.ts with inline nanoid for migration generation (CJS bundler compatibility)
- [16-02]: LinearCredentialStore.getByWorkspace() replaces getByProvider() (Linear-specific)
- [16-02]: All LinearCredentialStore methods return ResultAsync<T, LinearError>
- [16-03]: timingSafeEqual for HMAC signature verification to prevent timing attacks
- [16-03]: Zod SafeParseResult from parseAgentSessionPayload for controlled error handling
- [16-03]: data field in AgentSessionSchema matches WebhookPayloadBase contract (required even if unused)
- [16-06]: express.raw middleware for webhook signature verification (preserves raw body for HMAC)
- [16-06]: In-memory OAuth state storage acceptable for single-instance MVP
- [16-06]: Dynamic import of saveLinearTokens to avoid circular dependency during parallel execution
- [16-06]: Conditional property assignment pattern for exactOptionalPropertyTypes compliance
- [16-05]: loadLinearTokens and saveLinearTokens use Linear's credential store directly
- [16-05]: createLinearClientFromDatabase bridges credential store and client factory
- [16-05]: Token refresh automatically persisted via onTokenRefresh callback
- [16-05]: DEFAULT_WORKSPACE_ID = ws_default for single-tenant deployments
- [16-07]: Migration SQL uses IF NOT EXISTS for idempotent schema creation
- [16-07]: Migration script checks for schema existence before running SQL
- [16-07]: Credential migration filters by provider='linear' to isolate Linear data
- [16-07]: Migration scripts reuse existing IDs when migrating credentials
- [16-08]: Multi-stage Docker build separates builder and runtime for smaller final image
- [16-08]: Non-root user (aesir:1001) runs service in container for security
- [16-08]: README documents both service and library usage patterns
- [16-08]: .env.example includes all required and optional variables with defaults
- [16-09]: vi.mock pattern for isolating tests from config validation in Linear package
- [16-09]: Type contract tests for credential-store (full integration tests deferred to Phase 20)
- [16-09]: Focus factory tests on token type detection (refresh flow requires complex fetch mocking)
- [16-10]: IssueStatus re-exported from @aesir/common (shared type, not Linear-specific)
- [16-10]: Old Linear source preserved in _legacy/ for reference during migration
- [16-10]: Disable Biome organizeImports for integrations/src/index.ts (intentional section headers)
- [16-10]: _legacy/ excluded from TypeScript compilation and Biome checks
- [16-11]: Migration script placed in package directory for module resolution (drizzle-orm accessible)
- [16-11]: `pnpm --filter @aesir/integration-linear migrate` as standard migration command
- [17-01]: GitHub service PORT defaults to 3002 (Linear uses 3001, avoid conflicts)
- [17-01]: github.* schema namespace for database isolation (parallel to linear.*)
- [17-01]: @octokit/webhooks-methods for GitHub signature verification
- [17-01]: GitHubError extends AppError with INT_GITHUB_* error codes
- [17-03]: verifyWebhookRequest helper extracts metadata (deliveryId, eventType) along with verification
- [17-03]: parsePRReviewPayload returns SafeParseReturnType for controlled error handling
- [17-03]: Synthetic ZodError for JSON parse failures in webhook parser

### Pending Todos

1. **Run dev-agent container as non-root** (infrastructure)
   - File: `.planning/todos/pending/2026-01-19-dev-agent-container-root-user.md`

2. **Fix 49 Biome lint violations** (code quality)
   - 34 noNonNullAssertion, 8 noExplicitAny, 7 other
   - Track in: 10-01-SUMMARY.md Remaining Violations section

3. **Fix pre-existing test failures** (code quality)
   - dev-workflow-state.test.ts - wrong assertions
   - commit-pr.test.ts - mock setup issues
   - linear/integration.test.ts - assertion mismatch

4. **Review _legacy/ files** (code cleanup)
   - phase-1.test.ts - may need to move to agents integration tests
   - old index.ts - likely obsolete, can be deleted after verification

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-01-21
Stopped at: Completed 17-03-PLAN.md
Resume file: None
Next action: Execute 17-04-PLAN.md (Webhook HTTP Routes)

---
*Updated: 2026-01-21 after Phase 16 completed*
