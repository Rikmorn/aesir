"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import {
  formatDuration,
  formatRelativeTime,
  formatTokenCount,
} from "@/lib/format";
import type { ConversationListItem } from "@/services/conversations";
import { StatusBadge } from "./status-badge";

/**
 * Format a trigger event type for display.
 *
 * Strips "agent." prefix and replaces dots with spaces.
 * e.g., "agent.started" -> "started", "signal.received" -> "signal received"
 */
function formatTriggerEventType(eventType: string): string {
  const stripped = eventType.startsWith("agent.")
    ? eventType.slice("agent.".length)
    : eventType;
  return stripped.replace(/\./g, " ");
}

export const columns: ColumnDef<ConversationListItem>[] = [
  {
    accessorKey: "agentDefinitionId",
    header: "Agent",
    cell: ({ row }) => (
      <Link
        href={`/conversations/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.agentDefinitionId}
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "triggerEventType",
    header: "Trigger",
    cell: ({ row }) => {
      const eventType = row.original.triggerEventType;
      if (!eventType) {
        return <span className="text-sm text-muted-foreground">-</span>;
      }
      return (
        <span className="text-sm text-muted-foreground">
          {formatTriggerEventType(eventType)}
        </span>
      );
    },
  },
  {
    id: "duration",
    header: "Duration",
    cell: ({ row }) => {
      if (row.original.status === "running") {
        return <span className="text-blue-600">Running...</span>;
      }
      return formatDuration(row.original.createdAt, row.original.updatedAt);
    },
  },
  {
    id: "tokenUsage",
    header: "Tokens",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatTokenCount(row.original.tokenInput + row.original.tokenOutput)}
      </span>
    ),
  },
  {
    accessorKey: "lastActivity",
    header: "Last Activity",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatRelativeTime(row.original.lastActivity)}
      </span>
    ),
  },
  {
    id: "error",
    header: "",
    size: 40,
    cell: ({ row }) => {
      if (row.original.status === "failed") {
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      }
      return null;
    },
  },
];
