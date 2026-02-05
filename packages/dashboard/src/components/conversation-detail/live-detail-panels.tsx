"use client";

/**
 * LiveDetailPanels
 *
 * Client wrapper for the conversation detail page that adds real-time updates
 * via SSE. Combines server-rendered data (initial load) with per-conversation
 * SSE streaming for live event timeline, message panel, and metadata sidebar.
 *
 * Key behaviors:
 * - SSE connection only active when conversation status is "running" or "waiting"
 * - Smart auto-scroll: scrolls to bottom when user is at bottom, shows pill when scrolled up
 * - Event buffer capped at 1000 events with truncation indicator
 * - Metadata (status, timestamps, tokens) updated from lifecycle SSE events
 * - Gap detection triggers router.refresh() for full data reload
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConnectionStatusIndicator } from "@/components/ui/connection-status";
import { useEventStream } from "@/hooks/use-event-stream";
import type { SseEvent } from "@/lib/sse-types";
import type {
  ChildConversation,
  ConversationDetail,
  ConversationEvent,
} from "@/services/conversations";

import { DetailLayout } from "./detail-layout";
import { EventTimeline } from "./event-timeline";
import { MetadataSidebar } from "./metadata-sidebar";

// ─── Serialized Types ──────────────────────────────────────────────────────
// Date fields arrive as ISO strings across the RSC server/client boundary.

interface SerializedConversationDetail
  extends Omit<ConversationDetail, "createdAt" | "updatedAt" | "lastEventAt"> {
  createdAt: string;
  updatedAt: string;
  lastEventAt: string | null;
}

interface SerializedConversationEvent
  extends Omit<ConversationEvent, "timestamp"> {
  timestamp: string;
}

interface SerializedChildConversation
  extends Omit<ChildConversation, "createdAt"> {
  createdAt: string;
}

export interface LiveDetailPanelsProps {
  conversation: SerializedConversationDetail;
  initialEvents: SerializedConversationEvent[];
  childConversations: SerializedChildConversation[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_EVENTS = 1000;
const SCROLL_THRESHOLD_PX = 100;

// ─── Component ─────────────────────────────────────────────────────────────

export function LiveDetailPanels({
  conversation: initialConversation,
  initialEvents,
  childConversations: initialChildren,
}: LiveDetailPanelsProps) {
  const router = useRouter();

  // ─── Deserialize server data ──────────────────────────────────────

  const serverConversation = useMemo<ConversationDetail>(
    () => deserializeConversation(initialConversation),
    [initialConversation],
  );

  const serverEvents = useMemo<ConversationEvent[]>(
    () => initialEvents.map(deserializeEvent),
    [initialEvents],
  );

  const serverChildren = useMemo<ChildConversation[]>(
    () => initialChildren.map(deserializeChild),
    [initialChildren],
  );

  // ─── Live state ───────────────────────────────────────────────────

  const [events, setEvents] = useState<ConversationEvent[]>(serverEvents);
  const [truncatedCount, setTruncatedCount] = useState(0);
  const [conversationMeta, setConversationMeta] =
    useState<ConversationDetail>(serverConversation);
  const [sseEventCount, setSseEventCount] = useState(0);

  // Reset state when server data changes (e.g., after router.refresh())
  useEffect(() => {
    setEvents(serverEvents);
    setTruncatedCount(0);
  }, [serverEvents]);

  useEffect(() => {
    setConversationMeta(serverConversation);
  }, [serverConversation]);

  // ─── SSE connection ───────────────────────────────────────────────

  const isActive =
    conversationMeta.status === "running" ||
    conversationMeta.status === "waiting";

  const {
    events: sseEvents,
    status: connectionStatus,
    hasGap,
  } = useEventStream({
    url: "/dashboard/api/sse/events",
    conversationId: serverConversation.id,
    enabled: isActive,
    maxEvents: MAX_EVENTS,
  });

  // ─── Merge SSE events into timeline ───────────────────────────────

  useEffect(() => {
    if (sseEvents.length === 0) return;

    // Track how many new SSE events we've seen (for "new events" pill)
    setSseEventCount(sseEvents.length);

    setEvents((prev) => {
      // Deduplicate: build a set of existing event IDs
      const existingIds = new Set(prev.map((e) => e.id));

      const newEvents = sseEvents
        .filter((sse) => !existingIds.has(sse.id))
        .map(sseEventToConversationEvent);

      if (newEvents.length === 0) return prev;

      let merged = [...prev, ...newEvents];

      // Cap at MAX_EVENTS, dropping oldest
      if (merged.length > MAX_EVENTS) {
        const overflow = merged.length - MAX_EVENTS;
        merged = merged.slice(overflow);
        setTruncatedCount((c) => c + overflow);
      }

      return merged;
    });
  }, [sseEvents]);

  // ─── Update metadata from lifecycle SSE events ────────────────────

  useEffect(() => {
    if (sseEvents.length === 0) return;

    const now = new Date();

    for (const sse of sseEvents) {
      if (sse.type === "agent.completed") {
        setConversationMeta((prev) => ({
          ...prev,
          status: "completed",
          updatedAt: now,
        }));
      } else if (sse.type === "agent.paused") {
        setConversationMeta((prev) => ({
          ...prev,
          status: "waiting",
          updatedAt: now,
        }));
      } else if (sse.type === "agent.resumed") {
        setConversationMeta((prev) => ({
          ...prev,
          status: "running",
          updatedAt: now,
        }));
      }

      // Accumulate token totals from llm.response events
      if (sse.type === "llm.response") {
        // Token counts are available on the SseEvent
        // but not tracked in ConversationDetail -- we'll update lastEventAt
        setConversationMeta((prev) => ({
          ...prev,
          lastEventAt: new Date(sse.timestamp),
        }));
      }
    }
  }, [sseEvents]);

  // ─── Gap handling ─────────────────────────────────────────────────

  useEffect(() => {
    if (hasGap) {
      router.refresh();
    }
  }, [hasGap, router]);

  // ─── Auto-refresh on completion ───────────────────────────────────

  useEffect(() => {
    const hasCompleted = sseEvents.some((e) => e.type === "agent.completed");
    if (hasCompleted) {
      router.refresh();
    }
  }, [sseEvents, router]);

  // ─── Smart auto-scroll ────────────────────────────────────────────

  const timelineRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newEventsSinceScroll, setNewEventsSinceScroll] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setNewEventsSinceScroll(0);
    }
  }, []);

  // Auto-scroll when new events arrive and user is at bottom
  useEffect(() => {
    if (sseEventCount === 0) return;

    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      // Count events that arrived while scrolled up
      setNewEventsSinceScroll((prev) => prev + 1);
    }
  }, [sseEventCount, isAtBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setNewEventsSinceScroll(0);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Connection status indicator */}
      {isActive && (
        <div className="flex items-center justify-end">
          <ConnectionStatusIndicator status={connectionStatus} />
        </div>
      )}

      <DetailLayout
        timelinePanel={
          <div className="flex h-full flex-col">
            <h2 className="text-lg font-semibold">Event Timeline</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {events.length} events
              {truncatedCount > 0 && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  ({truncatedCount} older events truncated)
                </span>
              )}
            </p>

            {/* Truncation banner */}
            {truncatedCount > 0 && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {truncatedCount} older events were dropped to maintain the{" "}
                {MAX_EVENTS}-event buffer limit. Refresh the page to see the
                full history.
              </div>
            )}

            {/* Scrollable timeline container */}
            <div
              ref={timelineRef}
              onScroll={handleScroll}
              className="relative min-h-0 flex-1 overflow-auto"
            >
              <EventTimeline events={events} />
              <div ref={bottomRef} />
            </div>

            {/* "New events" pill */}
            {newEventsSinceScroll > 0 && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="sticky bottom-2 mx-auto mt-2 flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground shadow-md transition-opacity hover:opacity-90"
              >
                {newEventsSinceScroll} new event
                {newEventsSinceScroll > 1 ? "s" : ""} ↓
              </button>
            )}
          </div>
        }
        sidebarPanel={
          <MetadataSidebar
            conversation={conversationMeta}
            childConversations={serverChildren}
          />
        }
      />
    </div>
  );
}

// ─── Deserialization Helpers ─────────────────────────────────────────────────

function deserializeConversation(
  s: SerializedConversationDetail,
): ConversationDetail {
  return {
    ...s,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
    lastEventAt: s.lastEventAt ? new Date(s.lastEventAt) : null,
  };
}

function deserializeEvent(s: SerializedConversationEvent): ConversationEvent {
  return {
    ...s,
    timestamp: new Date(s.timestamp),
  };
}

function deserializeChild(s: SerializedChildConversation): ChildConversation {
  return {
    ...s,
    createdAt: new Date(s.createdAt),
  };
}

// ─── SSE to ConversationEvent Mapping ────────────────────────────────────────

/**
 * Convert an SseEvent from the SSE stream to a ConversationEvent
 * for the EventTimeline component.
 *
 * SseEvent lacks agentInstanceId and parentInstanceId fields,
 * so we provide defaults.
 */
function sseEventToConversationEvent(sse: SseEvent): ConversationEvent {
  return {
    id: sse.id,
    conversationId: sse.conversationId,
    agentDefinitionId: sse.agentDefinitionId,
    agentInstanceId: "", // Not available in SSE payload
    parentInstanceId: null, // Not available in SSE payload
    sequence: sse.sequence,
    type: sse.type,
    payload: sse.payload,
    timestamp: new Date(sse.timestamp),
    tokenCountInput: sse.tokenCountInput,
    tokenCountOutput: sse.tokenCountOutput,
    durationMs: sse.durationMs,
  };
}
