"use client";

/**
 * Delegation Timeline
 *
 * Collapsible panel below the delegation graph showing delegation lifecycle
 * events in chronological order. Supports bidirectional linking with the graph:
 * - selectedNodeId highlights events belonging to that node's task
 * - onEventClick notifies parent to highlight the corresponding graph node
 * - Exposes scrollToTask for graph->timeline auto-scrolling
 */

import { ChevronDown, ChevronUp } from "lucide-react";
import { createRef, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/services/tasks";

import { TimelineEventRow } from "./timeline-event-row";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DelegationTimelineProps {
  events: TimelineEvent[];
  selectedNodeId: string | null;
  onEventClick: (taskId: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DelegationTimeline({
  events,
  selectedNodeId,
  onEventClick,
  isExpanded,
  onToggle,
}: DelegationTimelineProps) {
  // Create refs for each event row for scroll-to functionality
  const eventRefs = useRef<
    Map<string, React.RefObject<HTMLButtonElement | null>>
  >(new Map());

  // Ensure refs exist for all events
  for (const event of events) {
    if (!eventRefs.current.has(event.id)) {
      eventRefs.current.set(event.id, createRef<HTMLButtonElement>());
    }
  }

  // Auto-scroll to first event for selected node
  useEffect(() => {
    if (!selectedNodeId || !isExpanded) return;

    const firstEvent = events.find((e) => e.taskId === selectedNodeId);
    if (!firstEvent) return;

    const ref = eventRefs.current.get(firstEvent.id);
    if (ref?.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedNodeId, isExpanded, events]);

  return (
    <div className="border-t bg-card">
      {/* Collapsible bar */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center justify-between px-4 py-2",
          "text-sm font-medium text-muted-foreground",
          "hover:bg-accent/30 transition-colors",
        )}
      >
        <span>Timeline ({events.length} events)</span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {/* Event list */}
      {isExpanded && (
        <div className="overflow-y-auto max-h-[280px] border-t">
          {events.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No delegation events recorded yet
            </p>
          ) : (
            events.map((event) => (
              <TimelineEventRow
                key={event.id}
                ref={eventRefs.current.get(event.id)}
                event={event}
                isHighlighted={event.taskId === selectedNodeId}
                onClick={() => {
                  if (event.taskId) {
                    onEventClick(event.taskId);
                  }
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
