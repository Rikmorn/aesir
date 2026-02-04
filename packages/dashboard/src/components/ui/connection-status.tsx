"use client";

/**
 * ConnectionStatusIndicator
 *
 * Small visual indicator showing the SSE connection state.
 * Renders a colored dot with optional label text.
 *
 * - Green pulsing dot + "Live" when connected
 * - Yellow dot + "Reconnecting..." when connecting or error (reconnecting)
 * - Gray dot + "Offline" when disconnected
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
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
        <span className="text-xs text-muted-foreground">Offline</span>
      </div>
    );
  }

  if (status === "connected") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          Live
        </span>
      </div>
    );
  }

  // "connecting" or "error" -- EventSource is reconnecting
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span className="text-xs text-muted-foreground">Reconnecting...</span>
    </div>
  );
}
