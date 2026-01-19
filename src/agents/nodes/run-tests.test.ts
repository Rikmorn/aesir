/**
 * Run Tests Node Tests
 *
 * Tests for runTestsNode with mock sandbox.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRunTestsNode } from "./run-tests.js";
import type { Sandbox, TestResult } from "../../sandbox/types.js";
import type { DevWorkflowStateType } from "../../state/dev-workflow-state.js";

// Mock the logger
vi.mock("../../logging/index.js", () => ({
  logger: {
    child: () => ({
      startTimer: () => ({
        success: vi.fn(),
        failure: vi.fn(),
      }),
      info: vi.fn(),
    }),
  },
}));

/**
 * Create a mock sandbox for testing
 */
function createMockSandbox(testResult: TestResult): Sandbox {
  return {
    execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    runTests: vi.fn().mockResolvedValue(testResult),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createPassingTestResult(): TestResult {
  return {
    exitCode: 0,
    stdout: "All tests passed\n1 passed",
    stderr: "",
    passed: true,
    summary: "All tests passed",
  };
}

function createFailingTestResult(): TestResult {
  return {
    exitCode: 1,
    stdout: "1 failed, 0 passed",
    stderr: "AssertionError: expected 1 to equal 2",
    passed: false,
    summary: "Tests failed with exit code 1",
  };
}

describe("createRunTestsNode", () => {
  const baseState: DevWorkflowStateType = {
    taskId: "TEST-123",
    taskDescription: "Create a utility function",
    repositoryUrl: "owner/repo",
    branchName: "feat/test-123",
    files: [
      {
        path: "src/utils/helper.ts",
        content: 'export function helper() { return "hello"; }',
        operation: "create",
      },
      {
        path: "src/utils/helper.test.ts",
        content: `import { helper } from "./helper.js";
describe("helper", () => {
  it("returns hello", () => {
    expect(helper()).toBe("hello");
  });
});`,
        operation: "create",
      },
    ],
    testResult: null,
    testAttempts: 0,
    status: "testing",
    error: null,
    prNumber: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("file writing", () => {
    it("writes all files to sandbox before running tests", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      await runTestsNode(baseState);

      // Should write both files
      expect(mockSandbox.writeFile).toHaveBeenCalledTimes(2);
      expect(mockSandbox.writeFile).toHaveBeenCalledWith(
        "src/utils/helper.ts",
        'export function helper() { return "hello"; }'
      );
      expect(mockSandbox.writeFile).toHaveBeenCalledWith(
        "src/utils/helper.test.ts",
        expect.stringContaining("describe")
      );
    });

    it("creates parent directories before writing files", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      await runTestsNode(baseState);

      // Should create directory for each file path
      expect(mockSandbox.execute).toHaveBeenCalledWith([
        "mkdir",
        "-p",
        "src/utils",
      ]);
    });

    it("skips files with delete operation", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const stateWithDelete: DevWorkflowStateType = {
        ...baseState,
        files: [
          {
            path: "src/old-file.ts",
            content: "",
            operation: "delete",
          },
          {
            path: "src/new-file.ts",
            content: "// new file",
            operation: "create",
          },
        ],
      };

      await runTestsNode(stateWithDelete);

      // Should only write the non-delete file
      expect(mockSandbox.writeFile).toHaveBeenCalledTimes(1);
      expect(mockSandbox.writeFile).toHaveBeenCalledWith(
        "src/new-file.ts",
        "// new file"
      );
    });
  });

  describe("test execution", () => {
    it("returns TestResult from sandbox.runTests", async () => {
      const expectedResult = createPassingTestResult();
      const mockSandbox = createMockSandbox(expectedResult);
      const runTestsNode = createRunTestsNode(mockSandbox);

      const result = await runTestsNode(baseState);

      expect(result.testResult).toEqual(expectedResult);
    });

    it("uses config.testCommand for running tests", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const customConfig = {
        maxTestAttempts: 3,
        testCommand: ["npm", "run", "test:unit"],
        recursionLimit: 50,
        timeoutMs: 300000,
      };

      await runTestsNode(baseState, customConfig);

      expect(mockSandbox.runTests).toHaveBeenCalledWith(["npm", "run", "test:unit"]);
    });
  });

  describe("testAttempts", () => {
    it("increments testAttempts by 1", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const result = await runTestsNode(baseState);

      expect(result.testAttempts).toBe(1);
    });

    it("increments from current testAttempts value", async () => {
      const mockSandbox = createMockSandbox(createFailingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const stateWith3Attempts: DevWorkflowStateType = {
        ...baseState,
        testAttempts: 3,
      };

      const result = await runTestsNode(stateWith3Attempts);

      expect(result.testAttempts).toBe(4);
    });
  });

  describe("status updates", () => {
    it("sets status to 'committing' when tests pass", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const result = await runTestsNode(baseState);

      expect(result.status).toBe("committing");
    });

    it("sets status to 'fixing' when tests fail", async () => {
      const mockSandbox = createMockSandbox(createFailingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const result = await runTestsNode(baseState);

      expect(result.status).toBe("fixing");
    });
  });

  describe("error handling", () => {
    it("returns failed status on sandbox error", async () => {
      const mockSandbox: Sandbox = {
        execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockRejectedValue(new Error("Container not running")),
        readFile: vi.fn().mockResolvedValue(""),
        runTests: vi.fn().mockResolvedValue(createPassingTestResult()),
        cleanup: vi.fn().mockResolvedValue(undefined),
      };
      const runTestsNode = createRunTestsNode(mockSandbox);

      const result = await runTestsNode(baseState);

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Container not running");
    });

    it("handles unknown errors gracefully", async () => {
      const mockSandbox: Sandbox = {
        execute: vi.fn().mockRejectedValue("string error"),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(""),
        runTests: vi.fn().mockResolvedValue(createPassingTestResult()),
        cleanup: vi.fn().mockResolvedValue(undefined),
      };
      const runTestsNode = createRunTestsNode(mockSandbox);

      const result = await runTestsNode(baseState);

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Unknown error during test execution");
    });
  });

  describe("edge cases", () => {
    it("handles empty files array", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const stateWithNoFiles: DevWorkflowStateType = {
        ...baseState,
        files: [],
      };

      const result = await runTestsNode(stateWithNoFiles);

      expect(mockSandbox.writeFile).not.toHaveBeenCalled();
      expect(result.testResult?.passed).toBe(true);
    });

    it("handles files in root directory (no parent path)", async () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const runTestsNode = createRunTestsNode(mockSandbox);

      const stateWithRootFile: DevWorkflowStateType = {
        ...baseState,
        files: [
          {
            path: "index.ts",
            content: "// root file",
            operation: "create",
          },
        ],
      };

      await runTestsNode(stateWithRootFile);

      // Should still write file even without parent directory creation
      expect(mockSandbox.writeFile).toHaveBeenCalledWith("index.ts", "// root file");
    });
  });
});
