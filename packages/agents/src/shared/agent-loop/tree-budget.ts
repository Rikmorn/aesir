/**
 * Tree Budget
 *
 * Tracks tree-level token budget for delegation trees.
 * Each conversation in a tree has a subtree allocation and tracks consumption
 * (own + all descendants). The local cache avoids per-iteration DB reads;
 * async propagation keeps ancestor counts current.
 *
 * The tree budget is orthogonal to the per-conversation TokenBudget:
 * - TokenBudget: in-memory counter for sub-agent spawning within one conversation
 * - TreeBudget: DB-persisted counter across delegation tree conversations
 *
 * effective_limit = min(definition.tokenBudget, subtreeRemaining) ensures
 * both ceilings are enforced independently.
 */

import type { PinoLogger } from "@aesir/platform";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../db/schema.js";
import { conversations } from "../db/schema.js";

/** Warning threshold: fires warning when 80% of tree budget is consumed */
export const TREE_BUDGET_WARNING_THRESHOLD = 0.8;

type AgentsDb = NodePgDatabase<typeof agentsSchemaModule>;

/**
 * Mutable tree budget state for a single conversation within a delegation tree.
 *
 * Tracks allocation, consumption (own + descendants), and warning delivery.
 * Local cache avoids per-iteration DB reads; async propagation keeps ancestor
 * counts current.
 */
export interface TreeBudgetState {
  /** Total allocation for this subtree (immutable once set) */
  readonly allocation: number;
  /** Consumed tokens (own + descendants), cached locally */
  consumed: number;
  /** Whether the 80% warning has been delivered for this conversation */
  warningDelivered: boolean;
  /** Compute remaining tokens */
  remaining(): number;
  /** Check if tree budget is exhausted (consumed >= allocation) */
  isExhausted(): boolean;
  /** Check if tree budget is in warning territory (>= 80% consumed) */
  isWarning(): boolean;
  /** Record token consumption: increments local cache and fires async DB propagation */
  recordConsumption(tokens: number): void;
  /** Refresh consumed from DB (call on resume after signal to pick up sibling consumption) */
  refreshFromDb(): Promise<void>;
}

/**
 * Atomic increment of subtree_consumed up the delegation chain.
 * Uses a recursive CTE to walk parent_conversation_id and increment
 * each ancestor's subtree_consumed by delta. Fire-and-forget pattern.
 */
export async function propagateConsumption(
  db: AgentsDb,
  conversationId: string,
  delta: number,
  logger: PinoLogger,
): Promise<void> {
  try {
    await db.execute(sql`
      WITH RECURSIVE ancestor_chain AS (
        SELECT id, parent_conversation_id
        FROM agents.conversations
        WHERE id = ${conversationId} AND subtree_allocation IS NOT NULL
        UNION ALL
        SELECT c.id, c.parent_conversation_id
        FROM agents.conversations c
        INNER JOIN ancestor_chain ac ON c.id = ac.parent_conversation_id
        WHERE c.subtree_allocation IS NOT NULL
      )
      UPDATE agents.conversations
      SET subtree_consumed = subtree_consumed + ${delta},
          updated_at = NOW()
      WHERE id IN (SELECT id FROM ancestor_chain)
    `);
  } catch (err) {
    // Non-fatal: consumption propagation failure means slightly stale parent counters
    // The next propagation will include the accumulated delta
    logger.warn(
      { err, conversationId, delta },
      "Tree budget propagation failed (non-fatal)",
    );
  }
}

/**
 * Create a mutable TreeBudgetState for a conversation.
 *
 * The factory captures the DB connection and conversation ID so that
 * recordConsumption() can fire-and-forget propagation writes and
 * refreshFromDb() can read the latest consumed value.
 */
export function createTreeBudgetState(
  allocation: number,
  currentConsumed: number,
  warningAlreadyDelivered: boolean,
  db: AgentsDb,
  conversationId: string,
  logger: PinoLogger,
): TreeBudgetState {
  return {
    allocation,
    consumed: currentConsumed,
    warningDelivered: warningAlreadyDelivered,

    remaining() {
      return Math.max(0, this.allocation - this.consumed);
    },

    isExhausted() {
      return this.consumed >= this.allocation;
    },

    isWarning() {
      return this.consumed >= this.allocation * TREE_BUDGET_WARNING_THRESHOLD;
    },

    recordConsumption(tokens: number) {
      this.consumed += tokens;
      // Fire-and-forget DB propagation -- async, non-blocking
      void propagateConsumption(db, conversationId, tokens, logger).catch(
        () => {
          // Already logged inside propagateConsumption
        },
      );
    },

    async refreshFromDb() {
      try {
        const [row] = await db
          .select({ subtree_consumed: conversations.subtree_consumed })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1);
        if (row) {
          this.consumed = row.subtree_consumed;
        }
      } catch (err) {
        logger.warn(
          { err, conversationId },
          "Tree budget refresh failed (using cached value)",
        );
      }
    },
  };
}
