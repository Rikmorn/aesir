/**
 * GitHub Client Factory
 *
 * Creates Octokit instances with token-based authentication.
 * Provides factory functions for different authentication patterns.
 */

import { createPinoLogger } from "@aesir/common";
import { Octokit } from "@octokit/rest";
import type { GitHubConfig } from "./types.js";

const logger = createPinoLogger({ component: "integrations:github" });

/**
 * Create an Octokit client with configuration object
 *
 * Use this when you have a GitHubConfig object, typically from
 * stored configuration or environment setup.
 *
 * @param config - GitHub configuration with token
 * @returns Configured Octokit instance
 */
export function createGitHubClient(config: GitHubConfig): Octokit {
  logger.debug("Creating GitHub client with config");

  return new Octokit({
    auth: config.token,
  });
}

/**
 * Create an Octokit client directly with a token
 *
 * Use this for testing or when token management is handled externally.
 * Simpler factory when you just have a token string.
 *
 * @param token - GitHub personal access token or app token
 * @returns Configured Octokit instance
 */
export function getOctokit(token: string): Octokit {
  logger.debug("Creating GitHub client with direct token");

  return new Octokit({
    auth: token,
  });
}
