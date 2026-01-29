/**
 * Mock Logger
 *
 * A test double for PinoLogger that captures log calls for assertion.
 */

export interface MockLoggerOptions {
  /** If true, actually log to console (useful for debugging tests) */
  verbose?: boolean;
}

export interface LogCall {
  level: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface MockLogger {
  trace: (obj: object | string, msg?: string) => void;
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
  fatal: (obj: object | string, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => MockLogger;

  // Test utilities
  calls: LogCall[];
  getCallsAt: (level: string) => LogCall[];
  hasLoggedAt: (level: string, messagePattern?: string | RegExp) => boolean;
  clear: () => void;
}

/**
 * Internal implementation that accepts a shared calls array
 */
function createMockLoggerInternal(
  options: MockLoggerOptions,
  sharedCalls: LogCall[],
): MockLogger {
  function log(level: string, obj: object | string, msg?: string): void {
    const context =
      typeof obj === "object" ? (obj as Record<string, unknown>) : undefined;
    const logCall: LogCall = {
      level,
      message: typeof obj === "string" ? obj : (msg ?? ""),
    };
    if (context !== undefined) {
      logCall.context = context;
    }
    sharedCalls.push(logCall);

    if (options.verbose) {
      // biome-ignore lint/suspicious/noConsole: Intentional for verbose debugging in tests
      console.log(
        `[${level.toUpperCase()}]`,
        logCall.message,
        logCall.context ?? "",
      );
    }
  }

  const logger: MockLogger = {
    trace: (obj, msg) => log("trace", obj, msg),
    debug: (obj, msg) => log("debug", obj, msg),
    info: (obj, msg) => log("info", obj, msg),
    warn: (obj, msg) => log("warn", obj, msg),
    error: (obj, msg) => log("error", obj, msg),
    fatal: (obj, msg) => log("fatal", obj, msg),
    // Child loggers share the same calls array with parent
    child: (_bindings) => createMockLoggerInternal(options, sharedCalls),

    calls: sharedCalls,
    getCallsAt: (level) => sharedCalls.filter((c) => c.level === level),
    hasLoggedAt: (level, pattern) => {
      const levelCalls = sharedCalls.filter((c) => c.level === level);
      if (!pattern) return levelCalls.length > 0;

      return levelCalls.some((c) =>
        typeof pattern === "string"
          ? c.message.includes(pattern)
          : pattern.test(c.message),
      );
    },
    clear: () => {
      sharedCalls.length = 0;
    },
  };

  return logger;
}

export function createMockLogger(options: MockLoggerOptions = {}): MockLogger {
  return createMockLoggerInternal(options, []);
}
