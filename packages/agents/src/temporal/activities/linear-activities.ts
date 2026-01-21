/**
 * Linear Temporal Activities
 *
 * Wraps Linear operations as Temporal activities.
 * Activities receive pre-configured LinearClient from the workflow.
 */

import {
  createPinoLogger,
  type IssueStatus,
  type PinoLogger,
} from "@aesir/common";
import { updateIssueStatus } from "@aesir/integration-linear";
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

  await updateIssueStatus(client, issueId, statusName);

  logger.info(
    { issueId, statusName },
    `Issue ${issueId} updated to ${statusName}`,
  );
}
