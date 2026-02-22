/**
 * UpcomingSchedulesCard
 *
 * Displays the next 5 scheduled agent runs across all agents, sorted by
 * nearest run time. Each entry shows agent name, schedule name, health
 * indicator, and relative time until next run.
 *
 * Server component -- receives pre-fetched data as props from the overview page.
 * Follows the same card pattern as other overview components.
 */

import { Clock } from "lucide-react";
import Link from "next/link";

import type { ScheduleState } from "@/lib/agent-service";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpcomingSchedulesCardProps {
  scheduleStates: ScheduleState[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  const now = new Date();
  const target = new Date(isoDate);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `in ${Math.floor(hours / 24)}d`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UpcomingSchedulesCard({
  scheduleStates,
}: UpcomingSchedulesCardProps) {
  // Sort by nextRunAt ascending, take first 5
  // Type narrowing: filter guarantees nextRunAt is non-null
  const upcoming = scheduleStates
    .filter(
      (s): s is ScheduleState & { nextRunAt: string } => s.nextRunAt !== null,
    )
    .sort(
      (a, b) =>
        new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime(),
    )
    .slice(0, 5);

  if (upcoming.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Upcoming Schedules
        </h3>
        <p className="text-xs text-muted-foreground">
          No scheduled agents configured
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Clock className="h-4 w-4 text-muted-foreground" />
        Upcoming Schedules
      </h3>
      <div className="space-y-2">
        {upcoming.map((schedule) => (
          <div
            key={`${schedule.agentId}-${schedule.scheduleName}`}
            className="flex items-center justify-between text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={`/agents/${schedule.agentId}`}
                className="truncate font-medium text-foreground hover:underline"
              >
                {schedule.agentName ?? schedule.agentId}
              </Link>
              <span className="truncate text-muted-foreground">
                {schedule.scheduleName}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Health indicator dot */}
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  schedule.health === "healthy" && "bg-emerald-500",
                  schedule.health === "failed" && "bg-red-500",
                  schedule.health === "missed" && "bg-amber-500",
                )}
              />
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatRelativeTime(schedule.nextRunAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
