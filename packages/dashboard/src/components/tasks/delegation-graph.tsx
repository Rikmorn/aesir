"use client";

/**
 * Delegation Graph
 *
 * React Flow container that renders the task delegation tree.
 * Transforms tree data into positioned nodes and edges via dagre layout.
 *
 * Pure transformation logic lives in graph-utils.ts (testable without React/React Flow).
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
import { transformTreeToGraph as transformTreeToGraphBase } from "./graph-utils";
import GroupNodeComponent, { type GroupNodeData } from "./group-node";
import TaskNodeComponent, { type TaskNodeData } from "./task-node";

// ─── Node & Edge Types (module-level for referential equality) ──────────────

const nodeTypes = { task: TaskNodeComponent, group: GroupNodeComponent };
const edgeTypes = { delegation: DelegationEdgeComponent };

// ─── Data Transformation (delegates to graph-utils.ts) ──────────────────────

/**
 * Re-export transformTreeToGraph with React Flow types for component usage.
 * The underlying logic is in graph-utils.ts (framework-agnostic, testable).
 */
export function transformTreeToGraph(
  nodes: TaskTreeNode[],
  events: TimelineEvent[],
  health: TreeHealth,
): {
  nodes: RFNode<TaskNodeData | GroupNodeData>[];
  edges: RFEdge<DelegationEdgeData>[];
} {
  const result = transformTreeToGraphBase(nodes, events, health);
  // GraphNode/GraphEdge are structurally compatible with RFNode/RFEdge
  return result as unknown as {
    nodes: RFNode<TaskNodeData | GroupNodeData>[];
    edges: RFEdge<DelegationEdgeData>[];
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface DelegationGraphProps {
  treeNodes: TaskTreeNode[];
  events: TimelineEvent[];
  health: TreeHealth;
  onNodeClick: (nodeId: string) => void;
  onPaneClick?: () => void;
  selectedNodeId: string | null;
  highlightedNodeId?: string | null;
}

export function DelegationGraph({
  treeNodes,
  events,
  health,
  onNodeClick,
  onPaneClick,
  selectedNodeId,
  highlightedNodeId,
}: DelegationGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const { nodes: rfNodes, edges: rfEdges } = transformTreeToGraph(
      treeNodes,
      events,
      health,
    );
    return getLayoutedElements(rfNodes, rfEdges);
  }, [treeNodes, events, health]);

  // Highlight selected node and apply timeline highlight ring
  const styledNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        className:
          node.id === highlightedNodeId
            ? "ring-2 ring-primary ring-offset-2 rounded-md"
            : undefined,
      })),
    [nodes, selectedNodeId, highlightedNodeId],
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
          // Group nodes use groupStatus for color
          if (node.type === "group") {
            const gd = node.data as GroupNodeData | undefined;
            if (!gd) return "#64748b";
            switch (gd.groupStatus) {
              case "satisfied":
              case "settled":
                return "#10b981";
              case "unsatisfiable":
                return "#ef4444";
              case "active":
                return "#f59e0b";
              default:
                return "#64748b";
            }
          }
          const data = node.data as TaskNodeData | undefined;
          if (!data) return "#64748b";
          switch (data.status) {
            case "completed":
              return "#10b981";
            case "failed":
              return "#ef4444";
            case "running":
              return "#6366f1";
            case "waiting":
              return "#f59e0b";
            default:
              return "#64748b";
          }
        }}
        zoomable
        pannable
      />
    </ReactFlow>
  );
}
