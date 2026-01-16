/**
 * Temporal Activities Index
 *
 * Re-exports all activities for worker registration.
 * Activities wrap existing integration code to make them
 * callable from Temporal workflows with retry and timeout support.
 */

// Dev agent activity
export { executeDevWorkflow } from "./dev-agent-activity.js";

// GitHub activities
export {
  mergePRActivity,
  type MergePRInput,
  type MergePROutput,
} from "./github-activities.js";

// Slack activities
export {
  sendApprovalRequestActivity,
  sendStatusUpdateActivity,
} from "./slack-activities.js";

// Linear activities
export { updateLinearStatusActivity } from "./linear-activities.js";
