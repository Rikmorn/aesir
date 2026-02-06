/**
 * Spawn Agent Tool
 *
 * Tool factory that creates the spawn_agent tool for delegating work
 * to sub-agents (researcher, coder, tester). Sub-agents run as nested
 * in-process agent loops with shared token budgets and sandbox access.
 *
 * The tool resolves sub-agent definitions via the parent's subAgents
 * mapping, constructs a ToolContext with shared sandbox but no spawnDeps
 * (preventing recursive spawning unless explicitly allowed by depth),
 * and invokes runAgentLoop() synchronously from the parent's perspective.
 *
 * Dependencies are injected via ToolContext.spawnDeps, populated by the
 * worker loop when the agent has coordination:spawn_agent in its tool list.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import { runAgentLoop } from "../../agent-loop/run-agent-loop.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const SpawnAgentInputSchema = z.object({
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
 * Spawns a focused sub-agent to perform a specific task. The sub-agent runs
 * as a nested runAgentLoop() call within the parent's worker loop execution,
 * sharing the token budget and sandbox access. Sub-agent lifecycle events
 * (agent.started, agent.completed) are recorded to the parent's event log
 * with parent_instance_id for observability.
 *
 * @param ctx - ToolContext with optional spawnDeps (populated by worker loop)
 * @returns ToolDefinition for the spawn_agent tool
 */
export function createSpawnAgentTool(ctx: ToolContext): ToolDefinition {
  return {
    name: "spawn_agent",
    description:
      "Spawn a focused sub-agent to perform a specific task. Available agent types: " +
      "'researcher' (explores codebase, reads files, searches code), " +
      "'coder' (implements changes, writes files, runs builds), " +
      "'tester' (runs tests, diagnoses failures, reads code). " +
      "Each sub-agent shares the token budget with the orchestrator.",
    inputSchema: SpawnAgentInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = SpawnAgentInputSchema.parse(input);
      const deps = ctx.spawnDeps;

      // Guard: spawnDeps must be available
      if (!deps) {
        return {
          content: "spawn_agent is not available in this context.",
          isError: true,
        };
      }

      // Guard: spawn depth limit
      if (deps.currentDepth >= deps.maxSpawnDepth) {
        return {
          content: `Maximum spawn depth (${deps.maxSpawnDepth}) exceeded.`,
          isError: true,
        };
      }

      // 1. Resolve agentType to agent definition ID via parent's subAgents mapping
      const agentId = deps.parentDefinition.subAgents?.[parsed.agentType];
      if (!agentId) {
        const available = Object.keys(
          deps.parentDefinition.subAgents ?? {},
        ).join(", ");
        return {
          content: `Unknown agent type: ${parsed.agentType}. Available: ${available}`,
          isError: true,
        };
      }

      // 2. Load sub-agent definition
      const definition = await deps.agentRegistry.get(agentId);
      if (!definition) {
        return {
          content: `Agent definition not found: ${agentId}`,
          isError: true,
        };
      }

      // 3. Build sub-agent ToolContext (shared sandbox, no spawnDeps by default)
      const subToolContext: ToolContext = {
        agentId: definition.id,
        correlationId: ctx.correlationId,
        logger: ctx.logger.child({ subAgent: definition.id }),
        containerManager: ctx.containerManager,
        sandboxId: ctx.sandboxId,
        taskId: ctx.taskId,
      };

      // Future-proofing: if sub-agent itself has coordination:spawn_agent
      // AND depth allows, provide spawnDeps with incremented depth
      if (
        definition.tools.includes("coordination:spawn_agent") &&
        deps.currentDepth + 1 < deps.maxSpawnDepth
      ) {
        subToolContext.spawnDeps = {
          ...deps,
          parentDefinition: definition,
          parentInstanceId: `inst_${nanoid(12)}`,
          currentDepth: deps.currentDepth + 1,
        };
      }

      // 4. Resolve sub-agent tools
      const resolvedTools = deps.toolRegistry.resolve(
        definition.tools,
        subToolContext,
      );

      // 5. Build initial message
      const initialMessage = parsed.context
        ? `${parsed.context}\n\n${parsed.task}`
        : parsed.task;

      // 6. Generate sub-agent instance ID and record start event
      const subInstanceId = `inst_${nanoid(12)}`;
      const startTime = Date.now();

      deps.eventLog.append({
        conversationId: ctx.correlationId,
        agentDefinitionId: definition.id,
        agentDefinitionVersion: definition.version,
        agentInstanceId: subInstanceId,
        parentInstanceId: deps.parentInstanceId,
        type: "agent.started",
        payload: {
          agentType: parsed.agentType,
          task: parsed.task.slice(0, 200),
          spawnDepth: deps.currentDepth + 1,
        },
      });

      // 7. Run sub-agent loop
      const result = await runAgentLoop({
        systemPrompt: definition.systemPrompt,
        tools: resolvedTools,
        initialMessage,
        model: definition.model,
        maxIterations: definition.maxIterations,
        tokenBudget: deps.tokenBudget,
        logger: subToolContext.logger,
        ...(deps.abortSignal && { abortSignal: deps.abortSignal }),
      });

      const durationMs = Date.now() - startTime;

      // 8. Record completed event
      deps.eventLog.append({
        conversationId: ctx.correlationId,
        agentDefinitionId: definition.id,
        agentDefinitionVersion: definition.version,
        agentInstanceId: subInstanceId,
        parentInstanceId: deps.parentInstanceId,
        type: "agent.completed",
        payload: {
          status: result.status,
          tokenCount: result.tokenCount,
          toolCallCount: result.toolCallCount,
          outputPreview: result.output.slice(0, 300),
        },
        tokenCountInput: result.tokenCount.input,
        tokenCountOutput: result.tokenCount.output,
        durationMs,
      });

      // 9. Return result to parent
      if (result.status === "error" || result.status === "aborted") {
        return {
          content: `Sub-agent ${parsed.agentType} failed (${result.status}): ${result.output}`,
          isError: true,
        };
      }

      if (
        result.status === "max_iterations" ||
        result.status === "max_tokens"
      ) {
        return {
          content: `Sub-agent ${parsed.agentType} stopped (${result.status}): ${result.output}`,
          isError: false,
        };
      }

      // Completed successfully
      return {
        content: result.output,
        isError: false,
      };
    },
  };
}
