#!/usr/bin/env bun
/**
 * Cleanup Script
 *
 * Manual trigger for data cleanup.
 *
 * Usage:
 *   bun src/scripts/run-cleanup.ts [--dry-run]
 *   npm run cleanup
 *   npm run cleanup -- --dry-run
 */

import { createPinoLogger } from "@aesir/platform";
import { Pool } from "pg";
import { createCleanupService } from "../services/cleanup.js";

async function main(): Promise<void> {
  const logger = createPinoLogger({ component: "platform:scripts:cleanup" });
  const dryRun = process.argv.includes("--dry-run");

  logger.info({ dryRun }, "Starting cleanup script");

  // Create database connection using environment variables
  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: Number.parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USER || "aesir",
    password: process.env.DB_PASSWORD || "aesir",
    database: process.env.DB_NAME || "aesir",
  });

  try {
    const cleanup = createCleanupService({
      pool,
      logger,
      retentionDays: Number.parseInt(process.env.RETENTION_DAYS || "14", 10),
      batchSize: 1000,
    });

    const result = await cleanup.run({ dryRun });

    if (result.isErr()) {
      logger.error(
        { err: result.error, code: result.error.code },
        "Cleanup failed",
      );
      await pool.end();
      process.exit(1);
    }

    logger.info({ report: result.value }, "Cleanup complete");

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
