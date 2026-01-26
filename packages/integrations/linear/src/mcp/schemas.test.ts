/**
 * MCP Tool Schema Tests for Linear Integration
 *
 * Tests Zod schema validation for Linear MCP tools.
 * Validates input boundary conditions: required fields, optional fields, min lengths, enum values.
 */

import { describe, expect, it } from "vitest";
import {
  CreateCommentInputSchema,
  CreateIssueInputSchema,
  GetIssueInputSchema,
  ListLabelsInputSchema,
  ListTeamsInputSchema,
  UpdateIssueStatusInputSchema,
} from "./schemas.js";

describe("Linear MCP Tool Schemas", () => {
  describe("GetIssueInputSchema", () => {
    it("should accept valid issue ID", () => {
      const result = GetIssueInputSchema.safeParse({ issueId: "ABC-123" });
      expect(result.success).toBe(true);
    });

    it("should accept UUID format", () => {
      const result = GetIssueInputSchema.safeParse({
        issueId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing issueId", () => {
      const result = GetIssueInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should reject empty issueId", () => {
      const result = GetIssueInputSchema.safeParse({ issueId: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("CreateIssueInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = CreateIssueInputSchema.safeParse({
        teamId: "team_123",
        title: "Fix bug",
      });
      expect(result.success).toBe(true);
    });

    it("should accept full input with optional fields", () => {
      const result = CreateIssueInputSchema.safeParse({
        teamId: "team_123",
        title: "Fix bug",
        description: "Detailed description",
        priority: 2,
        labelIds: ["label_1", "label_2"],
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty title", () => {
      const result = CreateIssueInputSchema.safeParse({
        teamId: "team_123",
        title: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing teamId", () => {
      const result = CreateIssueInputSchema.safeParse({
        title: "Fix bug",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid priority (out of range)", () => {
      const result = CreateIssueInputSchema.safeParse({
        teamId: "team_123",
        title: "Fix bug",
        priority: 5,
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid priority values (0-4)", () => {
      for (const priority of [0, 1, 2, 3, 4]) {
        const result = CreateIssueInputSchema.safeParse({
          teamId: "team_123",
          title: "Fix bug",
          priority,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("UpdateIssueStatusInputSchema", () => {
    it("should accept valid input", () => {
      const result = UpdateIssueStatusInputSchema.safeParse({
        issueId: "ABC-123",
        statusName: "In Progress",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing statusName", () => {
      const result = UpdateIssueStatusInputSchema.safeParse({
        issueId: "ABC-123",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty statusName", () => {
      const result = UpdateIssueStatusInputSchema.safeParse({
        issueId: "ABC-123",
        statusName: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing issueId", () => {
      const result = UpdateIssueStatusInputSchema.safeParse({
        statusName: "Done",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ListTeamsInputSchema", () => {
    it("should accept empty object", () => {
      const result = ListTeamsInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("ListLabelsInputSchema", () => {
    it("should accept valid teamId", () => {
      const result = ListLabelsInputSchema.safeParse({ teamId: "team_123" });
      expect(result.success).toBe(true);
    });

    it("should reject empty teamId", () => {
      const result = ListLabelsInputSchema.safeParse({ teamId: "" });
      expect(result.success).toBe(false);
    });

    it("should reject missing teamId", () => {
      const result = ListLabelsInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("CreateCommentInputSchema", () => {
    it("should accept valid input", () => {
      const result = CreateCommentInputSchema.safeParse({
        issueId: "ABC-123",
        body: "This is a comment",
      });
      expect(result.success).toBe(true);
    });

    it("should accept UUID format for issueId", () => {
      const result = CreateCommentInputSchema.safeParse({
        issueId: "550e8400-e29b-41d4-a716-446655440000",
        body: "Comment with UUID",
      });
      expect(result.success).toBe(true);
    });

    it("should accept markdown body", () => {
      const result = CreateCommentInputSchema.safeParse({
        issueId: "ABC-123",
        body: "**Bold** and _italic_ with `code`",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing issueId", () => {
      const result = CreateCommentInputSchema.safeParse({
        body: "Comment without issue",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing body", () => {
      const result = CreateCommentInputSchema.safeParse({
        issueId: "ABC-123",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty issueId", () => {
      const result = CreateCommentInputSchema.safeParse({
        issueId: "",
        body: "Valid body",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty body", () => {
      const result = CreateCommentInputSchema.safeParse({
        issueId: "ABC-123",
        body: "",
      });
      expect(result.success).toBe(false);
    });
  });
});
