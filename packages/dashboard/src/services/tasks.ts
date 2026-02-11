/**
 * Tasks Service
 *
 * Abstracts all task-related database queries behind typed functions.
 * Provides recursive CTE queries for task tree traversal, timeline events,
 * health computation, and root task listing.
 *
 * This service layer runs server-side only (Next.js server components / API routes).
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskTreeNode {
  id: string;
  parentId: string | null;
  creatorId: string;
  assigneeId: string;
  entityName: string | null;
  status: string;
  title: string;
  objective: string | null;
  depth: number;
  completionResult: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  conversationId: string | null;
  conversationStatus: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TimelineEvent {
  id: string;
  conversationId: string;
  taskId: string | null;
  entityName: string | null;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface RootTaskListItem {
  id: string;
  title: string;
  status: string;
  creatorEntityName: string | null;
  subtaskCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type TreeHealthSeverity = "failure" | "warning" | "clean";

export interface TreeHealth {
  orphanedCount: number;
  timeoutCount: number;
  rejectionChainCount: number;
  depthLimitReached: boolean;
  severity: TreeHealthSeverity;
}

export interface TaskListParams {
  status?: string[];
  limit?: number;
  offset?: number;
}

// ─── Task Tree ───────────────────────────────────────────────────────────────

/**
 * Get the full task tree starting from a root task ID.
 *
 * Uses a recursive CTE to traverse the task hierarchy up to depth 5.
 * Returns a flat array of TaskTreeNode -- the client builds the tree from parentId.
 * LEFT JOINs conversations and entity_directory for enrichment.
 */
export async function getTaskTree(rootTaskId: string): Promise<TaskTreeNode[]> {
  const rows = await db.execute(sql`
    WITH RECURSIVE task_tree AS (
      SELECT t.*, 0 AS tree_depth
      FROM agents.tasks t
      WHERE t.id = ${rootTaskId}
      UNION ALL
      SELECT child.*, tt.tree_depth + 1
      FROM agents.tasks child
      INNER JOIN task_tree tt ON child.parent_id = tt.id
      WHERE tt.tree_depth < 5
    )
    SELECT
      tt.id,
      tt.parent_id,
      tt.creator_id,
      tt.assignee_id,
      ed.name AS entity_name,
      tt.status,
      tt.title,
      tt.objective,
      tt.depth,
      tt.completion_result,
      tt.metadata,
      c.id AS conversation_id,
      c.status AS conversation_status,
      tt.created_at,
      tt.updated_at,
      tt.completed_at
    FROM task_tree tt
    LEFT JOIN agents.conversations c ON c.task_id = tt.id
    LEFT JOIN agents.entity_directory ed ON ed.id = tt.assignee_id
    ORDER BY tt.depth, tt.created_at
  `);

  return rows.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    parentId: (row.parent_id as string) ?? null,
    creatorId: row.creator_id as string,
    assigneeId: row.assignee_id as string,
    entityName: (row.entity_name as string) ?? null,
    status: row.status as string,
    title: row.title as string,
    objective: (row.objective as string) ?? null,
    depth: Number(row.depth),
    completionResult:
      (row.completion_result as Record<string, unknown>) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    conversationId: (row.conversation_id as string) ?? null,
    conversationStatus: (row.conversation_status as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    completedAt: row.completed_at
      ? (row.completed_at as Date).toISOString()
      : null,
  }));
}

// ─── Timeline Events ─────────────────────────────────────────────────────────

/**
 * Lifecycle event types relevant to task delegation timeline.
 */
const TIMELINE_EVENT_TYPES = [
  "agent.started",
  "agent.completed",
  "agent.paused",
  "agent.resumed",
  "signal.received",
  "signal.orphaned",
  "tool.called",
  "tool.succeeded",
] as const;

/**
 * Tool names relevant to delegation timeline (filtered in application code).
 */
const DELEGATION_TOOL_NAMES = new Set([
  "task:delegate",
  "task:respond",
  "task:complete",
  "wait_for_task",
]);

/**
 * Get delegation lifecycle events for a set of task IDs.
 *
 * Queries agent_events for conversations associated with the given tasks.
 * Filters to lifecycle and delegation-related events.
 * Tool events are further filtered in application code to delegation tools only.
 */
export async function getTaskTimeline(
  taskIds: string[],
): Promise<TimelineEvent[]> {
  if (taskIds.length === 0) return [];

  const rows = await db.execute(sql`
    SELECT
      ae.id,
      ae.conversation_id,
      c.task_id,
      ed.name AS entity_name,
      ae.type,
      ae.payload,
      ae.timestamp
    FROM agents.agent_events ae
    INNER JOIN agents.conversations c ON c.id = ae.conversation_id
    LEFT JOIN agents.tasks t ON t.id = c.task_id
    LEFT JOIN agents.entity_directory ed ON ed.id = t.assignee_id
    WHERE c.task_id = ANY(${taskIds})
      AND ae.type = ANY(${TIMELINE_EVENT_TYPES as unknown as string[]})
    ORDER BY ae.timestamp ASC
  `);

  // Filter tool events to delegation-related tools only
  return rows.rows
    .map((row: Record<string, unknown>) => ({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      taskId: (row.task_id as string) ?? null,
      entityName: (row.entity_name as string) ?? null,
      type: row.type as string,
      payload: (row.payload as Record<string, unknown>) ?? {},
      timestamp: (row.timestamp as Date).toISOString(),
    }))
    .filter((event) => {
      // Keep all non-tool events
      if (!event.type.startsWith("tool.")) return true;
      // For tool events, only keep delegation-related tools
      const toolName = event.payload.toolName as string | undefined;
      return toolName ? DELEGATION_TOOL_NAMES.has(toolName) : false;
    });
}

// ─── Root Task List ──────────────────────────────────────────────────────────

/**
 * List root tasks (tasks with no parent) with pagination.
 *
 * Enriches each task with creator entity name and subtask count.
 * Returns serialized dates as ISO strings for client component consumption.
 */
export async function listRootTasks(
  params: TaskListParams = {},
): Promise<{ items: RootTaskListItem[]; total: number }> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const statusFilter = params.status?.length
    ? sql`AND t.status = ANY(${params.status})`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      t.id,
      t.title,
      t.status,
      ed.name AS creator_entity_name,
      (SELECT count(*) FROM agents.tasks WHERE parent_id = t.id)::int AS subtask_count,
      t.created_at,
      t.updated_at,
      t.completed_at
    FROM agents.tasks t
    LEFT JOIN agents.entity_directory ed ON ed.id = t.creator_id
    WHERE t.parent_id IS NULL
    ${statusFilter}
    ORDER BY t.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countResult = await db.execute(sql`
    SELECT count(*)::int AS total
    FROM agents.tasks t
    WHERE t.parent_id IS NULL
    ${statusFilter}
  `);

  const total = (countResult.rows[0] as { total: number })?.total ?? 0;

  return {
    items: rows.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      title: row.title as string,
      status: row.status as string,
      creatorEntityName: (row.creator_entity_name as string) ?? null,
      subtaskCount: Number(row.subtask_count),
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
      completedAt: row.completed_at
        ? (row.completed_at as Date).toISOString()
        : null,
    })),
    total: Number(total),
  };
}

// ─── Health Computation ──────────────────────────────────────────────────────

/**
 * Compute health indicators for a task tree.
 *
 * Pure function -- no database access. Analyzes nodes and events to determine:
 * - orphanedCount: signals lost to terminal conversations
 * - timeoutCount: delegation timeouts
 * - rejectionChainCount: rejected delegations
 * - depthLimitReached: any node at depth >= 5
 * - severity: worst-case indicator (failure > warning > clean)
 */
export function computeTreeHealth(
  nodes: TaskTreeNode[],
  events: TimelineEvent[],
): TreeHealth {
  const orphanedCount = events.filter(
    (e) => e.type === "signal.orphaned",
  ).length;

  const timeoutCount = events.filter(
    (e) =>
      e.type === "signal.received" &&
      (e.payload as Record<string, unknown>)?.signalType === "timeout",
  ).length;

  const rejectionChainCount = nodes.filter((n) => {
    const metadata = n.metadata as Record<string, unknown> | null;
    if (metadata?.rejected === true) return true;
    if (n.status === "cancelled" && metadata?.rejectionReason) return true;
    return false;
  }).length;

  const depthLimitReached = nodes.some((n) => n.depth >= 5);

  const hasFailures =
    nodes.some(
      (n) => n.status === "failed" || n.conversationStatus === "failed",
    ) || orphanedCount > 0;

  const hasWarnings =
    timeoutCount > 0 || rejectionChainCount > 0 || depthLimitReached;

  let severity: TreeHealthSeverity = "clean";
  if (hasFailures) severity = "failure";
  else if (hasWarnings) severity = "warning";

  return {
    orphanedCount,
    timeoutCount,
    rejectionChainCount,
    depthLimitReached,
    severity,
  };
}

// ─── Root Task ID ────────────────────────────────────────────────────────────

/**
 * Walk parent_id up to find the root task ID.
 *
 * Uses a simple recursive CTE to traverse the task hierarchy upward.
 * Returns the root task ID (where parent_id IS NULL).
 */
export async function getRootTaskId(taskId: string): Promise<string> {
  const rows = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id
      FROM agents.tasks
      WHERE id = ${taskId}
      UNION ALL
      SELECT t.id, t.parent_id
      FROM agents.tasks t
      INNER JOIN ancestors a ON t.id = a.parent_id
    )
    SELECT id
    FROM ancestors
    WHERE parent_id IS NULL
    LIMIT 1
  `);

  const root = rows.rows[0] as { id: string } | undefined;
  return root?.id ?? taskId;
}

// ─── Batch Health ────────────────────────────────────────────────────────────

/**
 * Compute health for multiple root tasks in batch.
 *
 * For each root ID, gets the task tree and timeline events, then computes health.
 * Returns a Map keyed by root task ID for efficient lookup in the task list page.
 */
export async function getTreeHealthForRoots(
  rootTaskIds: string[],
): Promise<Map<string, TreeHealth>> {
  const healthMap = new Map<string, TreeHealth>();
  if (rootTaskIds.length === 0) return healthMap;

  // Process in parallel for efficiency
  await Promise.all(
    rootTaskIds.map(async (rootId) => {
      const nodes = await getTaskTree(rootId);
      const taskIds = nodes.map((n) => n.id);
      const events = await getTaskTimeline(taskIds);
      healthMap.set(rootId, computeTreeHealth(nodes, events));
    }),
  );

  return healthMap;
}
