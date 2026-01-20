/**
 * Log Capture Utility for Testing
 *
 * Provides utilities for capturing and verifying pino log output during tests.
 * Uses pino's destination feature to intercept log entries.
 */

import { Transform } from "node:stream";
import type { Logger } from "pino";
import pino from "pino";

/**
 * Captured log entry from pino output.
 * Fields match pino's JSON output structure.
 */
export interface CapturedLog {
  level: string;
  time: number;
  timestamp: string;
  msg: string;
  service?: string;
  component?: string;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Log capture class for intercepting and querying pino logs in tests.
 */
export class LogCapture {
  private logs: CapturedLog[] = [];
  private destination: Transform;

  constructor() {
    // Create a transform stream that captures log lines
    this.destination = new Transform({
      objectMode: false,
      transform: (chunk: Buffer, _encoding, callback) => {
        try {
          const line = chunk.toString().trim();
          if (line) {
            const entry = JSON.parse(line) as CapturedLog;
            this.logs.push(entry);
          }
        } catch {
          // Ignore non-JSON lines
        }
        callback();
      },
    });
  }

  /**
   * Create a pino logger that writes to this capture.
   * Use this in tests instead of the real createLogger.
   *
   * @example
   * ```typescript
   * const capture = new LogCapture();
   * const logger = capture.createLogger({ component: 'test' });
   * logger.info({ data: 'value' }, 'Test message');
   * expect(capture.getAll()).toHaveLength(1);
   * ```
   */
  createLogger(options: { service?: string; component?: string } = {}): Logger {
    return pino(
      {
        level: "trace", // Capture all levels
        base: {
          service: options.service ?? "test",
          ...(options.component && { component: options.component }),
        },
        timestamp: () => {
          const now = new Date();
          return `,"timestamp":"${now.toISOString()}","time":${now.getTime()}`;
        },
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      this.destination,
    );
  }

  /**
   * Get all captured logs.
   */
  getAll(): CapturedLog[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level.
   */
  getByLevel(level: string): CapturedLog[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Get logs filtered by component.
   */
  getByComponent(component: string): CapturedLog[] {
    return this.logs.filter((log) => log.component === component);
  }

  /**
   * Get logs that contain a specific message substring.
   */
  getByMessage(substring: string): CapturedLog[] {
    return this.logs.filter((log) => log.msg?.includes(substring));
  }

  /**
   * Find the first log matching a predicate.
   */
  find(predicate: (log: CapturedLog) => boolean): CapturedLog | undefined {
    return this.logs.find(predicate);
  }

  /**
   * Check if any log matches a predicate.
   */
  has(predicate: (log: CapturedLog) => boolean): boolean {
    return this.logs.some(predicate);
  }

  /**
   * Get the count of captured logs.
   */
  get count(): number {
    return this.logs.length;
  }

  /**
   * Clear all captured logs.
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Assert that a log with specific properties exists.
   * Throws if no match found.
   */
  assertHas(criteria: {
    level?: string;
    component?: string;
    msg?: string;
  }): CapturedLog {
    const match = this.logs.find((log) => {
      if (criteria.level && log.level !== criteria.level) return false;
      if (criteria.component && log.component !== criteria.component)
        return false;
      if (criteria.msg && !log.msg?.includes(criteria.msg)) return false;
      return true;
    });

    if (!match) {
      const criteriaStr = JSON.stringify(criteria);
      const availableLogs = this.logs
        .map((l) => `  ${l.level}: ${l.msg}`)
        .join("\n");
      throw new Error(
        `No log matching ${criteriaStr} found.\nAvailable logs:\n${availableLogs || "  (none)"}`,
      );
    }

    return match;
  }
}

/**
 * Create a new log capture instance for testing.
 */
export function createLogCapture(): LogCapture {
  return new LogCapture();
}
