---
phase: 86-persistent-agent-identity
plan: 01
subsystem: database, agents
tags: [identity, versioning, drizzle, postgres, tools]

# Dependency graph
requires:
  - phase: 68-knowledge-entries
    provides: "KnowledgeService factory pattern and knowledge tools pattern"
provides:
  - "agents.identity_documents table with versioning and agent scoping"
  - "IdentityService factory (getCurrentDocuments, getDocumentHistory, updateDocument, getDocumentCount)"
  - "identity:update and identity:read tools in ToolRegistry (57 tools total)"
  - "identityDocument ID prefix in @aesir/types createId"
affects: [86-02, 86-03, agent-definitions, system-prompt-injection]

# Tech tracking
tech-stack:
  added: []
  patterns: ["versioned document storage with DISTINCT ON for latest version", "agent-scoped identity documents with document cap"]

key-files:
  created:
    - "packages/agents/src/shared/db/migrations/0020_add_identity_documents.sql"
    - "packages/agents/src/shared/services/identity-service.ts"
    - "packages/agents/src/shared/tools/identity/index.ts"
    - "packages/agents/src/shared/tools/identity/update.ts"
    - "packages/agents/src/shared/tools/identity/read.ts"
  modified:
    - "packages/agents/src/shared/db/schema.ts"
    - "packages/agents/src/shared/db/schema.drizzle.ts"
    - "packages/agents/src/framework/tool-factories.ts"
    - "packages/agents/src/framework/tool-factories.test.ts"
    - "packages/agents/src/service/main.ts"
    - "packages/types/src/utils/ids.ts"

key-decisions:
  - "identityDocument ID prefix 'idoc_' added to createId for collision-resistant IDs"
  - "DISTINCT ON (document_type) Postgres query for efficient latest-version-per-type retrieval"
  - "conversation_id FK with ON DELETE SET NULL preserves document history when conversations are deleted"
  - "Tool count increased from 55 to 57 (actual registry count was 55 pre-change based on runtime, test fixture had 51 due to stale count)"

patterns-established:
  - "Identity tools follow same factory pattern as knowledge tools: (service, ctx) -> ToolDefinition"
  - "Document versioning via append-only rows with MAX(version)+1 for next version"

requirements-completed: [IDN-01, IDN-02, IDN-04, IDN-05, IDN-06, IDN-07]

# Metrics
duration: 6min
completed: 2026-02-22
---

# Phase 86 Plan 01: Identity Storage Layer Summary

**Versioned identity document table, IdentityService factory with 12k char/5-doc caps, and identity:update + identity:read tools registered in ToolRegistry**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-22T22:32:42Z
- **Completed:** 2026-02-22T22:39:30Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- agents.identity_documents table with versioning, indexes, unique constraint, and conversation FK
- IdentityService factory with getCurrentDocuments (DISTINCT ON), getDocumentHistory, updateDocument (cap + limit validation), getDocumentCount
- identity:update tool with full replacement semantics and error feedback on limit violations
- identity:read tool with single-document and all-documents modes, formatted output
- Both tools registered in ToolRegistry and wired through main.ts bootstrap

## Task Commits

Each task was committed atomically:

1. **Task 1: Database schema and IdentityService** - `4ef4d644` (feat)
2. **Task 2: Identity tools and ToolRegistry registration** - `6d32ed17` (feat)

## Files Created/Modified
- `packages/agents/src/shared/db/migrations/0020_add_identity_documents.sql` - Migration with table, indexes, unique constraint
- `packages/agents/src/shared/db/schema.ts` - identityDocuments table definition + type exports
- `packages/agents/src/shared/db/schema.drizzle.ts` - Mirror table for drizzle-kit migration tracking
- `packages/agents/src/shared/services/identity-service.ts` - IdentityService factory with CRUD operations
- `packages/agents/src/shared/tools/identity/index.ts` - Barrel export for identity tools
- `packages/agents/src/shared/tools/identity/update.ts` - identity_update tool factory
- `packages/agents/src/shared/tools/identity/read.ts` - identity_read tool factory
- `packages/agents/src/framework/tool-factories.ts` - Identity tools registration (57 total)
- `packages/agents/src/framework/tool-factories.test.ts` - Updated with identity mock, namespace, and count assertions
- `packages/agents/src/service/main.ts` - IdentityService creation + wiring to registerAllTools
- `packages/types/src/utils/ids.ts` - identityDocument ID prefix ('idoc_')

## Decisions Made
- Added `identityDocument` ID prefix to `createId` (blocking: service needs it for row inserts)
- Used Postgres `DISTINCT ON (document_type)` for getCurrentDocuments -- efficient single-query approach for latest versions
- conversation_id FK uses `ON DELETE SET NULL` as specified in user decision (preserves document history)
- Tool count comment updated from 55 to 57 (and test expectations corrected from stale 51 to actual 57)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added identityDocument prefix to createId**
- **Found during:** Task 1 (IdentityService creation)
- **Issue:** Service calls createId.identityDocument() but no such method existed in @aesir/types
- **Fix:** Added `identityDocument: () => 'idoc_${nanoid()}'` to createId and rebuilt types package
- **Files modified:** packages/types/src/utils/ids.ts
- **Verification:** pnpm run typecheck passes for all packages
- **Committed in:** 4ef4d644 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed test count mismatch in tool-factories.test.ts**
- **Found during:** Task 2 (test verification)
- **Issue:** Test expected 51 tools but actual registry had 55 pre-change (stale count). With 2 new identity tools, actual is 57.
- **Fix:** Updated test expectations from 51 to 57 for both count assertion and logging assertion
- **Files modified:** packages/agents/src/framework/tool-factories.test.ts
- **Verification:** All 23 tests pass
- **Committed in:** 6d32ed17 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- Biome formatter required import reordering in tool-factories.ts and main.ts (identity imports must be alphabetically before integration imports). Resolved with `pnpm run lint:fix`.
- Biome flagged non-null assertion in read.ts -- suppressed with biome-ignore comment since array length is checked.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Identity storage layer complete -- ready for Plan 02 (system prompt injection) to read documents at conversation start
- Migration 0020 needs to be run with `pnpm db:migrate` before testing with live database
- All tools registered and compilable; agents can be configured with `identity:update` and `identity:read` in their YAML definitions

---
*Phase: 86-persistent-agent-identity*
*Completed: 2026-02-22*
