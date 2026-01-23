/**
 * MCP Tool Schema Tests for GitHub Integration
 *
 * Tests Zod schema validation for GitHub MCP tools.
 * Validates input boundary conditions: required fields, optional fields, min lengths, enum values.
 */

import { describe, expect, it } from "vitest";
import {
  CreateBranchInputSchema,
  CreateCommitInputSchema,
  CreatePRInputSchema,
  GetFileContentsInputSchema,
  GetPRInputSchema,
  GetRepositoryInputSchema,
  ListFilesInputSchema,
  ListPRsInputSchema,
  MergePRInputSchema,
} from "./schemas.js";

describe("GitHub MCP Tool Schemas", () => {
  describe("GetRepositoryInputSchema", () => {
    it("should accept valid input", () => {
      const result = GetRepositoryInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing owner", () => {
      const result = GetRepositoryInputSchema.safeParse({ repo: "my-repo" });
      expect(result.success).toBe(false);
    });

    it("should reject empty owner", () => {
      const result = GetRepositoryInputSchema.safeParse({
        owner: "",
        repo: "my-repo",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing repo", () => {
      const result = GetRepositoryInputSchema.safeParse({ owner: "my-org" });
      expect(result.success).toBe(false);
    });

    it("should reject empty repo", () => {
      const result = GetRepositoryInputSchema.safeParse({
        owner: "my-org",
        repo: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("CreateBranchInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = CreateBranchInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branchName: "feature/new-feature",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid input with optional baseBranch", () => {
      const result = CreateBranchInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branchName: "feature/new-feature",
        baseBranch: "develop",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty branchName", () => {
      const result = CreateBranchInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branchName: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const result = CreateBranchInputSchema.safeParse({
        branchName: "feature/new-feature",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("CreateCommitInputSchema", () => {
    it("should accept valid input", () => {
      const result = CreateCommitInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branch: "main",
        message: "feat: add new feature",
        files: [{ path: "src/index.ts", content: "console.log('hello');" }],
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty message", () => {
      const result = CreateCommitInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branch: "main",
        message: "",
        files: [{ path: "src/index.ts", content: "console.log('hello');" }],
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty files array", () => {
      const result = CreateCommitInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branch: "main",
        message: "feat: add new feature",
        files: [],
      });
      expect(result.success).toBe(false);
    });

    it("should reject file with empty path", () => {
      const result = CreateCommitInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branch: "main",
        message: "feat: add new feature",
        files: [{ path: "", content: "console.log('hello');" }],
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid file modes", () => {
      const validModes = ["100644", "100755", "040000", "160000", "120000"];
      for (const mode of validModes) {
        const result = CreateCommitInputSchema.safeParse({
          owner: "my-org",
          repo: "my-repo",
          branch: "main",
          message: "feat: add new feature",
          files: [{ path: "src/index.ts", content: "test", mode }],
        });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid file mode", () => {
      const result = CreateCommitInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        branch: "main",
        message: "feat: add new feature",
        files: [
          { path: "src/index.ts", content: "test", mode: "invalid-mode" },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("CreatePRInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = CreatePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        title: "feat: add feature",
        head: "feature/new-feature",
        base: "main",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid input with optional body", () => {
      const result = CreatePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        title: "feat: add feature",
        body: "This is a description",
        head: "feature/new-feature",
        base: "main",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty title", () => {
      const result = CreatePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        title: "",
        head: "feature/new-feature",
        base: "main",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing head branch", () => {
      const result = CreatePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        title: "feat: add feature",
        base: "main",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty head branch", () => {
      const result = CreatePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        title: "feat: add feature",
        head: "",
        base: "main",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GetPRInputSchema", () => {
    it("should accept valid input", () => {
      const result = GetPRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        pullNumber: 42,
      });
      expect(result.success).toBe(true);
    });

    it("should reject non-positive pullNumber", () => {
      const result = GetPRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        pullNumber: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative pullNumber", () => {
      const result = GetPRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        pullNumber: -1,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer pullNumber", () => {
      const result = GetPRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        pullNumber: 42.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ListPRsInputSchema", () => {
    it("should accept valid input without state (defaults to open)", () => {
      const result = ListPRsInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.state).toBe("open");
      }
    });

    it("should accept valid state values", () => {
      for (const state of ["open", "closed", "all"]) {
        const result = ListPRsInputSchema.safeParse({
          owner: "my-org",
          repo: "my-repo",
          state,
        });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid state value", () => {
      const result = ListPRsInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        state: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MergePRInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = MergePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        pullNumber: 42,
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid merge methods", () => {
      for (const mergeMethod of ["merge", "squash", "rebase"]) {
        const result = MergePRInputSchema.safeParse({
          owner: "my-org",
          repo: "my-repo",
          pullNumber: 42,
          mergeMethod,
        });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid merge method", () => {
      const result = MergePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        pullNumber: 42,
        mergeMethod: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it("should accept optional commit title and message", () => {
      const result = MergePRInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        pullNumber: 42,
        commitTitle: "feat: merged feature",
        commitMessage: "Merged feature branch",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("GetFileContentsInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = GetFileContentsInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        path: "src/index.ts",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid input with ref", () => {
      const result = GetFileContentsInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        path: "src/index.ts",
        ref: "develop",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty path", () => {
      const result = GetFileContentsInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        path: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing path", () => {
      const result = GetFileContentsInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ListFilesInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = ListFilesInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
      });
      expect(result.success).toBe(true);
    });

    it("should default path to empty string (root)", () => {
      const result = ListFilesInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toBe("");
      }
    });

    it("should accept custom path", () => {
      const result = ListFilesInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        path: "src/components",
      });
      expect(result.success).toBe(true);
    });

    it("should accept optional ref", () => {
      const result = ListFilesInputSchema.safeParse({
        owner: "my-org",
        repo: "my-repo",
        ref: "main",
      });
      expect(result.success).toBe(true);
    });
  });
});
