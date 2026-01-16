/**
 * Structured Logger for Agent Activity
 *
 * Captures agent activity in a structured JSON format suitable for querying.
 * Outputs one JSON object per line for easy log aggregation.
 */

/**
 * Log levels ordered by severity
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Context information for log correlation
 */
export interface LogContext {
  /** Agent thread/session identifier */
  threadId?: string;
  /** External task reference (e.g., Linear task ID) */
  taskId?: string;
  /** Which agent produced this log */
  agentId?: string;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * Structured log entry format
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** What happened (e.g., "tool_call", "llm_request", "agent_start") */
  action: string;
  /** Correlation and contextual information */
  context: LogContext;
  /** Operation outcome */
  outcome?: "success" | "failure" | "pending";
  /** Human-readable description */
  message?: string;
  /** Duration for timed operations in milliseconds */
  durationMs?: number;
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Minimum log level to output (default: "info") */
  minLevel?: LogLevel;
  /** Default context applied to all log entries */
  defaultContext?: LogContext;
  /** Whether to output to console (default: true in development) */
  console?: boolean;
  /** Custom output handler */
  output?: (entry: LogEntry) => void;
}

/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Timer for measuring operation duration
 */
export interface Timer {
  /** Stop the timer and return elapsed milliseconds */
  stop: () => number;
  /** Get elapsed time without stopping */
  elapsed: () => number;
}

/**
 * Create a timer for measuring operation duration
 */
export function createTimer(): Timer {
  const start = performance.now();

  return {
    stop: () => Math.round(performance.now() - start),
    elapsed: () => Math.round(performance.now() - start),
  };
}

/**
 * Structured logger class
 */
export class Logger {
  private readonly minLevel: LogLevel;
  private readonly defaultContext: LogContext;
  private readonly useConsole: boolean;
  private readonly customOutput: ((entry: LogEntry) => void) | null;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? "info";
    this.defaultContext = options.defaultContext ?? {};
    this.useConsole = options.console ?? process.env["NODE_ENV"] !== "production";
    this.customOutput = options.output ?? null;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /**
   * Format and output a log entry
   */
  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const jsonLine = JSON.stringify(entry);

    if (this.customOutput) {
      this.customOutput(entry);
    }

    if (this.useConsole) {
      // Use appropriate console method based on level
      switch (entry.level) {
        case "debug":
          console.debug(jsonLine);
          break;
        case "info":
          console.info(jsonLine);
          break;
        case "warn":
          console.warn(jsonLine);
          break;
        case "error":
          console.error(jsonLine);
          break;
      }
    }
  }

  /**
   * Create a log entry with the given parameters
   */
  private createEntry(
    level: LogLevel,
    action: string,
    options: {
      context?: LogContext;
      outcome?: LogEntry["outcome"];
      message?: string;
      durationMs?: number;
    } = {}
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      action,
      context: { ...this.defaultContext, ...options.context },
      ...(options.outcome !== undefined && { outcome: options.outcome }),
      ...(options.message !== undefined && { message: options.message }),
      ...(options.durationMs !== undefined && { durationMs: options.durationMs }),
    };
  }

  /**
   * Log a debug message
   */
  debug(
    action: string,
    options?: {
      context?: LogContext;
      outcome?: LogEntry["outcome"];
      message?: string;
      durationMs?: number;
    }
  ): void {
    const entry = this.createEntry("debug", action, options);
    this.write(entry);
  }

  /**
   * Log an info message
   */
  info(
    action: string,
    options?: {
      context?: LogContext;
      outcome?: LogEntry["outcome"];
      message?: string;
      durationMs?: number;
    }
  ): void {
    const entry = this.createEntry("info", action, options);
    this.write(entry);
  }

  /**
   * Log a warning message
   */
  warn(
    action: string,
    options?: {
      context?: LogContext;
      outcome?: LogEntry["outcome"];
      message?: string;
      durationMs?: number;
    }
  ): void {
    const entry = this.createEntry("warn", action, options);
    this.write(entry);
  }

  /**
   * Log an error message
   */
  error(
    action: string,
    options?: {
      context?: LogContext;
      outcome?: LogEntry["outcome"];
      message?: string;
      durationMs?: number;
    }
  ): void {
    const entry = this.createEntry("error", action, options);
    this.write(entry);
  }

  /**
   * Create a child logger with additional default context
   */
  child(additionalContext: LogContext): Logger {
    const options: LoggerOptions = {
      minLevel: this.minLevel,
      defaultContext: { ...this.defaultContext, ...additionalContext },
      console: this.useConsole,
    };
    if (this.customOutput !== null) {
      options.output = this.customOutput;
    }
    return new Logger(options);
  }

  /**
   * Create a timer and return a function to log completion
   */
  startTimer(
    action: string,
    options?: {
      context?: LogContext;
      message?: string;
    }
  ): {
    success: (additionalOptions?: { message?: string; context?: LogContext }) => void;
    failure: (additionalOptions?: { message?: string; context?: LogContext }) => void;
    timer: Timer;
  } {
    const timer = createTimer();

    return {
      timer,
      success: (additionalOptions?: { message?: string; context?: LogContext }) => {
        this.info(action, {
          ...options,
          ...additionalOptions,
          context: { ...options?.context, ...additionalOptions?.context },
          outcome: "success",
          durationMs: timer.stop(),
        });
      },
      failure: (additionalOptions?: { message?: string; context?: LogContext }) => {
        this.error(action, {
          ...options,
          ...additionalOptions,
          context: { ...options?.context, ...additionalOptions?.context },
          outcome: "failure",
          durationMs: timer.stop(),
        });
      },
    };
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

/**
 * Default logger instance for convenience
 */
export const logger = createLogger();
