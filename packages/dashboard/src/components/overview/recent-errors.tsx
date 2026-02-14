"use client";

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
          <div className="relative">
            <div className="max-h-[320px] space-y-2 overflow-y-auto overscroll-y-contain pb-6">
              {errors.map((error) => (
                <ErrorItem key={error.id} error={error} />
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ErrorItem ───────────────────────────────────────────────────────────────

function ErrorItem({ error }: { error: RecentError }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{error.agentDefinitionId}</span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(error.timestamp)}
        </span>
        <div className="flex-1" />
        {error.conversationId && (
          <Link
            href={`/conversations/${error.conversationId}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View &rarr;
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "mt-1 cursor-pointer text-left text-[13px] leading-snug text-red-600 dark:text-red-400",
          !expanded && "line-clamp-3",
        )}
      >
        {error.errorMessage}
      </button>
    </div>
  );
}
