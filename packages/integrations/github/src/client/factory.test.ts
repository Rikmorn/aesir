/**
 * GitHub Client Factory Tests
 *
 * Tests for the GitHub client factory functions.
 * Verifies that Octokit is instantiated with correct authentication.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/types to prevent config validation
vi.mock("@aesir/types", () => ({
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock @octokit/rest
vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => ({
      rest: {
        git: {
          getRef: vi.fn(),
          createRef: vi.fn(),
        },
        repos: {
          listBranches: vi.fn(),
        },
      },
    })),
  };
});

// Import after mocking
import { Octokit } from "@octokit/rest";
import { createGitHubClient, getOctokit } from "./factory.js";
import type { GitHubConfig } from "./types.js";

describe("createGitHubClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates Octokit instance with token from config", () => {
    const config: GitHubConfig = {
      token: "test-github-token",
    };

    const client = createGitHubClient(config);

    expect(Octokit).toHaveBeenCalledWith({
      auth: "test-github-token",
    });
    expect(client).toBeDefined();
  });

  it("passes config token to Octokit auth option", () => {
    const config: GitHubConfig = {
      token: "ghp_xxxxxxxxxxxxxxxxxxxx",
    };

    createGitHubClient(config);

    expect(Octokit).toHaveBeenCalledWith({
      auth: "ghp_xxxxxxxxxxxxxxxxxxxx",
    });
  });
});

describe("getOctokit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates Octokit instance with direct token", () => {
    const client = getOctokit("direct-token");

    expect(Octokit).toHaveBeenCalledWith({
      auth: "direct-token",
    });
    expect(client).toBeDefined();
  });

  it("creates separate instances for different tokens", () => {
    getOctokit("token-1");
    getOctokit("token-2");

    expect(Octokit).toHaveBeenCalledTimes(2);
    expect(Octokit).toHaveBeenNthCalledWith(1, { auth: "token-1" });
    expect(Octokit).toHaveBeenNthCalledWith(2, { auth: "token-2" });
  });
});
