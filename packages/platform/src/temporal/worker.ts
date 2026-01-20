/**
 * Temporal Worker Setup
 *
 * Creates and runs a Temporal worker that executes workflows and activities.
 * The worker connects to a Temporal server and polls for tasks on a specific queue.
 *
 * Activities are passed in from @aesir/agents via the config.activities parameter.
 */

import { createPinoLogger } from "@aesir/common";
import { NativeConnection, Worker } from "@temporalio/worker";

const logger = createPinoLogger({ component: "platform:temporal" });

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
  /** Bound activities - created via makeActivities() from @aesir/agents */
  activities?: object;
}

/**
 * Create a Temporal worker configured for the Aesir approval workflow
 *
 * The worker will load workflow definitions from the workflows directory
 * and activity implementations via the makeActivities factory.
 *
 * @param config Worker configuration including connection details and task queue
 * @returns A configured Worker instance ready to run
 */
export async function createTemporalWorker(
  config: WorkerConfig,
): Promise<Worker> {
  const address =
    config.address ?? process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace =
    config.namespace ?? process.env.TEMPORAL_NAMESPACE ?? "default";

  logger.info(
    { address, namespace, taskQueue: config.taskQueue },
    `Connecting to Temporal at ${address}`,
  );

  const connection = await NativeConnection.connect({ address });

  // Use provided activities (bound via makeActivities from @aesir/agents)
  const activities = config.activities ?? {};
  if (Object.keys(activities).length === 0) {
    logger.warn("No activities provided, workflow activity calls will fail");
  } else {
    logger.info(
      { activityCount: Object.keys(activities).length },
      "Activities provided for worker",
    );
  }

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: config.taskQueue,
    // Workflows are bundled separately due to Temporal's isolation requirements
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities,
  });

  logger.info({ taskQueue: config.taskQueue }, "Temporal worker created");

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

  logger.info({ taskQueue: config.taskQueue }, "Starting Temporal worker");

  await worker.run();
}
