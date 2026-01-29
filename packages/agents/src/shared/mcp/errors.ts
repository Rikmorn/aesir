/**
 * MCP Client Error Handling
 *
 * Structured error class for MCP tool failures.
 * Provides LLM-friendly error formatting.
 */

import type { McpErrorResponse } from "./types.js";

/**
 * Error thrown when MCP tool call fails
 * Contains structured error data for LLM consumption
 */
export class McpError extends Error {
  constructor(public readonly errorData: McpErrorResponse) {
    super(errorData.error);
    this.name = "McpError";
  }

  /**
   * Error type extracted from error message
   * Common types: rate_limit, auth, not_found, validation, server
   */
  get type(): string {
    // Parse error message for type prefix (e.g., "rate_limit: Too many requests")
    const match = this.errorData.error.match(/^(\w+):/);
    return match?.[1] ?? "unknown";
  }

  /**
   * Error code (HTTP status or custom code)
   * Extracted from error message if present
   */
  get code(): string | undefined {
    // Parse error message for code (e.g., "validation: [400] Invalid input")
    const match = this.errorData.error.match(/\[(\w+)\]/);
    return match ? match[1] : undefined;
  }

  /**
   * Correlation ID for tracing
   */
  get correlationId(): string {
    return this.errorData.meta.correlation_id;
  }

  /**
   * Retry-After header value for rate limit errors
   * Extracted from error message if present
   */
  get retryAfter(): number | undefined {
    // Parse error message for retry-after (e.g., "rate_limit: retry after 60s")
    const match = this.errorData.error.match(/retry after (\d+)s/i);
    return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
  }

  /**
   * Convert error to structured tool result for LLM consumption
   * Returns standardized format that LLMs can interpret
   */
  toToolResult() {
    return {
      content: [
        {
          type: "text" as const,
          text: this.errorData.error,
        },
      ],
      meta: this.errorData.meta,
      isError: true as const,
    };
  }
}
