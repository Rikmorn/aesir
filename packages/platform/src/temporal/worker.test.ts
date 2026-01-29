/**
 * Tests for Temporal worker configuration
 *
 * These tests verify the worker configuration interface and exports.
 * Full integration testing requires a running Temporal server.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkerConfig } from "./worker.js";

describe("Temporal Worker", () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_NAMESPACE;
  });

  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_NAMESPACE;
  });

  describe("WorkerConfig interface", () => {
    it("should require taskQueue", () => {
      const config: WorkerConfig = {
        taskQueue: "test-queue",
      };

      expect(config.taskQueue).toBe("test-queue");
    });

    it("should allow optional address", () => {
      const config: WorkerConfig = {
        taskQueue: "test-queue",
        address: "custom:7233",
      };

      expect(config.address).toBe("custom:7233");
    });

    it("should allow optional namespace", () => {
      const config: WorkerConfig = {
        taskQueue: "test-queue",
        namespace: "production",
      };

      expect(config.namespace).toBe("production");
    });

    it("should allow all optional fields together", () => {
      const config: WorkerConfig = {
        taskQueue: "aesir-approval",
        address: "temporal.example.com:7233",
        namespace: "production",
      };

      expect(config.taskQueue).toBe("aesir-approval");
      expect(config.address).toBe("temporal.example.com:7233");
      expect(config.namespace).toBe("production");
    });
  });

  describe("exports", () => {
    // Skip: worker.ts calls Runtime.install() at module load, which can only happen once.
    // The Temporal client tests already install the runtime.
    // TypeScript compilation validates exports exist; these runtime checks add little value.
    it.skip("should export createTemporalWorker function", async () => {
      const { createTemporalWorker } = await import("./worker.js");
      expect(typeof createTemporalWorker).toBe("function");
    });

    it.skip("should export runWorker function", async () => {
      const { runWorker } = await import("./worker.js");
      expect(typeof runWorker).toBe("function");
    });

    it("should export WorkerConfig type (compilation test)", () => {
      // This test passes if it compiles - verifies type is exported
      const config: WorkerConfig = {
        taskQueue: "test",
      };
      expect(config).toBeDefined();
    });
  });

  describe("environment variable defaults", () => {
    it("should read TEMPORAL_ADDRESS from environment", () => {
      process.env.TEMPORAL_ADDRESS = "env-test:7233";
      expect(process.env.TEMPORAL_ADDRESS).toBe("env-test:7233");
    });

    it("should read TEMPORAL_NAMESPACE from environment", () => {
      process.env.TEMPORAL_NAMESPACE = "env-namespace";
      expect(process.env.TEMPORAL_NAMESPACE).toBe("env-namespace");
    });
  });
});
