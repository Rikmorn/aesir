"use client";

/**
 * LiveConversationsTable
 *
 * Client wrapper that layers SSE real-time updates over server-rendered
 * conversation data. Subscribes to lifecycle events (started, completed,
 * paused, resumed) and applies them to conversation rows in-place.
 *
 * - New conversations from agent.started appear at the top with a highlight fade
 * - Status changes update rows without page refresh
 * - Connection status indicator shows SSE state
 */

import { useEffect, useRef, useState } from "react";
import { ConnectionStatusIndicator } from "@/components/ui/connection-status";
import { useEventStream } from "@/hooks/use-event-stream";
import { LIFECYCLE_EVENT_TYPES } from "@/lib/sse-types";
import type { ConversationListItem } from "@/services/conversations";
import { ConversationsTable } from "./data-table";

// ─── Props ──────────────────────────────────────────────────────────────────

interface LiveConversationsTableProps {
  initialData: ConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
  agentDefinitions: string[];
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

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveConversationsTable({
  initialData,
  total,
  page,
  pageSize,
  agentDefinitions,
}: LiveConversationsTableProps) {
  const [data, setData] = useState<ConversationListItem[]>(initialData);
  const [liveTotal, setLiveTotal] = useState(total);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Reset state when server data changes (filter/page navigation)
  useEffect(() => {
    setData(initialData);
    setLiveTotal(total);
  }, [initialData, total]);

  // Subscribe to lifecycle events for all conversations
  const { events, status } = useEventStream({
    url: "/dashboard/api/sse/events",
    types: LIFECYCLE_EVENT_TYPES,
  });

  // Apply SSE events to conversation data
  useEffect(() => {
    if (events.length === 0) return;

    setData((currentData) => {
      const existingIds = new Set(currentData.map((c) => c.id));
      const updateMap = new Map<string, Partial<ConversationListItem>>();
      const newItems: ConversationListItem[] = [];
      const touchedIds = new Set<string>();

      // Process events in order to build final state per conversation
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
          // New conversation -- create a list item from SSE payload
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
          // Only add if not already queued as new
          if (!newItems.some((n) => n.id === conversationId)) {
            newItems.push(newItem);
          }
          existingIds.add(conversationId);
        } else {
          // Status update for existing conversation
          updateMap.set(conversationId, {
            ...updateMap.get(conversationId),
            status: newStatus,
            updatedAt: eventTimestamp,
            lastActivity: eventTimestamp,
          });
        }
      }

      // Apply updates to existing rows
      let updated = currentData.map((item) => {
        const patch = updateMap.get(item.id);
        if (!patch) return item;
        return { ...item, ...patch };
      });

      // Prepend new conversations
      if (newItems.length > 0) {
        updated = [...newItems, ...updated];
        setLiveTotal((prev) => prev + newItems.length);
      }

      // Schedule highlight clear
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

  // Cleanup highlight timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ConnectionStatusIndicator status={status} />
      </div>
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
