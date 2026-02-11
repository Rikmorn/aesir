/**
 * Dagre Layout Engine
 *
 * Computes left-to-right hierarchical positions for React Flow nodes and edges
 * using dagre. A fresh graph is created on every call to avoid mutable state bugs.
 */

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

// ─── Constants ──────────────────────────────────────────────────────────────

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 80;

// ─── Layout ─────────────────────────────────────────────────────────────────

/**
 * Apply dagre layout to React Flow nodes and edges.
 *
 * CRITICAL: Creates a fresh dagre graph on every call.
 * Reusing a dagre graph causes layout bugs due to mutable internal state.
 */
export function getLayoutedElements<
  N extends Node = Node,
  E extends Edge = Edge,
>(nodes: N[], edges: E[]): { nodes: N[]; edges: E[] } {
  // Fresh graph per call -- never reuse
  const g = new dagre.graphlib.Graph();

  g.setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: "LR",
    nodesep: 50,
    ranksep: 100,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);

    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      targetPosition: "left" as const,
      sourcePosition: "right" as const,
    };
  });

  return { nodes: layoutedNodes, edges };
}
