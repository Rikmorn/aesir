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
    id: "identity",
    header: "Conversation",
    cell: ({ row }) => {
      const {
        agentDefinitionId,
        status,
        triggerEventType,
        errorMessage,
        reopenCount,
      } = row.original;

      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{agentDefinitionId}</span>
            <StatusBadge status={status} />
            {reopenCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title={`Reopened ${reopenCount} time${reopenCount > 1 ? "s" : ""}`}
              >
                <RotateCcw className="h-3 w-3" />
                {reopenCount}
              </span>
            )}
          </div>
          {status === "failed" && errorMessage ? (
            <span className="max-w-[400px] truncate text-xs text-destructive">
              {errorMessage}
            </span>
          ) : triggerEventType ? (
            <span className="text-xs text-muted-foreground">
              {formatTriggerEventType(triggerEventType)}
            </span>
          ) : null}
        </div>
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
];
