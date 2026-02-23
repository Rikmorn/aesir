/**
 * task:tree_budget Tool Factory
 *
 * Returns the current tree budget state for the agent's subtree.
 * Scoped to own subtree only -- no sibling or parent visibility.
 * Root conversations naturally see the full tree since their subtree IS the tree.
 *
 * Returns:
 * - allocated: total tokens allocated to this subtree
 * - consumed: tokens used (own + all descendants)
 * - remaining: tokens available
 * - percentUsed: consumption percentage
 * - descendants: { active, completed, totalConsumed }
 */

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { conversations } from "../../db/schema.js";

const TreeBudgetInputSchema = z
  .object({})
  .describe(
    "No input required -- returns budget state for the current conversation's subtree",
  );

export function createTreeBudgetTool(ctx: ToolContext): ToolDefinition {
  const deps = ctx.delegationDeps;
  if (!deps) {
    // Defensive: return a tool that reports unavailability
    return {
      name: "tree_budget",
      description:
        "Check tree budget status for the current delegation subtree.",
      inputSchema: TreeBudgetInputSchema,
      async execute(): Promise<ToolResult> {
        return {
          content:
            "Tree budget tool unavailable: delegation context not initialized.",
          isError: true,
        };
      },
    };
  }

  return {
    name: "tree_budget",
    description:
      "Check tree budget status for the current delegation subtree. " +
      "Returns allocated tokens, consumed tokens, remaining tokens, " +
      "usage percentage, and descendant breakdown (active/completed counts).",
    inputSchema: TreeBudgetInputSchema,
    async execute(): Promise<ToolResult> {
      // Read own budget state
      const [conv] = await deps.db
        .select({
          subtree_allocation: conversations.subtree_allocation,
          subtree_consumed: conversations.subtree_consumed,
        })
        .from(conversations)
        .where(eq(conversations.id, ctx.correlationId))
        .limit(1);

      if (!conv?.subtree_allocation) {
        return {
          content:
            "No tree budget is active for this conversation. Token usage is governed by per-conversation limits only.",
        };
      }

      // Query direct children for descendant breakdown
      // Each child's subtree_consumed already includes its own descendants
      const childStats = await deps.db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('running', 'queued', 'waiting')) AS active,
          COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'cancelled')) AS completed,
          COALESCE(SUM(subtree_consumed), 0) AS total_consumed
        FROM agents.conversations
        WHERE parent_conversation_id = ${ctx.correlationId}
          AND subtree_allocation IS NOT NULL
      `);

      const stats = (childStats.rows[0] as {
        active: string | number;
        completed: string | number;
        total_consumed: string | number;
      }) ?? { active: 0, completed: 0, total_consumed: 0 };
      const allocated = conv.subtree_allocation;
      const consumed = conv.subtree_consumed;
      const remaining = Math.max(0, allocated - consumed);
      const percentUsed =
        allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;

      const result = {
        allocated,
        consumed,
        remaining,
        percentUsed,
        descendants: {
          active: Number(stats.active),
          completed: Number(stats.completed),
          totalConsumed: Number(stats.total_consumed),
        },
      };

      return {
        content: JSON.stringify(result, null, 2),
      };
    },
  };
}
