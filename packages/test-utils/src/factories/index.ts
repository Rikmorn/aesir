/**
 * Test Factories
 *
 * Deterministic factory functions for creating test data.
 */

import { resetAgentCounter, resetWorkflowCounter } from "./agents.js";
import { resetCredentialCounter } from "./credentials.js";
import { resetIssueCounter, resetPRCounter } from "./issues.js";

export {
  type CreateTestAgentOptions,
  type CreateTestDevWorkflowStateOptions,
  createTestAgent,
  createTestDevWorkflowState,
  resetAgentCounter,
  resetWorkflowCounter,
  type TestAgent,
  type TestDevWorkflowState,
  type TestMessage,
  type TestTestResult,
} from "./agents.js";

export {
  type CreateTestCredentialOptions,
  createTestCredential,
  resetCredentialCounter,
  type TestCredential,
} from "./credentials.js";

export {
  type CreateTestIssueOptions,
  type CreateTestPROptions,
  createTestIssue,
  createTestPR,
  resetIssueCounter,
  resetPRCounter,
  type TestIssue,
  type TestPullRequest,
} from "./issues.js";

/**
 * Reset all factory counters.
 * Call in beforeEach() for consistent test data across runs.
 */
export function resetAllCounters(): void {
  resetAgentCounter();
  resetCredentialCounter();
  resetIssueCounter();
  resetPRCounter();
  resetWorkflowCounter();
}
