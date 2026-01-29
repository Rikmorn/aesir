/**
 * GitHub Client Factory Tests
 *
 * Tests for the GitHub client factory functions.
 * Verifies that Octokit is instantiated with correct authentication.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/types - partial mock to preserve error exports
vi.mock("@aesir/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aesir/types")>();
  return {
    ...actual,
    createPinoLogger: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    })),
  };
});

// Track constructor calls for assertions
const mockOctokitConstructor = vi.fn();

// Mock @octokit/rest with a class-based mock (required for `new` usage in vitest v4)
vi.mock("@octokit/rest", () => {
  const MockOctokit = class {
    constructor(options: unknown) {
      mockOctokitConstructor(options);
      Object.assign(this, {
        rest: {
          git: {
            getRef: vi.fn(),
            createRef: vi.fn(),
          },
          repos: {
            listBranches: vi.fn(),
          },
        },
      });
    }
  };
  return { Octokit: MockOctokit };
});

// Import after mocking
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

    expect(mockOctokitConstructor).toHaveBeenCalledWith({
      auth: "test-github-token",
    });
    expect(client).toBeDefined();
  });

  it("passes config token to Octokit auth option", () => {
    const config: GitHubConfig = {
      token: "ghp_xxxxxxxxxxxxxxxxxxxx",
    };

    createGitHubClient(config);

    expect(mockOctokitConstructor).toHaveBeenCalledWith({
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

    expect(mockOctokitConstructor).toHaveBeenCalledWith({
      auth: "direct-token",
    });
    expect(client).toBeDefined();
  });

  it("creates separate instances for different tokens", () => {
    getOctokit("token-1");
    getOctokit("token-2");

    expect(mockOctokitConstructor).toHaveBeenCalledTimes(2);
    expect(mockOctokitConstructor).toHaveBeenNthCalledWith(1, {
      auth: "token-1",
    });
    expect(mockOctokitConstructor).toHaveBeenNthCalledWith(2, {
      auth: "token-2",
    });
  });
});
