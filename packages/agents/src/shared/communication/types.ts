/**
 * Communication Types Module
 *
 * Zod-first type definitions for the unified communication system (v2.6).
 * ReplyContext is the foundation type consumed by adapters, router,
 * denormalizer, and communication tools across phases 61-64.
 */

import type { PinoLogger } from "@aesir/platform";
import { z } from "zod";

// ─── ReplyContext ────────────────────────────────────────────────────────────

/**
 * Slack reply context -- identifies a Slack channel/thread to reply to.
 * threadTs is optional: absence = post to channel, presence = reply in thread.
 */
export const SlackReplyContextSchema = z.object({
  channel: z.literal("slack"),
  teamId: z.string(),
  channelId: z.string(),
  threadTs: z.string().optional(),
});

/**
 * Linear reply context -- identifies a Linear issue to comment on.
 */
export const LinearReplyContextSchema = z.object({
  channel: z.literal("linear"),
  issueId: z.string(),
});

/**
 * GitHub reply context -- identifies a GitHub PR to comment on.
 * commentId is optional: reserved for future inline review reply support (not used in v2.6).
 */
export const GitHubReplyContextSchema = z.object({
  channel: z.literal("github"),
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number(),
  commentId: z.number().optional(),
});

/**
 * ReplyContext -- discriminated union on `channel` field.
 *
 * Represents the last-received channel address for a conversation.
 * Used for reply routing: when an agent needs to respond, it uses
 * the ReplyContext to determine which integration to call.
 *
 * TypeScript narrows correctly on the `channel` discriminator:
 * ```typescript
 * if (ctx.channel === "slack") {
 *   ctx.channelId; // string -- narrowed to SlackReplyContext
 * }
 * ```
 */
export const ReplyContextSchema = z.discriminatedUnion("channel", [
  SlackReplyContextSchema,
  LinearReplyContextSchema,
  GitHubReplyContextSchema,
]);

export type ReplyContext = z.infer<typeof ReplyContextSchema>;

// ─── CommunicationToolDeps ───────────────────────────────────────────────────

/**
 * Dependencies injected into communication tools at registration time.
 * Follows the same pattern as McpToolDeps from mcp-wrapper.ts.
 */
export interface CommunicationToolDeps {
  agentId: string;
  correlationId: string;
  taskId?: string;
  logger: PinoLogger;
}
