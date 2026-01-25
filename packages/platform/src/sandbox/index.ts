/**
 * Sandbox Module
 *
 * Provides isolated code execution environments for agent workloads.
 */

// Dev containers
export {
  createDevContainerManager,
  type DevContainerManager,
  type DevContainerManagerOptions,
} from "./dev-container.js";
export {
  createDevContainerStore,
  type DevContainerStore,
  type DevContainerStoreOptions,
} from "./dev-container-store.js";
export { DockerSandbox, type DockerSandboxOptions } from "./docker-sandbox.js";
export type { ExecutionResult, Sandbox, TestResult } from "./types.js";
export {
  DEV_CONTAINER_TIMEOUTS,
  type DevContainerExecOptions,
  type DevContainerExecResult,
  type DevContainerSpawnOptions,
} from "./types.js";
