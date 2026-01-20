// @aesir/integrations - linear, github, slack

// Linear
export * from "./linear/index.js";

// GitHub
export * from "./github/index.js";

// Slack
export * from "./slack/index.js";

// Re-export common types that agents need via integrations
export type { Sandbox, ExecutionResult, TestResult } from "@aesir/common";

// Re-export temporal client for agents to start/signal workflows
export {
  getTemporalClient,
  sendApprovalSignal,
  sendChangesRequestedSignal,
  startApprovalWorkflow,
  type ApprovalWorkflowInput,
  type ApprovalWorkflowResult,
  type ClientConfig,
} from "@aesir/platform";

// Re-export temporal worker and sandbox for agents scripts
export {
  createTemporalWorker,
  runWorker,
  type WorkerConfig,
  DockerSandbox,
} from "@aesir/platform";
