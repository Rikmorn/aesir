/**
 * Spawn Agent Tool
 *
 * Coordination tool that creates a nested runAgentLoop() invocation with
 * restricted tools and a shared TokenBudget. The orchestrator uses this to
 * delegate focused tasks to sub-agents (researcher, coder, tester).
 *
 * Each sub-agent gets its own tool set (codebase-only) and runs within the
 * same token budget as the orchestrator, ensuring total cost control.
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import { z } from "zod";
import { runAgentLoop } from "../../agent-loop/run-agent-loop.js";
import type { TokenBudget } from "../../agent-loop/token-budget.js";
import type {
  AgentLoopOptions,
  ToolDefinition,
  ToolResult,
} from "../../agent-loop/types.js";
import type { TraceRecorderCallbacks } from "../../db/trace-recorder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for a sub-agent type.
 * Defines what tools, prompt, and limits a spawned agent receives.
 */
export interface AgentTypeConfig {
  /** System prompt defining the sub-agent's role and behavior */
  systemPrompt: string;
  /** Tools available to this sub-agent type */
  tools: ToolDefinition[];
  /** Maximum loop iterations for this sub-agent */
  maxIterations: number;
  /** Optional model override (defaults to loop's default) */
  model?: string;
}

/**
 * Dependencies for the spawn_agent tool factory.
 * Injected at toolkit construction time.
 */
export interface SpawnAgentDeps {
  /** Map of agent type names to their configurations */
  agentTypes: Record<string, AgentTypeConfig>;
  /** Shared mutable token budget across orchestrator and all sub-agents */
  tokenBudget: TokenBudget;
  /** Optional abort signal for clean cancellation */
  abortSignal?: AbortSignal;
  /** Trace recorder for observability of spawns and completions */
  traceRecorder: TraceRecorderCallbacks;
  /** Logger for spawn events */
  logger: PinoLogger;
}

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const spawnAgentInputSchema = z.object({
  agentType: z
    .enum(["researcher", "coder", "tester"])
    .describe("Type of sub-agent to spawn"),
  task: z.string().describe("Task description for the sub-agent to execute"),
  context: z
    .string()
    .optional()
    .describe("Additional context to prepend to the task"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the spawn_agent tool.
 *
 * Spawns a sub-agent by calling runAgentLoop() recursively with the sub-agent's
 * tool set and a shared TokenBudget. The orchestrator's token budget is shared
 * by reference, so tokens consumed by the sub-agent are visible to the parent.
 *
 * @param deps - Dependencies including agent type configs, token budget, and trace recorder
 * @returns ToolDefinition for the spawn_agent tool
 */
export function createSpawnAgentTool(deps: SpawnAgentDeps): ToolDefinition {
  return {
    name: "spawn_agent",
    description:
      "Spawn a focused sub-agent to perform a specific task. Available agent types: " +
      "'researcher' (explores codebase, reads files, searches code), " +
      "'coder' (implements changes, writes files, runs builds), " +
      "'tester' (runs tests, diagnoses failures, reads code). " +
      "Each sub-agent shares the token budget with the orchestrator.",
    inputSchema: spawnAgentInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = spawnAgentInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { agentType, task, context } = parsed.data;

      const config = deps.agentTypes[agentType];
      if (!config) {
        return {
          content: `Unknown agent type: ${agentType}`,
          isError: true,
        };
      }

      const childInstanceId = createId.agentInstance();

      deps.traceRecorder.onAgentSpawn(childInstanceId, agentType, {
        task,
        context,
      });

      deps.logger.info(
        { agentType, childInstanceId, task: task.slice(0, 100) },
        "Spawning sub-agent",
      );

      try {
        // Build options with mutable-then-conditional-set for exactOptionalPropertyTypes
        const loopOptions: AgentLoopOptions = {
          systemPrompt: config.systemPrompt,
          tools: config.tools,
          initialMessage: task,
          maxIterations: config.maxIterations,
          tokenBudget: deps.tokenBudget,
          logger: deps.logger.child({
            agentType,
            agentInstanceId: childInstanceId,
          }),
        };
        if (context !== undefined) {
          loopOptions.context = context;
        }
        if (config.model !== undefined) {
          loopOptions.model = config.model;
        }
        if (deps.abortSignal !== undefined) {
          loopOptions.abortSignal = deps.abortSignal;
        }

        const result = await runAgentLoop(loopOptions);

        deps.traceRecorder.onAgentComplete({
          agentType,
          childInstanceId,
          status: result.status,
          toolCallCount: result.toolCallCount,
          tokenCount: result.tokenCount,
        });

        deps.logger.info(
          {
            agentType,
            childInstanceId,
            status: result.status,
            toolCallCount: result.toolCallCount,
          },
          "Sub-agent completed",
        );

        if (result.status === "error") {
          return {
            content: `Sub-agent error: ${result.output}`,
            isError: true,
          };
        }

        return { content: result.output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Sub-agent ${agentType} failed: ${message}`,
          isError: true,
        };
      }
    },
  };
}
