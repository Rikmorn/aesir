/**
 * Linear Temporal Activities
 *
 * Wraps Linear operations as Temporal activities using MCP calls.
 * Activities communicate with the Linear integration service via HTTP.
 */

import type { IssueStatus } from "@aesir/common";
import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import { callMcpTool } from "../../mcp/index.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:temporal:linear-activities",
});

/**
 * Update Linear issue status as a Temporal activity.
 *
 * The status name (e.g., "Done", "In Review") is configurable - not hardcoded.
 *
 * @param issueId - Linear issue ID or identifier
 * @param statusName - Target status name (configurable, not hardcoded)
 * @returns void
 */
export async function updateLinearStatusActivity(
  issueId: string,
  statusName: IssueStatus,
): Promise<void> {
  logger.info(
    { issueId, statusName },
    `Updating issue ${issueId} to ${statusName}`,
  );

  // Call Linear integration service via MCP
  await callMcpTool({
    integration: "linear",
    tool: "update_issue_status",
    params: { issueId, status: statusName },
    agentId: "temporal-worker",
    correlationId: `linear-activity-${issueId}`,
  });

  logger.info(
    { issueId, statusName },
    `Issue ${issueId} updated to ${statusName}`,
  );
}
