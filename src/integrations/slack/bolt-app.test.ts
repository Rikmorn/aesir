/**
 * Bolt App Factory Tests
 *
 * Tests for the Slack Bolt app lifecycle functions.
 * Verifies that App is created with correct Socket Mode configuration
 * and that start/stop operations are handled properly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BoltAppConfig } from "./types.js";

// Mock @slack/bolt - factory must not reference top-level variables
vi.mock("@slack/bolt", () => {
  const mockStart = vi.fn();
  const mockStop = vi.fn();
  const MockApp = vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
  }));

  return {
    App: MockApp,
    __mockStart: mockStart,
    __mockStop: mockStop,
  };
});

// Import after mocking
import { App } from "@slack/bolt";
import { createBoltApp, startBoltApp, stopBoltApp } from "./bolt-app.js";

// Access mock functions from the module
const getMockFunctions = () => {
  // Get the mock functions from the most recent mock instance
  const mockInstance = vi.mocked(App).mock.results[
    vi.mocked(App).mock.results.length - 1
  ]?.value as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  return mockInstance;
};

describe("createBoltApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates App instance with Socket Mode configuration", () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    };

    const app = createBoltApp(config);

    expect(App).toHaveBeenCalledWith({
      token: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    });
    expect(app).toBeDefined();
  });

  it("passes botToken as token parameter", () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-different-token",
      appToken: "xapp-app-token",
      socketMode: true,
    };

    createBoltApp(config);

    expect(App).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-different-token",
      })
    );
  });

  it("always enables Socket Mode", () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      socketMode: true,
    };

    createBoltApp(config);

    expect(App).toHaveBeenCalledWith(
      expect.objectContaining({
        socketMode: true,
      })
    );
  });
});

describe("startBoltApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls app.start()", async () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    };
    const app = createBoltApp(config);
    const { start } = getMockFunctions();
    start.mockResolvedValue(undefined);

    await startBoltApp(app);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("throws error when start fails", async () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    };
    const app = createBoltApp(config);
    const { start } = getMockFunctions();

    start.mockRejectedValueOnce(new Error("Connection failed"));

    await expect(startBoltApp(app)).rejects.toThrow("Connection failed");
  });

  it("propagates original error on failure", async () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    };
    const app = createBoltApp(config);
    const { start } = getMockFunctions();

    const originalError = new Error("Socket Mode connection failed");
    start.mockRejectedValueOnce(originalError);

    try {
      await startBoltApp(app);
    } catch (error) {
      expect(error).toBe(originalError);
    }
  });
});

describe("stopBoltApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls app.stop()", async () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    };
    const app = createBoltApp(config);
    const { stop } = getMockFunctions();
    stop.mockResolvedValue(undefined);

    await stopBoltApp(app);

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not throw when stop fails", async () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    };
    const app = createBoltApp(config);
    const { stop } = getMockFunctions();

    stop.mockRejectedValueOnce(new Error("Disconnect failed"));

    // Should not throw - we're shutting down anyway
    await expect(stopBoltApp(app)).resolves.toBeUndefined();
  });

  it("completes gracefully even with stop error", async () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      socketMode: true,
    };
    const app = createBoltApp(config);
    const { stop } = getMockFunctions();

    stop.mockRejectedValueOnce(new Error("Socket already closed"));

    await stopBoltApp(app);

    // If we get here, the function completed without throwing
    expect(stop).toHaveBeenCalled();
  });
});

describe("lifecycle integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports create -> start -> stop lifecycle", async () => {
    const config: BoltAppConfig = {
      botToken: "xoxb-lifecycle-test",
      appToken: "xapp-lifecycle-test",
      socketMode: true,
    };

    // Create
    const app = createBoltApp(config);
    expect(App).toHaveBeenCalledTimes(1);

    // Get mock functions after app is created
    const { start, stop } = getMockFunctions();
    start.mockResolvedValue(undefined);
    stop.mockResolvedValue(undefined);

    // Start
    await startBoltApp(app);
    expect(start).toHaveBeenCalledTimes(1);

    // Stop
    await stopBoltApp(app);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
