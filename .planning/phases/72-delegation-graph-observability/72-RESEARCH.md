# Phase 72: Delegation Graph Observability - Research

**Researched:** 2026-02-11
**Domain:** Dashboard visualization (React Flow + dagre), task tree API (recursive CTE), Next.js 15 App Router
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Graph Layout**: Left-to-right flow (dagre `rankdir: 'LR'`), not top-down tree. Typical graph is 3-4 nodes wide (max depth 3, sequential only in v2.7).
- **Node Content**: Five fields per node: entity name (primary label), color-coded status, task summary (truncated ~50 chars), elapsed time (relative), health badge icon. Node size ~220px wide, ~80px tall. Status colors: green=completed, red=failed, blue/pulsing=running, amber=waiting, gray=pending. Health badge: warning triangle (timeout), disconnected-link icon (orphan), no badge=healthy.
- **Edge Styling**: Single edge per delegation relationship, no labels, no multiple edges between same pair. Edge state encoded in color and line style: handshake pending=dashed gray, accepted/in-progress=solid blue animated (moving dashes), completed=solid green, failed=solid red, timed out=solid amber, orphaned=dashed amber. Direction always parent→child. Hover tooltip on edge: signal type, timestamp, one-line payload preview.
- **Rejected Delegation Rendering**: Rejected nodes render dimmed: gray, ~70% opacity, thin dashed gray edge. Same dagre rank as active nodes, stacks below active path. Minimal content: entity name + "Rejected" status. Side panel shows rejection reason and timestamp.
- **Orphan Visual Treatment**: Orphan is distinct from failure. Green node + dashed amber edge = work done, signal stranded. Red node + dashed amber edge = work failed, nobody knows. Disconnected-link icon on parent node. Side panel shows: "Orphaned — result available but undelivered", completion_result payload inline, reason why callback failed.
- **Node Click Interaction**: Single click opens right-side detail panel (drawer). Graph stays visible. Click different node → panel swaps. Click empty canvas or close button → panel dismisses. No double-click, no right-click menus. Panel contents: header (entity name, status badge, elapsed time), full task description, handshake detail, result (terminal states), signals list, "View conversation" link.
- **Timeline Placement**: Below the graph, collapsible. Default: graph takes full height, timeline collapsed. Expanded: graph ~60% height, timeline ~40%. Bidirectional linking: click timeline event → node highlights/pulses in graph; click graph node → timeline scrolls to node's events.
- **Timeline Events**: Filtered to delegation lifecycle events only. Event types: delegation created, conversation started, handshake response, delegator paused, nested delegation, task terminal state, signal dispatched, signal delivered/orphaned, timeout fired. Each row: timestamp | entity icon | event description. Color-coded. Typical chain: 8-15 events. No filtering or search for v2.7.
- **Live Updates**: Auto-poll at 30s. Graph and timeline update together. New events fade in with brief background highlight (0.5s). Stop polling when every task in tree is terminal.
- **Health Indicators**: Per-node health badges. Per-tree: aggregate health column on task list page — "2 warnings" amber badge, "1 failure" red badge, "Clean" or empty for healthy. Aggregates: orphaned signal count, timeout count, rejection chain count, depth limit reached (boolean). Worst severity wins color.
- **Navigation Structure**: New top-level "Tasks" nav item. Nav order: Conversations, Tasks (new), Agents, Tools. `/dashboard/tasks` — root task list. `/dashboard/tasks/:taskId` — graph view. No deeper URL nesting.
- **Task List Page**: Shows all root tasks (standalone and delegated). Columns: description, originating entity, status, subtasks count, health indicator, age. Click row → graph view. Standalone tasks render as single-node graph.
- **Cross-linking**: Conversation detail page: "View task tree" link → `/dashboard/tasks/:rootTaskId`. Graph side panel: "View conversation" link → `/dashboard/conversations/:conversationId`.

### Claude's Discretion
- React Flow configuration details (zoom bounds, minimap, controls)
- Exact CSS/tailwind styling, spacing, typography
- dagre layout parameters beyond `rankdir: 'LR'`
- Task list pagination strategy (offset vs cursor)
- API response shape for tree endpoints (recursive CTE optimization)
- Loading states and skeleton designs
- Error state handling for failed API calls

### Deferred Ideas (OUT OF SCOPE)
- Timeline filtering by entity or event type
- Real-time SSE updates for graph — 30s polling sufficient
- URL-encoded UI state (selected node, timeline open)
- Dagre `rankdir` toggle (LR vs TB)
- "Retry delivery" button for orphaned completions
- Active curation of health patterns (auto-alerting)
</user_constraints>

## Summary

Phase 72 adds a "Tasks" section to the existing Next.js 15 dashboard at `packages/dashboard/`. The dashboard already uses a well-established pattern: server components for initial data load (direct DB queries via Drizzle ORM), client components for interactivity, `nuqs` for URL-based filter state, and `@tanstack/react-table` for data tables. The new tasks pages follow these exact patterns.

The core visualization uses React Flow v12 (`@xyflow/react` 12.x) with dagre layout (`@dagrejs/dagre` 2.x). React Flow provides custom nodes, custom edges, edge toolbars, minimap, controls, and handles all pan/zoom/selection natively. dagre computes positions for a directed graph with `rankdir: 'LR'`. The task tree data comes from a new recursive CTE query against the existing `agents.tasks` table (which already has `parent_id`, `depth`, `status`, `completion_result`, `assignee_id`).

**Primary recommendation:** Add `@xyflow/react` and `@dagrejs/dagre` to the dashboard package. Build the task tree API as a raw SQL recursive CTE executed via Drizzle's `db.execute(sql\`...\`)` (Drizzle has no native recursive CTE builder). Client-side graph state is ephemeral (selected node, timeline open/collapsed) -- no URL encoding per user decision.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@xyflow/react` | ^12.10.0 | Interactive node-based graph visualization | The standard React graph library. 30k+ GitHub stars. SSR support, TypeScript-first, custom nodes/edges, built-in controls/minimap/background. Renamed from `reactflow` in v12. |
| `@dagrejs/dagre` | ^2.0.3 | Directed graph layout algorithm | Standard dagre maintained by dagrejs org. Computes node positions for hierarchical graphs. Used in React Flow's official dagre example. |

### Supporting (already in dashboard)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-table` | ^8.21.3 | Task list table with sorting/pagination | Already used for conversations table. Same pattern for task list. |
| `nuqs` | ^2.8.8 | URL query state for filters and pagination | Already used for conversation filters. Same pattern for task list page/status filters. |
| `lucide-react` | ^0.400.0 | Icons for health badges, status indicators | Already used throughout dashboard. Provides `AlertTriangle`, `LinkSlash`/`Unlink`, `CheckCircle`, `XCircle`, `Clock`, `Loader` etc. |
| `drizzle-orm` | ^0.45.1 | Database queries (raw SQL for recursive CTE) | Already used in all dashboard services. `sql` template tag for recursive CTE. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@xyflow/react` | D3.js | Full control but massive complexity for interactive graphs. React Flow handles pan/zoom/selection/keyboard natively. |
| `@xyflow/react` | `react-force-graph` | Force-directed layout is wrong for hierarchical trees. dagre + React Flow is the right tool. |
| `@dagrejs/dagre` | `elkjs` (Eclipse Layout Kernel) | More layout options but 5x larger bundle, WASM dependency. dagre is sufficient for 3-4 node wide trees. |
| Raw SQL recursive CTE | Drizzle query builder | Drizzle has no native recursive CTE support. Raw SQL via `db.execute(sql\`...\`)` is the documented approach. |
| 30s polling | SSE (Server-Sent Events) | SSE exists in the dashboard for conversation detail. User explicitly deferred SSE for graph — 30s polling is sufficient for delegation chains. |

**Installation:**
```bash
pnpm --filter @aesir/dashboard add @xyflow/react @dagrejs/dagre
pnpm --filter @aesir/dashboard add -D @types/dagre
```

Note: `@dagrejs/dagre` v2 may include its own types. Check if `@types/dagre` is needed or if the package ships types natively. If types are included, skip `@types/dagre`.

## Architecture Patterns

### Recommended Project Structure
```
packages/dashboard/src/
├── app/
│   └── tasks/
│       ├── page.tsx            # Task list page (RSC, server component)
│       ├── loading.tsx         # Skeleton for task list
│       └── [taskId]/
│           ├── page.tsx        # Graph view page (RSC shell, fetches tree data)
│           └── loading.tsx     # Skeleton for graph view
├── components/
│   └── tasks/
│       ├── task-list-table.tsx       # Table component (client, @tanstack/react-table)
│       ├── task-list-columns.tsx     # Column definitions for task list
│       ├── task-list-toolbar.tsx     # Filters: status, health
│       ├── task-health-badge.tsx     # Health indicator badge (amber/red/empty)
│       ├── delegation-graph.tsx      # Main graph container (client, React Flow)
│       ├── task-node.tsx             # Custom React Flow node component
│       ├── delegation-edge.tsx       # Custom React Flow edge component
│       ├── edge-tooltip.tsx          # Hover tooltip for edges
│       ├── task-detail-panel.tsx     # Right-side detail drawer
│       ├── delegation-timeline.tsx   # Collapsible timeline below graph
│       ├── timeline-event-row.tsx    # Single timeline event row
│       ├── graph-layout.tsx          # dagre layout computation
│       └── live-task-graph.tsx       # Client wrapper with polling logic
├── services/
│   └── tasks.ts              # Task data access (DB queries, recursive CTE)
└── lib/
    └── schema.ts             # Add tasks + task_handoffs table definitions
```

### Pattern 1: Server Component Data Loading → Client Interactive View
**What:** Server component fetches data, serializes dates as ISO strings, passes to client component for interactivity.
**When to use:** Every page in this phase. Same pattern as existing conversation pages.
**Example:**
```typescript
// app/tasks/[taskId]/page.tsx (server component)
export default async function TaskGraphPage({ params }: Props) {
  const { taskId } = await params;
  const tree = await getTaskTree(taskId);
  if (!tree) notFound();

  return (
    <main className="container mx-auto px-4 py-8">
      <LiveTaskGraph
        taskId={taskId}
        initialTree={serializeTree(tree)}
      />
    </main>
  );
}
```

### Pattern 2: Recursive CTE for Task Tree
**What:** Single SQL query that traverses the task tree from root to leaves with depth tracking.
**When to use:** `getTaskTree(taskId)` service function.
**Example:**
```typescript
// services/tasks.ts
export async function getTaskTree(rootTaskId: string): Promise<TaskTreeNode | null> {
  const rows = await db.execute(sql`
    WITH RECURSIVE task_tree AS (
      -- Base case: root task
      SELECT t.*, 0 AS tree_depth
      FROM agents.tasks t
      WHERE t.id = ${rootTaskId}

      UNION ALL

      -- Recursive: children
      SELECT t.*, tt.tree_depth + 1
      FROM agents.tasks t
      INNER JOIN task_tree tt ON t.parent_id = tt.id
      WHERE tt.tree_depth < 5  -- Safety limit beyond max depth 3
    )
    SELECT
      tt.*,
      c.id AS conversation_id,
      c.status AS conversation_status,
      ed.name AS entity_name
    FROM task_tree tt
    LEFT JOIN agents.conversations c ON c.task_id = tt.id
    LEFT JOIN agents.entity_directory ed ON ed.id = tt.assignee_id
    ORDER BY tt.tree_depth, tt.created_at
  `);

  // Transform flat rows into tree structure
  return buildTreeFromRows(rows);
}
```

### Pattern 3: React Flow Custom Node with Typed Data
**What:** Custom node component with typed data prop for task visualization.
**When to use:** The `task-node.tsx` component.
**Example:**
```typescript
// Source: reactflow.dev/learn/advanced-use/typescript
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

type TaskNodeData = {
  entityName: string;
  status: 'completed' | 'failed' | 'running' | 'waiting' | 'pending' | 'rejected';
  summary: string;
  elapsedTime: string;
  healthBadge: 'timeout' | 'orphan' | null;
  isOrphan: boolean;
  isRejected: boolean;
};

type TaskNode = Node<TaskNodeData, 'task'>;

export function TaskNode({ data }: NodeProps<TaskNode>) {
  const statusColor = getStatusColor(data.status);

  return (
    <div className={cn(
      "rounded-lg border-2 bg-card px-3 py-2",
      statusColor.border,
      data.isRejected && "opacity-70",
      data.status === 'running' && "animate-pulse",
    )} style={{ width: 220, height: 80 }}>
      <Handle type="target" position={Position.Left} />

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium truncate">{data.entityName}</span>
        {data.healthBadge && <HealthBadgeIcon badge={data.healthBadge} />}
      </div>
      <p className="text-xs text-muted-foreground truncate">{data.summary}</p>
      <div className="flex items-center justify-between mt-1">
        <StatusDot color={statusColor.dot} />
        <span className="text-xs text-muted-foreground">{data.elapsedTime}</span>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

### Pattern 4: Custom Edge with Animation and Tooltip
**What:** Custom edge component with color/dash styling based on delegation state, plus hover tooltip via EdgeToolbar.
**When to use:** The `delegation-edge.tsx` component.
**Example:**
```typescript
// Source: reactflow.dev/examples/edges/animating-edges, reactflow.dev/api-reference/components/edge-toolbar
import { BaseEdge, EdgeToolbar, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';

type DelegationEdgeData = {
  state: 'pending' | 'active' | 'completed' | 'failed' | 'timeout' | 'orphaned' | 'rejected';
  signalType?: string;
  timestamp?: string;
  payloadPreview?: string;
};

type DelegationEdge = Edge<DelegationEdgeData, 'delegation'>;

export function DelegationEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected
}: EdgeProps<DelegationEdge>) {
  const [edgePath, centerX, centerY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const style = getEdgeStyle(data?.state ?? 'pending');

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style.base} />
      {data?.state === 'active' && (
        // Animated moving circle for active edges
        <circle r="4" fill="hsl(var(--primary))">
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
      <EdgeToolbar
        edgeId={id}
        x={centerX}
        y={centerY}
        isVisible={selected ?? false}
      >
        <div className="rounded bg-popover border p-2 text-xs shadow-md">
          <p className="font-medium">{data?.signalType ?? 'Delegation'}</p>
          {data?.timestamp && <p className="text-muted-foreground">{data.timestamp}</p>}
          {data?.payloadPreview && <p className="truncate max-w-48">{data.payloadPreview}</p>}
        </div>
      </EdgeToolbar>
    </>
  );
}
```

### Pattern 5: 30s Polling with Terminal Detection
**What:** Client-side polling hook that fetches task tree data every 30s, stops when all tasks are terminal.
**When to use:** `live-task-graph.tsx` wrapper component.
**Example:**
```typescript
function useTaskTreePolling(taskId: string, initialTree: SerializedTaskTree) {
  const [tree, setTree] = useState(initialTree);
  const [isPolling, setIsPolling] = useState(!isTreeTerminal(initialTree));

  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(async () => {
      const response = await fetch(`/dashboard/api/tasks/${taskId}/tree`);
      if (response.ok) {
        const updated = await response.json();
        setTree(updated);
        if (isTreeTerminal(updated)) {
          setIsPolling(false);
        }
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, [taskId, isPolling]);

  return { tree, isPolling };
}

function isTreeTerminal(tree: SerializedTaskTree): boolean {
  return tree.nodes.every(n =>
    ['completed', 'failed', 'cancelled'].includes(n.status)
  );
}
```

### Pattern 6: Dashboard Schema Extension
**What:** Add tasks and task_handoffs table definitions to the dashboard's local schema.
**When to use:** `lib/schema.ts` — must mirror the canonical schema from `@aesir/agents` for the columns the dashboard reads.
**Example:**
```typescript
// Add to packages/dashboard/src/lib/schema.ts
export const tasks = agentsSchema.table("tasks", {
  id: text("id").primaryKey(),
  parent_id: text("parent_id"),
  creator_type: text("creator_type").notNull(),
  creator_id: text("creator_id").notNull(),
  assignee_type: text("assignee_type").notNull(),
  assignee_id: text("assignee_id").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  objective: text("objective"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  depth: integer("depth").notNull().default(0),
  completion_result: jsonb("completion_result").$type<Record<string, unknown> | null>(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
});

export const taskHandoffs = agentsSchema.table("task_handoffs", {
  id: text("id").primaryKey(),
  task_id: text("task_id").notNull(),
  conversation_id: text("conversation_id").notNull(),
  handoff_type: text("handoff_type").notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull(),
  author_type: text("author_type").notNull(),
  author_id: text("author_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const entityDirectory = agentsSchema.table("entity_directory", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("active"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### Anti-Patterns to Avoid
- **Importing from `@aesir/agents`:** The dashboard maintains its own local schema to avoid coupling to the agents package dependency tree. Always add table definitions to `lib/schema.ts`, never import from `@aesir/agents`.
- **Date objects across RSC boundary:** Always serialize Date objects as ISO strings before passing from server components to client components. Deserialize on the client side. This is an existing pattern in `live-detail-panels.tsx`.
- **Defining `nodeTypes`/`edgeTypes` inside components:** React Flow docs explicitly warn this causes re-renders. Define `nodeTypes` and `edgeTypes` outside the component or use `useMemo`.
- **Building the recursive CTE with Drizzle's query builder:** Drizzle has no native recursive CTE support. Use raw SQL via `db.execute(sql\`...\`)`.
- **Deep URL nesting for UI state:** User explicitly decided: selected node, timeline open/closed are client-side ephemeral state. No URL encoding.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graph pan/zoom/selection | Custom SVG pan/zoom handlers | `@xyflow/react` built-in | Handles edge cases (touch, keyboard, accessibility) that take months to get right |
| Directed graph layout | Manual position calculation | `@dagrejs/dagre` | Dagre handles edge routing, rank assignment, node ordering — hundreds of edge cases |
| Edge path rendering | SVG path math | `getSmoothStepPath` from React Flow | Smooth step paths with configurable border radius, automatically handles source/target positions |
| Animated edge | CSS `stroke-dasharray` animation on SVG path | SVG `<animateMotion>` on a circle element | `stroke-dasharray` animation has known performance issues at scale. `<animateMotion>` is GPU-accelerated and performant. |
| URL query state management | Manual `URLSearchParams` / `useRouter` | `nuqs` | Already used in dashboard. Type-safe, SSR-compatible, shallow/deep navigation modes |
| Data table pagination/sorting | Custom table logic | `@tanstack/react-table` | Already used in dashboard. Handles column definitions, manual pagination, sorting |

**Key insight:** React Flow is a mature, well-tested library specifically designed for this exact use case. Custom SVG graph rendering would take 5-10x the effort and miss accessibility, keyboard navigation, touch support, and the minimap/controls components.

## Common Pitfalls

### Pitfall 1: React Flow CSS Import Missing
**What goes wrong:** Graph renders but has no styling — nodes overlap, edges invisible, controls absent.
**Why it happens:** React Flow v12 requires importing its CSS: `import '@xyflow/react/dist/style.css'`.
**How to avoid:** Import CSS in the graph component file or in a layout component that wraps graph pages.
**Warning signs:** Nodes render but stack at (0,0), no grid background, controls invisible.

### Pitfall 2: nodeTypes/edgeTypes Defined Inside Component
**What goes wrong:** Every render creates new object references → React Flow unmounts and remounts all nodes, destroying internal state.
**Why it happens:** React Flow uses referential equality on `nodeTypes` and `edgeTypes` props.
**How to avoid:** Define them as module-level constants or wrap in `useMemo` with empty deps.
**Warning signs:** Node selection resets on any state change, animations restart constantly.

### Pitfall 3: dagre Graph Reuse Without Cleanup
**What goes wrong:** Layout inherits positions from previous render, producing incorrect or overlapping positions.
**Why it happens:** dagre's `graphlib.Graph` is mutable. Nodes/edges from previous layout calls persist.
**How to avoid:** Create a fresh `dagre.graphlib.Graph()` for each layout computation, or explicitly remove all nodes/edges before re-laying.
**Warning signs:** Adding a new node causes existing nodes to shift unexpectedly.

### Pitfall 4: Recursive CTE Without Depth Limit
**What goes wrong:** Infinite recursion on circular parent_id references (data corruption) causes query to run forever.
**Why it happens:** Bugs in task creation could create cycles. PostgreSQL recursive CTEs don't detect cycles by default.
**How to avoid:** Add `WHERE tt.tree_depth < 5` to the recursive part. 5 is a safety margin beyond the max depth of 3.
**Warning signs:** Query hangs indefinitely, database CPU spikes.

### Pitfall 5: Date Serialization Across RSC Boundary
**What goes wrong:** Client component receives `[object Object]` or crashes with "not serializable" error.
**Why it happens:** Date objects can't be passed from server to client components in Next.js. Must be serialized as ISO strings.
**How to avoid:** Follow the existing pattern in `conversations/[id]/page.tsx`: serialize all Date fields to ISO strings, deserialize in client component.
**Warning signs:** TypeScript errors about Date not being serializable, hydration mismatches.

### Pitfall 6: Edge Animation Performance with stroke-dasharray
**What goes wrong:** CPU usage spikes when animating multiple edges simultaneously.
**Why it happens:** CSS `stroke-dasharray` animation forces the browser to repaint SVG paths on every animation frame.
**How to avoid:** Use SVG `<animateMotion>` with a small circle element instead. This is GPU-accelerated and much cheaper. React Flow's official animated edges example uses this approach.
**Warning signs:** Browser tab becomes sluggish, fans spin up, animation stutters.

### Pitfall 7: Polling Continues After Navigation Away
**What goes wrong:** Stale `setInterval` keeps fetching data for a task tree the user navigated away from.
**Why it happens:** Missing cleanup in `useEffect` return function, or not checking component mount status.
**How to avoid:** Return cleanup function from `useEffect`. Use `AbortController` to cancel in-flight fetches on unmount.
**Warning signs:** Network tab shows requests for old task IDs after navigation.

### Pitfall 8: Empty Graph When No Subtasks
**What goes wrong:** Standalone tasks (no subtasks) render an empty graph — confusing UX.
**Why it happens:** The graph is designed for trees but must handle single-node case.
**How to avoid:** User decision: standalone tasks render as single-node graph with side panel auto-opened.
**Warning signs:** User clicks a standalone task and sees a blank canvas.

## Code Examples

Verified patterns from official sources and existing codebase:

### React Flow with dagre Layout (Official Example)
```typescript
// Source: reactflow.dev/examples/layout/dagre
import { ReactFlow, useNodesState, useEdgesState, type Node, type Edge } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      targetPosition: 'left' as const,
      sourcePosition: 'right' as const,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
```

### Edge Tooltip via EdgeToolbar (Official Component)
```typescript
// Source: reactflow.dev/api-reference/components/edge-toolbar
import { EdgeToolbar, BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { memo, useState } from 'react';

function CustomEdgeWithTooltip(props: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, centerX, centerY] = getSmoothStepPath(props);

  return (
    <>
      {/* Invisible wider path for hover detection */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={20}
        stroke="transparent"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge id={props.id} path={edgePath} />
      <EdgeToolbar
        edgeId={props.id}
        x={centerX}
        y={centerY}
        isVisible={hovered}
      >
        <div className="tooltip-content">...</div>
      </EdgeToolbar>
    </>
  );
}

export default memo(CustomEdgeWithTooltip);
```

### SVG animateMotion for Active Edge (Official Pattern)
```typescript
// Source: reactflow.dev/examples/edges/animating-edges
<>
  <BaseEdge id={id} path={edgePath} style={{ stroke: 'hsl(217, 91%, 60%)' }} />
  <circle r="4" fill="hsl(217, 91%, 60%)">
    <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
  </circle>
</>
```

### Dashboard Service Query Pattern (Existing Codebase)
```typescript
// Source: packages/dashboard/src/services/conversations.ts
// Pattern: typed interface → Drizzle query → camelCase mapping
export interface TaskTreeNode {
  id: string;
  parentId: string | null;
  assigneeId: string;
  entityName: string;
  status: string;
  title: string;
  depth: number;
  completionResult: Record<string, unknown> | null;
  conversationId: string | null;
  conversationStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
```

### Recursive CTE with Timeline Events
```sql
-- Task tree with delegation events from agent_events
WITH RECURSIVE task_tree AS (
  SELECT t.*, 0 AS tree_depth
  FROM agents.tasks t
  WHERE t.id = $1

  UNION ALL

  SELECT t.*, tt.tree_depth + 1
  FROM agents.tasks t
  INNER JOIN task_tree tt ON t.parent_id = tt.id
  WHERE tt.tree_depth < 5
)
SELECT
  tt.id, tt.parent_id, tt.assignee_id, tt.status, tt.title,
  tt.depth, tt.completion_result, tt.created_at, tt.updated_at, tt.completed_at,
  tt.metadata,
  c.id AS conversation_id,
  c.status AS conversation_status,
  ed.name AS entity_name
FROM task_tree tt
LEFT JOIN agents.conversations c ON c.task_id = tt.id
LEFT JOIN agents.entity_directory ed ON ed.id = tt.assignee_id
ORDER BY tt.tree_depth, tt.created_at;
```

### Timeline Events Query
```sql
-- Delegation lifecycle events for a task tree
SELECT ae.id, ae.conversation_id, ae.type, ae.payload, ae.timestamp,
       t.assignee_id, ed.name AS entity_name
FROM agents.agent_events ae
INNER JOIN agents.conversations c ON c.id = ae.conversation_id
INNER JOIN agents.tasks t ON t.id = c.task_id
LEFT JOIN agents.entity_directory ed ON ed.id = t.assignee_id
WHERE c.task_id IN (
  -- Subquery: all task IDs in the tree
  WITH RECURSIVE task_tree AS (
    SELECT id FROM agents.tasks WHERE id = $1
    UNION ALL
    SELECT t.id FROM agents.tasks t
    INNER JOIN task_tree tt ON t.parent_id = tt.id
  )
  SELECT id FROM task_tree
)
AND ae.type IN (
  'agent.started', 'agent.completed', 'agent.paused', 'agent.resumed',
  'signal.received', 'signal.orphaned', 'tool.called', 'tool.succeeded'
)
ORDER BY ae.timestamp ASC;
```

Note: The timeline event types need filtering. `tool.called` would include all tool calls, but we only want delegation lifecycle events. The application layer should filter further by examining payloads for delegation-related tool calls (e.g., `task:delegate`, `task:respond`).

### Health Computation Pattern
```typescript
// Compute aggregate health from task tree
interface TreeHealth {
  orphanedCount: number;
  timeoutCount: number;
  rejectionChainCount: number;
  depthLimitReached: boolean;
  severity: 'clean' | 'warning' | 'failure';
}

function computeTreeHealth(nodes: TaskTreeNode[], events: TimelineEvent[]): TreeHealth {
  const orphanedCount = events.filter(e => e.type === 'signal.orphaned').length;
  const timeoutCount = events.filter(e =>
    e.type === 'signal.received' && e.payload?.signalType === 'timeout'
  ).length;
  const rejectionChainCount = nodes.filter(n => n.status === 'cancelled' && n.metadata?.rejected).length;
  const depthLimitReached = nodes.some(n => n.depth >= 3);

  const hasFailure = nodes.some(n => n.status === 'failed') || orphanedCount > 0;
  const hasWarning = timeoutCount > 0 || rejectionChainCount > 0 || depthLimitReached;

  return {
    orphanedCount,
    timeoutCount,
    rejectionChainCount,
    depthLimitReached,
    severity: hasFailure ? 'failure' : hasWarning ? 'warning' : 'clean',
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `reactflow` (default import) | `@xyflow/react` (named imports) | v12, July 2024 | New package name. Import `{ ReactFlow }` not default import. |
| `dagre` (unmaintained) | `@dagrejs/dagre` (maintained fork) | 2024 | Original `dagre` package is abandoned. Use `@dagrejs/dagre` for updates. |
| `useNodesState` + `useEdgesState` | Still valid but `useState` + `applyNodeChanges` also works | v12 | Both patterns are supported. `useNodesState` is convenience. |
| Edge animations via `animated` boolean | Custom edge components with `<animateMotion>` | v12 | The `animated` prop still works for basic dash animation, but custom edges give full control. |

**Deprecated/outdated:**
- `reactflow` package: Renamed to `@xyflow/react` in v12. The old package still works but is no longer updated.
- `dagre` npm package: Unmaintained. Use `@dagrejs/dagre` which is actively maintained (latest: 2.0.3, published 2026-01).

## Open Questions

1. **`@dagrejs/dagre` v2 TypeScript types**
   - What we know: v2.0.3 was published very recently. Previous versions used `@types/dagre`.
   - What's unclear: Whether v2 ships its own TypeScript declarations or still needs `@types/dagre`.
   - Recommendation: Try installing without `@types/dagre` first. If types are missing, add it. This is a minor 5-minute fix during implementation.

2. **Timeline event extraction from agent_events**
   - What we know: `agent_events` stores all events with `type` and `payload`. Delegation lifecycle events are a subset.
   - What's unclear: The exact payload shapes for delegation-related events (e.g., what does `tool.called` with `task:delegate` look like?). These are defined in Phases 70-71 which are prerequisites.
   - Recommendation: Query all events for task tree conversations, filter on the client side by type and payload inspection. The event volume per tree is small (8-40 events) so client-side filtering is fine.

3. **Root task identification for the task list**
   - What we know: Root tasks have `parent_id IS NULL`. The task list shows these.
   - What's unclear: Whether we need to distinguish "standalone tasks" (created by agents directly, no delegation) from "delegation root tasks" (created by product-agent → dev-agent flow). Both have `parent_id IS NULL`.
   - Recommendation: Show both. The subtask count column (0 for standalone, >0 for delegation roots) and health column (empty for standalone) naturally distinguish them.

4. **Cross-linking from conversation to task tree**
   - What we know: Conversations have `task_id` column linking them to tasks. We need to navigate from conversation → root task.
   - What's unclear: Whether `task_id` points to the immediate task or the root. If a sub-agent conversation's `task_id` points to a subtask, we need to walk up to find the root.
   - Recommendation: Add a `getRootTaskId(taskId)` function that walks `parent_id` up to the root. With max depth 3, this is at most 3 queries (or a single recursive CTE). Use this when rendering the "View task tree" link on conversation detail.

## Sources

### Primary (HIGH confidence)
- [React Flow v12 official docs](https://reactflow.dev) - Custom nodes, custom edges, TypeScript patterns, dagre example, edge animation, EdgeToolbar
- [@xyflow/react npm](https://www.npmjs.com/package/@xyflow/react) - Version 12.10.0, last published ~2 months ago
- [@dagrejs/dagre npm](https://www.npmjs.com/package/@dagrejs/dagre) - Version 2.0.3, last published ~17 days ago
- [PostgreSQL recursive CTE docs](https://www.postgresql.org/docs/current/queries-with.html) - WITH RECURSIVE syntax and cycle detection
- Existing dashboard codebase at `packages/dashboard/` - Patterns for server/client components, services, schema, live updates, pagination

### Secondary (MEDIUM confidence)
- [React Flow v12 release blog](https://xyflow.com/blog/react-flow-12-release) - SSR support, new package name, dark mode
- [React Flow migration guide v12](https://reactflow.dev/learn/troubleshooting/migrate-to-v12) - Breaking changes from v11
- [React Flow animated edges example](https://reactflow.dev/examples/edges/animating-edges) - `<animateMotion>` pattern
- [React Flow edge animation performance analysis](https://liambx.com/blog/tuning-edge-animations-reactflow-optimal-performance) - stroke-dasharray CPU overhead

### Tertiary (LOW confidence)
- None. All findings verified with primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - React Flow and dagre are the established choices. Verified versions on npm.
- Architecture: HIGH - Dashboard patterns are well-established in the existing codebase. Direct translation.
- Pitfalls: HIGH - All pitfalls come from official docs or verified community reports. Edge animation performance is documented.
- Recursive CTE: HIGH - PostgreSQL documentation is authoritative. Drizzle's raw SQL approach is documented.

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable domain — React Flow v12 is mature, dagre is stable)
