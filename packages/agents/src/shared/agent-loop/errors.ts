/**
 * Agent Loop Errors
 *
 * Structured error classes for all agent loop termination conditions.
 * Each error carries the corresponding AgentLoopStatus for consistent
 * error handling and result construction.
 */

import type { AgentLoopStatus } from "./types.js";

/**
 * Base error class for all agent loop failures.
 *
 * Carries the loop status that caused the error, enabling callers to
 * construct an AgentLoopResult with the correct status without parsing
 * error messages.
 */
export class AgentLoopError extends Error {
  public readonly status: AgentLoopStatus;

  constructor(
    message: string,
    status: AgentLoopStatus,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = "AgentLoopError";
    this.status = status;
  }
}

/**
 * Thrown when the agent loop hits the maximum iteration limit.
 *
 * This is a safety guardrail, not a bug. The agent may need more iterations
 * to complete the task, or the task may be too complex for the configured limit.
 */
export class MaxIterationsError extends AgentLoopError {
  constructor(public readonly iterations: number) {
    super(
      `Agent loop hit maximum iterations limit (${iterations})`,
      "max_iterations",
    );
    this.name = "MaxIterationsError";
  }
}

/**
 * Thrown when the shared token budget is exhausted.
 *
 * This means the orchestrator's total token allocation has been consumed
 * across all sub-agent calls. The agent should return its best partial
 * result rather than continuing.
 */
export class TokenBudgetExhaustedError extends AgentLoopError {
  constructor(
    public readonly total: number,
    public readonly used: number,
  ) {
    super(
      `Token budget exhausted: used ${used} of ${total} tokens`,
      "max_tokens",
    );
    this.name = "TokenBudgetExhaustedError";
  }
}

/**
 * Thrown when the agent loop is cancelled via AbortSignal.
 *
 * This is a clean cancellation -- the agent should return whatever
 * partial result it has accumulated.
 */
export class AgentAbortedError extends AgentLoopError {
  constructor() {
    super("Agent loop aborted via AbortSignal", "aborted");
    this.name = "AgentAbortedError";
  }
}
