/**
 * Graph Utilities
 *
 * Pure functions for transforming task tree data into graph representation.
 * Extracted from delegation-graph.tsx to enable testing without React/React Flow dependencies.
 *
 * These functions are the logic core of the delegation graph visualization:
 * - Node status mapping (task status -> visual status)
 * - Edge state derivation (child status + events -> edge visual state)
 * - Health badge detection (orphan/timeout indicators per node)
 * - Tree-to-graph transformation (flat task nodes -> positioned graph elements)
 */

import type { TaskTreeNode, TimelineEvent, TreeHealth } from "@/services/tasks";

// ─── Re-export Types ─────────────────────────────────────────────────────────

/** Visual status for a task node in the graph */
export type NodeStatus =
  | "completed"
  | "failed"
  | "running"
  | "waiting"
  | "pending"
  | "rejected";

/** Health badge indicator for a task node */
export type HealthBadge = "timeout" | "orphan" | null;

/** Visual state for a delegation edge */
export type EdgeState =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "timeout"
  | "orphaned"
  | "rejected";

/** Node data for graph rendering */
export interface GraphNodeData {
  entityName: string;
  status: NodeStatus;
  summary: string;
  elapsedTime: string;
  healthBadge: HealthBadge;
  isRejected: boolean;
}

/** Group node data for graph rendering */
export interface GraphGroupNodeData {
  groupId: string;
  policyType: string;
  policyThreshold?: number;
  groupStatus: string;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  total: number;
}

/** Edge data for graph rendering */
export interface GraphEdgeData {
  state: EdgeState;
  signalType?: string;
  timestamp?: string;
  payloadPreview?: string;
}

/** A positioned graph node (framework-agnostic) */
export interface GraphNode {
  id: string;
  type: "task" | "group";
  position: { x: number; y: number };
  data: GraphNodeData | GraphGroupNodeData;
}

/** A graph edge (framework-agnostic) */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "delegation";
  data: GraphEdgeData;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

export function getElapsedTime(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}...`;
}

export function getNodeStatus(node: TaskTreeNode): NodeStatus {
  if (node.status === "cancelled") {
    const metadata = node.metadata as Record<string, unknown> | null;
    if (metadata?.rejected === true || metadata?.rejectionReason) {
      return "rejected";
    }
    return "pending";
  }
  if (node.status === "active") return "running";
  if (node.status === "completed") return "completed";
  if (node.status === "created") return "pending";
  if (node.status === "paused") return "waiting";
  return "pending";
}

export function getHealthBadge(
  node: TaskTreeNode,
  events: TimelineEvent[],
): HealthBadge {
  // Check for orphaned signals targeting this task
  const hasOrphan = events.some(
    (e) => e.type === "signal.orphaned" && e.taskId === node.id,
  );
  if (hasOrphan) return "orphan";

  // Check for timeout signals
  const hasTimeout = events.some(
    (e) =>
      e.type === "signal.received" &&
      e.taskId === node.id &&
      (e.payload as Record<string, unknown>)?.signalType === "timeout",
  );
  if (hasTimeout) return "timeout";

  return null;
}

export function getEdgeState(
  child: TaskTreeNode,
  events: TimelineEvent[],
): EdgeState {
  const metadata = child.metadata as Record<string, unknown> | null;
  const isRejected =
    child.status === "cancelled" &&
    (metadata?.rejected === true || !!metadata?.rejectionReason);

  if (isRejected) return "rejected";

  // Check for timeout
  const hasTimeout = events.some(
    (e) =>
      e.type === "signal.received" &&
      e.taskId === child.id &&
      (e.payload as Record<string, unknown>)?.signalType === "timeout",
  );
  if (hasTimeout) return "timeout";

  if (child.status === "created") return "pending";
  if (child.status === "active") return "active";

  // Check for orphaned signals
  const hasOrphan = events.some(
    (e) => e.type === "signal.orphaned" && e.taskId === child.id,
  );

  if (child.status === "completed" && hasOrphan) return "orphaned";
  if (child.status === "completed") return "completed";
  if (child.status === "cancelled") return "pending";

  // Fallback: check conversation status
  if (child.conversationStatus === "failed") return "failed";

  return "pending";
}

// ─── Tree-to-Graph Transformation ────────────────────────────────────────────

/**
 * Build a delegation edge for a child task (or from delegator to group node).
 */
function buildDelegationEdge(
  sourceId: string,
  targetId: string,
  child: TaskTreeNode,
  events: TimelineEvent[],
): GraphEdge {
  const state = getEdgeState(child, events);

  // Find delegation tool event for this edge
  // Events may store tool name as tool_name (snake_case) or toolName (camelCase)
  const delegationEvent = events.find((e) => {
    if (e.type !== "tool.called") return false;
    if (e.taskId !== child.parentId) return false;
    const p = e.payload as Record<string, unknown>;
    const tn =
      (p?.tool_name as string | undefined) ??
      (p?.toolName as string | undefined);
    return (
      tn === "delegate_task" ||
      tn === "task:delegate" ||
      tn === "delegate_group" ||
      tn === "task:delegate_group"
    );
  });

  return {
    id: `${sourceId}-${targetId}`,
    source: sourceId,
    target: targetId,
    type: "delegation" as const,
    data: {
      state,
      signalType: delegationEvent
        ? "delegation"
        : state === "completed"
          ? "completion"
          : undefined,
      timestamp: delegationEvent?.timestamp ?? child.createdAt,
      payloadPreview: delegationEvent
        ? truncate(
            JSON.stringify(
              (delegationEvent.payload as Record<string, unknown>)
                ?.arguments ?? {},
            ),
            80,
          )
        : undefined,
    },
  };
}

/**
 * Compute status counts for a set of grouped tasks.
 */
function computeGroupCounts(tasks: TaskTreeNode[]): {
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  total: number;
} {
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let running = 0;
  for (const t of tasks) {
    if (t.status === "completed") completed++;
    else if (t.status === "cancelled") cancelled++;
    else if (t.status === "active") running++;
    else if (t.conversationStatus === "failed") failed++;
  }
  return { completed, failed, cancelled, running, total: tasks.length };
}

export function transformTreeToGraph(
  nodes: TaskTreeNode[],
  events: TimelineEvent[],
  _health: TreeHealth,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Detect groups: tasks sharing the same non-null groupId
  const groupMap = new Map<string, TaskTreeNode[]>();
  const groupedTaskIds = new Set<string>();

  for (const node of nodes) {
    if (node.groupId) {
      const existing = groupMap.get(node.groupId);
      if (existing) {
        existing.push(node);
      } else {
        groupMap.set(node.groupId, [node]);
      }
      groupedTaskIds.add(node.id);
    }
  }

  const graphNodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];

  // Create task nodes for all tasks (grouped and non-grouped)
  for (const node of nodes) {
    graphNodes.push({
      id: node.id,
      type: "task" as const,
      position: { x: 0, y: 0 }, // dagre will overwrite
      data: {
        entityName: node.entityName ?? node.assigneeId,
        status: getNodeStatus(node),
        summary: truncate(node.title, 50),
        elapsedTime: getElapsedTime(node.createdAt),
        healthBadge: getHealthBadge(node, events),
        isRejected: getNodeStatus(node) === "rejected",
      },
    });
  }

  // Create group nodes and re-parent edges
  const groupParentEdgesAdded = new Set<string>();

  for (const [groupId, groupTasks] of groupMap) {
    const firstTask = groupTasks[0];
    if (!firstTask) continue;

    const counts = computeGroupCounts(groupTasks);

    // Create group node
    graphNodes.push({
      id: groupId,
      type: "group" as const,
      position: { x: 0, y: 0 },
      data: {
        groupId,
        policyType: firstTask.groupPolicy?.type ?? "all_required",
        policyThreshold: firstTask.groupPolicy?.threshold,
        groupStatus: firstTask.groupStatus ?? "active",
        ...counts,
      },
    });

    // Edge: delegator (parent of grouped tasks) -> group node
    // All tasks in a group share the same parent
    const parentId = firstTask.parentId;
    if (parentId && !groupParentEdgesAdded.has(groupId)) {
      graphEdges.push(
        buildDelegationEdge(parentId, groupId, firstTask, events),
      );
      groupParentEdgesAdded.add(groupId);
    }

    // Edge: group node -> each task in the group
    for (const task of groupTasks) {
      graphEdges.push({
        id: `${groupId}-${task.id}`,
        source: groupId,
        target: task.id,
        type: "delegation" as const,
        data: {
          state: getEdgeState(task, events),
        },
      });
    }
  }

  // Create edges for non-grouped child tasks (existing behavior)
  for (const child of nodes) {
    if (child.parentId == null) continue;
    if (groupedTaskIds.has(child.id)) continue; // handled above

    graphEdges.push(
      buildDelegationEdge(child.parentId, child.id, child, events),
    );
  }

  return { nodes: graphNodes, edges: graphEdges };
}
