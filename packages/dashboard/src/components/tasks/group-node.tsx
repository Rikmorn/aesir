"use client";

/**
 * Custom React Flow Node for Task Group in Delegation Graph
 *
 * Renders a wider card showing:
 * - Policy badge (pill) + group status icon
 * - Progress fraction with subtle progress bar
 * - Group status text with status-dependent border coloring
 *
 * Wider than task nodes (280px vs 220px) to visually distinguish groups.
 */

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GroupNodeData = {
  groupId: string;
  policyType: string;
  policyThreshold?: number;
  groupStatus: string; // active | satisfied | unsatisfiable | cancelled | settled
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  total: number;
};

export type GroupNode = Node<GroupNodeData, "group">;

// ─── Status Styles ──────────────────────────────────────────────────────────

const groupStatusStyles: Record<
  string,
  { border: string; text: string; bg: string }
> = {
  active: {
    border: "border-amber-500/60",
    text: "text-amber-400",
    bg: "bg-amber-500",
  },
  satisfied: {
    border: "border-emerald-500/60",
    text: "text-emerald-400",
    bg: "bg-emerald-500",
  },
  unsatisfiable: {
    border: "border-red-500/60",
    text: "text-red-400",
    bg: "bg-red-500",
  },
  cancelled: {
    border: "border-border",
    text: "text-muted-foreground",
    bg: "bg-muted-foreground/40",
  },
  settled: {
    border: "border-emerald-500/60",
    text: "text-emerald-400",
    bg: "bg-emerald-500",
  },
};

const defaultStyle = {
  border: "border-border",
  text: "text-muted-foreground",
  bg: "bg-muted-foreground/40",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPolicy(
  policyType: string,
  threshold: number | undefined,
  total: number,
): string {
  switch (policyType) {
    case "all_required":
      return "All Required";
    case "any_sufficient":
      return `Any (1/${total})`;
    case "min_required":
      return `Min ${threshold ?? 1}/${total}`;
    default:
      return policyType;
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "satisfied":
      return "Satisfied";
    case "unsatisfiable":
      return "Unsatisfiable";
    case "cancelled":
      return "Cancelled";
    case "settled":
      return "Settled";
    default:
      return status;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

function GroupNodeComponent({ data }: NodeProps<GroupNode>) {
  const style = groupStatusStyles[data.groupStatus] ?? defaultStyle;
  const progressPct =
    data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-md border-2 bg-card p-2.5",
        "w-[280px] h-[90px]",
        style.border,
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-muted-foreground !w-1.5 !h-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-muted-foreground !w-1.5 !h-1.5"
      />

      {/* Top row: policy badge + group status */}
      <div className="flex items-center justify-between gap-1.5">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          {formatPolicy(data.policyType, data.policyThreshold, data.total)}
        </span>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              style.bg,
              data.groupStatus === "active" && "animate-pulse-signal",
            )}
          />
          <span className={cn("text-[10px] font-medium", style.text)}>
            {formatStatus(data.groupStatus)}
          </span>
        </div>
      </div>

      {/* Middle: progress fraction + bar */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-foreground tabular-nums">
            {data.completed}/{data.total} completed
          </span>
          {data.running > 0 && (
            <span className="text-[10px] text-indigo-400">
              {data.running} running
            </span>
          )}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              data.groupStatus === "unsatisfiable"
                ? "bg-red-500/60"
                : "bg-emerald-500/60",
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(GroupNodeComponent);
