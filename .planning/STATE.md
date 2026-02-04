# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** Phase 51 in progress - Conversation Detail

## Current Position

Phase: 51 of 55 (Conversation Detail)
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-02-04 -- Completed 51-02-PLAN.md

Progress: [#########] 56% (9/16 plans across 8 phases)

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
- Total plans completed: 9
- Average duration: ~4 minutes
- Total execution time: ~41 minutes

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

49-02 decisions:
- Approach B (local schema) chosen over importing from @aesir/agents to avoid heavy dependency tree
- Service layer pattern: services/*.ts abstract all DB queries behind typed async functions
- Local schema in lib/schema.ts mirrors agents schema without runtime @aesir/agents dependency
- camelCase interfaces mapped from snake_case DB columns inside service functions

49-03 decisions:
- Dashboard NOT in nginx depends_on (optional service, 502 when down is acceptable)
- proxy_pass http://dashboard/dashboard/ preserves basePath prefix for Next.js
- No workspace dependency builds in Dockerfile (dashboard uses drizzle-orm/pg directly)

50-01 decisions:
- Token aggregation via Drizzle subquery join (not LATERAL) -- simpler since aggregation groups by conversation_id
- Trigger event type via SQL subquery selecting first agent_events row by sequence ASC
- Separate COUNT query for pagination total (cleaner than window function for this table size)
- Dynamic filter builder returns SQL[] array, composed with and() -- extensible for future filters

50-02 decisions:
- StatusBadge is server component (no "use client") for reuse in both server and client contexts
- Popover + Command pattern for multi-select filters (consistent with shadcn/ui conventions)
- Select component for time range (single-value, not multi-select)
- Static key array for skeleton rows to satisfy Biome noArrayIndexKey rule

51-01 decisions:
- Destructuring for row access (`const [row] = rows`) to satisfy TypeScript strict noUncheckedIndexedAccess
- getChildConversations as separate function for metadata sidebar sub-agent links
- ConversationEvent.type as string (not AgentEventType enum) for service interface flexibility

51-02 decisions:
- EventIcon and JsonPayload as server components (no "use client") for composability in both server and client contexts
- Sub-agent nesting is single-depth (all parentInstanceId !== null get same indentation)
- JSON truncation at 10,000 chars server-side to prevent browser freezing on large payloads
- formatDurationMs as local helper in EventTimeline (not shared in format.ts)

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-04
Stopped at: Completed 51-02-PLAN.md
Resume file: None
Next action: Execute 51-03-PLAN.md (Message Panel + Page Assembly)

---
*Updated: 2026-02-04 -- Completed 51-02 Event Timeline Components (2/3 plans in Phase 51)*
