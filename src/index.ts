/**
 * Aesir - Agentic Development Platform
 *
 * Entry point for the application.
 */

import { config } from "dotenv";

// Load environment variables
config();

export { logger, createLogger, type LogEntry, type LogLevel } from "./logging/index.js";
