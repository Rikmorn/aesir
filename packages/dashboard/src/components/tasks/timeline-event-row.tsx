"use client";

/**
 * Timeline Event Row
 *
 * Single event row in the delegation timeline.
 * Renders: timestamp | entity icon | event description (one line)
 * Supports highlighted state for bidirectional graph-timeline linking.
 */

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/services/tasks";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TimelineEventRowProps {
  event: TimelineEvent;
  isHighlighted: boolean;
  onClick: () => void;
}

// ─── Event Description ──────────────────────────────────────────────────────

function getEventDescription(event: TimelineEvent): string {
  const name = event.entityName ?? "Agent";
  const payload = event.payload as Record<string, unknown>;
  const toolName = payload?.toolName as string | undefined;

  switch (event.type) {
    case "agent.started":
      return `${name} started working`;
    case "agent.completed":
      return `${name} completed`;
    case "agent.paused":
      return `${name} paused (waiting)`;
    case "agent.resumed":
      return `${name} resumed`;
    case "signal.received": {
      const signalType = payload?.signalType as string | undefined;
      return `Signal received: ${signalType ?? "unknown"}`;
    }
    case "signal.orphaned":
      return "Signal orphaned (delivery failed)";
    case "tool.called":
    case "tool.succeeded": {
      if (toolName === "task:delegate") {
        const args = payload?.arguments as Record<string, unknown> | undefined;
        const target = (args?.assigneeId as string) ?? "agent";
        return `${name} delegated to ${target}`;
      }
      if (toolName === "task:respond") {
        const args = payload?.arguments as Record<string, unknown> | undefined;
        const accepted = args?.accepted;
        return `${name} responded: ${accepted ? "accepted" : "rejected"}`;
      }
      if (toolName === "task:complete") {
        return `${name} completed task`;
      }
      if (toolName === "wait_for_task") {
        return `${name} waiting for delegated task`;
      }
      return `${name} called ${toolName ?? "tool"}`;
    }
    default:
      return `${event.type}`;
  }
}

// ─── Color ──────────────────────────────────────────────────────────────────

function getEventColor(event: TimelineEvent): string {
  const payload = event.payload as Record<string, unknown>;
  const toolName = payload?.toolName as string | undefined;

  switch (event.type) {
    case "agent.started":
    case "agent.resumed":
      return "text-blue-600 dark:text-blue-400";
    case "agent.completed":
      return "text-green-600 dark:text-green-400";
    case "agent.paused":
      return "text-amber-600 dark:text-amber-400";
    case "signal.received":
      return "text-blue-600 dark:text-blue-400";
    case "signal.orphaned":
      return "text-amber-600 dark:text-amber-400";
    case "tool.called":
    case "tool.succeeded": {
      if (toolName === "task:delegate")
        return "text-blue-600 dark:text-blue-400";
      if (toolName === "task:respond") {
        const args = payload?.arguments as Record<string, unknown> | undefined;
        return args?.accepted
          ? "text-green-600 dark:text-green-400"
          : "text-gray-500 dark:text-gray-400";
      }
      if (toolName === "task:complete")
        return "text-green-600 dark:text-green-400";
      if (toolName === "wait_for_task")
        return "text-amber-600 dark:text-amber-400";
      return "text-muted-foreground";
    }
    default:
      return "text-muted-foreground";
  }
}

function getEntityDotColor(event: TimelineEvent): string {
  const payload = event.payload as Record<string, unknown>;
  const toolName = payload?.toolName as string | undefined;

  switch (event.type) {
    case "agent.started":
    case "agent.resumed":
    case "signal.received":
      return "bg-blue-500";
    case "agent.completed":
      return "bg-green-500";
    case "agent.paused":
      return "bg-amber-500";
    case "signal.orphaned":
      return "bg-amber-500";
    case "tool.called":
    case "tool.succeeded": {
      if (toolName === "task:respond") {
        const args = payload?.arguments as Record<string, unknown> | undefined;
        return args?.accepted ? "bg-green-500" : "bg-gray-400";
      }
      if (toolName === "task:complete") return "bg-green-500";
      if (toolName === "wait_for_task") return "bg-amber-500";
      return "bg-blue-500";
    }
    default:
      return "bg-gray-400";
  }
}

// ─── Format ─────────────────────────────────────────────────────────────────

function formatTimestamp(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export const TimelineEventRow = forwardRef<
  HTMLButtonElement,
  TimelineEventRowProps
>(function TimelineEventRow({ event, isHighlighted, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-1.5 text-xs cursor-pointer text-left",
        "hover:bg-accent/30 transition-colors",
        isHighlighted && "bg-accent/50",
      )}
    >
      {/* Timestamp */}
      <span className="text-muted-foreground shrink-0 font-mono w-[68px]">
        {formatTimestamp(event.timestamp)}
      </span>

      {/* Entity dot + name */}
      <span className="flex items-center gap-1.5 shrink-0 min-w-[80px]">
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full shrink-0",
            getEntityDotColor(event),
          )}
        />
        <span className="truncate text-muted-foreground max-w-[70px]">
          {event.entityName ?? "Agent"}
        </span>
      </span>

      {/* Description */}
      <span className={cn("truncate", getEventColor(event))}>
        {getEventDescription(event)}
      </span>
    </button>
  );
});
