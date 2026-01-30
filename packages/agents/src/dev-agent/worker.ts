/**
 * Dev Agent Temporal Worker
 *
 * Creates and configures the Temporal worker for dev-agent workflows.
 * Polls the 'dev-agent' task queue and executes development workflows.
 *
 * Key responsibilities:
 * - Initialize checkpointer before any activity runs
 * - Initialize dev-agent activities with dependencies
 * - Register devAgentWorkflow
 * - Register all required activities
 * - Poll 'dev-agent' task queue
 */

import {
  createDevContainerCleanup,
  createDevContainerGit,
  createDevContainerManager,
  createPinoLogger,
  type PinoLogger,
} from "@aesir/platform";
import { db } from "@aesir/platform/db/client";
import { ChatAnthropic } from "@langchain/anthropic";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  NativeConnection,
  Worker,
  type WorkerOptions,
} from "@temporalio/worker";
import { createContextManager } from "../shared/db/context-manager.js";
import { createTaskStore } from "../shared/db/task-store.js";
import {
  completeTaskActivity,
  continueAfterApprovalActivity,
  handlePRClosedActivity,
  handlePRFeedbackActivity,
  handleRePlanActivity,
  initDevAgentActivities,
  runDevAgentGraphActivity,
  sendReminderActivity,
  stopContainerActivity,
  syncApprovalToLinearActivity,
  updateSlackApprovalActivity,
} from "../shared/temporal/activities/dev-agent-activities.js";
import {
  completeTaskActivity as orchestratorCompleteTaskActivity,
  stopContainerActivity as orchestratorStopContainerActivity,
  setupContainerActivity,
} from "../shared/temporal/activities/infrastructure-activities.js";
import type { OrchestratorActivitiesDeps } from "../shared/temporal/activities/orchestrator-activities.js";
import {
  handleOrchestratorFeedback,
  initOrchestratorActivities,
  runOrchestratorPostApproval,
  runOrchestratorPreApproval,
} from "../shared/temporal/activities/orchestrator-activities.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:worker",
});

/**
 * Worker configuration options
 */
export interface DevAgentWorkerOptions {
  /** Temporal server address (default: localhost:7233 or TEMPORAL_ADDRESS env var) */
  address?: string;
  /** Temporal namespace (default: 'default' or TEMPORAL_NAMESPACE env var) */
  namespace?: string;
}

/**
 * Create and configure the dev-agent Temporal worker.
 *
 * Initializes dependencies at startup (before any activity runs)
 * and configures the worker with all required activities and workflows.
 *
 * @param options - Worker configuration options
 * @returns Configured Worker instance ready to run
 *
 * @example
 * ```typescript
 * const worker = await createDevAgentWorker({
 *   address: 'localhost:7233',
 *   namespace: 'default',
 * });
 * await worker.run();
 * ```
 */
export async function createDevAgentWorker(
  options: DevAgentWorkerOptions = {},
): Promise<Worker> {
  const address =
    options.address ?? process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace =
    options.namespace ?? process.env.TEMPORAL_NAMESPACE ?? "default";

  logger.info({ address, namespace }, "Creating dev-agent worker");

  // Create dependencies
  logger.info({}, "Creating dev container dependencies");
  const manager = createDevContainerManager({
    db: db as unknown as Parameters<typeof createDevContainerManager>[0]["db"],
    logger,
  });
  const cleanup = createDevContainerCleanup({
    db: db as unknown as Parameters<typeof createDevContainerCleanup>[0]["db"],
    logger,
  });
  const git = createDevContainerGit({ manager, logger });
  logger.info({}, "Dev container dependencies created");

  // Initialize checkpointer BEFORE creating worker
  logger.info({}, "Initializing PostgreSQL checkpointer");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const checkpointer = await PostgresSaver.fromConnString(databaseUrl);
  await checkpointer.setup();
  logger.info({}, "Checkpointer initialized");

  // Get config from environment
  const repoUrl = process.env.GITHUB_REPO_URL;
  const githubToken = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const baseBranch = process.env.GITHUB_BASE_BRANCH || "main";
  const slackChannel = process.env.DEV_AGENT_SLACK_CHANNEL;

  if (!repoUrl || !githubToken || !owner || !repo || !slackChannel) {
    logger.error(
      {
        repoUrl: !!repoUrl,
        githubToken: !!githubToken,
        owner,
        repo,
        slackChannel,
      },
      "Missing required environment variables",
    );
    throw new Error(
      "Missing required environment variables: GITHUB_REPO_URL, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, DEV_AGENT_SLACK_CHANNEL",
    );
  }

  logger.info(
    { owner, repo, baseBranch, slackChannel },
    "Configuration loaded",
  );

  // Create LLM instance
  const llm = new ChatAnthropic({
    modelName: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    temperature: 0,
  });

  logger.info({}, "LLM instance created");

  // Initialize activities with dependencies
  logger.info({}, "Initializing dev-agent activities");
  initDevAgentActivities({
    manager,
    cleanup,
    git,
    repoUrl,
    githubToken,
    owner,
    repo,
    baseBranch,
    slackChannel,
    llm,
    checkpointer,
  });
  logger.info({}, "Activities initialized");

  // Connect to Temporal
  logger.info({ address }, "Connecting to Temporal");
  const connection = await NativeConnection.connect({ address });
  logger.info({}, "Connected to Temporal");

  // Configure worker options
  const workerOptions: WorkerOptions = {
    connection,
    namespace,
    taskQueue: "dev-agent",

    // Workflows are loaded via workflowsPath for bundling
    workflowsPath: new URL(
      "../shared/temporal/workflows/dev-agent-workflow.js",
      import.meta.url,
    ).pathname,

    // Activities are registered directly
    activities: {
      runDevAgentGraphActivity,
      continueAfterApprovalActivity,
      handlePRFeedbackActivity,
      stopContainerActivity,
      sendReminderActivity,
      updateSlackApprovalActivity,
      syncApprovalToLinearActivity,
      handleRePlanActivity,
      completeTaskActivity,
      handlePRClosedActivity,
    },
  };

  // Create and return the worker
  const worker = await Worker.create(workerOptions);
  logger.info(
    { taskQueue: "dev-agent" },
    "Dev-agent worker created, ready to poll",
  );

  return worker;
}

/**
 * Create and configure the orchestrator Temporal worker (v2.2).
 *
 * Registers the simplified orchestrator workflow and its activities
 * on the 'dev-agent-v2' task queue. Uses separate proxyActivities
 * configs in the workflow for different retry characteristics.
 *
 * Does NOT modify the legacy worker -- both can coexist during
 * the transition period (Phase 35 removes the legacy).
 *
 * @param options - Worker configuration options
 * @returns Configured Worker instance ready to run
 *
 * @example
 * ```typescript
 * const worker = await createOrchestratorWorker({
 *   address: 'localhost:7233',
 *   namespace: 'default',
 * });
 * await worker.run();
 * ```
 */
export async function createOrchestratorWorker(
  options: DevAgentWorkerOptions = {},
): Promise<Worker> {
  const address =
    options.address ?? process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace =
    options.namespace ?? process.env.TEMPORAL_NAMESPACE ?? "default";

  const workerLogger: PinoLogger = createPinoLogger({
    component: "agents:dev-agent:orchestrator-worker",
  });

  workerLogger.info({ address, namespace }, "Creating orchestrator worker");

  // Create platform dependencies
  const manager = createDevContainerManager({
    db: db as unknown as Parameters<typeof createDevContainerManager>[0]["db"],
    logger: workerLogger,
  });
  const cleanup = createDevContainerCleanup({
    db: db as unknown as Parameters<typeof createDevContainerCleanup>[0]["db"],
    logger: workerLogger,
  });
  const git = createDevContainerGit({ manager, logger: workerLogger });

  // Create agents-specific dependencies (Phase 29)
  const contextManager = createContextManager({
    db: db as unknown as Parameters<typeof createContextManager>[0]["db"],
    logger: workerLogger,
  });
  const taskStore = createTaskStore({
    db: db as unknown as Parameters<typeof createTaskStore>[0]["db"],
    logger: workerLogger,
  });

  // Get config from environment
  const repoUrl = process.env.GITHUB_REPO_URL;
  const githubToken = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const baseBranch = process.env.GITHUB_BASE_BRANCH || "main";
  const slackChannel = process.env.DEV_AGENT_SLACK_CHANNEL;

  if (!repoUrl || !githubToken || !owner || !repo || !slackChannel) {
    workerLogger.error(
      {
        repoUrl: !!repoUrl,
        githubToken: !!githubToken,
        owner,
        repo,
        slackChannel,
      },
      "Missing required environment variables",
    );
    throw new Error(
      "Missing required environment variables: GITHUB_REPO_URL, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, DEV_AGENT_SLACK_CHANNEL",
    );
  }

  workerLogger.info(
    { owner, repo, baseBranch, slackChannel },
    "Configuration loaded",
  );

  // Initialize orchestrator activities with all dependencies
  initOrchestratorActivities({
    containerManager: manager,
    cleanup,
    git,
    contextManager,
    taskStore,
    db: db as unknown as OrchestratorActivitiesDeps["db"],
    logger: workerLogger,
    repoUrl,
    githubToken,
    owner,
    repo,
    baseBranch,
    slackChannel,
  });

  workerLogger.info("Orchestrator activities initialized");

  // Connect to Temporal
  const connection = await NativeConnection.connect({ address });
  workerLogger.info({ address }, "Connected to Temporal");

  // Create worker on dev-agent-v2 task queue (separate from legacy)
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: "dev-agent-v2",
    workflowsPath: new URL(
      "../shared/temporal/workflows/orchestrator-workflow.js",
      import.meta.url,
    ).pathname,
    activities: {
      // Orchestrator activities (45min timeout, 2 retries in workflow proxy)
      runOrchestratorPreApproval,
      runOrchestratorPostApproval,
      handleOrchestratorFeedback,
      // Infrastructure activities (5min timeout, 3 retries in workflow proxy)
      setupContainerActivity,
      stopContainerActivity: orchestratorStopContainerActivity,
      completeTaskActivity: orchestratorCompleteTaskActivity,
    },
  });

  workerLogger.info(
    { taskQueue: "dev-agent-v2" },
    "Orchestrator worker created, ready to poll",
  );

  return worker;
}

/**
 * Bootstrap the worker as a standalone process.
 *
 * This is the entry point when running `node dist/dev-agent/worker.js`
 * for the dev-agent-worker container.
 */
async function bootstrap(): Promise<void> {
  const worker = await createDevAgentWorker();

  // Graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress, ignoring");
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");
    worker.shutdown();
    logger.info("Worker shutdown initiated, waiting for completion...");
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Run worker (blocks until shutdown)
  logger.info("Starting worker...");
  await worker.run();
  logger.info("Worker stopped");
}

// Run if this is the main module
// biome-ignore lint/suspicious/noConsole: intentional early boot logging
console.log("[dev-agent-worker] Starting worker process...");
bootstrap().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: intentional error logging at process exit
  console.error("[dev-agent-worker] Bootstrap failed:", error);
  process.exit(1);
});
