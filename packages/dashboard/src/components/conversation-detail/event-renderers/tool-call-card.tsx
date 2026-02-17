"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatDurationMs, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConversationEvent } from "@/services/conversations";

import { EventIcon } from "../event-icon";
import { JsonPayload } from "../json-payload";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCallCardProps {
  /** The tool.called event */
  called: ConversationEvent;
  /** The tool.succeeded or tool.failed event (null = in progress) */
  result: ConversationEvent | null;
  /** MCP error events correlated to this tool call */
  mcpErrors: ConversationEvent[];
  /** Whether this is a sub-agent tool call (for indentation) */
  isSubAgent: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncate output for the collapsed preview line.
 */
function truncateOutput(output: unknown, maxLength = 80): string {
  const str = typeof output === "string" ? output : JSON.stringify(output);
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}...`;
}

/**
 * Extract the tool name from a tool.called event payload.
 */
function getToolName(called: ConversationEvent): string {
  const name = called.payload.tool_name ?? called.payload.name;
  return typeof name === "string" ? name : "unknown";
}

/**
 * Calculate duration between called and result events.
 */
function getDuration(
  called: ConversationEvent,
  result: ConversationEvent | null,
): number | null {
  if (!result) return null;
  if (result.durationMs !== null) return result.durationMs;
  // Fallback: calculate from timestamps
  const start = called.timestamp.getTime();
  const end = result.timestamp.getTime();
  const diff = end - start;
  return diff > 0 ? diff : null;
}

/**
 * Determine the status of the tool call.
 */
function getStatus(
  result: ConversationEvent | null,
): "success" | "failure" | "in-progress" {
  if (!result) return "in-progress";
  if (result.type === "tool.failed") return "failure";
  return "success";
}

/**
 * Count MCP retries (rate_limited events) for retry indicator.
 */
function getRetryCount(mcpErrors: ConversationEvent[]): number {
  return mcpErrors.filter((e) => e.type === "mcp.rate_limited").length;
}

/**
 * Get the collapsed preview text for the second line.
 */
function getPreviewText(
  result: ConversationEvent | null,
  status: "success" | "failure" | "in-progress",
): string {
  if (status === "in-progress") return "Running...";
  if (!result) return "";

  if (status === "failure") {
    const errorMessage =
      result.payload.error ?? result.payload.message ?? result.payload.output;
    return typeof errorMessage === "string"
      ? truncateOutput(errorMessage)
      : truncateOutput(result.payload);
  }

  const output = result.payload.output ?? result.payload.result;
  return truncateOutput(output);
}

// ─── Status Badge ────────────────────────────────────────────────────────────

const badgeStyles = {
  success: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
  failure: "bg-red-500/10 text-red-500 border border-red-500/20",
  "in-progress": "bg-muted text-muted-foreground border border-border",
} as const;

const badgeLabels = {
  success: "succeeded",
  failure: "failed",
  "in-progress": "running",
} as const;

function StatusBadge({
  status,
}: {
  status: "success" | "failure" | "in-progress";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        badgeStyles[status],
      )}
    >
      {badgeLabels[status]}
    </span>
  );
}

// ─── MCP Errors Section ──────────────────────────────────────────────────────

function McpErrorsSection({ errors }: { errors: ConversationEvent[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="mt-3 space-y-1">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        MCP Events ({errors.length})
      </div>
      {errors.map((error) => {
        const isRateLimited = error.type === "mcp.rate_limited";
        const message =
          typeof error.payload.message === "string"
            ? error.payload.message
            : typeof error.payload.error === "string"
              ? error.payload.error
              : JSON.stringify(error.payload);

        return (
          <div
            key={error.id}
            className={cn(
              "rounded px-2 py-1 text-xs",
              isRateLimited
                ? "bg-amber-500/10 text-amber-500"
                : "bg-red-500/10 text-red-500",
            )}
          >
            <span className="font-medium">
              {error.type === "mcp.rate_limited"
                ? "Rate limited"
                : error.type === "mcp.retries_exhausted"
                  ? "Retries exhausted"
                  : "MCP error"}
            </span>
            {" - "}
            {truncateOutput(message, 200)}
          </div>
        );
      })}
    </div>
  );
}

// ─── ToolCallCard ────────────────────────────────────────────────────────────

export function ToolCallCard({
  called,
  result,
  mcpErrors,
  isSubAgent,
}: ToolCallCardProps) {
  const status = getStatus(result);
  const isFailed = status === "failure";
  const [isOpen, setIsOpen] = useState(isFailed);

  const toolName = getToolName(called);
  const duration = getDuration(called, result);
  const retryCount = getRetryCount(mcpErrors);
  const previewText = getPreviewText(result, status);

  // Determine which event type to use for the icon
  const iconType = result ? result.type : "tool.called";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "transition-colors hover:bg-accent/50",
          isFailed && "border-l-2 border-l-destructive bg-destructive/5",
          isSubAgent && !isFailed && "ml-6",
        )}
      >
        {/* Collapsed header */}
        <CollapsibleTrigger className="flex w-full items-start gap-2 px-3 py-1.5 text-left">
          {isOpen ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}

          <EventIcon type={iconType} />

          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Line 1: tool name + badge + duration + timestamp */}
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm font-medium">
                {toolName}
              </span>
              <StatusBadge status={status} />
              {retryCount > 0 && (
                <span className="text-[10px] text-amber-500">
                  after {retryCount} {retryCount === 1 ? "retry" : "retries"}
                </span>
              )}
            </div>
            {/* Line 2: output preview */}
            <span
              className={cn(
                "truncate text-xs",
                status === "in-progress"
                  ? "italic text-muted-foreground"
                  : status === "failure"
                    ? "text-red-500/80"
                    : "text-muted-foreground",
              )}
            >
              {previewText}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-3 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            {duration !== null && <span>{formatDurationMs(duration)}</span>}
            <span className="font-sans">
              {formatRelativeTime(called.timestamp)}
            </span>
          </div>
        </CollapsibleTrigger>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="ml-10 border-l-2 border-border/50 pb-3 pl-3 pt-1">
            {/* Duration + timestamp pinned at top */}
            <div className="mb-3 flex items-center gap-3 font-mono text-xs text-muted-foreground">
              {duration !== null && (
                <span>Duration: {formatDurationMs(duration)}</span>
              )}
              <span>{called.timestamp.toLocaleTimeString()}</span>
            </div>

            {/* Input section */}
            <details className="mb-2">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                Input
              </summary>
              <div className="mt-2">
                <JsonPayload data={called.payload.input ?? called.payload} />
              </div>
            </details>

            {/* Output section */}
            <details open={isFailed} className="mb-2">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
                Output
              </summary>
              <div className="mt-2">
                {result ? (
                  <JsonPayload
                    data={
                      result.payload.output ??
                      result.payload.result ??
                      result.payload
                    }
                  />
                ) : (
                  <div className="py-2 text-sm italic text-muted-foreground">
                    Awaiting result...
                  </div>
                )}
              </div>
            </details>

            {/* MCP errors */}
            <McpErrorsSection errors={mcpErrors} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
