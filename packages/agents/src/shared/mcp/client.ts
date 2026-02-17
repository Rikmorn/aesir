/**
 * MCP Client Wrapper
 *
 * Thin HTTP client layer for agent-to-integration communication.
 * Custom retry loop with error classification:
 * - Permanent errors (4xx except 429): returned immediately with structured context
 * - Transient errors (429, 5xx): retried with exponential backoff + full jitter
 * - Network errors: retried as transient
 *
 * Observability events emitted via optional onMcpEvent callback (decoupled from EventLog).
 */

import { McpError } from "./errors.js";
import type {
  McpCallOptions,
  McpErrorResponse,
  McpIntegration,
  McpSuccessResponse,
} from "./types.js";

/** Maximum number of attempts (initial + retries) */
const MAX_ATTEMPTS = 3;

/** Maximum delay cap per attempt in milliseconds */
const MAX_DELAY_MS = 10_000;

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff and full jitter.
 *
 * Base delays: 1s, 2s, 4s (1000 * 2^(attempt-1), 1-based attempt).
 * Full jitter: random value in [0, min(baseDelay, MAX_DELAY_MS)).
 *
 * For 429 with Retry-After header:
 * - Respects the header value up to MAX_DELAY_MS cap
 * - Returns -1 if Retry-After > MAX_DELAY_MS (signal: don't retry)
 *
 * @param attempt - Current attempt number (1-based)
 * @param retryAfterHeader - Optional Retry-After header value from 429 response
 * @returns Delay in ms, or -1 if Retry-After exceeds cap
 */
export function calculateDelay(
  attempt: number,
  retryAfterHeader?: string | null,
): number {
  // Handle Retry-After header for 429 responses
  if (retryAfterHeader) {
    const retryAfterMs = Number.parseFloat(retryAfterHeader) * 1000;
    if (!Number.isNaN(retryAfterMs) && retryAfterMs > 0) {
      if (retryAfterMs > MAX_DELAY_MS) {
        return -1; // Signal: don't retry, server wants us to wait too long
      }
      return retryAfterMs;
    }
  }

  // Exponential backoff: 1000 * 2^(attempt-1) -> 1s, 2s, 4s
  const baseDelay = 1000 * 2 ** (attempt - 1);
  const cappedDelay = Math.min(baseDelay, MAX_DELAY_MS);

  // Full jitter: uniform random in [0, cappedDelay)
  return Math.floor(Math.random() * cappedDelay);
}

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
 * Call an MCP tool via HTTP with error classification and retry logic.
 *
 * Retry behavior:
 * - Permanent errors (4xx except 429): throw immediately, no retry
 * - Rate limits (429): retry with Retry-After header respect (up to 10s cap)
 * - Server errors (5xx): retry with exponential backoff + full jitter
 * - Network errors: retry as transient
 * - retryable: false skips all retry logic
 *
 * Observability: emits mcp.error, mcp.rate_limited, mcp.retries_exhausted
 * events via optional onMcpEvent callback.
 *
 * @param options - Tool call options (integration, tool, params, agent ID, correlation ID)
 * @returns Tool result data (unwrapped from response structure)
 * @throws McpError - On MCP server error with classification and retry metadata
 * @throws Error - On unexpected response parsing failure
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
  const {
    integration,
    tool,
    params,
    agentId,
    correlationId,
    taskId,
    onMcpEvent,
    toolCallId,
    retryable = true,
  } = options;

  // Build URL
  const baseUrl = getMcpUrl(integration);
  const url = `${baseUrl}/mcp/tools/${tool}`;

  // Request init (reused across attempts)
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-ID": agentId,
      "X-Correlation-ID": correlationId,
      ...(taskId && { "X-Task-ID": taskId }),
    },
    body: JSON.stringify(params),
  };

  let totalRetryMs = 0;
  const maxAttempts = retryable ? MAX_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;

    // ── Fetch with network error handling ──────────────────────────────
    try {
      response = await fetch(url, init);
    } catch (err) {
      // Network error (DNS failure, connection refused, timeout, etc.)
      if (attempt < maxAttempts) {
        const delay = calculateDelay(attempt);
        totalRetryMs += delay;
        await sleep(delay);
        continue;
      }

      // Exhausted retries on network error
      const networkMessage = `Network error: ${err instanceof Error ? err.message : String(err)}`;
      onMcpEvent?.({
        type: "mcp.retries_exhausted",
        payload: {
          tool,
          integration,
          toolCallId,
          attempts: attempt,
          totalRetryMs,
          finalError: networkMessage,
        },
      });
      throw new McpError(
        {
          error: networkMessage,
          isError: true,
          meta: { correlation_id: correlationId },
        },
        {
          classification: "network",
          retryAttempts: attempt,
          totalRetryMs,
        },
      );
    }

    // ── Permanent error (4xx except 429): throw immediately ───────────
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429
    ) {
      let errorData: McpErrorResponse;
      try {
        errorData = (await response.json()) as McpErrorResponse;
      } catch {
        errorData = {
          error: `HTTP ${response.status}: ${response.statusText}`,
          isError: true,
          meta: { correlation_id: correlationId },
        };
      }

      onMcpEvent?.({
        type: "mcp.error",
        payload: {
          tool,
          integration,
          toolCallId,
          status: response.status,
          message: errorData.error,
        },
      });

      throw new McpError(errorData, {
        httpStatus: response.status,
        classification: "permanent",
        retryAttempts: attempt,
        totalRetryMs,
      });
    }

    // ── Rate limit (429): retry with Retry-After respect ──────────────
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const delay = calculateDelay(attempt, retryAfterHeader);

      onMcpEvent?.({
        type: "mcp.rate_limited",
        payload: {
          tool,
          integration,
          toolCallId,
          attempt,
          retryAfterMs: delay > 0 ? delay : undefined,
        },
      });

      // Don't retry if: not retryable, Retry-After too long (-1), or last attempt
      if (!retryable || delay === -1 || attempt >= maxAttempts) {
        let errorData: McpErrorResponse;
        try {
          errorData = (await response.json()) as McpErrorResponse;
        } catch {
          errorData = {
            error:
              delay === -1
                ? `Rate limited: Retry-After exceeds ${MAX_DELAY_MS / 1000}s cap`
                : "Rate limited: retries exhausted",
            isError: true,
            meta: { correlation_id: correlationId },
          };
        }

        if (attempt >= maxAttempts) {
          onMcpEvent?.({
            type: "mcp.retries_exhausted",
            payload: {
              tool,
              integration,
              toolCallId,
              attempts: attempt,
              totalRetryMs,
              finalStatus: 429,
            },
          });
        }

        throw new McpError(errorData, {
          httpStatus: 429,
          classification: "transient_exhausted",
          retryAttempts: attempt,
          totalRetryMs,
        });
      }

      totalRetryMs += delay;
      await sleep(delay);
      continue;
    }

    // ── Server error (5xx): retry with backoff ────────────────────────
    if (response.status >= 500) {
      if (attempt < maxAttempts) {
        const delay = calculateDelay(attempt);
        totalRetryMs += delay;
        await sleep(delay);
        continue;
      }

      // Exhausted retries on server error
      let errorData: McpErrorResponse;
      try {
        errorData = (await response.json()) as McpErrorResponse;
      } catch {
        errorData = {
          error: `Server error: HTTP ${response.status}`,
          isError: true,
          meta: { correlation_id: correlationId },
        };
      }

      onMcpEvent?.({
        type: "mcp.retries_exhausted",
        payload: {
          tool,
          integration,
          toolCallId,
          attempts: attempt,
          totalRetryMs,
          finalStatus: response.status,
        },
      });

      throw new McpError(errorData, {
        httpStatus: response.status,
        classification: "transient_exhausted",
        retryAttempts: attempt,
        totalRetryMs,
      });
    }

    // ── Success: parse response ───────────────────────────────────────
    const responseData = (await response.json()) as
      | McpErrorResponse
      | McpSuccessResponse<T>;

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
      throw new McpError(
        {
          error: errorText,
          isError: true,
          meta: (body.meta as McpErrorResponse["meta"]) ?? {
            correlation_id: "",
          },
        },
        {
          httpStatus: response.status,
          classification: "permanent",
          retryAttempts: attempt,
          totalRetryMs,
        },
      );
    }

    // Extract data from success response
    const successResponse = responseData as McpSuccessResponse<T>;
    return (successResponse.data ||
      successResponse.structuredContent ||
      successResponse) as T;
  }

  // TypeScript: unreachable (loop always returns or throws), but satisfy compiler
  throw new McpError(
    {
      error: "Unexpected: retry loop exited without result",
      isError: true,
      meta: { correlation_id: correlationId },
    },
    {
      classification: "network",
      retryAttempts: maxAttempts,
      totalRetryMs,
    },
  );
}
