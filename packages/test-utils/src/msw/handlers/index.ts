/**
 * MSW handler exports
 *
 * Provides default request handlers for mocking external API services.
 */

export { githubHandlers, githubMockData } from "./github.js";
export { linearHandlers, linearMockData } from "./linear.js";
export { slackHandlers, slackMockData } from "./slack.js";

import { githubHandlers } from "./github.js";
import { linearHandlers } from "./linear.js";
import { slackHandlers } from "./slack.js";

/**
 * Combined handlers for all supported APIs
 *
 * Usage:
 * ```ts
 * import { allHandlers } from "@aesir/test-utils";
 * import { setupServer } from "msw/node";
 *
 * const server = setupServer(...allHandlers);
 * ```
 */
export const allHandlers = [
  ...linearHandlers,
  ...githubHandlers,
  ...slackHandlers,
];
