/**
 * Prefixed ID Generator
 *
 * Generates human-readable, collision-resistant IDs with type prefixes.
 * Format: prefix_<24-char-nanoid> (e.g., cred_abc123xyz...)
 *
 * 24-char nanoid provides better collision resistance than UUIDv4.
 */
import { customAlphabet } from "nanoid";

// URL-safe alphabet, 24 chars for collision resistance
const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24,
);

/**
 * ID factory with typed prefixes
 *
 * @example
 * const id = createId.credential(); // "cred_abc123xyz..."
 * const id = createId.execution();  // "exec_def456..."
 */
export const createId = {
  /** Agent event ID (agents.agent_events) */
  agentEvent: () => `aevt_${nanoid()}`,

  /** Agent instance ID (for spawn_agent sub-agent tracking) */
  agentInstance: () => `ainst_${nanoid()}`,

  /** Agent session ID (agents.agent_sessions) */
  agentSession: () => `sess_${nanoid()}`,

  /** Configuration ID (platform.configurations) */
  configuration: () => `conf_${nanoid()}`,

  /** Conversation ID (agents.conversations) */
  conversation: () => `conv_${nanoid()}`,

  /** Credential ID (integrations.credentials) */
  credential: () => `cred_${nanoid()}`,

  /** Dev container ID (platform.dev_containers) */
  devContainer: () => `dcont_${nanoid()}`,

  /** Directory entry ID (agents.entity_directory, for future human entries) */
  directoryEntry: () => `dent_${nanoid()}`,

  /** Event ID (event dispatch) */
  event: () => `evt_${nanoid()}`,

  /** Agent execution ID (observability.agent_executions) */
  execution: () => `exec_${nanoid()}`,

  /** Handoff ID (agents.task_handoffs) */
  handoff: () => `ho_${nanoid()}`,

  /** Knowledge entry ID (agents.knowledge_entries) */
  knowledgeEntry: () => `ke_${nanoid()}`,

  /** Sync cursor ID (integrations.sync_cursors) */
  syncCursor: () => `sync_${nanoid()}`,

  /** Task ID (agents.tasks) */
  task: () => `task_${nanoid()}`,

  /** Webhook delivery ID (integrations.webhook_deliveries) */
  webhookDelivery: () => `whd_${nanoid()}`,

  /** Workspace ID (platform.workspaces) */
  workspace: () => `ws_${nanoid()}`,
} as const;

/** ID prefix types for branded types in Phase 15 */
export type IdPrefix = keyof typeof createId;
