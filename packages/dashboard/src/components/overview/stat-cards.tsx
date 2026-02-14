import Link from "next/link";

import { cn } from "@/lib/utils";
import type { StatusCounts } from "@/services/overview";

interface StatCardsProps {
  counts: StatusCounts;
  highlightedFields?: Set<string>;
}

const secondaryStats: Array<{
  key: string;
  label: string;
  field: keyof StatusCounts;
  href: string;
  dotClass: string;
}> = [
  {
    key: "waiting",
    label: "Waiting",
    field: "waiting",
    href: "/conversations?status=waiting",
    dotClass: "bg-amber-500",
  },
  {
    key: "queued",
    label: "Queued",
    field: "queued",
    href: "/conversations?status=queued",
    dotClass: "bg-muted-foreground/50",
  },
  {
    key: "completed",
    label: "Completed (24h)",
    field: "completedLast24h",
    href: "/conversations?status=completed&timeRange=24h",
    dotClass: "bg-emerald-500",
  },
  {
    key: "failed",
    label: "Failed (24h)",
    field: "failedLast24h",
    href: "/conversations?status=failed&timeRange=24h",
    dotClass: "bg-red-500",
  },
];

export function StatCards({ counts, highlightedFields }: StatCardsProps) {
  const runningHighlighted = highlightedFields?.has("running") ?? false;

  return (
    <div className="flex items-center gap-5">
      {/* Running — primary metric */}
      <Link
        href="/conversations?status=running"
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-1.5 transition-all duration-300 hover:bg-muted/50",
          runningHighlighted && "ring-1 ring-primary/30",
        )}
      >
        <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse-signal" />
        <span className="text-xs font-medium text-muted-foreground">
          Running
        </span>
        <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
          {counts.running}
        </span>
      </Link>

      <span className="h-5 w-px bg-border" />

      {/* Secondary stats */}
      {secondaryStats.map((stat) => {
        const isHighlighted = highlightedFields?.has(stat.field) ?? false;
        const value = counts[stat.field];

        return (
          <Link
            key={stat.key}
            href={stat.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 transition-all duration-300 hover:bg-muted/50",
              isHighlighted && "ring-1 ring-primary/30",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", stat.dotClass)} />
            <span className="text-xs font-medium text-muted-foreground">
              {stat.label}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {value}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
