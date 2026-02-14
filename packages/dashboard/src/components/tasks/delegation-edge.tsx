"use client";

/**
 * Custom React Flow Edge for Delegation Graph
 *
 * Renders edges with 7 distinct visual states:
 * - pending: dashed gray
 * - active: solid blue + animated moving circle
 * - completed: solid green
 * - failed: solid red
 * - timeout: solid amber
 * - orphaned: dashed amber
 * - rejected: thin dashed gray with reduced opacity
 *
 * Defined OUTSIDE any component for referential equality (prevents React Flow re-mounts).
 */

import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  getSmoothStepPath,
} from "@xyflow/react";
import { memo, useCallback, useState } from "react";

import { EdgeTooltip } from "./edge-tooltip";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DelegationEdgeData = {
  state:
    | "pending"
    | "active"
    | "completed"
    | "failed"
    | "timeout"
    | "orphaned"
    | "rejected";
  signalType?: string;
  timestamp?: string;
  payloadPreview?: string;
};

export type DelegationEdge = Edge<DelegationEdgeData, "delegation">;

// ─── Edge Styles ────────────────────────────────────────────────────────────

const edgeStyles: Record<DelegationEdgeData["state"], React.CSSProperties> = {
  pending: { stroke: "#64748b", strokeDasharray: "5,5", opacity: 0.5 },
  active: { stroke: "#6366f1" },
  completed: { stroke: "#10b981" },
  failed: { stroke: "#ef4444" },
  timeout: { stroke: "#f59e0b" },
  orphaned: { stroke: "#f59e0b", strokeDasharray: "5,5" },
  rejected: { stroke: "#64748b", strokeDasharray: "3,3", opacity: 0.4 },
};

// ─── Component ──────────────────────────────────────────────────────────────

function DelegationEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<DelegationEdge>) {
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const state = data?.state ?? "pending";
  const style = edgeStyles[state];

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <>
      {/* Invisible wider path for hover detection -- SVG hit area, not interactive HTML element */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG edge hover detection area within React Flow graph */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: "pointer" }}
      />

      {/* Visible edge */}
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />

      {/* Animated circle for active edges */}
      {state === "active" && (
        <circle r="3" fill="#6366f1">
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* Tooltip on hover */}
      <foreignObject
        x={0}
        y={0}
        width={1}
        height={1}
        overflow="visible"
        style={{ pointerEvents: "none" }}
      >
        <EdgeTooltip
          signalType={data?.signalType}
          timestamp={data?.timestamp}
          payloadPreview={data?.payloadPreview}
          visible={hovered}
          x={labelX}
          y={labelY}
        />
      </foreignObject>
    </>
  );
}

export default memo(DelegationEdgeComponent);
