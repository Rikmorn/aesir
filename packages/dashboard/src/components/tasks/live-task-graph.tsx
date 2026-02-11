"use client";

/**
 * Live Task Graph
 *
 * Client wrapper that owns polling state and coordinates the delegation graph.
 * Polls every 30s for updated tree data and stops when all tasks are terminal.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TaskTreeNode, TimelineEvent, TreeHealth } from "@/services/tasks";

import { DelegationGraph } from "./delegation-graph";

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
  const [isPolling, setIsPolling] = useState(
    () => !isTreeTerminal(initialNodes),
  );
  const abortRef = useRef<AbortController | null>(null);

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

        setTree({
          nodes: data.nodes,
          events: data.events,
          health: data.health,
        });

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

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
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

      {/* Graph */}
      <div className="flex-1 relative" style={{ minHeight: 400 }}>
        <DelegationGraph
          treeNodes={tree.nodes}
          events={tree.events}
          health={tree.health}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          selectedNodeId={selectedNodeId}
        />
      </div>

      {/* Detail panel placeholder -- added in Plan 03 */}
      {/* Timeline placeholder -- added in Plan 03 */}
    </div>
  );
}
