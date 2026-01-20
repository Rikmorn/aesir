/**
 * LangGraph Callback Tracer
 *
 * Captures all LangGraph events (node transitions, LLM calls, tool calls)
 * for workflow debugging. Integrates with pino Logger and TraceStore.
 *
 * All handler methods are wrapped in try/catch to prevent tracing errors
 * from crashing the workflow.
 */

import type { LogEntry, PinoLogger, TraceStore } from "@aesir/common";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";

/**
 * LangGraphTracer captures LangGraph execution events for debugging.
 *
 * Extends BaseCallbackHandler to receive all LangGraph callbacks:
 * - Chain events (node transitions)
 * - LLM events (model calls)
 * - Tool events (tool invocations)
 *
 * Events are logged via pino Logger and appended to TraceStore for query.
 */
export class LangGraphTracer extends BaseCallbackHandler {
  name = "LangGraphTracer";

  private readonly logger: PinoLogger;
  private readonly store: TraceStore;

  constructor(logger: PinoLogger, store: TraceStore) {
    super();
    this.logger = logger;
    this.store = store;
  }

  /**
   * Helper to create and append a log entry to the store.
   */
  private appendToStore(
    level: LogEntry["level"],
    action: string,
    context: Record<string, unknown>,
    outcome?: LogEntry["outcome"],
    message?: string,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      action,
      context,
      ...(outcome !== undefined && { outcome }),
      ...(message !== undefined && { message }),
    };
    this.store.append(entry);
  }

  /**
   * Called when a chain (graph node) starts execution.
   */
  handleChainStart(
    chain: Serialized,
    _inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
  ): void {
    try {
      const chainType = chain.id?.[chain.id.length - 1] ?? "unknown";
      const context = {
        runId,
        chainType,
        ...(parentRunId !== undefined && { parentRunId }),
      };
      this.logger.info(context, "chain_start");
      this.appendToStore("info", "chain_start", context);
    } catch {
      // Silently ignore - tracing errors should never crash workflow
    }
  }

  /**
   * Called when a chain completes successfully.
   */
  handleChainEnd(_outputs: Record<string, unknown>, runId: string): void {
    try {
      const context = { runId };
      this.logger.info(context, "chain_end");
      this.appendToStore("info", "chain_end", context, "success");
    } catch {
      // Silently ignore - tracing errors should never crash workflow
    }
  }

  /**
   * Called when a chain throws an error.
   */
  handleChainError(error: Error, runId: string): void {
    try {
      const context = { runId, err: error.message };
      this.logger.error(context, "chain_error");
      this.appendToStore(
        "error",
        "chain_error",
        { runId },
        "failure",
        error.message,
      );
    } catch {
      // Silently ignore - tracing errors should never crash workflow
    }
  }

  /**
   * Called when an LLM starts processing.
   */
  handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
  ): void {
    try {
      const modelName = llm.id?.[llm.id.length - 1] ?? "unknown";
      const context = {
        runId,
        modelName,
        promptCount: prompts.length,
        ...(parentRunId !== undefined && { parentRunId }),
      };
      this.logger.debug(context, "llm_start");
      this.appendToStore("debug", "llm_start", context);
    } catch {
      // Silently ignore - tracing errors should never crash workflow
    }
  }

  /**
   * Called when an LLM completes.
   */
  handleLLMEnd(output: LLMResult, runId: string): void {
    try {
      const tokenUsage = output.llmOutput?.tokenUsage as
        | {
            totalTokens?: number;
            promptTokens?: number;
            completionTokens?: number;
          }
        | undefined;

      const context = {
        runId,
        ...(tokenUsage !== undefined && {
          totalTokens: tokenUsage.totalTokens,
          promptTokens: tokenUsage.promptTokens,
          completionTokens: tokenUsage.completionTokens,
        }),
      };
      this.logger.debug(context, "llm_end");
      this.appendToStore("debug", "llm_end", context);
    } catch {
      // Silently ignore - tracing errors should never crash workflow
    }
  }

  /**
   * Called when a tool starts execution.
   */
  handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
  ): void {
    try {
      const toolName = tool.id?.[tool.id.length - 1] ?? "unknown";
      const context = {
        runId,
        toolName,
        inputLength: input.length,
        ...(parentRunId !== undefined && { parentRunId }),
      };
      this.logger.info(context, "tool_start");
      this.appendToStore("info", "tool_start", context);
    } catch {
      // Silently ignore - tracing errors should never crash workflow
    }
  }

  /**
   * Called when a tool completes.
   */
  handleToolEnd(output: string, runId: string): void {
    try {
      const context = {
        runId,
        outputLength: output.length,
      };
      this.logger.info(context, "tool_end");
      this.appendToStore("info", "tool_end", context);
    } catch {
      // Silently ignore - tracing errors should never crash workflow
    }
  }
}

/**
 * Factory function to create a LangGraphTracer instance.
 *
 * @param logger - Pino Logger instance (use child logger with taskId for correlation)
 * @param store - TraceStore for indexing events
 * @returns Configured LangGraphTracer
 */
export function createLangGraphTracer(
  logger: PinoLogger,
  store: TraceStore,
): LangGraphTracer {
  return new LangGraphTracer(logger, store);
}
