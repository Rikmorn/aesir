"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatTokenCount } from "@/lib/format";
import type { TokenUsageBucket } from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TokenUsageProps {
  data: TokenUsageBucket[];
  timeRangeLabel: string;
  resolution: string;
}

// ─── Chart Config ────────────────────────────────────────────────────────────

const chartConfig = {
  inputTokens: { label: "Input", color: "var(--chart-1)" },
  outputTokens: { label: "Output", color: "var(--chart-2)" },
} satisfies ChartConfig;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBucketTick(value: string, resolution: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  if (resolution === "1d") {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (resolution === "6h") {
    const month = date.toLocaleDateString("en-US", { month: "short" });
    return `${month} ${date.getDate()}, ${hours}:${minutes}`;
  }
  return `${hours}:${minutes}`;
}

function formatTooltipLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TokenUsage({
  data,
  timeRangeLabel,
  resolution,
}: TokenUsageProps) {
  const totalInput = data.reduce((sum, d) => sum + d.inputTokens, 0);
  const totalOutput = data.reduce((sum, d) => sum + d.outputTokens, 0);
  const totalTokens = totalInput + totalOutput;

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Token Usage
          </span>
          {totalTokens > 0 && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatTokenCount(totalTokens)}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 p-4 pb-0">
        {data.length === 0 || totalTokens === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No LLM calls in the {timeRangeLabel.toLowerCase()}
            </p>
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-full w-full"
          >
            <BarChart data={data} accessibilityLayer>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                className="stroke-border/50"
              />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => formatBucketTick(value, resolution)}
                interval="preserveStartEnd"
                className="text-[10px] fill-muted-foreground"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatTokenCount}
                width={50}
                className="text-[10px] fill-muted-foreground"
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={formatTooltipLabel}
                    formatter={(value) => formatTokenCount(Number(value))}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="inputTokens"
                stackId="tokens"
                fill="var(--color-inputTokens)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="outputTokens"
                stackId="tokens"
                fill="var(--color-outputTokens)"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </div>
    </div>
  );
}
