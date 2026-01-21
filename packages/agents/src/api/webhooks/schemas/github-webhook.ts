/**
 * GitHub Webhook Payload Zod Schemas
 *
 * @deprecated Use imports from @aesir/integration-github instead.
 * This file is kept for backward compatibility.
 *
 * The GitHub integration has been extracted to a standalone package
 * (@aesir/integration-github) to support independent deployment and versioning.
 * Update your imports to use the new package:
 *
 * @example
 * ```typescript
 * // Old (deprecated)
 * import { parsePRReviewPayload } from './schemas/github-webhook.js';
 *
 * // New (recommended)
 * import { parsePRReviewPayload } from '@aesir/integration-github';
 * ```
 */

// Re-export from @aesir/integration-github
export {
  type PRReviewPayload,
  PRReviewPayloadSchema,
  type PullRequest,
  PullRequestSchema,
  parsePRReviewPayload,
  type Repository,
  RepositorySchema,
  type Review,
  ReviewSchema,
} from "@aesir/integration-github";
