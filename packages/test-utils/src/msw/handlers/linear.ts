/**
 * MSW handlers for Linear GraphQL API
 *
 * Mocks Linear's GraphQL endpoint for testing integration code
 * without hitting the real API.
 */
import { HttpResponse, http } from "msw";

/** Linear GraphQL API endpoint */
const LINEAR_API = "https://api.linear.app/graphql";

/**
 * Mock issue data matching Linear SDK types
 */
const mockIssue = {
  id: "issue_mock_001",
  identifier: "ENG-123",
  title: "Mock Issue Title",
  description: "Mock issue description for testing",
  priority: 2,
  priorityLabel: "Medium",
  state: {
    id: "state_mock_001",
    name: "In Progress",
    type: "started",
  },
  team: {
    id: "team_mock_001",
    name: "Engineering",
    key: "ENG",
  },
  assignee: {
    id: "user_mock_001",
    name: "Test User",
    email: "test@example.com",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Mock team data
 */
const mockTeam = {
  id: "team_mock_001",
  name: "Engineering",
  key: "ENG",
  description: "Engineering team",
  states: {
    nodes: [
      { id: "state_001", name: "Backlog", type: "backlog" },
      { id: "state_002", name: "Todo", type: "unstarted" },
      { id: "state_003", name: "In Progress", type: "started" },
      { id: "state_004", name: "Done", type: "completed" },
    ],
  },
};

/**
 * Mock label data
 */
const mockLabel = {
  id: "label_mock_001",
  name: "bug",
  color: "#FF0000",
};

/**
 * GraphQL query patterns for routing
 */
const QUERY_PATTERNS = {
  issue: /query.*issue\s*\(/i,
  issues: /query.*issues\s*\(/i,
  team: /query.*team\s*\(/i,
  teams: /query.*teams\s*\(/i,
  labels: /query.*issueLabels\s*\(/i,
  createIssue: /mutation.*issueCreate\s*\(/i,
  updateIssue: /mutation.*issueUpdate\s*\(/i,
};

/**
 * Route GraphQL request to appropriate mock response
 */
function routeGraphQLRequest(
  query: string,
  variables?: Record<string, unknown>,
) {
  // Issue queries
  if (QUERY_PATTERNS.issue.test(query)) {
    return {
      data: {
        issue: mockIssue,
      },
    };
  }

  if (QUERY_PATTERNS.issues.test(query)) {
    return {
      data: {
        issues: {
          nodes: [mockIssue],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      },
    };
  }

  // Team queries
  if (QUERY_PATTERNS.team.test(query)) {
    return {
      data: {
        team: mockTeam,
      },
    };
  }

  if (QUERY_PATTERNS.teams.test(query)) {
    return {
      data: {
        teams: {
          nodes: [mockTeam],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      },
    };
  }

  // Label queries
  if (QUERY_PATTERNS.labels.test(query)) {
    return {
      data: {
        issueLabels: {
          nodes: [mockLabel],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      },
    };
  }

  // Issue mutations
  if (QUERY_PATTERNS.createIssue.test(query)) {
    const input = variables?.input as Record<string, unknown> | undefined;
    return {
      data: {
        issueCreate: {
          success: true,
          issue: {
            ...mockIssue,
            id: `issue_created_${Date.now()}`,
            title: (input?.title as string) || mockIssue.title,
            description:
              (input?.description as string) || mockIssue.description,
          },
        },
      },
    };
  }

  if (QUERY_PATTERNS.updateIssue.test(query)) {
    const input = variables?.input as Record<string, unknown> | undefined;
    return {
      data: {
        issueUpdate: {
          success: true,
          issue: {
            ...mockIssue,
            ...(input || {}),
          },
        },
      },
    };
  }

  // Unknown query - return empty data
  return {
    data: null,
    errors: [
      {
        message: "Unknown GraphQL operation",
        extensions: { code: "UNKNOWN_OPERATION" },
      },
    ],
  };
}

/**
 * Default MSW handlers for Linear GraphQL API
 *
 * Usage:
 * ```ts
 * import { linearHandlers } from "@aesir/test-utils";
 * import { setupServer } from "msw/node";
 *
 * const server = setupServer(...linearHandlers);
 * ```
 */
export const linearHandlers = [
  http.post(LINEAR_API, async ({ request }) => {
    const body = (await request.json()) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const { query, variables } = body;

    const response = routeGraphQLRequest(query, variables);
    return HttpResponse.json(response);
  }),
];

/**
 * Mock data exports for test assertions
 */
export const linearMockData = {
  issue: mockIssue,
  team: mockTeam,
  label: mockLabel,
};
