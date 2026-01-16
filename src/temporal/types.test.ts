/**
 * Tests for Temporal type definitions
 *
 * These tests verify that the type exports are accessible and the
 * interfaces have the expected structure.
 */

import { describe, it, expect } from "vitest";

import type {
  ApprovalDecision,
  ApprovalStatus,
  ChangesRequested,
  WorkflowConfig,
  WorkflowResult,
} from "./types.js";

describe("Temporal Types", () => {
  describe("ApprovalDecision", () => {
    it("should accept valid approval decision with required fields", () => {
      const decision: ApprovalDecision = {
        approved: true,
        reviewer: "user123",
      };

      expect(decision.approved).toBe(true);
      expect(decision.reviewer).toBe("user123");
      expect(decision.comment).toBeUndefined();
    });

    it("should accept approval decision with optional comment", () => {
      const decision: ApprovalDecision = {
        approved: false,
        reviewer: "reviewer456",
        comment: "Needs more tests",
      };

      expect(decision.approved).toBe(false);
      expect(decision.reviewer).toBe("reviewer456");
      expect(decision.comment).toBe("Needs more tests");
    });
  });

  describe("ChangesRequested", () => {
    it("should accept valid changes requested object", () => {
      const changes: ChangesRequested = {
        reviewer: "reviewer123",
        feedback: "Please add error handling",
      };

      expect(changes.reviewer).toBe("reviewer123");
      expect(changes.feedback).toBe("Please add error handling");
    });
  });

  describe("ApprovalStatus", () => {
    it("should represent awaiting state", () => {
      const status: ApprovalStatus = {
        taskId: "LIN-123",
        awaiting: true,
        decision: null,
        changesRequested: null,
      };

      expect(status.taskId).toBe("LIN-123");
      expect(status.awaiting).toBe(true);
      expect(status.decision).toBeNull();
      expect(status.changesRequested).toBeNull();
    });

    it("should represent approved state", () => {
      const status: ApprovalStatus = {
        taskId: "LIN-456",
        awaiting: false,
        decision: {
          approved: true,
          reviewer: "approver",
        },
        changesRequested: null,
      };

      expect(status.taskId).toBe("LIN-456");
      expect(status.awaiting).toBe(false);
      expect(status.decision?.approved).toBe(true);
    });

    it("should represent changes requested state", () => {
      const status: ApprovalStatus = {
        taskId: "LIN-789",
        awaiting: true,
        decision: null,
        changesRequested: {
          reviewer: "reviewer",
          feedback: "Fix the bug",
        },
      };

      expect(status.changesRequested?.feedback).toBe("Fix the bug");
    });
  });

  describe("WorkflowConfig", () => {
    it("should accept valid workflow configuration", () => {
      const config: WorkflowConfig = {
        taskId: "LIN-123",
        prNumber: 42,
        prUrl: "https://github.com/org/repo/pull/42",
        completionStatus: "Done",
        owner: "org",
        repo: "repo",
        branch: "feature/my-feature",
      };

      expect(config.taskId).toBe("LIN-123");
      expect(config.prNumber).toBe(42);
      expect(config.prUrl).toBe("https://github.com/org/repo/pull/42");
      expect(config.completionStatus).toBe("Done");
      expect(config.owner).toBe("org");
      expect(config.repo).toBe("repo");
      expect(config.branch).toBe("feature/my-feature");
    });

    it("should allow configurable completion status", () => {
      const config1: WorkflowConfig = {
        taskId: "LIN-1",
        prNumber: 1,
        prUrl: "https://github.com/org/repo/pull/1",
        completionStatus: "Done",
        owner: "org",
        repo: "repo",
        branch: "main",
      };

      const config2: WorkflowConfig = {
        taskId: "LIN-2",
        prNumber: 2,
        prUrl: "https://github.com/org/repo/pull/2",
        completionStatus: "Merged",
        owner: "org",
        repo: "repo",
        branch: "main",
      };

      expect(config1.completionStatus).toBe("Done");
      expect(config2.completionStatus).toBe("Merged");
    });
  });

  describe("WorkflowResult", () => {
    it("should represent successful workflow result", () => {
      const result: WorkflowResult = {
        success: true,
        prNumber: 42,
      };

      expect(result.success).toBe(true);
      expect(result.prNumber).toBe(42);
      expect(result.reason).toBeUndefined();
    });

    it("should represent failed workflow result", () => {
      const result: WorkflowResult = {
        success: false,
        reason: "Approval timeout",
      };

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Approval timeout");
      expect(result.prNumber).toBeUndefined();
    });
  });
});
