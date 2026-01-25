/**
 * Linear Temporal Activities
 *
 * Wraps Linear operations as Temporal activities.
 * Activities receive pre-configured LinearClient from the workflow.
 *
 * NOTE: Uses dynamic import for @aesir/integration-linear to avoid
 * triggering config validation at module load time. This allows agents
 * to start without Linear credentials (MCP migration).
 */

import {
  createPinoLogger,
  type IssueStatus,
  type PinoLogger,
} from "@aesir/common";
import type { LinearClient } from "@linear/sdk";

const logger: PinoLogger = createPinoLogger({
  component: "agents:temporal:linear-activities",
});

/**
 * Update Linear issue status as a Temporal activity.
 *
 * The status name (e.g., "Done", "In Review") is configurable - not hardcoded.
 *
 * @param client - Pre-configured LinearClient instance
 * @param issueId - Linear issue ID or identifier
 * @param statusName - Target status name (configurable, not hardcoded)
 * @returns void
 */
export async function updateLinearStatusActivity(
  client: LinearClient,
  issueId: string,
  statusName: IssueStatus,
): Promise<void> {
  logger.info(
    { issueId, statusName },
    `Updating issue ${issueId} to ${statusName}`,
  );

  // Dynamic import to avoid triggering Linear config validation at module load
  const { updateIssueStatus } = await import("@aesir/integration-linear");
  await updateIssueStatus(client, issueId, statusName);

  logger.info(
    { issueId, statusName },
    `Issue ${issueId} updated to ${statusName}`,
  );
}
