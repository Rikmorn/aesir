import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  // Conversation statuses
  queued: {
    label: "Queued",
    className:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  running: {
    label: "Running",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  waiting: {
    label: "Waiting",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
  completed: {
    label: "Completed",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  // Task statuses (shared component, no conflict)
  created: {
    label: "Created",
    className:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  active: {
    label: "Active",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  paused: {
    label: "Paused",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status];
  const label = config?.label ?? status;
  const className = config?.className ?? "";

  return (
    <Badge variant="outline" className={cn("font-medium", className)}>
      {label}
    </Badge>
  );
}

export { statusConfig };
