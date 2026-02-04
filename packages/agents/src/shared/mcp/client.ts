/**
 * MCP Client Wrapper
 *
 * Thin HTTP client layer for agent-to-integration communication.
 * Replaces direct SDK client imports with standardized HTTP calls to MCP servers.
 */

import { fetchBuilder } from "fetch-retry-ts";
import { McpError } from "./errors.js";
import type {
  McpCallOptions,
  McpErrorResponse,
  McpIntegration,
  McpSuccessResponse,
} from "./types.js";

/**
 * Wrapped fetch with retry logic
 */
const fetchWithRetry = fetchBuilder(fetch);

/**
 * Get MCP base URL for integration
 * Reads from process.env (works before and after config refactor in Plan 04)
 */
function getMcpUrl(integration: McpIntegration): string {
  switch (integration) {
    case "linear":
      return process.env.LINEAR_MCP_URL || "http://linear-integration:3001";
    case "github":
      return process.env.GITHUB_MCP_URL || "http://github-integration:3002";
    case "slack":
      return process.env.SLACK_MCP_URL || "http://slack-integration:3003";
  }
}

/**
 * Call an MCP tool via HTTP
 *
 * @param options - Tool call options (integration, tool, params, agent ID, correlation ID)
 * @returns Tool result data (unwrapped from response structure)
 * @throws McpError - On MCP server error (rate limit, auth, validation, etc.)
 * @throws Error - On network failure or unexpected response
 *
 * @example
 * ```typescript
 * const issue = await callMcpTool<{ title: string }>({
 *   integration: 'linear',
 *   tool: 'get_issue',
 *   params: { issueId: 'ABC-123' },
 *   agentId: 'dev-agent',
 *   correlationId: 'req_abc123',
 * });
 * ```
 */
export async function callMcpTool<T = unknown>(
  options: McpCallOptions,
): Promise<T> {
  const { integration, tool, params, agentId, correlationId } = options;

  // Build URL
  const baseUrl = getMcpUrl(integration);
  const url = `${baseUrl}/mcp/tools/${tool}`;

  // Make HTTP request with retry
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-ID": agentId,
      "X-Correlation-ID": correlationId,
    },
    body: JSON.stringify(params),
    // Retry configuration: exponential backoff (1s, 2s, 4s) up to 3 retries
    retries: 3,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 10000),
    retryOn: [429, 500, 502, 503, 504], // Retry on rate limit and server errors
  });

  // Parse response
  const responseData = (await response.json()) as
    | McpErrorResponse
    | McpSuccessResponse<T>;

  // Handle error responses (HTTP 4xx/5xx)
  if (!response.ok) {
    throw new McpError(responseData as McpErrorResponse);
  }

  // Handle application-level errors (HTTP 200 but isError: true in body).
  // MCP servers may return 200 with isError: true when the tool executed
  // but produced an error result (e.g., GitHub API "Not Found").
  if ("isError" in responseData && responseData.isError) {
    const body = responseData as unknown as Record<string, unknown>;
    const contentArr = body.content as Array<{ text?: string }> | undefined;
    const errorText =
      typeof body.error === "string"
        ? body.error
        : (contentArr?.[0]?.text ?? "Tool execution failed");
    throw new McpError({
      error: errorText,
      isError: true,
      meta: (body.meta as McpErrorResponse["meta"]) ?? {
        correlation_id: "",
      },
    });
  }

  // Extract data from success response
  const successResponse = responseData as McpSuccessResponse<T>;
  return (successResponse.data ||
    successResponse.structuredContent ||
    successResponse) as T;
}
