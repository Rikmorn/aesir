/**
 * Event Content Storage
 *
 * Helper for storing full LLM response content in the agent_event_content table.
 * Content is stored separately from the lean event log to keep event queries fast.
 *
 * Fire-and-forget storage: errors are logged but do not block the agent loop.
 */

import type { PinoLogger } from "@aesir/platform";
import type Anthropic from "@anthropic-ai/sdk";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import { agentEventContent } from "../shared/db/schema.js";

type AgentsDb = NodePgDatabase<typeof agentsSchemaModule>;

/**
 * Check if the response content has any text blocks worth storing.
 *
 * Skips storage if content is empty or contains only tool_use blocks
 * (which are already captured in tool.called events).
 */
function hasTextContent(content: Anthropic.ContentBlock[]): boolean {
  return content.some(
    (block) => block.type === "text" && block.text.length > 0,
  );
}

/**
 * Store LLM response content in agent_event_content table.
 *
 * Fire-and-forget: errors are logged but do not propagate.
 * Skips storage if content has no text blocks.
 *
 * @param db - Database client
 * @param eventId - The agent_event ID to associate content with
 * @param content - The Anthropic response content blocks
 * @param logger - Logger for error reporting
 */
export async function storeEventContent(
  db: AgentsDb,
  eventId: string,
  content: Anthropic.ContentBlock[],
  logger: PinoLogger,
): Promise<void> {
  // Skip if no text content to store
  if (!hasTextContent(content)) {
    return;
  }

  try {
    await db.insert(agentEventContent).values({
      event_id: eventId,
      content: content as unknown[],
    });
  } catch (error) {
    // Fire-and-forget: log but don't propagate errors
    logger.error(
      { err: error, eventId },
      "Failed to store event content (non-fatal)",
    );
  }
}
