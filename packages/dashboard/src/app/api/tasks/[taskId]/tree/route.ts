/**
 * Task Tree API Route
 *
 * Returns the full task tree for a given root task ID, including
 * all descendant nodes, delegation timeline events, and health indicators.
 *
 * GET /api/tasks/:taskId/tree
 * Returns: { nodes: TaskTreeNode[], events: TimelineEvent[], health: TreeHealth }
 */

import { NextResponse } from "next/server";

import {
  computeTreeHealth,
  getTaskTimeline,
  getTaskTree,
} from "@/services/tasks";

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { taskId } = await params;

  if (!taskId) {
    return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
  }

  const nodes = await getTaskTree(taskId);

  if (nodes.length === 0) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const taskIds = nodes.map((n) => n.id);
  const events = await getTaskTimeline(taskIds);
  const health = computeTreeHealth(nodes, events);

  return NextResponse.json({ nodes, events, health });
}
