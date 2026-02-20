import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./group-service.js";

describe("evaluatePolicy", () => {
  // ─── all_required ───────────────────────────────────────────────────────────

  describe("all_required", () => {
    const policy = { type: "all_required" as const };

    it("satisfied when all tasks completed", () => {
      const result = evaluatePolicy(policy, {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
      });
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });

    it("unsatisfiable when any task failed", () => {
      const result = evaluatePolicy(policy, {
        total: 3,
        completed: 1,
        failed: 1,
        cancelled: 0,
      });
      expect(result).toEqual({ satisfied: false, unsatisfiable: true });
    });

    it("unsatisfiable when any task cancelled", () => {
      const result = evaluatePolicy(policy, {
        total: 3,
        completed: 2,
        failed: 0,
        cancelled: 1,
      });
      expect(result).toEqual({ satisfied: false, unsatisfiable: true });
    });

    it("neither when tasks still running", () => {
      const result = evaluatePolicy(policy, {
        total: 3,
        completed: 1,
        failed: 0,
        cancelled: 0,
      });
      expect(result).toEqual({ satisfied: false, unsatisfiable: false });
    });

    it("satisfied with single task completed", () => {
      const result = evaluatePolicy(policy, {
        total: 1,
        completed: 1,
        failed: 0,
        cancelled: 0,
      });
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });
  });

  // ─── any_sufficient ─────────────────────────────────────────────────────────

  describe("any_sufficient", () => {
    const policy = { type: "any_sufficient" as const };

    it("satisfied when at least one task completed", () => {
      const result = evaluatePolicy(policy, {
        total: 3,
        completed: 1,
        failed: 2,
        cancelled: 0,
      });
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });

    it("unsatisfiable when all tasks failed or cancelled", () => {
      const result = evaluatePolicy(policy, {
        total: 3,
        completed: 0,
        failed: 2,
        cancelled: 1,
      });
      expect(result).toEqual({ satisfied: false, unsatisfiable: true });
    });

    it("neither when tasks still running with no completions", () => {
      const result = evaluatePolicy(policy, {
        total: 3,
        completed: 0,
        failed: 1,
        cancelled: 0,
      });
      expect(result).toEqual({ satisfied: false, unsatisfiable: false });
    });

    it("not unsatisfiable with zero total (edge case)", () => {
      const result = evaluatePolicy(policy, {
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
      expect(result).toEqual({ satisfied: false, unsatisfiable: false });
    });
  });

  // ─── min_required ───────────────────────────────────────────────────────────

  describe("min_required", () => {
    it("satisfied when completed meets threshold", () => {
      const result = evaluatePolicy(
        { type: "min_required", threshold: 2 },
        { total: 5, completed: 2, failed: 0, cancelled: 0 },
      );
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });

    it("satisfied when completed exceeds threshold", () => {
      const result = evaluatePolicy(
        { type: "min_required", threshold: 2 },
        { total: 5, completed: 4, failed: 1, cancelled: 0 },
      );
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });

    it("unsatisfiable when remaining tasks cannot meet threshold", () => {
      const result = evaluatePolicy(
        { type: "min_required", threshold: 3 },
        { total: 5, completed: 1, failed: 2, cancelled: 1 },
      );
      // remaining = 5 - 2 - 1 = 2, threshold = 3, so unsatisfiable
      expect(result).toEqual({ satisfied: false, unsatisfiable: true });
    });

    it("neither when threshold not yet met but still achievable", () => {
      const result = evaluatePolicy(
        { type: "min_required", threshold: 3 },
        { total: 5, completed: 1, failed: 1, cancelled: 0 },
      );
      // remaining = 5 - 1 - 0 = 4 >= 3, so still possible
      expect(result).toEqual({ satisfied: false, unsatisfiable: false });
    });

    it("threshold equals total -- equivalent to all_required behavior", () => {
      const result = evaluatePolicy(
        { type: "min_required", threshold: 3 },
        { total: 3, completed: 3, failed: 0, cancelled: 0 },
      );
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });

    it("threshold of 1 -- equivalent to any_sufficient behavior", () => {
      const result = evaluatePolicy(
        { type: "min_required", threshold: 1 },
        { total: 3, completed: 1, failed: 2, cancelled: 0 },
      );
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });

    it("defaults threshold to 1 when not provided", () => {
      const result = evaluatePolicy(
        { type: "min_required" },
        { total: 3, completed: 1, failed: 0, cancelled: 0 },
      );
      expect(result).toEqual({ satisfied: true, unsatisfiable: false });
    });
  });

  // ─── unknown policy ─────────────────────────────────────────────────────────

  describe("unknown policy type", () => {
    it("returns neither satisfied nor unsatisfiable", () => {
      const result = evaluatePolicy(
        { type: "unknown_policy" },
        { total: 3, completed: 3, failed: 0, cancelled: 0 },
      );
      expect(result).toEqual({ satisfied: false, unsatisfiable: false });
    });
  });
});
