import {
  formatDurationMs,
  formatEventType,
  formatRelativeTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConversationEvent } from "@/services/conversations";

import { EventIcon } from "../event-icon";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LifecycleBannerProps {
  event: ConversationEvent;
  isSubAgent: boolean;
}

// ─── Severity Styling ───────────────────────────────────────────────────────

type SeverityClasses = { bg: string; border: string };

const SEVERITY_MAP: Record<string, SeverityClasses> = {
  "agent.stale_recovered": {
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
  },
  "agent.retry_scheduled": {
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
  },
  "notification.failed": {
    bg: "bg-destructive/5",
    border: "border-destructive/20",
  },
};

const DEFAULT_SEVERITY: SeverityClasses = {
  bg: "bg-muted/30",
  border: "border-border/50",
};

// ─── Description Extraction ─────────────────────────────────────────────────

function getLifecycleDescription(event: ConversationEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "agent.paused":
      return typeof p.reason === "string" ? p.reason : "Waiting for signal";
    case "agent.resumed":
      return typeof p.signalType === "string"
        ? `Signal: ${p.signalType}`
        : "Resumed";
    case "agent.reopened":
      return typeof p.reason === "string" ? p.reason : "Conversation reopened";
    case "agent.stale_recovered": {
      const duration =
        typeof p.staleDurationMs === "number"
          ? formatDurationMs(p.staleDurationMs)
          : "unknown";
      const exhausted = p.exhausted ? " (max retries exceeded)" : "";
      return `Stale heartbeat recovered after ${duration}${exhausted}`;
    }
    case "agent.retry_scheduled": {
      const count = typeof p.retryCount === "number" ? p.retryCount : "?";
      const max = typeof p.maxRetries === "number" ? p.maxRetries : "?";
      return `Retry ${count}/${max} scheduled`;
    }
    case "notification.failed": {
      const channel = typeof p.channel === "string" ? p.channel : "unknown";
      const error = typeof p.error === "string" ? `: ${p.error}` : "";
      return `Failed to notify ${channel}${error}`;
    }
    default:
      return formatEventType(event.type);
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LifecycleBanner({ event, isSubAgent }: LifecycleBannerProps) {
  const severity = SEVERITY_MAP[event.type] ?? DEFAULT_SEVERITY;
  const description = getLifecycleDescription(event);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded px-3 py-1 text-xs border",
        severity.bg,
        severity.border,
        isSubAgent && "ml-6",
      )}
    >
      <EventIcon type={event.type} />
      <span className="font-medium">{formatEventType(event.type)}</span>
      <span className="flex-1 truncate text-muted-foreground">
        {description}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
        {formatRelativeTime(event.timestamp)}
      </span>
    </div>
  );
}
