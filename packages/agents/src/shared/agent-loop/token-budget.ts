/**
 * Token Budget
 *
 * Mutable token budget counter shared across orchestrator and sub-agents.
 * Passed by reference so mutations from any agent loop iteration are visible
 * to the orchestrator and subsequent sub-agents.
 *
 * Features:
 * - isExhausted(): Hard stop -- zero tokens left, no further LLM calls
 * - isWarning(): 20% remaining threshold -- fires one-time warning callback
 * - isReserveOnly(): 5K reserve buffer -- triggers graceful wrap-up (one final LLM call)
 * - warningFired: Mutable flag to ensure warning callback fires exactly once
 *
 * Usage:
 *   const budget = createTokenBudget(500_000);
 *   await runAgentLoop({ ..., tokenBudget: budget });
 *   // budget.remaining now reflects tokens consumed
 *   await runAgentLoop({ ..., tokenBudget: budget }); // same budget, continues deducting
 */

/** Warning threshold: fires warning when remaining drops to 20% of total */
export const WARNING_THRESHOLD_RATIO = 0.2;

/** Reserve buffer: 5K tokens reserved for a graceful wrap-up summarization call */
export const RESERVE_BUFFER = 5_000;

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
  /** Check if budget is below warning threshold (remaining <= 20% of total) */
  isWarning(): boolean;
  /** Check if only the reserve buffer remains (remaining <= 5000 tokens) */
  isReserveOnly(): boolean;
  /** Deduct tokens used by an LLM call */
  deduct(input: number, output: number): void;
  /** Flag set to true after the warning callback has fired (prevents repeated warnings) */
  warningFired: boolean;
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
    warningFired: false,
    isExhausted() {
      return this.remaining <= 0;
    },
    isWarning() {
      return this.remaining <= this.total * WARNING_THRESHOLD_RATIO;
    },
    isReserveOnly() {
      return this.remaining <= RESERVE_BUFFER;
    },
    deduct(input: number, output: number) {
      this.remaining -= input + output;
    },
  };
}
