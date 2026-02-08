/**
 * Shared types and utilities for task tools.
 *
 * Status transitions are enforced at the tool layer (not the service layer)
 * per the SERVICE-SHAPE-ONLY decision from Phase 58.1.
 */

import type { TaskService } from "../../services/task-service.js";

/** Valid status transitions enforced by task tools (not the service layer). */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  created: ["active"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Check if a status transition is valid. */
export function isValidTransition(from: string, to: string): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/** Format valid transitions for error messages. */
export function formatValidTransitions(status: string): string {
  const valid = VALID_TRANSITIONS[status] ?? [];
  return valid.length > 0 ? valid.join(", ") : "none (terminal state)";
}

/** Maximum depth of parent_id chains (system-wide safety limit). */
export const MAX_TASK_DEPTH = 5;

/** Maximum subtasks per parent task (system-wide safety limit). */
export const MAX_SUBTASKS_PER_PARENT = 10;

/** Dependencies injected into task tool factories alongside ToolContext. */
export type TaskToolDeps = TaskService;
