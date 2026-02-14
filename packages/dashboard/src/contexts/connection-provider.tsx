"use client";

/**
 * ConnectionProvider
 *
 * Layout-level context that establishes an SSE connection to the agent-service
 * and exposes the connection status to all components (primarily the sidebar).
 *
 * This is a lightweight status-only connection — components that need the
 * actual event stream (LiveOverview, LiveDetailPanels) maintain their own
 * useEventStream instances for event processing.
 */

import { createContext, useContext } from "react";

import { useEventStream } from "@/hooks/use-event-stream";
import type { ConnectionStatus } from "@/lib/sse-types";
import { LIFECYCLE_EVENT_TYPES } from "@/lib/sse-types";

const ConnectionStatusContext = createContext<ConnectionStatus>("disconnected");

export function ConnectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useEventStream({
    url: "/dashboard/api/sse/events",
    types: LIFECYCLE_EVENT_TYPES,
  });

  return (
    <ConnectionStatusContext.Provider value={status}>
      {children}
    </ConnectionStatusContext.Provider>
  );
}

export function useConnectionStatus(): ConnectionStatus {
  return useContext(ConnectionStatusContext);
}
