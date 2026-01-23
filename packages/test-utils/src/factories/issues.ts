/**
 * Issue/PR Test Factories
 *
 * Creates deterministic test issues and PRs for Linear and GitHub.
 */

export interface TestIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  priority: number;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

let issueCounter = 0;

export interface CreateTestIssueOptions {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  state?: string;
  priority?: number;
  url?: string;
}

export function createTestIssue(
  options: CreateTestIssueOptions = {},
): TestIssue {
  const num = issueCounter++;

  return {
    id: options.id ?? `issue_${num}`,
    identifier: options.identifier ?? `TEST-${num}`,
    title: options.title ?? `Test Issue ${num}`,
    description: options.description ?? `Description for test issue ${num}`,
    state: options.state ?? "Todo",
    priority: options.priority ?? 2,
    url: options.url ?? `https://linear.app/test/issue/TEST-${num}`,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

export function resetIssueCounter(): void {
  issueCounter = 0;
}

export interface TestPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed" | "merged";
  headRef: string;
  baseRef: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

let prCounter = 0;

export interface CreateTestPROptions {
  id?: number;
  number?: number;
  title?: string;
  body?: string | null;
  state?: "open" | "closed" | "merged";
  headRef?: string;
  baseRef?: string;
  url?: string;
}

export function createTestPR(
  options: CreateTestPROptions = {},
): TestPullRequest {
  const num = prCounter++;

  return {
    id: options.id ?? num,
    number: options.number ?? num + 1,
    title: options.title ?? `Test PR ${num}`,
    body: options.body ?? `Description for test PR ${num}`,
    state: options.state ?? "open",
    headRef: options.headRef ?? `feature/test-${num}`,
    baseRef: options.baseRef ?? "main",
    url: options.url ?? `https://github.com/test/repo/pull/${num + 1}`,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

export function resetPRCounter(): void {
  prCounter = 0;
}
