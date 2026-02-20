import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<
  string,
  { label: string; dotClassName: string; className: string }
> = {
  queued: {
    label: "Queued",
    dotClassName: "bg-muted-foreground",
    className: "bg-muted text-muted-foreground",
  },
  running: {
    label: "Running",
    dotClassName: "bg-indigo-500 animate-pulse-signal",
    className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  },
  waiting: {
    label: "Waiting",
    dotClassName: "bg-amber-500",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    dotClassName: "bg-emerald-500",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    dotClassName: "bg-red-500",
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
  cancelled: {
    label: "Cancelled",
    dotClassName: "bg-muted-foreground",
    className: "bg-muted text-muted-foreground",
  },
  created: {
    label: "Created",
    dotClassName: "bg-muted-foreground",
    className: "bg-muted text-muted-foreground",
  },
  active: {
    label: "Active",
    dotClassName: "bg-indigo-500 animate-pulse-signal",
    className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  },
  paused: {
    label: "Paused",
    dotClassName: "bg-amber-500",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  counter_proposed: {
    label: "Counter-Proposed",
    dotClassName: "bg-amber-500",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status];
  const label = config?.label ?? status;
  const dotClassName = config?.dotClassName ?? "bg-muted-foreground";
  const className = config?.className ?? "";

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-transparent font-medium", className)}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClassName)} />
      {label}
    </Badge>
  );
}

export { statusConfig };
