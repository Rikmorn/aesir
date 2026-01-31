/**
 * Task Store
 *
 * Factory producing a service for persisting structured task state
 * throughout the agent workflow lifecycle.
 *
 * Tracks agent task status, branch/PR info, approval state, and
 * Slack context. One row per external task (e.g., Linear issue).
 *
 * Covers CTXM-02 (structured task state persistence).
 */

import type { PinoLogger } from "@aesir/platform";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "./schema.js";
import { type AgentTask, tasks } from "./schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskStoreOptions {
  /** Database client for task persistence */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance (will be wrapped with component child) */
  logger: PinoLogger;
}

export interface CreateTaskParams {
  taskId: string;
  agentType: string;
  issueId?: string;
  issueIdentifier?: string;
  workflowId?: string;
  slackChannel?: string;
  slackMessageTs?: string;
}

/** Fields that can be updated on an existing task */
export interface TaskUpdate {
  status:
    | "pending"
    | "researching"
    | "planning"
    | "approved"
    | "executing"
    | "complete"
    | "failed";
  workflowId: string;
  containerId: string;
  branchName: string;
  prNumber: number;
  prUrl: string;
  approvalStatus: "pending" | "approved" | "rejected";
  approvalFeedback: string;
  error: string;
  escalationReason: string;
  slackChannel: string;
  slackMessageTs: string;
}

export interface TaskStore {
  /** Create a new task record */
  createTask(params: CreateTaskParams): Promise<string>;
  /** Update specific fields of an existing task */
  updateTask(taskId: string, updates: Partial<TaskUpdate>): Promise<void>;
  /** Get a task by its external task_id */
  getTask(taskId: string): Promise<AgentTask | null>;
  /** Get a task by workflow_id */
  getTaskByWorkflowId(workflowId: string): Promise<AgentTask | null>;
  /** Health check */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  /** Graceful shutdown */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map camelCase TaskUpdate keys to snake_case Drizzle column names.
 * Only includes fields that are actually provided (not undefined).
 */
function mapUpdatesToColumns(
  updates: Partial<TaskUpdate>,
): Record<string, unknown> {
  const mapping: Record<keyof TaskUpdate, string> = {
    status: "status",
    workflowId: "workflow_id",
    containerId: "container_id",
    branchName: "branch_name",
    prNumber: "pr_number",
    prUrl: "pr_url",
    approvalStatus: "approval_status",
    approvalFeedback: "approval_feedback",
    error: "error",
    escalationReason: "escalation_reason",
    slackChannel: "slack_channel",
    slackMessageTs: "slack_message_ts",
  };

  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      const columnName = mapping[key as keyof TaskUpdate];
      if (columnName) {
        mapped[columnName] = value;
      }
    }
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a task store service for agent task state persistence.
 *
 * Follows the dependency injection factory pattern established by
 * observability/execution-tracker.ts.
 */
export function createTaskStore(options: TaskStoreOptions): TaskStore {
  const { db, logger: parentLogger } = options;

  if (!db) throw new Error("db is required for TaskStore");
  if (!parentLogger) throw new Error("logger is required for TaskStore");

  const logger = parentLogger.child({ component: "task-store" });

  return {
    async createTask(params: CreateTaskParams): Promise<string> {
      if (!params.taskId) {
        throw new Error("taskId is required for createTask");
      }
      if (!params.agentType) {
        throw new Error("agentType is required for createTask");
      }

      const rows = await db
        .insert(tasks)
        .values({
          task_id: params.taskId,
          agent_type: params.agentType,
          issue_id: params.issueId,
          issue_identifier: params.issueIdentifier,
          workflow_id: params.workflowId,
          slack_channel: params.slackChannel,
          slack_message_ts: params.slackMessageTs,
        })
        .onConflictDoUpdate({
          target: tasks.task_id,
          set: {
            agent_type: params.agentType,
            issue_id: params.issueId ?? null,
            issue_identifier: params.issueIdentifier ?? null,
            workflow_id: params.workflowId ?? null,
            slack_channel: params.slackChannel ?? null,
            slack_message_ts: params.slackMessageTs ?? null,
            status: "pending",
            container_id: null,
            branch_name: null,
            pr_number: null,
            pr_url: null,
            approval_status: "pending",
            approval_feedback: null,
            error: null,
            escalation_reason: null,
            updated_at: new Date(),
          },
        })
        .returning({ id: tasks.id });

      const row = rows[0];
      if (!row) {
        throw new Error("Failed to insert task - no row returned");
      }

      const taskDbId = row.id;

      logger.info(
        { taskDbId, taskId: params.taskId, agentType: params.agentType },
        "Task created",
      );

      return taskDbId;
    },

    async updateTask(
      taskId: string,
      updates: Partial<TaskUpdate>,
    ): Promise<void> {
      const mapped = mapUpdatesToColumns(updates);

      if (Object.keys(mapped).length === 0) {
        logger.warn({ taskId }, "updateTask called with no valid fields");
        return;
      }

      // Add updated_at timestamp
      mapped.updated_at = new Date();

      await db.update(tasks).set(mapped).where(eq(tasks.task_id, taskId));

      logger.info({ taskId, fields: Object.keys(updates) }, "Task updated");
    },

    async getTask(taskId: string): Promise<AgentTask | null> {
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.task_id, taskId))
        .limit(1);

      return rows[0] ?? null;
    },

    async getTaskByWorkflowId(workflowId: string): Promise<AgentTask | null> {
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.workflow_id, workflowId))
        .limit(1);

      return rows[0] ?? null;
    },

    async health(): Promise<{ healthy: boolean; latencyMs: number }> {
      const start = Date.now();
      try {
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close(): Promise<void> {
      logger.info("Task store close called (no-op, pool managed externally)");
    },
  };
}
