/**
 * Observability Database Schema
 *
 * Defines tables for the observability layer (agent executions, metrics).
 * Uses pgSchema for schema namespace isolation.
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

// Type exports will be added when tables are defined in Phase 14
