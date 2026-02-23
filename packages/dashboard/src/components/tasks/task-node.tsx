"use client";

/**
 * Custom React Flow Node for Task Delegation Graph
 *
 * Renders a compact card showing:
 * - Entity name + health badge icon
 * - Task summary (truncated)
 * - Status dot (color-coded) + elapsed time
 */

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { AlertTriangle, Unlink } from "lucide-react";
import { memo } from "react";

import { cn } from "@/lib/utils";
import { BudgetBar } from "./budget-bar";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaskNodeData = {
  entityName: string;
  status:
    | "completed"
    | "failed"
    | "running"
    | "waiting"
    | "pending"
    | "rejected";
  summary: string;
  elapsedTime: string;
  healthBadge: "timeout" | "orphan" | null;
  isRejected: boolean;
  subtreeAllocation?: number | null;
  subtreeConsumed?: number | null;
};

export type TaskNode = Node<TaskNodeData, "task">;

// ─── Status Colors ──────────────────────────────────────────────────────────

const statusStyles: Record<
  TaskNodeData["status"],
  { border: string; dot: string; pulse?: boolean }
> = {
  completed: { border: "border-emerald-500/60", dot: "bg-emerald-500" },
  failed: { border: "border-red-500/60", dot: "bg-red-500" },
  running: {
    border: "border-indigo-500/60",
    dot: "bg-indigo-500",
    pulse: true,
  },
  waiting: { border: "border-amber-500/60", dot: "bg-amber-500" },
  pending: { border: "border-border", dot: "bg-muted-foreground/40" },
  rejected: { border: "border-border", dot: "bg-muted-foreground/40" },
};

// ─── Component ──────────────────────────────────────────────────────────────

function TaskNodeComponent({ data }: NodeProps<TaskNode>) {
  const style = statusStyles[data.status];

  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-md border-2 bg-card p-2.5",
        "w-[220px]",
        data.subtreeAllocation != null && data.subtreeAllocation > 0
          ? "min-h-[80px]"
          : "h-[80px]",
        style.border,
        data.isRejected && "opacity-60",
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

      {/* Top row: entity name + health badge */}
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[13px] font-medium">
          {data.entityName}
        </span>
        {data.healthBadge === "timeout" && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
        )}
        {data.healthBadge === "orphan" && (
          <Unlink className="h-3 w-3 shrink-0 text-amber-500" />
        )}
      </div>

      {/* Middle: task summary */}
      <p className="truncate text-xs text-muted-foreground">{data.summary}</p>

      {/* Bottom row: status dot + elapsed time */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            style.dot,
            style.pulse && "animate-pulse-signal",
          )}
        />
        <span className="font-mono text-[10px] text-muted-foreground">
          {data.elapsedTime}
        </span>
      </div>

      {/* Budget bar (only when tree budget is active) */}
      {data.subtreeAllocation != null && data.subtreeAllocation > 0 && (
        <BudgetBar
          allocated={data.subtreeAllocation}
          consumed={data.subtreeConsumed ?? 0}
          className="mt-1"
        />
      )}
    </div>
  );
}

export default memo(TaskNodeComponent);
