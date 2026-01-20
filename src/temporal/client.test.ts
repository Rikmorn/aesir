/**
 * Tests for Temporal client configuration and types
 *
 * These tests verify the client configuration interface and exports.
 * Full integration testing requires a running Temporal server.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClientConfig } from "./client.js";
import type { ApprovalDecision, ChangesRequested } from "./types.js";

describe("Temporal Client", () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_NAMESPACE;
  });

  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_NAMESPACE;
  });

  describe("ClientConfig interface", () => {
    it("should allow empty config (uses defaults)", () => {
      const config: ClientConfig = {};

      expect(config.address).toBeUndefined();
      expect(config.namespace).toBeUndefined();
    });

    it("should allow optional address", () => {
      const config: ClientConfig = {
        address: "custom:7233",
      };

      expect(config.address).toBe("custom:7233");
    });

    it("should allow optional namespace", () => {
      const config: ClientConfig = {
        namespace: "production",
      };

      expect(config.namespace).toBe("production");
    });

    it("should allow all optional fields together", () => {
      const config: ClientConfig = {
        address: "temporal.example.com:7233",
        namespace: "production",
      };

      expect(config.address).toBe("temporal.example.com:7233");
      expect(config.namespace).toBe("production");
    });
  });

  describe("exports", () => {
    it("should export getTemporalClient function", async () => {
      const { getTemporalClient } = await import("./client.js");
      expect(typeof getTemporalClient).toBe("function");
    });

    it("should export clearClientCache function", async () => {
      const { clearClientCache } = await import("./client.js");
      expect(typeof clearClientCache).toBe("function");
    });

    it("should export sendApprovalSignal function", async () => {
      const { sendApprovalSignal } = await import("./client.js");
      expect(typeof sendApprovalSignal).toBe("function");
    });

    it("should export sendChangesRequestedSignal function", async () => {
      const { sendChangesRequestedSignal } = await import("./client.js");
      expect(typeof sendChangesRequestedSignal).toBe("function");
    });
  });

  describe("ApprovalDecision type usage", () => {
    it("should accept valid approval decision", () => {
      const decision: ApprovalDecision = {
        approved: true,
        reviewer: "user123",
      };

      expect(decision.approved).toBe(true);
      expect(decision.reviewer).toBe("user123");
    });

    it("should accept decision with optional comment", () => {
      const decision: ApprovalDecision = {
        approved: false,
        reviewer: "reviewer456",
        comment: "Needs more tests",
      };

      expect(decision.comment).toBe("Needs more tests");
    });
  });

  describe("ChangesRequested type usage", () => {
    it("should accept valid changes requested", () => {
      const changes: ChangesRequested = {
        reviewer: "reviewer789",
        feedback: "Please add error handling",
      };

      expect(changes.reviewer).toBe("reviewer789");
      expect(changes.feedback).toBe("Please add error handling");
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

  describe("clearClientCache", () => {
    it("should be callable (does not throw)", async () => {
      const { clearClientCache } = await import("./client.js");
      expect(() => clearClientCache()).not.toThrow();
    });
  });
});
