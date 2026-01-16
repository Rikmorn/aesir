/**
 * Tests for Temporal signal definitions
 *
 * These tests verify that signals are exported correctly and have
 * the expected names. Since signals are Temporal SDK constructs,
 * we test the export behavior rather than the runtime behavior.
 */

import { describe, it, expect } from "vitest";

import { approvalSignal, changesRequestedSignal } from "./signals.js";

describe("Temporal Signals", () => {
  describe("approvalSignal", () => {
    it("should be defined", () => {
      expect(approvalSignal).toBeDefined();
    });

    it("should have the correct signal name", () => {
      // Signal name is used for routing signals to handlers
      expect(approvalSignal.name).toBe("approval");
    });
  });

  describe("changesRequestedSignal", () => {
    it("should be defined", () => {
      expect(changesRequestedSignal).toBeDefined();
    });

    it("should have the correct signal name", () => {
      expect(changesRequestedSignal.name).toBe("changes_requested");
    });
  });

  describe("signal exports", () => {
    it("should export both signals for client and workflow use", () => {
      // These signals need to be importable by both client code
      // (to send signals) and workflow code (to set up handlers)
      expect(typeof approvalSignal).toBe("object");
      expect(typeof changesRequestedSignal).toBe("object");
    });
  });
});
