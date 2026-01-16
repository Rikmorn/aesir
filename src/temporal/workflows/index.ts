/**
 * Temporal Workflow Definitions
 *
 * Workflows define the durable execution logic for approval gates.
 * These will be implemented in subsequent plans.
 *
 * Note: Workflow code has special restrictions:
 * - Must be deterministic (no Math.random(), Date.now(), etc.)
 * - Cannot call external APIs directly (use activities instead)
 * - Must use Temporal's workflow API for time and randomness
 */

// Workflows will be exported here as they are implemented
// Example:
// export { approvalWorkflow } from './approval-workflow.js';
