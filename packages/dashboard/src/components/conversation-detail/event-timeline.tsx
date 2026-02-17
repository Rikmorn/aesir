"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

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

import { EventContentDisplay } from "./event-content";
import type { FilterState } from "./event-filters";
import { EventIcon } from "./event-icon";
import { GenericEventRow } from "./event-renderers/generic-event-row";
import { LifecycleBanner } from "./event-renderers/lifecycle-banner";
import { SubAgentPill } from "./event-renderers/sub-agent-pill";
import { ToolCallCard } from "./event-renderers/tool-call-card";
import { JsonPayload } from "./json-payload";

// ─── Timeline Item Types ─────────────────────────────────────────────────────

export type TimelineItem =
  | {
      kind: "tool_card";
      called: ConversationEvent;
      result: ConversationEvent | null;
      mcpErrors: ConversationEvent[];
    }
  | { kind: "lifecycle_banner"; event: ConversationEvent }
  | { kind: "llm_response"; event: ConversationEvent }
  | { kind: "signal"; event: ConversationEvent }
  | { kind: "sub_agent_lifecycle"; event: ConversationEvent }
  | { kind: "generic"; event: ConversationEvent };

// ─── Event Grouping Pipeline ─────────────────────────────────────────────────

/**
 * Transform a flat array of conversation events into grouped timeline items.
 *
 * Tool events (called + succeeded/failed + MCP errors) are grouped by toolCallId
 * into single tool_card items. Non-tool events pass through as their typed kind.
 */
export function groupTimelineEvents(
  events: ConversationEvent[],
): TimelineItem[] {
  // 1. Build lookup maps by tool_call_id
  const toolCalledMap = new Map<string, ConversationEvent>();
  const toolResultMap = new Map<string, ConversationEvent>();
  const mcpErrorMap = new Map<string, ConversationEvent[]>();

  // 2. First pass: classify and index tool-related events
  const consumedEventIds = new Set<string>();

  for (const event of events) {
    const toolCallId = (event.payload.tool_call_id ??
      event.payload.toolCallId) as string | undefined;

    if (event.type === "tool.called" && toolCallId) {
      toolCalledMap.set(toolCallId, event);
      consumedEventIds.add(event.id);
    } else if (
      (event.type === "tool.succeeded" || event.type === "tool.failed") &&
      toolCallId
    ) {
      toolResultMap.set(toolCallId, event);
      consumedEventIds.add(event.id);
    } else if (
      (event.type === "mcp.error" ||
        event.type === "mcp.rate_limited" ||
        event.type === "mcp.retries_exhausted") &&
      toolCallId
    ) {
      if (!mcpErrorMap.has(toolCallId)) mcpErrorMap.set(toolCallId, []);
      mcpErrorMap.get(toolCallId)?.push(event);
      consumedEventIds.add(event.id);
    }
  }

  // 3. Second pass: walk events in order, emit timeline items
  const items: TimelineItem[] = [];
  const emittedToolCallIds = new Set<string>();

  for (const event of events) {
    const toolCallId = (event.payload.tool_call_id ??
      event.payload.toolCallId) as string | undefined;

    // Tool events: emit card at the position of tool.called
    if (
      event.type === "tool.called" &&
      toolCallId &&
      !emittedToolCallIds.has(toolCallId)
    ) {
      emittedToolCallIds.add(toolCallId);
      items.push({
        kind: "tool_card",
        called: event,
        result: toolResultMap.get(toolCallId) ?? null,
        mcpErrors: mcpErrorMap.get(toolCallId) ?? [],
      });
      continue;
    }

    // Skip consumed events (tool results, MCP errors already in cards)
    if (consumedEventIds.has(event.id)) continue;

    // MCP errors without toolCallId: render as standalone lifecycle banners
    if (
      event.type === "mcp.error" ||
      event.type === "mcp.rate_limited" ||
      event.type === "mcp.retries_exhausted"
    ) {
      items.push({ kind: "lifecycle_banner", event });
      continue;
    }

    // LLM responses
    if (event.type === "llm.response") {
      items.push({ kind: "llm_response", event });
      continue;
    }

    // Signals
    if (event.type === "signal.received" || event.type === "signal.orphaned") {
      items.push({ kind: "signal", event });
      continue;
    }

    // Lifecycle events (including sub-agent lifecycle)
    if (event.type.startsWith("agent.")) {
      if (
        event.parentInstanceId &&
        (event.type === "agent.started" || event.type === "agent.completed")
      ) {
        items.push({ kind: "sub_agent_lifecycle", event });
      } else {
        items.push({ kind: "lifecycle_banner", event });
      }
      continue;
    }

    // notification.failed
    if (event.type === "notification.failed") {
      items.push({ kind: "lifecycle_banner", event });
      continue;
    }

    // Everything else: generic fallback
    items.push({ kind: "generic", event });
  }

  return items;
}

// ─── Filter Logic ────────────────────────────────────────────────────────────

/**
 * Determine if a timeline item represents a failure.
 *
 * Used by the "Failures" filter chip: when active, failed items always show
 * regardless of their category filter state. This enables the "What went wrong?"
 * workflow where a user turns off all category chips except Failures.
 */
function isFailureItem(item: TimelineItem): boolean {
  if (item.kind === "tool_card") return item.result?.type === "tool.failed";
  if (item.kind === "lifecycle_banner") {
    return (
      item.event.type === "notification.failed" ||
      item.event.type === "agent.retry_scheduled" ||
      (item.event.type === "agent.stale_recovered" &&
        item.event.payload.exhausted === true)
    );
  }
  if (item.kind === "sub_agent_lifecycle") {
    return (
      item.event.type === "agent.completed" &&
      item.event.payload.status === "failed"
    );
  }
  return false;
}

/**
 * Determine if a timeline item should be visible given the current filter state.
 *
 * Filter behavior:
 * - Each category chip (Lifecycle, Tool calls, LLM) toggles its category
 * - Sub-agent chips toggle visibility of events from that specific agent
 * - Failures chip is ADDITIVE: when on, failed items show regardless of category
 * - Generic events always show (unknown types should never be hidden)
 */
function shouldShowItem(item: TimelineItem, filters: FilterState): boolean {
  // Resolve the primary event for sub-agent visibility check
  const event = item.kind === "tool_card" ? item.called : item.event;

  // Sub-agent visibility check (independent of category filters)
  if (event.parentInstanceId !== null) {
    const agentId = event.agentDefinitionId;
    if (filters.subAgents[agentId] === false) return false;
  }

  // Failures filter: when active, failed items always show
  if (isFailureItem(item) && filters.failures) return true;

  // Category visibility
  switch (item.kind) {
    case "tool_card":
      return filters.toolCalls;
    case "llm_response":
      return filters.llm;
    case "lifecycle_banner":
    case "sub_agent_lifecycle":
    case "signal":
      return filters.lifecycle;
    case "generic":
      return true;
  }
}

// ─── EventTimeline ──────────────────────────────────────────────────────────

interface EventTimelineProps {
  events: ConversationEvent[];
  filters: FilterState;
}

export function EventTimeline({ events, filters }: EventTimelineProps) {
  const items = useMemo(() => groupTimelineEvents(events), [events]);
  const filteredItems = useMemo(
    () => items.filter((item) => shouldShowItem(item, filters)),
    [items, filters],
  );

  if (filteredItems.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {items.length === 0
          ? "No events recorded"
          : "No events match the current filters"}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/50">
      {filteredItems.map((item) => {
        switch (item.kind) {
          case "tool_card":
            return (
              <ToolCallCard
                key={item.called.id}
                called={item.called}
                result={item.result}
                mcpErrors={item.mcpErrors}
                isSubAgent={item.called.parentInstanceId !== null}
              />
            );
          case "llm_response":
            return (
              <LlmResponseRow
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
          case "lifecycle_banner":
            return (
              <LifecycleBanner
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
          case "sub_agent_lifecycle":
            return (
              <SubAgentLifecycleRow key={item.event.id} event={item.event} />
            );
          case "signal":
            return (
              <LifecycleBanner
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
          case "generic":
            return (
              <GenericEventRow
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

// ─── SubAgentLifecycleRow ───────────────────────────────────────────────────

/**
 * Specialized renderer for sub-agent lifecycle events (started/completed).
 * Shows agent pill, event label, description excerpt, and timestamp.
 * Failed completions get destructive treatment.
 */
function SubAgentLifecycleRow({ event }: { event: ConversationEvent }) {
  const isStarted = event.type === "agent.started";
  const isFailed =
    event.type === "agent.completed" && event.payload.status === "failed";

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 ml-6",
        isFailed && "border-l-2 border-l-destructive bg-destructive/5",
      )}
    >
      <SubAgentPill agentDefinitionId={event.agentDefinitionId} />
      <EventIcon type={event.type} />
      <span className="text-sm">
        {isStarted
          ? `Spawned ${event.agentDefinitionId}`
          : `${event.agentDefinitionId} completed`}
      </span>
      <span className="flex-1 truncate text-xs text-muted-foreground">
        {getSubAgentDescription(event)}
      </span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {formatRelativeTime(event.timestamp)}
      </span>
    </div>
  );
}

/**
 * Extract a description string from a sub-agent lifecycle event payload.
 */
function getSubAgentDescription(event: ConversationEvent): string {
  if (event.type === "agent.started") {
    const task = event.payload.task;
    return typeof task === "string" ? truncateLabel(task, 120) : "";
  }
  if (event.type === "agent.completed") {
    const status = event.payload.status;
    const preview = event.payload.outputPreview;
    if (typeof status === "string" && typeof preview === "string") {
      return truncateLabel(`${status}: ${preview}`, 120);
    }
    return typeof status === "string" ? status : "";
  }
  return "";
}

// ─── LlmResponseRow ─────────────────────────────────────────────────────────

/**
 * Renderer for LLM response events. Preserves the original EventItem behavior
 * for llm.response: collapsible with EventContentDisplay and raw payload.
 */
function LlmResponseRow({
  event,
  isSubAgent,
}: {
  event: ConversationEvent;
  isSubAgent: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "transition-colors hover:bg-accent/50",
          isSubAgent && "ml-6",
        )}
      >
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}

          <EventIcon type={event.type} />

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-sm font-medium">
              {formatEventType(event.type)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-3 font-mono text-xs tabular-nums text-muted-foreground">
            {(event.tokenCountInput !== null ||
              event.tokenCountOutput !== null) && (
              <span>
                {formatTokenCount(event.tokenCountInput ?? 0)}/
                {formatTokenCount(event.tokenCountOutput ?? 0)}
              </span>
            )}
            <span className="font-sans">
              {formatRelativeTime(event.timestamp)}
            </span>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="ml-10 border-l-2 border-border/50 pb-3 pl-3 pt-1">
            <EventContentDisplay eventId={event.id} isExpanded={isOpen} />
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Raw payload
              </summary>
              <div className="mt-2">
                <JsonPayload data={event.payload} />
              </div>
            </details>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Truncate a label to maxLength characters, appending ellipsis if needed.
 */
function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength)}...`;
}
