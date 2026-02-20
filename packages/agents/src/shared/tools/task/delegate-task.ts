/**
 * task:delegate Tool Factory
 *
 * Creates a delegation task targeting a directory entity, starts a conversation
 * for the target agent, and enforces MAX_DELEGATION_DEPTH. The target agent
 * receives a <delegation> XML block as its initial message.
 *
 * Delegation flow:
 * 1. Validate target entity exists and is active
 * 2. Check delegation depth limit
 * 3. Create task with depth tracking
 * 4. Build <delegation> XML block
 * 5. Start target conversation via executor.start()
 * 6. Return task ID and suggest wait_for with task_handshake type
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { conversations, workCorrelations } from "../../db/schema.js";
import { MaterializationConfigSchema } from "../../services/materialization/types.js";
import { MAX_DELEGATION_DEPTH } from "./types.js";

const DelegateTaskInputSchema = z.object({
  targetEntityId: z
    .string()
    .min(1)
    .describe("ID of the directory entity to delegate to"),
  description: z
    .string()
    .min(1)
    .describe(
      "The delegation brief -- what the target agent should accomplish",
    ),
  parentTaskId: z
    .string()
    .optional()
    .describe(
      "Parent task ID override. Defaults to the current conversation's task.",
    ),
  materialization: MaterializationConfigSchema.optional().describe(
    'Optional materialization config. Use { type: "transparent", target: "linear" } to create a corresponding Linear issue for human visibility.',
  ),
});

/**
 * Build the <delegation> XML block that serves as the initial message
 * for the target agent's conversation.
 */
export function buildDelegationBlock(params: {
  taskId: string;
  from: string;
  depth: number;
  maxDepth: number;
  description: string;
}): string {
  return `<delegation task_id="${params.taskId}" from="${params.from}" depth="${params.depth}" max_depth="${params.maxDepth}">
${params.description}
</delegation>`;
}

/**
 * Resolve the Linear issue ID correlated with the current conversation.
 * Used to create sub-issues under the parent when materializing.
 * Returns null on any error (non-fatal).
 */
export async function resolveParentLinearIssueId(
  deps: NonNullable<ToolContext["delegationDeps"]>,
  ctx: ToolContext,
): Promise<string | null> {
  try {
    const [corr] = await deps.db
      .select({ entity_id: workCorrelations.entity_id })
      .from(workCorrelations)
      .where(
        and(
          eq(workCorrelations.conversation_id, ctx.correlationId),
          eq(workCorrelations.entity_type, "linear_issue"),
        ),
      )
      .limit(1);

    return corr?.entity_id ?? null;
  } catch {
    return null; // Non-fatal
  }
}

/**
 * Create the task:delegate tool.
 *
 * Requires ctx.delegationDeps to be populated (by the worker loop when
 * the agent has task:delegate in its tools). Returns a descriptive error
 * if delegation dependencies are not available.
 */
export function createDelegateTaskTool(ctx: ToolContext): ToolDefinition {
  return {
    name: "delegate_task",
    description:
      "Delegate a task to another agent in the entity directory. Creates a task, " +
      "starts a conversation for the target agent with a <delegation> block, and returns " +
      "the task ID. After calling this, use wait_for with type 'task_handshake' and " +
      "timeout '30s' to await the target agent's accept/reject response.",
    inputSchema: DelegateTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = DelegateTaskInputSchema.safeParse(input);
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

      const { targetEntityId, description, parentTaskId } = parsed.data;

      try {
        // 1. Verify target entity exists and is active
        const entity = await deps.directoryService.get(targetEntityId);
        if (!entity) {
          return {
            content: `Target entity not found or inactive: ${targetEntityId}. Use directory:find to discover available agents.`,
            isError: true,
          };
        }

        // 2. Determine parent task ID
        const parentId = parentTaskId ?? ctx.taskId ?? null;

        // 3. Check delegation depth
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

        // 4. Create delegation task with depth tracking
        const task = await deps.taskService.create({
          parentId: parentId ?? undefined,
          creatorType: "agent",
          creatorId: ctx.agentId,
          assigneeType: entity.type,
          assigneeId: entity.id,
          title: description.slice(0, 100),
          objective: description,
          status: "created",
          depth: newDepth,
          metadata: { delegatedBy: ctx.agentId },
        });

        // 4b. Attempt materialization if requested
        let materializationWarning: string | undefined;
        let materializationUrl: string | undefined;
        if (
          parsed.data.materialization?.type === "transparent" &&
          deps.materializationAdapter
        ) {
          const parentIssueId = await resolveParentLinearIssueId(deps, ctx);

          const matResult = await deps.materializationAdapter.create({
            taskId: task.id,
            conversationId: ctx.correlationId,
            agentId: ctx.agentId,
            description,
            properties: parsed.data.materialization.properties ?? {},
            ...(parentIssueId ? { parentIssueId } : {}),
            correlationId: ctx.correlationId,
          });

          if (matResult) {
            materializationUrl = matResult.externalUrl;
            ctx.logger.info(
              {
                taskId: task.id,
                externalId: matResult.externalId,
                externalUrl: matResult.externalUrl,
              },
              "Task materialized as Linear issue",
            );
          } else {
            materializationWarning =
              "Warning: materialization failed. Task is running as internal.";
          }
        } else if (
          parsed.data.materialization?.type === "transparent" &&
          !deps.materializationAdapter
        ) {
          materializationWarning =
            "Warning: materialization requested but adapter not configured. Task is running as internal.";
        }

        // 5. Build delegation XML block
        const delegationBlock = buildDelegationBlock({
          taskId: task.id,
          from: ctx.agentId,
          depth: newDepth,
          maxDepth: MAX_DELEGATION_DEPTH,
          description,
        });

        // 6. Start target conversation
        const conversationId = await deps.executor.start({
          agentDefinitionId: entity.id,
          correlationKey: task.id,
          initialMessage: delegationBlock,
          taskId: task.id,
        });

        // 7. Write active_delegations entry on delegator's conversation row
        try {
          const delegationEntry = {
            taskId: task.id,
            targetEntityId: entity.id,
            description: description.slice(0, 200),
            delegatedAt: new Date().toISOString(),
            handshakeStatus: "pending",
          };

          const [conv] = await deps.db
            .select({
              active_delegations: conversations.active_delegations,
            })
            .from(conversations)
            .where(eq(conversations.id, ctx.correlationId))
            .limit(1);

          const currentDelegations = (conv?.active_delegations ??
            []) as unknown[];
          const updatedDelegations = [...currentDelegations, delegationEntry];

          await deps.db
            .update(conversations)
            .set({
              active_delegations: updatedDelegations,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, ctx.correlationId));
        } catch (delegationTrackingError) {
          // Non-fatal: failure to write delegation context should not fail the delegation itself
          ctx.logger.warn(
            { err: delegationTrackingError, taskId: task.id },
            "Failed to write active_delegations entry (non-fatal)",
          );
        }

        // 8. Return success with guidance
        const responseLines = [
          `Delegation created successfully.`,
          `Task ID: ${task.id}`,
          `Target: ${entity.name} (${entity.id})`,
          `Conversation: ${conversationId}`,
          `Depth: ${newDepth}/${MAX_DELEGATION_DEPTH}`,
        ];

        if (materializationUrl) {
          responseLines.push(
            `Materialized: Linear issue ${materializationUrl}`,
          );
        }
        if (materializationWarning) {
          responseLines.push(materializationWarning);
        }

        responseLines.push(
          ``,
          `Next: call wait_for with type "task_handshake" and timeout "30s" to await the target agent's accept/reject response.`,
        );

        return {
          content: responseLines.join("\n"),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to delegate task: ${message}`,
          isError: true,
        };
      }
    },
  };
}
