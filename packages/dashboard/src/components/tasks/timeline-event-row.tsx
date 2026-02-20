"use client";

/**
 * Timeline Event Row
 *
 * Single event row in the delegation timeline.
 * Renders: timestamp | entity icon | event description (one line)
 * Supports highlighted state for bidirectional graph-timeline linking.
 *
 * Tool events include delegation, negotiation (counter-propose), and
 * clarification (ask/answer) events. Signal events include the receiving
 * side of these interactions.
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

// ─── Payload Helpers ────────────────────────────────────────────────────────

/**
 * Extract tool name from event payload.
 * Events may store as tool_name (snake_case from event log) or toolName (camelCase).
 * Also normalizes internal names (respond_task) to namespace format (task:respond).
 */
function getToolName(payload: Record<string, unknown>): string | undefined {
  const raw =
    (payload?.tool_name as string | undefined) ??
    (payload?.toolName as string | undefined);
  if (!raw) return undefined;
  // Normalize internal tool names to namespace format for consistent matching
  const internalToNamespace: Record<string, string> = {
    delegate_task: "task:delegate",
    respond_task: "task:respond",
    complete_task: "task:complete",
    clarify_task: "task:clarify",
    answer_task: "task:answer",
  };
  return internalToNamespace[raw] ?? raw;
}

/**
 * Extract tool input arguments from event payload.
 * Events store as "input" (from event log) but legacy code checked "arguments".
 */
function getToolInput(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    (payload?.input as Record<string, unknown> | undefined) ??
    (payload?.arguments as Record<string, unknown> | undefined)
  );
}

// ─── Event Description ──────────────────────────────────────────────────────

function getEventDescription(event: TimelineEvent): string {
  const name = event.entityName ?? "Agent";
  const payload = event.payload as Record<string, unknown>;
  const toolName = getToolName(payload);

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
      // Enhanced descriptions for negotiation signal types
      if (signalType === "task_counter_proposed") {
        const data = payload?.data as Record<string, unknown> | undefined;
        const proposal = data?.proposal as string | undefined;
        return proposal
          ? `Counter-proposal received: ${proposal}`
          : "Counter-proposal received";
      }
      if (signalType === "task_clarification") {
        const data = payload?.data as Record<string, unknown> | undefined;
        const question = data?.question as string | undefined;
        return question
          ? `Clarification requested: ${question}`
          : "Clarification requested";
      }
      if (signalType === "task_clarification_response") {
        const data = payload?.data as Record<string, unknown> | undefined;
        const answer = data?.answer as string | undefined;
        return answer
          ? `Clarification answered: ${answer}`
          : "Clarification answered";
      }
      return `Signal received: ${signalType ?? "unknown"}`;
    }
    case "signal.orphaned":
      return "Signal orphaned (delivery failed)";
    case "tool.called":
    case "tool.succeeded": {
      if (toolName === "task:delegate") {
        const args = getToolInput(payload);
        const target = (args?.assigneeId as string) ?? "agent";
        return `${name} delegated to ${target}`;
      }
      if (toolName === "task:respond") {
        const args = getToolInput(payload);
        const responseType = args?.type as string | undefined;
        if (responseType === "counter_propose") {
          const proposal = args?.proposal as string | undefined;
          return proposal
            ? `${name} counter-proposed: ${proposal}`
            : `${name} counter-proposed`;
        }
        // Legacy accept/reject (accepted field) or discriminated union type field
        if (responseType === "accept" || args?.accepted === true) {
          return `${name} responded: accepted`;
        }
        if (responseType === "reject" || args?.accepted === false) {
          return `${name} responded: rejected`;
        }
        return `${name} responded`;
      }
      if (toolName === "task:clarify") {
        const args = getToolInput(payload);
        const question = args?.question as string | undefined;
        return question
          ? `${name} asked: ${question}`
          : `${name} asked clarification`;
      }
      if (toolName === "task:answer") {
        const args = getToolInput(payload);
        const answer = args?.answer as string | undefined;
        return answer
          ? `${name} answered: ${answer}`
          : `${name} answered clarification`;
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
  const toolName = getToolName(payload);

  switch (event.type) {
    case "agent.started":
    case "agent.resumed":
      return "text-blue-600 dark:text-blue-400";
    case "agent.completed":
      return "text-green-600 dark:text-green-400";
    case "agent.paused":
      return "text-amber-600 dark:text-amber-400";
    case "signal.received": {
      const signalType = payload?.signalType as string | undefined;
      if (signalType === "task_counter_proposed")
        return "text-amber-600 dark:text-amber-400";
      if (
        signalType === "task_clarification" ||
        signalType === "task_clarification_response"
      )
        return "text-blue-600 dark:text-blue-400";
      return "text-blue-600 dark:text-blue-400";
    }
    case "signal.orphaned":
      return "text-amber-600 dark:text-amber-400";
    case "tool.called":
    case "tool.succeeded": {
      if (toolName === "task:delegate")
        return "text-blue-600 dark:text-blue-400";
      if (toolName === "task:respond") {
        const args = getToolInput(payload);
        const responseType = args?.type as string | undefined;
        if (responseType === "counter_propose")
          return "text-amber-600 dark:text-amber-400";
        if (responseType === "accept" || args?.accepted === true)
          return "text-green-600 dark:text-green-400";
        return "text-gray-500 dark:text-gray-400";
      }
      if (toolName === "task:clarify" || toolName === "task:answer")
        return "text-blue-600 dark:text-blue-400";
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
  const toolName = getToolName(payload);

  switch (event.type) {
    case "agent.started":
    case "agent.resumed":
    case "signal.received": {
      const signalType = payload?.signalType as string | undefined;
      if (signalType === "task_counter_proposed") return "bg-amber-500";
      return "bg-blue-500";
    }
    case "agent.completed":
      return "bg-green-500";
    case "agent.paused":
      return "bg-amber-500";
    case "signal.orphaned":
      return "bg-amber-500";
    case "tool.called":
    case "tool.succeeded": {
      if (toolName === "task:respond") {
        const args = getToolInput(payload);
        const responseType = args?.type as string | undefined;
        if (responseType === "counter_propose") return "bg-amber-500";
        if (responseType === "accept" || args?.accepted === true)
          return "bg-green-500";
        return "bg-gray-400";
      }
      if (toolName === "task:clarify" || toolName === "task:answer")
        return "bg-blue-500";
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
