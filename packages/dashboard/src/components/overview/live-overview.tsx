"use client";

/**
 * LiveOverview
 *
 * Two-zone layout: compact metrics bar (stat cards + worker status) pinned
 * at top, then a two-column live feed filling the remaining viewport.
 *
 * Left column: Active Conversations (wider)
 * Right column: Recent Errors (top) + Token Usage (bottom)
 *
 * SSE events update stat cards and active conversations in real-time.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActiveConversations } from "@/components/overview/active-conversations";
import { RecentErrors } from "@/components/overview/recent-errors";
import { StatCards } from "@/components/overview/stat-cards";
import { TokenUsage } from "@/components/overview/token-usage";
import {
  type EnrichedToolActivity,
  ToolActivity,
} from "@/components/overview/tool-activity";
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

export interface SerializedActiveConversation {
  id: string;
  agentDefinitionId: string;
  status: string;
  createdAt: string;
  lastEventType: string | null;
}

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
  toolActivity: EnrichedToolActivity[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deserializeConversations(
  serialized: SerializedActiveConversation[],
): ActiveConversation[] {
  return serialized.map((c) => ({
    ...c,
    createdAt: new Date(c.createdAt),
  }));
}

function deserializeErrors(serialized: SerializedRecentError[]): RecentError[] {
  return serialized.map((e) => ({
    ...e,
    timestamp: new Date(e.timestamp),
  }));
}

// ─── Stat count field keys ─────────────────────────────────────────────────

type StatField = keyof StatusCounts;

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveOverview({
  initialStatusCounts,
  initialActiveConversations,
  workerStatus,
  recentErrors,
  tokenUsage,
  defaultTokenTimeRange,
  toolActivity,
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

  const statusMapRef = useRef<Map<string, string>>(new Map());

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

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // ── Track processed events ──────────────────────────────────────────────
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

  // ── Deserialized data ───────────────────────────────────────────────────
  const conversations = deserializeConversations(activeConversations);
  const errors = deserializeErrors(recentErrors);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Zone 1: Metrics bar */}
      <div className="mb-4 shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <StatCards
            counts={statusCounts}
            highlightedFields={highlightedFields}
          />
          <WorkerStatus status={workerStatus} />
        </div>
      </div>

      {/* Zone 2: Live feeds — fills remaining viewport */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* Left: Active Conversations */}
        <div className="min-h-0">
          <ActiveConversations conversations={conversations} />
        </div>

        {/* Right: Tool Activity + Errors + Token Usage stacked */}
        <div className="flex min-h-0 flex-col gap-4">
          <div className="max-h-[240px] min-h-0 shrink-0">
            <ToolActivity tools={toolActivity} />
          </div>
          <div className="min-h-0 flex-1">
            <RecentErrors errors={errors} />
          </div>
          <div className="min-h-0 flex-1">
            <TokenUsage
              data={tokenUsage}
              defaultTimeRange={defaultTokenTimeRange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Event Processing ───────────────────────────────────────────────────────

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
      setStatusCounts((prev) => ({
        ...prev,
        running: prev.running + 1,
      }));
      changedFields.add("running");

      statusMapRef.current.set(conversationId, "running");

      setActiveConversations((prev) => {
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

      statusMapRef.current.delete(conversationId);

      setActiveConversations((prev) =>
        prev.filter((c) => c.id !== conversationId),
      );
      break;
    }

    case "agent.paused": {
      setStatusCounts((prev) => ({
        ...prev,
        running: Math.max(0, prev.running - 1),
        waiting: prev.waiting + 1,
      }));
      changedFields.add("running");
      changedFields.add("waiting");

      statusMapRef.current.set(conversationId, "waiting");

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
      setStatusCounts((prev) => ({
        ...prev,
        waiting: Math.max(0, prev.waiting - 1),
        running: prev.running + 1,
      }));
      changedFields.add("waiting");
      changedFields.add("running");

      statusMapRef.current.set(conversationId, "running");

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
