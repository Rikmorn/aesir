import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import type { RecentError } from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RecentErrorsProps {
  errors: RecentError[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RecentErrors({ errors }: RecentErrorsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Errors</CardTitle>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">No recent errors</p>
          </div>
        ) : (
          <div className="space-y-3">
            {errors.map((error) => (
              <div
                key={error.id}
                className="flex items-start justify-between gap-4 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {error.agentDefinitionId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(error.timestamp)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-red-600 dark:text-red-400">
                    {error.errorMessage}
                  </p>
                </div>
                {error.conversationId && (
                  <Link
                    href={`/conversations/${error.conversationId}`}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    View
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
