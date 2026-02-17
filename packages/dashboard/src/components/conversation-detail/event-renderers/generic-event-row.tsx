import { formatEventType, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConversationEvent } from "@/services/conversations";

import { EventIcon } from "../event-icon";
import { JsonPayload } from "../json-payload";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GenericEventRowProps {
  event: ConversationEvent;
  isSubAgent: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Fallback renderer for unknown event types.
 *
 * New event types added to agent-service are immediately visible in the
 * dashboard without code changes -- shows a type label and formatted JSON payload.
 */
export function GenericEventRow({ event, isSubAgent }: GenericEventRowProps) {
  const hasPayload = Object.keys(event.payload).length > 0;

  return (
    <div className={cn("px-3 py-2", isSubAgent && "ml-6")}>
      <div className="flex items-center gap-2">
        <EventIcon type={event.type} />
        <span className="text-xs font-medium text-muted-foreground">
          {formatEventType(event.type)}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatRelativeTime(event.timestamp)}
        </span>
      </div>
      {hasPayload && (
        <div className="ml-6 mt-1">
          <JsonPayload data={event.payload} />
        </div>
      )}
    </div>
  );
}
