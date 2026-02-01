/**
 * ToolRegistry Tests
 *
 * Tests for createToolRegistry() covering: factory registration,
 * tool reference validation, namespace resolution, error reporting,
 * and edge cases (empty refs, duplicate refs in resolve).
 */

import type { PinoLogger } from "@aesir/platform";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createToolRegistry } from "./tool-registry.js";
import type { ToolContext, ToolFactory } from "./types.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockLogger(): PinoLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
    level: "debug",
    silent: vi.fn(),
  } as unknown as PinoLogger;
}

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentId: "test-agent",
    correlationId: "corr-123",
    logger: createMockLogger(),
    ...overrides,
  };
}

function createMockFactory(name: string): ToolFactory {
  return (_ctx: ToolContext) => ({
    name,
    description: `Mock tool: ${name}`,
    inputSchema: z.object({}),
    execute: async () => ({ content: "ok" }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  // ── Registration ─────────────────────────────────────────────────────────

  describe("registration", () => {
    it("should register a tool factory", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      registry.register("linear:get_issue", createMockFactory("get_issue"));

      expect(registry.has("linear:get_issue")).toBe(true);
    });

    it("should reject duplicate registration", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      registry.register("linear:get_issue", createMockFactory("get_issue"));

      expect(() => {
        registry.register("linear:get_issue", createMockFactory("get_issue"));
      }).toThrow(/already registered/);
    });

    it("should reject invalid tool reference format", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      // Missing colon
      expect(() => {
        registry.register("invalid", createMockFactory("invalid"));
      }).toThrow(/Invalid tool reference format/);

      // Uppercase namespace
      expect(() => {
        registry.register("CAPS:tool", createMockFactory("tool"));
      }).toThrow(/Invalid tool reference format/);

      // Underscore in namespace (only lowercase letters allowed before colon)
      expect(() => {
        registry.register("no_colon", createMockFactory("tool"));
      }).toThrow(/Invalid tool reference format/);

      // Numbers in namespace
      expect(() => {
        registry.register("ns1:tool", createMockFactory("tool"));
      }).toThrow(/Invalid tool reference format/);

      // Empty string
      expect(() => {
        registry.register("", createMockFactory("tool"));
      }).toThrow(/Invalid tool reference format/);
    });

    it("should list registered tools sorted alphabetically", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      registry.register(
        "github:create_branch",
        createMockFactory("create_branch"),
      );
      registry.register("linear:get_issue", createMockFactory("get_issue"));
      registry.register("codebase:read_file", createMockFactory("read_file"));

      expect(registry.listRegistered()).toEqual([
        "codebase:read_file",
        "github:create_branch",
        "linear:get_issue",
      ]);
    });

    it("should log debug message on successful registration", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      registry.register("linear:get_issue", createMockFactory("get_issue"));

      expect(logger.debug).toHaveBeenCalledWith(
        { toolRef: "linear:get_issue" },
        "Tool factory registered",
      );
    });
  });

  // ── Resolution ───────────────────────────────────────────────────────────

  describe("resolution", () => {
    it("should resolve registered tool refs to ToolDefinitions", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      registry.register("linear:get_issue", createMockFactory("get_issue"));
      registry.register(
        "github:create_branch",
        createMockFactory("create_branch"),
      );

      const context = createMockContext();
      const tools = registry.resolve(
        ["linear:get_issue", "github:create_branch"],
        context,
      );

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(["get_issue", "create_branch"]);
    });

    it("should throw on unknown tool reference", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      const context = createMockContext();

      expect(() => {
        registry.resolve(["linear:unknown_tool"], context);
      }).toThrow(/Unknown tool reference.*"linear:unknown_tool"/);
    });

    it("should throw listing ALL missing refs, not just first", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      registry.register("linear:get_issue", createMockFactory("get_issue"));

      const context = createMockContext();

      expect(() => {
        registry.resolve(
          ["linear:get_issue", "unknown:one", "unknown:two"],
          context,
        );
      }).toThrow(/unknown:one.*unknown:two/);
    });

    it("should call factory with provided ToolContext", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      let capturedContext: ToolContext | undefined;
      const capturingFactory: ToolFactory = (ctx) => {
        capturedContext = ctx;
        return {
          name: "capturing_tool",
          description: "captures context",
          inputSchema: z.object({}),
          execute: async () => ({ content: "ok" }),
        };
      };

      registry.register("test:capturing_tool", capturingFactory);

      const context = createMockContext({
        agentId: "special-agent",
        correlationId: "corr-special",
      });

      registry.resolve(["test:capturing_tool"], context);

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.agentId).toBe("special-agent");
      expect(capturedContext?.correlationId).toBe("corr-special");
    });

    it("should include registered tools in error message for unknown refs", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      registry.register("linear:get_issue", createMockFactory("get_issue"));
      registry.register(
        "github:create_branch",
        createMockFactory("create_branch"),
      );

      const context = createMockContext();

      expect(() => {
        registry.resolve(["unknown:tool"], context);
      }).toThrow(/Registered tools:.*github:create_branch.*linear:get_issue/);
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should resolve empty tool refs array to empty array", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      const context = createMockContext();
      const tools = registry.resolve([], context);

      expect(tools).toEqual([]);
    });

    it("should handle resolve with same ref listed twice", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      let callCount = 0;
      const countingFactory: ToolFactory = (_ctx) => {
        callCount++;
        return {
          name: "counted_tool",
          description: "counts calls",
          inputSchema: z.object({}),
          execute: async () => ({ content: "ok" }),
        };
      };

      registry.register("test:counted_tool", countingFactory);

      const context = createMockContext();
      const tools = registry.resolve(
        ["test:counted_tool", "test:counted_tool"],
        context,
      );

      expect(tools).toHaveLength(2);
      expect(callCount).toBe(2);
    });

    it("should return false for has() on unregistered ref", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      expect(registry.has("unknown:tool")).toBe(false);
    });

    it("should return empty array for listRegistered() when nothing registered", () => {
      const logger = createMockLogger();
      const registry = createToolRegistry({ logger });

      expect(registry.listRegistered()).toEqual([]);
    });
  });
});
