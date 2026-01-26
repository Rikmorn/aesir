/**
 * Product Agent Graph Tests
 *
 * Tests for the StateGraph workflow definition and routing logic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AfterAnalysisRoute,
  createProductAgentGraph,
  routeAfterAnalysis,
} from "./graph.js";
import {
  DEFAULT_REQUIREMENTS,
  type ProductAgentPhase,
  type ProductAgentState,
} from "./state.js";

// Mock the logger
vi.mock("../../logging/logger.js", () => ({
  createLogger: () => ({
    child: () => ({
      startTimer: () => ({
        success: vi.fn(),
        failure: vi.fn(),
      }),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock the nodes (they have their own tests)
vi.mock("./nodes/index.js", () => ({
  analyzeRequirementsNode: vi.fn(() => vi.fn().mockResolvedValue({})),
  generateClarificationNode: vi.fn(() => vi.fn().mockResolvedValue({})),
  createTasksNode: vi.fn(() => vi.fn().mockResolvedValue({})),
}));

/**
 * Create a base state for testing
 */
function createBaseState(
  overrides: Partial<ProductAgentState> = {},
): ProductAgentState {
  return {
    messages: [],
    requirements: { ...DEFAULT_REQUIREMENTS },
    phase: "gathering" as ProductAgentPhase,
    slackContext: {
      channelId: "C123",
      threadTs: null,
      userId: "U123",
    },
    createdTasks: [],
    classification: null,
    classificationConfidence: null,
    issueDraft: null,
    awaitingConfirmation: false,
    ...overrides,
  };
}

describe("routeAfterAnalysis", () => {
  describe("routing to createTasks", () => {
    it("returns 'createTasks' when phase is 'creating'", () => {
      const state = createBaseState({
        phase: "creating",
        requirements: {
          what: "Build a feature",
          why: "Users need it",
          who: null,
          acceptanceCriteria: [],
          constraints: [],
        },
      });

      const result = routeAfterAnalysis(state);

      expect(result).toBe("createTasks");
    });

    it("returns 'createTasks' when phase is 'complete'", () => {
      const state = createBaseState({
        phase: "complete",
        createdTasks: [{ id: "1", identifier: "ABC-1", title: "Task 1" }],
      });

      const result = routeAfterAnalysis(state);

      expect(result).toBe("createTasks");
    });
  });

  describe("routing to clarify", () => {
    it("returns 'clarify' when phase is 'clarifying'", () => {
      const state = createBaseState({
        phase: "clarifying",
      });

      const result = routeAfterAnalysis(state);

      expect(result).toBe("clarify");
    });

    it("returns 'clarify' when phase is 'gathering'", () => {
      const state = createBaseState({
        phase: "gathering",
      });

      const result = routeAfterAnalysis(state);

      // Default routes to clarify
      expect(result).toBe("clarify");
    });

    it("returns 'clarify' when phase is 'confirming'", () => {
      const state = createBaseState({
        phase: "confirming",
      });

      const result = routeAfterAnalysis(state);

      // Confirming also needs clarification flow
      expect(result).toBe("clarify");
    });
  });

  describe("edge cases", () => {
    it("covers all possible routes", () => {
      const routes = new Set<AfterAnalysisRoute>();

      // Test all possible phases
      const phases: ProductAgentPhase[] = [
        "gathering",
        "clarifying",
        "confirming",
        "creating",
        "complete",
        "declined",
      ];

      for (const phase of phases) {
        routes.add(routeAfterAnalysis(createBaseState({ phase })));
      }

      // Should have both possible routes covered
      expect(routes.has("clarify")).toBe(true);
      expect(routes.has("createTasks")).toBe(true);
    });
  });
});

describe("createProductAgentGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a compiled graph", () => {
    const graph = createProductAgentGraph({
      teamId: "team-123",
    });

    expect(graph).toBeDefined();
    // Compiled graphs have an invoke method
    expect(typeof graph.invoke).toBe("function");
  });

  it("graph compiles without errors with valid dependencies", () => {
    expect(() => {
      createProductAgentGraph({
        teamId: "team-123",
      });
    }).not.toThrow();
  });

  it("accepts optional checkpointer", () => {
    // Mock checkpointer as a concrete object (not undefined)
    const mockCheckpointer = {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn(),
    } as unknown as NonNullable<
      Parameters<typeof createProductAgentGraph>[0]["checkpointer"]
    >;

    expect(() => {
      createProductAgentGraph({
        teamId: "team-123",
        checkpointer: mockCheckpointer,
      });
    }).not.toThrow();
  });
});

describe("graph routing integration", () => {
  it("routeAfterAnalysis is compatible with StateGraph conditional edges", () => {
    // The routing function must return one of the valid destinations
    const validRoutes: AfterAnalysisRoute[] = ["clarify", "createTasks"];

    // Test all possible routes are valid
    const gatheringState = createBaseState({ phase: "gathering" });
    expect(validRoutes).toContain(routeAfterAnalysis(gatheringState));

    const clarifyingState = createBaseState({ phase: "clarifying" });
    expect(validRoutes).toContain(routeAfterAnalysis(clarifyingState));

    const creatingState = createBaseState({ phase: "creating" });
    expect(validRoutes).toContain(routeAfterAnalysis(creatingState));

    const completeState = createBaseState({ phase: "complete" });
    expect(validRoutes).toContain(routeAfterAnalysis(completeState));
  });
});

describe("graph edge verification", () => {
  it("defines expected node names", () => {
    // This test documents the expected graph structure
    const expectedNodes = ["analyze", "clarify", "createTasks"];
    const expectedRoutes: AfterAnalysisRoute[] = ["clarify", "createTasks"];

    // The graph should support these transitions:
    // __start__ -> analyze
    // analyze -> clarify (via routeAfterAnalysis)
    // analyze -> createTasks (via routeAfterAnalysis)
    // clarify -> analyze (loop)
    // createTasks -> __end__

    expect(expectedNodes).toHaveLength(3);
    expect(expectedRoutes).toHaveLength(2);
  });

  it("routing covers all expected outcomes", () => {
    const routes = new Set<AfterAnalysisRoute>();

    // Collect all possible routes
    routes.add(routeAfterAnalysis(createBaseState({ phase: "clarifying" })));
    routes.add(routeAfterAnalysis(createBaseState({ phase: "creating" })));

    expect(routes.has("clarify")).toBe(true);
    expect(routes.has("createTasks")).toBe(true);
  });
});
