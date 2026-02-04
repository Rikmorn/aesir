"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  formatEventType,
  formatRelativeTime,
  formatTokenCount,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConversationEvent } from "@/services/conversations";

import { EventIcon } from "./event-icon";
import { JsonPayload } from "./json-payload";

// ─── EventTimeline ──────────────────────────────────────────────────────────

interface EventTimelineProps {
  events: ConversationEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No events recorded
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <EventItem
          key={event.id}
          event={event}
          isSubAgent={event.parentInstanceId !== null}
        />
      ))}
    </div>
  );
}

// ─── EventItem ──────────────────────────────────────────────────────────────

interface EventItemProps {
  event: ConversationEvent;
  isSubAgent: boolean;
}

function EventItem({ event, isSubAgent }: EventItemProps) {
  const isFailed = event.type === "tool.failed";
  const [isOpen, setIsOpen] = useState(isFailed);

  const toolName = getToolName(event);
  const subAgentLabel = getSubAgentLabel(event, isSubAgent);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "rounded-lg border transition-colors hover:bg-accent/50",
          isFailed && "border-l-2 border-l-destructive bg-destructive/5",
          isSubAgent &&
            !isFailed &&
            "ml-6 border-l-2 border-l-muted-foreground/20",
          isSubAgent && isFailed && "ml-6",
        )}
      >
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}

          <EventIcon type={event.type} />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {formatEventType(event.type)}
              </span>
              {toolName && (
                <span className="truncate text-xs text-muted-foreground">
                  {toolName}
                </span>
              )}
            </div>
            {subAgentLabel && (
              <span className="truncate text-xs text-muted-foreground">
                {subAgentLabel}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {event.durationMs !== null && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {formatDurationMs(event.durationMs)}
              </span>
            )}
            {(event.tokenCountInput !== null ||
              event.tokenCountOutput !== null) && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {formatTokenCount(event.tokenCountInput ?? 0)} in /{" "}
                {formatTokenCount(event.tokenCountOutput ?? 0)} out
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(event.timestamp)}
            </span>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t px-3 pb-3 pt-2">
            <JsonPayload data={event.payload} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the tool name from a tool.called event payload.
 */
function getToolName(event: ConversationEvent): string | null {
  if (event.type !== "tool.called") return null;
  const name = event.payload.tool_name ?? event.payload.name;
  return typeof name === "string" ? name : null;
}

/**
 * Build a secondary label for sub-agent lifecycle events.
 *
 * - agent.started: shows agent type and task excerpt
 * - agent.completed: shows status and output preview
 */
function getSubAgentLabel(
  event: ConversationEvent,
  isSubAgent: boolean,
): string | null {
  if (!isSubAgent) return null;

  if (event.type === "agent.started") {
    const agentType = event.payload.agentType;
    const task = event.payload.task;
    if (typeof agentType === "string") {
      const label =
        typeof task === "string" ? `${agentType}: ${task}` : agentType;
      return truncateLabel(label, 120);
    }
  }

  if (event.type === "agent.completed") {
    const status = event.payload.status;
    const preview = event.payload.outputPreview;
    if (typeof status === "string") {
      const label =
        typeof preview === "string" ? `${status}: ${preview}` : status;
      return truncateLabel(label, 120);
    }
  }

  return null;
}

/**
 * Truncate a label to maxLength characters, appending ellipsis if needed.
 */
function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength)}...`;
}

/**
 * Format a duration in milliseconds for compact display.
 *
 * @returns "Xms" for <1000ms, "X.Xs" for >=1000ms
 */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
