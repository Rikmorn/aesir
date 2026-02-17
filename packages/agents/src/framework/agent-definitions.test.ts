/**
 * Agent Definitions Structural Validation
 *
 * Integration-level test that loads ALL agent definitions (production + test)
 * from disk through the real AgentRegistry. Catches definition drift at
 * `pnpm test` time: corrupted YAML, missing prompt.md, Zod schema violations,
 * or tools that should not be present on test agents.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PinoLogger } from "@aesir/platform";
import { describe, expect, it } from "vitest";

import { createAgentRegistry } from "./agent-registry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const noop = () => {};

const mockLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  trace: noop,
  silent: noop,
  level: "silent",
  child: () => mockLogger,
} as unknown as PinoLogger;

// biome-ignore lint/style/useNamingConvention: __dirname is the standard ESM polyfill name
const __dirname = dirname(fileURLToPath(import.meta.url));
const definitionsDir = join(__dirname, "../../definitions");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("agent definitions structural validation", () => {
  it("loads all production agent definitions without errors", async () => {
    const registry = createAgentRegistry({
      definitionsDir,
      logger: mockLogger,
    });
    const allDefs = await registry.list();
    const prodDefs = allDefs.filter((d) => !d.id.startsWith("test-"));

    // At minimum: dev-agent, product-agent, qa-agent, coder, researcher, tester
    expect(prodDefs.length).toBeGreaterThanOrEqual(6);

    for (const def of prodDefs) {
      expect(def.id).toBeTruthy();
      expect(def.systemPrompt).toBeTruthy();
      expect(def.model).toBeTruthy();
      expect(def.tools.length).toBeGreaterThan(0);
    }
  });

  it("loads all test agent definitions without errors", async () => {
    const registry = createAgentRegistry({
      definitionsDir,
      logger: mockLogger,
    });
    const allDefs = await registry.list();
    const testDefs = allDefs.filter((d) => d.id.startsWith("test-"));

    // 13 test agents
    expect(testDefs.length).toBeGreaterThanOrEqual(13);

    for (const def of testDefs) {
      expect(def.id).toBeTruthy();
      expect(def.systemPrompt).toBeTruthy();
      expect(def.model).toBeTruthy();
    }
  });

  it("verifies no test agent has communication:notify", async () => {
    const registry = createAgentRegistry({
      definitionsDir,
      logger: mockLogger,
    });
    const allDefs = await registry.list();
    const testDefs = allDefs.filter((d) => d.id.startsWith("test-"));

    for (const def of testDefs) {
      expect(
        def.tools,
        `${def.id} should not have communication:notify`,
      ).not.toContain("communication:notify");
    }
  });
});
