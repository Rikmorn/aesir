/**
 * Tests for MCP Client
 *
 * Verifies error classification, retry behavior, and observability events.
 * Uses vi.stubGlobal to mock fetch and speeds up retries by mocking calculateDelay.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpError } from "./errors.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Speed up retry delays by overriding the sleep timer
// We use vi.useFakeTimers to make setTimeout resolve instantly
const baseOptions = {
  integration: "linear" as const,
  tool: "get_issue",
  params: { issueId: "ABC-123" },
  agentId: "dev-agent",
  correlationId: "corr-123",
};

describe("calculateDelay", () => {
  // Import the real calculateDelay (not affected by fetch mock)
  let calculateDelay: (
    attempt: number,
    retryAfterHeader?: string | null,
  ) => number;

  beforeEach(async () => {
    const mod = await import("./client.js");
    calculateDelay = mod.calculateDelay;
  });

  it("should return values within [0, base delay) for each attempt", () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateDelay(1);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(1000);
    }
  });

  it("should increase base delay exponentially", () => {
    const maxSamples = (attempt: number) => {
      let max = 0;
      for (let i = 0; i < 100; i++) {
        max = Math.max(max, calculateDelay(attempt));
      }
      return max;
    };
    expect(maxSamples(2)).toBeGreaterThan(500);
    expect(maxSamples(3)).toBeGreaterThan(1000);
  });

  it("should cap at MAX_DELAY_MS (10s)", () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateDelay(10);
      expect(delay).toBeLessThan(10000);
    }
  });

  it("should respect Retry-After header up to 10s cap", () => {
    const delay = calculateDelay(1, "5");
    expect(delay).toBe(5000);
  });

  it("should return -1 when Retry-After exceeds 10s cap", () => {
    const delay = calculateDelay(1, "30");
    expect(delay).toBe(-1);
  });

  it("should ignore invalid Retry-After header and use backoff", () => {
    const delay = calculateDelay(1, "invalid");
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(1000);
  });
});

describe("callMcpTool", () => {
  let callMcpTool: <T = unknown>(
    options: Parameters<typeof import("./client.js").callMcpTool>[0],
  ) => Promise<T>;

  beforeEach(async () => {
    mockFetch.mockClear();
    // Use fake timers so sleep() resolves near-instantly
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import("./client.js");
    callMcpTool = mod.callMcpTool as typeof callMcpTool;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Success cases ─────────────────────────────────────────────────────

  it("should make POST request to correct URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "123" } }),
    });

    await callMcpTool(baseOptions);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/mcp/tools/get_issue"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Agent-ID": "dev-agent",
          "X-Correlation-ID": "corr-123",
        }),
      }),
    );
  });

  it("should return data from successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { title: "Test Issue" } }),
    });

    const result = await callMcpTool<{ title: string }>(baseOptions);
    expect(result).toEqual({ title: "Test Issue" });
  });

  it("should handle structuredContent response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ structuredContent: { value: "structured data" } }),
    });

    const result = await callMcpTool(baseOptions);
    expect(result).toEqual({ value: "structured data" });
  });

  it("should handle response without data field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "success" }],
      }),
    });

    const result = await callMcpTool(baseOptions);
    expect(result).toEqual({
      content: [{ type: "text", text: "success" }],
    });
  });

  it("should include params in request body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });

    const params = { issueId: "ABC-123", statusName: "In Progress" };
    await callMcpTool({ ...baseOptions, params });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify(params),
      }),
    );
  });

  it("should use correct URL for each integration", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });

    await callMcpTool({ ...baseOptions, integration: "github" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("github"),
      expect.any(Object),
    );

    mockFetch.mockClear();
    await callMcpTool({ ...baseOptions, integration: "slack" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("slack"),
      expect.any(Object),
    );
  });

  it("should include X-Task-ID header when taskId provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });

    await callMcpTool({ ...baseOptions, taskId: "task-123" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Task-ID": "task-123",
        }),
      }),
    );
  });

  // ── Permanent errors (4xx except 429) ─────────────────────────────────

  it("should throw immediately on 404 with classification 'permanent'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: "Issue not found",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    try {
      await callMcpTool(baseOptions);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.httpStatus).toBe(404);
      expect(mcpErr.classification).toBe("permanent");
      expect(mcpErr.message).toBe("Issue not found");
      expect(mcpErr.retryAttempts).toBe(1);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should throw immediately on 400 without retrying", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Validation error: missing field",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    await expect(callMcpTool(baseOptions)).rejects.toThrow(McpError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should emit mcp.error event on permanent error", async () => {
    const onMcpEvent = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: "Not found",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    await expect(callMcpTool({ ...baseOptions, onMcpEvent })).rejects.toThrow();

    expect(onMcpEvent).toHaveBeenCalledWith({
      type: "mcp.error",
      payload: {
        tool: "get_issue",
        integration: "linear",
        status: 404,
        message: "Not found",
      },
    });
  });

  // ── Application-level errors (200 + isError) ─────────────────────────

  it("should throw McpError on HTTP 200 with isError: true (content array)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "Failed to create branch: Not Found" }],
        meta: { correlation_id: "corr-123", duration_ms: 200 },
        isError: true,
      }),
    });

    try {
      await callMcpTool({
        ...baseOptions,
        integration: "github",
        tool: "create_branch",
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).message).toBe(
        "Failed to create branch: Not Found",
      );
      expect((err as McpError).classification).toBe("permanent");
    }
  });

  it("should throw McpError on HTTP 200 with isError: true (error field)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        error: "Permission denied",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    await expect(callMcpTool(baseOptions)).rejects.toThrow("Permission denied");
  });

  // ── Transient errors (5xx) ────────────────────────────────────────────

  it("should retry 500 errors 3 times then throw with classification 'transient_exhausted'", async () => {
    const makeError = () => ({
      ok: false,
      status: 500,
      json: async () => ({
        error: "Internal server error",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    mockFetch
      .mockResolvedValueOnce(makeError())
      .mockResolvedValueOnce(makeError())
      .mockResolvedValueOnce(makeError());

    try {
      await callMcpTool(baseOptions);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.httpStatus).toBe(500);
      expect(mcpErr.classification).toBe("transient_exhausted");
      expect(mcpErr.retryAttempts).toBe(3);
    }

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should succeed after transient 503 on retry", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          error: "Service unavailable",
          isError: true,
          meta: { correlation_id: "corr-123" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { title: "Recovered" } }),
      });

    const result = await callMcpTool<{ title: string }>(baseOptions);
    expect(result).toEqual({ title: "Recovered" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should emit mcp.retries_exhausted on 5xx after all attempts", async () => {
    const onMcpEvent = vi.fn();
    const makeError = () => ({
      ok: false,
      status: 502,
      json: async () => ({
        error: "Bad gateway",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    mockFetch
      .mockResolvedValueOnce(makeError())
      .mockResolvedValueOnce(makeError())
      .mockResolvedValueOnce(makeError());

    await expect(callMcpTool({ ...baseOptions, onMcpEvent })).rejects.toThrow();

    expect(onMcpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mcp.retries_exhausted",
        payload: expect.objectContaining({
          tool: "get_issue",
          integration: "linear",
          attempts: 3,
          finalStatus: 502,
        }),
      }),
    );
  });

  // ── Rate limit (429) ──────────────────────────────────────────────────

  it("should retry 429 with Retry-After: 5 and respect the header", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "5" }),
        json: async () => ({
          error: "Rate limited",
          isError: true,
          meta: { correlation_id: "corr-123" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { title: "After rate limit" } }),
      });

    const onMcpEvent = vi.fn();
    const result = await callMcpTool<{ title: string }>({
      ...baseOptions,
      onMcpEvent,
    });

    expect(result).toEqual({ title: "After rate limit" });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    expect(onMcpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mcp.rate_limited",
        payload: expect.objectContaining({
          tool: "get_issue",
          integration: "linear",
          attempt: 1,
          retryAfterMs: 5000,
        }),
      }),
    );
  }, 15000);

  it("should throw immediately on 429 with Retry-After: 30 (exceeds cap)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "30" }),
      json: async () => ({
        error: "Rate limited: Retry-After exceeds 10s cap",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    try {
      await callMcpTool(baseOptions);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.httpStatus).toBe(429);
      expect(mcpErr.classification).toBe("transient_exhausted");
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should emit mcp.rate_limited event on 429", async () => {
    const onMcpEvent = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "30" }),
      json: async () => ({
        error: "Rate limited",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    await expect(callMcpTool({ ...baseOptions, onMcpEvent })).rejects.toThrow();

    expect(onMcpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mcp.rate_limited",
      }),
    );
  });

  // ── Network errors ────────────────────────────────────────────────────

  it("should retry network errors then throw with classification 'network'", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    try {
      await callMcpTool(baseOptions);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.classification).toBe("network");
      expect(mcpErr.retryAttempts).toBe(3);
      expect(mcpErr.message).toContain("Network error");
      expect(mcpErr.message).toContain("Failed to fetch");
    }

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should succeed after network error on retry", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Connection refused"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { title: "Recovered" } }),
      });

    const result = await callMcpTool<{ title: string }>(baseOptions);
    expect(result).toEqual({ title: "Recovered" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should emit mcp.retries_exhausted on network error after all attempts", async () => {
    const onMcpEvent = vi.fn();

    mockFetch
      .mockRejectedValueOnce(new TypeError("DNS lookup failed"))
      .mockRejectedValueOnce(new TypeError("DNS lookup failed"))
      .mockRejectedValueOnce(new TypeError("DNS lookup failed"));

    await expect(callMcpTool({ ...baseOptions, onMcpEvent })).rejects.toThrow();

    expect(onMcpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mcp.retries_exhausted",
        payload: expect.objectContaining({
          tool: "get_issue",
          integration: "linear",
          attempts: 3,
          finalError: expect.stringContaining("DNS lookup failed"),
        }),
      }),
    );
  });

  // ── retryable: false ──────────────────────────────────────────────────

  it("should skip all retries on 5xx when retryable: false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: "Internal server error",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    try {
      await callMcpTool({ ...baseOptions, retryable: false });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.httpStatus).toBe(500);
      expect(mcpErr.classification).toBe("transient_exhausted");
      expect(mcpErr.retryAttempts).toBe(1);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should skip retries on network error when retryable: false", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    try {
      await callMcpTool({ ...baseOptions, retryable: false });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).classification).toBe("network");
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should skip retries on 429 when retryable: false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "1" }),
      json: async () => ({
        error: "Rate limited",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    await expect(
      callMcpTool({ ...baseOptions, retryable: false }),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── onMcpEvent callback ───────────────────────────────────────────────

  it("should not fail when onMcpEvent is not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: "Not found",
        isError: true,
        meta: { correlation_id: "corr-123" },
      }),
    });

    await expect(callMcpTool(baseOptions)).rejects.toThrow(McpError);
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it("should handle unparseable error response body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });

    try {
      await callMcpTool(baseOptions);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).message).toContain("HTTP 403");
      expect((err as McpError).httpStatus).toBe(403);
    }
  });
});
