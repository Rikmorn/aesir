---
phase: 68-shared-memory
plan: 01
subsystem: database, infra
tags: [pgvector, drizzle, postgresql, embeddings, ollama, voyage]

# Dependency graph
requires: []
provides:
  - agents.knowledge_entries table with pgvector extension and HNSW index
  - Drizzle schema definition for knowledgeEntries with customType unconstrained vector
  - Embedding environment configuration (EMBEDDING_PROVIDER, OLLAMA_*, VOYAGE_*)
  - createId.knowledgeEntry() generating ke_ prefixed IDs
  - pgvector/pgvector:pg15 Docker image replacing postgres:15-alpine
  - Ollama Docker service (embedding profile, opt-in)
affects: [68-02, 68-03, 68-04, 69-entity-directory]

# Tech tracking
tech-stack:
  added: [pgvector, ollama/ollama Docker image]
  patterns: [customType for unconstrained vector columns, embedding profile for Docker Compose]

key-files:
  created:
    - packages/agents/src/shared/db/migrations/0007_add_knowledge_entries.sql
  modified:
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/src/shared/env/config.ts
    - packages/types/src/utils/ids.ts
    - docker-compose.yml
    - .env.example

key-decisions:
  - "customType for unconstrained vector: Drizzle's built-in vector() requires fixed dimensions, but we need unconstrained to support 768 (Ollama) and 1024 (Voyage) without schema changes"
  - "Ollama via Docker profile: keeps default docker compose up unchanged for developers not working on knowledge features"
  - "text placeholder in schema.drizzle.ts: drizzle-kit CJS bundler cannot resolve customType, so text prevents destructive migration diffs"

patterns-established:
  - "customType vector column: use customType from drizzle-orm/pg-core for pgvector columns with number[] <-> vector string mapping"
  - "Docker Compose profiles: use profiles for optional services (embedding profile for Ollama)"

# Metrics
duration: 4min
completed: 2026-02-10
---

# Phase 68 Plan 01: Schema & Infrastructure Summary

**pgvector knowledge_entries table with 5 indexes, customType unconstrained vector column, and embedding env config with Ollama/Voyage provider support**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-10T19:03:26Z
- **Completed:** 2026-02-10T19:07:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created agents.knowledge_entries table with pgvector extension, 6-type CHECK constraint, dedup/scope/expiry/active/HNSW indexes
- Added Drizzle schema with customType unconstrained vector column supporting variable embedding dimensions
- Extended agent env config with Zod-validated embedding provider settings (Ollama default, Voyage optional)
- Swapped PostgreSQL Docker image to pgvector/pgvector:pg15 and added Ollama service under embedding profile

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration and Drizzle schema for knowledge_entries** - `2ccf817` (feat)
2. **Task 2: Environment configuration and Docker image swap** - `358e627` (feat)

## Files Created/Modified
- `packages/agents/src/shared/db/migrations/0007_add_knowledge_entries.sql` - pgvector extension, knowledge_entries table, 5 indexes
- `packages/agents/src/shared/db/schema.ts` - Drizzle knowledgeEntries table with customType vector column
- `packages/agents/src/shared/db/schema.drizzle.ts` - Mirror table definition with text placeholder for vector
- `packages/agents/src/shared/env/config.ts` - Embedding provider env vars and config section
- `packages/types/src/utils/ids.ts` - knowledgeEntry ID generator (ke_ prefix)
- `docker-compose.yml` - pgvector image swap, Ollama service with embedding profile
- `.env.example` - Embedding configuration documentation

## Decisions Made
- Used `customType` from drizzle-orm instead of built-in `vector()` because the built-in requires a fixed dimensions parameter, but we need unconstrained vector to support both 768 (Ollama/dev) and 1024 (Voyage/prod) without schema changes
- Used `text` placeholder in schema.drizzle.ts because drizzle-kit's CJS bundler cannot resolve the customType definition -- the actual vector type is defined in the hand-written migration
- Put Ollama behind a Docker Compose profile ("embedding") so `docker compose up` remains unchanged for developers not working on knowledge features

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Existing volumes are compatible with pgvector image.

## Next Phase Readiness
- Schema and infrastructure ready for Plan 68-02 (EmbeddingService provider-agnostic interface)
- All env vars have sensible defaults, so existing tests and workflows are unaffected
- Migration must be run (`pnpm db:migrate`) before knowledge features can be used

## Self-Check: PASSED

- All 7 created/modified files verified on disk
- Both task commits (2ccf817, 358e627) verified in git log

---
*Phase: 68-shared-memory*
*Completed: 2026-02-10*
