/**
 * Lifecycle Hook Registry
 *
 * Generic mechanism for registering and executing hooks at conversation
 * lifecycle boundaries. Currently supports pre-completion hooks that run
 * before a conversation is finalized.
 *
 * Phase 86 uses this for identity document review. Phase 87 will add
 * knowledge flush hooks. The registry is generic: hooks are registered
 * by name, executed sequentially, and individually wrapped in try/catch
 * so one failing hook doesn't block others.
 *
 * Key behaviors:
 * - Hooks run sequentially in registration order (order matters for Phase 87)
 * - Each hook is wrapped in try/catch (non-fatal, logged)
 * - Hooks can inject a user turn via injectTurn() for agent interaction
 * - Name-based registration prevents duplicates
 */

import type { PinoLogger } from "@aesir/platform";
import type {
  AgentLoopResult,
  ToolDefinition,
} from "../shared/agent-loop/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Context provided to lifecycle hooks at pre-completion time.
 *
 * Contains the conversation state and an injectTurn() function
 * that hooks can use to prompt the agent for one more turn.
 */
export interface LifecycleHookContext {
  /** Conversation ID */
  conversationId: string;
  /** Agent definition ID (e.g., "dev-agent") */
  agentDefinitionId: string;
  /** Agent definition version */
  agentDefinitionVersion: string;
  /** Current conversation messages (mutable via injectTurn) */
  messages: unknown[];
  /** System prompt used for this conversation */
  systemPrompt: string;
  /** Resolved tools available to the agent */
  tools: ToolDefinition[];
  /** LLM model identifier */
  model: string;
  /** Logger instance for this conversation */
  logger: PinoLogger;
  /**
   * Inject a user-role turn and run a short agent loop iteration.
   * The hook passes a prompt and the agent responds with tool calls or text.
   * Messages from the hook turn are appended to the conversation.
   */
  injectTurn(userMessage: string): Promise<AgentLoopResult>;
}

/**
 * A lifecycle hook function.
 * Receives the hook context and can optionally inject a turn.
 */
export type LifecycleHook = (ctx: LifecycleHookContext) => Promise<void>;

/**
 * Registry for lifecycle hooks.
 *
 * Hooks are registered by name (for logging and dedup) and executed
 * sequentially at the appropriate lifecycle point.
 */
export interface LifecycleHookRegistry {
  /** Register a named hook. Throws if name is already registered. */
  register(name: string, hook: LifecycleHook): void;
  /** Run all registered pre-completion hooks sequentially. */
  runPreCompletion(ctx: LifecycleHookContext): Promise<void>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a LifecycleHookRegistry instance.
 *
 * Hooks are stored in a Map keyed by name. runPreCompletion iterates
 * hooks in insertion order, wrapping each in try/catch and logging
 * hook name + duration.
 */
export function createLifecycleHookRegistry(
  logger: PinoLogger,
): LifecycleHookRegistry {
  const hooks = new Map<string, LifecycleHook>();
  const log = logger.child({ component: "lifecycle-hooks" });

  return {
    register(name: string, hook: LifecycleHook): void {
      if (hooks.has(name)) {
        throw new Error(`Lifecycle hook "${name}" is already registered`);
      }
      hooks.set(name, hook);
      log.info({ hookName: name }, "Lifecycle hook registered");
    },

    async runPreCompletion(ctx: LifecycleHookContext): Promise<void> {
      if (hooks.size === 0) return;

      log.info(
        { hookCount: hooks.size, conversationId: ctx.conversationId },
        "Running pre-completion hooks",
      );

      for (const [name, hook] of hooks) {
        const hookStart = Date.now();
        try {
          await hook(ctx);
          const durationMs = Date.now() - hookStart;
          log.info(
            { hookName: name, durationMs, conversationId: ctx.conversationId },
            "Pre-completion hook completed",
          );
        } catch (err) {
          const durationMs = Date.now() - hookStart;
          log.error(
            {
              err,
              hookName: name,
              durationMs,
              conversationId: ctx.conversationId,
            },
            "Pre-completion hook failed (non-fatal, continuing)",
          );
        }
      }
    },
  };
}
