// @aesir/integrations - linear, github, slack

// Re-export common types that agents need via integrations
export type { ExecutionResult, Sandbox, TestResult } from "@aesir/common";
// Re-export temporal client for agents to start/signal workflows
// Re-export temporal worker and sandbox for agents scripts
export {
  type ApprovalWorkflowInput,
  type ApprovalWorkflowResult,
  type ClientConfig,
  createTemporalWorker,
  DockerSandbox,
  getTemporalClient,
  runWorker,
  sendApprovalSignal,
  sendChangesRequestedSignal,
  startApprovalWorkflow,
  type WorkerConfig,
} from "@aesir/platform";
// Database (credentials, schema)
export * from "./db/index.js";
// GitHub
export * from "./github/index.js";
// Linear
export * from "./linear/index.js";
// Services
export * from "./services/index.js";
// Slack
export * from "./slack/index.js";
