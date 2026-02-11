"use client";

/**
 * Delegation Graph
 *
 * React Flow container that renders the task delegation tree.
 * Transforms tree data into positioned nodes and edges via dagre layout.
 *
 * nodeTypes and edgeTypes are defined as module-level constants OUTSIDE the
 * component for referential equality -- prevents React Flow re-mounting on render.
 */

import {
  Controls,
  MiniMap,
  ReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";

import type { TaskTreeNode, TimelineEvent, TreeHealth } from "@/services/tasks";

import DelegationEdgeComponent, {
  type DelegationEdgeData,
} from "./delegation-edge";
import { getLayoutedElements } from "./graph-layout";
import TaskNodeComponent, { type TaskNodeData } from "./task-node";

// ─── Node & Edge Types (module-level for referential equality) ──────────────

const nodeTypes = { task: TaskNodeComponent };
const edgeTypes = { delegation: DelegationEdgeComponent };

// ─── Data Transformation ────────────────────────────────────────────────────

function getElapsedTime(createdAt: string): string {
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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}...`;
}

function getNodeStatus(node: TaskTreeNode): TaskNodeData["status"] {
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

function getHealthBadge(
  node: TaskTreeNode,
  events: TimelineEvent[],
): TaskNodeData["healthBadge"] {
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

function getEdgeState(
  child: TaskTreeNode,
  events: TimelineEvent[],
): DelegationEdgeData["state"] {
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

export function transformTreeToGraph(
  nodes: TaskTreeNode[],
  events: TimelineEvent[],
  _health: TreeHealth,
): { nodes: RFNode<TaskNodeData>[]; edges: RFEdge<DelegationEdgeData>[] } {
  const rfNodes: RFNode<TaskNodeData>[] = nodes.map((node) => ({
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
  }));

  const rfEdges: RFEdge<DelegationEdgeData>[] = nodes
    .filter((node) => node.parentId != null)
    .map((child) => {
      const state = getEdgeState(child, events);

      // Find delegation tool event for this edge
      const delegationEvent = events.find(
        (e) =>
          e.type === "tool.called" &&
          (e.payload as Record<string, unknown>)?.toolName ===
            "task:delegate" &&
          // Match by checking if the event's conversation is the parent's conversation
          e.taskId === child.parentId,
      );

      return {
        id: `${child.parentId}-${child.id}`,
        source: child.parentId as string,
        target: child.id,
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
    });

  return { nodes: rfNodes, edges: rfEdges };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface DelegationGraphProps {
  treeNodes: TaskTreeNode[];
  events: TimelineEvent[];
  health: TreeHealth;
  onNodeClick: (nodeId: string) => void;
  onPaneClick?: () => void;
  selectedNodeId: string | null;
}

export function DelegationGraph({
  treeNodes,
  events,
  health,
  onNodeClick,
  onPaneClick,
  selectedNodeId,
}: DelegationGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const { nodes: rfNodes, edges: rfEdges } = transformTreeToGraph(
      treeNodes,
      events,
      health,
    );
    return getLayoutedElements(rfNodes, rfEdges);
  }, [treeNodes, events, health]);

  // Highlight selected node
  const styledNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [nodes, selectedNodeId],
  );

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_event, node) => onNodeClick(node.id)}
      onPaneClick={onPaneClick}
      fitView
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesReconnectable={false}
    >
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(node) => {
          const data = node.data as TaskNodeData | undefined;
          if (!data) return "#9ca3af";
          switch (data.status) {
            case "completed":
              return "#22c55e";
            case "failed":
              return "#ef4444";
            case "running":
              return "#3b82f6";
            case "waiting":
              return "#f59e0b";
            default:
              return "#9ca3af";
          }
        }}
        zoomable
        pannable
      />
    </ReactFlow>
  );
}
