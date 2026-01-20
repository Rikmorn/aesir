---
phase: 13-data-layer
plan: 06
subsystem: integrations
tags: [credentials, migration, cleanup, database]
dependency_graph:
  requires: ["13-05"]
  provides: ["database-only-credentials", "clean-codebase"]
  affects: []
tech_stack:
  added: []
  patterns: ["database-backed-credentials", "migration-script"]
key_files:
  created:
    - packages/integrations/src/db/scripts/migrate-tokens.ts
  modified:
    - packages/integrations/package.json
    - docker-compose.yml
    - .gitignore
    - packages/integrations/src/linear/token-store.ts
    - packages/integrations/src/linear/index.ts
    - packages/agents/src/scripts/linear-oauth.ts
    - .env.example
    - .claude/CLAUDE.md
  deleted:
    - .tokens/
decisions:
  - Direct database connection in migration script to avoid full environment validation
  - Migration script inlines schema definition to prevent triggering config validation
  - File fallback removed from OAuth flow (database is sole storage)
metrics:
  duration: "8 min"
  completed: "2026-01-20"
---

# Phase 13 Plan 06: Migration Cleanup Summary

Migration script, .tokens/ deletion, docker-compose cleanup, legacy code removal.

## Tasks Completed

### Task 1: Migrate existing Linear token to database (8f07e9a)

Created one-time migration script that:
- Uses direct database connection (bypasses full environment validation)
- Defines credentials table inline to avoid importing from schema (which triggers config)
- Checks for existing credential before inserting (idempotent)
- Encrypts tokens using same AES-256-CBC as credential-store

Migration ran successfully, verified by re-running and seeing "already exists, skipping".

### Task 2: Delete .tokens and update docker-compose (9945e03)

- Deleted `.tokens/` directory
- Removed `.tokens` volume mount from `dev-agent` service
- Removed `.tokens` volume mount from `oauth` service
- Added `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` env vars to all agent services
- Added `CREDENTIAL_ENCRYPTION_KEY` env var to `dev-agent`, `product-agent`, `oauth` services
- Added PostgreSQL dependency to `oauth` service
- Removed `.tokens/` from `.gitignore`

### Task 3: Remove legacy file functions and update docs (33611ee)

Removed from `token-store.ts`:
- `loadLinearTokensFromFile`
- `saveLinearTokensToFile`
- `createLinearClientFromFile`
- `TokenFileNotFoundError` class
- `InvalidTokenFileError` class
- fs imports and DEFAULT_TOKEN_FILE constant

Updated `index.ts` exports to only export database-backed functions.

Updated `linear-oauth.ts`:
- Removed file fallback (database is sole storage now)
- Removed fs imports
- Simplified saveTokens function

Updated `.env.example`:
- Added `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- Added `CREDENTIAL_ENCRYPTION_KEY` with generation instructions

Updated `CLAUDE.md`:
- Changed "OAuth tokens in .tokens/" to "OAuth tokens encrypted in PostgreSQL"
- Updated OAuth Tokens section with CREDENTIAL_ENCRYPTION_KEY requirement
- Marked "PostgreSQL-based credentials storage" as complete

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Direct DB connection in migration | Full env validation requires all API keys (Anthropic, Slack, etc.) which aren't needed for migration | Use env file with dummy values |
| Inline schema in migration | Importing schema.ts triggers @aesir/common which triggers env validation | Copy schema to separate file |
| No file fallback in OAuth | Migration complete, database is stable, simplifies code | Keep fallback for safety |

## Verification Results

All verification criteria passed:

- `.tokens/` directory does not exist
- `docker-compose.yml` has no .tokens volume mounts
- `grep -r "\.tokens" packages/` returns nothing (except migration script)
- `grep -r "loadLinearTokensFromFile" packages/` returns nothing
- `.env.example` contains DB_HOST, CREDENTIAL_ENCRYPTION_KEY
- Database has Linear credential (count = 1)

## Phase 13 Complete

This was the final plan of Phase 13 (Data Layer). All 6 plans complete:

1. **13-01**: Database utilities (createId, connection config)
2. **13-02**: Integrations schema (credentials, webhook_deliveries, sync_cursors)
3. **13-03**: Drizzle migrations (schema creation, initial structure)
4. **13-04**: Credential encryption (AES-256-CBC, storeCredential, getCredential)
5. **13-05**: Linear integration wiring (createLinearClientFromDatabase)
6. **13-06**: Migration cleanup (migrate tokens, delete .tokens/, remove legacy)

## Next Phase Readiness

Phase 14 (Error Handling) has no blockers from this phase.
