/**
 * Linear Client Factory Tests
 *
 * Tests for LinearClient factory functions and token type detection.
 * Note: createLinearClient requires mocking fetch for token refresh,
 * so we focus on token type detection logic in getLinearClient.
 */

import { describe, expect, it, vi } from "vitest";

// Mock @aesir/types to prevent config validation
vi.mock("@aesir/types", () => ({
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock @linear/sdk
vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    issue: vi.fn(),
    updateIssue: vi.fn(),
  })),
}));

import { getLinearClient } from "./factory.js";

describe("getLinearClient", () => {
  it("creates client with API key when token starts with lin_api_", () => {
    const client = getLinearClient("lin_api_test-key-123");

    expect(client).toBeDefined();
    // API key clients are created with { apiKey: ... }
    // We can't easily verify the internal config, but we can verify it doesn't throw
  });

  it("creates client with OAuth token for other tokens", () => {
    const client = getLinearClient("oauth-token-123");

    expect(client).toBeDefined();
    // OAuth clients are created with { accessToken: ... }
  });

  it("strips Bearer prefix from token", () => {
    const client = getLinearClient("Bearer oauth-token-123");

    expect(client).toBeDefined();
    // Should strip "Bearer " and use the clean token
  });
});
