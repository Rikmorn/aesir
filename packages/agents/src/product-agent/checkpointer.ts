/**
 * Product Agent PostgreSQL Checkpointer
 *
 * Provides PostgresSaver instance for LangGraph conversation history persistence.
 * Uses 'agents' schema for isolation from other PostgreSQL data.
 *
 * Key design decisions:
 * - Singleton pattern to avoid multiple connections
 * - Factory function for async initialization (setup tables on first use)
 * - Uses DATABASE_URL from environment (standard across platform)
 */

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/** Singleton instance of the checkpointer */
let checkpointerInstance: PostgresSaver | null = null;

/** Whether setup has been completed */
let isInitialized = false;

/**
 * Create and initialize the PostgreSQL checkpointer for product agent.
 *
 * Uses the 'agents' schema in PostgreSQL for isolation from other data.
 * Calls setup() to create necessary tables on first invocation.
 *
 * @returns Initialized PostgresSaver instance
 * @throws Error if DATABASE_URL is not set
 *
 * @example
 * ```typescript
 * const checkpointer = await createProductAgentCheckpointer();
 * const graph = createProductAgentGraph({ teamId, checkpointer });
 * ```
 */
export async function createProductAgentCheckpointer(): Promise<PostgresSaver> {
  // Return existing instance if already initialized
  if (checkpointerInstance && isInitialized) {
    return checkpointerInstance;
  }

  // Get database connection string from environment
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is required for checkpointer",
    );
  }

  // Create checkpointer with 'agents' schema for isolation
  checkpointerInstance = PostgresSaver.fromConnString(databaseUrl, {
    schema: "agents",
  });

  // Run setup to create tables if they don't exist
  await checkpointerInstance.setup();
  isInitialized = true;

  return checkpointerInstance;
}

/**
 * Get the existing checkpointer instance.
 *
 * Use this in activity code after the checkpointer has been initialized.
 * Throws if checkpointer hasn't been created yet.
 *
 * @returns The existing PostgresSaver instance
 * @throws Error if createProductAgentCheckpointer hasn't been called
 *
 * @example
 * ```typescript
 * // In activity after initialization
 * const checkpointer = getProductAgentCheckpointer();
 * const graph = createProductAgentGraph({ teamId, checkpointer });
 * ```
 */
export function getProductAgentCheckpointer(): PostgresSaver {
  if (!checkpointerInstance || !isInitialized) {
    throw new Error(
      "Checkpointer not initialized. Call createProductAgentCheckpointer() first.",
    );
  }
  return checkpointerInstance;
}

/**
 * Close the checkpointer connection.
 *
 * Call this during graceful shutdown to release database connections.
 */
export async function closeProductAgentCheckpointer(): Promise<void> {
  if (checkpointerInstance) {
    await checkpointerInstance.end();
    checkpointerInstance = null;
    isInitialized = false;
  }
}

/**
 * Reset checkpointer state for testing.
 *
 * Clears the singleton instance without closing the connection.
 * Only use in tests to ensure clean state between test runs.
 */
export function resetCheckpointerForTesting(): void {
  checkpointerInstance = null;
  isInitialized = false;
}
