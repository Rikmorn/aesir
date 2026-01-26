---
phase: 26-dev-agent-workflow
plan: 06
subsystem: agents
tags: [dev-agent, langgraph, nodes, execution, verification]

dependency-graph:
  requires:
    - 26-02 (state schema with testAttempts, ExecutionPlan)
    - 26-03 (DevContainerManager, DEV_CONTAINER_TIMEOUTS)
  provides:
    - createExecuteNode for plan execution
    - createVerifyNode for pre-push quality checks
  affects:
    - 26-07 (PR creation after successful verification)
    - 26-08 (graph assembly uses these nodes)

tech-stack:
  patterns:
    - Node factory pattern with DI (createExecuteNode(deps))
    - LLM structured output for file generation
    - Unique heredoc delimiter (AESIR_EOF_{timestamp}) for injection prevention
    - Unfixable pattern detection for immediate escalation

key-files:
  created:
    - packages/agents/src/dev-agent/nodes/execute.ts
    - packages/agents/src/dev-agent/nodes/verify.ts
  modified:
    - packages/agents/src/dev-agent/nodes/index.ts

decisions:
  - decision: "Use for-of with entries() for array iteration"
    rationale: "TypeScript's noUncheckedIndexedAccess requires safe array access"
  - decision: "Verification failures always escalate"
    rationale: "Full test/lint failures at verification stage need human help"
  - decision: "Extended timeout for full test suite (3x)"
    rationale: "Full suite takes longer than affected tests"

metrics:
  duration: 4 min
  completed: 2026-01-26
---

# Phase 26 Plan 06: Execute and Verify Nodes Summary

Execute node writes files via heredoc with unique AESIR_EOF_{timestamp} delimiter, runs affected tests per step with 3-fix-attempt limit, and commits atomically. Verify node runs full pnpm test/lint suite and pushes with -u origin.

## What Changed

### Execute Node (`packages/agents/src/dev-agent/nodes/execute.ts`)

Creates the execution phase node that implements the approved plan step by step:

1. **File Writing**: Uses cat heredoc with unique `AESIR_EOF_{timestamp}` delimiter to prevent injection attacks
2. **LLM File Generation**: Uses `buildFileWritePrompt` and `FILE_WRITE_SYSTEM_PROMPT` with structured output
3. **Affected Tests**: Runs only tests corresponding to modified files (not full suite)
4. **Fix Retry Loop**: Up to 3 attempts with unfixable pattern detection
5. **Atomic Commits**: Each step committed separately with `feat:` prefix

Key unfixable patterns that trigger immediate escalation:
- ECONNREFUSED, ENOENT, Permission denied, Cannot find module
- Docker, OOM, ENOMEM

### Verify Node (`packages/agents/src/dev-agent/nodes/verify.ts`)

Creates the pre-push verification gate:

1. **Full Test Suite**: Runs `pnpm test` with 3x timeout (540s)
2. **Lint Check**: Runs `pnpm lint` with build timeout (120s)
3. **Push to Remote**: Runs `git push -u origin {branchName}`

Any failure escalates to human (verification failures need intervention).

### Barrel Export Update

Added exports for both nodes with their dependency types.

## Commits

| Hash | Description |
|------|-------------|
| 6c59038 | feat(26-06): create execute node for plan execution |
| 969b082 | feat(26-06): create verify node for pre-push quality checks |
| c984833 | feat(26-06): update nodes barrel export with execute and verify |

## Deviations from Plan

None - plan executed exactly as written.

## Key Patterns Established

1. **Heredoc Security**: Using `AESIR_EOF_{timestamp}` prevents content injection
2. **Escalation over Retry**: Unfixable patterns escalate immediately rather than retrying
3. **Phased Testing**: Affected tests per step, full suite only in verify phase
4. **Verification Gate**: All verification failures require human intervention

## Verification

- [x] `pnpm --filter @aesir/agents build` succeeds
- [x] Execute node writes files via heredoc with unique delimiter
- [x] Execute node runs affected tests and handles failures with retry
- [x] Verify node runs pnpm test, pnpm lint, and git push
- [x] Both nodes escalate on failures (not infinite retry)

## Next Phase Readiness

Ready for:
- **26-07**: PR creation node (receives "creating_pr" phase from verify)
- **26-08**: Graph assembly (all nodes available for wiring)
