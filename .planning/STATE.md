# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** Phase 54 - System Overview (in progress)

## Current Position

Phase: 54 of 55 (System Overview)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-02-04 -- Completed 54-01-PLAN.md

Progress: [#################] 94% (17/18 plans across 9 phases)

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
- Total plans completed: 17
- Average duration: ~4.5 minutes
- Total execution time: ~76 minutes

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

51-03 decisions:
- MetadataSidebar as server component (no "use client") -- pure rendering, sidebar toggle at layout level
- Sidebar toggle at layout level via CSS grid column switching (grid-cols-[1fr,1fr,300px] vs grid-cols-[1fr,1fr])
- Local Anthropic message types to keep dashboard decoupled from @anthropic-ai/sdk
- System prompt detection via content length heuristic (>500 chars first user message)

52-01 decisions:
- Local AgentSummary/AgentDetail interfaces mirror agent-service API types (no @aesir/agents import)
- AbortSignal.timeout(5000) for agent-service HTTP requests
- next revalidate 60s for fetch caching of agent definitions
- biome-ignore for console.error in server-side HTTP client (dashboard lacks pino logger)
- agent-service added to dashboard depends_on in Docker Compose

52-02 decisions:
- Orchestrator detection via non-empty triggers array (no separate agent type field needed)
- Sorting: orchestrators first, then sub-agents, alphabetical within each group
- Empty state doubles as error state (getAgentList returns [] on failure)

52-03 decisions:
- AgentPromptViewer is only client component (needs Collapsible state); all others are server components
- Tools grouped by namespace prefix with links to /tools?tool= (will 404 until Phase 53)
- Sub-agent roles link to /agents/[agent-id] for cross-navigation
- System prompt collapsed by default with character count indicator

53-01 decisions:
- Recharts v2 (not v3) for shadcn chart component compatibility
- biome-ignore directives for shadcn-generated code patterns (dangerouslySetInnerHTML, mapped type key)
- card.tsx updated to latest shadcn version as side effect of chart install
- getToolCallMetrics as private helper to avoid duplicate SQL in getToolRegistry vs getToolMetrics

53-02 decisions:
- Agent IDs for permission matrix columns derived from agents prop (not cells) to ensure consistent ordering
- Inline SVG icons for check/warning in permission matrix (avoids additional icon library dependency)
- GitHub capitalized as special case in integration health (not just first-letter capitalization)
- Tool cards in registry use grid layout (not table) for responsive display

53-03 decisions:
- getRecentToolFailures uses toolNames array param (not namespace string) for server-side filtering
- Failure rate derived client-side from timeSeries (failures/calls*100) rather than separate query
- Top 15 tools by call count for latency bar chart to keep chart readable
- ALL_VALUE sentinel (__all__) for Select component since Radix Select requires non-empty values

54-01 decisions:
- Agent-service API returns camelCase -- no snake_case mapping needed in fetchWorkerStatus
- Error message truncation at 120 characters with ellipsis character
- Two parallel queries for status counts (current state vs 24h terminal) instead of single query with conditional aggregation

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-04
Stopped at: Completed 54-01-PLAN.md
Resume file: None
Next action: Execute 54-02-PLAN.md (System Overview UI)

---
*Updated: 2026-02-04 -- Completed 54-01 System Overview Data Layer (1/2 plans in Phase 54)*
