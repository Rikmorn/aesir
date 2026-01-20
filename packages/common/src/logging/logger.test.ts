/**
 * Logger Unit Tests
 *
 * Tests for the structured logging utility.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  createTimer,
  type LogEntry,
  Logger,
  type LogLevel,
  logger,
} from "./logger.js";

describe("Logger", () => {
  describe("createLogger", () => {
    it("should create a logger instance", () => {
      const log = createLogger();
      expect(log).toBeInstanceOf(Logger);
    });

    it("should create a logger with custom options", () => {
      const log = createLogger({
        minLevel: "warn",
        defaultContext: { agentId: "test-agent" },
      });
      expect(log).toBeInstanceOf(Logger);
    });
  });

  describe("default logger", () => {
    it("should export a default logger instance", () => {
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe("log output format", () => {
    let capturedEntries: LogEntry[];
    let testLogger: Logger;

    beforeEach(() => {
      capturedEntries = [];
      testLogger = createLogger({
        minLevel: "debug",
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });
    });

    it("should output valid JSON with required fields", () => {
      testLogger.info("test_action");

      expect(capturedEntries).toHaveLength(1);
      const entry = capturedEntries[0]!;

      // Required fields
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("level");
      expect(entry).toHaveProperty("action");
      expect(entry).toHaveProperty("context");

      // Verify JSON serializable
      expect(() => JSON.stringify(entry)).not.toThrow();
    });

    it("should use ISO 8601 timestamp format", () => {
      testLogger.info("test_action");

      const entry = capturedEntries[0]!;
      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(entry.timestamp).toMatch(isoRegex);

      // Verify it's a valid date
      const parsed = new Date(entry.timestamp);
      expect(parsed.toISOString()).toBe(entry.timestamp);
    });

    it("should include action in output", () => {
      testLogger.info("tool_call");

      const entry = capturedEntries[0]!;
      expect(entry.action).toBe("tool_call");
    });

    it("should include context in output", () => {
      testLogger.info("test_action", {
        context: {
          threadId: "thread-123",
          taskId: "task-456",
          agentId: "agent-789",
        },
      });

      const entry = capturedEntries[0]!;
      expect(entry.context.threadId).toBe("thread-123");
      expect(entry.context.taskId).toBe("task-456");
      expect(entry.context.agentId).toBe("agent-789");
    });

    it("should include outcome when provided", () => {
      testLogger.info("test_action", { outcome: "success" });

      const entry = capturedEntries[0]!;
      expect(entry.outcome).toBe("success");
    });

    it("should include message when provided", () => {
      testLogger.info("test_action", { message: "Operation completed" });

      const entry = capturedEntries[0]!;
      expect(entry.message).toBe("Operation completed");
    });

    it("should include durationMs when provided", () => {
      testLogger.info("test_action", { durationMs: 150 });

      const entry = capturedEntries[0]!;
      expect(entry.durationMs).toBe(150);
    });

    it("should not include optional fields when not provided", () => {
      testLogger.info("test_action");

      const entry = capturedEntries[0]!;
      expect(entry).not.toHaveProperty("outcome");
      expect(entry).not.toHaveProperty("message");
      expect(entry).not.toHaveProperty("durationMs");
    });
  });

  describe("log levels", () => {
    let capturedEntries: LogEntry[];
    let testLogger: Logger;

    beforeEach(() => {
      capturedEntries = [];
      testLogger = createLogger({
        minLevel: "debug",
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });
    });

    const levels: LogLevel[] = ["debug", "info", "warn", "error"];

    levels.forEach((level) => {
      it(`should log ${level} level`, () => {
        testLogger[level]("test_action");

        expect(capturedEntries).toHaveLength(1);
        expect(capturedEntries[0]?.level).toBe(level);
      });
    });

    it("should filter logs below minimum level", () => {
      const warnLogger = createLogger({
        minLevel: "warn",
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });

      warnLogger.debug("should_not_appear");
      warnLogger.info("should_not_appear");
      warnLogger.warn("should_appear");
      warnLogger.error("should_appear");

      expect(capturedEntries).toHaveLength(2);
      expect(capturedEntries.map((e) => e.level)).toEqual(["warn", "error"]);
    });
  });

  describe("default context", () => {
    it("should include default context in all logs", () => {
      const capturedEntries: LogEntry[] = [];
      const testLogger = createLogger({
        minLevel: "debug",
        defaultContext: { agentId: "default-agent", service: "test" },
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });

      testLogger.info("action1");
      testLogger.warn("action2");

      expect(capturedEntries[0]?.context.agentId).toBe("default-agent");
      expect(capturedEntries[0]?.context.service).toBe("test");
      expect(capturedEntries[1]?.context.agentId).toBe("default-agent");
      expect(capturedEntries[1]?.context.service).toBe("test");
    });

    it("should merge provided context with default context", () => {
      const capturedEntries: LogEntry[] = [];
      const testLogger = createLogger({
        minLevel: "debug",
        defaultContext: { agentId: "default-agent" },
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });

      testLogger.info("test_action", {
        context: { threadId: "thread-123" },
      });

      const entry = capturedEntries[0]!;
      expect(entry.context.agentId).toBe("default-agent");
      expect(entry.context.threadId).toBe("thread-123");
    });

    it("should allow overriding default context", () => {
      const capturedEntries: LogEntry[] = [];
      const testLogger = createLogger({
        minLevel: "debug",
        defaultContext: { agentId: "default-agent" },
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });

      testLogger.info("test_action", {
        context: { agentId: "override-agent" },
      });

      const entry = capturedEntries[0]!;
      expect(entry.context.agentId).toBe("override-agent");
    });
  });

  describe("child logger", () => {
    it("should create a child logger with additional context", () => {
      const capturedEntries: LogEntry[] = [];
      const parentLogger = createLogger({
        minLevel: "debug",
        defaultContext: { agentId: "parent-agent" },
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });

      const childLogger = parentLogger.child({ threadId: "thread-123" });
      childLogger.info("child_action");

      const entry = capturedEntries[0]!;
      expect(entry.context.agentId).toBe("parent-agent");
      expect(entry.context.threadId).toBe("thread-123");
    });

    it("should not affect parent logger", () => {
      const capturedEntries: LogEntry[] = [];
      const parentLogger = createLogger({
        minLevel: "debug",
        defaultContext: { agentId: "parent-agent" },
        console: false,
        output: (entry) => capturedEntries.push(entry),
      });

      parentLogger.child({ threadId: "thread-123" });
      parentLogger.info("parent_action");

      const entry = capturedEntries[0]!;
      expect(entry.context.agentId).toBe("parent-agent");
      expect(entry.context.threadId).toBeUndefined();
    });
  });

  describe("console output", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("should output to console when enabled", () => {
      const testLogger = createLogger({
        minLevel: "debug",
        console: true,
      });

      testLogger.info("test_action");

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("should not output to console when disabled", () => {
      const testLogger = createLogger({
        minLevel: "debug",
        console: false,
      });

      testLogger.info("test_action");

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});

describe("createTimer", () => {
  it("should measure elapsed time", async () => {
    const timer = createTimer();

    // Wait for ~50ms
    await new Promise((resolve) => setTimeout(resolve, 50));

    const elapsed = timer.elapsed();
    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some tolerance
    expect(elapsed).toBeLessThan(200); // Sanity check
  });

  it("should return elapsed time on stop", async () => {
    const timer = createTimer();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const stopped = timer.stop();
    expect(stopped).toBeGreaterThanOrEqual(40);
    expect(stopped).toBeLessThan(200);
  });

  it("should return integer milliseconds", () => {
    const timer = createTimer();
    const elapsed = timer.elapsed();

    expect(Number.isInteger(elapsed)).toBe(true);
  });
});

describe("Logger.startTimer", () => {
  it("should log success with duration", async () => {
    const capturedEntries: LogEntry[] = [];
    const testLogger = createLogger({
      minLevel: "debug",
      console: false,
      output: (entry) => capturedEntries.push(entry),
    });

    const timed = testLogger.startTimer("timed_operation");

    await new Promise((resolve) => setTimeout(resolve, 50));

    timed.success();

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0]!;
    expect(entry.action).toBe("timed_operation");
    expect(entry.outcome).toBe("success");
    expect(entry.durationMs).toBeGreaterThanOrEqual(40);
    expect(entry.level).toBe("info");
  });

  it("should log failure with duration", async () => {
    const capturedEntries: LogEntry[] = [];
    const testLogger = createLogger({
      minLevel: "debug",
      console: false,
      output: (entry) => capturedEntries.push(entry),
    });

    const timed = testLogger.startTimer("timed_operation");

    await new Promise((resolve) => setTimeout(resolve, 50));

    timed.failure({ message: "Something went wrong" });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0]!;
    expect(entry.action).toBe("timed_operation");
    expect(entry.outcome).toBe("failure");
    expect(entry.durationMs).toBeGreaterThanOrEqual(40);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("Something went wrong");
  });

  it("should merge context from startTimer and completion", () => {
    const capturedEntries: LogEntry[] = [];
    const testLogger = createLogger({
      minLevel: "debug",
      console: false,
      output: (entry) => capturedEntries.push(entry),
    });

    const timed = testLogger.startTimer("timed_operation", {
      context: { threadId: "thread-123" },
    });

    timed.success({ context: { toolName: "generate_code" } });

    const entry = capturedEntries[0]!;
    expect(entry.context.threadId).toBe("thread-123");
    expect(entry.context.toolName).toBe("generate_code");
  });
});
