"use client";

import { parseAsString, useQueryState } from "nuqs";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTokenCount } from "@/lib/format";
import type { TokenUsageByAgent } from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TokenUsageProps {
  data: TokenUsageByAgent[];
  defaultTimeRange: string;
}

// ─── Time Range Options ─────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

// ─── Chart Config ────────────────────────────────────────────────────────────

const chartConfig = {
  inputTokens: { label: "Input", color: "var(--chart-1)" },
  outputTokens: { label: "Output", color: "var(--chart-2)" },
} satisfies ChartConfig;

// ─── Component ───────────────────────────────────────────────────────────────

export function TokenUsage({ data, defaultTimeRange }: TokenUsageProps) {
  const [timeRange, setTimeRange] = useQueryState(
    "tokenTimeRange",
    parseAsString.withDefault(defaultTimeRange).withOptions({ shallow: false }),
  );

  const totalTokens = data.reduce(
    (sum, d) => sum + d.inputTokens + d.outputTokens,
    0,
  );

  const timeRangeLabel =
    TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label ?? timeRange;

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
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 p-4">
        {data.length === 0 || totalTokens === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No LLM calls in the {timeRangeLabel.toLowerCase()}
            </p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-full w-full">
            <BarChart data={data} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="agentDefinitionId"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
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
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </div>
    </div>
  );
}
