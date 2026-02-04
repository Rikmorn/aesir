import { Card, CardContent } from "@/components/ui/card";
import type { StatusCounts } from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StatCardsProps {
  counts: StatusCounts;
  highlightedFields?: Set<string>;
}

// ─── Component ───────────────────────────────────────────────────────────────

const cards: Array<{
  key: string;
  label: string;
  field: keyof StatusCounts;
  className?: string;
}> = [
  { key: "running", label: "Running", field: "running" },
  { key: "waiting", label: "Waiting", field: "waiting" },
  { key: "queued", label: "Queued", field: "queued" },
  {
    key: "completed",
    label: "Completed (24h)",
    field: "completedLast24h",
    className: "text-emerald-700 dark:text-emerald-400",
  },
  {
    key: "failed",
    label: "Failed (24h)",
    field: "failedLast24h",
    className: "text-red-700 dark:text-red-400",
  },
];

export function StatCards({ counts, highlightedFields }: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => {
        const isHighlighted = highlightedFields?.has(card.field) ?? false;

        return (
          <Card
            key={card.key}
            className={
              isHighlighted
                ? "ring-2 ring-emerald-500/50 transition-shadow duration-300"
                : "transition-shadow duration-300"
            }
          >
            <CardContent className="pt-6">
              <p className={`text-3xl font-bold ${card.className ?? ""}`}>
                {counts[card.field]}
              </p>
              <p className="text-sm text-muted-foreground">{card.label}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
