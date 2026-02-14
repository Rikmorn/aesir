"use client";

/**
 * ConnectionStatusIndicator
 *
 * Small visual indicator showing the SSE connection state.
 * Renders a colored dot with optional label text.
 */

import type { ConnectionStatus } from "@/lib/sse-types";

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
}

export function ConnectionStatusIndicator({
  status,
}: ConnectionStatusIndicatorProps) {
  if (status === "disconnected") {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
        <span className="text-xs font-medium text-red-700 dark:text-red-400">
          Offline
        </span>
      </div>
    );
  }

  if (status === "connected") {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse-signal rounded-full bg-emerald-500" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          Live
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
        Reconnecting
      </span>
    </div>
  );
}
