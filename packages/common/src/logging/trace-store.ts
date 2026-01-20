/**
 * TraceStore for Workflow Observability
 *
 * Indexes log entries by task ID for query-by-task debugging.
 * Enables querying all workflow events for a specific task.
 */

import type { LogEntry } from "./logger.js";

/**
 * TraceStore stores and indexes log entries by task ID.
 *
 * Provides query methods for debugging workflow execution:
 * - getByTaskId: Get all entries for a specific task
 * - getByWorkflowId: Get all entries for a workflow run
 */
export class TraceStore {
  private readonly byTaskId = new Map<string, LogEntry[]>();

  /**
   * Append a log entry to the store.
   * Entry is indexed by taskId from entry.context.
   * No-op if taskId is missing.
   */
  append(entry: LogEntry): void {
    const taskId = entry.context.taskId;
    if (typeof taskId !== "string" || taskId === "") {
      return;
    }

    const entries = this.byTaskId.get(taskId) ?? [];
    entries.push(entry);
    this.byTaskId.set(taskId, entries);
  }

  /**
   * Get all log entries for a specific task ID.
   * Returns entries in append order.
   * Returns empty array if taskId not found.
   */
  getByTaskId(taskId: string): LogEntry[] {
    return this.byTaskId.get(taskId) ?? [];
  }

  /**
   * Get all log entries for a specific workflow ID.
   * Searches across all tasks for matching workflowId in context.
   * Returns empty array if workflowId not found.
   */
  getByWorkflowId(workflowId: string): LogEntry[] {
    const results: LogEntry[] = [];

    for (const entries of this.byTaskId.values()) {
      for (const entry of entries) {
        if (entry.context.workflowId === workflowId) {
          results.push(entry);
        }
      }
    }

    return results;
  }

  /**
   * Clear entries from the store.
   * If taskId is provided, clears only that task's entries.
   * If no taskId, clears all entries.
   */
  clear(taskId?: string): void {
    if (taskId !== undefined) {
      this.byTaskId.delete(taskId);
    } else {
      this.byTaskId.clear();
    }
  }

  /**
   * Get the total number of log entries across all tasks.
   */
  size(): number {
    let total = 0;
    for (const entries of this.byTaskId.values()) {
      total += entries.length;
    }
    return total;
  }
}

/**
 * Create a new TraceStore instance.
 */
export function createTraceStore(): TraceStore {
  return new TraceStore();
}
