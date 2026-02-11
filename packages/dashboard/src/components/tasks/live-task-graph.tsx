"use client";

/**
 * Live Task Graph
 *
 * Client wrapper that owns polling state and coordinates the delegation graph,
 * detail panel, and timeline. Polls every 30s for updated tree data and stops
 * when all tasks are terminal.
 *
 * Bidirectional linking:
 * - Graph node click -> opens detail panel + scrolls timeline to that task's events
 * - Timeline event click -> briefly highlights the corresponding graph node (2s pulse)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TaskTreeNode, TimelineEvent, TreeHealth } from "@/services/tasks";

import { DelegationGraph } from "./delegation-graph";
import { DelegationTimeline } from "./delegation-timeline";
import { TaskDetailPanel } from "./task-detail-panel";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LiveTaskGraphProps {
  taskId: string;
  initialNodes: TaskTreeNode[];
  initialEvents: TimelineEvent[];
  initialHealth: TreeHealth;
}

interface TreeState {
  nodes: TaskTreeNode[];
  events: TimelineEvent[];
  health: TreeHealth;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function isTreeTerminal(nodes: TaskTreeNode[]): boolean {
  return nodes.every((n) => TERMINAL_STATUSES.has(n.status));
}

/**
 * Merge new tree data into existing state by diffing.
 * - Nodes: update existing by ID, append new ones, remove stale ones
 * - Events: append-only (events are immutable once created)
 * - Health: always replace (derived from current state)
 *
 * Preserves React state references for unchanged nodes (React Flow uses
 * reference equality for memoized node rendering) and keeps timeline scroll
 * position stable by not replacing existing DOM elements.
 */
function mergeTreeState(prev: TreeState, next: TreeState): TreeState {
  // Build lookup of existing IDs for O(1) membership checks
  const existingNodeIds = new Set(prev.nodes.map((n) => n.id));
  const existingEventIds = new Set(prev.events.map((e) => e.id));
  const nextNodeIds = new Set(next.nodes.map((n) => n.id));

  // Merge nodes: update existing in place, append new
  const mergedNodes = prev.nodes
    .map((existing) => {
      const updated = next.nodes.find((n) => n.id === existing.id);
      return updated ?? existing;
    })
    // Remove nodes no longer in the tree (cancelled and pruned)
    .filter((n) => nextNodeIds.has(n.id));

  // Append any nodes that didn't exist before
  for (const node of next.nodes) {
    if (!existingNodeIds.has(node.id)) {
      mergedNodes.push(node);
    }
  }

  // Append new events only (events are immutable)
  const newEvents = next.events.filter((e) => !existingEventIds.has(e.id));
  const mergedEvents =
    newEvents.length > 0 ? [...prev.events, ...newEvents] : prev.events; // Reference equality if no new events

  return {
    nodes: mergedNodes,
    events: mergedEvents,
    health: next.health, // Always use latest health computation
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveTaskGraph({
  taskId,
  initialNodes,
  initialEvents,
  initialHealth,
}: LiveTaskGraphProps) {
  const [tree, setTree] = useState<TreeState>({
    nodes: initialNodes,
    events: initialEvents,
    health: initialHealth,
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(
    null,
  );
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [isPolling, setIsPolling] = useState(
    () => !isTreeTerminal(initialNodes),
  );
  const abortRef = useRef<AbortController | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Polling
  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`/dashboard/api/tasks/${taskId}/tree`, {
          signal: controller.signal,
        });

        if (!response.ok) return;

        const data = (await response.json()) as {
          nodes: TaskTreeNode[];
          events: TimelineEvent[];
          health: TreeHealth;
        };

        setTree((prev) =>
          mergeTreeState(prev, {
            nodes: data.nodes,
            events: data.events,
            health: data.health,
          }),
        );

        if (isTreeTerminal(data.nodes)) {
          setIsPolling(false);
        }
      } catch {
        // Ignore fetch errors (abort, network issues)
      }
    }, 30_000);

    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [isPolling, taskId]);

  // Cleanup highlight timer
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Get selected node data
  const selectedNode = useMemo(
    () =>
      selectedNodeId
        ? (tree.nodes.find((n) => n.id === selectedNodeId) ?? null)
        : null,
    [tree.nodes, selectedNodeId],
  );

  // Filter events for selected node
  const selectedNodeEvents = useMemo(
    () =>
      selectedNodeId
        ? tree.events.filter((e) => e.taskId === selectedNodeId)
        : [],
    [tree.events, selectedNodeId],
  );

  // Graph node click -> open detail panel
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  // Pane click -> close panel
  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Timeline event click -> highlight graph node briefly
  const handleTimelineEventClick = useCallback((eventTaskId: string) => {
    // Clear previous highlight timer
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }

    setHighlightedNodeId(eventTaskId);

    // Clear highlight after 2s
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedNodeId(null);
      highlightTimerRef.current = null;
    }, 2000);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Polling indicator */}
      {isPolling && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground border-b">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          Auto-updating every 30s
        </div>
      )}

      {/* Graph + detail panel */}
      <div
        className={cn("relative", timelineExpanded ? "h-[60%]" : "flex-1")}
        style={{ minHeight: 300 }}
      >
        <DelegationGraph
          treeNodes={tree.nodes}
          events={tree.events}
          health={tree.health}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          selectedNodeId={selectedNodeId}
          highlightedNodeId={highlightedNodeId}
        />
        {selectedNode && (
          <TaskDetailPanel
            node={selectedNode}
            events={selectedNodeEvents}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      {/* Timeline */}
      <DelegationTimeline
        events={tree.events}
        selectedNodeId={selectedNodeId}
        onEventClick={handleTimelineEventClick}
        isExpanded={timelineExpanded}
        onToggle={() => setTimelineExpanded((prev) => !prev)}
      />
    </div>
  );
}
