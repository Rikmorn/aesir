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
import { EventIcon } from "./event-icon";
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
      mcpErrorMap.get(toolCallId)!.push(event);
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

// ─── EventTimeline ──────────────────────────────────────────────────────────

interface EventTimelineProps {
  events: ConversationEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  const items = useMemo(() => groupTimelineEvents(events), [events]);

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No events recorded
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/50">
      {items.map((item) => {
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
              <EventItem
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
          case "lifecycle_banner":
            return (
              <EventItem
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
          case "sub_agent_lifecycle":
            return (
              <EventItem
                key={item.event.id}
                event={item.event}
                isSubAgent={true}
              />
            );
          case "signal":
            return (
              <EventItem
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
          case "generic":
            return (
              <EventItem
                key={item.event.id}
                event={item.event}
                isSubAgent={item.event.parentInstanceId !== null}
              />
            );
        }
      })}
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
          "transition-colors hover:bg-accent/50",
          isFailed && "border-l-2 border-l-destructive bg-destructive/5",
          isSubAgent && !isFailed && "ml-6",
        )}
      >
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}

          <EventIcon type={event.type} />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {formatEventType(event.type)}
              </span>
              {toolName && (
                <span className="truncate font-mono text-xs text-muted-foreground">
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

          <div className="flex shrink-0 items-center gap-3 font-mono text-xs tabular-nums text-muted-foreground">
            {event.durationMs !== null && (
              <span>{formatDurationMs(event.durationMs)}</span>
            )}
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
            {event.type === "agent.started" &&
            typeof event.payload.systemPrompt === "string" ? (
              <AgentStartedContent payload={event.payload} />
            ) : event.type === "llm.response" ? (
              <>
                <EventContentDisplay eventId={event.id} isExpanded={isOpen} />
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Raw payload
                  </summary>
                  <div className="mt-2">
                    <JsonPayload data={event.payload} />
                  </div>
                </details>
              </>
            ) : (
              <JsonPayload data={event.payload} />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── AgentStartedContent ─────────────────────────────────────────────────────

interface AgentStartedContentProps {
  payload: Record<string, unknown>;
}

/**
 * Renders the expanded content for an agent.started event.
 *
 * Shows:
 * 1. Initial context (the trigger/task that started the conversation)
 * 2. System prompt (collapsible, since it can be long)
 */
function AgentStartedContent({ payload }: AgentStartedContentProps) {
  const initialContext = payload.initialContext;
  const systemPrompt = payload.systemPrompt;

  return (
    <div className="space-y-4">
      {/* Initial Context / Task */}
      {typeof initialContext === "string" && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Initial Context
          </div>
          <div className="whitespace-pre-wrap rounded border bg-muted/30 p-3 text-sm">
            {initialContext}
          </div>
        </div>
      )}

      {/* System Prompt (collapsible) */}
      {typeof systemPrompt === "string" && (
        <details>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
            System Prompt ({systemPrompt.length.toLocaleString()} chars)
          </summary>
          <div className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-muted/20 p-3 text-xs text-muted-foreground">
            {systemPrompt}
          </div>
        </details>
      )}
    </div>
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
