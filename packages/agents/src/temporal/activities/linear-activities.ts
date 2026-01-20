/**
 * Linear Temporal Activities
 *
 * Wraps Linear operations as Temporal activities.
 * Activities receive pre-configured LinearClient from the workflow.
 */

import { createLogger, type IssueStatus } from "@aesir/common";
import { updateIssueStatus } from "@aesir/integrations";
import type { LinearClient } from "@linear/sdk";

const logger = createLogger({
  defaultContext: { module: "temporal-activity-linear" },
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
  logger.info("activity_linear_update_status", {
    message: `Updating issue ${issueId} to ${statusName}`,
    context: { issueId, statusName },
  });

  await updateIssueStatus(client, issueId, statusName);

  logger.info("activity_linear_update_status_complete", {
    outcome: "success",
    message: `Issue ${issueId} updated to ${statusName}`,
    context: { issueId, statusName },
  });
}
