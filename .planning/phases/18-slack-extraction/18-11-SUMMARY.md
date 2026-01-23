---
phase: 18-slack-extraction
plan: 11
subsystem: integrations
tags: [slack, re-exports, backward-compatibility, legacy]

dependencies:
  requires:
    - 18-09 # Docker and README
    - 18-10 # Testing
  provides:
    - backward-compatible-imports # Existing consumers continue working
    - legacy-code-preserved # Old code in _legacy for reference
  affects:
    - agents # Updated to use new MessageResult type

tech-stack:
  added: []
  patterns:
    - re-export-pattern # Barrel re-exports from extracted package

key-files:
  created:
    - packages/integrations/src/_legacy/slack/ # Preserved original code
    - .biomeignore # Exclude _legacy from linting
  modified:
    - packages/integrations/src/slack/index.ts # Re-exports
    - packages/integrations/src/index.ts # Main barrel
    - packages/integrations/package.json # Dependency
    - packages/integrations/tsconfig.json # Project references
    - packages/agents/src/temporal/activities/slack-activities.ts # API update
    - packages/agents/src/temporal/activities/slack-activities.test.ts # Test update
    - packages/agents/src/scripts/start-product-agent.ts # Socket Mode update
    - biome.json # Import organizer exclusions

decisions:
  - id: slack-reexport-pattern
    choice: "Re-export with type aliases for backward compatibility"
    rationale: "Allows gradual migration without breaking existing code"
  - id: socket-mode-direct-app
    choice: "Use App constructor directly for Socket Mode scripts"
    rationale: "New createBoltApp requires deps (credential store, event store) meant for production HTTP mode"
  - id: messageresult-breaking-change
    choice: "Update agents to use MessageResult instead of NotificationResult"
    rationale: "API change from {success, timestamp?} to {ts, channel} reflects Slack API semantics"

metrics:
  duration: 9 min
  completed: 2026-01-23
---

# Phase 18 Plan 11: Consumer Updates and Backward Compatibility

Re-exports from @aesir/integration-slack with backward compatibility aliases. Existing consumers continue working.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Move old code to _legacy and create re-exports | ee256b6, 924ddae | slack/index.ts, _legacy/slack/*, tsconfig.json, biome.json |
| 2 | Update main barrel and add dependency | 245a705 | package.json, src/index.ts, pnpm-lock.yaml |

## Key Changes

### Re-export Pattern
```typescript
// packages/integrations/src/slack/index.ts
export { createBoltApp, startBoltApp, stopBoltApp } from "@aesir/integration-slack";
export { createSlackClient, getSlackClient } from "@aesir/integration-slack";

// Type aliases for backward compatibility
export type { SlackClientConfig as SlackConfig } from "@aesir/integration-slack";
export type { BoltAppOptions as BoltAppConfig } from "@aesir/integration-slack";

// Function aliases
export { buildApprovalBlocks as formatApprovalMessage } from "@aesir/integration-slack";
```

### API Changes Requiring Consumer Updates
- `NotificationResult` -> `MessageResult` (interface changed from `{success, timestamp?}` to `{ts, channel}`)
- `createBoltApp` now requires dependencies for HTTP mode; Socket Mode scripts should use `App` constructor directly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Agents package build failures**
- **Found during:** Task 1 verification
- **Issue:** Agents package used removed `NotificationResult` type and old `createBoltApp` signature
- **Fix:**
  - Updated slack-activities.ts to use `MessageResult`
  - Updated slack-activities.test.ts with new mock return values
  - Updated start-product-agent.ts to use `App` constructor directly for Socket Mode
- **Files modified:** 3 files in packages/agents
- **Commit:** ee256b6

**2. [Rule 3 - Blocking] Biome linting _legacy files**
- **Found during:** Task 1 commit
- **Issue:** Pre-commit hook checked _legacy files despite overrides
- **Fix:** Added .biomeignore file to exclude _legacy from linting
- **Files created:** .biomeignore
- **Commit:** 924ddae

## Decisions Made

1. **Socket Mode scripts use App directly** - The new `createBoltApp` is designed for HTTP mode with database-backed credentials. For Socket Mode development scripts, using the Bolt `App` constructor directly is simpler and doesn't require setting up credential stores.

2. **MessageResult breaking change accepted** - The old `NotificationResult` with `{success, timestamp?, error?}` is replaced by `MessageResult` with `{ts, channel}`. This is a semantic improvement (Slack returns ts and channel) but requires consumer updates.

## Backward Compatibility

| Old Import | New Import | Status |
|------------|------------|--------|
| `SlackConfig` | `SlackClientConfig` | Aliased |
| `BoltAppConfig` | `BoltAppOptions` | Aliased |
| `formatApprovalMessage` | `buildApprovalBlocks` | Aliased |
| `formatStatusMessage` | `buildStatusBlocks` | Aliased |
| `NotificationResult` | `MessageResult` | Breaking change - different interface |

## Verification Results

- [x] Old Slack code preserved in `packages/integrations/src/_legacy/slack/`
- [x] `slack/index.ts` re-exports from `@aesir/integration-slack` (11 export statements)
- [x] `package.json` includes `@aesir/integration-slack: workspace:*`
- [x] `pnpm --filter @aesir/integrations build` succeeds
- [x] `pnpm --filter @aesir/integrations typecheck` succeeds
- [x] `pnpm --filter @aesir/agents build` succeeds

## Next Phase Readiness

Plan 18-11 completes Wave 8 (Consumer Updates). Ready for Plan 18-12 (Migration and Cleanup).

Remaining work:
- Remove or update `@slack/bolt` and `@slack/web-api` direct dependencies in @aesir/integrations (now provided by @aesir/integration-slack)
- Consider deprecation timeline for _legacy code
