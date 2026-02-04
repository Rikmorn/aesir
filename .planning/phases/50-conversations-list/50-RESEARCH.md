# Phase 50: Conversations List - Research

**Researched:** 2026-02-04
**Domain:** Next.js server components + shadcn/ui DataTable + Drizzle ORM server-side pagination/filtering
**Confidence:** HIGH

## Summary

Phase 50 builds a filterable, paginated conversations list page at `/conversations` on top of the dashboard infrastructure delivered by Phase 49. The existing codebase already has: a Next.js 15.5.9 app with Tailwind CSS 4 and shadcn/ui configured (components.json present, globals.css with full theme), a Drizzle ORM read-only client (`src/lib/db.ts`) with local schema definitions (`src/lib/schema.ts` covering `conversations`, `agent_events`, `agent_sessions`), and a service layer pattern (`src/services/conversations.ts` with `listConversations` and `countConversationsByStatus`).

This phase needs to: (1) expand the conversations service with the spec's LATERAL join query for token usage aggregation, multi-filter support, and proper pagination with total count, (2) add URL-based filter state management so filters are shareable/bookmarkable, (3) install and configure shadcn/ui Table + Badge + Skeleton + Select components, (4) build the DataTable with TanStack Table for column definitions and client-side rendering of server-fetched data, and (5) create the `/conversations` page as a server component that reads `searchParams` and passes data to the client table component.

The approach is server-side pagination with URL search params as the single source of truth for filter/page state. Data is fetched in a server component via the service layer, then passed as props to a client DataTable component. No client-side data fetching (no React Query, no SWR) -- the server component handles everything. Page navigation triggers a full server component re-render, which is the standard Next.js App Router pattern for data tables.

**Primary recommendation:** Use `nuqs` for type-safe URL search param management, shadcn/ui Table + TanStack Table for the DataTable, and expand the existing conversations service with Drizzle's `leftJoinLateral` for the token aggregation query from spec Appendix B.1.

## Standard Stack

### Core (New dependencies for this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-table | ^8.21.0 | Headless table logic (column defs, sorting, pagination) | Official recommendation from shadcn/ui DataTable guide; headless means full styling control |
| nuqs | ^2.8.0 | Type-safe URL search param state management | Standard solution for Next.js App Router URL state; 6KB gzipped; supports server component re-renders |

### Already Available (from Phase 49)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| next | 15.5.9 | Framework | Installed |
| react / react-dom | ^19.0.3 | UI | Installed |
| tailwindcss | ^4.0.0 | Styling | Configured |
| drizzle-orm | ^0.45.1 | Database queries | Configured with schema |
| pg | ^8.17.2 | PostgreSQL client | Configured |
| class-variance-authority | ^0.7.0 | Component variants | Installed |
| clsx + tailwind-merge | latest | Class utilities | Installed |
| lucide-react | ^0.400.0 | Icons | Installed |

### shadcn/ui Components to Install

| Component | Command | Purpose |
|-----------|---------|---------|
| table | `pnpm dlx shadcn@latest add table` | Base Table, TableHeader, TableBody, TableRow, TableCell, TableHead |
| badge | `pnpm dlx shadcn@latest add badge` | Status badges (completed, failed, running, waiting, queued) |
| skeleton | `pnpm dlx shadcn@latest add skeleton` | Loading state placeholders |
| button | `pnpm dlx shadcn@latest add button` | Pagination controls, filter actions |
| select | `pnpm dlx shadcn@latest add select` | Time range dropdown |
| popover | `pnpm dlx shadcn@latest add popover` | Multi-select filter dropdowns |
| command | `pnpm dlx shadcn@latest add command` | Searchable multi-select for status/agent filters |
| separator | `pnpm dlx shadcn@latest add separator` | Visual dividers in filter toolbar |
| input | `pnpm dlx shadcn@latest add input` | Search/filter inputs if needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nuqs | Raw useSearchParams + manual parsing | nuqs handles serialization, type safety, debouncing, and server component re-renders automatically. Raw approach requires 50+ lines of boilerplate for the same thing. |
| Server-side pagination via searchParams | React Query + client-side fetching | The spec requires URL-shareable page state. Server components with searchParams is the standard Next.js pattern and avoids client-side JS for data fetching. No need for React Query complexity. |
| TanStack Table | Plain HTML table | TanStack Table provides column definitions, cell rendering, and pagination state management that would need to be hand-built otherwise. The DataTable component is ~60 lines. |

**Installation:**
```bash
cd packages/dashboard
pnpm add @tanstack/react-table nuqs
pnpm dlx shadcn@latest add table badge skeleton button select popover command separator input
```

## Architecture Patterns

### Recommended Project Structure

```
packages/dashboard/src/
  app/
    conversations/
      page.tsx                 # Server component: reads searchParams, calls service, renders DataTable
      loading.tsx              # Next.js loading.tsx: shows table skeleton during data fetch
    layout.tsx                 # Existing root layout (add nav component)
  components/
    ui/                        # shadcn/ui components (auto-generated by shadcn CLI)
      table.tsx
      badge.tsx
      skeleton.tsx
      button.tsx
      select.tsx
      popover.tsx
      command.tsx
      separator.tsx
      input.tsx
    conversations/
      columns.tsx              # "use client" - TanStack column definitions
      data-table.tsx           # "use client" - DataTable component with pagination
      data-table-toolbar.tsx   # "use client" - Filter controls toolbar
      status-badge.tsx         # Status badge with color mapping
      conversations-table-skeleton.tsx  # Skeleton placeholder matching table layout
  services/
    conversations.ts           # Existing file -- expand with full query
  lib/
    db.ts                      # Existing
    schema.ts                  # Existing
    format.ts                  # NEW: Date, duration, token count formatters
    utils.ts                   # Existing cn() utility
```

### Pattern 1: Server Component Page with searchParams (Next.js 15)

**What:** The page.tsx is a server component that receives `searchParams` as an async prop, passes them to the service layer, and renders the result. No client-side data fetching needed.

**When to use:** Every data-heavy page in this dashboard.

**Example:**
```typescript
// src/app/conversations/page.tsx (Server Component)
import { Suspense } from "react";
import { listConversations } from "@/services/conversations";
import { ConversationsTable } from "@/components/conversations/data-table";
import { ConversationsTableSkeleton } from "@/components/conversations/conversations-table-skeleton";

interface ConversationsPageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
    agent?: string;
    timeRange?: string;
    hasErrors?: string;
  }>;
}

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = 25;

  const { items, total } = await listConversations({
    status: params.status?.split(","),
    agentDefinitionId: params.agent?.split(","),
    timeRange: parseTimeRange(params.timeRange),
    hasErrors: params.hasErrors === "true",
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold tracking-tight">Conversations</h1>
      <ConversationsTable
        data={items}
        total={total}
        page={page}
        pageSize={pageSize}
      />
    </div>
  );
}
```

**Key point:** In Next.js 15, `searchParams` is a Promise that must be awaited. This is a breaking change from Next.js 14 where it was a plain object.

### Pattern 2: Client DataTable with Server-Provided Data

**What:** A "use client" component that receives data as props and uses TanStack Table for column rendering and pagination UI. It does NOT fetch data itself -- the server component does that.

**When to use:** Any table that needs interactive features (column formatting, row clicks, pagination controls) but gets its data from a server component.

**Example:**
```typescript
// src/components/conversations/data-table.tsx
"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { columns } from "./columns";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";
import type { ConversationListItem } from "@/services/conversations";

interface ConversationsTableProps {
  data: ConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function ConversationsTable({ data, total, page, pageSize }: ConversationsTableProps) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,  // Server handles pagination
    pageCount: Math.ceil(total / pageSize),
  });

  return (
    <div className="space-y-4">
      <DataTableToolbar />
      <div className="rounded-md border">
        <Table>
          {/* ... header and body rendering ... */}
        </Table>
      </div>
      <DataTablePagination table={table} total={total} page={page} pageSize={pageSize} />
    </div>
  );
}
```

**Critical:** Use `manualPagination: true` because the server handles pagination. Without this, TanStack Table would try to paginate the data client-side, showing only the current page's items as if that's all the data.

### Pattern 3: URL State with nuqs for Filters

**What:** Use nuqs hooks to manage filter state in URL search params. When filters change, the URL updates, which triggers a server component re-render with new data.

**When to use:** Any filter/pagination control that should be URL-shareable.

**Setup:**
```typescript
// src/app/layout.tsx -- wrap with NuqsAdapter
import { NuqsAdapter } from "nuqs/adapters/next/app";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
```

**Usage in toolbar:**
```typescript
// src/components/conversations/data-table-toolbar.tsx
"use client";

import { useQueryStates, parseAsArrayOf, parseAsString, parseAsInteger, parseAsBoolean } from "nuqs";

const filterParsers = {
  page: parseAsInteger.withDefault(1),
  status: parseAsArrayOf(parseAsString, ","),
  agent: parseAsArrayOf(parseAsString, ","),
  timeRange: parseAsString.withDefault("24h"),
  hasErrors: parseAsBoolean,
};

export function DataTableToolbar() {
  const [filters, setFilters] = useQueryStates(filterParsers, {
    shallow: false, // CRITICAL: triggers server component re-render
  });

  // When user toggles a status filter:
  const toggleStatus = (status: string) => {
    const current = filters.status ?? [];
    const next = current.includes(status)
      ? current.filter((s) => s !== status)
      : [...current, status];
    setFilters({ status: next.length > 0 ? next : null, page: 1 });
  };

  // ...
}
```

**Critical:** Set `shallow: false` on the nuqs hook. By default nuqs does shallow (client-only) URL updates. With `shallow: false`, it triggers a server-side re-render, which is what we need for the server component to re-fetch data with new filters.

### Pattern 4: Drizzle LATERAL Join for Token Aggregation

**What:** Use Drizzle's `leftJoinLateral` to implement the spec's Appendix B.1 query pattern for aggregating token usage per conversation.

**When to use:** The conversations list query.

**Example:**
```typescript
// In services/conversations.ts
import { sql, and, inArray, gte, lte, eq, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, agentEvents, agentSessions } from "@/lib/schema";

const tokenAgg = db
  .select({
    conversation_id: agentEvents.conversation_id,
    total_input: sql<number>`coalesce(sum(${agentEvents.token_count_input}), 0)`.as("total_input"),
    total_output: sql<number>`coalesce(sum(${agentEvents.token_count_output}), 0)`.as("total_output"),
  })
  .from(agentEvents)
  .where(eq(agentEvents.type, "llm.response"))
  .groupBy(agentEvents.conversation_id)
  .as("token_agg");

// Main query uses left join (not lateral) since we group by conversation_id
const rows = await db
  .select({
    id: conversations.id,
    agentDefinitionId: conversations.agent_definition_id,
    status: conversations.status,
    errorMessage: conversations.error_message,
    createdAt: conversations.created_at,
    updatedAt: conversations.updated_at,
    lastEventAt: agentSessions.last_event_at,
    tokenInput: sql<number>`coalesce(${tokenAgg.total_input}, 0)`,
    tokenOutput: sql<number>`coalesce(${tokenAgg.total_output}, 0)`,
  })
  .from(conversations)
  .leftJoin(agentSessions, eq(agentSessions.conversation_id, conversations.id))
  .leftJoin(tokenAgg, eq(tokenAgg.conversation_id, conversations.id))
  .where(and(...filters))
  .orderBy(desc(conversations.created_at))
  .limit(limit)
  .offset(offset);
```

**Note on LATERAL vs subquery join:** The spec's SQL uses `LEFT JOIN LATERAL`, but for this particular query (aggregating per conversation_id then joining), a regular subquery join produces the same result and is simpler in Drizzle. Drizzle's `leftJoinLateral` is for cases where the subquery needs to reference columns from the outer query's current row -- which isn't needed here since we aggregate and join on `conversation_id`. Use a regular subquery `.as()` with `leftJoin`.

### Pattern 5: Dynamic Filter Building

**What:** Build Drizzle WHERE clauses conditionally based on which filters are active.

**When to use:** Any query with optional filters.

**Example:**
```typescript
function buildFilters(params: ConversationListParams): SQL[] {
  const conditions: SQL[] = [];

  if (params.status?.length) {
    conditions.push(inArray(conversations.status, params.status));
  }

  if (params.agentDefinitionId?.length) {
    conditions.push(inArray(conversations.agent_definition_id, params.agentDefinitionId));
  }

  if (params.timeRange) {
    conditions.push(gte(conversations.created_at, params.timeRange.from));
    if (params.timeRange.to) {
      conditions.push(lte(conversations.created_at, params.timeRange.to));
    }
  }

  if (params.hasErrors) {
    conditions.push(eq(conversations.status, "failed"));
  }

  return conditions;
}

// Usage: .where(conditions.length > 0 ? and(...conditions) : undefined)
```

### Pattern 6: Separate Total Count Query

**What:** Run a separate COUNT query for pagination total instead of using window functions.

**When to use:** Paginated queries where the total is needed for page count display.

**Example:**
```typescript
// Get total count for pagination
const [{ total }] = await db
  .select({ total: count() })
  .from(conversations)
  .where(conditions.length > 0 ? and(...conditions) : undefined);
```

**Why separate query over window function:** A `COUNT(*) OVER()` window function would force Postgres to scan all matching rows even for page 1. Two separate queries allow Postgres to optimize the data query with LIMIT independently. For this table size (thousands of conversations, not millions), the difference is negligible, but the code is cleaner.

### Anti-Patterns to Avoid

- **Client-side data fetching for the initial load:** Do NOT use `useEffect` + `fetch` or React Query for the initial table data. The server component fetches data at render time. Client-side fetching adds loading spinners, layout shifts, and waterfall requests.

- **Storing filter state in React state instead of URL:** All filter state MUST be in the URL via search params. This ensures shareable links and server-side data fetching. Use nuqs, not `useState`.

- **Using TanStack Table's client-side pagination:** Set `manualPagination: true`. The server handles pagination. TanStack Table's `getPaginationRowModel` would paginate the already-paginated server response, showing incorrect results.

- **Fetching all conversations and filtering client-side:** The database should handle filtering and pagination. The service layer applies WHERE clauses and LIMIT/OFFSET. Never fetch the full table and filter in JavaScript.

- **Building SQL strings with concatenation:** Always use Drizzle's query builder or the `sql` template tag with parameter interpolation. Never concatenate user input into SQL strings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL search param parsing/serialization | Custom parser with URLSearchParams | `nuqs` with `parseAsArrayOf`, `parseAsInteger`, `parseAsBoolean` | Type-safe, handles defaults, arrays, debouncing, and server re-renders |
| Table column rendering | Custom `<table>` with manual mapping | `@tanstack/react-table` with shadcn/ui `<Table>` | Column definitions, flexible cell rendering, pagination state, header groups |
| Multi-select filter dropdown | Custom checkbox list | shadcn/ui `Popover` + `Command` pattern | Accessible (Radix primitives), keyboard navigable, searchable |
| Status badge color mapping | Inline ternary chains | Dedicated `StatusBadge` component with `cva` variants | Consistent colors, single source of truth, reusable across phases |
| Date/duration formatting | Inline `new Date().toLocaleString()` | Dedicated `format.ts` utility module | Consistent formatting across all dashboard pages, handles edge cases (running duration, null dates) |
| Loading skeleton | Empty table or spinner | Next.js `loading.tsx` + shadcn/ui `Skeleton` component | Framework-native loading state, no layout shift, skeleton matches final table layout |
| Pagination controls | Custom prev/next buttons | Dedicated `DataTablePagination` component | Page numbers, first/last, per-page size selector, reusable across all table views |

**Key insight:** The conversations list is the first table view in the dashboard but not the last. Every pattern established here (DataTable, toolbar, pagination, skeleton) will be reused by Phase 51+ views. Build reusable components from the start.

## Common Pitfalls

### Pitfall 1: searchParams is a Promise in Next.js 15

**What goes wrong:** TypeScript error or runtime crash when accessing `searchParams.page` directly without awaiting.
**Why it happens:** Next.js 15 changed `searchParams` from a synchronous object to a Promise. Code from Next.js 14 tutorials won't work.
**How to avoid:** Always `await searchParams` at the top of the server component: `const params = await searchParams;`
**Warning signs:** TypeScript error "Property 'page' does not exist on type 'Promise<...>'"

### Pitfall 2: nuqs shallow: false is Required for Server Re-renders

**What goes wrong:** Changing filters in the toolbar updates the URL but the table data doesn't change.
**Why it happens:** nuqs defaults to `shallow: true`, which only updates the URL client-side without notifying the server. The server component doesn't re-render, so data stays stale.
**How to avoid:** Set `shallow: false` in `useQueryStates` options. This triggers a Next.js navigation that re-renders the server component.
**Warning signs:** URL changes but table content stays the same; only full page refresh shows new data.

### Pitfall 3: TanStack Table manualPagination Misconfiguration

**What goes wrong:** Table shows 0 rows or only the first 10 of the 25 returned by the server.
**Why it happens:** Without `manualPagination: true`, TanStack Table applies its own client-side pagination (default 10 rows per page) on top of the already-paginated server data.
**How to avoid:** Always pass `manualPagination: true` and `pageCount: Math.ceil(total / pageSize)` to `useReactTable`.
**Warning signs:** Table shows fewer rows than expected, pagination controls show wrong page count.

### Pitfall 4: COALESCE Missing on Token Aggregation

**What goes wrong:** Token usage shows `null` or `NaN` for conversations that have no `llm.response` events (e.g., conversations that failed before the first LLM call).
**Why it happens:** The LEFT JOIN on the token aggregation subquery returns NULL for conversations with no matching events. Without COALESCE, null propagates to the UI.
**How to avoid:** Use `COALESCE(..., 0)` in the Drizzle query: `sql<number>\`coalesce(${tokenAgg.total_input}, 0)\``
**Warning signs:** "NaN tokens" or blank cells in the token column for failed/queued conversations.

### Pitfall 5: Filter Reset Not Resetting Page

**What goes wrong:** User changes a filter, sees no results because they're on page 5 of a now-smaller result set.
**Why it happens:** Changing a filter (e.g., status) doesn't reset the page number. If the user was on page 5 and the filtered result only has 2 pages, page 5 returns empty.
**How to avoid:** When any filter changes, always reset page to 1. In nuqs: `setFilters({ status: newStatus, page: 1 })`.
**Warning signs:** Empty table after applying a filter that should have results.

### Pitfall 6: Time Range Calculation Timezone Bugs

**What goes wrong:** "Last 24 hours" filter misses recent conversations or includes conversations from outside the range.
**Why it happens:** Computing `new Date(Date.now() - 24 * 60 * 60 * 1000)` in the server component uses the server's timezone. The database stores timestamps `WITH TIME ZONE`. Mismatches between JavaScript Date UTC and Postgres timestamp comparisons can shift the window.
**How to avoid:** Always compute time ranges in UTC and pass them as UTC timestamps. Drizzle handles timezone conversion when the column is defined with `withTimezone: true`.
**Warning signs:** Conversations near the boundary of the time range appear or disappear unexpectedly.

### Pitfall 7: NuqsAdapter Missing in Root Layout

**What goes wrong:** Runtime error "NuqsAdapter not found" or hooks don't work.
**Why it happens:** nuqs requires wrapping the app with `NuqsAdapter` in the root layout. This is easy to forget.
**How to avoid:** Add `<NuqsAdapter>` to `src/app/layout.tsx` wrapping `{children}`. Use the `nuqs/adapters/next/app` import.
**Warning signs:** Error about missing context when using `useQueryState` or `useQueryStates`.

## Code Examples

### Status Badge Component

```typescript
// src/components/conversations/status-badge.tsx
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  running: { label: "Running", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  waiting: { label: "Waiting", className: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}
```

### Column Definitions

```typescript
// src/components/conversations/columns.tsx
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { ConversationListItem } from "@/services/conversations";
import { StatusBadge } from "./status-badge";
import { formatDuration, formatTokenCount, formatRelativeTime } from "@/lib/format";
import { AlertCircle } from "lucide-react";
import Link from "next/link";

export const columns: ColumnDef<ConversationListItem>[] = [
  {
    accessorKey: "agentDefinitionId",
    header: "Agent",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.agentDefinitionId}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "duration",
    header: "Duration",
    cell: ({ row }) => {
      const { createdAt, updatedAt, status } = row.original;
      if (status === "running") return <span className="text-blue-600">Running...</span>;
      return formatDuration(createdAt, updatedAt);
    },
  },
  {
    id: "tokenUsage",
    header: "Tokens",
    cell: ({ row }) => {
      const { tokenInput, tokenOutput } = row.original;
      return formatTokenCount(tokenInput + tokenOutput);
    },
  },
  {
    accessorKey: "lastActivity",
    header: "Last Activity",
    cell: ({ row }) => formatRelativeTime(row.original.lastActivity),
  },
  {
    id: "error",
    header: "",
    cell: ({ row }) => {
      if (row.original.status === "failed") {
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      }
      return null;
    },
  },
];
```

### Formatting Utilities

```typescript
// src/lib/format.ts

export function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens === 0) return "0";
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export function formatRelativeTime(date: Date | null): string {
  if (!date) return "-";
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getTimeRangeDate(range: string): Date {
  const now = new Date();
  switch (range) {
    case "1h": return new Date(now.getTime() - 60 * 60 * 1000);
    case "24h": return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d": return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    default: return new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default: 24h
  }
}
```

### Expanded Conversations Service

```typescript
// src/services/conversations.ts (expanded from Phase 49)
import { sql, and, inArray, gte, lte, eq, desc, count, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, agentEvents, agentSessions, type ConversationStatus } from "@/lib/schema";

export interface ConversationListParams {
  status?: string[];
  agentDefinitionId?: string[];
  timeRange?: { from: Date; to?: Date };
  hasErrors?: boolean;
  limit?: number;
  offset?: number;
}

export interface ConversationListItem {
  id: string;
  agentDefinitionId: string;
  status: string;
  tokenInput: number;
  tokenOutput: number;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date | null;
  errorMessage: string | null;
}

export async function listConversations(
  params: ConversationListParams
): Promise<{ items: ConversationListItem[]; total: number }> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;
  const conditions = buildFilters(params);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Token aggregation subquery
  const tokenAgg = db
    .select({
      conversation_id: agentEvents.conversation_id,
      total_input: sql<number>`coalesce(sum(${agentEvents.token_count_input}), 0)`.as("total_input"),
      total_output: sql<number>`coalesce(sum(${agentEvents.token_count_output}), 0)`.as("total_output"),
    })
    .from(agentEvents)
    .where(eq(agentEvents.type, "llm.response"))
    .groupBy(agentEvents.conversation_id)
    .as("token_agg");

  // Main query
  const rows = await db
    .select({
      id: conversations.id,
      agent_definition_id: conversations.agent_definition_id,
      status: conversations.status,
      error_message: conversations.error_message,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
      last_event_at: agentSessions.last_event_at,
      token_input: sql<number>`coalesce(${tokenAgg.total_input}, 0)`,
      token_output: sql<number>`coalesce(${tokenAgg.total_output}, 0)`,
    })
    .from(conversations)
    .leftJoin(agentSessions, eq(agentSessions.conversation_id, conversations.id))
    .leftJoin(tokenAgg, eq(tokenAgg.conversation_id, conversations.id))
    .where(whereClause)
    .orderBy(desc(conversations.created_at))
    .limit(limit)
    .offset(offset);

  // Total count for pagination
  const [{ total }] = await db
    .select({ total: count() })
    .from(conversations)
    .where(whereClause);

  return {
    items: rows.map((row) => ({
      id: row.id,
      agentDefinitionId: row.agent_definition_id,
      status: row.status,
      tokenInput: Number(row.token_input),
      tokenOutput: Number(row.token_output),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivity: row.last_event_at,
      errorMessage: row.error_message,
    })),
    total: Number(total),
  };
}

function buildFilters(params: ConversationListParams): SQL[] {
  const conditions: SQL[] = [];
  if (params.status?.length) {
    conditions.push(inArray(conversations.status, params.status as ConversationStatus[]));
  }
  if (params.agentDefinitionId?.length) {
    conditions.push(inArray(conversations.agent_definition_id, params.agentDefinitionId));
  }
  if (params.timeRange?.from) {
    conditions.push(gte(conversations.created_at, params.timeRange.from));
  }
  if (params.timeRange?.to) {
    conditions.push(lte(conversations.created_at, params.timeRange.to));
  }
  if (params.hasErrors) {
    conditions.push(eq(conversations.status, "failed" as ConversationStatus));
  }
  return conditions;
}
```

### Loading Skeleton

```typescript
// src/app/conversations/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationsLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-8 w-48" /> {/* Title */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" /> {/* Filter buttons */}
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="rounded-md border">
        <div className="border-b p-4">
          <div className="flex gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b p-4">
            {Array.from({ length: 6 }).map((_, j) => (
              <Skeleton key={j} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Distinct Agent Definition IDs Query

```typescript
// src/services/conversations.ts (addition for filter options)
export async function getDistinctAgentDefinitions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ agentDefinitionId: conversations.agent_definition_id })
    .from(conversations);
  return rows.map((r) => r.agentDefinitionId);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side data fetching (useEffect + fetch) | Server components with searchParams | Next.js 13+ (2023), enforced in 15 (2025) | No loading spinners for initial load, better SEO, less client JS |
| useState for filter state | URL search params via nuqs | nuqs v2 (2024-2025) | Shareable URLs, server-side rendering of filtered state |
| searchParams as sync object | searchParams as Promise | Next.js 15 (2024) | Must await searchParams in server components |
| Custom pagination components | TanStack Table manualPagination + shadcn/ui | TanStack Table v8 (2023+) | Standardized pagination state management |
| HSL color variables | OKLCH color variables | shadcn/ui + Tailwind v4 (2025) | Already set up in Phase 49 globals.css |

**Deprecated/outdated:**
- `getServerSideProps`: Replaced by server components with async data fetching in App Router
- `useRouter().query` for search params: Use `useSearchParams()` or nuqs in App Router
- Client-side only pagination (getPaginationRowModel without manual): Only works when all data is loaded client-side

## Open Questions

1. **Drizzle subquery join type compatibility**
   - What we know: Drizzle's `.as()` subquery pattern works for creating derived tables that can be joined. The token aggregation grouped by `conversation_id` maps cleanly to a subquery join.
   - What's unclear: Whether the `sql<number>` type annotation on the COALESCE expression propagates correctly through the subquery alias and join, or if it needs explicit `.mapWith(Number)` at the output level.
   - Recommendation: Test the query in implementation. If types don't propagate, add `.mapWith(Number)` or `Number()` cast in the service mapping layer (already shown in the code example).

2. **nuqs SSR hydration with Next.js 15.5**
   - What we know: nuqs 2.8+ supports Next.js 15 and App Router. The `NuqsAdapter` wraps the app for context.
   - What's unclear: Whether `shallow: false` causes any hydration mismatch warnings when combined with Suspense boundaries and `loading.tsx`.
   - Recommendation: Test early. If hydration issues occur, the fallback is to read searchParams directly in the server component (already planned) and pass initial values to the client components. nuqs hooks would only manage updates, not initial state.

3. **Row click navigation to conversation detail**
   - What we know: Clicking a row should navigate to `/conversations/[id]`, but the detail page is Phase 51.
   - What's unclear: Whether to implement row click now (navigating to a 404) or defer it.
   - Recommendation: Implement the link on the conversation ID column now using Next.js `<Link>`. It will 404 until Phase 51, but the wiring is in place. This is better than retrofitting click handlers later.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/dashboard/src/` (all files inspected), `packages/agents/src/shared/db/schema.ts`, Phase 49 research/verification/summaries
- [shadcn/ui Data Table Guide](https://ui.shadcn.com/docs/components/data-table) -- column definitions, DataTable component, pagination pattern
- [shadcn/ui Badge Component](https://ui.shadcn.com/docs/components/badge) -- variant API, installation
- [Drizzle ORM Joins](https://orm.drizzle.team/docs/joins) -- leftJoinLateral, subquery join patterns
- [Drizzle ORM Select](https://orm.drizzle.team/docs/select) -- count(), sql template, dynamic filters, subqueries
- [Drizzle ORM sql template](https://orm.drizzle.team/docs/sql) -- sql<T>, COALESCE, column references
- [Next.js searchParams docs](https://nextjs.org/docs/app/api-reference/file-conventions/page) -- async searchParams in Next.js 15
- [Next.js Adding Search and Pagination](https://nextjs.org/learn/dashboard-app/adding-search-and-pagination) -- official tutorial pattern

### Secondary (MEDIUM confidence)
- [nuqs documentation](https://nuqs.dev/) -- NuqsAdapter setup, useQueryStates, parsers, shallow option
- [nuqs GitHub](https://github.com/47ng/nuqs) -- v2.8.8, Next.js 15 support confirmed
- [TanStack Table Controlled Pagination](https://tanstack.com/table/v8/docs/framework/react/examples/pagination-controlled) -- manualPagination pattern
- [Medium: Shadcn DataTable Server Side Pagination](https://medium.com/@destiya.dian/shadcn-datatable-server-side-pagination-on-nextjs-app-router-83a35075c767) -- community pattern verification

### Tertiary (LOW confidence)
- [tablecn by sadmann7](https://github.com/sadmann7/tablecn) -- reference implementation for shadcn table with server-side operations (useful for inspiration but not directly used)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified against official docs, existing codebase inspected, versions confirmed
- Architecture: HIGH -- patterns derived from official Next.js docs, shadcn/ui guide, and Drizzle ORM docs; verified against existing Phase 49 codebase
- Pitfalls: HIGH -- identified from Next.js 15 breaking changes docs, nuqs documentation, and TanStack Table configuration requirements
- Drizzle query: MEDIUM -- LATERAL vs subquery join approach verified in Drizzle docs, but exact type propagation through sql<T> + subquery + COALESCE needs implementation-time validation
- nuqs integration: MEDIUM -- well-documented library but not yet tested in this specific codebase

**Research date:** 2026-02-04
**Valid until:** 2026-03-06 (30 days -- stack is stable, Next.js 15.5.x is in maintenance mode)
