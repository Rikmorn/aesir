"use client";

import Link from "next/link";
import { useState } from "react";

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
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recent Errors
        </span>
        {errors.length > 0 && (
          <span className="font-mono text-xs tabular-nums text-red-600 dark:text-red-400">
            {errors.length}
          </span>
        )}
      </div>

      {errors.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No errors</p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div className="h-full space-y-2 overflow-y-auto overscroll-y-contain p-3 pb-6">
            {errors.map((error) => (
              <ErrorItem key={error.id} error={error} />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
        </div>
      )}
    </div>
  );
}

// ─── ErrorItem ───────────────────────────────────────────────────────────────

function ErrorItem({ error }: { error: RecentError }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border px-3 py-2 text-sm transition-colors hover:border-foreground/20">
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
          "mt-1 cursor-pointer text-left text-[13px] leading-snug text-red-600 decoration-red-400/40 hover:underline dark:text-red-400",
          !expanded && "line-clamp-3",
        )}
      >
        {error.errorMessage}
      </button>
    </div>
  );
}
