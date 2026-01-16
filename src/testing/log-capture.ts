/**
 * Log Capture Utility for Testing
 *
 * Provides utilities for capturing and verifying log output during tests.
 * Integrates with the Logger class to intercept structured log entries.
 */

import type { LogEntry, LogLevel } from "../logging/index.js";

/**
 * Captured log entry with additional test utilities
 */
export interface CapturedLog extends LogEntry {
  /** Index in the capture sequence */
  captureIndex: number;
}

/**
 * Log capture class for intercepting and querying logs
 */
export class LogCapture {
  private logs: CapturedLog[] = [];

  /**
   * Output handler to be passed to Logger constructor
   * Use this as the `output` option when creating a logger for testing
   */
  readonly captureHandler = (entry: LogEntry): void => {
    this.logs.push({
      ...entry,
      captureIndex: this.logs.length,
    });
  };

  /**
   * Get all captured logs
   */
  getAll(): CapturedLog[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by thread ID
   */
  getByThread(threadId: string): CapturedLog[] {
    return this.logs.filter((log) => log.context.threadId === threadId);
  }

  /**
   * Get logs filtered by action
   */
  getByAction(action: string): CapturedLog[] {
    return this.logs.filter((log) => log.action === action);
  }

  /**
   * Get logs filtered by level
   */
  getByLevel(level: LogLevel): CapturedLog[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Find the first log matching a predicate
   */
  find(predicate: (log: CapturedLog) => boolean): CapturedLog | undefined {
    return this.logs.find(predicate);
  }

  /**
   * Filter logs by predicate
   */
  filter(predicate: (log: CapturedLog) => boolean): CapturedLog[] {
    return this.logs.filter(predicate);
  }

  /**
   * Check if any log matches a predicate
   */
  has(predicate: (log: CapturedLog) => boolean): boolean {
    return this.logs.some(predicate);
  }

  /**
   * Get the count of captured logs
   */
  get count(): number {
    return this.logs.length;
  }

  /**
   * Clear all captured logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Get logs that match action and have specific context properties
   */
  getByActionWithContext(
    action: string,
    contextMatch: Partial<LogEntry["context"]>
  ): CapturedLog[] {
    return this.logs.filter((log) => {
      if (log.action !== action) return false;

      // Check all properties in contextMatch exist and match
      for (const [key, value] of Object.entries(contextMatch)) {
        if (log.context[key] !== value) return false;
      }
      return true;
    });
  }

  /**
   * Assert that a log with specific properties exists
   * Returns the matching log for further assertions
   */
  assertHas(
    criteria: Partial<{
      action: string;
      level: LogLevel;
      outcome: LogEntry["outcome"];
      threadId: string;
    }>
  ): CapturedLog {
    const match = this.logs.find((log) => {
      if (criteria.action && log.action !== criteria.action) return false;
      if (criteria.level && log.level !== criteria.level) return false;
      if (criteria.outcome && log.outcome !== criteria.outcome) return false;
      if (criteria.threadId && log.context.threadId !== criteria.threadId)
        return false;
      return true;
    });

    if (!match) {
      const criteriaStr = JSON.stringify(criteria);
      const availableLogs = this.logs
        .map((l) => `  ${l.action} (${l.level})`)
        .join("\n");
      throw new Error(
        `No log matching ${criteriaStr} found.\nAvailable logs:\n${availableLogs || "  (none)"}`
      );
    }

    return match;
  }
}

/**
 * Create a new log capture instance
 */
export function createLogCapture(): LogCapture {
  return new LogCapture();
}
