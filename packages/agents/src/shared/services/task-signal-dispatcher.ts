/**
 * TaskSignalDispatcher
 *
 * Fires completion/failure signals to delegating agents when delegated tasks
 * reach terminal state. Handles orphan scenarios by writing completion_result
 * to the task row and logging signal.orphaned events.
 *
 * Phase 81 extension: Group-aware signaling. When a task with a group_id reaches
 * terminal state, the dispatcher evaluates the group's completion policy instead
 * of sending per-task signals. The delegator is only woken when the policy
 * dictates (satisfied, unsatisfiable, or settled).
 *
 * At-most-once delivery: the task row (completion_result) is the durable record.
 * Signal dispatch failures are logged but never thrown -- the task update must
 * never fail due to signal delivery issues.
 */

import type { PinoLogger } from "@aesir/platform";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  ConversationExecutor,
  EventLog,
  Signal,
} from "../../framework/types.js";
import type * as agentsSchemaModule from "../db/schema.js";
import { taskGroups, tasks } from "../db/schema.js";
import type { GroupService, GroupState } from "./group-service.js";
import { evaluatePolicy } from "./group-service.js";
import type { TaskService } from "./task-service.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaskSignalDispatcherOptions {
  executor: ConversationExecutor;
  taskService: TaskService;
  eventLog: EventLog;
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
  /** GroupService for policy evaluation (Phase 81, optional for backward compat) */
  groupService?: GroupService;
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

// ─── Group Terminal Statuses ────────────────────────────────────────────────

const GROUP_TERMINAL_STATUSES = new Set([
  "satisfied",
  "unsatisfiable",
  "cancelled",
  "settled",
]);

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

/**
 * Build group signal data payload with state context.
 */
function buildGroupSignalData(
  groupId: string,
  triggeringTaskId: string,
  policyType: string,
  result: { satisfied: boolean; unsatisfiable: boolean },
  state: GroupState,
): Record<string, unknown> {
  return {
    groupId,
    taskId: triggeringTaskId,
    policyType,
    policySatisfied: result.satisfied,
    policyUnsatisfiable: result.unsatisfiable,
    groupState: {
      total: state.total,
      completed: state.completed,
      failed: state.failed,
      cancelled: state.cancelled,
      running: state.running,
    },
    taskSummaries: state.tasks
      .filter((t) =>
        ["completed", "failed", "cancelled"].includes(t.status),
      )
      .map((t) => ({
        taskId: t.taskId,
        status: t.status,
        assigneeId: t.assigneeId,
        result: t.completionResult,
      })),
  };
}

/**
 * Build group signal human-readable message.
 */
function buildGroupSignalMessage(
  signalType: string,
  groupId: string,
  triggeringTaskId: string,
  policyType: string,
  state: GroupState,
): string {
  switch (signalType) {
    case "group_policy_satisfied":
      return `Group ${groupId} policy satisfied (${policyType}). ${state.completed}/${state.total} tasks completed.`;
    case "group_policy_unsatisfiable":
      return `Task ${triggeringTaskId} failed in group ${groupId}. Group state: ${state.completed} completed, ${state.failed} failed, ${state.running} running. Policy: ${policyType} (no longer satisfiable).`;
    case "group_task_failed":
      return `Task ${triggeringTaskId} failed in group ${groupId} (all_required policy). Group state: ${state.completed} completed, ${state.failed} failed, ${state.running} running.`;
    case "group_settled":
      return `All tasks in group ${groupId} have reached terminal state. Final: ${state.completed} completed, ${state.failed} failed, ${state.cancelled} cancelled.`;
    default:
      return `Group ${groupId} signal: ${signalType}`;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createTaskSignalDispatcher(
  options: TaskSignalDispatcherOptions,
): TaskSignalDispatcher {
  const {
    executor,
    taskService,
    eventLog,
    db,
    logger: parentLogger,
    groupService,
  } = options;

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

  /**
   * Handle group-aware task update: evaluate policy and signal delegator.
   * Race condition prevented via SELECT FOR UPDATE on the group row.
   */
  async function handleGroupTaskUpdate(
    task: { id: string; group_id: string; assignee_id: string },
    newStatus: string,
  ): Promise<void> {
    if (!groupService) return;

    // 1. Lock the group row to prevent concurrent evaluation races
    const lockResult = await db.execute(
      sql`SELECT * FROM agents.task_groups WHERE id = ${task.group_id} FOR UPDATE`,
    );
    const lockedGroup = lockResult.rows[0];

    if (!lockedGroup) {
      logger.warn(
        { taskId: task.id, groupId: task.group_id },
        "Group not found for group-aware signal dispatch",
      );
      return;
    }

    const groupStatus = lockedGroup.status as string;
    const groupPolicy = lockedGroup.policy as {
      type: string;
      threshold?: number;
    };
    const delegatorConversationId =
      lockedGroup.delegator_conversation_id as string;

    // 2. Get full group state for policy evaluation
    const state = await groupService.getGroupState(task.group_id);

    // 3. Evaluate policy (only if group is still active)
    if (!GROUP_TERMINAL_STATUSES.has(groupStatus)) {
      const result = evaluatePolicy(groupPolicy, state);

      if (result.satisfied) {
        // Policy satisfied -- transition group and signal delegator
        await groupService.updateStatus(task.group_id, "satisfied");

        const signalData = buildGroupSignalData(
          task.group_id,
          task.id,
          groupPolicy.type,
          result,
          state,
        );

        const signal: Signal = {
          type: "group_policy_satisfied",
          data: signalData,
          message: buildGroupSignalMessage(
            "group_policy_satisfied",
            task.group_id,
            task.id,
            groupPolicy.type,
            state,
          ),
          source: `group:${task.group_id}`,
          deduplicationId: `group_policy_satisfied-${task.group_id}`,
        };

        const deliveryResult = await executor.signal(
          delegatorConversationId,
          signal,
        );

        logger.info(
          {
            taskId: task.id,
            groupId: task.group_id,
            signalType: "group_policy_satisfied",
            policyType: groupPolicy.type,
            deliveryAction: deliveryResult.action,
          },
          "Group policy satisfied signal dispatched",
        );

        // Write completion_result on the triggering task
        await writeGroupCompletionResult(
          task.id,
          "group_policy_satisfied",
          signalData,
          delegatorConversationId,
          deliveryResult.action === "rejected" ? "failed" : "delivered",
        );
      } else if (result.unsatisfiable) {
        // Policy unsatisfiable -- transition group and signal delegator
        await groupService.updateStatus(task.group_id, "unsatisfiable");

        // Use group_task_failed for all_required (indicates specific failure),
        // group_policy_unsatisfiable for other policy types
        const signalType =
          groupPolicy.type === "all_required"
            ? "group_task_failed"
            : "group_policy_unsatisfiable";

        const signalData = buildGroupSignalData(
          task.group_id,
          task.id,
          groupPolicy.type,
          result,
          state,
        );

        const signal: Signal = {
          type: signalType,
          data: signalData,
          message: buildGroupSignalMessage(
            signalType,
            task.group_id,
            task.id,
            groupPolicy.type,
            state,
          ),
          source: `group:${task.group_id}`,
          deduplicationId: `${signalType}-${task.group_id}`,
        };

        const deliveryResult = await executor.signal(
          delegatorConversationId,
          signal,
        );

        logger.info(
          {
            taskId: task.id,
            groupId: task.group_id,
            signalType,
            policyType: groupPolicy.type,
            deliveryAction: deliveryResult.action,
          },
          "Group policy unsatisfiable signal dispatched",
        );

        // Write completion_result on the triggering task
        await writeGroupCompletionResult(
          task.id,
          signalType,
          signalData,
          delegatorConversationId,
          deliveryResult.action === "rejected" ? "failed" : "delivered",
        );
      }
      // Neither satisfied nor unsatisfiable -- more tasks still running, no signal
    }

    // 4. Settled check: if all tasks are terminal and group is already in a non-active state,
    // transition to settled and send group_settled signal
    const currentGroupStatus = GROUP_TERMINAL_STATUSES.has(groupStatus)
      ? groupStatus
      : (await groupService.getGroupState(task.group_id)).status;

    // Re-read state to get latest counts after possible status change
    const latestState = await groupService.getGroupState(task.group_id);
    const allTerminal =
      latestState.running === 0 && latestState.pending === 0;

    if (
      allTerminal &&
      latestState.status !== "active" &&
      latestState.status !== "settled"
    ) {
      await groupService.updateStatus(task.group_id, "settled");

      const result = evaluatePolicy(groupPolicy, latestState);
      const signalData = buildGroupSignalData(
        task.group_id,
        task.id,
        groupPolicy.type,
        result,
        latestState,
      );

      const signal: Signal = {
        type: "group_settled",
        data: signalData,
        message: buildGroupSignalMessage(
          "group_settled",
          task.group_id,
          task.id,
          groupPolicy.type,
          latestState,
        ),
        source: `group:${task.group_id}`,
        deduplicationId: `group_settled-${task.group_id}`,
      };

      const deliveryResult = await executor.signal(
        delegatorConversationId,
        signal,
      );

      logger.info(
        {
          taskId: task.id,
          groupId: task.group_id,
          signalType: "group_settled",
          deliveryAction: deliveryResult.action,
        },
        "Group settled signal dispatched",
      );
    }
  }

  /**
   * Write completion_result on a task for group signal dispatch tracking.
   */
  async function writeGroupCompletionResult(
    taskId: string,
    signalType: string,
    payload: Record<string, unknown>,
    targetConversationId: string,
    deliveryStatus: "delivered" | "failed",
  ): Promise<void> {
    const completionResult: CompletionResult = {
      signalType,
      payload,
      writtenAt: new Date().toISOString(),
      deliveryStatus,
      targetConversationId,
    };

    await db
      .update(tasks)
      .set({
        completion_result: completionResult as unknown as Record<
          string,
          unknown
        >,
      })
      .where(eq(tasks.id, taskId));
  }

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

        // 3a. Group-aware signaling: if task has group_id, delegate to group evaluation
        if (task.group_id && groupService) {
          await handleGroupTaskUpdate(
            {
              id: task.id,
              group_id: task.group_id,
              assignee_id: task.assignee_id,
            },
            newStatus,
          );
          return;
        }

        // 3b. Return early if root task (no parent -- nobody to signal)
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
