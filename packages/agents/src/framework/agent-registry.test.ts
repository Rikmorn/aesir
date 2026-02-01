/**
 * AgentRegistry Tests
 *
 * Tests for createAgentRegistry() covering: loading from disk, Zod validation,
 * mtime-based caching, version pinning with mismatch warning, listing,
 * optional fields, and error cases.
 */

import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PinoLogger } from "@aesir/platform";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentRegistry } from "./agent-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): PinoLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
    level: "debug",
    silent: vi.fn(),
  } as unknown as PinoLogger;
}

const MINIMAL_YAML = `
id: test-agent
name: Test Agent
description: A test agent for unit tests
version: "1"
model: claude-sonnet-4-20250514
tools:
  - codebase:read_file
maxIterations: 10
tokenBudget: 50000
history:
  pruneThreshold: 30000
  protectedMessages: 10
  summaryThreshold: 50000
  summaryModel: claude-haiku-4-5-20251001
`.trimStart();

const MINIMAL_PROMPT = "You are a test agent.";

/**
 * Write a valid agent definition directory to the given base dir.
 * Returns the path to the agent directory.
 */
async function writeTestDefinition(
  baseDir: string,
  id: string,
  overrides?: { yaml?: string; prompt?: string },
): Promise<string> {
  const agentDir = join(baseDir, id);
  await mkdir(agentDir, { recursive: true });

  const yamlContent =
    overrides?.yaml ?? MINIMAL_YAML.replace("id: test-agent", `id: ${id}`);
  const promptContent = overrides?.prompt ?? MINIMAL_PROMPT;

  await writeFile(join(agentDir, "definition.yaml"), yamlContent);
  await writeFile(join(agentDir, "prompt.md"), promptContent);
  return agentDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRegistry", () => {
  let defDir: string;
  let mockLogger: PinoLogger;

  beforeEach(async () => {
    defDir = await mkdtemp(join(tmpdir(), "agent-defs-"));
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    await rm(defDir, { recursive: true });
  });

  // ─── Loading ─────────────────────────────────────────────────────────────

  describe("loading", () => {
    it("should load a definition from disk", async () => {
      await writeTestDefinition(defDir, "test-agent");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("test-agent");

      expect(def).not.toBeNull();
      expect(def?.id).toBe("test-agent");
      expect(def?.name).toBe("Test Agent");
      expect(def?.description).toBe("A test agent for unit tests");
      expect(def?.version).toBe("1");
      expect(def?.model).toBe("claude-sonnet-4-20250514");
      expect(def?.tools).toEqual(["codebase:read_file"]);
      expect(def?.maxIterations).toBe(10);
      expect(def?.tokenBudget).toBe(50000);
      expect(def?.history).toEqual({
        pruneThreshold: 30000,
        protectedMessages: 10,
        summaryThreshold: 50000,
        summaryModel: "claude-haiku-4-5-20251001",
      });
      expect(def?.systemPrompt).toBe(MINIMAL_PROMPT);
    });

    it("should return null for non-existent agent", async () => {
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("nonexistent");

      expect(def).toBeNull();
    });

    it("should validate YAML against schema and throw on invalid", async () => {
      // Missing required 'model' field
      const invalidYaml = `
id: bad-agent
name: Bad Agent
description: Missing model field
version: "1"
tools:
  - codebase:read_file
maxIterations: 10
tokenBudget: 50000
history:
  pruneThreshold: 30000
  protectedMessages: 10
  summaryThreshold: 50000
  summaryModel: claude-haiku-4-5-20251001
`.trimStart();

      await writeTestDefinition(defDir, "bad-agent", { yaml: invalidYaml });
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      await expect(registry.get("bad-agent")).rejects.toThrow();
    });

    it("should throw when definition id does not match directory name", async () => {
      // YAML says id: wrong-name but directory is test-agent
      const mismatchYaml = MINIMAL_YAML.replace(
        "id: test-agent",
        "id: wrong-name",
      );
      await writeTestDefinition(defDir, "test-agent", { yaml: mismatchYaml });
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      await expect(registry.get("test-agent")).rejects.toThrow(
        "Agent definition id 'wrong-name' does not match directory name 'test-agent'",
      );
    });

    it("should load prompt.md as systemPrompt", async () => {
      const customPrompt =
        "You are a specialized agent.\n\nFollow these instructions carefully.";
      await writeTestDefinition(defDir, "test-agent", {
        prompt: customPrompt,
      });
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("test-agent");

      expect(def?.systemPrompt).toBe(customPrompt);
    });
  });

  // ─── Caching ─────────────────────────────────────────────────────────────

  describe("caching", () => {
    it("should return cached definition on second call (same reference)", async () => {
      await writeTestDefinition(defDir, "test-agent");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def1 = await registry.get("test-agent");
      const def2 = await registry.get("test-agent");

      expect(def1).toBe(def2); // Same reference === cached
    });

    it("should invalidate cache when definition.yaml mtime changes", async () => {
      await writeTestDefinition(defDir, "test-agent");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def1 = await registry.get("test-agent");
      expect(def1?.version).toBe("1");

      // Force mtime forward using utimes
      const updatedYaml = MINIMAL_YAML.replace('version: "1"', 'version: "2"');
      await writeFile(
        join(defDir, "test-agent", "definition.yaml"),
        updatedYaml,
      );
      const futureTime = Date.now() / 1000 + 10;
      await utimes(
        join(defDir, "test-agent", "definition.yaml"),
        futureTime,
        futureTime,
      );

      const def2 = await registry.get("test-agent");

      expect(def2?.version).toBe("2");
      expect(def1).not.toBe(def2); // Different reference
    });

    it("should invalidate cache when prompt.md mtime changes", async () => {
      await writeTestDefinition(defDir, "test-agent");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def1 = await registry.get("test-agent");
      expect(def1?.systemPrompt).toBe(MINIMAL_PROMPT);

      // Update prompt.md and force mtime forward
      const newPrompt = "Updated system prompt.";
      await writeFile(join(defDir, "test-agent", "prompt.md"), newPrompt);
      const futureTime = Date.now() / 1000 + 10;
      await utimes(
        join(defDir, "test-agent", "prompt.md"),
        futureTime,
        futureTime,
      );

      const def2 = await registry.get("test-agent");

      expect(def2?.systemPrompt).toBe(newPrompt);
      expect(def1).not.toBe(def2); // Different reference
    });
  });

  // ─── Version Pinning ─────────────────────────────────────────────────────

  describe("version pinning", () => {
    it("should return cached definition when version matches", async () => {
      await writeTestDefinition(defDir, "test-agent");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("test-agent", "1");

      expect(def).not.toBeNull();
      expect(def?.version).toBe("1");
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("should warn and return cached when version does not match", async () => {
      await writeTestDefinition(defDir, "test-agent");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("test-agent", "99");

      expect(def).not.toBeNull();
      expect(def?.version).toBe("1"); // Returns what is on disk
      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          agentId: "test-agent",
          requestedVersion: "99",
          cachedVersion: "1",
        },
        "Agent definition version mismatch -- returning cached version",
      );
    });
  });

  // ─── Listing ─────────────────────────────────────────────────────────────

  describe("listing", () => {
    it("should list all definitions in directory", async () => {
      await writeTestDefinition(defDir, "agent-a");
      await writeTestDefinition(defDir, "agent-b");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const all = await registry.list();

      expect(all).toHaveLength(2);
      const ids = all.map((d) => d.id).sort();
      expect(ids).toEqual(["agent-a", "agent-b"]);
    });

    it("should skip non-directory entries in definitions dir", async () => {
      await writeTestDefinition(defDir, "real-agent");
      // Create a regular file (not a directory) in definitions dir
      await writeFile(join(defDir, "not-a-directory.txt"), "just a file");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const all = await registry.list();

      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe("real-agent");
    });

    it("should return empty array for empty definitions directory", async () => {
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const all = await registry.list();

      expect(all).toEqual([]);
    });
  });

  // ─── Optional Fields ─────────────────────────────────────────────────────

  describe("optional fields", () => {
    it("should load definition with optional fields (temperature, subAgents, triggers)", async () => {
      const fullYaml = `
id: full-agent
name: Full Agent
description: Agent with all optional fields
version: "1"
model: claude-sonnet-4-20250514
temperature: 0.7
tools:
  - codebase:read_file
subAgents:
  researcher: researcher
  coder: coder
maxIterations: 10
tokenBudget: 50000
history:
  pruneThreshold: 30000
  protectedMessages: 10
  summaryThreshold: 50000
  summaryModel: claude-haiku-4-5-20251001
triggers:
  - event: linear.issue.assigned
`.trimStart();

      await writeTestDefinition(defDir, "full-agent", { yaml: fullYaml });
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("full-agent");

      expect(def).not.toBeNull();
      expect(def?.temperature).toBe(0.7);
      expect(def?.subAgents).toEqual({
        researcher: "researcher",
        coder: "coder",
      });
      expect(def?.triggers).toEqual([{ event: "linear.issue.assigned" }]);
    });

    it("should load definition without optional fields", async () => {
      await writeTestDefinition(defDir, "test-agent");
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("test-agent");

      expect(def).not.toBeNull();
      // With exactOptionalPropertyTypes, optional fields should NOT be present
      expect("temperature" in (def as object)).toBe(false);
      expect("subAgents" in (def as object)).toBe(false);
      expect("triggers" in (def as object)).toBe(false);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should return null when definition.yaml exists but prompt.md is missing", async () => {
      const agentDir = join(defDir, "incomplete-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, "definition.yaml"),
        MINIMAL_YAML.replace("id: test-agent", "id: incomplete-agent"),
      );
      // No prompt.md
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("incomplete-agent");

      expect(def).toBeNull();
    });

    it("should return null when prompt.md exists but definition.yaml is missing", async () => {
      const agentDir = join(defDir, "prompt-only");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "prompt.md"), "Some prompt");
      // No definition.yaml
      const registry = createAgentRegistry({
        definitionsDir: defDir,
        logger: mockLogger,
      });

      const def = await registry.get("prompt-only");

      expect(def).toBeNull();
    });
  });
});
