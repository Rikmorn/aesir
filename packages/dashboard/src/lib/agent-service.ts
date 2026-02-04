/**
 * Agent-Service HTTP Client
 *
 * Server-side HTTP client for the agent-service registry API.
 * Used only in server components / API routes (never shipped to the client).
 *
 * Interfaces mirror AgentRegistrySummary/AgentRegistryDetail from
 * packages/agents/src/service/api/types.ts but are defined locally
 * to maintain dashboard independence (same pattern as lib/schema.ts).
 *
 * Base URL is configurable via AGENT_SERVICE_URL env var (defaults to localhost:3004).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Agent definition summary (without systemPrompt).
 * Matches AgentRegistrySummary from agent-service API.
 */
export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  model: string;
  temperature?: number;
  tools: string[];
  subAgents?: Record<string, string>;
  maxIterations: number;
  tokenBudget: number;
  history: {
    pruneThreshold: number;
    protectedMessages: number;
    summaryThreshold: number;
    summaryModel: string;
  };
  triggers?: Array<{ event: string }>;
}

/**
 * Full agent definition including systemPrompt.
 * Matches AgentRegistryDetail from agent-service API.
 */
export interface AgentDetail extends AgentSummary {
  systemPrompt: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  return process.env.AGENT_SERVICE_URL ?? "http://localhost:3004";
}

// ─── Client Functions ────────────────────────────────────────────────────────

/**
 * Fetch all agent definitions from the agent-service registry.
 *
 * Returns an array of AgentSummary objects (without systemPrompt).
 * Returns empty array on error (agent-service unreachable, non-ok response).
 */
export async function fetchAgentList(): Promise<AgentSummary[]> {
  const url = `${getBaseUrl()}/api/agents/registry`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      // biome-ignore lint/suspicious/noConsole: Server-side HTTP client needs error logging for debugging unreachable agent-service
      console.error(
        `[agent-service] Failed to fetch agent list: ${response.status} ${response.statusText}`,
      );
      return [];
    }

    return (await response.json()) as AgentSummary[];
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: Server-side HTTP client needs error logging for debugging unreachable agent-service
    console.error("[agent-service] Failed to fetch agent list:", error);
    return [];
  }
}

/**
 * Fetch a single agent definition by ID from the agent-service registry.
 *
 * Returns the full AgentDetail (including systemPrompt).
 * Returns null on 404, error, or if agent-service is unreachable.
 */
export async function fetchAgentDetail(
  id: string,
): Promise<AgentDetail | null> {
  const url = `${getBaseUrl()}/api/agents/registry/${encodeURIComponent(id)}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      if (response.status !== 404) {
        // biome-ignore lint/suspicious/noConsole: Server-side HTTP client needs error logging for debugging unreachable agent-service
        console.error(
          `[agent-service] Failed to fetch agent detail for "${id}": ${response.status} ${response.statusText}`,
        );
      }
      return null;
    }

    return (await response.json()) as AgentDetail;
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: Server-side HTTP client needs error logging for debugging unreachable agent-service
    console.error(
      `[agent-service] Failed to fetch agent detail for "${id}":`,
      error,
    );
    return null;
  }
}
