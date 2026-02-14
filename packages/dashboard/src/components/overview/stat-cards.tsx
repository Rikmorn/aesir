import { cn } from "@/lib/utils";
import type { StatusCounts } from "@/services/overview";

interface StatCardsProps {
  counts: StatusCounts;
  highlightedFields?: Set<string>;
}

const secondaryCards: Array<{
  key: string;
  label: string;
  field: keyof StatusCounts;
  accentClass: string;
  dotClass: string;
}> = [
  {
    key: "waiting",
    label: "Waiting",
    field: "waiting",
    accentClass: "border-l-amber-500",
    dotClass: "bg-amber-500",
  },
  {
    key: "queued",
    label: "Queued",
    field: "queued",
    accentClass: "border-l-muted-foreground/30",
    dotClass: "bg-muted-foreground/50",
  },
  {
    key: "completed",
    label: "Completed (24h)",
    field: "completedLast24h",
    accentClass: "border-l-emerald-500",
    dotClass: "bg-emerald-500",
  },
  {
    key: "failed",
    label: "Failed (24h)",
    field: "failedLast24h",
    accentClass: "border-l-red-500",
    dotClass: "bg-red-500",
  },
];

export function StatCards({ counts, highlightedFields }: StatCardsProps) {
  const runningHighlighted = highlightedFields?.has("running") ?? false;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
      {/* Running — the primary metric, visually dominant */}
      <div
        className={cn(
          "col-span-2 rounded-lg border border-l-2 border-l-indigo-500 bg-card px-4 py-4 transition-all duration-300 md:col-span-1",
          runningHighlighted && "ring-1 ring-primary/30",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse-signal" />
          <span className="text-xs font-medium text-muted-foreground">
            Running
          </span>
        </div>
        <p className="mt-1.5 font-mono text-3xl font-semibold tabular-nums tracking-tight">
          {counts.running}
        </p>
      </div>

      {/* Secondary stats */}
      {secondaryCards.map((card) => {
        const isHighlighted = highlightedFields?.has(card.field) ?? false;
        const value = counts[card.field];

        return (
          <div
            key={card.key}
            className={cn(
              "rounded-lg border border-l-2 bg-card px-4 py-3 transition-all duration-300",
              card.accentClass,
              isHighlighted && "ring-1 ring-primary/30",
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", card.dotClass)} />
              <span className="text-xs font-medium text-muted-foreground">
                {card.label}
              </span>
            </div>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
