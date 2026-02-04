# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** Phase 49 in progress - Dashboard Infrastructure

## Current Position

Phase: 49 of 55 (Dashboard Infrastructure)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-02-04 -- Completed 49-01-PLAN.md

Progress: [###-----] 19% (3/16 plans across 8 phases)

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |
| v2.3 Unified Agent Framework | 2026-02-04 | 12 | 32 |

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: ~6 minutes
- Total execution time: ~17 minutes

*Updated after each plan completion*

## Accumulated Context

### Decisions

v2.4 decisions:
- Separate Next.js dashboard service (not embedded in agent service)
- SSE for real-time (not WebSockets)
- Read-only Postgres access, no new tables
- Service layer abstraction as future API boundary
- Agent service /api/ prefix for management endpoints
- shadcn/ui for components (owned code, not dependency)

48-01 decisions:
- Inspection ToolContext (__inspection__) for tool metadata extraction (avoids ToolRegistry interface change)
- Worker status via ConversationExecutor.getWorkerStatus() delegation (keeps WorkerLoop private)
- Module-level cache for tool registry results (registrations immutable at runtime)
- AbortSignal.timeout(3000ms) for health checks (internal Docker network)

48-02 decisions:
- Global EventLog subscription for shared buffer, per-connection subscriptions for filtered delivery
- Array-based buffer with shift() eviction (sufficient at 1000 items)
- Connection limit of 50 with 429 TOO_MANY_CONNECTIONS response
- sseManager.closeAll() runs before server.close() in shutdown sequence

49-01 decisions:
- Dashboard tsconfig.json does NOT extend tsconfig.base.json (incompatible module/moduleResolution for Next.js)
- Biome override for TSX files allows PascalCase function names (React components)
- Biome override for API route files allows CONSTANT_CASE function names (GET, POST, etc.)
- basePath set to /dashboard for Nginx sub-path routing

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-04
Stopped at: Completed 49-01-PLAN.md
Resume file: None
Next action: Continue Phase 49 -- Plan 02 (Drizzle read-only database client and service layer)

---
*Updated: 2026-02-04 -- Completed 49-01 Dashboard Package Setup (1/3 plans in Phase 49)*
