"use client";

import { AlertCircle, AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TreeHealth } from "@/services/tasks";

interface TaskHealthBadgeProps {
  health: TreeHealth | undefined;
}

/**
 * Health indicator badge for a task tree.
 *
 * Renders nothing for clean/standalone tasks.
 * Shows red badge for failures (failed nodes, orphaned signals).
 * Shows amber badge for warnings (timeouts, rejections, depth limit).
 */
export function TaskHealthBadge({ health }: TaskHealthBadgeProps) {
  if (!health || health.severity === "clean") {
    return null;
  }

  if (health.severity === "failure") {
    const failureCount = health.orphanedCount + countFailures(health);
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 font-medium",
          "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
        )}
      >
        <AlertCircle className="h-3 w-3" />
        {failureCount} {failureCount === 1 ? "failure" : "failures"}
      </Badge>
    );
  }

  const warningCount =
    health.timeoutCount +
    health.rejectionChainCount +
    (health.depthLimitReached ? 1 : 0);

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-medium",
        "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
      )}
    >
      <AlertTriangle className="h-3 w-3" />
      {warningCount} {warningCount === 1 ? "warning" : "warnings"}
    </Badge>
  );
}

/**
 * Count non-orphan failure indicators.
 * Orphans are counted separately, so this counts other failure signals.
 */
function countFailures(health: TreeHealth): number {
  // failure severity is triggered by failed nodes OR orphans
  // orphans are already counted; return 1 as base for "failed node" indicator
  // if orphanedCount is the only source, return 0 to avoid double counting
  return health.orphanedCount > 0 ? 0 : 1;
}
