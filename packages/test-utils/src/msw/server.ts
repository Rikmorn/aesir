/**
 * MSW server setup for Node.js testing
 *
 * Provides a pre-configured MSW server with all API handlers
 * and a helper function for vitest integration.
 */
import { setupServer } from "msw/node";
import { allHandlers } from "./handlers/index.js";

/**
 * Pre-configured MSW server with all default handlers
 *
 * Usage:
 * ```ts
 * import { server } from "@aesir/test-utils";
 *
 * beforeAll(() => server.listen());
 * afterEach(() => server.resetHandlers());
 * afterAll(() => server.close());
 * ```
 */
export const server = setupServer(...allHandlers);

/**
 * Vitest lifecycle options for MSW setup
 */
export interface SetupMSWOptions {
  /**
   * Behavior when request has no matching handler.
   * - 'bypass': Let unhandled requests pass through (default)
   * - 'warn': Log a warning for unhandled requests
   * - 'error': Throw an error for unhandled requests
   */
  onUnhandledRequest?: "bypass" | "warn" | "error";
}

/**
 * Setup MSW server for vitest with proper lifecycle hooks
 *
 * Call this in your test setup file or at the top of test files
 * that need API mocking.
 *
 * Usage:
 * ```ts
 * import { setupMSW } from "@aesir/test-utils";
 * import { beforeAll, afterEach, afterAll } from "vitest";
 *
 * // In test setup or individual test file
 * setupMSW({ beforeAll, afterEach, afterAll });
 * ```
 *
 * @param hooks - Vitest lifecycle hooks
 * @param options - MSW configuration options
 */
export function setupMSW(
  hooks: {
    beforeAll: (fn: () => void) => void;
    afterEach: (fn: () => void) => void;
    afterAll: (fn: () => void) => void;
  },
  options: SetupMSWOptions = {},
): void {
  const { onUnhandledRequest = "bypass" } = options;

  hooks.beforeAll(() => {
    server.listen({ onUnhandledRequest });
  });

  hooks.afterEach(() => {
    server.resetHandlers();
  });

  hooks.afterAll(() => {
    server.close();
  });
}
