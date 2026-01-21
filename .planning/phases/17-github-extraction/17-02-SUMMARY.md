---
phase: 17-github-extraction
plan: 02
subsystem: database
tags: [drizzle, postgres, encryption, credential-store, aes-256-cbc, neverthrow]

# Dependency graph
requires:
  - phase: 17-01
    provides: Package scaffolding for @aesir/integration-github
  - phase: 16-02
    provides: Linear db schema pattern (owner field, encryption, ResultAsync)
provides:
  - GitHub database schema (github.* namespace)
  - Credential store with encryption
  - Database client and connection pool
affects: [17-03-oauth, 17-04-client, 17-05-webhooks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "owner field for GitHub org/user identification (replaces workspace_id)"
    - "Schema duplication (schema.ts + schema.drizzle.ts) for migration compatibility"
    - "ResultAsync error handling for credential store service boundaries"

key-files:
  created:
    - packages/integrations/github/src/db/schema.ts
    - packages/integrations/github/src/db/schema.drizzle.ts
    - packages/integrations/github/src/db/encryption.ts
    - packages/integrations/github/src/db/client.ts
    - packages/integrations/github/src/db/credential-store.ts
    - packages/integrations/github/src/db/index.ts
  modified: []

key-decisions:
  - "owner field for unique GitHub credential identification (org or user)"
  - "installation_id field for future GitHub Apps support (nullable)"
  - "Exact Linear pattern replication for consistency (AES-256-CBC, iv:ciphertext format)"

patterns-established:
  - "GitHub credentials table: id, owner, installation_id, encrypted_access_token, encrypted_refresh_token, token_type, scope, expires_at, created_at, updated_at, deleted_at"
  - "Webhook deliveries table: id, delivery_id (X-GitHub-Delivery header), event_type, payload_hash, processed_at, created_at"
  - "getByOwner() method replaces getByWorkspace() for GitHub-specific semantics"

# Metrics
duration: 2min
completed: 2026-01-21
---

# Phase 17 Plan 02: Database Schema Summary

**GitHub database layer with github.* schema namespace, AES-256-CBC encrypted credential store, and owner-based identification for orgs/users**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-21T20:39:35Z
- **Completed:** 2026-01-21T20:41:58Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- GitHub-specific schema namespace (github.*) with credentials and webhook_deliveries tables
- Credential store with ResultAsync error handling and encryption utilities
- Database client with PostgreSQL connection pool
- owner field for GitHub org/user identification (distinct from Linear's workspace_id)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create database schema and encryption utilities** - `f0b1406` (feat)
2. **Task 2: Create credential store with ResultAsync** - `a3e8ab1` (feat)

## Files Created/Modified
- `packages/integrations/github/src/db/schema.ts` - GitHub schema with credentials and webhook_deliveries tables
- `packages/integrations/github/src/db/schema.drizzle.ts` - Migration-compatible schema with inline nanoid
- `packages/integrations/github/src/db/encryption.ts` - AES-256-CBC token encryption (iv:ciphertext format)
- `packages/integrations/github/src/db/client.ts` - PostgreSQL connection pool and Drizzle ORM client
- `packages/integrations/github/src/db/credential-store.ts` - Database-backed credential storage with ResultAsync
- `packages/integrations/github/src/db/index.ts` - Barrel export for database layer

## Decisions Made
- **owner field for GitHub credentials:** Used `owner` (org or user) instead of Linear's `workspace_id` for GitHub-specific semantics and clearer intent
- **installation_id for future GitHub Apps:** Added nullable `installation_id` field to credentials table for future GitHub Apps integration support
- **Exact Linear pattern replication:** Followed Linear's encryption, credential store, and ResultAsync patterns exactly for consistency across integration packages

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Biome formatting issue in credential-store.ts** - Pre-commit hook caught `.where()` method chaining formatting (multi-line needed single-line). Applied Biome fix automatically.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Database schema ready for migrations (17-03 will create migration SQL)
- Credential store ready for OAuth flow integration (17-03)
- Encryption utilities ready for token storage
- No blockers for next plan

---
*Phase: 17-github-extraction*
*Completed: 2026-01-21*
