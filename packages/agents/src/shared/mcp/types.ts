/**
 * MCP Client Type Definitions
 *
 * CLIENT-SIDE types for consuming MCP HTTP responses.
 * These are intentionally separate from @aesir/types/mcp SERVER-SIDE types:
 * - @aesir/types/mcp: MCPToolContext, MCPToolResult (for building MCP handlers)
 * - @aesir/agents/mcp: McpCallOptions, McpErrorResponse (for consuming MCP HTTP)
 *
 * Why separate: Servers produce MCPToolResult, clients consume the wire format.
 */

/**
 * Supported integration types
 */
export type McpIntegration = "linear" | "github" | "slack";

/**
 * Options for calling an MCP tool
 */
export interface McpCallOptions {
  /** Integration to call (determines base URL) */
  integration: McpIntegration;
  /** Tool name to invoke */
  tool: string;
  /** Tool parameters (validated by server) */
  params: Record<string, unknown>;
  /** Agent identifier for permission checks */
  agentId: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
}

/**
 * Error response from MCP server
 * Matches the wire format from MCP error handlers
 */
export interface McpErrorResponse {
  /** Error message */
  error: string;
  /** Always true for error responses */
  isError: true;
  /** Metadata for observability */
  meta: {
    /** Correlation ID for tracing */
    correlation_id: string;
    /** Execution duration in milliseconds */
    duration_ms?: number;
  };
}

/**
 * Success response from MCP server
 * Generic type T represents the structured content
 */
export interface McpSuccessResponse<T = unknown> {
  /** Human-readable content */
  content?: Array<{ type: "text"; text: string }>;
  /** Structured data for programmatic access */
  data?: T;
  /** Alternative structured content field */
  structuredContent?: T;
  /** Metadata for observability */
  meta: {
    /** Correlation ID for tracing */
    correlation_id: string;
    /** Execution duration in milliseconds */
    duration_ms: number;
    /** Remaining rate limit (if applicable) */
    rate_limit_remaining?: number;
  };
  /** False or undefined for success responses */
  isError?: false;
}
