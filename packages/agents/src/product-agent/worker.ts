/**
 * Product Agent Temporal Worker
 *
 * Creates and configures the Temporal worker for product-agent workflows.
 * Polls the 'product-agent' task queue and executes conversation workflows.
 *
 * Key responsibilities:
 * - Initialize checkpointer before any activity runs
 * - Register productAgentConversationWorkflow
 * - Register all required activities (product-agent-activity, slack-activities)
 * - Poll 'product-agent' task queue
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import {
  NativeConnection,
  Worker,
  type WorkerOptions,
} from "@temporalio/worker";
import { createProductAgentCheckpointer } from "./workflow/checkpointer.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:product-agent:worker",
});

/**
 * Worker configuration options
 */
export interface ProductAgentWorkerOptions {
  /** Temporal server address (default: localhost:7233 or TEMPORAL_ADDRESS env var) */
  address?: string;
  /** Temporal namespace (default: 'default' or TEMPORAL_NAMESPACE env var) */
  namespace?: string;
}

/**
 * Create and configure the product-agent Temporal worker.
 *
 * Initializes the checkpointer at startup (before any activity runs)
 * and configures the worker with all required activities and workflows.
 *
 * @param options - Worker configuration options
 * @returns Configured Worker instance ready to run
 *
 * @example
 * ```typescript
 * const worker = await createProductAgentWorker({
 *   address: 'localhost:7233',
 *   namespace: 'default',
 * });
 * await worker.run();
 * ```
 */
export async function createProductAgentWorker(
  options: ProductAgentWorkerOptions = {},
): Promise<Worker> {
  const address =
    options.address ?? process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace =
    options.namespace ?? process.env.TEMPORAL_NAMESPACE ?? "default";

  logger.info({ address, namespace }, "Creating product-agent worker");

  // Initialize checkpointer BEFORE creating worker
  // This ensures activities can use getProductAgentCheckpointer()
  logger.info({}, "Initializing PostgreSQL checkpointer");
  await createProductAgentCheckpointer();
  logger.info({}, "Checkpointer initialized");

  // Connect to Temporal
  logger.info({ address }, "Connecting to Temporal");
  const connection = await NativeConnection.connect({ address });
  logger.info({}, "Connected to Temporal");

  // Configure worker options
  const workerOptions: WorkerOptions = {
    connection,
    namespace,
    taskQueue: "product-agent",

    // Workflows are loaded via workflowsPath for bundling
    workflowsPath: new URL(
      "../shared/temporal/workflows/product-agent-workflow.js",
      import.meta.url,
    ).pathname,

    // Activities are imported directly
    activities: await loadActivities(),
  };

  // Create and return the worker
  const worker = await Worker.create(workerOptions);
  logger.info(
    { taskQueue: "product-agent" },
    "Product-agent worker created, ready to poll",
  );

  return worker;
}

/**
 * Load and bind activities for the worker.
 *
 * Activities use MCP for integration communication,
 * so they don't need client injection.
 */
async function loadActivities(): Promise<Record<string, unknown>> {
  // Import activity modules
  const productAgentActivity = await import(
    "../shared/temporal/activities/product-agent-activity.js"
  );
  const slackActivities = await import(
    "../shared/temporal/activities/slack-activities.js"
  );

  logger.info({}, "Activities loaded");

  return {
    // Product agent activity - runs LangGraph
    runProductAgentActivity: productAgentActivity.runProductAgentActivity,

    // Slack activities - for sending messages
    sendSlackReplyActivity: slackActivities.sendSlackReplyActivity,
    sendApprovalRequestActivity: slackActivities.sendApprovalRequestActivity,
    sendStatusUpdateActivity: slackActivities.sendStatusUpdateActivity,
  };
}
