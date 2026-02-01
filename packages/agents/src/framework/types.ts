/**
 * Framework Types
 *
 * Interfaces and types for the v2.3 unified agent framework.
 * EventLog and SessionProjection interfaces defined here;
 * implementations live in separate modules (event-log.ts, session-projection.ts).
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type { ToolDefinition } from "../shared/agent-loop/types.js";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import type {
  AgentEvent,
  AgentEventType,
  AgentSession,
  NewAgentEvent,
} from "../shared/db/schema.js";

export { agentEventTypeValues } from "../shared/db/schema.js";

// Re-export for convenience
export type { AgentEvent, AgentEventType, AgentSession, NewAgentEvent };

// ─── Event Append Input ──────────────────────────────────────────────────────

/**
 * Input for EventLog.append(). Omits auto-generated fields.
 * The caller provides the event content; EventLog adds id, sequence, timestamp.
 */
export interface AppendEventInput {
  conversationId: string;
  agentDefinitionId: string;
  agentDefinitionVersion: string;
  agentInstanceId: string;
  parentInstanceId?: string | null;
  type: AgentEventType;
  payload?: Record<string, unknown>;
  tokenCountInput?: number | null;
  tokenCountOutput?: number | null;
  durationMs?: number | null;
}

// ─── Event Query ─────────────────────────────────────────────────────────────

export interface EventQueryOptions {
  /** Filter by event types */
  types?: AgentEventType[];
  /** Return events with sequence > afterSequence */
  afterSequence?: number;
  /** Maximum number of events to return */
  limit?: number;
}

// ─── Event Subscription ──────────────────────────────────────────────────────

export interface EventSubscriptionFilter {
  /** Only receive events of these types (empty = all types) */
  types?: AgentEventType[];
}

/** Async handler called when a matching event is appended */
export type EventSubscriptionHandler = (event: AgentEvent) => Promise<void>;

/** Function to unsubscribe (returned by EventLog.subscribe) */
export type Unsubscribe = () => void;

// ─── EventLog Interface ──────────────────────────────────────────────────────

export interface EventLogOptions {
  /** Database client for batch inserts and queries */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance */
  logger: PinoLogger;
  /** Flush interval in milliseconds (default: 1000) */
  flushIntervalMs?: number;
  /** Maximum buffer size before eager flush (default: 100) */
  maxBufferSize?: number;
  /** Maximum payload size in bytes before truncation (default: 10240) */
  maxPayloadBytes?: number;
}

/**
 * EventLog - Append-only event recording with buffered writes.
 *
 * - append() is synchronous (void) to avoid blocking the agent loop
 * - Events are buffered and flushed at configurable intervals
 * - flush() forces immediate persistence (call at lifecycle boundaries)
 * - subscribe() enables reactive patterns (e.g., SessionProjection)
 * - Gapless per-conversation sequences assigned automatically
 */
export interface EventLog {
  /**
   * Append an event to the log. Synchronous -- does NOT wait for persistence.
   * Assigns gapless sequence number automatically.
   * Notifies subscribers immediately (in-memory, before persistence).
   */
  append(event: AppendEventInput): void;

  /**
   * Query persisted events for a conversation.
   * Flushes pending buffer first to ensure consistency.
   */
  query(
    conversationId: string,
    options?: EventQueryOptions,
  ): Promise<AgentEvent[]>;

  /**
   * Subscribe to events matching a filter.
   * Handler is called synchronously (in-memory) when append() is called.
   * Returns an unsubscribe function.
   */
  subscribe(
    filter: EventSubscriptionFilter,
    handler: EventSubscriptionHandler,
  ): Unsubscribe;

  /**
   * Initialize the sequence counter for a conversation from the database.
   * MUST be called before the first append() for a conversation.
   * Typically called when handling agent.started events.
   */
  initSequence(conversationId: string): Promise<void>;

  /**
   * Force immediate flush of all buffered events to the database.
   * Call at lifecycle boundaries (pause, complete, fail).
   */
  flush(): Promise<void>;

  /**
   * Close the EventLog, flushing remaining events and clearing timers.
   * Call during graceful shutdown.
   */
  close(): Promise<void>;
}

// ─── SessionProjection Interface ─────────────────────────────────────────────

/**
 * Artifact extraction config: maps tool names to artifact extractors.
 * When a tool.succeeded event matches a tool name in this map,
 * the specified field from the event payload is extracted as an artifact.
 *
 * Example: new Map([
 *   ["create_pull_request", { artifactKey: "pr_url", payloadPath: "url" }],
 *   ["create_branch", { artifactKey: "branch_name", payloadPath: "branch" }],
 * ])
 *
 * In Phase 38, this config comes from the ToolRegistry. For Phase 37,
 * it is passed as a constructor parameter.
 */
export type ArtifactExtractionConfig = Map<string, ArtifactExtractor>;

export interface ArtifactExtractor {
  /** The key to use when storing the artifact in agent_sessions.artifacts */
  artifactKey: string;
  /** The path in the event payload to extract the value from (dot notation) */
  payloadPath: string;
}

export interface SessionProjectionOptions {
  /** Database client for agent_sessions upserts */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance */
  logger: PinoLogger;
  /** EventLog to subscribe to */
  eventLog: EventLog;
  /** Artifact extraction configuration */
  artifactConfig: ArtifactExtractionConfig;
}

/**
 * SessionProjection - Reactively updates agent_sessions from events.
 *
 * Subscribes to EventLog lifecycle events (agent.started, agent.completed, etc.)
 * and tool.succeeded events. Upserts agent_sessions with current status, timing,
 * and extracted artifacts.
 */
export interface SessionProjection {
  /**
   * Get the current session for a conversation.
   */
  getSession(conversationId: string): Promise<AgentSession | null>;

  /**
   * Stop listening for events and clean up.
   */
  close(): void;
}

// ─── Agent Definition Schema ────────────────────────────────────────────────

/**
 * Zod schema for tool reference strings.
 * Format: namespace:tool_name (lowercase letters only, separated by colon).
 * Examples: "linear:get_issue", "github:create_branch", "codebase:read_file"
 */
const toolRefSchema = z
  .string()
  .regex(
    /^[a-z]+:[a-z_]+$/,
    "Tool reference must be namespace:tool_name (lowercase, colon-separated)",
  );

/**
 * Zod schema for agent definition YAML files.
 *
 * Validates parsed YAML into a typed object. The `version` field is a string
 * because YAML coerces unquoted numbers (e.g., `version: 1.0` becomes a float).
 * Keeping it as a string avoids lossy conversions.
 *
 * The `systemPrompt` field is NOT in this schema -- it is loaded separately
 * from prompt.md and added to the AgentDefinition at load time.
 */
export const AgentDefinitionYamlSchema = z.object({
  /** Unique agent identifier (e.g., "dev-agent", "researcher") */
  id: z.string().min(1),
  /** Human-readable agent name */
  name: z.string().min(1),
  /** Description of what this agent does */
  description: z.string().min(1),
  /** Version string (MUST be string -- YAML coerces unquoted numbers) */
  version: z.string().min(1),

  /** LLM model identifier (e.g., "claude-sonnet-4-20250514") */
  model: z.string().min(1),
  /** LLM temperature (0-2), optional */
  temperature: z.number().min(0).max(2).optional(),

  /** Tool references in namespace:tool_name format */
  tools: z.array(toolRefSchema).min(1),
  /** Sub-agent mappings: role -> agent definition ID */
  subAgents: z.record(z.string(), z.string()).optional(),

  /** Maximum agent loop iterations before forced stop */
  maxIterations: z.number().int().positive(),
  /** Total token budget for the agent (input + output) */
  tokenBudget: z.number().int().min(0),

  /** History management configuration */
  history: z.object({
    /** Message count threshold to trigger pruning */
    pruneThreshold: z.number().int().positive(),
    /** Number of initial messages to protect from pruning */
    protectedMessages: z.number().int().positive(),
    /** Message count threshold to trigger summarization */
    summaryThreshold: z.number().int().positive(),
    /** Model to use for summary generation */
    summaryModel: z.string().min(1),
  }),

  /** Event triggers that start this agent */
  triggers: z
    .array(
      z.object({
        /** Event name that triggers this agent (e.g., "linear.issue.assigned") */
        event: z.string().min(1),
      }),
    )
    .optional(),
});

/**
 * Type inferred from AgentDefinitionYamlSchema.
 * Represents the shape of a parsed and validated YAML definition file.
 */
export type AgentDefinitionYaml = z.infer<typeof AgentDefinitionYamlSchema>;

/**
 * Full agent definition combining YAML config with loaded prompt.
 *
 * The YAML schema provides all configuration fields. The systemPrompt is
 * loaded from the companion prompt.md file and added at load time by
 * the AgentRegistry.
 */
export interface AgentDefinition extends AgentDefinitionYaml {
  /** System prompt loaded from prompt.md (not part of YAML) */
  systemPrompt: string;
}

// ─── Tool Context & Factory ─────────────────────────────────────────────────

/**
 * Context provided to tool factories when resolving tool references.
 *
 * Contains the runtime information tools need to operate: which agent
 * is calling, correlation ID for tracing, optional container manager
 * for codebase tools, and a logger.
 */
export interface ToolContext {
  /** ID of the agent using this tool */
  agentId: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Container manager for codebase tools (optional -- not all agents use containers) */
  containerManager?: DevContainerManager | undefined;
  /** Task ID identifying which dev container to use (optional) */
  taskId?: string | undefined;
  /** Logger instance */
  logger: PinoLogger;
}

/**
 * Factory function that creates a ToolDefinition from a ToolContext.
 *
 * Tool factories are registered in the ToolRegistry keyed by namespace:tool_name.
 * When an agent's tool references are resolved, each factory is called with the
 * current ToolContext to produce a ToolDefinition bound to that context.
 */
export type ToolFactory = (context: ToolContext) => ToolDefinition;

// ─── Registry Interfaces ────────────────────────────────────────────────────

/**
 * ToolRegistry - Maps tool reference strings to factory functions.
 *
 * Tool references use namespace:tool_name format (e.g., "linear:get_issue").
 * Factories are called at resolve time with a ToolContext, producing
 * ToolDefinition objects that the agent loop can execute.
 */
export interface ToolRegistry {
  /**
   * Register a tool factory for a tool reference.
   * @throws Error if ref format is invalid or ref is already registered.
   */
  register(ref: string, factory: ToolFactory): void;

  /**
   * Resolve tool references to ToolDefinitions using the provided context.
   * @throws Error if any refs are not registered (lists ALL missing refs).
   */
  resolve(toolRefs: string[], context: ToolContext): ToolDefinition[];

  /** Check if a tool reference is registered. */
  has(ref: string): boolean;

  /** List all registered tool references, sorted alphabetically. */
  listRegistered(): string[];
}

/**
 * AgentRegistry - Loads and caches agent definitions from definition files.
 *
 * Definitions are loaded from YAML files on disk, validated with Zod,
 * and cached in memory with mtime-based invalidation.
 */
export interface AgentRegistry {
  /**
   * Get an agent definition by ID, optionally at a specific version.
   * Returns null if the agent is not found.
   */
  get(id: string, version?: string): Promise<AgentDefinition | null>;

  /** List all available agent definitions. */
  list(): Promise<AgentDefinition[]>;
}
