/**
 * TaskService
 *
 * Factory-based service for CRUD operations on agents.tasks and agents.task_handoffs.
 * Validates input with Zod schemas (shape validation only -- business logic like
 * status transitions lives in the tool layer, Phase 58.2).
 *
 * Follows the createService factory pattern from CLAUDE.md:
 * - Options object with fail-fast validation
 * - Interface return type
 * - health() and close() lifecycle methods
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type * as agentsSchemaModule from "../db/schema.js";
import type { Task, TaskHandoff } from "../db/schema.js";
import { conversations, taskHandoffs, tasks } from "../db/schema.js";

// ─── Zod Validation Schemas ─────────────────────────────────────────────────

/** Actor type enum */
const ActorTypeSchema = z.enum(["agent", "human"]);

/** Task status enum */
const TaskStatusSchema = z.enum([
  "created",
  "active",
  "paused",
  "completed",
  "cancelled",
]);

/** Handoff type enum */
const HandoffTypeSchema = z.enum([
  "completion",
  "pause",
  "delegation",
  "escalation",
]);

/** Task metadata: valid JSONB, max 10KB */
const TaskMetadataSchema = z
  .record(z.unknown())
  .refine((meta) => Buffer.byteLength(JSON.stringify(meta), "utf-8") <= 10240, {
    message: "Task metadata must be under 10KB",
  });

/** Handoff context: required summary, optional fields, max 4KB total */
const HandoffContextSchema = z
  .object({
    summary: z
      .string()
      .min(1, "Summary is required")
      .max(2000, "Summary must be under 2000 characters"),
    key_decisions: z.array(z.string()).optional(),
    artifacts: z.record(z.unknown()).optional(),
    open_questions: z.array(z.string()).optional(),
    next_steps: z.string().optional(),
  })
  .refine((ctx) => Buffer.byteLength(JSON.stringify(ctx), "utf-8") <= 4096, {
    message: "Handoff context must be under 4KB",
  });

/** Create task params */
const CreateTaskParamsSchema = z.object({
  parentId: z.string().optional(),
  creatorType: ActorTypeSchema,
  creatorId: z.string().min(1),
  assigneeType: ActorTypeSchema,
  assigneeId: z.string().min(1),
  status: TaskStatusSchema.default("active"),
  title: z.string().min(1, "Title is required"),
  objective: z.string().optional(),
  metadata: TaskMetadataSchema.optional().default({}),
});

/** Update task params (at least one field required) */
const UpdateTaskParamsSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    title: z.string().min(1).optional(),
    objective: z.string().nullable().optional(),
    assigneeType: ActorTypeSchema.optional(),
    assigneeId: z.string().min(1).optional(),
    metadata: TaskMetadataSchema.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field must be provided for update",
  });

/** Add handoff params */
const AddHandoffParamsSchema = z.object({
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  handoffType: HandoffTypeSchema,
  context: HandoffContextSchema,
  authorType: ActorTypeSchema,
  authorId: z.string().min(1),
});

/** List filters */
const ListFiltersSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    limit: z.number().int().positive().max(100).optional().default(50),
  })
  .optional();

// ─── Exported Types ─────────────────────────────────────────────────────────

export type CreateTaskParams = z.input<typeof CreateTaskParamsSchema>;
export type UpdateTaskParams = z.input<typeof UpdateTaskParamsSchema>;
export type AddHandoffParams = z.input<typeof AddHandoffParamsSchema>;

// ─── Service Interface ──────────────────────────────────────────────────────

export interface TaskServiceOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
}

export interface TaskService {
  create(params: CreateTaskParams): Promise<Task>;
  get(taskId: string): Promise<Task | null>;
  update(taskId: string, fields: UpdateTaskParams): Promise<Task>;
  addHandoff(params: AddHandoffParams): Promise<TaskHandoff>;
  /** Atomically update task status and record a handoff in a single transaction. */
  transitionWithHandoff(
    taskId: string,
    newStatus: string,
    handoff: Omit<AddHandoffParams, "taskId">,
  ): Promise<{ task: Task; handoff: TaskHandoff }>;
  getHandoffs(
    taskId: string,
    opts?: { limit?: number },
  ): Promise<TaskHandoff[]>;
  getLatestHandoff(taskId: string): Promise<TaskHandoff | null>;
  listByAssignee(
    assigneeType: string,
    assigneeId: string,
    filters?: { status?: string; limit?: number },
  ): Promise<Task[]>;
  listByParent(
    parentId: string,
    filters?: { status?: string; limit?: number },
  ): Promise<Task[]>;
  linkConversation(taskId: string, conversationId: string): Promise<void>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createTaskService(options: TaskServiceOptions): TaskService {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for TaskService");
  if (!logger) throw new Error("logger is required for TaskService");

  const log = logger.child({ component: "task-service" });

  return {
    async create(params) {
      const validated = CreateTaskParamsSchema.parse(params);
      const id = createId.task();
      const now = new Date();

      const [task] = await db
        .insert(tasks)
        .values({
          id,
          parent_id: validated.parentId ?? null,
          creator_type: validated.creatorType,
          creator_id: validated.creatorId,
          assignee_type: validated.assigneeType,
          assignee_id: validated.assigneeId,
          status: validated.status,
          title: validated.title,
          objective: validated.objective ?? null,
          metadata: validated.metadata,
          created_at: now,
          updated_at: now,
        })
        .returning();

      if (!task) {
        throw new Error("Failed to create task: no row returned");
      }

      log.info({ taskId: id, title: validated.title }, "Task created");
      return task;
    },

    async get(taskId) {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      return task ?? null;
    },

    async update(taskId, fields) {
      const validated = UpdateTaskParamsSchema.parse(fields);
      const now = new Date();

      // Build the update values, mapping camelCase to snake_case
      const updateValues: Record<string, unknown> = {
        updated_at: now,
      };

      if (validated.status !== undefined) {
        updateValues.status = validated.status;
        if (validated.status === "completed") {
          updateValues.completed_at = now;
        }
      }
      if (validated.title !== undefined) {
        updateValues.title = validated.title;
      }
      if (validated.objective !== undefined) {
        updateValues.objective = validated.objective;
      }
      if (validated.assigneeType !== undefined) {
        updateValues.assignee_type = validated.assigneeType;
      }
      if (validated.assigneeId !== undefined) {
        updateValues.assignee_id = validated.assigneeId;
      }
      if (validated.metadata !== undefined) {
        updateValues.metadata = validated.metadata;
      }

      const [task] = await db
        .update(tasks)
        .set(updateValues)
        .where(eq(tasks.id, taskId))
        .returning();

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      log.info({ taskId, fields: Object.keys(validated) }, "Task updated");
      return task;
    },

    async addHandoff(params) {
      const validated = AddHandoffParamsSchema.parse(params);
      const id = createId.handoff();

      const [handoff] = await db
        .insert(taskHandoffs)
        .values({
          id,
          task_id: validated.taskId,
          conversation_id: validated.conversationId,
          handoff_type: validated.handoffType,
          context: validated.context,
          author_type: validated.authorType,
          author_id: validated.authorId,
        })
        .returning();

      if (!handoff) {
        throw new Error("Failed to create handoff: no row returned");
      }

      log.info(
        {
          handoffId: id,
          taskId: validated.taskId,
          type: validated.handoffType,
        },
        "Handoff created",
      );
      return handoff;
    },

    async transitionWithHandoff(taskId, newStatus, handoff) {
      const validatedHandoff = AddHandoffParamsSchema.parse({
        ...handoff,
        taskId,
      });
      const now = new Date();
      const handoffId = createId.handoff();

      const result = await db.transaction(async (tx) => {
        const updateValues: Record<string, unknown> = {
          status: newStatus,
          updated_at: now,
        };
        if (newStatus === "completed") {
          updateValues.completed_at = now;
        }

        const [task] = await tx
          .update(tasks)
          .set(updateValues)
          .where(eq(tasks.id, taskId))
          .returning();

        if (!task) {
          throw new Error(`Task not found: ${taskId}`);
        }

        const [handoffRecord] = await tx
          .insert(taskHandoffs)
          .values({
            id: handoffId,
            task_id: validatedHandoff.taskId,
            conversation_id: validatedHandoff.conversationId,
            handoff_type: validatedHandoff.handoffType,
            context: validatedHandoff.context,
            author_type: validatedHandoff.authorType,
            author_id: validatedHandoff.authorId,
          })
          .returning();

        if (!handoffRecord) {
          throw new Error("Failed to create handoff: no row returned");
        }

        return { task, handoff: handoffRecord };
      });

      log.info(
        {
          taskId,
          newStatus,
          handoffId,
          handoffType: validatedHandoff.handoffType,
        },
        "Task transitioned with handoff",
      );

      return result;
    },

    async getHandoffs(taskId, opts) {
      const limit = opts?.limit ?? 50;

      return db
        .select()
        .from(taskHandoffs)
        .where(eq(taskHandoffs.task_id, taskId))
        .orderBy(desc(taskHandoffs.created_at))
        .limit(limit);
    },

    async getLatestHandoff(taskId) {
      const [handoff] = await db
        .select()
        .from(taskHandoffs)
        .where(eq(taskHandoffs.task_id, taskId))
        .orderBy(desc(taskHandoffs.created_at))
        .limit(1);

      return handoff ?? null;
    },

    async listByAssignee(assigneeType, assigneeId, filters) {
      const validated = ListFiltersSchema.parse(filters);
      const limit = validated?.limit ?? 50;

      const conditions = [
        eq(tasks.assignee_type, assigneeType as "agent" | "human"),
        eq(tasks.assignee_id, assigneeId),
      ];

      if (validated?.status) {
        conditions.push(eq(tasks.status, validated.status));
      }

      return db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.created_at))
        .limit(limit);
    },

    async listByParent(parentId, filters) {
      const validated = ListFiltersSchema.parse(filters);
      const limit = validated?.limit ?? 50;

      const conditions = [eq(tasks.parent_id, parentId)];

      if (validated?.status) {
        conditions.push(eq(tasks.status, validated.status));
      }

      return db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.created_at))
        .limit(limit);
    },

    async linkConversation(taskId, conversationId) {
      const now = new Date();

      const result = await db
        .update(conversations)
        .set({ task_id: taskId, updated_at: now })
        .where(eq(conversations.id, conversationId))
        .returning({ id: conversations.id });

      if (result.length === 0) {
        throw new Error(`Conversation not found: ${conversationId}`);
      }

      log.info({ taskId, conversationId }, "Conversation linked to task");
    },

    async health() {
      const start = Date.now();
      try {
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close() {
      log.info("TaskService closed (DB connection managed externally)");
    },
  };
}
