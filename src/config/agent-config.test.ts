/**
 * Agent Configuration Tests
 *
 * Tests for agent configuration schema validation and utilities.
 */

import { describe, it, expect } from "vitest";
import {
  AgentConfigSchema,
  devAgentConfig,
  validateAgentConfig,
  mergeWithDefaults,
  type AgentConfig,
} from "./agent-config.js";

describe("AgentConfigSchema", () => {
  describe("valid configurations", () => {
    it("should validate the default dev agent config", () => {
      const result = AgentConfigSchema.safeParse(devAgentConfig);
      expect(result.success).toBe(true);
    });

    it("should validate a minimal configuration with required fields only", () => {
      const minimalConfig = {
        name: "test-agent",
        description: "A test agent",
      };

      const result = AgentConfigSchema.safeParse(minimalConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        // Defaults should be applied
        expect(result.data.maxIterations).toBe(10);
        expect(result.data.recursionLimit).toBe(25);
        expect(result.data.timeoutMs).toBe(300000);
        expect(result.data.model).toBe("claude-3-5-sonnet-20241022");
        expect(result.data.temperature).toBe(0);
        expect(result.data.enabledTools).toEqual(["generate_code"]);
      }
    });

    it("should validate custom configuration values", () => {
      const customConfig: AgentConfig = {
        name: "custom-agent",
        description: "A custom agent with all options",
        maxIterations: 5,
        recursionLimit: 15,
        timeoutMs: 60000,
        model: "claude-3-opus-20240229",
        temperature: 0.5,
        enabledTools: ["generate_code", "file_ops"],
      };

      const result = AgentConfigSchema.safeParse(customConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(customConfig);
      }
    });
  });

  describe("invalid configurations", () => {
    it("should reject empty name", () => {
      const config = {
        name: "",
        description: "Valid description",
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject empty description", () => {
      const config = {
        name: "valid-name",
        description: "",
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject negative maxIterations", () => {
      const config = {
        name: "test-agent",
        description: "Test",
        maxIterations: -1,
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject temperature above 1", () => {
      const config = {
        name: "test-agent",
        description: "Test",
        temperature: 1.5,
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject temperature below 0", () => {
      const config = {
        name: "test-agent",
        description: "Test",
        temperature: -0.1,
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});

describe("validateAgentConfig", () => {
  it("should return validated config with defaults applied", () => {
    const result = validateAgentConfig({
      name: "test-agent",
      description: "Test agent",
    });

    expect(result.name).toBe("test-agent");
    expect(result.maxIterations).toBe(10);
    expect(result.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("should throw ZodError for invalid config", () => {
    expect(() =>
      validateAgentConfig({
        name: "",
        description: "",
      })
    ).toThrow();
  });
});

describe("mergeWithDefaults", () => {
  it("should merge overrides with default config", () => {
    const result = mergeWithDefaults({
      maxIterations: 20,
      temperature: 0.7,
    });

    expect(result.name).toBe("dev-agent");
    expect(result.maxIterations).toBe(20);
    expect(result.temperature).toBe(0.7);
    expect(result.recursionLimit).toBe(25); // unchanged
  });

  it("should allow overriding name and description", () => {
    const result = mergeWithDefaults({
      name: "custom-agent",
      description: "Custom description",
    });

    expect(result.name).toBe("custom-agent");
    expect(result.description).toBe("Custom description");
  });
});

describe("devAgentConfig", () => {
  it("should have all expected default values", () => {
    expect(devAgentConfig.name).toBe("dev-agent");
    expect(devAgentConfig.description).toBe(
      "Development agent for code generation tasks"
    );
    expect(devAgentConfig.maxIterations).toBe(10);
    expect(devAgentConfig.recursionLimit).toBe(25);
    expect(devAgentConfig.timeoutMs).toBe(300000);
    expect(devAgentConfig.model).toBe("claude-3-5-sonnet-20241022");
    expect(devAgentConfig.temperature).toBe(0);
    expect(devAgentConfig.enabledTools).toEqual(["generate_code"]);
  });
});
