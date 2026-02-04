"use client";

import { parseAsString, useQueryState } from "nuqs";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { ToolMetrics, ToolMetricTimeSeries } from "@/services/tools";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ToolPerformanceProps {
  timeSeries: ToolMetricTimeSeries[];
  metrics: ToolMetrics[];
  defaultTimeRange: string;
}

// ─── Chart Configs ──────────────────────────────────────────────────────────

const volumeConfig = {
  calls: { label: "Calls", color: "var(--chart-1)" },
  failures: { label: "Failures", color: "var(--chart-5)" },
} satisfies ChartConfig;

const failureRateConfig = {
  rate: { label: "Failure Rate", color: "var(--chart-5)" },
} satisfies ChartConfig;

const latencyConfig = {
  p50: { label: "P50", color: "var(--chart-2)" },
  p95: { label: "P95", color: "var(--chart-4)" },
} satisfies ChartConfig;

// ─── Time Range Options ─────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBucketLabel(isoString: string, timeRange: string): string {
  const date = new Date(isoString);
  if (timeRange === "7d") {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ToolPerformance({
  timeSeries,
  metrics,
  defaultTimeRange,
}: ToolPerformanceProps) {
  const [timeRange, setTimeRange] = useQueryState(
    "timeRange",
    parseAsString.withDefault(defaultTimeRange).withOptions({ shallow: false }),
  );

  // Derive failure rate from time series
  const failureRateData = timeSeries.map((point) => ({
    bucket: point.bucket,
    rate: point.calls > 0 ? (point.failures / point.calls) * 100 : 0,
  }));

  // Top 15 tools by call count for latency chart
  const topTools = metrics.slice(0, 15);

  const hasTimeSeriesData = timeSeries.length > 0;
  const hasMetricsData = topTools.length > 0;

  return (
    <div className="space-y-4">
      {/* Time Range Selector */}
      <div className="flex justify-end">
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

      {/* Empty State */}
      {!hasTimeSeriesData && !hasMetricsData && (
        <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            No tool activity in this time range
          </p>
        </div>
      )}

      {/* Charts Grid */}
      {(hasTimeSeriesData || hasMetricsData) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Chart 1: Call Volume (Area) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Call Volume</CardTitle>
            </CardHeader>
            <CardContent>
              {hasTimeSeriesData ? (
                <ChartContainer
                  config={volumeConfig}
                  className="min-h-[200px] w-full"
                >
                  <AreaChart data={timeSeries} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="bucket"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value: string) =>
                        formatBucketLabel(value, timeRange)
                      }
                    />
                    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value: string) =>
                            formatBucketLabel(value, timeRange)
                          }
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Area
                      type="monotone"
                      dataKey="calls"
                      stackId="volume"
                      stroke="var(--color-calls)"
                      fill="var(--color-calls)"
                      fillOpacity={0.3}
                    />
                    <Area
                      type="monotone"
                      dataKey="failures"
                      stackId="volume"
                      stroke="var(--color-failures)"
                      fill="var(--color-failures)"
                      fillOpacity={0.3}
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>

          {/* Chart 2: Failure Rate (Line) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Failure Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasTimeSeriesData ? (
                <ChartContainer
                  config={failureRateConfig}
                  className="min-h-[200px] w-full"
                >
                  <LineChart data={failureRateData} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="bucket"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value: string) =>
                        formatBucketLabel(value, timeRange)
                      }
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value: number) => `${value}%`}
                      domain={[0, "auto"]}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value: string) =>
                            formatBucketLabel(value, timeRange)
                          }
                          formatter={(value) => [
                            `${Number(value).toFixed(1)}%`,
                            "Failure Rate",
                          ]}
                        />
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="var(--color-rate)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ChartContainer>
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>

          {/* Chart 3: Latency by Tool (Bar) - Full Width */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Latency by Tool (ms)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasMetricsData ? (
                <ChartContainer
                  config={latencyConfig}
                  className="min-h-[200px] w-full"
                >
                  <BarChart data={topTools} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="toolName"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value: string) =>
                        value.length > 16 ? `${value.slice(0, 14)}...` : value
                      }
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value: number) => `${value}ms`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar
                      dataKey="p50LatencyMs"
                      name="p50"
                      fill="var(--color-p50)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="p95LatencyMs"
                      name="p95"
                      fill="var(--color-p95)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <p className="text-xs text-muted-foreground">No data available</p>
    </div>
  );
}
