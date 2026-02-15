"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { IntegrationHealth as IntegrationHealthType } from "@/lib/agent-service";
import { cn } from "@/lib/utils";
import type {
  IntegrationErrorRates,
  IntegrationHourlyRate,
} from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface IntegrationHealthProps {
  errorRates: IntegrationErrorRates;
  health: IntegrationHealthType[];
  timeRangeLabel: string;
}

// ─── Integration Config ─────────────────────────────────────────────────────

const INTEGRATIONS = [
  { key: "github" as const, label: "GitHub" },
  { key: "linear" as const, label: "Linear" },
  { key: "slack" as const, label: "Slack" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeStats(data: IntegrationHourlyRate[]) {
  const totalCalls = data.reduce((sum, d) => sum + d.calls, 0);
  const totalFailures = data.reduce((sum, d) => sum + d.failures, 0);
  const errorRate = totalCalls > 0 ? (totalFailures / totalCalls) * 100 : 0;
  return { totalCalls, totalFailures, errorRate };
}

function getSegmentColor(calls: number, failures: number): string {
  if (calls === 0) return "bg-muted";
  const rate = failures / calls;
  if (rate === 0) return "bg-emerald-500/80";
  if (rate < 0.1) return "bg-amber-500";
  return "bg-red-500";
}

function formatSegmentTime(hour: string): string {
  const date = new Date(hour);
  if (Number.isNaN(date.getTime())) return hour;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Aggregate hourly segments into larger buckets when there are too many
 * to render as individual bars (e.g., 720 hours for 30d).
 */
function aggregateSegments(
  data: IntegrationHourlyRate[],
  bucketSize: number,
): IntegrationHourlyRate[] {
  const result: IntegrationHourlyRate[] = [];
  for (let i = 0; i < data.length; i += bucketSize) {
    const chunk = data.slice(i, i + bucketSize);
    const first = chunk[0];
    if (!first) continue;
    result.push({
      hour: first.hour,
      calls: chunk.reduce((sum, d) => sum + d.calls, 0),
      failures: chunk.reduce((sum, d) => sum + d.failures, 0),
    });
  }
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IntegrationHealth({
  errorRates,
  health,
  timeRangeLabel,
}: IntegrationHealthProps) {
  const healthMap = new Map<string, IntegrationHealthType>();
  for (const h of health) {
    healthMap.set(h.name.toLowerCase(), h);
  }

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Integration Health
        </span>
        <span className="text-[11px] text-muted-foreground">
          {timeRangeLabel}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col divide-y">
        {INTEGRATIONS.map((integration) => {
          const data = errorRates[integration.key];
          const status = healthMap.get(integration.key);
          return (
            <IntegrationRow
              key={integration.key}
              label={integration.label}
              data={data}
              status={status}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Integration Row ────────────────────────────────────────────────────────

function IntegrationRow({
  label,
  data,
  status,
}: {
  label: string;
  data: IntegrationHourlyRate[];
  status: IntegrationHealthType | undefined;
}) {
  const isHealthy = status?.status === "healthy";
  const { totalCalls, totalFailures, errorRate } = computeStats(data);

  // Aggregate if too many segments to render individually
  const segments =
    data.length > 100
      ? aggregateSegments(data, Math.ceil(data.length / 60))
      : data;

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-4">
      {/* Label + stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === undefined
                ? "bg-muted-foreground/50"
                : isHealthy
                  ? "bg-emerald-500"
                  : "bg-red-500",
            )}
          />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-mono tabular-nums text-muted-foreground">
            {totalCalls.toLocaleString()} calls
          </span>
          {totalFailures > 0 && (
            <span
              className={cn(
                "font-mono tabular-nums",
                errorRate > 5
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400",
              )}
            >
              {totalFailures} err ({errorRate.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>

      {/* Uptime bar */}
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <div className="flex h-2.5 gap-px overflow-hidden rounded-sm">
          {segments.length === 0 ? (
            <div className="flex-1 bg-muted" />
          ) : (
            segments.map((seg) => (
              <Tooltip key={seg.hour}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "flex-1 transition-opacity hover:opacity-70",
                      getSegmentColor(seg.calls, seg.failures),
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  <p>{formatSegmentTime(seg.hour)}</p>
                  <p className="opacity-70">
                    {seg.calls} calls
                    {seg.failures > 0 ? ` · ${seg.failures} errors` : ""}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}
