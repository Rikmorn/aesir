import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkerStatus as WorkerStatusType } from "@/lib/agent-service";
import { formatDurationMs, formatRelativeTime } from "@/lib/format";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkerStatusProps {
  status: WorkerStatusType | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkerStatus({ status }: WorkerStatusProps) {
  if (status === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Worker Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[120px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Agent service unreachable
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isAtCapacity = status.activeClaims >= status.maxConcurrent;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            role="img"
            className={`h-1.5 w-1.5 rounded-full ${isAtCapacity ? "bg-amber-500" : "bg-emerald-500 animate-pulse-signal"}`}
            aria-label={isAtCapacity ? "At capacity" : "Available"}
          />
          Worker Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Running</dt>
          <dd>
            {status.activeClaims} / {status.maxConcurrent}
          </dd>

          <dt className="text-muted-foreground">Poll Interval</dt>
          <dd className="font-mono">
            {formatDurationMs(status.pollIntervalMs)}
          </dd>

          <dt className="text-muted-foreground">Last Poll</dt>
          <dd>
            {formatRelativeTime(
              status.lastPollAt ? new Date(status.lastPollAt) : null,
            )}
          </dd>

          <dt className="text-muted-foreground">Uptime</dt>
          <dd className="font-mono">{formatDurationMs(status.uptimeMs)}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
