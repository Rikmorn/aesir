"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatTokenCount } from "@/lib/format";
import type { TokenUsageByAgent } from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TokenUsageProps {
  data: TokenUsageByAgent[];
}

// ─── Chart Config ────────────────────────────────────────────────────────────

const chartConfig = {
  inputTokens: { label: "Input", color: "var(--chart-1)" },
  outputTokens: { label: "Output", color: "var(--chart-2)" },
} satisfies ChartConfig;

// ─── Component ───────────────────────────────────────────────────────────────

export function TokenUsage({ data }: TokenUsageProps) {
  const totalTokens = data.reduce(
    (sum, d) => sum + d.inputTokens + d.outputTokens,
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Usage (24h)</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 || totalTokens === 0 ? (
          <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">
              No LLM calls in the last 24 hours
            </p>
          </div>
        ) : (
          <>
            <div>
              <p className="text-3xl font-bold">
                {formatTokenCount(totalTokens)}
              </p>
              <p className="text-sm text-muted-foreground">
                Total tokens (last 24h)
              </p>
            </div>
            <ChartContainer
              config={chartConfig}
              className="mt-4 min-h-[200px] w-full"
            >
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
