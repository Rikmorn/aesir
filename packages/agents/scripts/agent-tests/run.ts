#!/usr/bin/env tsx
/**
 * Agent Test Runner CLI
 *
 * LLM-driven integration testing for agent collaboration primitives.
 *
 * Usage:
 *   pnpm --filter @aesir/agents test:agents                  # Run all scenarios
 *   pnpm --filter @aesir/agents test:agents -- delegation     # Run specific scenario
 *   pnpm --filter @aesir/agents test:agents -- --tag handoff  # Run by tag
 */

import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { runScenario } from "./runner.js";
import {
  allScenarios,
  getScenario,
  getScenariosByTag,
} from "./scenarios/index.js";
import type { TestResult, Verdict } from "./types.js";

// ─── Parse Args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let scenarios = allScenarios;

if (args.length > 0) {
  if (args[0] === "--tag" && args[1]) {
    scenarios = getScenariosByTag(args[1]);
    if (scenarios.length === 0) {
      console.error(`No scenarios found with tag: ${args[1]}`);
      process.exit(1);
    }
  } else {
    // Treat as scenario ID(s)
    const ids = args.filter((a) => !a.startsWith("--"));
    scenarios = ids
      .map((id) => getScenario(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
    if (scenarios.length === 0) {
      console.error(`No scenarios found matching: ${ids.join(", ")}`);
      console.error(`Available: ${allScenarios.map((s) => s.id).join(", ")}`);
      process.exit(1);
    }
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl);
const db = drizzle(sql);

// ─── Banner ──────────────────────────────────────────────────────────────────

console.log("");
console.log("  Agent Integration Tests");
console.log("  =======================");
console.log(`  Running ${scenarios.length} scenario(s)\n`);

// ─── Run ─────────────────────────────────────────────────────────────────────

const results: TestResult[] = [];

for (const scenario of scenarios) {
  const icon = { pass: "[PASS]", fail: "[FAIL]", error: "[ERR!]" };

  console.log(`  ${scenario.name}`);
  console.log(`  ${scenario.description}\n`);

  const result = await runScenario(db, scenario, (msg) => console.log(msg));

  results.push(result);

  console.log("");
  console.log(
    `  ${icon[result.verdict]} ${scenario.name} (${(result.durationMs / 1000).toFixed(1)}s)`,
  );
  console.log("");

  // Print reasoning (indented)
  for (const line of result.reasoning.split("\n")) {
    console.log(`    ${line}`);
  }
  console.log("");
  console.log(`  ${"─".repeat(60)}`);
  console.log("");
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const counts: Record<Verdict, number> = { pass: 0, fail: 0, error: 0 };
for (const r of results) counts[r.verdict]++;

console.log("  Summary");
console.log("  -------");
console.log(
  `  ${counts.pass} passed, ${counts.fail} failed, ${counts.error} errors`,
);
console.log(
  `  Total: ${(results.reduce((sum, r) => sum + r.durationMs, 0) / 1000).toFixed(1)}s`,
);
console.log("");

for (const r of results) {
  const icon = { pass: "[PASS]", fail: "[FAIL]", error: "[ERR!]" };
  console.log(`  ${icon[r.verdict]} ${r.scenario.name}`);
}

console.log("");

// ─── Cleanup ─────────────────────────────────────────────────────────────────

await sql.end();
process.exit(counts.fail > 0 || counts.error > 0 ? 1 : 0);
