/**
 * Dev Agent API Module
 *
 * HTTP handlers, webhook processors, and event routing.
 */

export {
  createDevAgentEventsHandler,
  type DevAgentEventsHandlerDeps,
} from "./events.js";
export {
  createDevAgentRoutes,
  type DevAgentRoutesOptions,
} from "./routes.js";
export {
  type ApprovalSignalInput,
  type CompletionSignalInput,
  type SignalHandlerDeps,
  type SignalResult,
  sendApprovalSignal,
  sendCompletionSignal,
} from "./signal-handler.js";
// Webhook handlers
export * from "./webhooks/index.js";
