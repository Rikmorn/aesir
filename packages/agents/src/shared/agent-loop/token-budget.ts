/**
 * Token Budget
 *
 * Mutable token budget counter shared across orchestrator and sub-agents.
 * Passed by reference so mutations from any agent loop iteration are visible
 * to the orchestrator and subsequent sub-agents.
 *
 * Usage:
 *   const budget = createTokenBudget(500_000);
 *   await runAgentLoop({ ..., tokenBudget: budget });
 *   // budget.remaining now reflects tokens consumed
 *   await runAgentLoop({ ..., tokenBudget: budget }); // same budget, continues deducting
 */

/**
 * Mutable token budget counter.
 *
 * The orchestrator creates one budget and passes it to all sub-agents.
 * Each loop iteration deducts input + output tokens from the remaining budget.
 * When exhausted, the loop stops with status "max_tokens".
 */
export interface TokenBudget {
  /** Total token budget for the task */
  readonly total: number;
  /** Remaining tokens (mutated by deduct calls) */
  remaining: number;
  /** Check if the budget is exhausted (remaining <= 0) */
  isExhausted(): boolean;
  /** Deduct tokens used by an LLM call */
  deduct(input: number, output: number): void;
}

/**
 * Create a mutable token budget counter.
 *
 * @param total - Total token budget for the task
 * @returns A mutable TokenBudget object
 */
export function createTokenBudget(total: number): TokenBudget {
  return {
    total,
    remaining: total,
    isExhausted() {
      return this.remaining <= 0;
    },
    deduct(input: number, output: number) {
      this.remaining -= input + output;
    },
  };
}
