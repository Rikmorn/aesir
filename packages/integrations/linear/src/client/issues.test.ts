/**
 * Linear Issue Management Tests
 *
 * Tests for issue creation and team/label listing functions.
 * Uses mocked LinearClient - no actual API calls.
 */

import type { Issue, IssueLabel, LinearClient, Team } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/common to prevent config validation
vi.mock("@aesir/common", () => ({
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
  IssueStatus: {},
}));

import type { CreateIssueParams } from "./issues.js";
import { createIssue, listLabels, listTeams } from "./issues.js";

// Helper to create mock LinearClient
function createMockClient(overrides: Partial<LinearClient> = {}): LinearClient {
  return {
    createIssue: vi.fn(),
    teams: vi.fn(),
    team: vi.fn(),
    ...overrides,
  } as unknown as LinearClient;
}

// Helper to create mock Issue
function createMockIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-uuid-123",
    identifier: "ABC-123",
    url: "https://linear.app/team/issue/ABC-123",
    title: "Test Issue",
    ...overrides,
  } as unknown as Issue;
}

// Helper to create mock Team
function createMockTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-uuid-123",
    name: "Engineering",
    key: "ENG",
    labels: vi.fn(),
    ...overrides,
  } as unknown as Team;
}

// Helper to create mock Label
function createMockLabel(overrides: Partial<IssueLabel> = {}): IssueLabel {
  return {
    id: "label-uuid-123",
    name: "bug",
    color: "#FF0000",
    ...overrides,
  } as unknown as IssueLabel;
}

describe("createIssue", () => {
  let mockClient: LinearClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it("creates issue with required fields", async () => {
    const mockIssue = createMockIssue();
    (mockClient.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      issue: Promise.resolve(mockIssue),
    });

    const params: CreateIssueParams = {
      teamId: "team-123",
      title: "Test Issue",
    };

    const result = await createIssue(mockClient, params);

    expect(mockClient.createIssue).toHaveBeenCalledWith({
      teamId: "team-123",
      title: "Test Issue",
    });
    expect(result).toEqual({
      id: "issue-uuid-123",
      identifier: "ABC-123",
      url: "https://linear.app/team/issue/ABC-123",
      title: "Test Issue",
    });
  });

  it("creates issue with all optional fields", async () => {
    const mockIssue = createMockIssue({
      title: "Full Issue",
      identifier: "ABC-456",
    });
    (mockClient.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      issue: Promise.resolve(mockIssue),
    });

    const params: CreateIssueParams = {
      teamId: "team-123",
      title: "Full Issue",
      description: "# Description\n\nWith markdown",
      priority: 2,
      labelIds: ["label-1", "label-2"],
    };

    const result = await createIssue(mockClient, params);

    expect(mockClient.createIssue).toHaveBeenCalledWith({
      teamId: "team-123",
      title: "Full Issue",
      description: "# Description\n\nWith markdown",
      priority: 2,
      labelIds: ["label-1", "label-2"],
    });
    expect(result.identifier).toBe("ABC-456");
  });

  it("throws error when creation fails", async () => {
    (mockClient.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      issue: null,
    });

    const params: CreateIssueParams = {
      teamId: "team-123",
      title: "Failed Issue",
    };

    await expect(createIssue(mockClient, params)).rejects.toThrow(
      "Failed to create issue: Failed Issue",
    );
  });

  it("throws error when issue cannot be retrieved after creation", async () => {
    (mockClient.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      issue: Promise.resolve(null),
    });

    const params: CreateIssueParams = {
      teamId: "team-123",
      title: "Missing Issue",
    };

    await expect(createIssue(mockClient, params)).rejects.toThrow(
      "Issue created but could not retrieve: Missing Issue",
    );
  });
});

describe("listTeams", () => {
  let mockClient: LinearClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it("returns array of teams with id, name, and key", async () => {
    const mockTeams = [
      createMockTeam({ id: "team-1", name: "Engineering", key: "ENG" }),
      createMockTeam({ id: "team-2", name: "Design", key: "DES" }),
    ];
    (mockClient.teams as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: mockTeams,
    });

    const result = await listTeams(mockClient);

    expect(result).toEqual([
      { id: "team-1", name: "Engineering", key: "ENG" },
      { id: "team-2", name: "Design", key: "DES" },
    ]);
  });

  it("returns empty array when no teams exist", async () => {
    (mockClient.teams as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: [],
    });

    const result = await listTeams(mockClient);

    expect(result).toEqual([]);
  });
});

describe("listLabels", () => {
  let mockClient: LinearClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it("returns array of labels with id, name, and color", async () => {
    const mockLabels = [
      createMockLabel({ id: "label-1", name: "bug", color: "#FF0000" }),
      createMockLabel({ id: "label-2", name: "feature", color: "#00FF00" }),
    ];
    const mockTeam = createMockTeam();
    (mockTeam.labels as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: mockLabels,
    });
    (mockClient.team as ReturnType<typeof vi.fn>).mockResolvedValue(mockTeam);

    const result = await listLabels(mockClient, "team-123");

    expect(mockClient.team).toHaveBeenCalledWith("team-123");
    expect(result).toEqual([
      { id: "label-1", name: "bug", color: "#FF0000" },
      { id: "label-2", name: "feature", color: "#00FF00" },
    ]);
  });

  it("returns empty array when no labels exist", async () => {
    const mockTeam = createMockTeam();
    (mockTeam.labels as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: [],
    });
    (mockClient.team as ReturnType<typeof vi.fn>).mockResolvedValue(mockTeam);

    const result = await listLabels(mockClient, "team-123");

    expect(result).toEqual([]);
  });

  it("throws error when team not found", async () => {
    (mockClient.team as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(listLabels(mockClient, "nonexistent-team")).rejects.toThrow(
      "Team not found: nonexistent-team",
    );
  });
});
