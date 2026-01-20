/**
 * Observability Database Schema - Drizzle-Kit Version
 *
 * This file is used by drizzle-kit for migration generation.
 * It mirrors schema.ts but without external dependencies that
 * drizzle-kit's CJS bundler cannot resolve.
 *
 * Keep in sync with schema.ts.
 *
 * NOTE: This is a stub schema. Tables (agent_executions, etc.) will be
 * added in Phase 14 (Platform Services) when execution tracking is implemented.
 */

import { pgSchema } from "drizzle-orm/pg-core";

export const observabilitySchema = pgSchema("observability");

/**
 * Tables to be added in Phase 14:
 * - agent_executions: Tracks agent execution start/end times and status
 * - execution_steps: Individual steps within an execution (optional)
 * - execution_metrics: Performance metrics per execution (optional)
 */
