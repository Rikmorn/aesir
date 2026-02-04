# Phase 53: Tool Dashboard - Research

**Researched:** 2026-02-04
**Domain:** Dashboard UI -- tool registry, permissions, metrics, charts
**Confidence:** HIGH

## Summary

This phase adds a `/tools` page to the existing Next.js dashboard (`@aesir/dashboard`) that surfaces tool registry data, agent-to-tool permissions with mismatch detection, performance metrics with charts, recent failure history, and integration health status. All data sources already exist -- the agent-service exposes `GET /api/tools/registry` and `GET /api/tools/health`, and the `agents.agent_events` table contains all tool call/success/failure events with timing data. MCP permissions live in three separate PostgreSQL schema tables (`linear.mcp_tool_permissions`, `github.mcp_tool_permissions`, `slack.mcp_tool_permissions`).

The dashboard already uses Next.js 15, React 19, shadcn/ui (new-york style), Tailwind CSS 4, Drizzle ORM for read-only DB access, and `nuqs` for URL-based filter state. All of these patterns are established in phases 49-52 and should be followed exactly. The primary new dependency is a chart library -- Recharts via shadcn/ui's chart component.

**Primary recommendation:** Use shadcn/ui's chart component (which wraps Recharts) with the chart CSS variables already defined in `globals.css`. Build a single `/tools` page with a tabbed layout (matching the agent detail page pattern from phase 52) with 5 tabs: Registry, Permissions, Performance, Failures, Health. Server components for initial data loading, client components for interactive sections (charts, filters, expandable rows).

## Standard Stack

The established libraries/tools for this domain:

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.5.9 | App Router, server components | Already in use |
| React | 19.x | UI framework | Already in use |
| shadcn/ui | new-york style | Card, Table, Tabs, Badge, Collapsible, Tooltip | Already in use |
| Drizzle ORM | 0.45.1 | Read-only PostgreSQL queries | Already in use |
| nuqs | 2.8.8 | URL query state (filters, time range) | Already in use |
| Tailwind CSS | 4.0 | Styling | Already in use |
| lucide-react | 0.400.0 | Icons | Already in use |
| @tanstack/react-table | 8.21.3 | Data table (failures list) | Already in use |

### New Dependencies
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| recharts | 2.x (latest v2) | Chart rendering | shadcn/ui chart component uses Recharts v2 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts v2 (via shadcn) | Recharts v3 | v3 PR for shadcn is still open/unmerged as of Feb 2026; stick with v2 for compatibility |
| Recharts | tremor | Heavier, different design language; shadcn already has Recharts integration |
| Recharts | Chart.js/react-chartjs-2 | Canvas-based, less React-native; shadcn integration doesn't exist |

**Installation:**
```bash
# Install recharts (v2)
pnpm --filter @aesir/dashboard add recharts@^2

# Add shadcn chart component
cd packages/dashboard && pnpm dlx shadcn@latest add chart
```

**Important note on Recharts version:** shadcn/ui's chart component is built for Recharts v2. The PR to upgrade to v3 (shadcn-ui/ui#8486) is still open and unmerged as of February 2026. Use v2 for compatibility. When v3 support ships, upgrading is straightforward since shadcn components are owned code.

## Architecture Patterns

### Page Structure Recommendation: Tabbed Layout

Use a tabbed layout on `/tools` (same pattern as agent detail page from phase 52). This is better than a scrolling page because:
1. Five sections with different data densities would make a long scroll confusing
2. Tabs are already an established pattern in the dashboard (agent detail uses Tabs for Configuration/System Prompt/Recent Conversations)
3. Each tab can load its data independently (no wasted DB queries for hidden sections)

```
/tools (page.tsx)
  ├── Tab: Registry      -- Tool list grouped by namespace
  ├── Tab: Permissions   -- Agent x Tool matrix with mismatch highlights
  ├── Tab: Performance   -- Charts: call volume, failure rate, latency
  ├── Tab: Failures      -- Recent tool.failed events, filterable
  └── Tab: Health        -- Integration endpoint status
```

### Recommended Project Structure
```
packages/dashboard/src/
├── app/tools/
│   ├── page.tsx              # Server component: loads data, renders tabs
│   └── loading.tsx           # Skeleton for the whole page
├── components/tools/
│   ├── tool-registry.tsx     # Tool list by namespace (server component)
│   ├── permission-matrix.tsx # Agent x tool grid (server component)
│   ├── tool-performance.tsx  # Charts section (client component)
│   ├── recent-failures.tsx   # Failure list with filters (client component)
│   └── integration-health.tsx # Health cards (server component)
└── services/tools.ts         # All tool-related queries and API calls
```

### Data Flow Pattern

Following established patterns from phases 50-52:

```
page.tsx (server component)
  → services/tools.ts (service layer)
    → lib/agent-service.ts (HTTP to agent-service for registry + health)
    → lib/db.ts (Drizzle queries for events + permissions)
  → components/tools/* (render components)
```

**Service layer pattern** (from `services/agents.ts` and `services/conversations.ts`):
- Typed functions, camelCase interfaces
- Server-side only (runs in RSC / API routes)
- Combines HTTP API data with database queries
- Returns clean typed interfaces, not raw DB rows

### Pattern 1: Server Component Tabs with Client Interactivity

The page is a server component that loads initial data for all tabs. Interactive tabs (Performance, Failures) are client components within server-rendered TabsContent.

```typescript
// page.tsx (server component)
export default async function ToolsPage({ searchParams }: Props) {
  const params = await searchParams;
  const tab = params.tab ?? "registry";

  // Load data in parallel based on active tab
  const [tools, agents, health] = await Promise.all([
    getToolRegistry(),
    getAgentList(),
    getToolsHealth(),
  ]);

  return (
    <Tabs defaultValue={tab}>
      <TabsList>
        <TabsTrigger value="registry">Registry</TabsTrigger>
        <TabsTrigger value="permissions">Permissions</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="failures">Failures</TabsTrigger>
        <TabsTrigger value="health">Health</TabsTrigger>
      </TabsList>
      <TabsContent value="registry">
        <ToolRegistry tools={tools} agents={agents} />
      </TabsContent>
      {/* ... */}
    </Tabs>
  );
}
```

### Pattern 2: Permission Matrix Cross-Reference

The permission matrix needs to cross-reference THREE data sources:
1. **Agent definitions** (from `GET /api/agents/registry`) -- each agent has a `tools[]` array
2. **Tool registry** (from `GET /api/tools/registry`) -- all registered tools
3. **MCP permissions** (from DB: `linear.mcp_tool_permissions`, `github.mcp_tool_permissions`, `slack.mcp_tool_permissions`)

The cross-reference logic:
- For each agent + MCP tool combination, check:
  - Does the agent's YAML `tools[]` reference it? (e.g., `linear:get_issue`)
  - Does the MCP `mcp_tool_permissions` table allow it? (e.g., `agent_id='dev-agent', tool_name='get_issue'`)
- **Mismatch = agent YAML references tool BUT MCP table does not allow** (or vice versa)

**Note:** Codebase and coordination tools do NOT have MCP permissions (they're local). The matrix only applies to MCP-routed tools (linear, github, slack namespaces).

### Pattern 3: Time-Range Filtered Metrics via SQL Aggregation

Performance metrics are computed from `agents.agent_events` using SQL aggregation:

```sql
-- Call volume by tool, grouped by time bucket
SELECT
  (payload->>'tool_name') as tool_name,
  date_trunc('minute', timestamp) as bucket,
  COUNT(*) FILTER (WHERE type = 'tool.called') as calls,
  COUNT(*) FILTER (WHERE type = 'tool.failed') as failures,
  AVG(duration_ms) FILTER (WHERE type IN ('tool.succeeded', 'tool.failed')) as avg_latency,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)
    FILTER (WHERE type IN ('tool.succeeded', 'tool.failed')) as p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
    FILTER (WHERE type IN ('tool.succeeded', 'tool.failed')) as p95
FROM agents.agent_events
WHERE type IN ('tool.called', 'tool.succeeded', 'tool.failed')
  AND timestamp >= NOW() - INTERVAL '1 hour'
GROUP BY tool_name, bucket
ORDER BY bucket ASC;
```

### Anti-Patterns to Avoid
- **Fetching all events to the client for chart rendering:** Always aggregate in SQL, send only the computed data points to the browser
- **Creating new database tables:** The dashboard is read-only, no schema changes
- **Direct imports from @aesir/agents:** Dashboard maintains its own schema definitions and HTTP client to avoid coupling
- **Fetching permission data from integration services via HTTP:** The dashboard has direct read-only DB access; querying `linear.mcp_tool_permissions` directly is simpler and faster than building new API endpoints

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Charts | Custom SVG chart components | shadcn/ui chart + Recharts | 53 pre-built chart patterns, CSS variable theming, responsive |
| Responsive charts | Manual resize observers | Recharts `ResponsiveContainer` via shadcn `ChartContainer` | Handles all resize edge cases |
| Chart tooltips | Custom tooltip positioning | shadcn `ChartTooltip` + `ChartTooltipContent` | Consistent with design system, handles positioning |
| URL filter state | useState + pushState | nuqs `useQueryStates` | Already used in conversations page, SSR-safe |
| Expandable rows | Custom toggle state | Radix Collapsible (already wrapped) | Already used in event-timeline |
| Pagination | Custom page logic | Existing `DataTablePagination` component | Already built with nuqs integration |
| Data tables | Custom table rendering | shadcn Table or @tanstack/react-table | Both already in the project |

**Key insight:** The dashboard already has all the UI primitives needed. The only genuinely new thing is the chart library (Recharts via shadcn).

## Common Pitfalls

### Pitfall 1: Three Separate MCP Permission Tables
**What goes wrong:** Assuming there's one unified permissions table. There are THREE: `linear.mcp_tool_permissions`, `github.mcp_tool_permissions`, `slack.mcp_tool_permissions` -- each in a different schema.
**Why it happens:** The integration packages are independent, each with their own DB schema namespace.
**How to avoid:** Query all three tables and UNION the results. Add the schema definitions for all three to the dashboard's local `lib/schema.ts`.
**Warning signs:** Missing permissions for some integrations in the matrix.

### Pitfall 2: Tool Name Mismatch Between Registry and Permissions
**What goes wrong:** The tool registry uses `namespace:tool_name` format (e.g., `linear:get_issue`), but MCP permission tables store just the `tool_name` (e.g., `get_issue`). Agent YAML definitions use `namespace:tool_name`.
**Why it happens:** The MCP permissions are integration-scoped (the schema implies the namespace).
**How to avoid:** When cross-referencing, split the registry ref on `:` -- the prefix maps to the schema, the suffix maps to `tool_name` in the permission table. For example:
- `linear:get_issue` -> query `linear.mcp_tool_permissions` WHERE `tool_name = 'get_issue'`
- `github:create_branch` -> query `github.mcp_tool_permissions` WHERE `tool_name = 'create_branch'`

### Pitfall 3: Real Mismatches Already Exist
**What goes wrong:** Developers may think mismatches are theoretical. They are not.
**Evidence found:**
- `linear:create_comment` is seeded in `linear.mcp_tool_permissions` for dev-agent and product-agent, but is NOT registered in the tool-factories (only 6 Linear tools registered). The MCP endpoint exposes `create_comment` but the agent can't reference it via `linear:create_comment` in its YAML.
- `slack:send_escalation_request` is seeded in `slack.mcp_tool_permissions` for dev-agent and exists as an MCP endpoint, but is NOT in the tool-factories (only 5 Slack tools registered in tool-factories).
**How to handle:** These are real mismatches the matrix should highlight. They validate the feature's value.

### Pitfall 4: Codebase/Coordination Tools Have No MCP Permissions
**What goes wrong:** Trying to show permission status for tools that don't go through MCP.
**Why it happens:** Codebase tools (read_file, write_file, etc.) and coordination tools (spawn_agent, request_human_input, wait_for) are local to the agent service -- they don't pass through integration MCP endpoints and thus have no permission rows.
**How to avoid:** In the permission matrix, only show MCP-routed namespaces (linear, github, slack). Codebase and coordination tools should show as "local" or be excluded from the matrix entirely.

### Pitfall 5: Chart SSR Hydration Issues
**What goes wrong:** Recharts renders differently on server vs client, causing hydration warnings.
**Why it happens:** Recharts uses browser APIs (SVG measurement) that don't exist during SSR.
**How to avoid:** Mark chart components as `"use client"`. Use shadcn's `ChartContainer` which handles responsive sizing. Set `min-h-[VALUE]` on ChartContainer (required per shadcn docs).

### Pitfall 6: Event Payload Structure for Tool Events
**What goes wrong:** Assuming consistent payload structure across tool event types.
**Actual payloads found in worker-loop.ts:**

**tool.called:**
```json
{
  "tool_name": "read_file",
  "tool_call_id": "toolu_xxx",
  "input": { "path": "/foo.ts" }
}
```

**tool.succeeded / tool.failed:**
```json
{
  "tool_name": "read_file",
  "tool_call_id": "toolu_xxx",
  "output": "... (truncated to 2000 chars)",
  "is_error": true
}
```

**Duration:** Stored in `duration_ms` column (not in payload) for succeeded/failed events.

### Pitfall 7: Percentile Calculations in PostgreSQL
**What goes wrong:** Using `PERCENTILE_CONT` with Drizzle ORM.
**Why it happens:** Drizzle doesn't have native helper for `PERCENTILE_CONT` aggregate function.
**How to avoid:** Use `sql` template tag for raw SQL:
```typescript
sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${agentEvents.duration_ms})`
```

## Code Examples

Verified patterns from the existing codebase:

### Service Layer Function (Following services/agents.ts Pattern)
```typescript
// services/tools.ts
import { db } from "@/lib/db";
import { agentEvents } from "@/lib/schema";
import { fetchToolRegistry, fetchToolsHealth } from "@/lib/agent-service";
import { and, eq, gte, sql, desc, inArray } from "drizzle-orm";

export interface ToolMetrics {
  toolName: string;
  namespace: string;
  callCount: number;
  failureCount: number;
  failureRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export async function getToolMetrics(since: Date): Promise<ToolMetrics[]> {
  const rows = await db
    .select({
      tool_name: sql<string>`${agentEvents.payload}->>'tool_name'`,
      calls: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.called')`,
      failures: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.failed')`,
      avg_latency: sql<number>`AVG(${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
      p50: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
      p95: sql<number>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
    })
    .from(agentEvents)
    .where(
      and(
        inArray(agentEvents.type, ["tool.called", "tool.succeeded", "tool.failed"]),
        gte(agentEvents.timestamp, since),
      )
    )
    .groupBy(sql`${agentEvents.payload}->>'tool_name'`);

  return rows.map((row) => ({
    toolName: row.tool_name,
    namespace: "", // derived from tool registry lookup
    callCount: Number(row.calls),
    failureCount: Number(row.failures),
    failureRate: Number(row.calls) > 0 ? Number(row.failures) / Number(row.calls) : 0,
    avgLatencyMs: Number(row.avg_latency ?? 0),
    p50LatencyMs: Number(row.p50 ?? 0),
    p95LatencyMs: Number(row.p95 ?? 0),
  }));
}
```

### MCP Permission Schema Definitions (Dashboard-Local)
```typescript
// lib/schema.ts (additions)
import { boolean, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const linearSchema = pgSchema("linear");
export const githubSchema = pgSchema("github");
export const slackSchema = pgSchema("slack");

export const linearMcpPermissions = linearSchema.table("mcp_tool_permissions", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  tool_name: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull(),
});

export const githubMcpPermissions = githubSchema.table("mcp_tool_permissions", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  tool_name: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull(),
});

export const slackMcpPermissions = slackSchema.table("mcp_tool_permissions", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  tool_name: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull(),
});
```

### shadcn Chart Pattern
```typescript
"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  calls: {
    label: "Calls",
    color: "var(--chart-1)",
  },
  failures: {
    label: "Failures",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig;

interface ToolChartProps {
  data: Array<{ bucket: string; calls: number; failures: number }>;
}

export function CallVolumeChart({ data }: ToolChartProps) {
  return (
    <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
      <AreaChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="bucket" />
        <YAxis />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="calls" fill="var(--color-calls)" stroke="var(--color-calls)" />
        <Area dataKey="failures" fill="var(--color-failures)" stroke="var(--color-failures)" />
      </AreaChart>
    </ChartContainer>
  );
}
```

### Permission Mismatch Detection Logic
```typescript
interface PermissionCell {
  agentId: string;
  toolRef: string; // "linear:get_issue"
  inYaml: boolean; // Agent YAML references this tool
  inMcp: boolean;  // MCP permission table allows it
  mismatch: "yaml-only" | "mcp-only" | "none";
}

function detectMismatches(
  agents: AgentSummary[],
  mcpPermissions: McpPermission[],
  mcpNamespaces: string[], // ["linear", "github", "slack"]
): PermissionCell[] {
  const cells: PermissionCell[] = [];
  const permSet = new Set(
    mcpPermissions.map((p) => `${p.namespace}:${p.agentId}:${p.toolName}`)
  );

  for (const agent of agents) {
    for (const toolRef of agent.tools) {
      const [namespace, toolName] = toolRef.split(":");
      if (!mcpNamespaces.includes(namespace)) continue;

      const mcpKey = `${namespace}:${agent.id}:${toolName}`;
      const inMcp = permSet.has(mcpKey);

      cells.push({
        agentId: agent.id,
        toolRef,
        inYaml: true,
        inMcp,
        mismatch: inMcp ? "none" : "yaml-only",
      });
    }
  }

  // Also check MCP permissions not in any YAML
  for (const perm of mcpPermissions) {
    const toolRef = `${perm.namespace}:${perm.toolName}`;
    const agent = agents.find((a) => a.id === perm.agentId);
    if (!agent || !agent.tools.includes(toolRef)) {
      cells.push({
        agentId: perm.agentId,
        toolRef,
        inYaml: false,
        inMcp: true,
        mismatch: "mcp-only",
      });
    }
  }

  return cells;
}
```

### Recent Failures Query
```typescript
export async function getRecentToolFailures(
  params: { limit?: number; namespace?: string; agentId?: string; since?: Date }
): Promise<ToolFailure[]> {
  const conditions = [eq(agentEvents.type, "tool.failed")];
  if (params.since) conditions.push(gte(agentEvents.timestamp, params.since));
  if (params.agentId) conditions.push(eq(agentEvents.agent_definition_id, params.agentId));

  const rows = await db
    .select({
      id: agentEvents.id,
      conversation_id: agentEvents.conversation_id,
      agent_definition_id: agentEvents.agent_definition_id,
      payload: agentEvents.payload,
      timestamp: agentEvents.timestamp,
      duration_ms: agentEvents.duration_ms,
    })
    .from(agentEvents)
    .where(and(...conditions))
    .orderBy(desc(agentEvents.timestamp))
    .limit(params.limit ?? 25);

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    agentDefinitionId: row.agent_definition_id,
    toolName: (row.payload as Record<string, unknown>).tool_name as string,
    errorOutput: (row.payload as Record<string, unknown>).output as string,
    timestamp: row.timestamp,
    durationMs: row.duration_ms,
  }));
}
```

## Data Source Mapping

### Data Source for Each Section

| Section | Source | Data Access | Notes |
|---------|--------|-------------|-------|
| Tool Registry | `GET /api/tools/registry` | HTTP to agent-service | Cached at agent-service level (immutable at runtime) |
| Agent Definitions | `GET /api/agents/registry` | HTTP to agent-service | Needed for permission matrix cross-ref |
| MCP Permissions | `linear.mcp_tool_permissions`, `github.mcp_tool_permissions`, `slack.mcp_tool_permissions` | Direct DB read | Three separate tables, union results |
| Tool Metrics | `agents.agent_events` | Direct DB read | Aggregate tool.called/succeeded/failed events |
| Recent Failures | `agents.agent_events` WHERE type='tool.failed' | Direct DB read | Last 25, with filters |
| Integration Health | `GET /api/tools/health` | HTTP to agent-service | Cached 30s at agent-service level |

### Tool Registry API Response Shape (from types.ts)
```typescript
interface ToolRegistryEntry {
  name: string;        // "get_issue"
  namespace: string;   // "linear"
  description: string; // "Retrieve issue details"
  inputSchema: Record<string, unknown>; // JSON Schema
}
```

### Integration Health API Response Shape (from types.ts)
```typescript
interface IntegrationHealth {
  name: string;            // "linear"
  status: "healthy" | "unhealthy";
  latencyMs: number | null;
  lastChecked: string;     // ISO 8601
}
```

### Agent Event Payload Shapes

**tool.called:**
```json
{ "tool_name": "get_issue", "tool_call_id": "toolu_xxx", "input": {...} }
```

**tool.succeeded:**
```json
{ "tool_name": "get_issue", "tool_call_id": "toolu_xxx", "output": "...(max 2000 chars)", "is_error": false }
```

**tool.failed:**
```json
{ "tool_name": "get_issue", "tool_call_id": "toolu_xxx", "output": "error message...", "is_error": true }
```

## Discretion Recommendations

### Layout: Tabbed (Not Scroll Sections)

**Recommendation:** Tabbed layout with 5 tabs.

**Reasoning:**
- Consistent with agent detail page pattern (phase 52) which uses Tabs
- Sections have vastly different heights and interaction models (static matrix vs interactive charts vs paginated list)
- Tabs naturally segment loading -- only the active tab needs fresh data
- 5 sections on one scroll page would be overwhelming

### Tool Detail Pages: Not Needed

**Recommendation:** No `/tools/[id]` pages. Use expandable rows/cards on the main page.

**Reasoning:**
- Tool data is relatively shallow (name, description, inputSchema, metrics)
- A full detail page would be mostly empty space
- Expandable rows (already used in event-timeline via Collapsible) work well for showing inputSchema on demand
- The `?tool=` URL parameter from phase 52 agent tools links can scroll-to/highlight the tool in the registry tab

### Chart Types

**Recommendation:**
- **Call volume over time:** Area chart (stacked calls + failures)
- **Failure rate over time:** Line chart (percentage)
- **Latency distribution:** Bar chart (p50 vs p95 by tool)

All using shadcn chart components with the existing CSS variables (`--chart-1` through `--chart-5`).

### Permission Mismatch: Inline Cell Warnings

**Recommendation:** Inline cell warnings in the matrix (colored cell backgrounds), plus a summary count badge on the Permissions tab trigger.

**Reasoning:**
- Inline cell coloring is immediately visible in context
- A summary banner would be redundant since the matrix IS the summary
- Show a warning count badge on the tab trigger (e.g., "Permissions (2 mismatches)") to draw attention without requiring tab switch

### Tool Registry: Both Config and Metrics

**Recommendation:** Show both configuration info (name, description, namespace, which agents use it) AND summary metrics (total calls, failure rate, avg latency) inline per tool in the registry tab.

**Reasoning:**
- The registry is the "home" for each tool -- showing basic metrics there avoids forcing users to switch to the Performance tab for a quick health check
- Detailed charts stay in the Performance tab

### Time Range Bucket Sizing

**Recommendation:** Auto-size buckets based on time range:
- 1h: 1-minute buckets (60 data points)
- 24h: 15-minute buckets (96 data points)
- 7d: 1-hour buckets (168 data points)

This keeps chart density reasonable regardless of range.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom chart components | shadcn/ui chart (Recharts) | Mid-2024 | Standardized chart theming with CSS variables |
| Recharts v2 | Recharts v3 (in progress) | PR still open Feb 2026 | Stick with v2 for shadcn compat |
| Manual responsive charts | ChartContainer wrapper | shadcn chart | Handles responsive sizing automatically |

**Deprecated/outdated:**
- Recharts v3 integration with shadcn: Not yet production-ready (PR unmerged). Do not attempt to use v3 with shadcn chart component.

## Existing Assets to Reuse

Components and patterns that already exist and should be reused directly:

| Asset | Location | Reuse For |
|-------|----------|-----------|
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `components/ui/tabs.tsx` | Page tab navigation |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell` | `components/ui/table.tsx` | Permission matrix, failures list |
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | `components/ui/card.tsx` | Section containers, health cards |
| `Badge` | `components/ui/badge.tsx` | Namespace labels, status indicators |
| `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | `components/ui/collapsible.tsx` | Expandable tool details, error payloads |
| `JsonPayload` | `components/conversation-detail/json-payload.tsx` | Error payload display |
| `DataTablePagination` | `components/conversations/data-table-pagination.tsx` | Failures pagination |
| `Skeleton` | `components/ui/skeleton.tsx` | Loading states |
| `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` | `components/ui/select.tsx` | Time range selector |
| `Tooltip`, `TooltipTrigger`, `TooltipContent` | `components/ui/tooltip.tsx` | Cell hover details |
| `groupToolsByNamespace()` | `components/agents/agent-tools-list.tsx` | Tool namespace grouping logic |
| `formatRelativeTime()`, `getTimeRangeDate()` | `lib/format.ts` | Time display, range computation |
| `fetchAgentList()` | `lib/agent-service.ts` | Agent data for matrix |
| `nuqs useQueryStates` pattern | `components/conversations/data-table-toolbar.tsx` | Filter state management |

## Known Tool Inventory

For reference, the complete tool registry (28 tools across 5 namespaces):

| Namespace | Tools (5) | Notes |
|-----------|-----------|-------|
| codebase | `read_file`, `write_file`, `search_codebase`, `list_directory`, `run_command` | Local, no MCP permissions |
| coordination | `spawn_agent`, `request_human_input`, `wait_for` | Local, no MCP permissions |
| linear | `get_issue`, `create_issue`, `update_issue_status`, `list_teams`, `list_labels`, `search_issues` | 6 tools registered; `create_comment` exists in MCP but not in registry |
| github | `get_repository`, `create_branch`, `create_commit`, `create_pull_request`, `get_pull_request`, `list_pull_requests`, `merge_pull_request`, `get_file_contents`, `list_files` | 9 tools |
| slack | `send_message`, `send_approval_request`, `get_message`, `reply_to_thread`, `list_channels` | 5 tools registered; `send_escalation_request` exists in MCP but not in registry |

**Known mismatches (as of current codebase):**
1. `linear:create_comment` -- MCP permissions seeded for dev-agent and product-agent, but tool not registered in tool-factories
2. `slack:send_escalation_request` -- MCP permissions seeded for dev-agent, MCP endpoint exists, but tool not registered in tool-factories

## Open Questions

Things that couldn't be fully resolved:

1. **Time bucket aggregation in Drizzle**
   - What we know: PostgreSQL `date_trunc` works for bucketing. Drizzle supports `sql` template for raw SQL.
   - What's unclear: Whether Drizzle's type inference handles the aggregation cleanly or if manual type assertions are needed.
   - Recommendation: Use `sql` template tag liberally for aggregate queries. Accept `unknown` types and cast in the mapping function. This is the same pattern used in `services/conversations.ts`.

2. **Chart data point count for 7d range**
   - What we know: 168 hourly buckets for 7d is reasonable.
   - What's unclear: Whether 168 data points renders smoothly in Recharts with area fills.
   - Recommendation: Start with hourly buckets. If performance is poor, consider 4-hour buckets (42 points). Recharts handles up to ~500 points well per the docs.

3. **tool= URL parameter from phase 52**
   - What we know: Phase 52 agent tools list links to `/tools?tool=linear:get_issue`.
   - What's unclear: Whether this should auto-switch to the registry tab and highlight/scroll to the tool.
   - Recommendation: Yes, handle the `tool` query parameter. Default to the `registry` tab when present and scroll/highlight the matching tool.

## Sources

### Primary (HIGH confidence)
- Codebase inspection of all dashboard files in `packages/dashboard/src/`
- Codebase inspection of `packages/agents/src/service/api/` (API types, endpoints)
- Codebase inspection of `packages/agents/src/framework/worker-loop.ts` (event payload shapes)
- Codebase inspection of `packages/integrations/*/src/db/schema.ts` (MCP permission tables)
- Codebase inspection of `packages/integrations/*/scripts/seed-permissions.ts` (seeded data)
- Codebase inspection of `packages/agents/definitions/*/definition.yaml` (agent tool lists)

### Secondary (MEDIUM confidence)
- [shadcn/ui Chart documentation](https://ui.shadcn.com/docs/components/chart) -- ChartContainer, ChartTooltip, chart config pattern
- [Recharts GitHub releases](https://github.com/recharts/recharts/releases) -- v3.7.0 latest, but shadcn uses v2
- [shadcn/ui Recharts v3 PR #8486](https://github.com/shadcn-ui/ui/pull/8486) -- still open/unmerged as of Feb 2026

### Tertiary (LOW confidence)
- Web search results for Recharts version status and shadcn integration timeline

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- everything except charts is already in the project; chart recommendation verified via shadcn docs
- Architecture: HIGH -- follows established patterns from phases 50-52 exactly
- Data sources: HIGH -- all API endpoints and DB schemas verified via codebase inspection
- Permission cross-reference: HIGH -- all three MCP tables inspected, mismatches confirmed in code
- Pitfalls: HIGH -- all derived from actual codebase inspection, not hypothetical
- Chart library: MEDIUM -- shadcn chart docs verified, but Recharts v2/v3 situation is in flux

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days -- stable domain, established codebase patterns)
