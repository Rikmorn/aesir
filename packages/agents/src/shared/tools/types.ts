/**
 * Shared Tool Types
 *
 * Dependency interfaces and constants shared by tool factories.
 * Tool factories close over these dependencies at toolkit construction time,
 * so individual tool calls don't need to pass them explicitly.
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";

/** Maximum output size in bytes before truncation (100 KB) */
export const MAX_OUTPUT_BYTES = 100_000;

/** Maximum stderr size in bytes before truncation (50 KB) */
export const MAX_STDERR_BYTES = 50_000;

/**
 * Dependencies for codebase tools.
 *
 * Closed over at toolkit construction time so every tool call
 * automatically has access to the container manager and task context.
 */
export interface CodebaseToolDeps {
  /** Container manager for executing commands in dev containers */
  containerManager: DevContainerManager;
  /** Task ID identifying which dev container to use */
  taskId: string;
  /** Logger for debug and error output */
  logger: PinoLogger;
}
