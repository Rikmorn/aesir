/**
 * Adapters - NormalizedEvent to IncomingEvent transformers
 *
 * Each adapter is a pure function that maps integration-specific NormalizedEvent
 * objects into domain-language IncomingEvent types for the EventRouter.
 */

export { adaptGitHubEvent } from "./github.js";
export { adaptLinearEvent } from "./linear.js";
export { adaptSlackEvent } from "./slack.js";
export * from "./types.js";

import { adaptGitHubEvent } from "./github.js";
import { adaptLinearEvent } from "./linear.js";
import { adaptSlackEvent } from "./slack.js";
import type { EventAdapter } from "./types.js";

/** All adapters in evaluation order */
export const ALL_ADAPTERS: EventAdapter[] = [
  adaptSlackEvent,
  adaptGitHubEvent,
  adaptLinearEvent,
];
