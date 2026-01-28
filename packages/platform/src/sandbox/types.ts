/**
 * Sandbox Interface Types
 *
 * Re-exports sandbox types from @aesir/types for backward compatibility.
 * The actual type definitions are in common since they're used by multiple packages.
 */

export type {
  ExecutionResult,
  Sandbox,
  TestResult,
} from "@aesir/types";

// Dev Container Types

/** Options for spawning a dev container */
export interface DevContainerSpawnOptions {
  /** Task ID (Linear issue ID or unique task identifier) */
  taskId: string;
  /** Container image (default: aesir-dev-env:latest) */
  image?: string;
  /** Environment variables to pass to container */
  environment?: Record<string, string>;
}

/** Options for executing a command in a dev container */
export interface DevContainerExecOptions {
  /** Command as array of strings (e.g., ['git', 'status']) */
  command: string[];
  /** Working directory inside container */
  workdir?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/** Result from executing a command in a dev container */
export interface DevContainerExecResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether command timed out */
  timedOut?: boolean;
}

/** Operation-specific timeout presets (milliseconds) */
export const DEV_CONTAINER_TIMEOUTS = {
  /** Research commands: grep, find, cat */
  research: 30_000,
  /** Package install: pnpm install */
  install: 300_000,
  /** Test suites: pnpm test */
  test: 180_000,
  /** Build: pnpm build */
  build: 120_000,
  /** Git operations: clone, push */
  git: 60_000,
  /** Default if not specified */
  default: 30_000,
} as const;
