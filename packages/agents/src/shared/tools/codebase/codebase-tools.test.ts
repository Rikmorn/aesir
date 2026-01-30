/**
 * Codebase Tools Tests
 *
 * Comprehensive unit tests for all 5 codebase tool factories.
 * Tests factory pattern, input validation, error handling, and output truncation.
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodebaseToolDeps } from "../types.js";
import { MAX_OUTPUT_BYTES, MAX_STDERR_BYTES } from "../types.js";
import { createListDirectoryTool } from "./list-directory.js";
import { createReadFileTool } from "./read-file.js";
import { createRunCommandTool } from "./run-command.js";
import { createSearchCodebaseTool } from "./search-codebase.js";
import { createWriteFileTool } from "./write-file.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockDeps(): CodebaseToolDeps & {
  containerManager: { execute: ReturnType<typeof vi.fn> };
} {
  return {
    containerManager: {
      execute: vi.fn(),
      spawn: vi.fn(),
      findByTaskId: vi.fn(),
      isRunning: vi.fn(),
      health: vi.fn(),
      close: vi.fn(),
    } as unknown as DevContainerManager & {
      execute: ReturnType<typeof vi.fn>;
    },
    taskId: "test-task-123",
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as PinoLogger,
  };
}

/**
 * Build a string larger than the given byte limit
 */
function buildLargeString(byteLimit: number): string {
  return "x".repeat(byteLimit + 1_000);
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

describe("createReadFileTool", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("returns a ToolDefinition with correct name", () => {
    const tool = createReadFileTool(deps);
    expect(tool.name).toBe("read_file");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
    expect(tool.execute).toBeTypeOf("function");
  });

  it("reads file content on success", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "file content here",
      stderr: "",
    });

    const tool = createReadFileTool(deps);
    const result = await tool.execute({ path: "src/index.ts" });

    expect(result.content).toBe("file content here");
    expect(result.isError).toBeUndefined();
    expect(deps.containerManager.execute).toHaveBeenCalledWith(
      "test-task-123",
      {
        command: ["cat", "src/index.ts"],
        workdir: "/workspace/repo",
        timeoutMs: 30_000,
      },
    );
  });

  it("returns isError on validation failure (missing path)", async () => {
    const tool = createReadFileTool(deps);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("returns isError on validation failure (wrong type)", async () => {
    const tool = createReadFileTool(deps);
    const result = await tool.execute({ path: 42 });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("returns stderr on non-zero exit code", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "cat: no such file or directory",
    });

    const tool = createReadFileTool(deps);
    const result = await tool.execute({ path: "missing.txt" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("cat: no such file or directory");
  });

  it("returns 'File not found' when stderr is empty on non-zero exit", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "",
    });

    const tool = createReadFileTool(deps);
    const result = await tool.execute({ path: "missing.txt" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("File not found");
  });

  it("returns isError on execution error (throws)", async () => {
    deps.containerManager.execute.mockRejectedValue(
      new Error("Container not found for task test-task-123"),
    );

    const tool = createReadFileTool(deps);
    const result = await tool.execute({ path: "src/index.ts" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Container not found for task test-task-123");
  });

  it("truncates output exceeding MAX_OUTPUT_BYTES", async () => {
    const largeContent = buildLargeString(MAX_OUTPUT_BYTES);
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: largeContent,
      stderr: "",
    });

    const tool = createReadFileTool(deps);
    const result = await tool.execute({ path: "large-file.txt" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("[output truncated at 100KB]");
    expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThan(
      MAX_OUTPUT_BYTES + 100,
    );
  });
});

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

describe("createWriteFileTool", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("returns a ToolDefinition with correct name", () => {
    const tool = createWriteFileTool(deps);
    expect(tool.name).toBe("write_file");
  });

  it("writes file content successfully with parent directory", async () => {
    deps.containerManager.execute
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // mkdir
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // write

    const tool = createWriteFileTool(deps);
    const result = await tool.execute({
      path: "src/new-file.ts",
      content: "export const x = 1;\n",
    });

    expect(result.content).toBe("Successfully wrote src/new-file.ts");
    expect(result.isError).toBeUndefined();

    // Verify mkdir was called
    expect(deps.containerManager.execute).toHaveBeenCalledTimes(2);
    const mkdirCall = deps.containerManager.execute.mock.calls[0];
    expect(mkdirCall?.[1].command).toEqual(["mkdir", "-p", "src"]);

    // Verify base64 write was called
    const writeCall = deps.containerManager.execute.mock.calls[1];
    expect(writeCall?.[1].command[0]).toBe("sh");
    expect(writeCall?.[1].command[1]).toBe("-c");
    expect(writeCall?.[1].command[2]).toContain("base64 -d");
  });

  it("writes file at root level without mkdir", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const tool = createWriteFileTool(deps);
    const result = await tool.execute({
      path: "README.md",
      content: "# Hello",
    });

    expect(result.content).toBe("Successfully wrote README.md");
    // Only one call (no mkdir for root-level file)
    expect(deps.containerManager.execute).toHaveBeenCalledTimes(1);
  });

  it("encodes content as base64 correctly", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const tool = createWriteFileTool(deps);
    const content = "Hello, world!\nLine 2\n";
    await tool.execute({ path: "test.txt", content });

    const writeCall = deps.containerManager.execute.mock.calls[0];
    const expected = Buffer.from(content).toString("base64");
    expect(writeCall?.[1].command[2]).toContain(expected);
  });

  it("returns isError on validation failure", async () => {
    const tool = createWriteFileTool(deps);
    const result = await tool.execute({ path: "test.txt" }); // missing content

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("returns isError when mkdir fails", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "permission denied",
    });

    const tool = createWriteFileTool(deps);
    const result = await tool.execute({
      path: "dir/file.ts",
      content: "test",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Failed to create directory");
  });

  it("returns isError when write fails", async () => {
    deps.containerManager.execute
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // mkdir ok
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "disk full",
      }); // write fails

    const tool = createWriteFileTool(deps);
    const result = await tool.execute({
      path: "dir/file.ts",
      content: "test",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Failed to write");
  });

  it("returns isError on execution error (throws)", async () => {
    deps.containerManager.execute.mockRejectedValue(
      new Error("Container crashed"),
    );

    const tool = createWriteFileTool(deps);
    const result = await tool.execute({
      path: "file.ts",
      content: "test",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Container crashed");
  });
});

// ---------------------------------------------------------------------------
// search_codebase
// ---------------------------------------------------------------------------

describe("createSearchCodebaseTool", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("returns a ToolDefinition with correct name", () => {
    const tool = createSearchCodebaseTool(deps);
    expect(tool.name).toBe("search_codebase");
  });

  it("searches and returns matching lines", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "src/index.ts:1:import { foo } from './foo';\n",
      stderr: "",
    });

    const tool = createSearchCodebaseTool(deps);
    const result = await tool.execute({ pattern: "import.*foo" });

    expect(result.content).toBe(
      "src/index.ts:1:import { foo } from './foo';\n",
    );
    expect(result.isError).toBeUndefined();

    const call = deps.containerManager.execute.mock.calls[0];
    expect(call?.[1].command).toEqual([
      "rg",
      "--line-number",
      "--max-count",
      "50",
      "--no-heading",
      "import.*foo",
    ]);
  });

  it("handles no matches (exit code 1, empty stderr) as non-error", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "",
    });

    const tool = createSearchCodebaseTool(deps);
    const result = await tool.execute({ pattern: "nonexistent_xyz" });

    expect(result.content).toBe("No matches found");
    expect(result.isError).toBeUndefined();
  });

  it("handles actual ripgrep error (exit code 2)", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 2,
      stdout: "",
      stderr: "rg: invalid regex",
    });

    const tool = createSearchCodebaseTool(deps);
    const result = await tool.execute({ pattern: "[invalid" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("rg: invalid regex");
  });

  it("passes glob filter to ripgrep", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "match\n",
      stderr: "",
    });

    const tool = createSearchCodebaseTool(deps);
    await tool.execute({ pattern: "test", glob: "*.ts" });

    const call = deps.containerManager.execute.mock.calls[0];
    expect(call?.[1].command).toContain("--glob");
    expect(call?.[1].command).toContain("*.ts");
  });

  it("passes path argument to ripgrep", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "match\n",
      stderr: "",
    });

    const tool = createSearchCodebaseTool(deps);
    await tool.execute({ pattern: "test", path: "src/utils" });

    const call = deps.containerManager.execute.mock.calls[0];
    const cmd = call?.[1].command as string[];
    expect(cmd[cmd.length - 1]).toBe("src/utils");
  });

  it("returns isError on validation failure", async () => {
    const tool = createSearchCodebaseTool(deps);
    const result = await tool.execute({}); // missing pattern

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("returns isError on execution error (throws)", async () => {
    deps.containerManager.execute.mockRejectedValue(
      new Error("Container gone"),
    );

    const tool = createSearchCodebaseTool(deps);
    const result = await tool.execute({ pattern: "test" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Container gone");
  });

  it("truncates output exceeding MAX_OUTPUT_BYTES", async () => {
    const largeOutput = buildLargeString(MAX_OUTPUT_BYTES);
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: largeOutput,
      stderr: "",
    });

    const tool = createSearchCodebaseTool(deps);
    const result = await tool.execute({ pattern: "test" });

    expect(result.content).toContain("[output truncated at 100KB]");
  });
});

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------

describe("createListDirectoryTool", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("returns a ToolDefinition with correct name", () => {
    const tool = createListDirectoryTool(deps);
    expect(tool.name).toBe("list_directory");
  });

  it("lists directory with default path", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "total 8\ndrwxr-xr-x 2 root root 4096 Jan 1 00:00 .\n",
      stderr: "",
    });

    const tool = createListDirectoryTool(deps);
    const result = await tool.execute({});

    expect(result.content).toContain("total 8");
    expect(result.isError).toBeUndefined();

    const call = deps.containerManager.execute.mock.calls[0];
    expect(call?.[1].command).toEqual(["ls", "-la", "."]);
    expect(call?.[1].timeoutMs).toBe(10_000);
  });

  it("lists directory with custom path", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "total 4\ndrwxr-xr-x 2 root root 4096 Jan 1 00:00 src\n",
      stderr: "",
    });

    const tool = createListDirectoryTool(deps);
    const result = await tool.execute({ path: "src" });

    expect(result.content).toContain("total 4");

    const call = deps.containerManager.execute.mock.calls[0];
    expect(call?.[1].command).toEqual(["ls", "-la", "src"]);
  });

  it("returns isError on non-zero exit code", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 2,
      stdout: "",
      stderr: "ls: cannot access 'nope': No such file or directory",
    });

    const tool = createListDirectoryTool(deps);
    const result = await tool.execute({ path: "nope" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("No such file or directory");
  });

  it("returns 'Directory not found' when stderr is empty on non-zero exit", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 2,
      stdout: "",
      stderr: "",
    });

    const tool = createListDirectoryTool(deps);
    const result = await tool.execute({ path: "nope" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Directory not found");
  });

  it("returns isError on execution error (throws)", async () => {
    deps.containerManager.execute.mockRejectedValue(
      new Error("Docker unavailable"),
    );

    const tool = createListDirectoryTool(deps);
    const result = await tool.execute({ path: "src" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Docker unavailable");
  });

  it("truncates output exceeding MAX_OUTPUT_BYTES", async () => {
    const largeOutput = buildLargeString(MAX_OUTPUT_BYTES);
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: largeOutput,
      stderr: "",
    });

    const tool = createListDirectoryTool(deps);
    const result = await tool.execute({});

    expect(result.content).toContain("[output truncated at 100KB]");
  });
});

// ---------------------------------------------------------------------------
// run_command
// ---------------------------------------------------------------------------

describe("createRunCommandTool", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("returns a ToolDefinition with correct name", () => {
    const tool = createRunCommandTool(deps);
    expect(tool.name).toBe("run_command");
  });

  it("runs command and formats output with STDOUT", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "All 42 tests passed\n",
      stderr: "",
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "pnpm test" });

    expect(result.content).toContain("Exit code: 0");
    expect(result.content).toContain("STDOUT:");
    expect(result.content).toContain("All 42 tests passed");
    expect(result.isError).toBeUndefined();

    const call = deps.containerManager.execute.mock.calls[0];
    expect(call?.[1].command).toEqual(["sh", "-c", "pnpm test"]);
    expect(call?.[1].timeoutMs).toBe(180_000); // default
  });

  it("runs command with custom timeout", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "done\n",
      stderr: "",
    });

    const tool = createRunCommandTool(deps);
    await tool.execute({ command: "pnpm install", timeoutMs: 300_000 });

    const call = deps.containerManager.execute.mock.calls[0];
    expect(call?.[1].timeoutMs).toBe(300_000);
  });

  it("formats STDERR in output", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "output\n",
      stderr: "warning: deprecated\n",
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "npm build" });

    expect(result.content).toContain("STDOUT:");
    expect(result.content).toContain("STDERR:");
    expect(result.content).toContain("warning: deprecated");
  });

  it("sets isError on non-zero exit code", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "Error: test failed\n",
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "pnpm test" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Exit code: 1");
    expect(result.content).toContain("STDERR:");
  });

  it("shows TIMED OUT indicator", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 124,
      stdout: "",
      stderr: "Command timed out after 5000ms",
      timedOut: true,
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({
      command: "sleep 999",
      timeoutMs: 5000,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("[TIMED OUT]");
    expect(result.content).toContain("Exit code: 124");
  });

  it("returns isError on validation failure (missing command)", async () => {
    const tool = createRunCommandTool(deps);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("returns isError on execution error (throws)", async () => {
    deps.containerManager.execute.mockRejectedValue(
      new Error("Container exited"),
    );

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "echo hello" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Container exited");
  });

  it("truncates stdout exceeding MAX_OUTPUT_BYTES", async () => {
    const largeStdout = buildLargeString(MAX_OUTPUT_BYTES);
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: largeStdout,
      stderr: "",
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "cat big-file" });

    expect(result.content).toContain("[stdout truncated at 100KB]");
    expect(result.isError).toBeUndefined();
  });

  it("truncates stderr exceeding MAX_STDERR_BYTES", async () => {
    const largeStderr = buildLargeString(MAX_STDERR_BYTES);
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: largeStderr,
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "make all" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("[stderr truncated at 50KB]");
  });

  it("does not include empty STDOUT section", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "error occurred\n",
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "fail" });

    expect(result.content).not.toContain("STDOUT:");
    expect(result.content).toContain("STDERR:");
  });

  it("does not include empty STDERR section", async () => {
    deps.containerManager.execute.mockResolvedValue({
      exitCode: 0,
      stdout: "success\n",
      stderr: "",
    });

    const tool = createRunCommandTool(deps);
    const result = await tool.execute({ command: "echo success" });

    expect(result.content).toContain("STDOUT:");
    expect(result.content).not.toContain("STDERR:");
  });
});
