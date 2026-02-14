import type { WorkerStatus as WorkerStatusType } from "@/lib/agent-service";
import { formatDurationMs, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkerStatusProps {
  status: WorkerStatusType | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkerStatus({ status }: WorkerStatusProps) {
  if (status === null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        <span className="font-medium text-foreground">Worker</span>
        <Separator />
        Unreachable
      </div>
    );
  }

  const isAtCapacity = status.activeClaims >= status.maxConcurrent;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2.5 text-sm">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isAtCapacity ? "bg-amber-500" : "bg-emerald-500 animate-pulse-signal",
        )}
      />
      <span className="font-medium">Worker</span>
      <Separator />
      <span className="text-muted-foreground">Claims</span>
      <span className="font-mono tabular-nums">
        {status.activeClaims}/{status.maxConcurrent}
      </span>
      <Separator />
      <span className="text-muted-foreground">Poll</span>
      <span className="font-mono tabular-nums">
        {formatDurationMs(status.pollIntervalMs)}
      </span>
      <Separator />
      <span className="text-muted-foreground">Last</span>
      <span>
        {formatRelativeTime(
          status.lastPollAt ? new Date(status.lastPollAt) : null,
        )}
      </span>
      <Separator />
      <span className="text-muted-foreground">Up</span>
      <span className="font-mono tabular-nums">
        {formatDurationMs(status.uptimeMs)}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <span className="text-border" aria-hidden="true">
      &middot;
    </span>
  );
}
