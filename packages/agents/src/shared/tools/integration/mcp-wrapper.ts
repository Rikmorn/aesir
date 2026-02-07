/**
 * MCP Tool Wrapper
 *
 * Generic helper that wraps any MCP tool as a ToolDefinition for the agent loop.
 * Each integration tool file uses this to eliminate boilerplate -- tools become
 * ~10 lines of configuration instead of full execute() implementations.
 *
 * Error handling: McpError and generic errors are caught and returned as
 * isError:true so the LLM can reason about failures without crashing the loop.
 */

import type { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { callMcpTool } from "../../mcp/client.js";
import { McpError } from "../../mcp/errors.js";
import type { McpIntegration } from "../../mcp/types.js";

/**
 * Dependencies injected into MCP tool wrappers at construction time.
 * Passed through to callMcpTool for every invocation.
 */
export interface McpToolDeps {
  /** Agent identifier for MCP permission checks */
  agentId: string;
  /** Correlation ID for distributed tracing across MCP calls */
  correlationId: string;
  /** Task ID from conversation's associated task (v2.5 task primitive) */
  taskId?: string | undefined;
}

/**
 * Configuration for a single MCP tool wrapper.
 * Describes which MCP endpoint to call and how to present the tool to the LLM.
 */
export interface McpToolConfig {
  /** Which integration service hosts this tool */
  integration: McpIntegration;
  /** MCP tool name sent in the HTTP request (e.g., "get_issue") */
  toolName: string;
  /** Name exposed to the LLM (can differ from toolName, e.g., "linear_get_issue") */
  displayName: string;
  /** Description shown to the LLM explaining what the tool does and when to use it */
  description: string;
  /** Zod schema for validating LLM-provided input before sending to MCP */
  inputSchema: z.ZodType;
}

/**
 * Create a ToolDefinition that wraps an MCP tool call.
 *
 * Validates input with Zod, calls the MCP endpoint via HTTP, and converts
 * errors into isError:true results the LLM can reason about.
 *
 * @param config - Tool configuration (integration, name, schema)
 * @param deps - Runtime dependencies (agentId, correlationId)
 * @returns ToolDefinition compatible with the agent loop
 */
export function createMcpToolWrapper(
  config: McpToolConfig,
  deps: McpToolDeps,
): ToolDefinition {
  return {
    name: config.displayName,
    description: config.description,
    inputSchema: config.inputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = config.inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      try {
        const result = await callMcpTool({
          integration: config.integration,
          tool: config.toolName,
          params: parsed.data as Record<string, unknown>,
          agentId: deps.agentId,
          correlationId: deps.correlationId,
          taskId: deps.taskId,
        });
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        if (error instanceof McpError) {
          return {
            content: `${config.displayName} error: ${error.message}`,
            isError: true,
          };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: `${config.displayName} error: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
