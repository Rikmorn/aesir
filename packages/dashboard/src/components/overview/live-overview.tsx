"use client";

/**
 * LiveOverview
 *
 * Scrollable landing page layout:
 * 1. Page header with agent service status
 * 2. Stat cards (conversation counts with filter links)
 * 3. Two-column grid: Active Conversations + Recent Errors
 * 4. Two-column grid: Token Usage (hourly) + Integration Health (error rates)
 *
 * SSE events update stat cards and active conversations in real-time.
 * Charts are point-in-time snapshots refreshed via time range selector.
 */

import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActiveConversations } from "@/components/overview/active-conversations";
import { IntegrationHealth } from "@/components/overview/integration-health";
import { RecentErrors } from "@/components/overview/recent-errors";
import { StatCards } from "@/components/overview/stat-cards";
import { TokenUsage } from "@/components/overview/token-usage";
import { UpcomingSchedulesCard } from "@/components/overview/upcoming-schedules-card";
import { WorkerStatus } from "@/components/overview/worker-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEventStream } from "@/hooks/use-event-stream";
import type {
  IntegrationHealth as IntegrationHealthType,
  ScheduleState,
  WorkerStatus as WorkerStatusType,
} from "@/lib/agent-service";
import { getDefaultResolution, getResolutionOptions } from "@/lib/format";
import { LIFECYCLE_EVENT_TYPES, type SseEvent } from "@/lib/sse-types";
import type {
  ActiveConversation,
  IntegrationErrorRates,
  RecentError,
  StatusCounts,
  TokenUsageBucket,
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

// ─── Time Range Options ────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface LiveOverviewProps {
  initialStatusCounts: StatusCounts;
  initialActiveConversations: SerializedActiveConversation[];
  workerStatus: WorkerStatusType | null;
  recentErrors: SerializedRecentError[];
  tokenUsageBuckets: TokenUsageBucket[];
  integrationErrorRates: IntegrationErrorRates;
  integrationHealth: IntegrationHealthType[];
  scheduleStates: ScheduleState[];
  defaultTimeRange: string;
  defaultResolution: string;
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
  tokenUsageBuckets,
  integrationErrorRates,
  integrationHealth,
  scheduleStates,
  defaultTimeRange,
  defaultResolution,
}: LiveOverviewProps) {
  const router = useRouter();

  // ── Time Range + Resolution ───────────────────────────────────────────
  const [timeRange, setTimeRange] = useQueryState(
    "timeRange",
    parseAsString.withDefault(defaultTimeRange).withOptions({ shallow: false }),
  );

  const [resolution, setResolution] = useQueryState(
    "resolution",
    parseAsString
      .withDefault(defaultResolution)
      .withOptions({ shallow: false }),
  );

  const resolutionOptions = getResolutionOptions(timeRange);

  // Reset resolution to default when time range changes
  const prevTimeRangeRef = useRef(timeRange);
  useEffect(() => {
    if (prevTimeRangeRef.current !== timeRange) {
      prevTimeRangeRef.current = timeRange;
      setResolution(getDefaultResolution(timeRange));
    }
  }, [timeRange, setResolution]);

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

  const timeRangeLabel =
    TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label ?? timeRange;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            System monitoring and agent health
          </p>
        </div>
        <WorkerStatus status={workerStatus} />
      </div>

      {/* Stat cards */}
      <StatCards counts={statusCounts} highlightedFields={highlightedFields} />

      {/* Main content: Active Conversations + Recent Errors */}
      <div className="grid h-[400px] gap-4 lg:grid-cols-[3fr_2fr]">
        <ActiveConversations conversations={conversations} />
        <RecentErrors errors={errors} />
      </div>

      {/* Upcoming Schedules */}
      <UpcomingSchedulesCard scheduleStates={scheduleStates} />

      {/* Charts section header with time range + resolution */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Trends
        </span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Range</span>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger size="sm" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="end">
                {TIME_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Interval</span>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger size="sm" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="end">
                {resolutionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Charts: Token Usage + Integration Health */}
      <div className="grid h-[280px] gap-4 lg:grid-cols-[3fr_2fr]">
        <TokenUsage
          data={tokenUsageBuckets}
          timeRangeLabel={timeRangeLabel}
          resolution={resolution}
        />
        <IntegrationHealth
          errorRates={integrationErrorRates}
          health={integrationHealth}
          timeRangeLabel={timeRangeLabel}
        />
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
