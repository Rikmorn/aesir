/**
 * API Response Types
 *
 * Type definitions for all /api/ endpoint responses.
 * Used by route handlers and consumed by the dashboard (Phase 49+).
 */

// ─── Error Envelope ──────────────────────────────────────────────────────────

/**
 * Consistent error response format for all /api/ endpoints.
 * Shape: { error: { code, message, details? } }
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

/**
 * Standard error codes used across API endpoints.
 */
export const ErrorCodes = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  TOO_MANY_CONNECTIONS: "TOO_MANY_CONNECTIONS",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ─── Tools Registry ──────────────────────────────────────────────────────────

/**
 * A single tool entry in the /api/tools/registry response.
 * Contains metadata and JSON Schema representation of the input schema.
 */
export interface ToolRegistryEntry {
  /** Tool name (part after colon in ref, e.g., "get_issue") */
  name: string;
  /** Tool namespace (part before colon in ref, e.g., "linear") */
  namespace: string;
  /** Human-readable description of the tool */
  description: string;
  /** JSON Schema representation of the tool's input parameters */
  inputSchema: Record<string, unknown>;
}

// ─── Agents Registry ─────────────────────────────────────────────────────────

/**
 * Agent definition summary for the list endpoint.
 * Excludes systemPrompt to keep the response lightweight.
 */
export interface AgentRegistrySummary {
  id: string;
  name: string;
  description: string;
  version: string;
  model: string;
  temperature?: number | undefined;
  tools: string[];
  subAgents?: Record<string, string> | undefined;
  maxIterations: number;
  tokenBudget: number;
  history: {
    pruneThreshold: number;
    protectedMessages: number;
    summaryThreshold: number;
    summaryModel: string;
  };
  triggers?: Array<{ event: string }> | undefined;
}

/**
 * Full agent definition including systemPrompt.
 * Returned by the detail endpoint /api/agents/registry/:id.
 */
export interface AgentRegistryDetail extends AgentRegistrySummary {
  systemPrompt: string;
}

// ─── Worker Status ───────────────────────────────────────────────────────────

/**
 * Worker loop status snapshot returned by /api/worker/status.
 */
export interface WorkerStatusResponse {
  /** Number of currently executing conversations */
  activeClaims: number;
  /** Maximum concurrent conversations allowed */
  maxConcurrent: number;
  /** How often the worker polls for new work (ms) */
  pollIntervalMs: number;
  /** ISO 8601 timestamp of last poll cycle, or null if never polled */
  lastPollAt: string | null;
  /** Milliseconds since the worker loop started */
  uptimeMs: number;
}

// ─── Tools Health ────────────────────────────────────────────────────────────

/**
 * Health status of a single integration (Linear, GitHub, Slack).
 */
export interface IntegrationHealth {
  /** Integration name (e.g., "linear", "github", "slack") */
  name: string;
  /** Two-state health model */
  status: "healthy" | "unhealthy";
  /** Round-trip latency in ms, or null if unhealthy */
  latencyMs: number | null;
  /** ISO 8601 timestamp of when this check was performed */
  lastChecked: string;
}

/**
 * Response shape for /api/tools/health.
 */
export interface ToolsHealthResponse {
  integrations: IntegrationHealth[];
}
