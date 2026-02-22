/**
 * EventRouter
 *
 * Matches IncomingEvent objects against agent trigger rules and produces
 * routing decisions: start, signal, ignore, or slow_path. The caller
 * (e.g., webhook handler) is responsible for executing the decision.
 *
 * Key design:
 * - handle() is synchronous -- pure routing logic with no I/O
 * - loadStartRules() is async -- loads triggers from AgentRegistry
 * - Conversation IDs follow the formula: {agentDefinitionId}-{correlationKey}
 * - Pure framework-level routing with no external dependencies
 */

import type { IncomingEvent } from "../adapters/types.js";
import { IGNORE_EVENT_TYPES } from "../adapters/types.js";
import type {
  EventRouter,
  EventRouterOptions,
  EventRouterRouteResult,
  Signal,
} from "./types.js";

// ─── Signal-to-Agent Mapping ────────────────────────────────────────────────

/**
 * Maps domain-language signal types to the agent definition ID that
 * handles them. Used for constructing conversationId when routing signals.
 *
 * This mapping is separate from AgentRegistry triggers because signal
 * types are not "start" events -- they resume existing conversations.
 */
const SIGNAL_AGENT_MAP: Record<string, string> = {
  approval: "dev-agent",
  escalation_resolved: "dev-agent",
  pr_merged: "dev-agent",
  pr_closed: "dev-agent",
  pr_review: "dev-agent",
  user_reply: "product-agent",
  cancel: "dev-agent",
};

// ─── Factory ────────────────────────────────────────────────────────────────

export function createEventRouter(options: EventRouterOptions): EventRouter {
  const { agentRegistry, logger } = options;

  /** eventType -> agentDefinitionId, built from AgentRegistry triggers */
  let startRules = new Map<string, string>();

  return {
    async loadStartRules(): Promise<void> {
      const definitions = await agentRegistry.list();
      const rules = new Map<string, string>();

      for (const def of definitions) {
        if (def.triggers) {
          for (const trigger of def.triggers) {
            if (rules.has(trigger.event)) {
              logger.warn(
                {
                  event: trigger.event,
                  existingAgent: rules.get(trigger.event),
                  newAgent: def.id,
                },
                "Duplicate start rule -- first registration wins",
              );
              continue;
            }
            rules.set(trigger.event, def.id);
          }
        }
      }

      startRules = rules;
      logger.info(
        { ruleCount: rules.size, rules: Object.fromEntries(rules) },
        "Start rules loaded from AgentRegistry",
      );
    },

    handle(event: IncomingEvent): EventRouterRouteResult {
      // 1. Ignore check
      if (IGNORE_EVENT_TYPES.has(event.type)) {
        return {
          action: "ignore",
          reason: `Event type explicitly ignored: ${event.type}`,
        };
      }

      // 1.5. Schedule trigger check (synthetic events from schedule-registry)
      if (event.type === "schedule.triggered" && event.data) {
        const data = event.data as { agentId?: string };
        if (data.agentId && event.correlationKey) {
          const conversationId = `${data.agentId}-${event.correlationKey}`;
          return {
            action: "start",
            agentDefinitionId: data.agentId,
            conversationId,
            correlationKey: event.correlationKey,
            message: event.message ?? "Scheduled run",
            event,
          };
        }
        logger.warn(
          { event },
          "schedule.triggered event missing agentId or correlationKey",
        );
        return {
          action: "ignore",
          reason: "Malformed schedule.triggered event",
        };
      }

      // 2. Start rule check
      const agentDefinitionId = startRules.get(event.type);
      if (agentDefinitionId !== undefined) {
        if (!event.correlationKey) {
          logger.warn(
            { eventType: event.type, agentDefinitionId },
            "Start event missing correlationKey -- falling through to slow_path",
          );
          return { action: "slow_path", event };
        }

        const conversationId = `${agentDefinitionId}-${event.correlationKey}`;
        return {
          action: "start",
          agentDefinitionId,
          conversationId,
          correlationKey: event.correlationKey,
          message: event.message ?? JSON.stringify(event.data),
          event,
        };
      }

      // 3. Signal rule check
      const signalAgentId = SIGNAL_AGENT_MAP[event.type];
      if (signalAgentId !== undefined) {
        if (!event.correlationKey) {
          logger.warn(
            { eventType: event.type, signalAgentId },
            "Signal event missing correlationKey -- falling through to slow_path",
          );
          return { action: "slow_path", event };
        }

        const conversationId = `${signalAgentId}-${event.correlationKey}`;
        const signal: Signal = {
          type: event.type,
          data: event.data,
          message: event.message,
          source: event.source,
          deduplicationId: event.deduplicationId,
          ...(event.replyContext && { replyContext: event.replyContext }),
        };

        return {
          action: "signal",
          conversationId,
          signal,
          event,
        };
      }

      // 4. Fallthrough to slow-path
      return { action: "slow_path", event };
    },
  };
}
