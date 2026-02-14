"use client";

/**
 * LiveConversationsTable
 *
 * Client wrapper that layers SSE real-time updates over server-rendered
 * conversation data. Renders the page header with live status summary,
 * filter toolbar, and viewport-filling data table.
 *
 * - Header: title + total count + status pills + connection indicator
 * - Status pills update live as SSE events arrive
 * - New conversations appear at the top with a highlight fade
 * - Status changes update rows without page refresh
 */

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ConnectionStatusIndicator } from "@/components/ui/connection-status";
import { useEventStream } from "@/hooks/use-event-stream";
import { LIFECYCLE_EVENT_TYPES } from "@/lib/sse-types";
import type {
  ConversationListItem,
  ConversationStatusCount,
} from "@/services/conversations";
import { ConversationsTable } from "./data-table";
import { statusConfig } from "./status-badge";

// ─── Props ──────────────────────────────────────────────────────────────────

interface LiveConversationsTableProps {
  initialData: ConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
  agentDefinitions: string[];
  statusCounts: ConversationStatusCount[];
}

// ─── SSE Event to Status Mapping ────────────────────────────────────────────

function mapEventTypeToStatus(
  eventType: string,
): ConversationListItem["status"] | null {
  switch (eventType) {
    case "agent.started":
      return "running";
    case "agent.completed":
      return "completed";
    case "agent.paused":
      return "waiting";
    case "agent.resumed":
      return "running";
    default:
      return null;
  }
}

// ─── Status Summary ─────────────────────────────────────────────────────────

const SUMMARY_STATUSES = ["running", "waiting", "failed"] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveConversationsTable({
  initialData,
  total,
  page,
  pageSize,
  agentDefinitions,
  statusCounts,
}: LiveConversationsTableProps) {
  const [data, setData] = useState<ConversationListItem[]>(initialData);
  const [liveTotal, setLiveTotal] = useState(total);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Build a live-updating status count map
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const sc of statusCounts) {
      map[sc.status] = sc.count;
    }
    return map;
  });

  const globalTotal = Object.values(liveCounts).reduce((sum, c) => sum + c, 0);

  // Reset state when server data changes (filter/page navigation)
  useEffect(() => {
    setData(initialData);
    setLiveTotal(total);
  }, [initialData, total]);

  useEffect(() => {
    const map: Record<string, number> = {};
    for (const sc of statusCounts) {
      map[sc.status] = sc.count;
    }
    setLiveCounts(map);
  }, [statusCounts]);

  // Subscribe to lifecycle events for all conversations
  const { events, status: sseStatus } = useEventStream({
    url: "/dashboard/api/sse/events",
    types: LIFECYCLE_EVENT_TYPES,
  });

  // Apply SSE events to conversation data + status counts
  useEffect(() => {
    if (events.length === 0) return;

    setData((currentData) => {
      const existingIds = new Set(currentData.map((c) => c.id));
      const updateMap = new Map<string, Partial<ConversationListItem>>();
      const newItems: ConversationListItem[] = [];
      const touchedIds = new Set<string>();

      // Track status transitions for count updates
      const countDeltas: Record<string, number> = {};

      for (const event of events) {
        const conversationId = event.conversationId;
        const newStatus = mapEventTypeToStatus(event.type);
        if (!newStatus) continue;

        const eventTimestamp = new Date(event.timestamp);
        touchedIds.add(conversationId);

        if (
          event.type === "agent.started" &&
          !existingIds.has(conversationId)
        ) {
          const newItem: ConversationListItem = {
            id: conversationId,
            agentDefinitionId: event.agentDefinitionId,
            status: newStatus,
            createdAt: eventTimestamp,
            updatedAt: eventTimestamp,
            tokenInput: 0,
            tokenOutput: 0,
            triggerEventType: event.type,
            lastActivity: eventTimestamp,
            errorMessage: null,
            reopenCount: 0,
          };
          if (!newItems.some((n) => n.id === conversationId)) {
            newItems.push(newItem);
          }
          existingIds.add(conversationId);

          // New conversation: increment the new status
          countDeltas[newStatus] = (countDeltas[newStatus] ?? 0) + 1;
        } else {
          // Find old status for count transition
          const existing = currentData.find((c) => c.id === conversationId);
          const prevPatch = updateMap.get(conversationId);
          const oldStatus = (prevPatch?.status as string) ?? existing?.status;

          if (oldStatus && oldStatus !== newStatus) {
            countDeltas[oldStatus] = (countDeltas[oldStatus] ?? 0) - 1;
            countDeltas[newStatus] = (countDeltas[newStatus] ?? 0) + 1;
          }

          updateMap.set(conversationId, {
            ...updateMap.get(conversationId),
            status: newStatus,
            updatedAt: eventTimestamp,
            lastActivity: eventTimestamp,
          });
        }
      }

      // Update status counts
      if (Object.keys(countDeltas).length > 0) {
        setLiveCounts((prev) => {
          const next = { ...prev };
          for (const [s, delta] of Object.entries(countDeltas)) {
            next[s] = Math.max(0, (next[s] ?? 0) + delta);
          }
          return next;
        });
      }

      let updated = currentData.map((item) => {
        const patch = updateMap.get(item.id);
        if (!patch) return item;
        return { ...item, ...patch };
      });

      if (newItems.length > 0) {
        updated = [...newItems, ...updated];
        setLiveTotal((prev) => prev + newItems.length);
      }

      if (touchedIds.size > 0) {
        setHighlightedIds(touchedIds);
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }
        highlightTimeoutRef.current = setTimeout(() => {
          setHighlightedIds(new Set());
        }, 1500);
      }

      return updated;
    });
  }, [events]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Page header */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight">
              Conversations
            </h1>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {globalTotal.toLocaleString()}
            </Badge>
          </div>
          <ConnectionStatusIndicator status={sseStatus} />
        </div>

        {/* Status summary pills */}
        <div className="mt-1.5 flex items-center gap-2">
          {SUMMARY_STATUSES.map((s) => {
            const count = liveCounts[s] ?? 0;
            if (count === 0) return null;
            const config = statusConfig[s];
            if (!config) return null;
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 text-xs"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${config.dotClassName}`}
                />
                <span className="font-mono tabular-nums text-muted-foreground">
                  {count} {config.label.toLowerCase()}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Table fills remaining space */}
      <ConversationsTable
        data={data}
        total={liveTotal}
        page={page}
        pageSize={pageSize}
        agentDefinitions={agentDefinitions}
        highlightedIds={highlightedIds}
      />
    </div>
  );
}
