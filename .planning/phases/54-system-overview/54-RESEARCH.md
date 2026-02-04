# Phase 54: System Overview - Research

**Researched:** 2026-02-04
**Domain:** Next.js dashboard page with server-side data aggregation, Recharts charting, shadcn/ui components
**Confidence:** HIGH

## Summary

This phase builds the dashboard landing page (`/`) that replaces the current placeholder with a system health overview. The implementation is entirely within established patterns -- there are no new libraries, no new database tables, and no novel technical challenges. Every component pattern (stat cards, tables inside cards, charts with ChartContainer, empty states, loading skeletons) has direct precedent in existing pages (tools, conversations, agents).

The core work is: (1) adding new service functions to aggregate data from existing tables, (2) adding a `fetchWorkerStatus` HTTP client function to `lib/agent-service.ts`, and (3) building 5-6 presentational components composed into a server component page. The token usage chart is the only interactive client component (Recharts BarChart); everything else is static server-rendered content.

**Primary recommendation:** Follow the exact patterns from tools/page.tsx and conversations/page.tsx -- server component page that loads all data via Promise.all, passes to presentational components. No new libraries needed.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.5.9 | App Router, server components, page.tsx | Already in use, locked decision |
| Recharts | 2.15.4 | BarChart for token usage | Already used in tool-performance.tsx |
| shadcn/ui chart | local | ChartContainer, ChartTooltip, ChartLegend wrappers | Already in components/ui/chart.tsx |
| drizzle-orm | 0.45.1 | SQL query builder for Postgres aggregations | Already in use across all services |
| Tailwind CSS | 4.x | Styling (utility classes) | Already in use everywhere |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.400.0 | Icons (if stat cards use icons) | Optional per Claude's discretion |
| nuqs | 2.8.8 | URL search param state | NOT needed - page has no interactive filters |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts BarChart (horizontal) | Recharts BarChart (vertical) | Horizontal better for agent name labels, but vertical is the established pattern in tool-performance.tsx. Stick with vertical BarChart for consistency. |

**Installation:**
```bash
# No new packages needed -- everything is already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  app/
    page.tsx              # Replace existing placeholder with overview page
    loading.tsx           # NEW: loading skeleton for the landing page
  services/
    overview.ts           # NEW: service functions for overview data aggregation
  components/
    overview/
      stat-cards.tsx      # Status count cards (server component)
      active-conversations.tsx  # Active conversations table (server component)
      worker-status.tsx   # Worker status card (server component)
      recent-errors.tsx   # Recent errors list (server component)
      token-usage.tsx     # Token usage chart ("use client" - Recharts)
  lib/
    agent-service.ts      # ADD: fetchWorkerStatus function
```

### Pattern 1: Server Component Page with Parallel Data Loading
**What:** The page.tsx is an async server component that loads all data in parallel via Promise.all, then passes typed data as props to presentational components.
**When to use:** Every dashboard page follows this pattern.
**Example:**
```typescript
// Source: packages/dashboard/src/app/tools/page.tsx (existing pattern)
export default async function OverviewPage() {
  const [statusCounts, activeConversations, workerStatus, recentErrors, tokenUsage] =
    await Promise.all([
      getConversationStatusCounts(),
      getActiveConversations(),
      fetchWorkerStatus(),
      getRecentErrors(),
      getTokenUsageByAgent(),
    ]);

  return (
    <main className="container mx-auto px-4 py-8">
      {/* header */}
      <StatCards counts={statusCounts} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ActiveConversations conversations={activeConversations} />
        <WorkerStatus status={workerStatus} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RecentErrors errors={recentErrors} />
        <TokenUsage data={tokenUsage} />
      </div>
    </main>
  );
}
```

### Pattern 2: Agent-Service HTTP Client Function
**What:** Add `fetchWorkerStatus()` to `lib/agent-service.ts` following the exact pattern of `fetchToolsHealth()` -- timeout, error handling, graceful fallback.
**When to use:** For worker status data from GET /api/worker/status.
**Example:**
```typescript
// Source: pattern from lib/agent-service.ts fetchToolsHealth
export interface WorkerStatus {
  activeClaims: number;
  maxConcurrent: number;
  pollIntervalMs: number;
  lastPollAt: string | null;
  uptimeMs: number;
}

export async function fetchWorkerStatus(): Promise<WorkerStatus | null> {
  const url = `${getBaseUrl()}/api/worker/status`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
      next: { revalidate: 30 }, // Short revalidation like health endpoint
    });
    if (!response.ok) return null;
    return (await response.json()) as WorkerStatus;
  } catch {
    return null;
  }
}
```

### Pattern 3: Stat Card Grid
**What:** Responsive grid of stat cards with large count numbers, following the Card + CardContent pattern from integration-health.tsx.
**When to use:** Top of overview page for conversation counts by status.
**Example:**
```typescript
// Source: pattern from integration-health.tsx card grid
<div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
  {cards.map((card) => (
    <Card key={card.label}>
      <CardContent className="pt-6">
        <div className={cn("text-3xl font-bold", card.colorClass)}>
          {card.count}
        </div>
        <p className="text-sm text-muted-foreground">{card.label}</p>
      </CardContent>
    </Card>
  ))}
</div>
```

### Pattern 4: Table Inside Card
**What:** Table component wrapped in Card with CardHeader title and CardContent body. Used in agent-recent-conversations.tsx.
**When to use:** Active conversations list and recent errors list.
**Example:**
```typescript
// Source: packages/dashboard/src/components/agents/agent-recent-conversations.tsx
<Card>
  <CardHeader>
    <CardTitle>Active Conversations</CardTitle>
  </CardHeader>
  <CardContent>
    <Table>
      <TableHeader>...</TableHeader>
      <TableBody>...</TableBody>
    </Table>
  </CardContent>
  <CardFooter>
    <Link href="/conversations?status=running,waiting">View all &rarr;</Link>
  </CardFooter>
</Card>
```

### Pattern 5: Empty State
**What:** Dashed border container with centered muted text when no data is available.
**When to use:** Every section that can be empty.
**Example:**
```typescript
// Source: tool-performance.tsx and recent-failures.tsx
<div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed">
  <p className="text-sm text-muted-foreground">No active conversations</p>
</div>
```

### Pattern 6: Status Dot
**What:** Small colored circle to indicate status, used in integration-health.tsx.
**When to use:** Worker status card.
**Example:**
```typescript
// Source: packages/dashboard/src/components/tools/integration-health.tsx
<span
  className={cn(
    "h-2.5 w-2.5 rounded-full",
    isHealthy ? "bg-emerald-500" : "bg-amber-500"
  )}
/>
```

### Anti-Patterns to Avoid
- **Client components for static data:** Do NOT mark stat cards, active conversations table, worker status, or recent errors as "use client". Only the token usage chart (Recharts) needs to be a client component.
- **Inline SQL in page.tsx:** All database queries go in services/overview.ts, never in the page component.
- **Fetching worker status via database:** Worker status comes from the agent-service HTTP API, not from the database. The worker loop state is in-memory.
- **Adding navigation/sidebar in this phase:** Layout changes (nav bar, sidebar) are separate concerns. This phase only replaces the page.tsx content.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relative time formatting | Custom `timeAgo()` | `formatRelativeTime()` from `@/lib/format` | Already handles null, edge cases |
| Duration formatting | Custom duration string | `formatDuration()` from `@/lib/format` | Already formats hours/minutes/seconds |
| Token count formatting | Custom number formatter | `formatTokenCount()` from `@/lib/format` | Already handles k/M suffixes |
| Status badges | Custom colored spans | `StatusBadge` from `@/components/conversations/status-badge` | Already has all status colors |
| Chart wrapper | Raw Recharts components | `ChartContainer`/`ChartTooltip`/`ChartLegend` from `@/components/ui/chart` | Handles theming, CSS variables |
| Loading skeleton | Custom loading spinners | `Skeleton` from `@/components/ui/skeleton` + `loading.tsx` convention | Next.js streaming/suspense compatible |
| Event type labels | Custom mapping | `formatEventType()` from `@/lib/format` | Already handles all event types |
| Duration from ms | Custom ms->readable | `formatDurationMs()` from `@/lib/format` | Already in use for tool latency display |

**Key insight:** This phase has zero genuinely new UI patterns. Every visual element maps to an existing component or utility. The novelty is purely in the data aggregation queries.

## Common Pitfalls

### Pitfall 1: Wrong Token Aggregation Scope
**What goes wrong:** Aggregating tokens without filtering to `type = 'llm.response'` or without the 24h time window.
**Why it happens:** The `agent_events` table has multiple event types; only `llm.response` rows have token counts.
**How to avoid:** Follow the same `WHERE type = 'llm.response' AND timestamp >= now() - interval '24 hours'` pattern used in `listConversations` token subquery. GROUP BY `agent_definition_id` for per-agent breakdown.
**Warning signs:** Token counts look impossibly high (counting tool events) or impossibly low (wrong time window).

### Pitfall 2: Counting "Completed in 24h" vs "All Completed"
**What goes wrong:** The stat cards should show completed/failed counts for the last 24 hours, but running/waiting/queued should be all-time counts (current state). Applying a 24h filter globally would miss long-running conversations.
**Why it happens:** Mixed scoping requirements across the five stat cards.
**How to avoid:** Two separate queries: (1) `countConversationsByStatus()` for running/waiting/queued (no time filter), (2) a new query for completed/failed in last 24h with `AND updated_at >= now() - interval '24h'`.
**Warning signs:** Running count shows 0 when there are active conversations, or completed count shows all-time total.

### Pitfall 3: Duration Calculation for Active Conversations
**What goes wrong:** Computing duration as `updatedAt - createdAt` instead of `now - createdAt` for active conversations.
**Why it happens:** For completed conversations, `updatedAt - createdAt` is correct. For running/waiting ones, the duration is ongoing.
**How to avoid:** For the active conversations table, duration = `Date.now() - createdAt` (computed at render time). The `formatDuration()` utility takes start and end Date objects -- pass `new Date()` as end for active conversations.
**Warning signs:** Active conversation durations look stale or identical to each other.

### Pitfall 4: Worker Status Null When Agent Service Unavailable
**What goes wrong:** Page crashes or shows error when agent-service is down.
**Why it happens:** `fetchWorkerStatus()` may return null if agent-service is unreachable.
**How to avoid:** Handle null worker status gracefully -- show "Agent service unavailable" in the worker status card. Same pattern as `fetchToolsHealth()` returning empty array.
**Warning signs:** Page 500 errors in development when agent-service container isn't running.

### Pitfall 5: Missing basePath in Links
**What goes wrong:** Links to `/conversations/...` not working when deployed with `/dashboard` basePath.
**Why it happens:** Next.js `basePath: "/dashboard"` in next.config.ts -- `Link` component handles this automatically, but manual string construction does not.
**How to avoid:** Always use Next.js `Link` component with relative paths. Never construct full URLs manually.
**Warning signs:** Links work in dev but break in production/Docker.

### Pitfall 6: Chart Color Configuration
**What goes wrong:** Token usage chart bars appear as default gray instead of themed colors.
**Why it happens:** Recharts needs `fill="var(--color-keyName)"` where `keyName` matches the ChartConfig key. If the config key doesn't match the data key, colors won't resolve.
**How to avoid:** Define ChartConfig with keys matching the `dataKey` prop on Bar components. Use `var(--chart-1)` through `var(--chart-5)` which are defined in globals.css for both light and dark modes.
**Warning signs:** Chart renders but bars are all the same color or gray.

## Code Examples

Verified patterns from the existing codebase:

### Service Function: Active Conversations Query
```typescript
// Pattern from services/conversations.ts listConversations
export async function getActiveConversations(limit = 10): Promise<ActiveConversation[]> {
  const rows = await db
    .select({
      id: conversations.id,
      agent_definition_id: conversations.agent_definition_id,
      status: conversations.status,
      created_at: conversations.created_at,
      last_event_type: agentSessions.last_event_type,
    })
    .from(conversations)
    .leftJoin(
      agentSessions,
      eq(agentSessions.conversation_id, conversations.id),
    )
    .where(inArray(conversations.status, ["running", "waiting"]))
    .orderBy(asc(conversations.created_at)) // Oldest first = longest running first
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    agentDefinitionId: row.agent_definition_id,
    status: row.status,
    createdAt: row.created_at,
    lastEventType: row.last_event_type,
  }));
}
```

### Service Function: Token Usage by Agent (24h)
```typescript
// Pattern from services/conversations.ts token aggregation subquery
export async function getTokenUsageByAgent(): Promise<TokenUsageByAgent[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      agent_definition_id: agentEvents.agent_definition_id,
      total_input:
        sql<number>`coalesce(sum(${agentEvents.token_count_input}), 0)`,
      total_output:
        sql<number>`coalesce(sum(${agentEvents.token_count_output}), 0)`,
    })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.type, "llm.response"),
        gte(agentEvents.timestamp, since),
      ),
    )
    .groupBy(agentEvents.agent_definition_id);

  return rows.map((row) => ({
    agentDefinitionId: row.agent_definition_id,
    inputTokens: Number(row.total_input),
    outputTokens: Number(row.total_output),
  }));
}
```

### Service Function: Recent Errors (Interleaved)
```typescript
// Pattern from services/tools.ts getRecentToolFailures + conversations failed query
export async function getRecentErrors(limit = 10): Promise<RecentError[]> {
  // Failed conversations in last 24h
  const failedConversations = await db
    .select({
      id: conversations.id,
      agent_definition_id: conversations.agent_definition_id,
      error_message: conversations.error_message,
      updated_at: conversations.updated_at,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "failed"),
        gte(conversations.updated_at, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(conversations.updated_at))
    .limit(limit);

  // Tool failures in last 24h
  const toolFailures = await db
    .select({
      id: agentEvents.id,
      conversation_id: agentEvents.conversation_id,
      agent_definition_id: agentEvents.agent_definition_id,
      payload: agentEvents.payload,
      timestamp: agentEvents.timestamp,
    })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.type, "tool.failed"),
        gte(agentEvents.timestamp, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(agentEvents.timestamp))
    .limit(limit);

  // Merge and sort by timestamp, take top N
  // ... normalize both types into RecentError[], sort, slice
}
```

### Token Usage Chart Component (Client)
```typescript
// Pattern from components/tools/tool-performance.tsx BarChart usage
"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const tokenConfig = {
  inputTokens: { label: "Input", color: "var(--chart-1)" },
  outputTokens: { label: "Output", color: "var(--chart-2)" },
} satisfies ChartConfig;

// Use stacked BarChart (vertical bars, one per agent)
<ChartContainer config={tokenConfig} className="min-h-[200px] w-full">
  <BarChart data={data} accessibilityLayer>
    <CartesianGrid vertical={false} />
    <XAxis dataKey="agentDefinitionId" tickLine={false} axisLine={false} tickMargin={8} />
    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <ChartLegend content={<ChartLegendContent />} />
    <Bar dataKey="inputTokens" stackId="tokens" fill="var(--color-inputTokens)" radius={[0, 0, 0, 0]} />
    <Bar dataKey="outputTokens" stackId="tokens" fill="var(--color-outputTokens)" radius={[4, 4, 0, 0]} />
  </BarChart>
</ChartContainer>
```

### Loading Skeleton
```typescript
// Pattern from app/agents/loading.tsx and app/tools/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function OverviewLoading() {
  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {["s1","s2","s3","s4","s5"].map((k) => (
          <Skeleton key={k} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      {/* Two-column grid sections */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[300px] w-full rounded-xl" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[300px] w-full rounded-xl" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    </main>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pages/ directory | App Router (app/) | Next.js 13+ | All pages are already App Router |
| getServerSideProps | async server components | Next.js 13+ | Already in use |
| CSS modules | Tailwind v4 CSS | Already migrated | Use utility classes |

**Deprecated/outdated:**
- None applicable -- the codebase is already on current versions of all dependencies.

## Open Questions

Things that couldn't be fully resolved:

1. **Stat card icons vs text-only**
   - What we know: CONTEXT.md leaves this to Claude's discretion. The integration-health cards are text-only. The agent cards have no stat-style cards for precedent.
   - Recommendation: Start text-only (no icons). Keeps it clean and consistent with the integration health card pattern. Icons can be added later if the page feels too plain.

2. **Sparklines in stat cards**
   - What we know: CONTEXT.md leaves this to Claude's discretion.
   - Recommendation: Skip sparklines. They would require additional time-series queries per status, adding complexity for marginal value. A trend indicator (up/down arrow) could be added in a future iteration.

3. **Worker status capacity gauge**
   - What we know: CONTEXT.md leaves this to Claude's discretion.
   - Recommendation: Numbers only (e.g., "3 / 5"). A progress bar or gauge adds visual complexity without much clarity gain when the values are small integers. The status dot (emerald/amber) provides the at-a-glance health signal.

4. **Error truncation length**
   - What we know: CONTEXT.md leaves this to Claude's discretion. The recent-failures.tsx in tools uses 100 characters.
   - Recommendation: Use 120 characters for the overview error excerpt, consistent with the tools failures pattern. Single line with `line-clamp-1` to prevent layout jumps.

5. **Two-column to single-column breakpoint**
   - What we know: CONTEXT.md says `lg:grid-cols-2` for the two-column grids.
   - Recommendation: Use `lg:grid-cols-2` (1024px breakpoint) consistent with tool-performance.tsx chart grid. Below 1024px, stack to single column.

## Sources

### Primary (HIGH confidence)
- `packages/dashboard/src/app/tools/page.tsx` -- page data loading pattern
- `packages/dashboard/src/components/tools/tool-performance.tsx` -- Recharts chart pattern
- `packages/dashboard/src/components/tools/integration-health.tsx` -- stat card / status dot pattern
- `packages/dashboard/src/components/agents/agent-recent-conversations.tsx` -- table-in-card pattern
- `packages/dashboard/src/components/conversations/status-badge.tsx` -- status badge colors
- `packages/dashboard/src/services/conversations.ts` -- service layer query patterns
- `packages/dashboard/src/services/tools.ts` -- tool failure query patterns
- `packages/dashboard/src/lib/agent-service.ts` -- HTTP client pattern for agent-service API
- `packages/dashboard/src/lib/format.ts` -- formatting utilities
- `packages/dashboard/src/lib/schema.ts` -- Drizzle table definitions
- `packages/agents/src/service/api/types.ts` -- WorkerStatusResponse type definition
- `packages/agents/src/service/api/worker-status.ts` -- GET /api/worker/status endpoint

### Secondary (MEDIUM confidence)
- None needed -- all patterns verified from existing codebase

### Tertiary (LOW confidence)
- None needed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed and in use. No new dependencies.
- Architecture: HIGH -- Every pattern has direct precedent in the codebase (tools, conversations, agents pages).
- Pitfalls: HIGH -- Identified from actual code patterns and data model constraints visible in schema.ts and existing queries.

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (stable -- no moving dependencies, all patterns established)
