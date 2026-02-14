"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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
          <div className="flex h-[120px] items-center justify-center">
            <p className="text-sm text-muted-foreground">No errors</p>
          </div>
        ) : (
          <div className="space-y-2">
            {errors.map((error) => (
              <ErrorItem key={error.id} error={error} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ErrorItem ───────────────────────────────────────────────────────────────

function ErrorItem({ error }: { error: RecentError }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-md border text-sm">
      {/* Header row - always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium">{error.agentDefinitionId}</span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(error.timestamp)}
        </span>
        <div className="flex-1" />
        {error.conversationId && (
          <Link
            href={`/conversations/${error.conversationId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View →
          </Link>
        )}
      </button>

      {/* Error message - truncated or full */}
      <div
        className={cn(
          "border-t px-3 py-2 text-red-600 dark:text-red-400",
          !isExpanded && "truncate",
        )}
      >
        {isExpanded ? (
          <pre className="whitespace-pre-wrap break-words font-sans">
            {error.errorMessage}
          </pre>
        ) : (
          error.errorMessage
        )}
      </div>
    </div>
  );
}
