/**
 * Slack Integration Package
 *
 * Provides Slack integration functionality including:
 * - Bolt app factory with PostgreSQL-backed credential storage
 * - Events API handling with deduplication
 * - OAuth flow for app installation
 * - Thread-aware message posting with Block Kit
 * - HTTP API layer for production deployment
 *
 * @module @aesir/integration-slack
 */

// === API ===
export * from "./api/index.js";
// === CLIENT ===
export * from "./client/index.js";
// === DATABASE ===
export * from "./db/index.js";
// === EVENTS ===
export * from "./events/index.js";

// === MESSAGES ===
export * from "./messages/index.js";

// === OAUTH ===
export * from "./oauth/index.js";
// === TYPES ===
export * from "./types/index.js";
