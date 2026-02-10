/**
 * TaskSignalDispatcher
 *
 * Fires completion/failure signals to delegating agents when delegated tasks
 * reach terminal state. Handles orphan scenarios by writing completion_result
 * to the task row and logging signal.orphaned events.
 *
 * At-most-once delivery: the task row (completion_result) is the durable record.
 * Signal dispatch failures are logged but never thrown -- the task update must
 * never fail due to signal delivery issues.
 */

import type { PinoLogger } from "@aesir/platform";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  ConversationExecutor,
  EventLog,
  Signal,
} from "../../framework/types.js";
import type * as agentsSchemaModule from "../db/schema.js";
import { tasks } from "../db/schema.js";
import type { TaskService } from "./task-service.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaskSignalDispatcherOptions {
  executor: ConversationExecutor;
  taskService: TaskService;
  eventLog: EventLog;
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
}

export interface TaskSignalDispatcher {
  /** Called by TaskService after a task status change. Dispatches signal if terminal + delegated. */
  onTaskUpdate(
    taskId: string,
    oldStatus: string,
    newStatus: string,
    handoffContext?: Record<string, unknown>,
  ): Promise<void>;
}

// ─── Terminal Status Set ────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

// ─── Helpers ────────────────────────────────────────────────────────────────

interface CompletionResult {
  signalType: string;
  payload: Record<string, unknown>;
  writtenAt: string;
  deliveryStatus: "pending" | "delivered" | "orphaned" | "failed";
  targetConversationId: string | null;
}

/**
 * Build a human-readable message for the signal.message field.
 * The agent sees this when it resumes from wait_for_task.
 */
function buildSignalMessage(
  signalType: string,
  taskId: string,
  payload: Record<string, unknown>,
): string {
  if (signalType === "task_completion") {
    const summary = (payload.summary as string) || "No summary provided";
    let message = `Task ${taskId} completed. Summary: ${summary}`;
    if (payload.artifacts && typeof payload.artifacts === "object") {
      const artifactKeys = Object.keys(
        payload.artifacts as Record<string, unknown>,
      );
      if (artifactKeys.length > 0) {
        message += `. Artifacts: ${artifactKeys.join(", ")}`;
      }
    }
    return message;
  }

  // task_failure or task_cancelled
  const reason = (payload.reason as string) || "No reason provided";
  let message = `Task ${taskId} failed. Reason: ${reason}`;
  if (payload.partialResults && typeof payload.partialResults === "object") {
    const resultKeys = Object.keys(
      payload.partialResults as Record<string, unknown>,
    );
    if (resultKeys.length > 0) {
      message += `. Partial results: ${resultKeys.join(", ")}`;
    }
  }
  return message;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createTaskSignalDispatcher(
  options: TaskSignalDispatcherOptions,
): TaskSignalDispatcher {
  const { executor, taskService, eventLog, db, logger: parentLogger } = options;

  if (!executor)
    throw new Error("executor is required for TaskSignalDispatcher");
  if (!taskService)
    throw new Error("taskService is required for TaskSignalDispatcher");
  if (!eventLog)
    throw new Error("eventLog is required for TaskSignalDispatcher");
  if (!db) throw new Error("db is required for TaskSignalDispatcher");
  if (!parentLogger)
    throw new Error("logger is required for TaskSignalDispatcher");

  const logger = parentLogger.child({ component: "task-signal-dispatcher" });

  return {
    async onTaskUpdate(taskId, oldStatus, newStatus, handoffContext) {
      // 1. Return early if not a terminal transition
      if (!TERMINAL_STATUSES.has(newStatus)) {
        return;
      }

      try {
        // 2. Fetch the full task
        const task = await taskService.get(taskId);
        if (!task) {
          logger.warn({ taskId }, "Task not found for signal dispatch");
          return;
        }

        // 3. Return early if root task (no parent -- nobody to signal)
        if (!task.parent_id) {
          return;
        }

        // 4. Determine signal type
        const signalType =
          newStatus === "completed" ? "task_completion" : "task_failure";

        // 5. Build self-contained signal payload
        const originalDescription = task.objective || task.title;
        const commonPayload = {
          taskId,
          originalDescription,
          entityId: task.assignee_id,
        };

        let payload: Record<string, unknown>;
        if (signalType === "task_completion") {
          payload = {
            ...commonPayload,
            summary: handoffContext?.summary ?? "Task completed",
            artifacts: handoffContext?.artifacts ?? {},
          };
        } else {
          // task_failure (covers both "failed" and "cancelled")
          payload = {
            ...commonPayload,
            reason:
              (handoffContext?.summary as string | undefined) ??
              `Task ${newStatus}`,
            partialResults: handoffContext?.artifacts ?? {},
          };
        }

        // 6. Build completion_result
        const completionResult: CompletionResult = {
          signalType,
          payload,
          writtenAt: new Date().toISOString(),
          deliveryStatus: "pending",
          targetConversationId: null,
        };

        // 7. Resolve callback conversation through parent task
        const callbackConv = await executor.findActiveForTask(task.parent_id);

        // 8. Orphan path: no active conversation for the parent task
        if (!callbackConv) {
          completionResult.deliveryStatus = "orphaned";

          // Write completion_result directly to task row (bypass taskService to avoid recursion)
          await db
            .update(tasks)
            .set({
              completion_result: completionResult as unknown as Record<
                string,
                unknown
              >,
            })
            .where(eq(tasks.id, taskId));

          // Log signal.orphaned event
          // Use a synthetic conversation/instance ID since there's no target conversation
          await eventLog.initSequence(`orphan-${taskId}`).catch(() => {
            // initSequence may fail if conversation doesn't exist -- that's expected for orphans
          });
          eventLog.append({
            conversationId: `orphan-${taskId}`,
            agentDefinitionId: task.assignee_id,
            agentDefinitionVersion: "unknown",
            agentInstanceId: `dispatcher-${taskId}`,
            type: "signal.orphaned",
            payload: {
              taskId,
              signalType,
              parentTaskId: task.parent_id,
            },
          });
          await eventLog.flush();

          logger.warn(
            {
              taskId,
              parentTaskId: task.parent_id,
              signalType,
            },
            "Signal orphaned: no active conversation for parent task",
          );
          return;
        }

        // 9. Delivery path: active conversation found
        const signal: Signal = {
          type: signalType,
          data: { taskId, ...payload },
          message: buildSignalMessage(signalType, taskId, payload),
          source: `task:${taskId}`,
          deduplicationId: `${signalType}-${taskId}`,
        };

        completionResult.targetConversationId = callbackConv.id;

        const result = await executor.signal(callbackConv.id, signal);
        completionResult.deliveryStatus =
          result.action === "rejected" ? "failed" : "delivered";

        // Write completion_result to task row
        await db
          .update(tasks)
          .set({
            completion_result: completionResult as unknown as Record<
              string,
              unknown
            >,
          })
          .where(eq(tasks.id, taskId));

        logger.info(
          {
            taskId,
            parentTaskId: task.parent_id,
            signalType,
            targetConversationId: callbackConv.id,
            deliveryAction: result.action,
            deliveryStatus: completionResult.deliveryStatus,
          },
          "Task signal dispatched",
        );
      } catch (error) {
        // 10. Signal dispatch failures are logged but never thrown
        logger.error(
          {
            err: error,
            taskId,
            oldStatus,
            newStatus,
          },
          "Task signal dispatch failed (non-fatal)",
        );
      }
    },
  };
}
