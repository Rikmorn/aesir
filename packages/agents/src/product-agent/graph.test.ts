/**
 * Product Agent Graph Tests
 *
 * Tests for the StateGraph workflow definition and routing logic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AfterAnalysisRoute,
  type AfterClassifyRoute,
  type AfterConfirmRoute,
  createProductAgentGraph,
  routeAfterAnalysis,
  routeAfterClassify,
  routeAfterConfirm,
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
  classifyNode: vi.fn(() => vi.fn().mockResolvedValue({})),
  analyzeRequirementsNode: vi.fn(() => vi.fn().mockResolvedValue({})),
  generateClarificationNode: vi.fn(() => vi.fn().mockResolvedValue({})),
  confirmNode: vi.fn(() => vi.fn().mockResolvedValue({})),
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

describe("routeAfterClassify", () => {
  describe("routing to end (declined)", () => {
    it("returns 'end' when phase is 'declined'", () => {
      const state = createBaseState({
        phase: "declined",
        classification: "off_topic",
        classificationConfidence: "high",
      });

      const result = routeAfterClassify(state);

      expect(result).toBe("end");
    });
  });

  describe("routing to clarify (unclear)", () => {
    it("returns 'clarify' when phase is 'clarifying'", () => {
      const state = createBaseState({
        phase: "clarifying",
        classification: "unclear",
        classificationConfidence: "medium",
      });

      const result = routeAfterClassify(state);

      expect(result).toBe("clarify");
    });
  });

  describe("routing to analyze (actionable)", () => {
    it("returns 'analyze' when phase is 'gathering'", () => {
      const state = createBaseState({
        phase: "gathering",
        classification: "feature_request",
        classificationConfidence: "high",
      });

      const result = routeAfterClassify(state);

      expect(result).toBe("analyze");
    });

    it("returns 'analyze' for other phases by default", () => {
      const state = createBaseState({
        phase: "creating",
      });

      const result = routeAfterClassify(state);

      expect(result).toBe("analyze");
    });
  });

  describe("edge cases", () => {
    it("covers all possible routes", () => {
      const routes = new Set<AfterClassifyRoute>();

      // Test phases that map to each route
      routes.add(routeAfterClassify(createBaseState({ phase: "declined" })));
      routes.add(routeAfterClassify(createBaseState({ phase: "clarifying" })));
      routes.add(routeAfterClassify(createBaseState({ phase: "gathering" })));

      expect(routes.has("end")).toBe(true);
      expect(routes.has("clarify")).toBe(true);
      expect(routes.has("analyze")).toBe(true);
    });
  });
});

describe("routeAfterAnalysis", () => {
  describe("routing to confirm", () => {
    it("returns 'confirm' when phase is 'creating'", () => {
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

      expect(result).toBe("confirm");
    });

    it("returns 'confirm' when phase is 'confirming'", () => {
      const state = createBaseState({
        phase: "confirming",
        issueDraft: {
          title: "Test Issue",
          description: "Description",
          acceptanceCriteria: [],
          priority: "medium",
          labels: [],
          slackThreadUrl: null,
        },
      });

      const result = routeAfterAnalysis(state);

      expect(result).toBe("confirm");
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
  });

  describe("edge cases", () => {
    it("covers all possible routes", () => {
      const routes = new Set<AfterAnalysisRoute>();

      // Test phases that map to each route
      routes.add(routeAfterAnalysis(createBaseState({ phase: "clarifying" })));
      routes.add(routeAfterAnalysis(createBaseState({ phase: "creating" })));

      expect(routes.has("clarify")).toBe(true);
      expect(routes.has("confirm")).toBe(true);
    });
  });
});

describe("routeAfterConfirm", () => {
  describe("routing to createTasks (user confirmed)", () => {
    it("returns 'createTasks' when phase is 'creating'", () => {
      const state = createBaseState({
        phase: "creating",
        issueDraft: {
          title: "Test Issue",
          description: "Description",
          acceptanceCriteria: [],
          priority: "medium",
          labels: [],
          slackThreadUrl: null,
        },
        awaitingConfirmation: false, // User confirmed
      });

      const result = routeAfterConfirm(state);

      expect(result).toBe("createTasks");
    });
  });

  describe("routing to clarify (user gave feedback)", () => {
    it("returns 'clarify' when phase is 'clarifying'", () => {
      const state = createBaseState({
        phase: "clarifying",
        issueDraft: {
          title: "Test Issue",
          description: "Description",
          acceptanceCriteria: [],
          priority: "medium",
          labels: [],
          slackThreadUrl: null,
        },
        awaitingConfirmation: false,
      });

      const result = routeAfterConfirm(state);

      expect(result).toBe("clarify");
    });

    it("returns 'clarify' when phase is 'gathering'", () => {
      const state = createBaseState({
        phase: "gathering",
      });

      const result = routeAfterConfirm(state);

      // Default routes to clarify
      expect(result).toBe("clarify");
    });
  });

  describe("edge cases", () => {
    it("covers all possible routes", () => {
      const routes = new Set<AfterConfirmRoute>();

      // Test phases that map to each route
      routes.add(routeAfterConfirm(createBaseState({ phase: "creating" })));
      routes.add(routeAfterConfirm(createBaseState({ phase: "clarifying" })));

      expect(routes.has("createTasks")).toBe(true);
      expect(routes.has("clarify")).toBe(true);
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
  describe("routeAfterClassify", () => {
    it("is compatible with StateGraph conditional edges", () => {
      const validRoutes: AfterClassifyRoute[] = ["analyze", "clarify", "end"];

      // Test all possible routes are valid
      const declinedState = createBaseState({ phase: "declined" });
      expect(validRoutes).toContain(routeAfterClassify(declinedState));

      const clarifyingState = createBaseState({ phase: "clarifying" });
      expect(validRoutes).toContain(routeAfterClassify(clarifyingState));

      const gatheringState = createBaseState({ phase: "gathering" });
      expect(validRoutes).toContain(routeAfterClassify(gatheringState));
    });
  });

  describe("routeAfterAnalysis", () => {
    it("is compatible with StateGraph conditional edges", () => {
      const validRoutes: AfterAnalysisRoute[] = ["clarify", "confirm"];

      // Test all possible routes are valid
      const gatheringState = createBaseState({ phase: "gathering" });
      expect(validRoutes).toContain(routeAfterAnalysis(gatheringState));

      const clarifyingState = createBaseState({ phase: "clarifying" });
      expect(validRoutes).toContain(routeAfterAnalysis(clarifyingState));

      const creatingState = createBaseState({ phase: "creating" });
      expect(validRoutes).toContain(routeAfterAnalysis(creatingState));

      const confirmingState = createBaseState({ phase: "confirming" });
      expect(validRoutes).toContain(routeAfterAnalysis(confirmingState));
    });
  });

  describe("routeAfterConfirm", () => {
    it("is compatible with StateGraph conditional edges", () => {
      const validRoutes: AfterConfirmRoute[] = ["createTasks", "clarify"];

      // Test all possible routes are valid
      const creatingState = createBaseState({ phase: "creating" });
      expect(validRoutes).toContain(routeAfterConfirm(creatingState));

      const clarifyingState = createBaseState({ phase: "clarifying" });
      expect(validRoutes).toContain(routeAfterConfirm(clarifyingState));

      const gatheringState = createBaseState({ phase: "gathering" });
      expect(validRoutes).toContain(routeAfterConfirm(gatheringState));
    });
  });
});

describe("graph edge verification", () => {
  it("defines expected node names", () => {
    // This test documents the expected graph structure
    const expectedNodes = [
      "classify",
      "analyze",
      "clarify",
      "confirm",
      "createTasks",
    ];
    const expectedClassifyRoutes: AfterClassifyRoute[] = [
      "analyze",
      "clarify",
      "end",
    ];
    const expectedAnalysisRoutes: AfterAnalysisRoute[] = ["clarify", "confirm"];
    const expectedConfirmRoutes: AfterConfirmRoute[] = [
      "createTasks",
      "clarify",
    ];

    // The graph should support these transitions:
    // __start__ -> classify
    // classify -> analyze (via routeAfterClassify)
    // classify -> clarify (via routeAfterClassify, unclear)
    // classify -> __end__ (via routeAfterClassify, declined)
    // analyze -> clarify (via routeAfterAnalysis)
    // analyze -> confirm (via routeAfterAnalysis)
    // clarify -> __end__
    // confirm -> createTasks (via routeAfterConfirm)
    // confirm -> clarify (via routeAfterConfirm)
    // createTasks -> __end__

    expect(expectedNodes).toHaveLength(5);
    expect(expectedClassifyRoutes).toHaveLength(3);
    expect(expectedAnalysisRoutes).toHaveLength(2);
    expect(expectedConfirmRoutes).toHaveLength(2);
  });

  it("routing covers all expected outcomes for classify", () => {
    const routes = new Set<AfterClassifyRoute>();

    routes.add(routeAfterClassify(createBaseState({ phase: "declined" })));
    routes.add(routeAfterClassify(createBaseState({ phase: "clarifying" })));
    routes.add(routeAfterClassify(createBaseState({ phase: "gathering" })));

    expect(routes.has("end")).toBe(true);
    expect(routes.has("clarify")).toBe(true);
    expect(routes.has("analyze")).toBe(true);
  });

  it("routing covers all expected outcomes for analysis", () => {
    const routes = new Set<AfterAnalysisRoute>();

    routes.add(routeAfterAnalysis(createBaseState({ phase: "clarifying" })));
    routes.add(routeAfterAnalysis(createBaseState({ phase: "creating" })));

    expect(routes.has("clarify")).toBe(true);
    expect(routes.has("confirm")).toBe(true);
  });

  it("routing covers all expected outcomes for confirm", () => {
    const routes = new Set<AfterConfirmRoute>();

    routes.add(routeAfterConfirm(createBaseState({ phase: "creating" })));
    routes.add(routeAfterConfirm(createBaseState({ phase: "clarifying" })));

    expect(routes.has("createTasks")).toBe(true);
    expect(routes.has("clarify")).toBe(true);
  });
});
