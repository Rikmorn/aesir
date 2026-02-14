"use client";

/**
 * LiveOverview
 *
 * Client wrapper for the overview page that updates stat cards and
 * active conversations in real-time via SSE lifecycle events.
 *
 * Worker status, recent errors, and token usage remain server-rendered
 * (passed through as props and rendered without live updates).
 *
 * SSE events processed:
 * - agent.started:   running += 1, prepend to active conversations
 * - agent.completed: running -= 1, completedLast24h += 1, remove from active
 * - agent.paused:    running -= 1, waiting += 1, update status in active
 * - agent.resumed:   waiting -= 1, running += 1, update status in active
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActiveConversations } from "@/components/overview/active-conversations";
import { RecentErrors } from "@/components/overview/recent-errors";
import { StatCards } from "@/components/overview/stat-cards";
import { TokenUsage } from "@/components/overview/token-usage";
import { WorkerStatus } from "@/components/overview/worker-status";
import { useEventStream } from "@/hooks/use-event-stream";
import type { WorkerStatus as WorkerStatusType } from "@/lib/agent-service";
import { LIFECYCLE_EVENT_TYPES, type SseEvent } from "@/lib/sse-types";
import type {
  ActiveConversation,
  RecentError,
  StatusCounts,
  TokenUsageByAgent,
} from "@/services/overview";

// ─── Serialized Types ──────────────────────────────────────────────────────

/**
 * ActiveConversation with Date fields serialized as ISO strings
 * for crossing the server/client component boundary.
 */
export interface SerializedActiveConversation {
  id: string;
  agentDefinitionId: string;
  status: string;
  createdAt: string;
  lastEventType: string | null;
}

/**
 * RecentError with Date fields serialized as ISO strings.
 */
export interface SerializedRecentError {
  id: string;
  conversationId: string;
  agentDefinitionId: string;
  errorMessage: string;
  timestamp: string;
  type: "conversation" | "tool";
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface LiveOverviewProps {
  initialStatusCounts: StatusCounts;
  initialActiveConversations: SerializedActiveConversation[];
  workerStatus: WorkerStatusType | null;
  recentErrors: SerializedRecentError[];
  tokenUsage: TokenUsageByAgent[];
  defaultTokenTimeRange: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Deserialize ISO string dates back to Date objects for ActiveConversation */
function deserializeConversations(
  serialized: SerializedActiveConversation[],
): ActiveConversation[] {
  return serialized.map((c) => ({
    ...c,
    createdAt: new Date(c.createdAt),
  }));
}

/** Deserialize ISO string dates back to Date objects for RecentError */
function deserializeErrors(serialized: SerializedRecentError[]): RecentError[] {
  return serialized.map((e) => ({
    ...e,
    timestamp: new Date(e.timestamp),
  }));
}

// ─── Stat count field keys matching StatusCounts ────────────────────────────

type StatField = keyof StatusCounts;

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveOverview({
  initialStatusCounts,
  initialActiveConversations,
  workerStatus,
  recentErrors,
  tokenUsage,
  defaultTokenTimeRange,
}: LiveOverviewProps) {
  const router = useRouter();

  // ── SSE Connection ──────────────────────────────────────────────────────
  const { events, hasGap } = useEventStream({
    url: "/dashboard/api/sse/events",
    types: LIFECYCLE_EVENT_TYPES,
  });

  // ── State ───────────────────────────────────────────────────────────────
  const [statusCounts, setStatusCounts] =
    useState<StatusCounts>(initialStatusCounts);
  const [activeConversations, setActiveConversations] = useState<
    SerializedActiveConversation[]
  >(initialActiveConversations);
  const [highlightedFields, setHighlightedFields] = useState<Set<StatField>>(
    new Set(),
  );

  // Track conversation status for correct decrements
  const statusMapRef = useRef<Map<string, string>>(new Map());

  // Initialize status map from initial active conversations
  useEffect(() => {
    const map = new Map<string, string>();
    for (const conv of initialActiveConversations) {
      map.set(conv.id, conv.status);
    }
    statusMapRef.current = map;
  }, [initialActiveConversations]);

  // ── Highlight Timer ─────────────────────────────────────────────────────
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerHighlight = useCallback((fields: StatField[]) => {
    if (fields.length === 0) return;

    setHighlightedFields(new Set(fields));

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedFields(new Set());
      highlightTimerRef.current = null;
    }, 1500);
  }, []);

  // Cleanup highlight timer on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // ── Track processed events to avoid re-processing ─────────────────────
  const processedCountRef = useRef(0);

  // ── Process SSE Events ──────────────────────────────────────────────────
  useEffect(() => {
    if (events.length <= processedCountRef.current) return;

    const newEvents = events.slice(processedCountRef.current);
    processedCountRef.current = events.length;

    const changedFields = new Set<StatField>();

    for (const event of newEvents) {
      processEvent(
        event,
        statusMapRef,
        setStatusCounts,
        setActiveConversations,
        changedFields,
      );
    }

    if (changedFields.size > 0) {
      triggerHighlight([...changedFields]);
    }
  }, [events, triggerHighlight]);

  // ── Gap Handling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasGap) {
      router.refresh();
    }
  }, [hasGap, router]);

  // ── Deserialized data for presentational components ─────────────────────
  const conversations = deserializeConversations(activeConversations);
  const errors = deserializeErrors(recentErrors);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 px-6 py-6">
      <StatCards counts={statusCounts} highlightedFields={highlightedFields} />

      <ActiveConversations conversations={conversations} />

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentErrors errors={errors} />
        <TokenUsage
          data={tokenUsage}
          defaultTimeRange={defaultTokenTimeRange}
        />
      </div>

      <WorkerStatus status={workerStatus} />
    </div>
  );
}

// ─── Event Processing ───────────────────────────────────────────────────────

/**
 * Process a single SSE lifecycle event, updating stat counts and active
 * conversations list. Mutates the changedFields set to track which stat
 * cards need highlighting.
 */
function processEvent(
  event: SseEvent,
  statusMapRef: React.RefObject<Map<string, string>>,
  setStatusCounts: React.Dispatch<React.SetStateAction<StatusCounts>>,
  setActiveConversations: React.Dispatch<
    React.SetStateAction<SerializedActiveConversation[]>
  >,
  changedFields: Set<StatField>,
): void {
  const { conversationId, agentDefinitionId, type, timestamp } = event;

  switch (type) {
    case "agent.started": {
      // Update counts: running += 1
      setStatusCounts((prev) => ({
        ...prev,
        running: prev.running + 1,
      }));
      changedFields.add("running");

      // Track status
      statusMapRef.current.set(conversationId, "running");

      // Prepend to active conversations
      setActiveConversations((prev) => {
        // Avoid duplicates
        if (prev.some((c) => c.id === conversationId)) return prev;
        return [
          {
            id: conversationId,
            agentDefinitionId,
            status: "running",
            createdAt: timestamp,
            lastEventType: type,
          },
          ...prev,
        ];
      });
      break;
    }

    case "agent.completed": {
      // Get current status for correct decrement
      const currentStatus = statusMapRef.current.get(conversationId);

      setStatusCounts((prev) => {
        const next = { ...prev, completedLast24h: prev.completedLast24h + 1 };
        if (currentStatus === "waiting") {
          next.waiting = Math.max(0, prev.waiting - 1);
          changedFields.add("waiting");
        } else {
          next.running = Math.max(0, prev.running - 1);
          changedFields.add("running");
        }
        return next;
      });
      changedFields.add("completedLast24h");

      // Remove from status map
      statusMapRef.current.delete(conversationId);

      // Remove from active conversations
      setActiveConversations((prev) =>
        prev.filter((c) => c.id !== conversationId),
      );
      break;
    }

    case "agent.paused": {
      // running -= 1, waiting += 1
      setStatusCounts((prev) => ({
        ...prev,
        running: Math.max(0, prev.running - 1),
        waiting: prev.waiting + 1,
      }));
      changedFields.add("running");
      changedFields.add("waiting");

      // Track status
      statusMapRef.current.set(conversationId, "waiting");

      // Update status in active conversations
      setActiveConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, status: "waiting", lastEventType: type }
            : c,
        ),
      );
      break;
    }

    case "agent.resumed": {
      // waiting -= 1, running += 1
      setStatusCounts((prev) => ({
        ...prev,
        waiting: Math.max(0, prev.waiting - 1),
        running: prev.running + 1,
      }));
      changedFields.add("waiting");
      changedFields.add("running");

      // Track status
      statusMapRef.current.set(conversationId, "running");

      // Update status in active conversations
      setActiveConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, status: "running", lastEventType: type }
            : c,
        ),
      );
      break;
    }
  }
}
