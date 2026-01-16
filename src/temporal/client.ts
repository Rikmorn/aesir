/**
 * Temporal Client Factory
 *
 * Provides client instances for starting workflows and sending signals.
 * Used by API endpoints and webhook handlers to interact with running workflows.
 */

import { Client, Connection } from "@temporalio/client";

import { createLogger } from "../logging/logger.js";
import { approvalSignal, changesRequestedSignal } from "./signals.js";
import type { ApprovalDecision, ChangesRequested } from "./types.js";

const logger = createLogger({ defaultContext: { module: "temporal-client" } });

/**
 * Configuration for Temporal client connection
 */
export interface ClientConfig {
  /** Temporal server address (default: localhost:7233 or TEMPORAL_ADDRESS env var) */
  address?: string;
  /** Temporal namespace (default: 'default' or TEMPORAL_NAMESPACE env var) */
  namespace?: string;
}

/** Cached client instance to avoid reconnecting on every call */
let cachedClient: Client | null = null;

/**
 * Get a Temporal client instance
 *
 * Returns a cached client if one exists, otherwise creates a new connection.
 * The client is used to start workflows, send signals, and query workflow state.
 *
 * @param config Optional connection configuration
 * @returns A connected Temporal client
 */
export async function getTemporalClient(config: ClientConfig = {}): Promise<Client> {
  if (cachedClient) {
    return cachedClient;
  }

  const address = config.address ?? process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
  const namespace = config.namespace ?? process.env["TEMPORAL_NAMESPACE"] ?? "default";

  logger.debug("temporal_client_connecting", {
    message: `Creating Temporal client for ${address}`,
    context: { address, namespace },
  });

  const connection = await Connection.connect({ address });
  cachedClient = new Client({ connection, namespace });

  logger.info("temporal_client_created", {
    outcome: "success",
    message: "Temporal client connected",
    context: { address, namespace },
  });

  return cachedClient;
}

/**
 * Clear the cached client (useful for testing or reconnection)
 */
export function clearClientCache(): void {
  cachedClient = null;
}

/**
 * Send an approval signal to a running workflow
 *
 * This is called when a human approves or rejects the agent's work.
 * Typically triggered by a GitHub PR review or Slack interaction.
 *
 * @param workflowId The workflow ID to signal (usually "approval-{taskId}")
 * @param decision The approval decision with reviewer info
 */
export async function sendApprovalSignal(
  workflowId: string,
  decision: ApprovalDecision
): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);

  await handle.signal(approvalSignal, decision);

  logger.info("temporal_approval_signal_sent", {
    outcome: "success",
    message: `Approval signal sent to workflow ${workflowId}`,
    context: {
      workflowId,
      approved: decision.approved,
      reviewer: decision.reviewer,
    },
  });
}

/**
 * Send a changes-requested signal to a running workflow
 *
 * This is called when a reviewer requests changes on a PR.
 * The workflow can then decide whether to attempt automatic fixes or escalate.
 *
 * @param workflowId The workflow ID to signal
 * @param changesRequested The feedback requesting changes
 */
export async function sendChangesRequestedSignal(
  workflowId: string,
  changesRequested: ChangesRequested
): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);

  await handle.signal(changesRequestedSignal, changesRequested);

  logger.info("temporal_changes_requested_signal_sent", {
    outcome: "success",
    message: `Changes requested signal sent to workflow ${workflowId}`,
    context: {
      workflowId,
      reviewer: changesRequested.reviewer,
    },
  });
}
