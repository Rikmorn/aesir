/**
 * Transaction Isolation Utilities
 *
 * Provides transaction-based test isolation for fast cleanup.
 * Each test runs in a transaction that is rolled back after the test.
 *
 * RESEARCH.md: Transaction rollback ~300ms vs container restart ~1500ms
 */

import type { Sql } from "postgres";

export interface TransactionContext {
  /** The transaction connection - use this for queries in the test */
  sql: Sql;
  /** Commit the transaction (unusual in tests, but available) */
  commit: () => Promise<void>;
  /** Rollback the transaction (called automatically in afterEach) */
  rollback: () => Promise<void>;
}

/**
 * Start a transaction for test isolation.
 *
 * Usage in tests:
 * ```typescript
 * let txCtx: TransactionContext;
 *
 * beforeEach(async () => {
 *   txCtx = await startTestTransaction(containerCtx.sql);
 * });
 *
 * afterEach(async () => {
 *   await txCtx.rollback();
 * });
 *
 * it("should isolate data", async () => {
 *   // Use txCtx.sql for queries - data is rolled back after test
 *   await txCtx.sql`INSERT INTO users (name) VALUES ('test')`;
 * });
 * ```
 */
export async function startTestTransaction(
  sql: Sql,
): Promise<TransactionContext> {
  // Create a reserved connection for this transaction
  const reserved = await sql.reserve();

  // Start the transaction
  await reserved`BEGIN`;

  let finished = false;

  return {
    sql: reserved as unknown as Sql,
    commit: async () => {
      if (finished) return;
      finished = true;
      await reserved`COMMIT`;
      reserved.release();
    },
    rollback: async () => {
      if (finished) return;
      finished = true;
      try {
        await reserved`ROLLBACK`;
      } finally {
        reserved.release();
      }
    },
  };
}

/**
 * Run a function within a transaction that is automatically rolled back.
 *
 * Convenience wrapper for single-test scenarios:
 * ```typescript
 * it("should work", async () => {
 *   await withTestTransaction(sql, async (txSql) => {
 *     await txSql`INSERT INTO users (name) VALUES ('test')`;
 *     const [user] = await txSql`SELECT * FROM users WHERE name = 'test'`;
 *     expect(user).toBeDefined();
 *   });
 *   // Transaction rolled back - data is gone
 * });
 * ```
 */
export async function withTestTransaction<T>(
  sql: Sql,
  fn: (txSql: Sql) => Promise<T>,
): Promise<T> {
  const ctx = await startTestTransaction(sql);
  try {
    const result = await fn(ctx.sql);
    await ctx.rollback();
    return result;
  } catch (error) {
    await ctx.rollback();
    throw error;
  }
}
