/**
 * Environment fallbacks for the integration suite.
 *
 * Registered as a `setupFiles` entry on the `integration` project in the root
 * `vitest.config.ts`. That is the only placement that works: an integration
 * test reaches `shared/env/config.ts` through its own imports, and ES module
 * imports are evaluated before any statement in the importing file, so an
 * assignment written above the imports still runs too late. `config.ts`
 * validates at module scope and calls `process.exit(1)`.
 *
 * This file imports nothing, because anything it imported would be evaluated
 * before the assignments below.
 *
 * A gitignored root `.env` supplies all four locally, so these only decide
 * anything on a machine without one -- a CI runner, or a fresh clone.
 *
 * `||` rather than `??`: an empty value is as absent as an unset one here.
 */

process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || "test-key-not-real";
process.env.LINEAR_TEAM_ID = process.env.LINEAR_TEAM_ID || "test-team";
process.env.GITHUB_REPO = process.env.GITHUB_REPO || "test-org/test-repo";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C000TEST";
process.env.NODE_ENV = "test";
