"use client";

/**
 * useEventStream Hook
 *
 * React hook that bridges the EventStreamStore to React components
 * via useSyncExternalStore. Creates a stable store instance keyed
 * on the computed SSE URL, batch interval, and max events.
 *
 * Usage:
 *   const { events, status, lastEventId, hasGap } = useEventStream({
 *     url: "/dashboard/api/sse/events",
 *     types: ["agent.started", "agent.completed"],
 *     conversationId: "conv_abc",
 *   });
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { EventStreamStore } from "@/lib/event-stream-store";
import type { EventStreamState } from "@/lib/sse-types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UseEventStreamOptions {
  /** Base SSE endpoint URL (e.g., "/dashboard/api/sse/events") */
  url: string;
  /** Event types to subscribe to (server-side filtering via ?types=) */
  types?: readonly string[];
  /** Specific conversation ID to filter for */
  conversationId?: string;
  /** Whether the connection is enabled (default: true) */
  enabled?: boolean;
  /** Batch interval in ms (default: 500) */
  batchIntervalMs?: number;
  /** Maximum events to retain in the store (default: 1000) */
  maxEvents?: number;
}

// ─── Server Snapshot ────────────────────────────────────────────────────────

/** SSR snapshot -- returned during server rendering and hydration */
const SERVER_SNAPSHOT: EventStreamState = {
  events: [],
  status: "disconnected",
  lastEventId: null,
  hasGap: false,
};

function getServerSnapshot(): EventStreamState {
  return SERVER_SNAPSHOT;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useEventStream(
  options: UseEventStreamOptions,
): EventStreamState {
  const {
    url,
    types,
    conversationId,
    enabled = true,
    batchIntervalMs = 500,
    maxEvents = 1000,
  } = options;

  // Serialize types array to a stable string for dependency comparison.
  // Without this, a new array reference on each render would bust the useMemo.
  const typesKey = types ? types.join(",") : "";

  // Build the full SSE URL with query params
  const sseUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (typesKey) params.set("types", typesKey);
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }, [url, typesKey, conversationId]);

  // Create a stable EventStreamStore instance.
  // Recreated only when the URL, batch interval, or max events change.
  const store = useMemo(
    () => new EventStreamStore(sseUrl, batchIntervalMs, maxEvents),
    [sseUrl, batchIntervalMs, maxEvents],
  );

  // Connect/disconnect based on the enabled flag
  useEffect(() => {
    if (!enabled) return;
    store.connect();
    return () => {
      store.disconnect();
    };
  }, [store, enabled]);

  // Subscribe React to the external store
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot,
  );
}
