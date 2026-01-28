/**
 * Trace Entry Types for Workflow Observability
 *
 * Types for structured log entries stored in TraceStore.
 * Used for debugging workflow execution by indexing events by task ID.
 */

/**
 * Log levels ordered by severity
 */
export type TraceLevel = "debug" | "info" | "warn" | "error";

/**
 * Context information for trace correlation
 */
export interface TraceContext {
  /** Task identifier for indexing */
  taskId?: string;
  /** Workflow run identifier */
  workflowId?: string;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * Structured trace entry format.
 * Stored in TraceStore for workflow debugging.
 */
export interface TraceEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: TraceLevel;
  /** What happened (e.g., "chain_start", "tool_call", "llm_request") */
  action: string;
  /** Correlation and contextual information */
  context: TraceContext;
  /** Operation outcome */
  outcome?: "success" | "failure" | "pending";
  /** Human-readable description */
  message?: string;
  /** Duration for timed operations in milliseconds */
  durationMs?: number;
}
