/**
 * Slack Client Tests
 *
 * Tests for the Slack client factory functions.
 * Verifies that WebClient is instantiated with correct authentication.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackConfig } from "./types.js";

// Mock @slack/web-api
vi.mock("@slack/web-api", () => {
  return {
    WebClient: vi.fn().mockImplementation(() => ({
      chat: {
        postMessage: vi.fn(),
      },
      conversations: {
        open: vi.fn(),
      },
    })),
  };
});

// Import after mocking
import { WebClient } from "@slack/web-api";
import { createSlackClient, getSlackClient } from "./client.js";

describe("createSlackClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates WebClient instance with token from config", () => {
    const config: SlackConfig = {
      botToken: "xoxb-test-token",
      defaultChannel: "C1234567890",
    };

    const client = createSlackClient(config);

    expect(WebClient).toHaveBeenCalledWith("xoxb-test-token");
    expect(client).toBeDefined();
  });

  it("passes config botToken to WebClient constructor", () => {
    const config: SlackConfig = {
      botToken: "xoxb-xxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx",
      defaultChannel: "C9876543210",
    };

    createSlackClient(config);

    expect(WebClient).toHaveBeenCalledWith(
      "xoxb-xxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx",
    );
  });
});

describe("getSlackClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates WebClient instance with direct token", () => {
    const client = getSlackClient("xoxb-direct-token");

    expect(WebClient).toHaveBeenCalledWith("xoxb-direct-token");
    expect(client).toBeDefined();
  });

  it("creates separate instances for different tokens", () => {
    getSlackClient("xoxb-token-1");
    getSlackClient("xoxb-token-2");

    expect(WebClient).toHaveBeenCalledTimes(2);
    expect(WebClient).toHaveBeenNthCalledWith(1, "xoxb-token-1");
    expect(WebClient).toHaveBeenNthCalledWith(2, "xoxb-token-2");
  });
});
