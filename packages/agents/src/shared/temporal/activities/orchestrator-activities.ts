/**
 * Orchestrator Temporal Activities
 *
 * Three activities that wrap `runDevAgentOrchestrator()` for Temporal's
 * durability envelope:
 *
 * 1. runOrchestratorPreApproval - Research + planning, sentinel parsing for approval
 * 2. runOrchestratorPostApproval - Execution + PR creation after approval
 * 3. handleOrchestratorFeedback - Address PR review feedback with targeted fixes
 *
 * Each activity invokes the orchestrator, extracts slim serializable results
 * (never the full AgentLoopResult trace), and writes context snapshots for
 * cross-activity continuity.
 *
 * Uses module-level DI pattern: call initOrchestratorActivities() at worker
 * startup before activities are used.
 */

import type {
  DevContainerCleanup,
  DevContainerGit,
  DevContainerManager,
  PinoLogger,
} from "@aesir/platform";
import { Context } from "@temporalio/activity";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { runDevAgentOrchestrator } from "../../../dev-agent/orchestrator/orchestrator.js";
import type {
  AgentLoopResult,
  AgentLoopStatus,
} from "../../agent-loop/types.js";
import type { ContextManager } from "../../db/context-manager.js";
import type * as agentsSchemaModule from "../../db/schema.js";
import type { TaskStore } from "../../db/task-store.js";
import { HUMAN_INPUT_MARKER } from "../../tools/coordination/request-human-input.js";

// ---------------------------------------------------------------------------
// Heartbeat Helper
// ---------------------------------------------------------------------------

/**
 * Create a heartbeat callback bound to the current Temporal activity context.
 *
 * Returns a function that calls `Context.current().heartbeat()` when running
 * inside a Temporal activity, or `undefined` when no activity context is
 * available (e.g., in unit tests).
 *
 * This keeps `runAgentLoop()` framework-agnostic -- it receives a plain
 * callback, not a Temporal-specific API.
 */
function getHeartbeatFn(): (() => void) | undefined {
  try {
    const ctx = Context.current();
    return () => ctx.heartbeat();
  } catch {
    // Not running inside a Temporal activity (e.g., in tests)
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Dependency Injection
// ---------------------------------------------------------------------------

/**
 * Dependencies required by orchestrator and infrastructure activities.
 * Injected via initOrchestratorActivities at worker startup.
 */
export interface OrchestratorActivitiesDeps {
  /** Container manager for spawning/managing dev containers */
  containerManager: DevContainerManager;
  /** Cleanup service for container cleanup */
  cleanup: DevContainerCleanup;
  /** Git operations within containers */
  git: DevContainerGit;
  /** Context snapshot persistence */
  contextManager: ContextManager;
  /** Task state persistence */
  taskStore: TaskStore;
  /** Database client for orchestrator */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance */
  logger: PinoLogger;
  /** GitHub repo URL for cloning */
  repoUrl: string;
  /** GitHub token for authentication */
  githubToken: string;
  /** GitHub owner */
  owner: string;
  /** GitHub repo name */
  repo: string;
  /** Base branch for PRs (e.g., "main") */
  baseBranch: string;
  /** Default Slack channel for notifications */
  slackChannel: string;
}

/** Module-level dependencies - must be initialized before use */
let deps: OrchestratorActivitiesDeps | null = null;

/**
 * Initialize orchestrator activities with dependencies.
 *
 * Must be called at Temporal worker startup before any activities run.
 *
 * @param dependencies - All required dependencies for orchestrator activities
 */
export function initOrchestratorActivities(
  dependencies: OrchestratorActivitiesDeps,
): void {
  deps = dependencies;
  dependencies.logger.info("Orchestrator activities initialized");
}

/**
 * Get dependencies, throwing if not initialized.
 * Exported for use by infrastructure-activities.ts.
 */
export function getOrchestratorDeps(): OrchestratorActivitiesDeps {
  if (!deps) {
    throw new Error(
      "Orchestrator activities not initialized. Call initOrchestratorActivities() at worker startup.",
    );
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Human Input Sentinel Parsing
// ---------------------------------------------------------------------------

/**
 * Parsed human input request from the request_human_input tool sentinel.
 */
export interface HumanInputRequest {
  /** Slack channel ID to send the request to */
  channel: string;
  /** Message to send to the human */
  message: string;
  /** Type of human input being requested */
  requestType: "approval" | "clarification" | "escalation";
}

/**
 * Parse the HUMAN_INPUT_MARKER sentinel from an agent loop result trace.
 *
 * Scans the ENTIRE trace for tool_result steps from request_human_input,
 * not just the last step. The LLM may continue producing output after
 * calling the sentinel tool (Pitfall 1 from research).
 *
 * @param result - Agent loop result containing the execution trace
 * @returns Parsed human input request, or null if no sentinel found
 */
export function parseHumanInputMarker(
  result: AgentLoopResult,
): HumanInputRequest | null {
  for (const step of result.trace) {
    if (
      step.type === "tool_result" &&
      step.toolName === "request_human_input"
    ) {
      try {
        const parsed = JSON.parse(step.output as string);
        if (parsed.type === HUMAN_INPUT_MARKER) {
          return {
            channel: parsed.channel,
            message: parsed.message,
            requestType: parsed.requestType,
          };
        }
      } catch {
        // Not valid JSON or missing fields, skip this step
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// PR Info Trace Parsing
// ---------------------------------------------------------------------------

/**
 * Parsed PR info from a github_create_pull_request tool result in the trace.
 */
export interface PrInfo {
  /** GitHub PR number */
  number: number;
  /** GitHub PR URL */
  url: string;
}

/**
 * Parse PR info from a github_create_pull_request tool result in the trace.
 *
 * Scans the trace for successful github_create_pull_request tool results
 * and extracts the PR number and URL. Returns the LAST match (the most
 * recent PR creation in case of retries).
 *
 * @param result - Agent loop result containing the execution trace
 * @returns Parsed PR info, or null if no PR was created
 */
export function parsePrInfoFromTrace(result: AgentLoopResult): PrInfo | null {
  let lastPr: PrInfo | null = null;

  for (const step of result.trace) {
    if (
      step.type === "tool_result" &&
      step.toolName === "github_create_pull_request"
    ) {
      try {
        const parsed = JSON.parse(step.output as string);
        if (
          typeof parsed.number === "number" &&
          typeof parsed.url === "string"
        ) {
          lastPr = { number: parsed.number, url: parsed.url };
        }
      } catch {
        // Not valid JSON or missing fields, skip
      }
    }
  }

  return lastPr;
}

// ---------------------------------------------------------------------------
// Activity Input/Output Types
// ---------------------------------------------------------------------------

/** Issue context passed to orchestrator activities */
export interface OrchestratorIssueContext {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  labels: string[];
}

/**
 * Input for the pre-approval orchestrator activity.
 * Runs research + planning and returns a plan for human approval.
 */
export interface PreApprovalInput {
  taskId: string;
  issue: OrchestratorIssueContext;
  slackChannel: string;
  workflowId: string;
  /** Rejection feedback for re-planning loop (stored in task store) */
  rejectionFeedback?: string;
}

/**
 * Slim output from the pre-approval activity.
 * Does NOT include the full trace (Temporal 2MB/4MB gRPC limit).
 */
export interface PreApprovalOutput {
  /** Agent loop completion status */
  status: AgentLoopStatus;
  /** Plan text for display in approval message */
  plan: string;
  /** Parsed human input request if orchestrator called request_human_input */
  humanInputRequest: HumanInputRequest | null;
  /** PR number if agent created a PR during pre-approval (autonomous completion) */
  prNumber?: number;
  /** PR URL if agent created a PR during pre-approval (autonomous completion) */
  prUrl?: string;
  /** Tool call count for observability */
  toolCallCount: number;
  /** Token usage for cost tracking */
  tokenCount: { input: number; output: number };
}

/**
 * Input for the post-approval orchestrator activity.
 * Runs execution + testing + PR creation after plan approval.
 */
export interface PostApprovalInput {
  taskId: string;
  issue: OrchestratorIssueContext;
  slackChannel: string;
  workflowId: string;
}

/**
 * Slim output from the post-approval activity.
 */
export interface PostApprovalOutput {
  status: AgentLoopStatus;
  /** PR number if created (conditional for exactOptionalPropertyTypes) */
  prNumber?: number;
  /** PR URL if created */
  prUrl?: string;
  /** Error message if failed */
  errorMessage?: string;
  /** Tool call count for observability */
  toolCallCount: number;
  /** Token usage for cost tracking */
  tokenCount: { input: number; output: number };
}

/**
 * Input for the feedback orchestrator activity.
 * Addresses PR review comments with targeted fixes.
 */
export interface FeedbackInput {
  taskId: string;
  issue: OrchestratorIssueContext;
  slackChannel: string;
  workflowId: string;
  /** PR review feedback to address */
  feedback: string;
}

/**
 * Slim output from the feedback activity.
 */
export interface FeedbackOutput {
  status: AgentLoopStatus;
  /** Whether fixes were applied successfully */
  fixesApplied: boolean;
  /** Error message if failed */
  errorMessage?: string;
  /** Tool call count for observability */
  toolCallCount: number;
  /** Token usage for cost tracking */
  tokenCount: { input: number; output: number };
}

// ---------------------------------------------------------------------------
// Activity: Pre-Approval
// ---------------------------------------------------------------------------

/**
 * Run the orchestrator for research + planning (pre-approval phase).
 *
 * Invokes `runDevAgentOrchestrator()` which reads the issue, analyzes the
 * codebase, and produces an implementation plan. Parses the HUMAN_INPUT_MARKER
 * sentinel to determine if the workflow should pause for approval.
 *
 * On re-planning (rejection feedback provided), stores the feedback in the
 * task store so the orchestrator can read it via its tools (self-sufficient
 * agents principle from Phase 31).
 *
 * Writes a context snapshot at completion for the post-approval activity.
 *
 * @param input - Pre-approval activity input
 * @returns Slim result with plan text and sentinel parsing
 */
export async function runOrchestratorPreApproval(
  input: PreApprovalInput,
): Promise<PreApprovalOutput> {
  const activeDeps = getOrchestratorDeps();
  const activityLogger = activeDeps.logger.child({
    activity: "runOrchestratorPreApproval",
    taskId: input.taskId,
  });

  activityLogger.info(
    { issueIdentifier: input.issue.identifier },
    "Starting pre-approval orchestrator run",
  );

  // Update task status to researching
  await activeDeps.taskStore.updateTask(input.taskId, {
    status: "researching",
  });

  // If rejection feedback is provided, store it in the task store
  // so the orchestrator can discover it via its read_task_state tool
  if (input.rejectionFeedback !== undefined) {
    await activeDeps.taskStore.updateTask(input.taskId, {
      approvalFeedback: input.rejectionFeedback,
      approvalStatus: "rejected",
    });
    activityLogger.info(
      { feedbackLength: input.rejectionFeedback.length },
      "Stored rejection feedback in task store for re-planning",
    );
  }

  // Wire Temporal heartbeat into the agent loop (fires after each LLM response)
  const onHeartbeat = getHeartbeatFn();

  // Run the orchestrator loop
  const result = await runDevAgentOrchestrator({
    issueId: input.issue.identifier,
    issueTitle: input.issue.title,
    containerManager: activeDeps.containerManager,
    taskId: input.taskId,
    agentId: "dev-agent",
    correlationId: input.taskId,
    workflowId: input.workflowId,
    db: activeDeps.db,
    logger: activeDeps.logger,
    maxIterations: 100,
    onHeartbeat,
  });

  // Parse sentinel for human input request
  const humanInputRequest = parseHumanInputMarker(result);

  if (humanInputRequest) {
    activityLogger.info(
      { requestType: humanInputRequest.requestType },
      "Human input sentinel detected in trace",
    );
  }

  // Write context snapshot for post-approval activity continuity
  await activeDeps.contextManager.writeSnapshot({
    taskId: input.taskId,
    workflowId: input.workflowId,
    agentType: "dev-orchestrator",
    stage: "post-research-plan",
    summary: result.output,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  });

  // When agent completed autonomously (no sentinel), check if it created a PR.
  // Parse the trace for github_create_pull_request results (primary source).
  // Falls back to task store query in case PR info was written there by other means.
  let prNumber: number | undefined;
  let prUrl: string | undefined;

  if (!humanInputRequest) {
    // Primary: parse trace for PR creation tool results
    const prInfo = parsePrInfoFromTrace(result);
    if (prInfo) {
      prNumber = prInfo.number;
      prUrl = prInfo.url;

      // Write PR info to task store for other consumers (workflow queries, webhooks)
      await activeDeps.taskStore.updateTask(input.taskId, {
        prNumber: prInfo.number,
        prUrl: prInfo.url,
      });
    } else {
      // Fallback: check task store (in case agent wrote via a tool we don't know about)
      const task = await activeDeps.taskStore.getTask(input.taskId);
      if (task?.pr_number !== null && task?.pr_number !== undefined) {
        prNumber = task.pr_number;
      }
      if (task?.pr_url !== null && task?.pr_url !== undefined) {
        prUrl = task.pr_url;
      }
    }
  }

  activityLogger.info(
    {
      status: result.status,
      toolCallCount: result.toolCallCount,
      hasSentinel: humanInputRequest !== null,
      autonomousPr: prNumber,
    },
    "Pre-approval orchestrator run complete",
  );

  // Return slim result (no full trace -- Temporal gRPC limit)
  const output: PreApprovalOutput = {
    status: result.status,
    plan: result.output,
    humanInputRequest,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  };
  if (prNumber !== undefined) {
    output.prNumber = prNumber;
  }
  if (prUrl !== undefined) {
    output.prUrl = prUrl;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Activity: Post-Approval
// ---------------------------------------------------------------------------

/**
 * Run the orchestrator for execution + PR creation (post-approval phase).
 *
 * Invokes `runDevAgentOrchestrator()` which reads the post-research-plan
 * context snapshot via its tools (self-sufficient agents) and executes the
 * approved plan: writes code, runs tests, creates a pull request.
 *
 * Extracts PR info from the task store after the orchestrator completes
 * (the orchestrator writes PR info via its tools).
 *
 * @param input - Post-approval activity input
 * @returns Slim result with PR details
 */
export async function runOrchestratorPostApproval(
  input: PostApprovalInput,
): Promise<PostApprovalOutput> {
  const activeDeps = getOrchestratorDeps();
  const activityLogger = activeDeps.logger.child({
    activity: "runOrchestratorPostApproval",
    taskId: input.taskId,
  });

  activityLogger.info(
    { issueIdentifier: input.issue.identifier },
    "Starting post-approval orchestrator run",
  );

  // Update task status to executing
  await activeDeps.taskStore.updateTask(input.taskId, {
    status: "executing",
  });

  // Wire Temporal heartbeat into the agent loop (fires after each LLM response)
  const onHeartbeat = getHeartbeatFn();

  // Run the orchestrator loop -- it reads context snapshot via tools
  const result = await runDevAgentOrchestrator({
    issueId: input.issue.identifier,
    issueTitle: input.issue.title,
    containerManager: activeDeps.containerManager,
    taskId: input.taskId,
    agentId: "dev-agent",
    correlationId: input.taskId,
    workflowId: input.workflowId,
    db: activeDeps.db,
    logger: activeDeps.logger,
    maxIterations: 100,
    onHeartbeat,
  });

  // Extract PR info: trace is primary source, task store is fallback
  const prInfo = parsePrInfoFromTrace(result);
  if (prInfo) {
    // Write PR info to task store for other consumers
    await activeDeps.taskStore.updateTask(input.taskId, {
      prNumber: prInfo.number,
      prUrl: prInfo.url,
    });
  }

  // Build output with conditional property assignment for exactOptionalPropertyTypes
  const output: PostApprovalOutput = {
    status: result.status,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  };

  if (prInfo) {
    output.prNumber = prInfo.number;
    output.prUrl = prInfo.url;
  } else {
    // Fallback: check task store (pre-approval may have written it)
    const task = await activeDeps.taskStore.getTask(input.taskId);
    if (task?.pr_number !== null && task?.pr_number !== undefined) {
      output.prNumber = task.pr_number;
    }
    if (task?.pr_url !== null && task?.pr_url !== undefined) {
      output.prUrl = task.pr_url;
    }
  }
  if (result.status === "error") {
    output.errorMessage = result.output;
  }

  // Write context snapshot for feedback activity continuity
  await activeDeps.contextManager.writeSnapshot({
    taskId: input.taskId,
    workflowId: input.workflowId,
    agentType: "dev-orchestrator",
    stage: "post-execution",
    summary: result.output,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  });

  activityLogger.info(
    {
      status: result.status,
      prNumber: output.prNumber,
      toolCallCount: result.toolCallCount,
    },
    "Post-approval orchestrator run complete",
  );

  return output;
}

// ---------------------------------------------------------------------------
// Activity: Feedback
// ---------------------------------------------------------------------------

/**
 * Run the orchestrator to address PR review feedback.
 *
 * Stores feedback in the task store, then invokes `runDevAgentOrchestrator()`
 * which reads the task state (including feedback) via its tools and applies
 * targeted fixes.
 *
 * @param input - Feedback activity input with PR review comments
 * @returns Slim result indicating whether fixes were applied
 */
export async function handleOrchestratorFeedback(
  input: FeedbackInput,
): Promise<FeedbackOutput> {
  const activeDeps = getOrchestratorDeps();
  const activityLogger = activeDeps.logger.child({
    activity: "handleOrchestratorFeedback",
    taskId: input.taskId,
  });

  activityLogger.info(
    {
      issueIdentifier: input.issue.identifier,
      feedbackLength: input.feedback.length,
    },
    "Starting feedback orchestrator run",
  );

  // Update task status and store feedback for orchestrator discovery
  await activeDeps.taskStore.updateTask(input.taskId, {
    status: "executing",
    approvalFeedback: input.feedback,
  });

  // Wire Temporal heartbeat into the agent loop (fires after each LLM response)
  const onHeartbeat = getHeartbeatFn();

  // Run the orchestrator loop -- it reads task state with feedback via tools
  const result = await runDevAgentOrchestrator({
    issueId: input.issue.identifier,
    issueTitle: input.issue.title,
    containerManager: activeDeps.containerManager,
    taskId: input.taskId,
    agentId: "dev-agent",
    correlationId: input.taskId,
    workflowId: input.workflowId,
    db: activeDeps.db,
    logger: activeDeps.logger,
    maxIterations: 100,
    onHeartbeat,
  });

  // Determine if fixes were applied based on status
  const fixesApplied = result.status === "completed";

  // Build output with conditional property assignment for exactOptionalPropertyTypes
  const output: FeedbackOutput = {
    status: result.status,
    fixesApplied,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  };
  if (result.status === "error") {
    output.errorMessage = result.output;
  }

  // Write context snapshot for observability and potential future feedback rounds
  await activeDeps.contextManager.writeSnapshot({
    taskId: input.taskId,
    workflowId: input.workflowId,
    agentType: "dev-orchestrator",
    stage: "post-feedback",
    summary: result.output,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  });

  activityLogger.info(
    {
      status: result.status,
      fixesApplied,
      toolCallCount: result.toolCallCount,
    },
    "Feedback orchestrator run complete",
  );

  return output;
}
