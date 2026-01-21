#!/usr/bin/env npx tsx
/**
 * Cleanup Script
 *
 * Manual trigger for data cleanup.
 *
 * Usage:
 *   npx tsx src/scripts/run-cleanup.ts [--dry-run]
 *   npm run cleanup
 *   npm run cleanup -- --dry-run
 */

import { config, createPinoLogger } from "@aesir/common";
import { Pool } from "pg";
import { createCleanupService } from "../services/cleanup.js";

async function main(): Promise<void> {
  const logger = createPinoLogger({ component: "platform:scripts:cleanup" });
  const dryRun = process.argv.includes("--dry-run");

  logger.info({ dryRun }, "Starting cleanup script");

  // Create database connection using config
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
  });

  try {
    const cleanup = createCleanupService({
      pool,
      logger,
      retentionDays: config.retention.days,
      batchSize: 1000,
    });

    const report = await cleanup.run({ dryRun });

    logger.info({ report }, "Cleanup complete");

    // Exit with success
    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Cleanup failed");
    await pool.end();
    process.exit(1);
  }
}

main();
