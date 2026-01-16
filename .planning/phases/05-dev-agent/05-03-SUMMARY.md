---
phase: 05-dev-agent
plan: "03"
subsystem: workflow-orchestration
tags: [langgraph, linear, github, sandbox, lifecycle, stategraph, dependency-injection]

# Dependency graph
requires:
  - phase: 05-01
    provides: DevWorkflowState, FileChange schema, generateCodeNode
  - phase: 05-02
    provides: runTestsNode, fixCodeNode, routeAfterTest
  - phase: 03-linear
    provides: LinearClient, readIssue, updateIssueStatus, emitThought, emitResponse, emitError
  - phase: 04-github
    provides: Octokit, createBranch, createCommit, createPullRequest
provides:
  - createPickupTaskNode for task retrieval and status update
  - createBranchNode for feature branch creation
  - createCommitPRNode for commit and PR workflow
  - runDevWorkflow for complete workflow execution with lifecycle management
  - DevWorkflowDependencies interface for dependency injection
affects: [phase-6-observability, webhook-handler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Factory pattern for all nodes with external dependencies"
    - "DevWorkflowDependencies interface for centralized injection"
    - "Finally block for guaranteed sandbox cleanup"

key-files:
  created:
    - src/agents/nodes/pickup-task.ts
    - src/agents/nodes/pickup-task.test.ts
    - src/agents/nodes/create-branch.ts
    - src/agents/nodes/create-branch.test.ts
    - src/agents/nodes/commit-pr.ts
    - src/agents/nodes/commit-pr.test.ts
    - src/agents/dev-workflow-runner.ts
    - src/agents/dev-workflow-runner.test.ts
  modified:
    - src/agents/nodes/index.ts
    - src/agents/dev-workflow.ts
    - src/agents/dev-workflow.test.ts
    - src/agents/index.ts

key-decisions:
  - "Branch naming pattern: dev-agent/{taskId} for unique identification"
  - "Delete operations filtered in commitPRNode (Git Data API limitation)"
  - "Sandbox cleanup in finally block ensures cleanup even on error"
  - "Linear status reset to Todo on workflow failure"

patterns-established:
  - "DevWorkflowDependencies interface bundles all external dependencies"
  - "runDevWorkflow is the single entry point for workflow execution"
  - "Error recovery: update Linear, emit error, cleanup, return result"

# Metrics
duration: 16min
completed: 2026-01-16
---

# Phase 5 Plan 03: Workflow Orchestration Summary

**Complete Dev Agent workflow from Linear task pickup to GitHub PR, with proper sandbox lifecycle management**

## Performance

- **Duration:** 16 min
- **Started:** 2026-01-16T18:27:12Z
- **Completed:** 2026-01-16T18:43:38Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- pickupTaskNode reads task from Linear and updates status to In Progress
- createBranchNode creates dev-agent/{taskId} feature branches
- commitPRNode commits files and opens PRs with Linear status update to Done
- Complete StateGraph workflow: pickup_task -> create_branch -> generate_code -> run_tests -> commit_pr/fail
- runDevWorkflow high-level runner with sandbox cleanup guarantee
- Error handling resets Linear status and emits error activity
- 50 new tests covering all nodes and runner (371 total tests pass)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Linear and GitHub integration nodes** - `653c9c1` (feat)
2. **Task 2: Create workflow runner with sandbox lifecycle** - `ca04da7` (feat)

## Files Created/Modified

- `src/agents/nodes/pickup-task.ts` - Task pickup from Linear
- `src/agents/nodes/pickup-task.test.ts` - 7 tests
- `src/agents/nodes/create-branch.ts` - Branch creation in GitHub
- `src/agents/nodes/create-branch.test.ts` - 6 tests
- `src/agents/nodes/commit-pr.ts` - Commit and PR creation
- `src/agents/nodes/commit-pr.test.ts` - 9 tests
- `src/agents/dev-workflow.ts` - Updated to full 6-node workflow
- `src/agents/dev-workflow.test.ts` - Updated for new interface
- `src/agents/dev-workflow-runner.ts` - High-level workflow runner
- `src/agents/dev-workflow-runner.test.ts` - 11 tests
- `src/agents/nodes/index.ts` - Added new node exports
- `src/agents/index.ts` - Added workflow and runner exports

## Decisions Made

1. **Branch naming: dev-agent/{taskId}** - Unique, identifiable branches per task with clear agent ownership
2. **Delete operations filtered** - Git Data API doesn't support deletion in tree creation; filtered for now
3. **Finally block for cleanup** - Guarantees sandbox cleanup even on workflow errors
4. **Linear status reset on failure** - Reset to Todo allows retry; emitError shows failure reason

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- TypeScript strict type checking required `as unknown as T` pattern for mock type assertions in tests
- Fixed by updating type assertions to use double-cast pattern

## User Setup Required

None - no external service configuration required beyond existing Linear/GitHub tokens.

## Phase 5 Completion Status

All 3 plans complete:
- [x] 05-01: State Schema & Code Generation
- [x] 05-02: Fix Code & Test Feedback
- [x] 05-03: Workflow Orchestration

**Phase 5 Success Criteria:**
1. [x] Dev Agent picks up assigned tasks from Linear - pickupTaskNode reads issue
2. [x] Dev Agent writes code implementing task requirements - generateCodeNode with structured output
3. [x] Dev Agent can modify multiple files in one task - FileChange[] with create/update operations
4. [x] Dev Agent runs tests and interprets pass/fail - runTestsNode with sandbox
5. [x] Dev Agent iterates on code when tests fail - fixCodeNode with test feedback loop

**Ready for UAT:** Phase 5 complete, ready for verify-work validation.

---
*Phase: 05-dev-agent*
*Completed: 2026-01-16*
