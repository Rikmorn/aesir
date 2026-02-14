"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { RotateCcw } from "lucide-react";

import {
  formatDuration,
  formatRelativeTime,
  formatTokenCount,
} from "@/lib/format";
import type { ConversationListItem } from "@/services/conversations";

import { LiveDuration } from "./live-duration";
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
      <span className="font-medium">{row.original.agentDefinitionId}</span>
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
      const { status, createdAt, updatedAt } = row.original;
      const isActive = status === "running" || status === "waiting";

      if (isActive) {
        return <LiveDuration createdAt={createdAt} />;
      }

      return (
        <span className="font-mono tabular-nums">
          {formatDuration(createdAt, updatedAt)}
        </span>
      );
    },
  },
  {
    id: "tokenUsage",
    header: "Tokens",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-muted-foreground">
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
    id: "reopenCount",
    header: "",
    size: 40,
    cell: ({ row }) => {
      if (row.original.reopenCount > 0) {
        return (
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            title={`Reopened ${row.original.reopenCount} time${row.original.reopenCount > 1 ? "s" : ""}`}
          >
            <RotateCcw className="h-3 w-3" />
            {row.original.reopenCount}
          </span>
        );
      }
      return null;
    },
  },
  {
    id: "error",
    header: "",
    size: 200,
    cell: ({ row }) => {
      if (row.original.status === "failed" && row.original.errorMessage) {
        return (
          <span
            className="max-w-[200px] truncate text-xs text-destructive"
            title={row.original.errorMessage}
          >
            {row.original.errorMessage}
          </span>
        );
      }
      return null;
    },
  },
];
