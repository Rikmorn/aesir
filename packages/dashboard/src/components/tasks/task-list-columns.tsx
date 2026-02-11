"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { StatusBadge } from "@/components/conversations/status-badge";
import { formatRelativeTime } from "@/lib/format";
import type { RootTaskListItem, TreeHealth } from "@/services/tasks";
import { TaskHealthBadge } from "./task-health-badge";

/**
 * Extended list item type that includes resolved health data.
 */
export interface TaskListRow extends RootTaskListItem {
  health?: TreeHealth;
}

export const taskColumns: ColumnDef<TaskListRow>[] = [
  {
    accessorKey: "title",
    header: "Description",
    cell: ({ row }) => (
      <Link
        href={`/tasks/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    accessorKey: "creatorEntityName",
    header: "Entity",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.creatorEntityName ?? "-"}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "subtaskCount",
    header: () => <div className="text-right">Subtasks</div>,
    cell: ({ row }) => (
      <div className="text-right text-muted-foreground">
        {row.original.subtaskCount}
      </div>
    ),
  },
  {
    id: "health",
    header: "Health",
    cell: ({ row }) => <TaskHealthBadge health={row.original.health} />,
  },
  {
    id: "age",
    header: "Age",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatRelativeTime(new Date(row.original.createdAt))}
      </span>
    ),
  },
];
