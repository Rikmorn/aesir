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
      <div className="flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        <span className="font-medium text-red-600 dark:text-red-400">
          Agent Service
        </span>
        <Separator />
        <span className="text-red-600 dark:text-red-400">Unreachable</span>
      </div>
    );
  }

  const isAtCapacity = status.activeClaims >= status.maxConcurrent;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border px-3 py-1.5 text-sm",
        isAtCapacity
          ? "border-amber-500/20 bg-amber-500/10"
          : "border-emerald-500/20 bg-emerald-500/10",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isAtCapacity ? "bg-amber-500" : "bg-emerald-500 animate-pulse-signal",
        )}
      />
      <span
        className={cn(
          "font-medium",
          isAtCapacity
            ? "text-amber-600 dark:text-amber-400"
            : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        Agent Service
      </span>
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
