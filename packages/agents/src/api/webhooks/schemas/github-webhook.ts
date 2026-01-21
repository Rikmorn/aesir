/**
 * GitHub Webhook Payload Zod Schemas
 *
 * Validates GitHub webhook payloads before processing.
 * Schemas match the PRReviewEvent interface in the handler.
 */

import { z } from "zod";

/**
 * Pull request data relevant to PR review webhooks
 */
export const PullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
});

/**
 * Review data from PR review webhook
 */
export const ReviewSchema = z.object({
  id: z.number(),
  user: z.object({
    login: z.string(),
  }),
  body: z.string().nullable(),
  state: z.enum(["approved", "changes_requested", "commented", "dismissed"]),
});

/**
 * Repository data from PR review webhook
 */
export const RepositorySchema = z.object({
  name: z.string(),
  owner: z.object({
    login: z.string(),
  }),
});

/**
 * Full PR review webhook payload from GitHub
 */
export const PRReviewPayloadSchema = z.object({
  action: z.enum(["submitted", "edited", "dismissed"]),
  review: ReviewSchema,
  pull_request: PullRequestSchema,
  repository: RepositorySchema,
});

export type PRReviewPayload = z.infer<typeof PRReviewPayloadSchema>;
export type PullRequest = z.infer<typeof PullRequestSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Repository = z.infer<typeof RepositorySchema>;

/**
 * Parse and validate a GitHub PR review webhook payload
 *
 * @param rawBody - Raw request body string (JSON)
 * @returns Zod safeParse result with typed data or ZodError
 */
export function parsePRReviewPayload(
  rawBody: string,
): z.SafeParseReturnType<unknown, PRReviewPayload> {
  try {
    const json: unknown = JSON.parse(rawBody);
    return PRReviewPayloadSchema.safeParse(json);
  } catch {
    // JSON parse error - create a synthetic Zod error
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: "Invalid JSON",
          path: [],
        },
      ]),
    };
  }
}
