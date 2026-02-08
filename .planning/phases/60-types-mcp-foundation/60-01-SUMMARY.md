---
phase: 60-types-mcp-foundation
plan: 01
subsystem: agents
tags: [zod, discriminated-union, jsonb, drizzle, communication, reply-context]

# Dependency graph
requires: []
provides:
  - "ReplyContext Zod discriminated union (slack, linear, github) for channel-aware reply routing"
  - "MessageContent schema with text and optional interactive options"
  - "CommunicationToolDeps interface for communication tool dependency injection"
  - "reply_context JSONB column on conversations table for fallback address storage"
affects: [61-adapter-denormalization, 62-router-enhancement, 63-denormalizer, 64-communication-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [zod-discriminated-union-for-channel-routing, communication-module-barrel-export]

key-files:
  created:
    - packages/agents/src/shared/communication/types.ts
    - packages/agents/src/shared/communication/index.ts
    - packages/agents/src/shared/db/migrations/0006_add_reply_context.sql
  modified:
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/src/shared/db/migrations/meta/_journal.json

key-decisions:
  - "Used Record<string, unknown> | null for reply_context $type in schema.ts to avoid circular deps with communication module"
  - "Exported individual variant schemas (SlackReplyContextSchema, etc.) for per-channel validation without full union import"

patterns-established:
  - "Communication types module: Zod-first definitions in shared/communication/ with barrel export"
  - "Channel discriminator pattern: z.discriminatedUnion on channel field for TypeScript narrowing"

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 60 Plan 01: Communication Types Summary

**Zod discriminated union ReplyContext with slack/linear/github variants, MessageContent schema, and reply_context JSONB column on conversations table**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T17:35:00Z
- **Completed:** 2026-02-08T17:37:43Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- ReplyContext Zod discriminated union on `channel` field with three variants (slack, linear, github) providing runtime validation and TypeScript narrowing
- MessageContent schema with text and optional interactive options array for ask-style messages
- CommunicationToolDeps interface following McpToolDeps pattern for communication tool dependency injection
- Nullable reply_context JSONB column added to conversations table with migration

## Task Commits

Each task was committed atomically:

1. **Task 1: Create communication types module** - `356fe97` (feat) -- Note: files committed by parallel 60-02 agent
2. **Task 2: Add reply_context column to conversations table** - `0dc01c7` (feat)

## Files Created/Modified
- `packages/agents/src/shared/communication/types.ts` - ReplyContext, MessageContent, CommunicationToolDeps Zod schemas and types
- `packages/agents/src/shared/communication/index.ts` - Barrel export for communication module
- `packages/agents/src/shared/db/schema.ts` - Added reply_context JSONB column to conversations table
- `packages/agents/src/shared/db/schema.drizzle.ts` - Added matching reply_context column for drizzle-kit
- `packages/agents/src/shared/db/migrations/0006_add_reply_context.sql` - ALTER TABLE migration
- `packages/agents/src/shared/db/migrations/meta/_journal.json` - Added idx=5 journal entry

## Decisions Made
- Used `Record<string, unknown> | null` for reply_context `$type` in schema.ts to avoid circular dependency with the communication module -- runtime Zod validation happens at application layer
- Exported individual variant schemas (SlackReplyContextSchema, LinearReplyContextSchema, GitHubReplyContextSchema) alongside the union so downstream code can import per-channel validation

## Deviations from Plan

### Parallel Execution Overlap

**1. [Parallel Agent] Task 1 files committed by 60-02 agent**
- **Found during:** Task 1 commit
- **Issue:** Parallel 60-02 agent's commit (356fe97) picked up Task 1's staged files (communication/types.ts, communication/index.ts) alongside its own Linear MCP changes
- **Impact:** None -- file content is exactly as specified. Task 1 work is complete and committed, just under a different commit message
- **Resolution:** Verified file content matches plan specification exactly; proceeded to Task 2

**2. [Rule 1 - Bug] Fixed Biome formatting for long $type annotation**
- **Found during:** Task 2 commit (pre-commit hook)
- **Issue:** `$type<Record<string, unknown> | null>()` exceeded Biome's line length, formatter required multi-line format
- **Fix:** Split the type annotation across multiple lines per Biome's output
- **Files modified:** packages/agents/src/shared/db/schema.ts
- **Committed in:** 0dc01c7 (part of Task 2 commit)

---

**Total deviations:** 1 parallel overlap (cosmetic), 1 auto-fixed (formatting)
**Impact on plan:** No scope creep. All artifacts match specification.

## Issues Encountered
None beyond the parallel commit overlap documented above.

## User Setup Required
None - no external service configuration required. Run `pnpm db:migrate` when ready to apply the reply_context column to the database.

## Next Phase Readiness
- Communication types module ready for import by adapter denormalization (Phase 61), router enhancement (Phase 62), denormalizer (Phase 63), and communication tools (Phase 64)
- reply_context column ready for use once migration is applied
- All downstream phases can import from `packages/agents/src/shared/communication/index.ts`

## Self-Check: PASSED

All 6 files verified present. Both commit hashes (356fe97, 0dc01c7) verified in git log.

---
*Phase: 60-types-mcp-foundation*
*Completed: 2026-02-08*
