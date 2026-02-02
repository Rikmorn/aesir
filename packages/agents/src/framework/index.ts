/**
 * Framework Module
 *
 * v2.3 unified agent framework exports.
 */

export { createAgentRegistry } from "./agent-registry.js";
export { createConversationExecutor } from "./conversation-executor.js";
export { createEventLog } from "./event-log.js";
export type {
  CompactionResult,
  HistoryConfig,
  HistoryManager,
} from "./history-manager.js";
export {
  containsSummary,
  createHistoryManager,
  estimateMessageTokens,
  estimateTokens,
  formatArtifacts,
} from "./history-manager.js";
export { createSessionProjection } from "./session-projection.js";
export { registerAllTools } from "./tool-factories.js";
export { createToolRegistry } from "./tool-registry.js";
export * from "./types.js";
export {
  createDefaultWaitForState,
  createWaitForTool,
} from "./wait-for-tool.js";
export type { WorkerLoop, WorkerLoopOptions } from "./worker-loop.js";
export { createWorkerLoop } from "./worker-loop.js";
