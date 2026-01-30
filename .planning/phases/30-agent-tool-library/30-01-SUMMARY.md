---
phase: 30-agent-tool-library
plan: 01
subsystem: agents
tags: [tool-factory, dev-container, zod, codebase-tools, ripgrep, base64]

# Dependency graph
requires:
  - phase: 28-agentic-loop-runtime
    provides: ToolDefinition and ToolResult interfaces
  - phase: 29-database-schema-context-management
    provides: DevContainerManager for container execution
provides:
  - 5 codebase tool factories (read_file, write_file, search_codebase, list_directory, run_command)
  - CodebaseToolDeps interface and MAX_OUTPUT_BYTES constant
  - Barrel export for codebase tool module
affects: [30-02, 30-03, 31-dev-agent-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tool factory with closure over dependencies (CodebaseToolDeps)"
    - "safeParse + isError:true pattern for tool input validation"
    - "Output truncation at MAX_OUTPUT_BYTES (100KB) to prevent context overflow"
    - "Base64 transport for file writes to avoid shell escaping"

key-files:
  created:
    - packages/agents/src/shared/tools/types.ts
    - packages/agents/src/shared/tools/codebase/read-file.ts
    - packages/agents/src/shared/tools/codebase/write-file.ts
    - packages/agents/src/shared/tools/codebase/search-codebase.ts
    - packages/agents/src/shared/tools/codebase/list-directory.ts
    - packages/agents/src/shared/tools/codebase/run-command.ts
    - packages/agents/src/shared/tools/codebase/index.ts
    - packages/agents/src/shared/tools/codebase/codebase-tools.test.ts
  modified: []

key-decisions:
  - "MAX_STDERR_BYTES (50KB) added alongside MAX_OUTPUT_BYTES (100KB) for separate stderr truncation in run_command"
  - "exactOptionalPropertyTypes: build ToolResult without isError field, conditionally add when true"
  - "Biome import ordering: type imports before value imports in combined import statements"

patterns-established:
  - "Tool factory pattern: function createXTool(deps: CodebaseToolDeps): ToolDefinition"
  - "Error handling: safeParse + try/catch returning isError:true, never throwing"
  - "Output truncation: check Buffer.byteLength then slice + append truncation notice"

# Metrics
duration: 4min
completed: 2026-01-30
---

# Phase 30 Plan 01: Codebase Tools Summary

**5 codebase tool factories wrapping DevContainerManager.execute() with Zod validation, error-as-data (isError:true), and 100KB output truncation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-30T10:52:19Z
- **Completed:** 2026-01-30T10:56:15Z
- **Tasks:** 2
- **Files created:** 8

## Accomplishments
- 5 codebase tool factories each accepting CodebaseToolDeps and returning ToolDefinition
- Every tool validates input with Zod safeParse and returns isError:true on validation failure
- Every tool catches execution errors and returns isError:true instead of throwing
- Output truncated at 100KB (MAX_OUTPUT_BYTES) and stderr at 50KB (MAX_STDERR_BYTES)
- 44 test cases covering happy path, validation, error handling, truncation, and tool-specific edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared types and 5 codebase tool factories** - `41c52e2` (feat)
2. **Task 2: Codebase tool tests** - `9847dc8` (test)

## Files Created/Modified
- `packages/agents/src/shared/tools/types.ts` - CodebaseToolDeps interface, MAX_OUTPUT_BYTES, MAX_STDERR_BYTES constants
- `packages/agents/src/shared/tools/codebase/read-file.ts` - read_file tool factory (cat with truncation)
- `packages/agents/src/shared/tools/codebase/write-file.ts` - write_file tool factory (base64 transport, mkdir -p)
- `packages/agents/src/shared/tools/codebase/search-codebase.ts` - search_codebase tool factory (ripgrep with glob/path)
- `packages/agents/src/shared/tools/codebase/list-directory.ts` - list_directory tool factory (ls -la, default root)
- `packages/agents/src/shared/tools/codebase/run-command.ts` - run_command tool factory (sh -c, labeled output, timeout)
- `packages/agents/src/shared/tools/codebase/index.ts` - Barrel export for all 5 factories
- `packages/agents/src/shared/tools/codebase/codebase-tools.test.ts` - 44 test cases

## Decisions Made
- Added MAX_STDERR_BYTES (50KB) constant alongside MAX_OUTPUT_BYTES (100KB) -- run_command truncates stdout and stderr separately since both can be large and serve different diagnostic purposes
- Used conditional property assignment for isError to respect exactOptionalPropertyTypes -- build ToolResult object without isError, then add `toolResult.isError = true` only when needed
- Biome enforces type imports before value imports in combined import statements -- follow `{ type CodebaseToolDeps, MAX_OUTPUT_BYTES }` ordering

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome pre-commit hook rejected initial commits due to import ordering (type imports must precede value imports) and formatting (line width). Fixed inline and re-committed successfully.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Codebase tools ready for use in agent toolkits (Plan 30-03)
- Factory-with-closure pattern established for MCP tool wrappers (Plan 30-02)
- ToolDefinition interface proven compatible with the factory pattern

---
*Phase: 30-agent-tool-library*
*Completed: 2026-01-30*
