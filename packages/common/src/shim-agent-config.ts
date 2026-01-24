/**
 * TEMPORARY AGENT CONFIG SHIM
 *
 * This is a temporary shim to maintain backward compatibility for packages
 * that import agent config from @aesir/common. The canonical source is now
 * @aesir/agents/config/agent-config.ts.
 *
 * This file will be removed after Plan 22.1-03 is complete and all imports
 * are updated to use @aesir/agents.
 *
 * @deprecated Import from @aesir/agents instead
 */

import { z } from "zod";

/**
 * Agent configuration schema
 * @deprecated Import from @aesir/agents instead
 */
export const AgentConfigSchema = z.object({
  name: z.string().min(1, "Agent name is required"),
  description: z.string().min(1, "Agent description is required"),
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
    .describe("LangGraph recursion limit (super-steps)"),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(300000)
    .describe("Maximum execution time in milliseconds (5 minutes default)"),
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
  enabledTools: z
    .array(z.string())
    .default(["generate_code"])
    .describe("List of enabled tool names"),
});

/**
 * @deprecated Import from @aesir/agents instead
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * @deprecated Import from @aesir/agents instead
 */
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;

/**
 * @deprecated Import from @aesir/agents instead
 */
export const devAgentConfig: AgentConfig = {
  name: "dev-agent",
  description: "Development agent for code generation tasks",
  maxIterations: 10,
  recursionLimit: 25,
  timeoutMs: 300000,
  model: "claude-3-5-sonnet-20241022",
  temperature: 0,
  enabledTools: ["generate_code"],
};

/**
 * @deprecated Import from @aesir/agents instead
 */
export function validateAgentConfig(config: AgentConfigInput): AgentConfig {
  return AgentConfigSchema.parse(config);
}

/**
 * @deprecated Import from @aesir/agents instead
 */
export function mergeWithDefaults(
  overrides: Partial<AgentConfigInput>,
): AgentConfig {
  return AgentConfigSchema.parse({
    ...devAgentConfig,
    ...overrides,
  });
}
