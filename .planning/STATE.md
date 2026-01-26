# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-25)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

**Current focus:** Phase 26 - Dev Agent Workflow (IN PROGRESS)

## Current Position

Phase: 26 of 27 (Dev Agent Workflow)
Plan: 4 of 13 complete
Status: In progress
Last activity: 2026-01-26 - Completed 26-04-PLAN.md (research and planning nodes)

Progress: [██████░░░░] 96%

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |

## Performance Metrics

**Velocity (v2.0):**
- Total plans completed: 104
- Average duration: ~5.8 min
- Total execution time: ~601 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 10-foundation-setup | 4/4 | ~44 min | ~11 min |
| 11-monorepo-setup | 4/4 | ~41 min | ~10 min |
| 12-observability | 8/8 | 78 min | 10 min |
| 13-data-layer | 6/6 | 38 min | 6 min |
| 14-platform-services | 8/8 | 14 min | 2 min |
| 15-code-quality | 8/8 | 111 min | 14 min |
| 16-linear-extraction | 11/11 | 55 min | 5 min |
| 17-github-extraction | 11/11 | 36 min | 3 min |
| 18-slack-extraction | 12/12 | 35 min | 3 min |
| 19-mcp-layer | 8/8 | 47 min | 5.9 min |
| 20-testing-pyramid | 8/8 | 35 min | 4.4 min |
| 22-local-dev-environment | 5/5 | 12 min | 2.4 min |
| 22.1-common-library-refactor | 5/5 | 35 min | 7 min |
| 22.2-agent-mcp-migration | 6/6 | 23 min | 3.8 min |
| 23-event-infrastructure | 5/5 | ~25 min | ~5 min |
| 24-dev-container | 6/6 | 18 min | 3 min |
| 25-product-agent-workflow | 9/9 | ~72 min | ~8.0 min |
| 26-dev-agent-workflow | 4/13 | 9 min | 2.3 min |

## Accumulated Context

### Decisions

v2.0 decisions archived in milestones/v2.0-ROADMAP.md.

Key decisions that carry forward:
- 3-layer architecture (Platform -> Integrations -> Agents) is established pattern
- MCP for agent-integration communication (HTTP-based, not direct SDK imports)
- Pure library pattern for @aesir/common (no env validation at import time)
- Infrastructure phases must include consumer migration (E2E verification requirements)
- pnpm monorepo with TypeScript project references
- Docker Compose for local development
- Event type uses dotted notation (source.resource.action) for consistent parsing
- Event IDs use evt_ prefix matching existing ID patterns (cred_, exec_, ws_)
- Integration-embedded dispatcher pattern: each integration dispatches its own events
- Fire-and-forget HTTP dispatch: does not block webhook response
- GitHub event type includes review state (review_approved, review_changes_requested, etc.) for fine-grained routing
- Slack dispatcher routes app_mention (sync mode) and message (async mode) to product-agent
- Event callbacks optional for v2.1: dev-agent just logs and acknowledges, actual processing in Phase 26
- Dev container uses sleep infinity and Docker API exec for command execution
- Dev container image: node:20-slim with pnpm, git, rg, fd, jq, gh
- Platform schema subdirectory pattern: new tables in packages/platform/src/db/schema/*.ts
- Dev container IDs use dcont_ prefix (createId.devContainer())
- DevContainerManager: spawn() reuses running containers, execute() updates last_activity
- Container naming: dev-container-{taskId} enables lookup by task
- Timeout presets: research 30s, install 5min, test 3min, build 2min, git 1min
- Git credential helper store at /tmp/.git-credentials with oauth2 format
- Shallow clone (--depth 1) by default for faster repository setup
- Feature branch naming: feature/{issueId}
- Container cleanup: 24h inactivity timeout, 10s graceful shutdown, 1h cleanup interval
- Cleanup always deletes DB record even if container removal fails
- Docker socket detection: check ~/.docker/run/docker.sock (macOS) and /var/run/docker.sock (Linux)
- Classification uses flat Zod schema for LLM structured output reliability
- Low confidence on any classification type routes to clarifying phase
- LLM errors in classification fall back to gathering phase (conservative approach)
- IssueDraft includes slackThreadUrl for linking back to conversation
- Preview message uses Slack markdown with *bold* formatting for labels
- Error handling in confirm node falls back to gathering phase, not failure
- Graph classification at entry filters non-actionable messages before analysis
- Confirmation step always precedes task creation (no bypass path)
- Workflow uses 24h/72h timeout (24h to first reminder, 72h total)
- Max 20 conversation iterations to prevent infinite loops
- Declined is success: true (correctly identified non-actionable)
- Singleton checkpointer pattern avoids multiple DB connections
- Thread timestamp as thread_id for conversation continuity across iterations
- exactOptionalPropertyTypes: use `| undefined` for optional return properties
- Product-agent uses shared Dockerfile with command override (follows dev-agent pattern)
- Temporal worker creates its own NativeConnection (separate from client connection)
- Checkpointer initialized at worker startup before activity registration
- Slack thread URL uses app_redirect format for cross-workspace compatibility
- agent-ready label auto-added to all created issues for dev-agent routing
- Missing labels logged as warning, not blocking issue creation
- Notify node gracefully handles MCP errors without failing workflow
- Linear URL format: https://linear.app/issue/{identifier}
- Slack bold formatting uses asterisks (*text*) for native rendering
- DevAgentPhase includes 13 phases covering full workflow lifecycle
- ExecutionPlan includes confidence level (high/medium/low) for approval quality gate
- ResearchContext captures unknowns explicitly (honest about gaps)
- Prompts include environment issue detection patterns for escalation
- Research uses ripgrep (rg) for fast file search with type filtering
- Limit relevant files to 15 to keep LLM context manageable
- Node factory pattern: createXNode(deps) returns async function for DI
- LLM structured output via withStructuredOutput for type-safe artifacts

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
   - commit-pr.test.ts - missing GitHub config mock
   - create-branch.test.ts - missing GitHub config mock
   - github-pr-review.test.ts - missing GitHub config mock
   - linear/integration.test.ts - module resolution issue

2. **Run dev-agent container as non-root** (infrastructure)
   - File: `.planning/todos/pending/2026-01-19-dev-agent-container-root-user.md`

3. **Orphaned mcp/server.ts files** (cleanup)
   - Three files in integration packages (api/mcp.ts HTTP routes used instead)

### Blockers/Concerns

None blocking next milestone.

## Session Continuity

Last session: 2026-01-26
Stopped at: Completed 26-04-PLAN.md (research and planning nodes)
Resume file: None
Next action: Continue Phase 26 plan 26-05

---
*Updated: 2026-01-26 - Phase 26 plan 04 complete*
