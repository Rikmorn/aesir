"use client";

/**
 * AgentSchedulePanel
 *
 * Displays schedule details for an agent: per-schedule card with cron expression,
 * timezone, next run time, last run status, health indicator, run count,
 * and a manual trigger button.
 *
 * Placed in the agent detail page sidebar below AgentConfigPanel.
 */

import Link from "next/link";
import { useCallback, useState } from "react";

import type { ScheduleState } from "@/lib/agent-service";
import { triggerSchedule } from "@/lib/agent-service";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentSchedulePanelProps {
  agentId: string;
  schedules: Array<{ name: string; cron: string; timezone?: string }>;
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

function formatTimeAgo(isoDate: string): string {
  const now = new Date();
  const target = new Date(isoDate);
  const diffMs = now.getTime() - target.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/** Simple mapping for common cron patterns; shows raw cron as fallback */
function humanReadableCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (cron === "* * * * *") return "Every minute";
  // Every N minutes
  if (
    minute?.startsWith("*/") &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `Every ${minute.slice(2)} minutes`;
  }
  // Daily at specific time
  if (
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*" &&
    hour !== "*" &&
    minute !== "*"
  ) {
    return `Daily at ${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`;
  }
  // Weekly (specific day of week)
  if (
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek !== "*" &&
    hour !== "*"
  ) {
    const dayNames: Record<string, string> = {
      "0": "Sun",
      "1": "Mon",
      "2": "Tue",
      "3": "Wed",
      "4": "Thu",
      "5": "Fri",
      "6": "Sat",
      "7": "Sun",
      SUN: "Sun",
      MON: "Mon",
      TUE: "Tue",
      WED: "Wed",
      THU: "Thu",
      FRI: "Fri",
      SAT: "Sat",
    };
    const dayName = dayNames[dayOfWeek ?? ""] ?? dayOfWeek;
    return `${dayName} at ${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`;
  }
  // Hourly
  if (
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*" &&
    minute !== "*"
  ) {
    return `Hourly at :${minute?.padStart(2, "0")}`;
  }

  return cron;
}

// ─── Health Dot ──────────────────────────────────────────────────────────────

function HealthDot({ health }: { health: "healthy" | "failed" | "missed" }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        health === "healthy" && "bg-emerald-500",
        health === "failed" && "bg-red-500",
        health === "missed" && "bg-amber-500",
      )}
    />
  );
}

// ─── Outcome Badge ───────────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        outcome === "completed" && "bg-emerald-500/10 text-emerald-400",
        outcome === "failed" && "bg-red-500/10 text-red-400",
        outcome === "cancelled" && "bg-red-500/10 text-red-400",
        !["completed", "failed", "cancelled"].includes(outcome) &&
          "bg-muted text-muted-foreground",
      )}
    >
      {outcome}
    </span>
  );
}

// ─── Schedule Card ───────────────────────────────────────────────────────────

function ScheduleCard({
  agentId,
  schedule,
  state,
}: {
  agentId: string;
  schedule: { name: string; cron: string; timezone?: string };
  state: ScheduleState | null;
}) {
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{
    type: "success" | "skipped" | "error";
    message: string;
  } | null>(null);

  const handleTrigger = useCallback(
    async (force = false) => {
      setTriggering(true);
      setTriggerResult(null);
      try {
        const result = await triggerSchedule(agentId, schedule.name, force);
        if (result.triggered) {
          setTriggerResult({ type: "success", message: "Run triggered" });
        } else if (result.skipped) {
          setTriggerResult({
            type: "skipped",
            message: result.reason ?? "Previous run still active",
          });
        } else {
          setTriggerResult({
            type: "error",
            message: result.reason ?? "Failed to trigger",
          });
        }
      } catch {
        setTriggerResult({ type: "error", message: "Request failed" });
      } finally {
        setTriggering(false);
      }
    },
    [agentId, schedule.name],
  );

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2.5">
      {/* Header: name + health */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {schedule.name}
          </span>
          {state && <HealthDot health={state.health} />}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {state?.runCount ?? 0} runs
        </span>
      </div>

      {/* Cron + timezone */}
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">
          {humanReadableCron(schedule.cron)}
        </p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {schedule.cron} ({schedule.timezone ?? "UTC"})
        </p>
      </div>

      {/* Next run + last run */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-[10px] text-muted-foreground">Next run</span>
          <p className="font-mono tabular-nums text-foreground">
            {state?.nextRunAt ? formatRelativeTime(state.nextRunAt) : "--"}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground">Last run</span>
          <div className="flex items-center gap-1.5">
            {state?.lastRunOutcome && (
              <OutcomeBadge outcome={state.lastRunOutcome} />
            )}
            {state?.lastRunAt ? (
              state.lastRunConversationId ? (
                <Link
                  href={`/conversations/${state.lastRunConversationId}`}
                  className="font-mono tabular-nums text-foreground hover:text-primary"
                >
                  {formatTimeAgo(state.lastRunAt)}
                </Link>
              ) : (
                <span className="font-mono tabular-nums text-foreground">
                  {formatTimeAgo(state.lastRunAt)}
                </span>
              )
            ) : (
              <span className="font-mono text-muted-foreground">--</span>
            )}
          </div>
        </div>
      </div>

      {/* Manual trigger */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={triggering}
          onClick={() => handleTrigger(false)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            "hover:bg-muted/50 hover:text-foreground",
            triggering && "opacity-50 cursor-not-allowed",
          )}
        >
          {triggering ? "Triggering..." : "Run now"}
        </button>

        {/* Trigger feedback */}
        {triggerResult && (
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                triggerResult.type === "success" && "bg-emerald-500",
                triggerResult.type === "skipped" && "bg-amber-500",
                triggerResult.type === "error" && "bg-red-500",
              )}
            />
            <span className="text-muted-foreground">
              {triggerResult.message}
            </span>
            {triggerResult.type === "skipped" && (
              <button
                type="button"
                disabled={triggering}
                onClick={() => handleTrigger(true)}
                className="text-primary hover:underline"
              >
                Force run
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AgentSchedulePanel({
  agentId,
  schedules,
  scheduleStates,
}: AgentSchedulePanelProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Schedules
      </h3>
      {schedules.map((schedule) => {
        const state =
          scheduleStates.find((s) => s.scheduleName === schedule.name) ?? null;
        return (
          <ScheduleCard
            key={schedule.name}
            agentId={agentId}
            schedule={schedule}
            state={state}
          />
        );
      })}
    </div>
  );
}
