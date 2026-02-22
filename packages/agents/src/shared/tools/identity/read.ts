/**
 * identity_read Tool Factory
 *
 * Reads the calling agent's identity documents. Can return all documents
 * or a specific one by type. Agent ID is extracted from ToolContext
 * (not user input).
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { IdentityService } from "../../services/identity-service.js";

const IdentityReadInputSchema = z.object({
  document_type: z
    .string()
    .optional()
    .describe("Specific document type to read. Omit to see all documents."),
});

export function createIdentityReadTool(
  identityService: IdentityService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "identity_read",
    description:
      "Read your identity documents. Call without arguments to see all documents, " +
      "or specify a document_type to read a specific one. Documents are auto-injected " +
      "into your system prompt at conversation start, so use this mainly during long " +
      "conversations when you want a fresh view.",
    inputSchema: IdentityReadInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = IdentityReadInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        if (parsed.data.document_type) {
          // Read a specific document
          const history = await identityService.getDocumentHistory(
            ctx.agentId,
            parsed.data.document_type,
            { limit: 1 },
          );

          if (history.length === 0) {
            return {
              content: `No document found with type '${parsed.data.document_type}'.`,
            };
          }

          // biome-ignore lint/style/noNonNullAssertion: length > 0 checked above
          const doc = history[0]!;
          return {
            content: formatDocument(doc),
          };
        }

        // Read all current documents
        const documents = await identityService.getCurrentDocuments(
          ctx.agentId,
        );

        if (documents.length === 0) {
          return {
            content:
              "You have no identity documents yet. Use identity_update to create your first one.",
          };
        }

        const formatted = documents.map(formatDocument).join("\n\n---\n\n");
        return {
          content: `You have ${documents.length} identity document(s):\n\n${formatted}`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to read identity documents: ${message}`,
          isError: true,
        };
      }
    },
  };
}

function formatDocument(doc: {
  documentType: string;
  version: number;
  createdAt: string;
  content: string;
}): string {
  return (
    `## ${doc.documentType} (v${doc.version})\n` +
    `Updated: ${doc.createdAt}\n\n` +
    doc.content
  );
}
