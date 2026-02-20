/**
 * task:delegate_group Tool Factory
 *
 * Creates multiple parallel delegations as a group with a shared completion
 * policy. Each task is delegated to a separate agent, and the group tracks
 * aggregate progress via the GroupService.
 *
 * Delegation flow:
 * 1. Validate all tasks atomically (any failure rejects entire group)
 * 2. Create group via GroupService
 * 3. Create tasks + start conversations for each
 * 4. Rollback on partial failure (cancel started conversations, delete group)
 * 5. Optionally schedule group-level timeout
 * 6. Return groupId + per-task mapping
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { conversations, tasks } from "../../db/schema.js";
import { MaterializationConfigSchema } from "../../services/materialization/types.js";
import {
  buildDelegationBlock,
  resolveParentLinearIssueId,
} from "./delegate-task.js";
import { MAX_DELEGATION_DEPTH } from "./types.js";

// ─── Input Schemas ──────────────────────────────────────────────────────────

const TaskInGroupSchema = z
  .object({
    agentId: z.string().min(1).optional(),
    capability: z.string().min(1).optional(),
    description: z.string().min(1),
    timeout: z
      .string()
      .optional()
      .describe("Per-task timeout (e.g., '1h'). Optional within groups."),
  })
  .refine(
    (task) => (task.agentId != null) !== (task.capability != null),
    "Exactly one of agentId or capability must be provided",
  );

const CompletionPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_required") }),
  z.object({ type: z.literal("any_sufficient") }),
  z.object({
    type: z.literal("min_required"),
    threshold: z.number().int().min(1),
  }),
]);

const DelegateGroupInputSchema = z.object({
  tasks: z
    .array(TaskInGroupSchema)
    .min(2)
    .describe("Tasks to delegate in parallel (minimum 2)"),
  policy: CompletionPolicySchema.describe("Completion policy for the group"),
  timeout: z
    .string()
    .optional()
    .describe("Group-level timeout (e.g., '2h'). Caps total wall time."),
  materialization: MaterializationConfigSchema.optional().describe(
    "Optional materialization config applied to ALL tasks in the group. Creates individual Linear issues per task.",
  ),
});

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the task:delegate_group tool.
 *
 * Requires ctx.delegationDeps with groupService to be populated.
 * Returns a descriptive error if delegation dependencies are not available.
 */
export function createDelegateGroupTool(ctx: ToolContext): ToolDefinition {
  return {
    name: "delegate_group",
    description:
      "Create parallel delegations to multiple agents as a group with a shared completion policy. " +
      "All tasks are validated atomically -- if any task fails validation, the entire group is rejected. " +
      "Policies: 'all_required' (all must complete), 'any_sufficient' (first completion satisfies), " +
      "'min_required' (N completions needed). After calling this, use wait_for_group to await the result.",
    inputSchema: DelegateGroupInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = DelegateGroupInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const deps = ctx.delegationDeps;
      if (!deps) {
        return {
          content:
            "Delegation not available -- this agent is not configured for delegation.",
          isError: true,
        };
      }

      if (!deps.groupService) {
        return {
          content:
            "Group delegation not available -- groupService is not configured.",
          isError: true,
        };
      }

      const { tasks: taskInputs, policy, timeout } = parsed.data;

      // Validate min_required threshold
      if (
        policy.type === "min_required" &&
        policy.threshold > taskInputs.length
      ) {
        return {
          content: `Invalid policy: min_required threshold (${policy.threshold}) exceeds task count (${taskInputs.length}). Threshold must be <= number of tasks.`,
          isError: true,
        };
      }

      try {
        // 1. Validate all tasks atomically
        const validationErrors: string[] = [];
        const validatedEntities: Array<{
          id: string;
          name: string;
          type: string;
        }> = [];

        for (const [i, task] of taskInputs.entries()) {
          // Capability-based routing not yet available
          if (task.capability) {
            validationErrors.push(
              `Task ${i + 1}: Capability-based routing not yet available (Phase 85). Use agentId.`,
            );
            continue;
          }

          if (!task.agentId) {
            validationErrors.push(
              `Task ${i + 1}: agentId is required (capability routing not yet available).`,
            );
            continue;
          }

          // Verify entity exists
          const entity = await deps.directoryService.get(task.agentId);
          if (!entity) {
            validationErrors.push(
              `Task ${i + 1}: Target entity not found or inactive: ${task.agentId}. Use directory:find to discover available agents.`,
            );
            continue;
          }

          validatedEntities.push({
            id: entity.id,
            name: entity.name,
            type: entity.type,
          });
        }

        // Atomic: any validation failure rejects entire group
        if (validationErrors.length > 0) {
          return {
            content: [
              "Group delegation failed -- validation errors:",
              ...validationErrors.map((e) => `  - ${e}`),
              "",
              "Fix all errors and retry. No tasks were created.",
            ].join("\n"),
            isError: true,
          };
        }

        // 2. Check delegation depth for parent task
        const parentId = ctx.taskId ?? null;
        let newDepth = 0;

        if (parentId) {
          const parentTask = await deps.taskService.get(parentId);
          if (!parentTask) {
            return {
              content: `Parent task not found: ${parentId}. Cannot determine delegation depth.`,
              isError: true,
            };
          }

          const parentDepth = parentTask.depth;
          if (parentDepth + 1 >= MAX_DELEGATION_DEPTH) {
            return {
              content: `Delegation depth limit reached (${MAX_DELEGATION_DEPTH}). Handle this work directly or report failure to your delegator.`,
              isError: true,
            };
          }
          newDepth = parentDepth + 1;
        }

        // 3. Create group via GroupService
        const createGroupParams: {
          delegatorConversationId: string;
          policy: typeof policy;
          timeoutDuration?: string;
        } = {
          delegatorConversationId: ctx.correlationId,
          policy,
        };
        if (timeout) {
          createGroupParams.timeoutDuration = timeout;
        }
        const group = await deps.groupService.create(createGroupParams);

        // 4. Create tasks and start conversations (with rollback on failure)
        const createdTasks: Array<{
          taskId: string;
          conversationId: string;
          entityId: string;
          entityName: string;
          title: string;
        }> = [];

        // 4a. Resolve parent issue once for all tasks in the group
        let parentIssueId: string | null = null;
        if (
          parsed.data.materialization?.type === "transparent" &&
          deps.materializationAdapter
        ) {
          parentIssueId = await resolveParentLinearIssueId(deps, ctx);
        }
        const groupShortId = group.id.slice(-8);
        let matSuccessCount = 0;
        let matFailureCount = 0;

        try {
          for (const [i, taskInput] of taskInputs.entries()) {
            const entity = validatedEntities[i];
            if (!entity) continue; // validated above, defensive guard

            // Create task with group_id
            const task = await deps.taskService.create({
              parentId: parentId ?? undefined,
              creatorType: "agent",
              creatorId: ctx.agentId,
              assigneeType: entity.type as "agent" | "human",
              assigneeId: entity.id,
              title: taskInput.description.slice(0, 100),
              objective: taskInput.description,
              status: "created",
              depth: newDepth,
              metadata: {
                delegatedBy: ctx.agentId,
                groupId: group.id,
              },
            });

            // Set group_id on the task via direct DB update
            // (TaskService.create does not accept groupId parameter)
            await deps.db
              .update(tasks)
              .set({ group_id: group.id, updated_at: new Date() })
              .where(eq(tasks.id, task.id));

            // 4b. Materialize individual task if group-level materialization is set
            if (
              parsed.data.materialization?.type === "transparent" &&
              deps.materializationAdapter
            ) {
              const groupLabels = [`group-${groupShortId}`];
              const mergedLabels = [
                ...(parsed.data.materialization.properties?.labels ?? []),
                ...groupLabels,
              ];

              const matResult = await deps.materializationAdapter.create({
                taskId: task.id,
                conversationId: ctx.correlationId,
                agentId: ctx.agentId,
                description: taskInput.description,
                properties: {
                  ...parsed.data.materialization.properties,
                  labels: mergedLabels,
                },
                ...(parentIssueId ? { parentIssueId } : {}),
                correlationId: ctx.correlationId,
              });

              if (matResult) {
                matSuccessCount++;
                ctx.logger.info(
                  {
                    taskId: task.id,
                    groupId: group.id,
                    externalId: matResult.externalId,
                  },
                  "Group task materialized as Linear issue",
                );
              } else {
                matFailureCount++;
                ctx.logger.warn(
                  { taskId: task.id, groupId: group.id },
                  "Group task materialization failed (non-fatal)",
                );
              }
            }

            // Build delegation XML block
            const delegationBlock = buildDelegationBlock({
              taskId: task.id,
              from: ctx.agentId,
              depth: newDepth,
              maxDepth: MAX_DELEGATION_DEPTH,
              description: taskInput.description,
            });

            // Start target conversation
            const conversationId = await deps.executor.start({
              agentDefinitionId: entity.id,
              correlationKey: task.id,
              initialMessage: delegationBlock,
              taskId: task.id,
            });

            createdTasks.push({
              taskId: task.id,
              conversationId,
              entityId: entity.id,
              entityName: entity.name,
              title: taskInput.description.slice(0, 100),
            });
          }
        } catch (error) {
          // Rollback: cancel already-started conversations
          for (const created of createdTasks) {
            try {
              await deps.executor.cancel(created.conversationId);
            } catch {
              // Best-effort cancellation during rollback
            }
          }

          // Mark group as cancelled
          try {
            await deps.groupService.updateStatus(group.id, "cancelled");
          } catch {
            // Best-effort group cleanup
          }

          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            content: `Group delegation failed during task creation (rolled back ${createdTasks.length} started tasks): ${message}`,
            isError: true,
          };
        }

        // 5. Schedule group timeout if provided
        if (timeout && deps.timeoutScheduler) {
          try {
            const jobId = await deps.timeoutScheduler.schedule(
              group.delegator_conversation_id,
              timeout,
              "group_timeout",
              `Group ${group.id} timeout`,
              { groupId: group.id },
            );
            await deps.groupService.setTimeoutJobId(group.id, jobId);
          } catch (error) {
            // Non-fatal: timeout scheduling failure should not fail the delegation
            ctx.logger.warn(
              { err: error, groupId: group.id },
              "Failed to schedule group timeout (non-fatal)",
            );
          }
        }

        // 6. Track all delegations in active_delegations on delegator conversation
        try {
          const delegationEntries = createdTasks.map((t) => ({
            taskId: t.taskId,
            targetEntityId: t.entityId,
            description: t.title,
            delegatedAt: new Date().toISOString(),
            handshakeStatus: "pending",
            groupId: group.id,
          }));

          const [conv] = await deps.db
            .select({
              active_delegations: conversations.active_delegations,
            })
            .from(conversations)
            .where(eq(conversations.id, ctx.correlationId))
            .limit(1);

          const currentDelegations = (conv?.active_delegations ??
            []) as unknown[];
          const updatedDelegations = [
            ...currentDelegations,
            ...delegationEntries,
          ];

          await deps.db
            .update(conversations)
            .set({
              active_delegations: updatedDelegations,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, ctx.correlationId));
        } catch (delegationTrackingError) {
          ctx.logger.warn(
            { err: delegationTrackingError, groupId: group.id },
            "Failed to write active_delegations entries (non-fatal)",
          );
        }

        // 7. Format policy label for response
        let policyLabel: string;
        if (policy.type === "all_required") {
          policyLabel = "all_required (all tasks must complete)";
        } else if (policy.type === "any_sufficient") {
          policyLabel = "any_sufficient (first completion satisfies)";
        } else {
          policyLabel = `min_required (${policy.threshold} of ${taskInputs.length} must complete)`;
        }

        // 8. Return human-readable response
        const taskLines = createdTasks.map(
          (t, i) =>
            `  ${i + 1}. ${t.entityName} (${t.entityId}) -> task ${t.taskId}`,
        );

        const responseLines = [
          `Group delegation created successfully.`,
          `Group ID: ${group.id}`,
          `Policy: ${policyLabel}`,
          `Tasks (${createdTasks.length}):`,
          ...taskLines,
        ];

        if (timeout) {
          responseLines.push(`Timeout: ${timeout}`);
        }

        // Materialization summary
        if (
          parsed.data.materialization?.type === "transparent" &&
          deps.materializationAdapter
        ) {
          if (matFailureCount === 0) {
            responseLines.push(
              `Materialization: Linear issues created for ${matSuccessCount} group tasks (label: group-${groupShortId})`,
            );
          } else if (matSuccessCount === 0) {
            responseLines.push(
              "Materialization: all issues failed to create (tasks running as internal)",
            );
          } else {
            responseLines.push(
              `Materialization: ${matSuccessCount} issues created, ${matFailureCount} failed (tasks running as internal)`,
            );
          }
        } else if (
          parsed.data.materialization?.type === "transparent" &&
          !deps.materializationAdapter
        ) {
          responseLines.push(
            "Warning: materialization requested but adapter not configured. Tasks running as internal.",
          );
        }

        responseLines.push(
          ``,
          `Next: call wait_for_group with groupId "${group.id}" to await the result.`,
        );

        return {
          content: responseLines.join("\n"),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to create group delegation: ${message}`,
          isError: true,
        };
      }
    },
  };
}
