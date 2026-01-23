/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * Shared types for MCP tool implementations across all integrations.
 * Provides consistent context, results, and metadata structures.
 */

import type { Logger } from "pino";

/**
 * Context passed to MCP tool handlers
 * Provides dependencies and request context
 */
export interface MCPToolContext {
  /** Pino logger with correlation ID already bound */
  logger: Logger;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Agent ID from X-Agent-ID header (for permission checks) */
  agentId: string;
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
