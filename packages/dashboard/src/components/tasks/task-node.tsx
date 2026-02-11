"use client";

/**
 * Custom React Flow Node for Task Delegation Graph
 *
 * Renders a ~220x80px card showing:
 * - Entity name + health badge icon
 * - Task summary (truncated)
 * - Status dot (color-coded) + elapsed time
 *
 * Defined OUTSIDE any component for referential equality (prevents React Flow re-mounts).
 */

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { AlertTriangle, Unlink } from "lucide-react";
import { memo } from "react";

import { cn } from "@/lib/utils";

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
};

export type TaskNode = Node<TaskNodeData, "task">;

// ─── Status Colors ──────────────────────────────────────────────────────────

const statusStyles: Record<
  TaskNodeData["status"],
  { border: string; dot: string; pulse?: boolean }
> = {
  completed: { border: "border-green-500", dot: "bg-green-500" },
  failed: { border: "border-red-500", dot: "bg-red-500" },
  running: { border: "border-blue-500", dot: "bg-blue-500", pulse: true },
  waiting: { border: "border-amber-500", dot: "bg-amber-500" },
  pending: { border: "border-gray-300", dot: "bg-gray-300" },
  rejected: { border: "border-gray-300", dot: "bg-gray-300" },
};

// ─── Component ──────────────────────────────────────────────────────────────

function TaskNodeComponent({ data }: NodeProps<TaskNode>) {
  const style = statusStyles[data.status];

  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-md border-2 bg-background p-2 shadow-sm",
        "w-[220px] h-[80px]",
        style.border,
        data.isRejected && "opacity-70",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-muted-foreground !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-muted-foreground !w-2 !h-2"
      />

      {/* Top row: entity name + health badge */}
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-sm font-medium">{data.entityName}</span>
        {data.healthBadge === "timeout" && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        )}
        {data.healthBadge === "orphan" && (
          <Unlink className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        )}
      </div>

      {/* Middle: task summary */}
      <p className="truncate text-xs text-muted-foreground">{data.summary}</p>

      {/* Bottom row: status dot + elapsed time */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            style.dot,
            style.pulse && "animate-pulse",
          )}
        />
        <span className="text-[10px] text-muted-foreground">
          {data.elapsedTime}
        </span>
      </div>
    </div>
  );
}

export default memo(TaskNodeComponent);
