/**
 * MCP (Model Context Protocol) Zod Schemas
 *
 * Shared Zod schemas for validating MCP tool inputs and outputs.
 * Can be converted to JSON Schema for MCP tool definitions.
 */

import { z } from "zod";

/**
 * Base schema for MCP tool meta response
 */
export const MCPToolMetaSchema = z.object({
  duration_ms: z.number(),
  correlation_id: z.string(),
  rate_limit_remaining: z.number().optional(),
});

/**
 * Schema for text content block
 */
export const MCPTextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/**
 * Helper to create a tool result schema with typed structured content
 *
 * @example
 * const IssueResultSchema = createToolResultSchema(z.object({
 *   id: z.string(),
 *   title: z.string(),
 * }));
 */
export function createToolResultSchema<T extends z.ZodTypeAny>(
  structuredSchema: T,
) {
  return z.object({
    content: z.array(MCPTextContentSchema),
    structuredContent: structuredSchema.optional(),
    meta: MCPToolMetaSchema,
    isError: z.boolean().optional(),
  });
}
