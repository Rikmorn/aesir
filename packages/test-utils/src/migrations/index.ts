/**
 * Test Database Migrations
 *
 * Reads each package's real migration files. The hand-copied schema snapshots
 * that used to live here drifted from the migrations they mirrored (#42).
 */

export { readJournalMigrations } from "./from-journal.js";
