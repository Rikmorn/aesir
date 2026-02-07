/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * Shared types for MCP tool implementations across all integrations.
 * Provides consistent context, results, and metadata structures.
 */

/**
 * Minimal logger interface for MCP tools
 * Compatible with pino but doesn't require pino as a dependency
 */
export interface MCPLogger {
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  child(bindings: object): MCPLogger;
}

/**
 * Context passed to MCP tool handlers
 * Provides dependencies and request context
 */
export interface MCPToolContext {
  /** Logger with correlation ID already bound */
  logger: MCPLogger;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Agent ID from X-Agent-ID header (for permission checks) */
  agentId: string;
  /** Task ID from X-Task-ID header (v2.5 task correlation) */
  taskId?: string;
  /** Request start time for duration calculation */
  startTime: number;
}

/**
 * Metadata included in tool responses
 */
export interface MCPToolMeta {
  /** Execution duration in milliseconds */
  duration_ms: number;
  /** Correlation ID for tracing */
  correlation_id: string;
  /** Remaining rate limit (optional) */
  rate_limit_remaining?: number;
}

/**
 * Standard MCP tool result structure
 * Matches MCP specification content format
 */
export interface MCPToolResult<T = unknown> {
  content: Array<{ type: "text"; text: string }>;
  /** Structured content for programmatic access */
  structuredContent?: T;
  /** Metadata for observability */
  meta: MCPToolMeta;
  /** True if tool execution failed (recoverable error) */
  isError?: boolean;
}

/**
 * Permission check function signature
 */
export type PermissionChecker = (options: {
  agentId: string;
  toolName: string;
}) => Promise<boolean>;
