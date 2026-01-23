/**
 * MCP (Model Context Protocol) Module
 *
 * Shared utilities for building MCP tools across all integrations.
 * Provides consistent result structures and helper functions.
 */

export * from "./schemas.js";
export * from "./types.js";

import type { MCPToolContext, MCPToolMeta, MCPToolResult } from "./types.js";

/**
 * Create a successful MCP tool result
 *
 * @example
 * const result = createToolResult(
 *   context,
 *   "Issue ABC-123 created successfully",
 *   { issueId: "abc123", url: "https://..." }
 * );
 */
export function createToolResult<T>(
  context: MCPToolContext,
  text: string,
  structuredContent?: T,
): MCPToolResult<T> {
  const meta: MCPToolMeta = {
    duration_ms: Date.now() - context.startTime,
    correlation_id: context.correlationId,
  };

  const result: MCPToolResult<T> = {
    content: [{ type: "text", text }],
    meta,
  };

  if (structuredContent !== undefined) {
    result.structuredContent = structuredContent;
  }

  return result;
}

/**
 * Create an error MCP tool result
 * Uses isError: true so LLM can see and handle the error
 *
 * @example
 * const errorResult = createErrorResult(
 *   context,
 *   "Permission denied: create_issue not allowed"
 * );
 */
export function createErrorResult(
  context: MCPToolContext,
  message: string,
): MCPToolResult<never> {
  return {
    content: [{ type: "text", text: message }],
    meta: {
      duration_ms: Date.now() - context.startTime,
      correlation_id: context.correlationId,
    },
    isError: true,
  };
}
