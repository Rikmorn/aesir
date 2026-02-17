"use client";

/**
 * LiveDetailPanels
 *
 * Client wrapper for the conversation detail page that adds real-time updates
 * via SSE. Renders the breadcrumb header with inline metadata, error banner,
 * relationship links, and full-width event timeline.
 *
 * Key behaviors:
 * - SSE connection only active when conversation status is "running" or "waiting"
 * - Smart auto-scroll: scrolls to bottom when user is at bottom, shows pill when scrolled up
 * - Event buffer capped at 1000 events with truncation indicator
 * - Metadata (status, timestamps, tokens) updated from lifecycle SSE events
 * - Gap detection triggers router.refresh() for full data reload
 */

import { Bot, Check, Copy, GitBranch, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  StatusBadge,
  statusConfig,
} from "@/components/conversations/status-badge";
import { Button } from "@/components/ui/button";
import { ConnectionStatusIndicator } from "@/components/ui/connection-status";
import { useEventStream } from "@/hooks/use-event-stream";
import { formatDuration, formatTokenCount } from "@/lib/format";
import type { SseEvent } from "@/lib/sse-types";
import { cn } from "@/lib/utils";
import type {
  ChildConversation,
  ConversationDetail,
  ConversationEvent,
} from "@/services/conversations";

import {
  DEFAULT_FILTER_STATE,
  EventFilters,
  type FilterState,
} from "./event-filters";
import { EventMetricsBar } from "./event-metrics-bar";
import { EventTimeline } from "./event-timeline";
import { ReopenDialog } from "./reopen-dialog";

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
  extends Omit<ChildConversation, "createdAt" | "updatedAt"> {
  createdAt: string;
  updatedAt: string;
}

export interface LiveDetailPanelsProps {
  conversation: SerializedConversationDetail;
  initialEvents: SerializedConversationEvent[];
  childConversations: SerializedChildConversation[];
  rootTaskId: string | null;
  initialTokenInput: number;
  initialTokenOutput: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_EVENTS = 1000;
const SCROLL_THRESHOLD_PX = 100;

// ─── Component ─────────────────────────────────────────────────────────────

export function LiveDetailPanels({
  conversation: initialConversation,
  initialEvents,
  childConversations: initialChildren,
  rootTaskId,
  initialTokenInput,
  initialTokenOutput,
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
  const [tokenInput, setTokenInput] = useState(initialTokenInput);
  const [tokenOutput, setTokenOutput] = useState(initialTokenOutput);
  const [copied, setCopied] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);

  // Reset state when server data changes (e.g., after router.refresh())
  useEffect(() => {
    setEvents(serverEvents);
    setTruncatedCount(0);
  }, [serverEvents]);

  useEffect(() => {
    setConversationMeta(serverConversation);
  }, [serverConversation]);

  useEffect(() => {
    setTokenInput(initialTokenInput);
    setTokenOutput(initialTokenOutput);
  }, [initialTokenInput, initialTokenOutput]);

  // ─── SSE connection ───────────────────────────────────────────────

  const isActive =
    conversationMeta.status === "running" ||
    conversationMeta.status === "waiting" ||
    conversationMeta.status === "queued";

  const isTerminal =
    conversationMeta.status === "completed" ||
    conversationMeta.status === "failed";

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

      // Accumulate tokens from new events (split input/output)
      const newInput = newEvents.reduce(
        (sum, e) => sum + (e.tokenCountInput ?? 0),
        0,
      );
      const newOutput = newEvents.reduce(
        (sum, e) => sum + (e.tokenCountOutput ?? 0),
        0,
      );
      if (newInput > 0) setTokenInput((prev) => prev + newInput);
      if (newOutput > 0) setTokenOutput((prev) => prev + newOutput);

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
      } else if (sse.type === "agent.reopened") {
        setConversationMeta((prev) => ({
          ...prev,
          status: "queued",
          reopenCount: prev.reopenCount + 1,
          updatedAt: now,
        }));
      }

      if (sse.type === "agent.retry_scheduled") {
        setConversationMeta((prev) => ({
          ...prev,
          retryCount: prev.retryCount + 1,
        }));
      }

      if (sse.type === "llm.response") {
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
      setNewEventsSinceScroll((prev) => prev + 1);
    }
  }, [sseEventCount, isAtBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setNewEventsSinceScroll(0);
  }, []);

  // ─── Elapsed time (ticks every second for active conversations) ──

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  const elapsedLabel = useMemo(() => {
    const endTime = isActive ? now : conversationMeta.updatedAt;
    const duration = formatDuration(conversationMeta.createdAt, endTime);

    if (conversationMeta.status === "completed")
      return `Completed in ${duration}`;
    if (conversationMeta.status === "failed") return `Failed after ${duration}`;
    return duration;
  }, [
    isActive,
    now,
    conversationMeta.createdAt,
    conversationMeta.updatedAt,
    conversationMeta.status,
  ]);

  // ─── Derived sub-agent IDs and tool metrics ─────────────────────

  const subAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.parentInstanceId !== null) {
        ids.add(event.agentDefinitionId);
      }
    }
    return Array.from(ids).sort();
  }, [events]);

  const toolMetrics = useMemo(() => {
    let toolSuccessCount = 0;
    let toolFailCount = 0;
    for (const event of events) {
      if (event.type === "tool.succeeded") toolSuccessCount++;
      if (event.type === "tool.failed") toolFailCount++;
    }
    return {
      toolSuccessCount,
      toolTotalCount: toolSuccessCount + toolFailCount,
    };
  }, [events]);

  // ─── Copy conversation ID ───────────────────────────────────────

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(serverConversation.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [serverConversation.id]);

  // ─── Derived display values ───────────────────────────────────────

  const tokenTotal = tokenInput + tokenOutput;
  const hasTokens = tokenTotal > 0;
  const hasError =
    conversationMeta.status === "failed" && !!conversationMeta.errorMessage;
  const hasParent = !!conversationMeta.parentConversationId;
  const hasChildren = serverChildren.length > 0;
  const hasArtifacts =
    conversationMeta.artifacts &&
    Object.keys(conversationMeta.artifacts).length > 0;

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Page header */}
      <div className="shrink-0">
        {/* Row 1: breadcrumb + identity + actions */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href="/conversations"
              className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Conversations
            </Link>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="truncate text-sm font-semibold tracking-tight">
              {conversationMeta.agentDefinitionId}
            </span>
            <StatusBadge status={conversationMeta.status} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="xs" asChild>
              <Link href={`/agents/${conversationMeta.agentDefinitionId}`}>
                <Bot className="h-3 w-3" />
                Agent
              </Link>
            </Button>
            {rootTaskId && (
              <Button variant="ghost" size="xs" asChild>
                <Link href={`/tasks/${rootTaskId}`}>
                  <GitBranch className="h-3 w-3" />
                  Task tree
                </Link>
              </Button>
            )}
            {isTerminal && (
              <ReopenDialog
                conversationId={serverConversation.id}
                status={conversationMeta.status}
                onReopened={() => router.refresh()}
              />
            )}
            {isActive && (
              <ConnectionStatusIndicator status={connectionStatus} />
            )}
          </div>
        </div>

        {/* Row 2: metadata strip */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[1px] text-muted-foreground">
          <button
            type="button"
            onClick={handleCopyId}
            className="inline-flex items-center gap-1 font-mono text-xs transition-colors hover:text-foreground"
            title={serverConversation.id}
          >
            {truncateId(serverConversation.id)}
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <span className="text-xs">&middot;</span>
          <span className="text-xs">
            v{conversationMeta.agentDefinitionVersion}
          </span>
          <span className="text-xs">&middot;</span>
          <span className="font-mono text-xs tabular-nums">{elapsedLabel}</span>
          {hasTokens && (
            <>
              <span className="text-xs">&middot;</span>
              <span className="font-mono text-xs tabular-nums">
                {formatTokenCount(tokenInput)} in &frasl;{" "}
                {formatTokenCount(tokenOutput)} out
              </span>
            </>
          )}
          {conversationMeta.reopenCount > 0 && (
            <>
              <span className="text-xs">&middot;</span>
              <span className="inline-flex items-center gap-1 text-xs">
                <RotateCcw className="h-3 w-3" />
                {conversationMeta.reopenCount}
              </span>
            </>
          )}
          {conversationMeta.retryCount > 0 && (
            <>
              <span className="text-xs">&middot;</span>
              <span className="font-mono text-xs tabular-nums">
                {conversationMeta.retryCount} retries
              </span>
            </>
          )}
        </div>

        {/* Error banner (always visible when failed) */}
        {hasError && (
          <div className="mt-2 max-h-[120px] overflow-auto rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
            <p className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-400">
              {conversationMeta.errorMessage}
            </p>
          </div>
        )}

        {/* Relationships: parent + children */}
        {(hasParent || hasChildren) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {hasParent && (
              <span className="inline-flex items-center gap-1">
                &larr;
                <Link
                  href={`/conversations/${conversationMeta.parentConversationId}`}
                  className="font-mono text-primary underline-offset-4 hover:underline"
                >
                  {truncateId(conversationMeta.parentConversationId ?? "")}
                </Link>
              </span>
            )}
            {hasChildren &&
              serverChildren.map((child) => {
                const cfg = statusConfig[child.status];
                return (
                  <Link
                    key={child.id}
                    href={`/conversations/${child.id}`}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                  >
                    <span className="text-border">&rarr;</span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        cfg?.dotClassName ?? "bg-muted-foreground",
                      )}
                    />
                    {child.agentDefinitionId}
                  </Link>
                );
              })}
          </div>
        )}

        {/* Artifacts (only when they exist) */}
        {hasArtifacts && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {Object.entries(conversationMeta.artifacts).map(([key, value]) => (
              <span key={key} className="inline-flex items-center gap-1">
                <span className="font-medium">{key}:</span>
                {isUrl(value) ? (
                  <a
                    href={value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {value}
                  </a>
                ) : (
                  <span>{value}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Event timeline — fills remaining viewport height */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
        {/* Header — pinned outside scroll */}
        <div className="shrink-0 border-b">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">
                Event Timeline
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {events.length} events
                {truncatedCount > 0 && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">
                    ({truncatedCount} truncated)
                  </span>
                )}
              </span>
            </div>
            {/* Jump to end button for completed conversations */}
            {isTerminal && events.length > 20 && (
              <Button variant="ghost" size="xs" onClick={scrollToBottom}>
                Jump to end
              </Button>
            )}
          </div>

          {/* Metrics bar */}
          <div className="border-t px-4 py-2">
            <EventMetricsBar
              wallClockDuration={elapsedLabel}
              tokenInput={tokenInput}
              tokenOutput={tokenOutput}
              toolSuccessCount={toolMetrics.toolSuccessCount}
              toolTotalCount={toolMetrics.toolTotalCount}
              retryCount={conversationMeta.retryCount}
            />
          </div>

          {/* Filter chips */}
          <div className="border-t px-4 py-2">
            <EventFilters
              filters={filters}
              onFiltersChange={setFilters}
              subAgentIds={subAgentIds}
            />
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={timelineRef}
            onScroll={handleScroll}
            className="h-full overflow-auto overscroll-y-contain p-3 pb-6"
          >
            {/* Truncation banner */}
            {truncatedCount > 0 && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {truncatedCount} older events were dropped to maintain the{" "}
                {MAX_EVENTS}-event buffer limit. Refresh the page to see the
                full history.
              </div>
            )}

            <EventTimeline events={events} filters={filters} />
            <div ref={bottomRef} />
          </div>

          {/* Fade gradient */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />

          {/* "New events" pill */}
          {newEventsSinceScroll > 0 && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground shadow-md transition-opacity hover:opacity-90"
            >
              {newEventsSinceScroll} new event
              {newEventsSinceScroll > 1 ? "s" : ""} &darr;
            </button>
          )}
        </div>
      </div>
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
    updatedAt: new Date(s.updatedAt),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function sseEventToConversationEvent(sse: SseEvent): ConversationEvent {
  return {
    id: sse.id,
    conversationId: sse.conversationId,
    agentDefinitionId: sse.agentDefinitionId,
    agentInstanceId: sse.agentInstanceId ?? "",
    parentInstanceId: sse.parentInstanceId ?? null,
    sequence: sse.sequence,
    type: sse.type,
    payload: sse.payload,
    timestamp: new Date(sse.timestamp),
    tokenCountInput: sse.tokenCountInput,
    tokenCountOutput: sse.tokenCountOutput,
    durationMs: sse.durationMs,
  };
}

function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}
