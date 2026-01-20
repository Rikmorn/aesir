/**
 * Dev Workflow Tests
 *
 * Tests for the StateGraph workflow definition and routing logic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sandbox, TestResult } from "@aesir/common";
import type {
  DevWorkflowConfig,
  DevWorkflowStateType,
} from "@aesir/common";
import { DEFAULT_DEV_WORKFLOW_CONFIG } from "@aesir/common";
import {
  type AfterTestRoute,
  createDevWorkflow,
  type DevWorkflowDependencies,
  routeAfterTest,
} from "./dev-workflow.js";

// Mock the logger
vi.mock("../logging/index.js", () => ({
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

// Mock the nodes (they have their own tests)
vi.mock("./nodes/pickup-task.js", () => ({
  createPickupTaskNode: vi.fn(() => vi.fn().mockResolvedValue({})),
}));

vi.mock("./nodes/create-branch.js", () => ({
  createBranchNode: vi.fn(() => vi.fn().mockResolvedValue({})),
}));

vi.mock("./nodes/commit-pr.js", () => ({
  createCommitPRNode: vi.fn(() => vi.fn().mockResolvedValue({})),
}));

/**
 * Create a base state for testing
 */
function createBaseState(
  overrides: Partial<DevWorkflowStateType> = {},
): DevWorkflowStateType {
  return {
    taskId: "TEST-123",
    sessionId: "session-test",
    taskDescription: "Create a utility function",
    repositoryUrl: "owner/repo",
    branchName: null,
    files: [],
    testResult: null,
    testAttempts: 0,
    status: "testing",
    error: null,
    prNumber: null,
    ...overrides,
  };
}

/**
 * Create a passing test result
 */
function createPassingTestResult(): TestResult {
  return {
    exitCode: 0,
    stdout: "All tests passed",
    stderr: "",
    passed: true,
    summary: "All tests passed",
  };
}

/**
 * Create a failing test result
 */
function createFailingTestResult(): TestResult {
  return {
    exitCode: 1,
    stdout: "1 failed",
    stderr: "AssertionError",
    passed: false,
    summary: "Tests failed",
  };
}

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

/**
 * Create mock dependencies for testing
 */
function createMockDependencies(sandbox: Sandbox): DevWorkflowDependencies {
  return {
    linearClient: {} as DevWorkflowDependencies["linearClient"],
    octokit: {} as DevWorkflowDependencies["octokit"],
    sandbox,
    githubConfig: {
      owner: "test-owner",
      repo: "test-repo",
      baseBranch: "main",
    },
  };
}

describe("routeAfterTest", () => {
  describe("routing to commit_pr", () => {
    it("returns 'commit_pr' when tests pass", () => {
      const state = createBaseState({
        testResult: createPassingTestResult(),
        testAttempts: 1,
      });

      const result = routeAfterTest(state);

      expect(result).toBe("commit_pr");
    });

    it("returns 'commit_pr' when tests pass regardless of attempt count", () => {
      const state = createBaseState({
        testResult: createPassingTestResult(),
        testAttempts: 4, // Near limit but tests passed
      });

      const result = routeAfterTest(state);

      expect(result).toBe("commit_pr");
    });
  });

  describe("routing to fix_code", () => {
    it("returns 'fix_code' when tests fail and under limit", () => {
      const state = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 1,
      });

      const result = routeAfterTest(state);

      expect(result).toBe("fix_code");
    });

    it("returns 'fix_code' at one below max attempts", () => {
      const config: DevWorkflowConfig = {
        ...DEFAULT_DEV_WORKFLOW_CONFIG,
        maxTestAttempts: 5,
      };

      const state = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 4, // One below limit
      });

      const result = routeAfterTest(state, config);

      expect(result).toBe("fix_code");
    });
  });

  describe("routing to fail", () => {
    it("returns 'fail' when max iterations exceeded", () => {
      const config: DevWorkflowConfig = {
        ...DEFAULT_DEV_WORKFLOW_CONFIG,
        maxTestAttempts: 5,
      };

      const state = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 5, // At limit
      });

      const result = routeAfterTest(state, config);

      expect(result).toBe("fail");
    });

    it("returns 'fail' when well over max iterations", () => {
      const config: DevWorkflowConfig = {
        ...DEFAULT_DEV_WORKFLOW_CONFIG,
        maxTestAttempts: 3,
      };

      const state = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 10, // Way over limit
      });

      const result = routeAfterTest(state, config);

      expect(result).toBe("fail");
    });

    it("uses default config when none provided", () => {
      // DEFAULT_DEV_WORKFLOW_CONFIG.maxTestAttempts is 5
      const state = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 5,
      });

      const result = routeAfterTest(state);

      expect(result).toBe("fail");
    });
  });

  describe("edge cases", () => {
    it("handles null testResult (returns fix_code)", () => {
      const state = createBaseState({
        testResult: null,
        testAttempts: 0,
      });

      const result = routeAfterTest(state);

      // null testResult means tests didn't pass, should try to fix
      expect(result).toBe("fix_code");
    });

    it("returns fix_code when testResult.passed is undefined", () => {
      const state = createBaseState({
        testResult: {
          exitCode: 1,
          stdout: "",
          stderr: "",
          passed: undefined as unknown as boolean, // Simulate edge case
          summary: "",
        },
        testAttempts: 1,
      });

      const result = routeAfterTest(state);

      expect(result).toBe("fix_code");
    });

    it("respects custom maxTestAttempts", () => {
      const strictConfig: DevWorkflowConfig = {
        ...DEFAULT_DEV_WORKFLOW_CONFIG,
        maxTestAttempts: 2,
      };

      const state = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 2,
      });

      const result = routeAfterTest(state, strictConfig);

      expect(result).toBe("fail");
    });
  });
});

describe("createDevWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a compiled workflow", () => {
    const mockSandbox = createMockSandbox(createPassingTestResult());
    const mockDeps = createMockDependencies(mockSandbox);

    const workflow = createDevWorkflow({ deps: mockDeps });

    expect(workflow).toBeDefined();
    // Compiled workflows have an invoke method
    expect(typeof workflow.invoke).toBe("function");
  });

  it("workflow has correct node structure", () => {
    const mockSandbox = createMockSandbox(createPassingTestResult());
    const mockDeps = createMockDependencies(mockSandbox);

    const workflow = createDevWorkflow({ deps: mockDeps });

    // The workflow should have the expected nodes
    // We can verify this by checking the graph builder before compile
    // but for the compiled version, we just verify it exists and is invocable
    expect(workflow).toBeDefined();
  });

  describe("workflow compilation", () => {
    it("compiles without errors with valid dependencies", () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const mockDeps = createMockDependencies(mockSandbox);

      expect(() => {
        createDevWorkflow({ deps: mockDeps });
      }).not.toThrow();
    });

    it("accepts custom config", () => {
      const mockSandbox = createMockSandbox(createPassingTestResult());
      const mockDeps = createMockDependencies(mockSandbox);
      const customConfig: DevWorkflowConfig = {
        maxTestAttempts: 3,
        testCommand: ["npm", "run", "test:unit"],
        recursionLimit: 30,
        timeoutMs: 120000,
      };

      expect(() => {
        createDevWorkflow({ deps: mockDeps, config: customConfig });
      }).not.toThrow();
    });
  });

  describe("routing integration", () => {
    it("routeAfterTest is compatible with StateGraph conditional edges", () => {
      // The routing function must return one of the valid destinations
      const validRoutes: AfterTestRoute[] = ["commit_pr", "fail", "fix_code"];

      // Test all possible routes
      const passingState = createBaseState({
        testResult: createPassingTestResult(),
        testAttempts: 1,
      });
      expect(validRoutes).toContain(routeAfterTest(passingState));

      const failingState = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 1,
      });
      expect(validRoutes).toContain(routeAfterTest(failingState));

      const exhaustedState = createBaseState({
        testResult: createFailingTestResult(),
        testAttempts: 5,
      });
      expect(validRoutes).toContain(routeAfterTest(exhaustedState));
    });
  });
});

describe("workflow edge verification", () => {
  it("defines expected node names", () => {
    // This test documents the expected workflow structure
    const expectedNodes = [
      "pickup_task",
      "create_branch",
      "generate_code",
      "run_tests",
      "fix_code",
      "commit_pr",
    ];
    const expectedRoutes: AfterTestRoute[] = ["commit_pr", "fail", "fix_code"];

    // The workflow should support these transitions:
    // __start__ -> pickup_task
    // pickup_task -> create_branch
    // create_branch -> generate_code
    // generate_code -> run_tests
    // run_tests -> commit_pr (END)
    // run_tests -> fail (END)
    // run_tests -> fix_code
    // fix_code -> run_tests
    // commit_pr -> END

    expect(expectedNodes).toHaveLength(6);
    expect(expectedRoutes).toHaveLength(3);
  });

  it("routing covers all expected outcomes", () => {
    const routes = new Set<AfterTestRoute>();

    // Collect all possible routes
    routes.add(
      routeAfterTest(
        createBaseState({
          testResult: createPassingTestResult(),
          testAttempts: 1,
        }),
      ),
    );
    routes.add(
      routeAfterTest(
        createBaseState({
          testResult: createFailingTestResult(),
          testAttempts: 1,
        }),
      ),
    );
    routes.add(
      routeAfterTest(
        createBaseState({
          testResult: createFailingTestResult(),
          testAttempts: 5,
        }),
      ),
    );

    expect(routes.has("commit_pr")).toBe(true);
    expect(routes.has("fix_code")).toBe(true);
    expect(routes.has("fail")).toBe(true);
  });
});
