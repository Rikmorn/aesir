import { Clock } from "lucide-react";

import { formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EventMetricsBarProps {
  wallClockDuration: string; // Pre-formatted duration string
  tokenInput: number;
  tokenOutput: number;
  toolSuccessCount: number;
  toolTotalCount: number;
  retryCount: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EventMetricsBar({
  wallClockDuration,
  tokenInput,
  tokenOutput,
  toolSuccessCount,
  toolTotalCount,
  retryCount,
}: EventMetricsBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" />
        <span className="font-mono tabular-nums">{wallClockDuration}</span>
      </span>
      <span className="text-border">|</span>
      <span className="font-mono tabular-nums">
        {formatTokenCount(tokenInput)} in
      </span>
      <span className="text-border">|</span>
      <span className="font-mono tabular-nums">
        {formatTokenCount(tokenOutput)} out
      </span>
      {toolTotalCount > 0 && (
        <>
          <span className="text-border">|</span>
          <span
            className={cn(
              "font-mono tabular-nums",
              toolSuccessCount < toolTotalCount && "text-amber-500",
            )}
          >
            {toolSuccessCount}/{toolTotalCount} tools succeeded
          </span>
        </>
      )}
      {retryCount > 0 && (
        <>
          <span className="text-border">|</span>
          <span className="font-mono tabular-nums text-amber-500">
            {retryCount} {retryCount === 1 ? "retry" : "retries"}
          </span>
        </>
      )}
    </div>
  );
}
