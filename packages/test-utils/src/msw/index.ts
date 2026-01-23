/**
 * MSW (Mock Service Worker) utilities for API mocking
 *
 * Provides pre-configured handlers and server setup for testing
 * code that makes external API calls.
 */

// Re-export msw utilities for test overrides
export { HttpResponse, http } from "msw";
// Individual handler arrays
export {
  allHandlers,
  githubHandlers,
  githubMockData,
  linearHandlers,
  linearMockData,
  slackHandlers,
  slackMockData,
} from "./handlers/index.js";
export type { SetupMSWOptions } from "./server.js";
// Server setup
export { server, setupMSW } from "./server.js";
