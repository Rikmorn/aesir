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
import type { IncomingEvent } from "../adapters/types.js";
import type { TokenBudget } from "../shared/agent-loop/token-budget.js";
import type { ToolDefinition } from "../shared/agent-loop/types.js";
import {
  type ReplyContext,
  ReplyContextSchema,
} from "../shared/communication/types.js";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import type {
  AgentEvent,
  AgentEventType,
  AgentSession,
  ConversationStatus,
  NewAgentEvent,
} from "../shared/db/schema.js";
import type { CorrelationService } from "../shared/services/correlation-service.js";
import type { DirectoryService } from "../shared/services/directory-service.js";
import type { TaskService } from "../shared/services/task-service.js";
import type { TimeoutScheduler } from "./timeout-scheduler.js";
import type { WorkerLoopStatus } from "./worker-loop.js";

export { agentEventTypeValues } from "../shared/db/schema.js";

/**
 * Sandbox compute abstraction. Currently backed by DevContainerManager (Docker).
 * Can be swapped to Fargate/Lambda by changing the factory in main.ts.
 */
export type SandboxManager = DevContainerManager;

// Re-export for convenience
export type {
  AgentEvent,
  AgentEventType,
  AgentSession,
  ConversationStatus,
  NewAgentEvent,
};

// ─── Event Append Input ──────────────────────────────────────────────────────

/**
 * Input for EventLog.append(). Omits auto-generated fields.
 * The caller provides the event content; EventLog adds id, sequence, timestamp.
 */
export interface AppendEventInput {
  /** Optional pre-generated event ID. If omitted, a new ID is generated. */
  id?: string;
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
  /** Optional full LLM response content (Anthropic ContentBlock[]). Stored in agent_event_content alongside the event in the same flush transaction. */
  content?: unknown[];
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
   * Get the current sequence counter for a conversation (in-memory, not queried from DB).
   * Returns 0 if the sequence has not been initialized for this conversation.
   */
  getSequence(conversationId: string): number;

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

  /** Capabilities this agent provides (used for entity directory semantic matching) */
  capabilities: z.array(z.string().min(1)).optional(),

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
  /** Sandbox container ID identifying which dev container to use (optional) */
  sandboxId?: string | undefined;
  /** Task ID from the conversation's associated task (v2.5 task primitive, undefined if no task) */
  taskId?: string | undefined;
  /** Logger instance */
  logger: PinoLogger;
  /** Spawn dependencies for sub-agent execution (populated by worker loop when agent has coordination:spawn_agent) */
  spawnDeps?: SpawnAgentDeps | undefined;
  /** Delegation dependencies for cross-agent task delegation (populated by worker loop when agent has task:delegate) */
  delegationDeps?: DelegationDeps | undefined;
  /** Callback for MCP observability events (mcp.error, mcp.rate_limited, etc.). Set by worker loop. */
  onMcpEvent?: (event: {
    type: string;
    payload: Record<string, unknown>;
  }) => void;
}

// ─── Spawn Agent Dependencies ───────────────────────────────────────────────

/**
 * Dependencies for sub-agent spawning via the spawn_agent tool.
 *
 * Populated by the worker loop when the agent definition includes
 * `coordination:spawn_agent` in its tool list. Carried inside ToolContext
 * so tool factories have access at resolve time without changing the
 * ToolFactory signature.
 */
export interface SpawnAgentDeps {
  /** Registry for loading sub-agent definitions */
  agentRegistry: AgentRegistry;
  /** Registry for resolving sub-agent tool references */
  toolRegistry: ToolRegistry;
  /** Shared mutable token budget (passed by reference to sub-agents) */
  tokenBudget: TokenBudget;
  /** Event log for recording sub-agent lifecycle events */
  eventLog: EventLog;
  /** Parent agent's definition (contains subAgents mapping) */
  parentDefinition: AgentDefinition;
  /** Parent agent's instance ID (for parent_instance_id in events) */
  parentInstanceId: string;
  /** Abort signal propagated from parent (graceful shutdown) */
  abortSignal?: AbortSignal;
  /** Current spawn depth (0 = top-level agent) */
  currentDepth: number;
  /** Maximum allowed spawn depth (default: 3) */
  maxSpawnDepth: number;
}

// ─── Delegation Dependencies ─────────────────────────────────────────────

/**
 * Dependencies for cross-agent task delegation via the task:delegate tool.
 *
 * Populated by the worker loop when the agent definition includes
 * `task:delegate` in its tool list. Carried inside ToolContext
 * so tool factories have access at resolve time.
 */
export interface DelegationDeps {
  /** Executor for starting target agent conversations */
  executor: ConversationExecutor;
  /** Directory service for validating target entity existence */
  directoryService: DirectoryService;
  /** Task service for creating delegation tasks and reading depth */
  taskService: TaskService;
  /** Database client for direct conversation row access (active_delegations) */
  db: NodePgDatabase<typeof agentsSchemaModule>;
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

// ─── Signal Schema ──────────────────────────────────────────────────────────

/**
 * Known signal types used across the system.
 *
 * Signal type is z.string().min(1) -- any string is valid. This list documents
 * the canonical types for discoverability and grep-ability:
 *
 * - "approval"            -- User approves an agent's proposed plan
 * - "pr_review"           -- PR review submitted (changes requested, approved, etc.)
 * - "pr_merged"           -- Pull request merged
 * - "pr_closed"           -- Pull request closed without merge
 * - "escalation_resolved" -- Escalation resolved by human
 * - "user_reply"          -- User replies to an agent message
 * - "cancel"              -- Cancel a running/waiting conversation
 * - "task_completion"     -- Delegated task completed by another agent
 * - "task_failure"        -- Delegated task failed
 * - "task_timeout"        -- Delegated task timed out
 * - "entity_update"       -- Correlation-routed event for an entity this agent is working on (Phase 78)
 */
export const KNOWN_SIGNAL_TYPES = [
  "approval",
  "pr_review",
  "pr_merged",
  "pr_closed",
  "escalation_resolved",
  "user_reply",
  "cancel",
  "task_completion",
  "task_failure",
  "task_timeout",
  "entity_update",
] as const;

/**
 * Zod schema for incoming signal payloads.
 *
 * Signals wake a paused conversation. The `type` field must match the
 * wait_for type the agent specified. The optional `deduplicationId` prevents
 * duplicate delivery (stored in conversations.delivered_signal_ids).
 *
 * Note: `type` is z.string().min(1), not an enum -- new signal types can be
 * introduced without schema changes. See KNOWN_SIGNAL_TYPES for documented types.
 */
export const SignalSchema = z.object({
  /** Signal type (must match the wait_for type). E.g., "approval", "pr_review", "entity_update" */
  type: z.string().min(1),
  /** Arbitrary data payload delivered to the agent when it resumes */
  data: z.record(z.unknown()).optional(),
  /** Human-readable message included when resuming the agent */
  message: z.string().optional(),
  /** Source identifier (e.g., "slack", "github-webhook") for observability */
  source: z.string().optional(),
  /** Idempotency key to prevent duplicate signal delivery */
  deduplicationId: z.string().optional(),
  /** Reply context for routing agent responses back to the originating channel */
  replyContext: ReplyContextSchema.optional(),
});

/** Validated signal payload type */
export type Signal = z.infer<typeof SignalSchema>;

// ─── WaitForState ───────────────────────────────────────────────────────────

/**
 * Mutable state object for executor interception of wait_for tool calls.
 *
 * The executor creates a fresh WaitForState before each agent loop run
 * and passes it to createWaitForTool(). When the agent calls wait_for,
 * the tool sets `triggered = true` and populates the other fields.
 * The executor checks `triggered` after the loop exits to decide
 * whether to transition the conversation to "waiting" status.
 */
export interface WaitForState {
  /** Whether the wait_for tool was called during this loop run */
  triggered: boolean;
  /** Signal types the agent is waiting for (e.g., ["approval"], ["task_completion", "task_failure", "task_timeout"]) */
  waitTypes: string[] | null;
  /** Human-readable reason for pausing */
  reason: string | null;
  /** Timeout duration string (e.g., "72h", "7d") or null for no timeout */
  timeout: string | null;
  /** Additional metadata stored with the pause */
  metadata: Record<string, unknown> | null;
  /** Signal type to use for timeout delivery. Defaults to first waitType if not set. */
  timeoutSignalType: string | null;
}

// ─── ConversationExecutor ───────────────────────────────────────────────────

/**
 * Parameters for starting a new conversation.
 */
export interface StartConversationParams {
  /** Agent definition ID (e.g., "dev-agent", "researcher") */
  agentDefinitionId: string;
  /** Correlation key for deterministic conversation ID generation */
  correlationKey: string;
  /** Initial message to send to the agent */
  initialMessage: string;
  /** Additional context prepended to the initial message */
  context?: string;
  /** Parent conversation ID for sub-agent tracking */
  parentConversationId?: string;
  /** Task ID to associate with this conversation on INSERT (v2.5 task routing) */
  taskId?: string;
  /** Reply context for routing agent responses back to the originating channel */
  replyContext?: ReplyContext;
  /** Entity reference for auto-registration of work correlation (Phase 78) */
  entityRef?: { entityType: string; entityId: string };
}

/**
 * Information about a conversation (return type for get/list).
 */
export interface ConversationInfo {
  /** Deterministic conversation ID */
  id: string;
  /** Agent definition ID */
  agentDefinitionId: string;
  /** Agent definition version at creation time */
  agentDefinitionVersion: string;
  /** Current conversation status */
  status: ConversationStatus;
  /** When the conversation was created */
  createdAt: Date;
  /** When the conversation was last updated */
  updatedAt: Date;
}

/**
 * ConversationExecutor - Manages the lifecycle of agent conversations.
 *
 * The executor is the core runtime for v2.3 agents. It:
 * - Creates and claims conversations using SKIP LOCKED
 * - Runs the agent loop with tool resolution and history management
 * - Handles wait_for pauses and signal-based resumption
 * - Manages retry logic for transient failures
 * - Tracks sub-agent relationships via parent_conversation_id
 *
 * Requirement: EXEC-01
 */
export interface ConversationExecutor {
  /**
   * Start a new conversation. Creates a row in conversations table
   * with status "queued" and returns the conversation ID.
   */
  start(params: StartConversationParams): Promise<string>;

  /**
   * Deliver a signal to a conversation. Depending on conversation state:
   * - "waiting": resumes the conversation (returns "resumed")
   * - "queued"/"running": queues signal for later delivery (returns "queued")
   * - "completed"/"failed"/"cancelled": rejects signal (returns "rejected")
   * - Duplicate deduplicationId: skips delivery (returns "deduplicated")
   */
  signal(
    conversationId: string,
    signal: Signal,
  ): Promise<{
    action: "resumed" | "queued" | "rejected" | "deduplicated";
  }>;

  /**
   * Get information about a conversation. Returns null if not found.
   */
  get(conversationId: string): Promise<ConversationInfo | null>;

  /**
   * Cancel a conversation. Returns true if successfully cancelled,
   * false if the conversation was already in a terminal state.
   */
  cancel(conversationId: string): Promise<boolean>;

  /**
   * Reopen a terminal conversation (completed or failed).
   * Appends a world-state user message, resets execution limits,
   * increments reopen_count, and transitions to queued.
   * Returns "reopened" on success, "rejected" with error on failure.
   */
  reopen(
    conversationId: string,
    reason: string,
  ): Promise<{
    action: "reopened" | "rejected";
    error?: string;
  }>;

  /**
   * List conversations with optional filters.
   */
  list(options?: {
    status?: ConversationStatus;
    agentDefinitionId?: string;
    limit?: number;
  }): Promise<ConversationInfo[]>;

  /**
   * Start the worker loop that polls for and executes queued conversations.
   * Idempotent: calling when already started is a no-op.
   */
  startWorker(): void;

  /**
   * Stop the worker loop gracefully: stops accepting new work,
   * waits for running conversations to finish, and flushes resources.
   * If timeoutMs is provided, aborts in-flight conversations after the deadline.
   */
  stopWorker(timeoutMs?: number): Promise<void>;

  /**
   * Get the current worker loop status snapshot.
   * Returns null if the worker loop has not been created yet.
   */
  getWorkerStatus(): WorkerLoopStatus | null;

  /**
   * Find the most recent active conversation for a task.
   * Active = running, waiting, or queued status.
   * Returns null if no active conversation exists.
   */
  findActiveForTask(taskId: string): Promise<ConversationInfo | null>;
}

/**
 * Options for creating a ConversationExecutor instance.
 */
export interface ConversationExecutorOptions {
  /** Database client for conversation persistence */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Event log for recording agent events */
  eventLog: EventLog;
  /** Session projection for tracking agent sessions */
  sessionProjection: SessionProjection;
  /** Agent registry for loading agent definitions */
  agentRegistry: AgentRegistry;
  /** Tool registry for resolving tool references */
  toolRegistry: ToolRegistry;
  /** Logger instance */
  logger: PinoLogger;
  /** How often to poll for claimable conversations (default: 1000ms) */
  pollIntervalMs?: number;
  /** Maximum concurrent conversations per worker (default: 5) */
  concurrencyLimit?: number;
  /** How often to update heartbeat timestamp (default: 10000ms) */
  heartbeatIntervalMs?: number;
  /** How long before a heartbeat is considered stale (default: 30000ms) */
  staleThresholdMs?: number;
  /** Unique identifier for this worker instance */
  workerId?: string;
  /** Optional timeout scheduler for delayed signal delivery (Phase 41) */
  timeoutScheduler?: TimeoutScheduler;
  /** Sandbox manager for codebase tool execution (optional -- Docker in dev, Fargate/Lambda in prod) */
  sandboxManager?: SandboxManager;
  /** Sandbox workspace setup config (optional -- repo clone + credentials) */
  sandboxSetup?:
    | {
        repoUrl: string;
        githubToken?: string | undefined;
        baseBranch?: string | undefined;
      }
    | undefined;
  /** TaskService for task context injection in the worker loop (Phase 58.2) */
  taskService?: TaskService | undefined;
  /** DirectoryService for delegation target validation in the worker loop (Phase 70) */
  directoryService?: DirectoryService | undefined;
  /** CorrelationService for work correlation tracking (Phase 78) */
  correlationService?: CorrelationService | undefined;
}

// ─── Non-Retryable Error Classes ────────────────────────────────────────────

/**
 * Thrown when the agent's token budget is exhausted.
 *
 * Non-retryable: the conversation has consumed its allocation and
 * cannot continue without external intervention (budget increase).
 */
export class TokenBudgetExhaustedError extends Error {
  constructor(message?: string) {
    super(message ?? "Token budget exhausted");
    this.name = "TokenBudgetExhaustedError";
  }
}

/**
 * Thrown when the agent explicitly aborts (e.g., via AbortSignal).
 *
 * Non-retryable: the abort was intentional, not a transient failure.
 */
export class AgentAbortedError extends Error {
  constructor(message?: string) {
    super(message ?? "Agent aborted");
    this.name = "AgentAbortedError";
  }
}

// ─── EventRouter ────────────────────────────────────────────────────────────

/**
 * Route result from EventRouter.handle().
 * Discriminated union on the `action` field.
 */
export type EventRouterRouteResult =
  | {
      action: "start";
      agentDefinitionId: string;
      conversationId: string;
      correlationKey: string;
      message: string;
      event: IncomingEvent;
    }
  | {
      action: "signal";
      conversationId: string;
      signal: Signal;
      event: IncomingEvent;
    }
  | { action: "slow_path"; event: IncomingEvent }
  | { action: "ignore"; reason: string };

/**
 * Options for creating an EventRouter.
 */
export interface EventRouterOptions {
  /** Agent registry for loading trigger rules */
  agentRegistry: AgentRegistry;
  /** Logger instance */
  logger: PinoLogger;
}

/**
 * EventRouter - Matches IncomingEvents against agent trigger rules.
 *
 * Produces routing decisions (start, signal, ignore, slow_path) without
 * executing them. The caller is responsible for executing the decision
 * via ConversationExecutor, enrichment, or slow-path LLM routing.
 */
export interface EventRouter {
  /**
   * Initialize the router by loading start rules from AgentRegistry.
   * Must be called before handle(). Can be called again to refresh rules.
   */
  loadStartRules(): Promise<void>;

  /**
   * Route an IncomingEvent to a routing decision.
   */
  handle(event: IncomingEvent): EventRouterRouteResult;
}
