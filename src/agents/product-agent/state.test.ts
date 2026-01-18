/**
 * Product Agent State Tests
 *
 * Tests for state schema validation and reducer behavior.
 */

import { describe, it, expect } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import {
  RequirementsSchema,
  ProductAgentPhaseSchema,
  SlackContextSchema,
  CreatedTaskSchema,
  ProductAgentStateSchema,
  ProductAgentStateAnnotation,
  DEFAULT_REQUIREMENTS,
  hasMinimumRequirements,
  createProductAgentInitialState,
  type Requirements,
  type SlackContext,
  type CreatedTask,
} from "./state.js";

describe("RequirementsSchema", () => {
  it("validates complete requirements", () => {
    const requirements = {
      what: "Build a login form",
      why: "Users need to authenticate",
      who: "End users",
      acceptanceCriteria: ["Form validates email", "Shows errors"],
      constraints: ["Must use existing design system"],
    };

    const result = RequirementsSchema.parse(requirements);
    expect(result).toEqual(requirements);
  });

  it("accepts partial requirements with defaults", () => {
    const result = RequirementsSchema.parse({});

    expect(result).toEqual({
      what: null,
      why: null,
      who: null,
      acceptanceCriteria: [],
      constraints: [],
    });
  });

  it("accepts null values for optional fields", () => {
    const requirements = {
      what: "Build feature",
      why: null,
      who: null,
      acceptanceCriteria: [],
      constraints: [],
    };

    const result = RequirementsSchema.parse(requirements);
    expect(result.what).toBe("Build feature");
    expect(result.why).toBeNull();
  });
});

describe("ProductAgentPhaseSchema", () => {
  it("accepts valid phases", () => {
    const validPhases = ["gathering", "clarifying", "confirming", "creating", "complete"];

    for (const phase of validPhases) {
      const result = ProductAgentPhaseSchema.parse(phase);
      expect(result).toBe(phase);
    }
  });

  it("rejects invalid phases", () => {
    expect(() => ProductAgentPhaseSchema.parse("invalid")).toThrow();
  });
});

describe("SlackContextSchema", () => {
  it("validates complete slack context", () => {
    const context = {
      channelId: "C12345678",
      threadTs: "1234567890.123456",
      userId: "U12345678",
    };

    const result = SlackContextSchema.parse(context);
    expect(result).toEqual(context);
  });

  it("accepts null threadTs", () => {
    const context = {
      channelId: "C12345678",
      threadTs: null,
      userId: "U12345678",
    };

    const result = SlackContextSchema.parse(context);
    expect(result.threadTs).toBeNull();
  });

  it("defaults threadTs to null when missing", () => {
    const context = {
      channelId: "C12345678",
      userId: "U12345678",
    };

    const result = SlackContextSchema.parse(context);
    expect(result.threadTs).toBeNull();
  });
});

describe("CreatedTaskSchema", () => {
  it("validates created task", () => {
    const task = {
      id: "uuid-123",
      identifier: "ABC-123",
      title: "Build login form",
    };

    const result = CreatedTaskSchema.parse(task);
    expect(result).toEqual(task);
  });

  it("rejects missing fields", () => {
    expect(() => CreatedTaskSchema.parse({ id: "uuid" })).toThrow();
  });
});

describe("ProductAgentStateSchema", () => {
  it("validates complete state", () => {
    const state = {
      messages: [],
      requirements: DEFAULT_REQUIREMENTS,
      phase: "gathering",
      slackContext: {
        channelId: "C123",
        threadTs: null,
        userId: "U123",
      },
      createdTasks: [],
    };

    const result = ProductAgentStateSchema.parse(state);
    expect(result.phase).toBe("gathering");
  });

  it("rejects invalid phase", () => {
    const state = {
      messages: [],
      requirements: DEFAULT_REQUIREMENTS,
      phase: "invalid",
      slackContext: null,
      createdTasks: [],
    };

    expect(() => ProductAgentStateSchema.parse(state)).toThrow();
  });
});

describe("ProductAgentStateAnnotation", () => {
  describe("spec structure", () => {
    it("has the correct state channels", () => {
      const spec = ProductAgentStateAnnotation.spec;

      expect(spec).toHaveProperty("messages");
      expect(spec).toHaveProperty("requirements");
      expect(spec).toHaveProperty("phase");
      expect(spec).toHaveProperty("slackContext");
      expect(spec).toHaveProperty("createdTasks");
    });

    it("marks channels as LangGraph channels", () => {
      const spec = ProductAgentStateAnnotation.spec;

      expect(spec.messages.lg_is_channel).toBe(true);
      expect(spec.requirements.lg_is_channel).toBe(true);
      expect(spec.phase.lg_is_channel).toBe(true);
      expect(spec.slackContext.lg_is_channel).toBe(true);
      expect(spec.createdTasks.lg_is_channel).toBe(true);
    });
  });

  describe("messages channel", () => {
    it("appends new messages to existing", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const messagesChannel = spec.messages as unknown as {
        operator: (a: unknown[], b: unknown[]) => unknown[];
        initialValueFactory: () => unknown[];
      };

      const current = [new HumanMessage("Hello")];
      const incoming = [new AIMessage("Hi there")];

      const result = messagesChannel.operator(current, incoming);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect(result[1]).toBeInstanceOf(AIMessage);
    });

    it("starts with empty array", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const messagesChannel = spec.messages as unknown as {
        initialValueFactory: () => unknown[];
      };

      expect(messagesChannel.initialValueFactory()).toEqual([]);
    });
  });

  describe("requirements channel", () => {
    it("merges partial updates", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const requirementsChannel = spec.requirements as unknown as {
        operator: (a: Requirements, b: Partial<Requirements>) => Requirements;
        initialValueFactory: () => Requirements;
      };

      const current: Requirements = {
        what: "Build form",
        why: null,
        who: null,
        acceptanceCriteria: [],
        constraints: [],
      };
      const incoming = { why: "User needs it" };

      const result = requirementsChannel.operator(current, incoming);

      expect(result.what).toBe("Build form");
      expect(result.why).toBe("User needs it");
    });

    it("preserves fields not in update", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const requirementsChannel = spec.requirements as unknown as {
        operator: (a: Requirements, b: Partial<Requirements>) => Requirements;
      };

      const current: Requirements = {
        what: "Build form",
        why: "Important",
        who: "Admin",
        acceptanceCriteria: ["Works"],
        constraints: ["Fast"],
      };
      const incoming = { what: "Build page" };

      const result = requirementsChannel.operator(current, incoming);

      expect(result.what).toBe("Build page");
      expect(result.why).toBe("Important");
      expect(result.who).toBe("Admin");
      expect(result.acceptanceCriteria).toEqual(["Works"]);
      expect(result.constraints).toEqual(["Fast"]);
    });

    it("allows setting fields to null", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const requirementsChannel = spec.requirements as unknown as {
        operator: (a: Requirements, b: Partial<Requirements>) => Requirements;
      };

      const current: Requirements = {
        what: "Build form",
        why: "Important",
        who: "Admin",
        acceptanceCriteria: [],
        constraints: [],
      };
      const incoming = { why: null };

      const result = requirementsChannel.operator(current, incoming);

      expect(result.why).toBeNull();
    });

    it("starts with default requirements", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const requirementsChannel = spec.requirements as unknown as {
        initialValueFactory: () => Requirements;
      };

      expect(requirementsChannel.initialValueFactory()).toEqual(DEFAULT_REQUIREMENTS);
    });
  });

  describe("phase channel", () => {
    it("replaces phase", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const phaseChannel = spec.phase as unknown as {
        operator: (a: string, b: string) => string;
      };

      const result = phaseChannel.operator("gathering", "clarifying");

      expect(result).toBe("clarifying");
    });

    it("starts with gathering phase", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const phaseChannel = spec.phase as unknown as {
        initialValueFactory: () => string;
      };

      expect(phaseChannel.initialValueFactory()).toBe("gathering");
    });
  });

  describe("slackContext channel", () => {
    it("replaces context", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const contextChannel = spec.slackContext as unknown as {
        operator: (a: SlackContext | null, b: SlackContext | null) => SlackContext | null;
      };

      const current: SlackContext = {
        channelId: "C1",
        threadTs: null,
        userId: "U1",
      };
      const incoming: SlackContext = {
        channelId: "C2",
        threadTs: "123",
        userId: "U2",
      };

      const result = contextChannel.operator(current, incoming);

      expect(result).toEqual(incoming);
    });

    it("starts with null", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const contextChannel = spec.slackContext as unknown as {
        initialValueFactory: () => SlackContext | null;
      };

      expect(contextChannel.initialValueFactory()).toBeNull();
    });
  });

  describe("createdTasks channel", () => {
    it("appends new tasks", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const tasksChannel = spec.createdTasks as unknown as {
        operator: (a: CreatedTask[], b: CreatedTask[]) => CreatedTask[];
      };

      const current = [{ id: "1", identifier: "ABC-1", title: "Task 1" }];
      const incoming = [{ id: "2", identifier: "ABC-2", title: "Task 2" }];

      const result = tasksChannel.operator(current, incoming);

      expect(result).toHaveLength(2);
      expect(result[1].identifier).toBe("ABC-2");
    });

    it("starts with empty array", () => {
      const spec = ProductAgentStateAnnotation.spec;
      const tasksChannel = spec.createdTasks as unknown as {
        initialValueFactory: () => CreatedTask[];
      };

      expect(tasksChannel.initialValueFactory()).toEqual([]);
    });
  });
});

describe("hasMinimumRequirements", () => {
  it("returns true when what and why are set", () => {
    const requirements: Requirements = {
      what: "Build form",
      why: "User needs it",
      who: null,
      acceptanceCriteria: [],
      constraints: [],
    };

    expect(hasMinimumRequirements(requirements)).toBe(true);
  });

  it("returns false when what is null", () => {
    const requirements: Requirements = {
      what: null,
      why: "User needs it",
      who: null,
      acceptanceCriteria: [],
      constraints: [],
    };

    expect(hasMinimumRequirements(requirements)).toBe(false);
  });

  it("returns false when why is null", () => {
    const requirements: Requirements = {
      what: "Build form",
      why: null,
      who: null,
      acceptanceCriteria: [],
      constraints: [],
    };

    expect(hasMinimumRequirements(requirements)).toBe(false);
  });

  it("returns false when both are null", () => {
    expect(hasMinimumRequirements(DEFAULT_REQUIREMENTS)).toBe(false);
  });
});

describe("createProductAgentInitialState", () => {
  it("creates state with slack context", () => {
    const slackContext: SlackContext = {
      channelId: "C12345678",
      threadTs: "1234567890.123456",
      userId: "U12345678",
    };

    const state = createProductAgentInitialState(slackContext);

    expect(state.messages).toEqual([]);
    expect(state.requirements).toEqual(DEFAULT_REQUIREMENTS);
    expect(state.phase).toBe("gathering");
    expect(state.slackContext).toEqual(slackContext);
    expect(state.createdTasks).toEqual([]);
  });
});
