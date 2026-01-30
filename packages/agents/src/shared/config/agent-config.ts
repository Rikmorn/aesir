/**
 * Agent Configuration Schema
 *
 * Defines the configuration structure for agents using Zod for validation.
 * This satisfies CORE-05: Agent configuration defined in code, not UI.
 *
 * Design decisions:
 * - Zod schema enables runtime validation and TypeScript type inference
 * - Default values provide sensible starting configuration
 * - Limits (iterations, recursion, timeout) provide safety guardrails
 * - Configuration is fully defined in code (no database/UI required)
 */

import { z } from "zod";

/**
 * Agent configuration schema
 *
 * Defines all configurable aspects of an agent:
 * - Identity: name and description
 * - Execution limits: iterations, recursion, timeout
 * - LLM settings: model and temperature
 * - Tools: which tools are enabled
 */
export const AgentConfigSchema = z.object({
  // Agent identity
  name: z.string().min(1, "Agent name is required"),
  description: z.string().min(1, "Agent description is required"),

  // Execution limits (safety guardrails)
  maxIterations: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe("Maximum loop iterations before forced termination"),
  recursionLimit: z
    .number()
    .int()
    .positive()
    .default(25)
    .describe("Agent loop iteration limit"),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(300000)
    .describe("Maximum execution time in milliseconds (5 minutes default)"),

  // LLM settings
  model: z
    .string()
    .default("claude-3-5-sonnet-20241022")
    .describe("LLM model identifier"),
  temperature: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe("LLM temperature (0 = deterministic, 1 = creative)"),

  // Tools configuration
  enabledTools: z
    .array(z.string())
    .default(["generate_code"])
    .describe("List of enabled tool names"),
});

/**
 * Type for validated agent configuration
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Type for partial agent configuration (for overrides)
 */
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;

/**
 * Default development agent configuration
 *
 * This is the baseline configuration for the dev-agent.
 * All values are explicitly set (not relying on defaults) for clarity.
 */
export const devAgentConfig: AgentConfig = {
  name: "dev-agent",
  description: "Development agent for code generation tasks",
  maxIterations: 10,
  recursionLimit: 25,
  timeoutMs: 300000, // 5 minutes
  model: "claude-3-5-sonnet-20241022",
  temperature: 0,
  enabledTools: ["generate_code"],
};

/**
 * Validate agent configuration
 *
 * @param config - Configuration to validate (can be partial with defaults)
 * @returns Validated configuration with all defaults applied
 * @throws ZodError if validation fails
 */
export function validateAgentConfig(config: AgentConfigInput): AgentConfig {
  return AgentConfigSchema.parse(config);
}

/**
 * Merge configuration with defaults
 *
 * @param overrides - Partial configuration to merge with defaults
 * @returns Complete configuration with overrides applied
 */
export function mergeWithDefaults(
  overrides: Partial<AgentConfigInput>,
): AgentConfig {
  return AgentConfigSchema.parse({
    ...devAgentConfig,
    ...overrides,
  });
}
