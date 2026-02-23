/**
 * Budget Consumption Bar
 *
 * Visualizes token budget allocation vs consumption as a fill bar.
 * Color progression per design system:
 * - Neutral (emerald): < 60% consumed
 * - Warning (amber): 60-80% consumed
 * - Critical (red-400): > 80% consumed
 * - Exhausted (red-500): 100% consumed
 *
 * Used in delegation graph task nodes and conversation detail panels.
 */

import { cn } from "@/lib/utils";

interface BudgetBarProps {
  allocated: number;
  consumed: number;
  /** Show token numbers below the bar */
  showLabel?: boolean;
  /** Additional CSS classes for the container */
  className?: string;
}

export function BudgetBar({
  allocated,
  consumed,
  showLabel = false,
  className,
}: BudgetBarProps) {
  const pct =
    allocated > 0 ? Math.min(100, Math.round((consumed / allocated) * 100)) : 0;

  const barColor =
    pct >= 100
      ? "bg-red-500"
      : pct >= 80
        ? "bg-red-400"
        : pct >= 60
          ? "bg-amber-400"
          : "bg-emerald-400";

  return (
    <div className={cn("space-y-0.5", className)}>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{consumed.toLocaleString()} used</span>
          <span>{allocated.toLocaleString()} total</span>
        </div>
      )}
    </div>
  );
}
