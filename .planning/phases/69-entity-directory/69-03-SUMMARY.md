---
phase: 69-entity-directory
plan: 03
subsystem: agents
tags: [entity-directory, seed-script, yaml-capabilities, pgvector, agent-discovery]

# Dependency graph
requires:
  - phase: 69-entity-directory-01
    provides: entity_directory table schema, capabilities field in AgentDefinitionYamlSchema
  - phase: 68-shared-memory
    provides: createEmbeddingService for generating capability embeddings
provides:
  - Idempotent seed script populating entity_directory from YAML definitions
  - dev-agent and product-agent YAML definitions with capabilities and directory tools
  - CLI command pnpm --filter @aesir/agents seed:directory
affects: [70-task-delegation, entity-directory-runtime]

# Tech tracking
tech-stack:
  added: []
  patterns: [idempotent seed script with ON CONFLICT upsert and stale entry deactivation]

key-files:
  created:
    - packages/agents/scripts/seed-directory.ts
  modified:
    - packages/agents/definitions/dev-agent/definition.yaml
    - packages/agents/definitions/product-agent/definition.yaml
    - packages/agents/package.json

key-decisions:
  - "Capabilities extracted to local variable after filter for lint-safe access (avoids non-null assertions)"
  - "Knowledge tools (store/query/update) added alongside directory tools to both orchestrators for Phase 70+ delegation workflows"
  - "Seed script uses sorted array JSON comparison for capability change detection (order-independent)"

patterns-established:
  - "Seed script pattern: loadEnvFromRoot, postgres client, AgentRegistry.list(), filter by capabilities, ON CONFLICT upsert, deactivate stale"
  - "Deploy workflow: pnpm db:migrate -> pnpm seed:permissions -> pnpm seed:directory"

# Metrics
duration: 6min
completed: 2026-02-10
---

# Phase 69 Plan 03: Seed Script and YAML Capabilities Summary

**Idempotent entity directory seed script with capability change detection, embedding generation, and stale agent deactivation; orchestrator YAMLs updated with capabilities and directory tools**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-10T20:32:23Z
- **Completed:** 2026-02-10T20:39:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- dev-agent definition updated with 5 capability strings (verbatim from CONTEXT.md) and directory:find, directory:get, knowledge:store/query/update tools
- product-agent definition updated with 3 capability strings (verbatim from CONTEXT.md) and same tool additions
- Seed script reads all YAML definitions via AgentRegistry, generates combined capability embeddings, and upserts into entity_directory with ON CONFLICT DO UPDATE
- Seed script skips embedding regeneration when capabilities haven't changed (sorted array comparison) and hard-fails on embedding errors
- Stale agent entries (type='agent' not in current YAML set) are deactivated rather than deleted

## Task Commits

Each task was committed atomically:

1. **Task 1: Agent definition YAML updates** - `923b885` (feat)
2. **Task 2: Seed script and package.json entry** - `1c8a673` (feat, co-committed with 69-02 parallel plan)

Note: Task 2 files were picked up by the parallel 69-02 agent commit due to shared working tree. Content is correct and complete.

## Files Created/Modified
- `packages/agents/scripts/seed-directory.ts` - Idempotent seed script with capability change detection
- `packages/agents/definitions/dev-agent/definition.yaml` - Added 5 capabilities + directory/knowledge tools
- `packages/agents/definitions/product-agent/definition.yaml` - Added 3 capabilities + directory/knowledge tools
- `packages/agents/package.json` - Added seed:directory script entry

## Decisions Made
- Added knowledge tools (knowledge:store/query/update) alongside directory tools to both orchestrators since Phase 70+ delegation workflows need both knowledge and directory capabilities
- Used sorted array JSON comparison for capability change detection to be order-independent
- Extracted capabilities to local variable after filter for Biome lint compliance (avoids non-null assertions)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Biome lint errors in seed script**
- **Found during:** Task 2 (Seed script creation)
- **Issue:** Non-null assertions (6 occurrences), unused `sql` import, and import ordering flagged by Biome pre-commit hook
- **Fix:** Extracted capabilities to local typed variable after filter, removed unused import, reordered imports per Biome convention
- **Files modified:** packages/agents/scripts/seed-directory.ts
- **Verification:** Pre-commit hook passed (biome check + typecheck)
- **Committed in:** 1c8a673 (final version)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Lint fix necessary for commit. No scope creep.

## Issues Encountered
- Parallel plan execution (69-02 running concurrently) caused commit overlap: 69-02's git staging picked up 69-03's seed-directory.ts and package.json changes. Both plans' changes are correctly committed but Task 2 artifacts are in 69-02's commit rather than a standalone 69-03 commit. This is a known parallel execution artifact.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Entity directory fully populated after running `pnpm --filter @aesir/agents seed:directory` (requires Ollama/Voyage running for embeddings)
- Deploy workflow: `pnpm db:migrate` -> `pnpm --filter @aesir/integration-* seed:permissions` -> `pnpm --filter @aesir/agents seed:directory`
- Phase 69 complete: schema (01), service (02), and seeding (03) all shipped
- Ready for Phase 70 (Task Delegation) which uses directory:find for agent discovery

## Self-Check: PASSED

All files verified present on disk. All commit hashes found in git log.

---
*Phase: 69-entity-directory*
*Completed: 2026-02-10*
