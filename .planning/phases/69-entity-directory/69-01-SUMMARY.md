---
phase: 69-entity-directory
plan: 01
subsystem: database
tags: [pgvector, drizzle, hnsw, entity-directory, agent-discovery]

# Dependency graph
requires:
  - phase: 68-shared-memory
    provides: pgvector extension and vectorColumn customType pattern
provides:
  - entity_directory table in agents schema with pgvector embeddings
  - createId.directoryEntry() for future human directory entries
  - AgentDefinitionYamlSchema capabilities field for agent discovery
  - AgentRegistry propagates capabilities from YAML to AgentDefinition
affects: [69-02-entity-directory-service, 69-03-seed-script]

# Tech tracking
tech-stack:
  added: []
  patterns: [entity directory table with HNSW cosine index, YAML capabilities declaration]

key-files:
  created:
    - packages/agents/src/shared/db/migrations/0008_add_entity_directory.sql
  modified:
    - packages/types/src/utils/ids.ts
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/agent-registry.ts

key-decisions:
  - "Agent entries use definition ID as PK (e.g., dev-agent); directoryEntry ID generator is for future human entries only"
  - "capabilities_embedding uses unconstrained vector (same customType as knowledge_entries) for provider-agnostic dimensions"
  - "HNSW index with m=16, ef_construction=64 matches knowledge_entries pattern for consistent pgvector usage"

patterns-established:
  - "Entity directory schema pattern: text PK with CHECK constraints on type/status enums, JSONB capabilities array, pgvector embedding"
  - "YAML capabilities declaration: optional string array in definition.yaml, propagated via exactOptionalPropertyTypes pattern"

# Metrics
duration: 2min
completed: 2026-02-10
---

# Phase 69 Plan 01: Entity Directory Schema Summary

**Entity directory table with pgvector HNSW cosine index, Drizzle ORM definitions, ID generator, and YAML capabilities field for agent discovery**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-10T20:27:49Z
- **Completed:** 2026-02-10T20:29:59Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Entity directory table defined in both schema.ts (with vectorColumn) and schema.drizzle.ts (with text placeholder) with matching columns
- Migration 0008 creates table with CHECK constraints, composite indexes, and HNSW cosine similarity index for semantic capability matching
- AgentDefinitionYamlSchema extended with optional capabilities string array, propagated through AgentRegistry to AgentDefinition objects
- createId.directoryEntry() available for future human directory entries

## Task Commits

Each task was committed atomically:

1. **Task 1: Entity directory table schema and migration** - `811f9fb` (feat)
2. **Task 2: AgentDefinitionYaml capabilities field and registry loading** - `013e978` (feat)

## Files Created/Modified
- `packages/agents/src/shared/db/migrations/0008_add_entity_directory.sql` - Migration creating entity_directory table with HNSW index
- `packages/agents/src/shared/db/schema.ts` - entityDirectory Drizzle table with vectorColumn for embeddings
- `packages/agents/src/shared/db/schema.drizzle.ts` - entityDirectory drizzle-kit mirror with text placeholder
- `packages/types/src/utils/ids.ts` - directoryEntry ID generator added to createId
- `packages/agents/src/framework/types.ts` - capabilities field added to AgentDefinitionYamlSchema
- `packages/agents/src/framework/agent-registry.ts` - capabilities propagation in loadDefinition

## Decisions Made
- Agent entries use their definition ID directly as PK (e.g., "dev-agent") rather than generated IDs -- per prior user decision, directoryEntry ID generator is for future human entries
- Unconstrained vector column (no fixed dimensions) for capabilities_embedding -- matches knowledge_entries pattern, supports 768/1024 without schema changes
- HNSW index parameters (m=16, ef_construction=64) match knowledge_entries for consistent pgvector configuration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome formatter required capabilities JSONB chain to be on single line (auto-fixed before commit)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Entity directory table schema ready for Plan 02 (entity directory service with CRUD + semantic search)
- Capabilities field in YAML ready for Plan 03 (seed script to populate directory from agent definitions)
- Migration must be run (`pnpm db:migrate`) before directory service can operate

---
*Phase: 69-entity-directory*
*Completed: 2026-02-10*
