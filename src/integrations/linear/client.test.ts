/**
 * Linear Client Tests
 *
 * Tests for the Linear client factory and token refresh logic.
 * Note: readIssue/updateIssueStatus are tested via integration tests
 * as they are thin wrappers around the LinearClient SDK.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LinearConfig } from "./types.js";

// Mock @linear/sdk
vi.mock("@linear/sdk", () => {
  return {
    LinearClient: vi.fn().mockImplementation(() => ({
      issue: vi.fn(),
      updateIssue: vi.fn().mockResolvedValue({ success: true }),
    })),
    Issue: class Issue {},
    WorkflowState: class WorkflowState {},
  };
});

// Import after mocking
import { LinearClient } from "@linear/sdk";
import {
  createLinearClient,
  getLinearClient,
  refreshOAuthToken,
} from "./client.js";

describe("getLinearClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates LinearClient with access token", () => {
    const client = getLinearClient("test-access-token");

    expect(LinearClient).toHaveBeenCalledWith({
      accessToken: "test-access-token",
    });
    expect(client).toBeDefined();
  });
});

describe("createLinearClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["LINEAR_CLIENT_ID"] = "test-client-id";
    process.env["LINEAR_CLIENT_SECRET"] = "test-client-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns client without refresh when token is not expiring", async () => {
    const config: LinearConfig = {
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3600_000, // 1 hour from now
    };

    const client = await createLinearClient(config);

    expect(client).toBeDefined();
    expect(LinearClient).toHaveBeenCalledWith({
      accessToken: "valid-token",
    });
  });

  it("refreshes token when expiring within 60 seconds", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 86400,
          token_type: "Bearer",
          scope: "read write",
        }),
    } as Response);

    const config: LinearConfig = {
      accessToken: "expiring-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 30_000, // 30 seconds from now (within 60s buffer)
    };

    const client = await createLinearClient(config);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.linear.app/oauth/token",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(client).toBeDefined();
    expect(LinearClient).toHaveBeenCalledWith({
      accessToken: "new-access-token",
    });
  });

  it("calls onTokenRefresh callback when token is refreshed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 86400,
          token_type: "Bearer",
          scope: "read write",
        }),
    } as Response);

    const config: LinearConfig = {
      accessToken: "expiring-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1000, // Already expired
    };

    const onTokenRefresh = vi.fn();
    await createLinearClient(config, onTokenRefresh);

    expect(onTokenRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      })
    );
  });
});

describe("refreshOAuthToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["LINEAR_CLIENT_ID"] = "test-client-id";
    process.env["LINEAR_CLIENT_SECRET"] = "test-client-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws error when client credentials are missing", async () => {
    delete process.env["LINEAR_CLIENT_ID"];

    await expect(refreshOAuthToken("refresh-token")).rejects.toThrow(
      "LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set"
    );
  });

  it("returns new tokens on successful refresh", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 86400,
          token_type: "Bearer",
          scope: "read write",
        }),
    } as Response);

    const result = await refreshOAuthToken("old-refresh-token");

    expect(result).toEqual({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresIn: 86400,
    });
  });

  it("throws error on refresh failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Invalid refresh token"),
    } as Response);

    await expect(refreshOAuthToken("invalid-refresh-token")).rejects.toThrow(
      "Failed to refresh Linear OAuth token: 401"
    );
  });
});
