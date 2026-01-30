/**
 * Trace Recorder
 *
 * Factory producing onToolCall/onResponse callbacks for runAgentLoop().
 * Automatically records every tool call, LLM response, agent spawn, and
 * agent completion to agents.execution_traces with buffered writes.
 *
 * Callbacks are synchronous (void return) to avoid blocking the agent loop.
 * All writes are buffered in memory and flushed via the explicit flush() call
 * at the end of an activity.
 *
 * Note: tool_result traces are NOT recorded in this version because Phase 28's
 * runAgentLoop() does not expose an onToolResult callback. The four trace types
 * recorded here (tool_call, llm_response, agent_spawn, agent_complete) provide
 * sufficient observability for v2.2.
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LLMResponse, ToolCallInfo } from "../agent-loop/types.js";
import type * as agentsSchemaModule from "./schema.js";
import { executionTraces, type NewExecutionTrace } from "./schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraceRecorderOptions {
  /** Database client for batch inserts */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger for diagnostics */
  logger: PinoLogger;
  /** External task ID (e.g., Linear issue UUID) */
  taskId: string;
  /** Temporal workflow ID */
  workflowId: string;
  /** Agent type (e.g., "dev-orchestrator", "researcher", "coder") */
  agentType: string;
  /** Unique ID for this agent invocation */
  agentInstanceId: string;
  /** Parent agent instance ID (null for root orchestrator) */
  parentAgentInstanceId?: string;
}

export interface TraceRecorderCallbacks {
  /** Pass to runAgentLoop() options.onToolCall */
  onToolCall: (call: ToolCallInfo) => void;
  /** Pass to runAgentLoop() options.onResponse */
  onResponse: (response: LLMResponse) => void;
  /** Record a sub-agent spawn event */
  onAgentSpawn: (
    childInstanceId: string,
    childType: string,
    brief: unknown,
  ) => void;
  /** Record agent completion */
  onAgentComplete: (result: unknown) => void;
  /** Flush all buffered trace steps to the database. Call at end of activity. */
  flush: () => Promise<void>;
  /** Get the current step count (for testing/debugging) */
  stepCount: () => number;
}

// ---------------------------------------------------------------------------
// Truncation Helper
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BYTES = 10240; // 10KB

/**
 * Truncate a payload to fit within maxBytes when serialized.
 *
 * - Strings: slice and append " [truncated]"
 * - Objects: JSON.stringify, check length, return preview object if too large
 * - Primitives (null, undefined, number, boolean): return as-is
 */
function truncateJsonPayload(
  value: unknown,
  maxBytes: number = DEFAULT_MAX_BYTES,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (value.length > maxBytes) {
      return `${value.slice(0, maxBytes)} [truncated]`;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  // Objects and arrays
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxBytes) {
      return {
        truncated: true,
        preview: serialized.slice(0, maxBytes),
      };
    }
    return value;
  } catch {
    return { truncated: true, preview: "[unserializable]" };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a trace recorder that produces callbacks for runAgentLoop().
 *
 * @example
 * ```ts
 * const recorder = createTraceRecorder({
 *   db, logger, taskId, workflowId,
 *   agentType: "dev-orchestrator",
 *   agentInstanceId: "inst_abc123",
 * });
 *
 * const result = await runAgentLoop({
 *   ...options,
 *   onToolCall: recorder.onToolCall,
 *   onResponse: recorder.onResponse,
 * });
 *
 * await recorder.flush();
 * ```
 */
export function createTraceRecorder(
  options: TraceRecorderOptions,
): TraceRecorderCallbacks {
  const {
    db,
    logger,
    taskId,
    workflowId,
    agentType,
    agentInstanceId,
    parentAgentInstanceId,
  } = options;

  // Validate required options
  if (!db) throw new Error("db is required for TraceRecorder");
  if (!logger) throw new Error("logger is required for TraceRecorder");
  if (!taskId) throw new Error("taskId is required for TraceRecorder");
  if (!workflowId) throw new Error("workflowId is required for TraceRecorder");
  if (!agentType) throw new Error("agentType is required for TraceRecorder");
  if (!agentInstanceId)
    throw new Error("agentInstanceId is required for TraceRecorder");

  // Internal state
  const buffer: NewExecutionTrace[] = [];
  let stepCounter = 0;

  /**
   * Build a base trace record with common fields.
   */
  function buildBaseRecord(): Pick<
    NewExecutionTrace,
    | "id"
    | "task_id"
    | "workflow_id"
    | "agent_type"
    | "agent_instance_id"
    | "parent_agent_instance_id"
    | "step_number"
  > {
    stepCounter++;
    return {
      id: createId.executionTrace(),
      task_id: taskId,
      workflow_id: workflowId,
      agent_type: agentType,
      agent_instance_id: agentInstanceId,
      parent_agent_instance_id: parentAgentInstanceId ?? null,
      step_number: stepCounter,
    };
  }

  return {
    onToolCall(call: ToolCallInfo): void {
      const base = buildBaseRecord();
      const record: NewExecutionTrace = {
        ...base,
        type: "tool_call",
        tool_name: call.name,
        input: truncateJsonPayload(call.input),
        output: null,
        token_count_input: null,
        token_count_output: null,
        duration_ms: null,
      };
      buffer.push(record);
    },

    onResponse(response: LLMResponse): void {
      const base = buildBaseRecord();

      // Extract text from content blocks
      const textParts: string[] = [];
      for (const block of response.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        }
      }
      const textOutput = textParts.join("\n");

      const record: NewExecutionTrace = {
        ...base,
        type: "llm_response",
        tool_name: null,
        input: null,
        output: truncateJsonPayload(textOutput),
        token_count_input: response.usage.input_tokens,
        token_count_output: response.usage.output_tokens,
        duration_ms: null,
      };
      buffer.push(record);
    },

    onAgentSpawn(
      _childInstanceId: string,
      childType: string,
      brief: unknown,
    ): void {
      const base = buildBaseRecord();
      const record: NewExecutionTrace = {
        ...base,
        type: "agent_spawn",
        tool_name: childType,
        input: truncateJsonPayload(brief),
        output: null,
        token_count_input: null,
        token_count_output: null,
        duration_ms: null,
      };
      buffer.push(record);
    },

    onAgentComplete(result: unknown): void {
      const base = buildBaseRecord();
      const record: NewExecutionTrace = {
        ...base,
        type: "agent_complete",
        tool_name: null,
        input: null,
        output: truncateJsonPayload(result),
        token_count_input: null,
        token_count_output: null,
        duration_ms: null,
      };
      buffer.push(record);
    },

    async flush(): Promise<void> {
      if (buffer.length === 0) {
        return;
      }

      const count = buffer.length;
      const toInsert = [...buffer];
      // Clear buffer regardless of success/failure
      buffer.length = 0;

      try {
        await db.insert(executionTraces).values(toInsert);
        logger.info(
          { stepCount: count, agentInstanceId, taskId },
          "Flushed trace steps to database",
        );
      } catch (error) {
        // Best-effort: log but do NOT re-throw.
        // The agent loop should not fail because of trace recording issues.
        logger.error(
          { err: error, stepCount: count, agentInstanceId, taskId },
          "Failed to flush trace steps to database",
        );
      }
    },

    stepCount(): number {
      return stepCounter;
    },
  };
}
