import Link from "next/link";

import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnrichedToolActivity {
  toolName: string;
  callCount: number;
  failureCount: number;
  /** Deep-link ref (e.g., "linear:get_issue") or null if unmapped */
  toolRef: string | null;
}

interface ToolActivityProps {
  tools: EnrichedToolActivity[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ToolActivity({ tools }: ToolActivityProps) {
  const totalCalls = tools.reduce((sum, t) => sum + t.callCount, 0);
  const totalFailures = tools.reduce((sum, t) => sum + t.failureCount, 0);

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Tool Activity
        </span>
        <div className="flex items-center gap-2">
          {totalCalls > 0 && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {totalCalls.toLocaleString()}
            </span>
          )}
          {totalFailures > 0 && (
            <span className="font-mono text-xs tabular-nums text-red-600 dark:text-red-400">
              {totalFailures} err
            </span>
          )}
        </div>
      </div>

      {tools.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No tool calls in the last 24h
          </p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-auto overscroll-y-contain pb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Tool
                  </th>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Calls
                  </th>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Errors
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {tools.map((tool) => (
                  <ToolRow key={tool.toolName} tool={tool} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
        </div>
      )}
    </div>
  );
}

// ─── ToolRow ─────────────────────────────────────────────────────────────────

function ToolRow({ tool }: { tool: EnrichedToolActivity }) {
  const hasFailures = tool.failureCount > 0;
  const failureRate =
    tool.callCount > 0 ? tool.failureCount / tool.callCount : 0;

  const nameContent = (
    <span className="font-mono text-[13px]">{tool.toolName}</span>
  );

  return (
    <tr
      className={cn(
        "border-b transition-colors hover:bg-muted/50",
        hasFailures && failureRate > 0.5 && "bg-red-500/5",
      )}
    >
      <td className="px-4 py-2">
        {tool.toolRef ? (
          <Link
            href={`/tools?tool=${tool.toolRef}`}
            className="hover:text-primary"
          >
            {nameContent}
          </Link>
        ) : (
          nameContent
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">
        {tool.callCount.toLocaleString()}
      </td>
      <td
        className={cn(
          "px-4 py-2 text-right font-mono tabular-nums",
          hasFailures
            ? "text-red-600 dark:text-red-400"
            : "text-muted-foreground",
        )}
      >
        {tool.failureCount}
      </td>
    </tr>
  );
}
