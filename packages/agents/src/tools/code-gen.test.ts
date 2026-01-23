/**
 * Code Generation Tool Tests
 *
 * Tests for the code generation tool, schemas, and invocation behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/common to prevent config validation
vi.mock("@aesir/common", () => ({
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

import {
  type CodeGenInput,
  CodeGenInputSchema,
  type CodeGenOutput,
  CodeGenOutputSchema,
  codeGenTool,
  SupportedLanguageSchema,
} from "./code-gen.js";

describe("SupportedLanguageSchema", () => {
  it("should validate supported languages", () => {
    expect(SupportedLanguageSchema.parse("typescript")).toBe("typescript");
    expect(SupportedLanguageSchema.parse("javascript")).toBe("javascript");
    expect(SupportedLanguageSchema.parse("python")).toBe("python");
  });

  it("should reject unsupported languages", () => {
    expect(() => SupportedLanguageSchema.parse("rust")).toThrow();
    expect(() => SupportedLanguageSchema.parse("go")).toThrow();
    expect(() => SupportedLanguageSchema.parse("")).toThrow();
    expect(() => SupportedLanguageSchema.parse(123)).toThrow();
  });
});

describe("CodeGenInputSchema", () => {
  it("should validate valid input", () => {
    const input: CodeGenInput = {
      taskDescription: "Create a function to calculate factorial",
      language: "typescript",
    };

    const result = CodeGenInputSchema.parse(input);
    expect(result.taskDescription).toBe(input.taskDescription);
    expect(result.language).toBe(input.language);
  });

  it("should validate input with optional context", () => {
    const input: CodeGenInput = {
      taskDescription: "Create a function to calculate factorial",
      language: "python",
      context: "Should handle negative numbers with an error",
    };

    const result = CodeGenInputSchema.parse(input);
    expect(result.context).toBe(input.context);
  });

  it("should reject empty task description", () => {
    const input = {
      taskDescription: "",
      language: "typescript",
    };

    expect(() => CodeGenInputSchema.parse(input)).toThrow(
      "Task description cannot be empty",
    );
  });

  it("should reject missing task description", () => {
    const input = {
      language: "typescript",
    };

    expect(() => CodeGenInputSchema.parse(input)).toThrow();
  });

  it("should reject missing language", () => {
    const input = {
      taskDescription: "Create something",
    };

    expect(() => CodeGenInputSchema.parse(input)).toThrow();
  });

  it("should reject invalid language", () => {
    const input = {
      taskDescription: "Create something",
      language: "cobol",
    };

    expect(() => CodeGenInputSchema.parse(input)).toThrow();
  });
});

describe("CodeGenOutputSchema", () => {
  it("should validate valid output", () => {
    const output: CodeGenOutput = {
      code: "const factorial = (n: number) => n <= 1 ? 1 : n * factorial(n - 1);",
      language: "typescript",
      explanation: "A recursive function to calculate factorial",
    };

    const result = CodeGenOutputSchema.parse(output);
    expect(result.code).toBe(output.code);
    expect(result.language).toBe(output.language);
    expect(result.explanation).toBe(output.explanation);
  });

  it("should reject missing fields", () => {
    expect(() =>
      CodeGenOutputSchema.parse({
        code: "const x = 1;",
        language: "typescript",
      }),
    ).toThrow();

    expect(() =>
      CodeGenOutputSchema.parse({
        code: "const x = 1;",
        explanation: "A constant",
      }),
    ).toThrow();

    expect(() =>
      CodeGenOutputSchema.parse({
        language: "typescript",
        explanation: "A constant",
      }),
    ).toThrow();
  });
});

describe("codeGenTool", () => {
  // Suppress console output during tests
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(codeGenTool.name).toBe("generate_code");
    });

    it("should have a description", () => {
      expect(codeGenTool.description).toContain("Generate code");
      expect(codeGenTool.description).toContain("task description");
    });

    it("should have the input schema", () => {
      expect(codeGenTool.schema).toBeDefined();
    });
  });

  describe("invocation", () => {
    it("should generate typescript code", async () => {
      const result = await codeGenTool.invoke({
        taskDescription: "Create a function to add two numbers",
        language: "typescript",
      });

      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("language", "typescript");
      expect(result).toHaveProperty("explanation");
      expect(result.code).toContain("// TODO: Implement");
      expect(result.code).toContain("add two numbers");
    });

    it("should generate javascript code", async () => {
      const result = await codeGenTool.invoke({
        taskDescription: "Create a greeting function",
        language: "javascript",
      });

      expect(result.language).toBe("javascript");
      expect(result.code).toContain("// TODO: Implement");
    });

    it("should generate python code with hash comments", async () => {
      const result = await codeGenTool.invoke({
        taskDescription: "Create a factorial function",
        language: "python",
      });

      expect(result.language).toBe("python");
      expect(result.code).toContain("# TODO: Implement");
      expect(result.code).toContain("factorial function");
    });

    it("should include context in consideration", async () => {
      const result = await codeGenTool.invoke({
        taskDescription: "Create a sort function",
        language: "typescript",
        context: "Should use quicksort algorithm",
      });

      // The current placeholder doesn't use context in the output,
      // but it should still work without error
      expect(result).toHaveProperty("code");
      expect(result.language).toBe("typescript");
    });

    it("should handle long task descriptions", async () => {
      const longDescription = "A".repeat(1000);

      const result = await codeGenTool.invoke({
        taskDescription: longDescription,
        language: "typescript",
      });

      expect(result).toHaveProperty("code");
      expect(result.code).toContain(longDescription);
    });
  });

  describe("logging integration", () => {
    it("should complete invocation without errors", async () => {
      // The tool should complete without throwing
      // Logger output is suppressed by beforeEach mock
      const result = await codeGenTool.invoke({
        taskDescription: "Test logging",
        language: "typescript",
      });

      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("language", "typescript");
      expect(result).toHaveProperty("explanation");
    });
  });
});
