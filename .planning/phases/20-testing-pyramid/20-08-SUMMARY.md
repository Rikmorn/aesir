---
phase: 20-testing-pyramid
plan: 08
subsystem: testing
tags: [test-utils, factories, test-data, gap-closure]
requires:
  - 20-02-SUMMARY.md
provides:
  - Agent state factories for test data
  - Dev workflow state factories for test data
  - Complete factory coverage for all domain objects
affects:
  - Future test files needing agent state test data
tech-stack:
  added: []
  patterns:
    - Factory pattern with counter-based deterministic IDs
    - Test message type to avoid LangChain dependency
decisions:
  - title: "Use simple message type instead of BaseMessage"
    rationale: "Avoids adding @langchain/core as dependency to test-utils package"
    alternatives: ["Import BaseMessage from @langchain/core"]
    tradeoffs: "Simple message type is less feature-rich but maintains clean dependencies"
key-files:
  created:
    - packages/test-utils/src/factories/agents.ts
  modified:
    - packages/test-utils/src/factories/index.ts
    - packages/test-utils/src/index.test.ts
metrics:
  duration: 3 minutes
  completed: 2026-01-23
---

# Phase 20 Plan 08: Agent Factories Summary

Add missing agent factory functions to the test-utils package.

**One-liner:** Agent state factories with counter-based deterministic IDs and zero LangChain dependencies

## What Was Built

Added factory functions for creating test agent and dev workflow state objects:

**Agent Factories:**
- `createTestAgent()` - Creates test agent state with deterministic task descriptions
- `createTestDevWorkflowState()` - Creates dev workflow state with deterministic task IDs
- `resetAgentCounter()`, `resetWorkflowCounter()` - Reset functions for test isolation
- `resetAllCounters()` - Updated to include agent counters

**Design Decisions:**
- Used `TestMessage` type instead of importing `BaseMessage` from `@langchain/core` to avoid adding LangChain as a dependency
- Followed established patterns: counter-based IDs, optional overrides, reset functions
- Used `TestTestResult` type instead of importing from platform to avoid circular dependencies

## Verification Results

All verification criteria met:

**Typecheck:**
```bash
pnpm --filter @aesir/test-utils typecheck
# Passed: No type errors
```

**Tests:**
```bash
pnpm --filter @aesir/test-utils test
# 17 tests passed (6 new agent factory tests)
```

**Exports:**
- `createTestAgent` importable from `@aesir/test-utils` ✓
- `createTestDevWorkflowState` importable from `@aesir/test-utils` ✓
- `resetAllCounters()` resets all counters including agent counters ✓

## Test Coverage

Added 6 new test cases:
1. createTestAgent creates agent with defaults
2. createTestAgent accepts overrides
3. createTestAgent increments counter
4. createTestDevWorkflowState creates workflow with defaults
5. createTestDevWorkflowState accepts overrides
6. resetAllCounters resets agent counters

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Use `TestMessage` type instead of `BaseMessage` | Avoids LangChain dependency in test-utils | Test-utils remains lightweight, tests use simplified message structure |
| Use `TestTestResult` type instead of importing from platform | Avoids circular dependency issues | Duplicates small interface but maintains clean package boundaries |

## Known Issues / Tech Debt

None identified.

## Next Phase Readiness

**Status:** Phase 20 gap closure complete

This plan closes the gap identified in verification:
- ✅ Factories exist for all major domain objects (agents, issues, PRs)
- ✅ Factories follow established patterns
- ✅ All exports available from package root
- ✅ Tests verify factory behavior

**Phase 20 Success Criteria Met:**
- `@aesir/test-utils` package with factories for all domain objects ✓
- Mock implementations for all external services ✓
- Database test utilities ✓
- MSW handlers for HTTP testing ✓

## Files Modified

### Created
- `packages/test-utils/src/factories/agents.ts` - Agent and dev workflow state factories (126 lines)

### Modified
- `packages/test-utils/src/factories/index.ts` - Added agent factory exports (+16 lines)
- `packages/test-utils/src/index.test.ts` - Added agent factory tests (+61 lines)

## Commit History

1. `54672ac` - feat(20-08): add agent and dev workflow state factories
   - createTestAgent factory with deterministic IDs
   - createTestDevWorkflowState factory with counter-based IDs
   - Reset functions for test isolation
   - Simple message type to avoid LangChain dependency

2. `acdafb5` - feat(20-08): export agent factories from test-utils
   - Add agent factory exports to factories/index.ts
   - Update resetAllCounters to include agent counters
   - All exports available from @aesir/test-utils root

3. `b0d40c2` - test(20-08): add tests for agent factories
   - Test createTestAgent defaults and overrides
   - Test counter increments
   - Test createTestDevWorkflowState defaults and overrides
   - Verify resetAllCounters resets agent counters

## Lessons Learned

**What Worked Well:**
- Factory pattern scales well - adding new factories follows clear established pattern
- Counter-based IDs provide deterministic test data without external dependencies
- Avoiding LangChain dependency keeps test-utils lightweight

**What Could Be Improved:**
- Consider codegen to auto-generate factories from type definitions
- Could add factory utilities for common scenarios (agent with messages, workflow with files)

**Reusable Patterns:**
- Factory pattern with counter-based IDs for deterministic test data
- Simple wrapper types to avoid heavy dependencies in test utilities
- Barrel exports with reset utility for all counters
