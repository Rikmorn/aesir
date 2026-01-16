/**
 * Sandbox Module
 *
 * Provides isolated code execution environments for agent workloads.
 */

export type { Sandbox, ExecutionResult, TestResult } from "./types.js"
export { DockerSandbox, type DockerSandboxOptions } from "./docker-sandbox.js"
