/**
 * GroupService
 *
 * CRUD service for task groups with atomic creation and policy evaluation.
 * Groups parallel delegated tasks under a completion policy.
 *
 * Follows the createService factory pattern from CLAUDE.md:
 * - Options object with fail-fast validation
 * - Interface return type
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type * as agentsSchemaModule from "../db/schema.js";
import type { GroupStatus, TaskGroup } from "../db/schema.js";
import { taskGroups, tasks } from "../db/schema.js";

// ─── Zod Validation Schemas ─────────────────────────────────────────────────

export const CompletionPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_required") }),
  z.object({ type: z.literal("any_sufficient") }),
  z.object({
    type: z.literal("min_required"),
    threshold: z.number().int().min(1),
  }),
]);

export const CreateGroupParamsSchema = z.object({
  delegatorConversationId: z.string().min(1),
  policy: CompletionPolicySchema,
  timeoutDuration: z.string().optional(),
  tokenBudget: z.number().int().optional(),
});

// ─── Types ──────────────────────────────────────────────────────────────────

/** Aggregated group state with per-task breakdown */
export interface GroupState {
  groupId: string;
  policy: { type: string; threshold?: number };
  status: GroupStatus;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  pending: number;
  tasks: Array<{
    taskId: string;
    status: string;
    assigneeId: string;
    title: string;
    completionResult: Record<string, unknown> | null;
  }>;
  /** Timeout pg-boss job ID (null if no group timeout) */
  timeoutJobId: string | null;
}

/** Parameters for creating a new group */
export interface CreateGroupParams {
  delegatorConversationId: string;
  policy: { type: string; threshold?: number };
  timeoutDuration?: string;
  tokenBudget?: number;
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface GroupServiceOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
}

export interface GroupService {
  /** Create a new task group atomically */
  create(params: CreateGroupParams): Promise<TaskGroup>;
  /** Get a group by ID */
  get(groupId: string): Promise<TaskGroup | null>;
  /** Get aggregated group state with per-task breakdown */
  getGroupState(groupId: string): Promise<GroupState>;
  /** Update group status */
  updateStatus(groupId: string, status: GroupStatus): Promise<void>;
  /** Set the timeout job ID on a group */
  setTimeoutJobId(groupId: string, jobId: string): Promise<void>;
}

// ─── Policy Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a group's completion policy against current task state counts.
 * Pure function -- no DB access. Exported for use by signal dispatcher.
 */
export function evaluatePolicy(
  policy: { type: string; threshold?: number },
  state: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
  },
): { satisfied: boolean; unsatisfiable: boolean } {
  switch (policy.type) {
    case "all_required":
      return {
        satisfied: state.completed === state.total,
        unsatisfiable: state.failed > 0 || state.cancelled > 0,
      };
    case "any_sufficient":
      return {
        satisfied: state.completed > 0,
        unsatisfiable:
          state.failed + state.cancelled === state.total && state.total > 0,
      };
    case "min_required": {
      const threshold = policy.threshold ?? 1;
      const remaining = state.total - state.failed - state.cancelled;
      return {
        satisfied: state.completed >= threshold,
        unsatisfiable: remaining < threshold,
      };
    }
    default:
      return { satisfied: false, unsatisfiable: false };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createGroupService(options: GroupServiceOptions): GroupService {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for GroupService");
  if (!logger) throw new Error("logger is required for GroupService");

  const log = logger.child({ component: "group-service" });

  return {
    async create(params) {
      const validated = CreateGroupParamsSchema.parse(params);
      const id = createId.taskGroup();
      const now = new Date();

      const [group] = await db
        .insert(taskGroups)
        .values({
          id,
          delegator_conversation_id: validated.delegatorConversationId,
          policy: validated.policy,
          status: "active",
          timeout_duration: validated.timeoutDuration ?? null,
          token_budget: validated.tokenBudget ?? null,
          created_at: now,
          updated_at: now,
        })
        .returning();

      if (!group) {
        throw new Error("Failed to create group: no row returned");
      }

      log.info(
        {
          groupId: id,
          policy: validated.policy.type,
          delegator: validated.delegatorConversationId,
        },
        "Task group created",
      );
      return group;
    },

    async get(groupId) {
      const [group] = await db
        .select()
        .from(taskGroups)
        .where(eq(taskGroups.id, groupId))
        .limit(1);

      return group ?? null;
    },

    async getGroupState(groupId) {
      // Fetch the group record
      const [group] = await db
        .select()
        .from(taskGroups)
        .where(eq(taskGroups.id, groupId))
        .limit(1);

      if (!group) {
        throw new Error(`Group not found: ${groupId}`);
      }

      // Fetch all tasks in this group
      const groupTasks = await db
        .select()
        .from(tasks)
        .where(eq(tasks.group_id, groupId));

      // Classify task statuses into aggregate counts
      const counts = {
        completed: 0,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      };

      const taskEntries = groupTasks.map((t) => {
        // Map statuses: created | counter_proposed -> pending, active | paused -> running
        switch (t.status) {
          case "created":
          case "counter_proposed":
            counts.pending++;
            break;
          case "active":
          case "paused":
            counts.running++;
            break;
          case "completed":
            counts.completed++;
            break;
          case "cancelled":
            counts.cancelled++;
            break;
        }

        return {
          taskId: t.id,
          status: t.status,
          assigneeId: t.assignee_id,
          title: t.title,
          completionResult:
            (t.completion_result as Record<string, unknown>) ?? null,
        };
      });

      return {
        groupId,
        policy: group.policy as { type: string; threshold?: number },
        status: group.status,
        total: groupTasks.length,
        completed: counts.completed,
        failed: counts.failed,
        cancelled: counts.cancelled,
        running: counts.running,
        pending: counts.pending,
        tasks: taskEntries,
        timeoutJobId: group.timeout_job_id,
      };
    },

    async updateStatus(groupId, status) {
      const now = new Date();

      const result = await db
        .update(taskGroups)
        .set({ status, updated_at: now })
        .where(eq(taskGroups.id, groupId))
        .returning({ id: taskGroups.id });

      if (result.length === 0) {
        throw new Error(`Group not found: ${groupId}`);
      }

      log.info({ groupId, status }, "Group status updated");
    },

    async setTimeoutJobId(groupId, jobId) {
      const now = new Date();

      const result = await db
        .update(taskGroups)
        .set({ timeout_job_id: jobId, updated_at: now })
        .where(eq(taskGroups.id, groupId))
        .returning({ id: taskGroups.id });

      if (result.length === 0) {
        throw new Error(`Group not found: ${groupId}`);
      }

      log.info({ groupId, jobId }, "Group timeout job ID set");
    },
  };
}
