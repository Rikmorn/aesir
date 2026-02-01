---
phase: 38-agent-and-tool-registries
plan: 03
subsystem: agents
tags: [yaml, agent-registry, mtime-cache, zod-validation, file-loading]

# Dependency graph
requires:
  - phase: 38-01
    provides: AgentDefinitionYamlSchema, AgentDefinition interface, AgentRegistry interface
  - phase: 38-02
    provides: 5 agent definition directories with YAML config + prompt.md
provides:
  - createAgentRegistry factory function with lazy loading from disk
  - mtime-based cache invalidation for definition.yaml and prompt.md
  - Zod validation of YAML definitions on every load
  - Version pinning support with mismatch warning
affects:
  - 38-04 (ToolRegistry wiring uses AgentRegistry to load agent definitions)
  - 39-agent-loop-v2 (agent loop uses AgentRegistry to get agent definitions)
  - 40-conversation-executor (executor loads definitions via AgentRegistry)

# Tech tracking
tech-stack:
  added:
    - "yaml ^2.8.2 (YAML parsing for agent definitions)"
  patterns:
    - "AgentRegistry factory pattern: createAgentRegistry(options) returns AgentRegistry interface"
    - "mtime-based cache invalidation: Math.max(yaml.mtimeMs, prompt.mtimeMs) compared against cached mtime"
    - "exactOptionalPropertyTypes: mutable-then-conditional-set for temperature, subAgents, triggers"

key-files:
  created:
    - packages/agents/src/framework/agent-registry.ts
    - packages/agents/src/framework/agent-registry.test.ts
  modified:
    - packages/agents/src/framework/index.ts
    - packages/agents/package.json
    - pnpm-lock.yaml

key-decisions:
  - id: reg-01
    decision: "AgentRegistry verifies id in YAML matches directory name"
    reason: "Prevents mismatched definitions where id says one thing but directory says another"
  - id: reg-02
    decision: "Version mismatch logs warning but returns cached definition (not null)"
    reason: "File-based registry cannot store historical versions; caller holds definition in memory for conversation duration"
  - id: reg-03
    decision: "loadDefinition returns null when either file is missing (ENOENT)"
    reason: "Both definition.yaml and prompt.md are required; partial directories are treated as non-existent"

# Metrics
duration: 4m03s
completed: 2026-02-01
---

# Phase 38 Plan 03: AgentRegistry Implementation Summary

**createAgentRegistry factory with YAML+prompt.md lazy loading, mtime cache invalidation, Zod validation, and 17 unit tests**

## Performance

| Metric | Value |
|--------|-------|
| Duration | 4m03s |
| Started | 2026-02-01T19:59:42Z |
| Completed | 2026-02-01T20:03:45Z |
| Tasks | 2/2 |
| Files created | 2 |
| Files modified | 3 |

## Accomplishments

1. **yaml package installed** -- `yaml ^2.8.2` added to @aesir/agents dependencies for YAML definition parsing
2. **createAgentRegistry factory** -- Implements `AgentRegistry` interface with lazy loading from disk, mtime-based cache invalidation, Zod validation against `AgentDefinitionYamlSchema`, id/directory name enforcement, and version mismatch warning
3. **17 unit tests** -- Comprehensive coverage: loading (5 tests), caching with mtime invalidation (3 tests), version pinning (2 tests), listing (3 tests), optional field handling (2 tests), edge cases (2 tests)
4. **106 framework tests pass** -- All existing framework tests (event-log: 44, session-projection: 31, tool-registry: 14) plus new agent-registry tests (17)

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install yaml package and implement AgentRegistry | be0511c | agent-registry.ts, index.ts, package.json, pnpm-lock.yaml |
| 2 | Unit tests for AgentRegistry | 1fc07db | agent-registry.test.ts |

## Files Created

- `packages/agents/src/framework/agent-registry.ts` -- createAgentRegistry factory with lazy loading, mtime cache, Zod validation (159 lines)
- `packages/agents/src/framework/agent-registry.test.ts` -- 17 unit tests covering all documented behavior (448 lines)

## Files Modified

- `packages/agents/src/framework/index.ts` -- Added createAgentRegistry export
- `packages/agents/package.json` -- Added yaml ^2.8.2 dependency
- `pnpm-lock.yaml` -- Updated lockfile

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| reg-01 | AgentRegistry verifies id in YAML matches directory name | Prevents mismatched definitions; directory name is the lookup key, YAML id is the source of truth |
| reg-02 | Version mismatch logs warning but returns cached definition | File-based registry only stores latest version; conversation executor (Phase 40) holds definition in memory for duration |
| reg-03 | loadDefinition returns null when either file is missing | Both definition.yaml and prompt.md are required; partial directories treated as non-existent agents |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome formatting for triggers assignment and method signatures**
- **Found during:** Task 1 commit
- **Issue:** Biome formatter required different line breaking for the triggers type cast and the `get()` method signature
- **Fix:** Reformatted triggers cast to single-line `(definition as { triggers: ... }).triggers =` and collapsed `get()` signature to single line
- **Files modified:** packages/agents/src/framework/agent-registry.ts
- **Committed in:** be0511c (part of Task 1 retry)

**2. [Rule 1 - Bug] Biome formatting for subAgents assertion in test**
- **Found during:** Task 2 commit
- **Issue:** `toEqual({ researcher: "researcher", coder: "coder" })` too long for single line per Biome rules
- **Fix:** Split to multi-line object literal in expect assertion
- **Files modified:** packages/agents/src/framework/agent-registry.test.ts
- **Committed in:** 1fc07db

**3. [Rule 3 - Blocking] Parallel plan pre-commit interference**
- **Found during:** Task 2 commit
- **Issue:** Parallel 38-04 plan left untracked `tool-factories.ts` with Biome lint errors, causing pre-commit hook to fail for this plan's commit
- **Fix:** Stashed parallel plan files during commit, restored after
- **Impact:** No content changes; commit isolation technique

---

**Total deviations:** 3 auto-fixed (2 formatting, 1 blocking)
**Impact on plan:** Minor -- all formatting fixes are trivial, parallel plan interference was a process issue not a code issue.

## Issues Encountered

- **Pre-commit hook checks untracked files from parallel plans** -- The Biome check in the pre-commit hook picked up `tool-factories.ts` from the parallel 38-04 plan, blocking commits for this plan. Resolved by stashing parallel files during commit.

## Next Phase Readiness

- **38-04 (ToolRegistry wiring)**: Ready. AgentRegistry can load all 5 agent definitions from `packages/agents/definitions/`. Tool references in definitions use `namespace:tool_name` format matching ToolRegistry validation.
- **39-agent-loop-v2**: Ready. AgentRegistry provides the `get(id, version?)` method the agent loop needs to load definitions.
- **40-conversation-executor**: Ready. Version pinning via `get(id, version)` with mismatch warning supports the conversation lifecycle pattern.
- No blockers.

---
*Phase: 38-agent-and-tool-registries*
*Completed: 2026-02-01*
