/**
 * Agent State Test Factories
 *
 * Creates deterministic test agent and dev workflow states.
 * Uses incrementing counters for predictable test assertions.
 *
 * Note: Uses simple message type instead of importing BaseMessage
 * from @langchain/core to avoid adding LangChain as a dependency.
 */

import type { AgentStatus, DevWorkflowStatus, FileChange } from "@aesir/common";

/**
 * Simple message type for test agents.
 * Avoids dependency on @langchain/core.
 */
export interface TestMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TestAgent {
  messages: TestMessage[];
  loopCount: number;
  status: AgentStatus;
  taskDescription: string;
  generatedCode: string | null;
}

let agentCounter = 0;

export interface CreateTestAgentOptions {
  messages?: TestMessage[];
  loopCount?: number;
  status?: AgentStatus;
  taskDescription?: string;
  generatedCode?: string | null;
}

export function createTestAgent(
  options: CreateTestAgentOptions = {},
): TestAgent {
  const num = agentCounter++;
  return {
    messages: options.messages ?? [],
    loopCount: options.loopCount ?? 0,
    status: options.status ?? "running",
    taskDescription: options.taskDescription ?? `Test task ${num}`,
    generatedCode: options.generatedCode ?? null,
  };
}

/**
 * Reset the agent counter for test isolation.
 * Call this in beforeEach() to ensure consistent IDs across test runs.
 */
export function resetAgentCounter(): void {
  agentCounter = 0;
}

/**
 * Simple test result type.
 * Mirrors the TestResult type from @aesir/common but avoids import.
 */
export interface TestTestResult {
  passed: boolean;
  output: string;
  exitCode: number;
}

export interface TestDevWorkflowState {
  taskId: string;
  sessionId: string;
  taskDescription: string;
  repositoryUrl: string | null;
  branchName: string | null;
  files: FileChange[];
  testResult: TestTestResult | null;
  testAttempts: number;
  status: DevWorkflowStatus;
  error: string | null;
  prNumber: number | null;
}

let workflowCounter = 0;

export interface CreateTestDevWorkflowStateOptions {
  taskId?: string;
  sessionId?: string;
  taskDescription?: string;
  repositoryUrl?: string | null;
  branchName?: string | null;
  files?: FileChange[];
  testResult?: TestTestResult | null;
  testAttempts?: number;
  status?: DevWorkflowStatus;
  error?: string | null;
  prNumber?: number | null;
}

export function createTestDevWorkflowState(
  options: CreateTestDevWorkflowStateOptions = {},
): TestDevWorkflowState {
  const num = workflowCounter++;
  return {
    taskId: options.taskId ?? `TASK-${num}`,
    sessionId: options.sessionId ?? `session_${num}`,
    taskDescription: options.taskDescription ?? `Test task description ${num}`,
    repositoryUrl: options.repositoryUrl ?? null,
    branchName: options.branchName ?? null,
    files: options.files ?? [],
    testResult: options.testResult ?? null,
    testAttempts: options.testAttempts ?? 0,
    status: options.status ?? "pending",
    error: options.error ?? null,
    prNumber: options.prNumber ?? null,
  };
}

/**
 * Reset the workflow counter for test isolation.
 * Call this in beforeEach() to ensure consistent IDs across test runs.
 */
export function resetWorkflowCounter(): void {
  workflowCounter = 0;
}
