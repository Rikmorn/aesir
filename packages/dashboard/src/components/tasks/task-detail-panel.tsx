"use client";

/**
 * Task Detail Panel
 *
 * Right-side drawer that opens when a delegation graph node is clicked.
 * Shows full task context: header, description, handshake, result, signals,
 * and conversation link. Renders orphan-specific banners when applicable.
 */

import { AlertTriangle, Bot, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/conversations/status-badge";
import { cn } from "@/lib/utils";
import type { TaskTreeNode, TimelineEvent } from "@/services/tasks";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  node: TaskTreeNode | null;
  events: TimelineEvent[];
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getElapsedLabel(
  createdAt: string,
  completedAt: string | null,
): string {
  const start = new Date(createdAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TaskDetailPanel({
  node,
  events,
  onClose,
}: TaskDetailPanelProps) {
  if (!node) return null;

  const isTerminal =
    node.status === "completed" ||
    node.status === "failed" ||
    node.status === "cancelled";

  // Detect orphaned status from events
  const orphanEvent = events.find(
    (e) => e.type === "signal.orphaned" && e.taskId === node.id,
  );
  const isOrphaned = !!orphanEvent;

  // Extract handshake info from timeline events (task:respond tool calls)
  // Events may store tool name as tool_name (snake_case) or toolName (camelCase)
  const handshakeEvent = events.find((e) => {
    if (e.type !== "tool.called" && e.type !== "tool.succeeded") return false;
    if (e.taskId !== node.id) return false;
    const p = e.payload as Record<string, unknown>;
    const tn =
      (p?.tool_name as string | undefined) ??
      (p?.toolName as string | undefined);
    return tn === "respond_task" || tn === "task:respond";
  });

  // Extract handshake details from metadata or event payload
  const metadata = node.metadata as Record<string, unknown> | null;
  const isCounterProposed = node.status === "counter_proposed";
  const isRejected = metadata?.rejected === true || !!metadata?.rejectionReason;
  const rejectionReason = metadata?.rejectionReason as string | undefined;
  const estimate = metadata?.estimate as string | undefined;
  const counterProposal = metadata?.proposal as string | undefined;

  // Filter signal events for this task
  const signalEvents = events.filter(
    (e) =>
      (e.type === "signal.received" || e.type === "signal.orphaned") &&
      e.taskId === node.id,
  );

  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-10 h-full w-[320px]",
        "bg-card border-l",
        "flex flex-col",
        "animate-in slide-in-from-right duration-200",
      )}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 pt-8 space-y-4">
        {/* Orphan banner */}
        {isOrphaned && (
          <div className="flex items-start gap-2 rounded-md bg-amber-100 p-3 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium">
                Orphaned -- result available but undelivered
              </p>
              {orphanEvent &&
                typeof (orphanEvent.payload as Record<string, unknown>)
                  ?.reason === "string" && (
                  <p className="mt-1 text-amber-700 dark:text-amber-400">
                    {(orphanEvent.payload as Record<string, string>).reason}
                  </p>
                )}
            </div>
          </div>
        )}

        {/* 1. Header: entity name, status badge, elapsed time */}
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold truncate">
              {node.entityName ?? node.assigneeId}
            </h3>
            <StatusBadge status={node.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {getElapsedLabel(node.createdAt, node.completedAt)} elapsed
          </p>
        </div>

        {/* 2. Description */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Description
          </h4>
          <p className="text-sm font-medium">{node.title}</p>
          {node.objective && (
            <p className="text-sm text-muted-foreground mt-1">
              {node.objective}
            </p>
          )}
        </div>

        {/* 3. Handshake detail */}
        {(handshakeEvent || isRejected || isCounterProposed || estimate) && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Handshake
            </h4>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    isRejected
                      ? "bg-red-500"
                      : isCounterProposed
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                  )}
                />
                <span>
                  {isRejected
                    ? "Rejected"
                    : isCounterProposed
                      ? "Counter-Proposed"
                      : "Accepted"}
                </span>
              </div>
              {estimate && (
                <p className="text-xs text-muted-foreground">
                  Estimate: {estimate}
                </p>
              )}
              {counterProposal && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Proposal: {counterProposal}
                </p>
              )}
              {rejectionReason && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Reason: {rejectionReason}
                </p>
              )}
              {handshakeEvent && (
                <p className="text-xs text-muted-foreground">
                  at {formatTime(handshakeEvent.timestamp)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 4. Result (terminal states only) */}
        {isTerminal && node.completionResult && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {node.status === "failed" ? "Failure" : "Result"}
            </h4>
            <pre className="rounded-md bg-muted p-2 text-xs overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
              {JSON.stringify(node.completionResult, null, 2)}
            </pre>
          </div>
        )}

        {/* Orphan inline result */}
        {isOrphaned && node.completionResult && !isTerminal && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Undelivered Result
            </h4>
            <pre className="rounded-md bg-amber-50 dark:bg-amber-900/20 p-2 text-xs overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto border border-amber-200 dark:border-amber-800">
              {JSON.stringify(node.completionResult, null, 2)}
            </pre>
          </div>
        )}

        {/* 5. Signals */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Signals
          </h4>
          {signalEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No signals</p>
          ) : (
            <div className="space-y-1">
              {signalEvents.map((event) => {
                const payload = event.payload as Record<string, unknown>;
                const signalType = payload?.signalType as string | undefined;

                // Determine display label and color for negotiation signals
                let signalLabel: string;
                let signalColor: string;

                if (event.type === "signal.orphaned") {
                  signalLabel = "orphaned";
                  signalColor = "text-amber-600 dark:text-amber-400";
                } else if (signalType === "task_counter_proposed") {
                  signalLabel = "counter-proposed";
                  signalColor = "text-amber-600 dark:text-amber-400";
                } else if (signalType === "task_clarification") {
                  signalLabel = "clarification";
                  signalColor = "text-blue-600 dark:text-blue-400";
                } else if (signalType === "task_clarification_response") {
                  signalLabel = "clarification response";
                  signalColor = "text-blue-600 dark:text-blue-400";
                } else {
                  signalLabel = String(signalType ?? event.type);
                  signalColor = "text-foreground";
                }

                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 text-xs"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {formatTime(event.timestamp)}
                    </span>
                    <span className={cn("font-medium", signalColor)}>
                      {signalLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 6. View conversation link */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Conversation
          </h4>
          {node.conversationId ? (
            <Link
              href={`/conversations/${node.conversationId}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Bot className="h-3.5 w-3.5" />
              View conversation
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">No conversation</p>
          )}
        </div>
      </div>
    </div>
  );
}
