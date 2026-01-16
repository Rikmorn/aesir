/**
 * Temporal Worker Setup
 *
 * Creates and runs a Temporal worker that executes workflows and activities.
 * The worker connects to a Temporal server and polls for tasks on a specific queue.
 */

import { Worker, NativeConnection } from "@temporalio/worker";

import { createLogger } from "../logging/logger.js";

const logger = createLogger({ defaultContext: { module: "temporal-worker" } });

/**
 * Configuration for creating a Temporal worker
 */
export interface WorkerConfig {
  /** Temporal server address (default: localhost:7233 or TEMPORAL_ADDRESS env var) */
  address?: string;
  /** Temporal namespace (default: 'default' or TEMPORAL_NAMESPACE env var) */
  namespace?: string;
  /** Task queue name (required) - workflows and activities are routed via this queue */
  taskQueue: string;
}

/**
 * Create a Temporal worker configured for the Aesir approval workflow
 *
 * The worker will load workflow definitions from the workflows directory
 * and activity implementations from the activities directory.
 *
 * @param config Worker configuration including connection details and task queue
 * @returns A configured Worker instance ready to run
 */
export async function createTemporalWorker(config: WorkerConfig): Promise<Worker> {
  const address = config.address ?? process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
  const namespace = config.namespace ?? process.env["TEMPORAL_NAMESPACE"] ?? "default";

  logger.info("temporal_worker_connecting", {
    message: `Connecting to Temporal at ${address}`,
    context: { address, namespace, taskQueue: config.taskQueue },
  });

  const connection = await NativeConnection.connect({ address });

  // Import activities dynamically to avoid circular dependencies
  // Activities will be defined in subsequent plans
  let activities: object = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imported = require("./activities/index.js");
    if (imported) {
      activities = imported as object;
    }
  } catch {
    // Activities not yet defined - worker can still run for development
    logger.debug("temporal_worker_no_activities", {
      message: "No activities module found, worker will run without activities",
    });
  }

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: config.taskQueue,
    // Workflows are bundled separately due to Temporal's isolation requirements
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities,
  });

  logger.info("temporal_worker_created", {
    outcome: "success",
    message: "Temporal worker created",
    context: { taskQueue: config.taskQueue },
  });

  return worker;
}

/**
 * Run a Temporal worker
 *
 * This is a blocking call that runs until the worker is shut down.
 * Typically called from a dedicated worker process entry point.
 *
 * @param config Worker configuration
 */
export async function runWorker(config: WorkerConfig): Promise<void> {
  const worker = await createTemporalWorker(config);

  logger.info("temporal_worker_starting", {
    message: "Starting Temporal worker",
    context: { taskQueue: config.taskQueue },
  });

  await worker.run();
}
