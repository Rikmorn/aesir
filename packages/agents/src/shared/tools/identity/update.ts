/**
 * identity_update Tool Factory
 *
 * Updates one of the calling agent's identity documents. Each call
 * replaces the entire document with a new version. Documents persist
 * across all conversations. Agent ID is extracted from ToolContext
 * (not user input).
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { IdentityService } from "../../services/identity-service.js";

const IdentityUpdateInputSchema = z.object({
  document_type: z
    .string()
    .min(1)
    .describe(
      "Name of the document to update (e.g., 'personality', 'project-context', 'working-style')",
    ),
  content: z
    .string()
    .min(1)
    .describe(
      "The full document content (max 12,000 characters). Replaces the entire previous version.",
    ),
});

export function createIdentityUpdateTool(
  identityService: IdentityService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "identity_update",
    description:
      "Update one of your identity documents. Each call replaces the entire document with a new version. " +
      "Your identity documents are synthesized mental models -- living summaries that you rewrite each time, " +
      "not individual facts. Documents persist across all your conversations. If you hit the 5-document " +
      "limit, update an existing document rather than creating a new one.",
    inputSchema: IdentityUpdateInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = IdentityUpdateInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        const result = await identityService.updateDocument({
          agentId: ctx.agentId,
          documentType: parsed.data.document_type,
          content: parsed.data.content,
          conversationId: ctx.correlationId,
        });

        return {
          content: `Updated '${result.documentType}' (v${result.version}). Your documents: ${result.allDocuments.join(", ")}.`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: message,
          isError: true,
        };
      }
    },
  };
}
