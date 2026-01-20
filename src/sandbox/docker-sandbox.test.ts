/**
 * Docker Sandbox Tests
 *
 * Tests for DockerSandbox functionality including command execution,
 * file operations, and test execution.
 *
 * These tests require Docker daemon to be running.
 * Use longer timeouts for container operations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerSandbox } from "./docker-sandbox.js";
import type { Sandbox } from "./types.js";

// Suppress console output during tests
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DockerSandbox", () => {
  // Longer timeout for Docker operations
  const TEST_TIMEOUT = 30000;

  describe("create", () => {
    it(
      "should create a sandbox instance",
      async () => {
        const sandbox = await DockerSandbox.create();
        try {
          expect(sandbox).toBeInstanceOf(DockerSandbox);
        } finally {
          await sandbox.cleanup();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      "should use custom image if provided",
      async () => {
        // Using the default node:20-slim should work
        const sandbox = await DockerSandbox.create({ image: "node:20-slim" });
        try {
          const result = await sandbox.execute(["node", "--version"]);
          expect(result.stdout).toMatch(/v20/);
        } finally {
          await sandbox.cleanup();
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("execute", () => {
    let sandbox: Sandbox;

    beforeEach(async () => {
      sandbox = await DockerSandbox.create();
    }, TEST_TIMEOUT);

    afterEach(async () => {
      await sandbox.cleanup();
    }, TEST_TIMEOUT);

    it(
      "should execute simple command and capture stdout",
      async () => {
        const result = await sandbox.execute(["echo", "hello world"]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("hello world");
        expect(result.stderr).toBe("");
      },
      TEST_TIMEOUT,
    );

    it(
      "should capture stderr for failed commands",
      async () => {
        const result = await sandbox.execute(["ls", "/nonexistent"]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("No such file");
      },
      TEST_TIMEOUT,
    );

    it(
      "should return correct exit code",
      async () => {
        const result = await sandbox.execute(["sh", "-c", "exit 42"]);
        expect(result.exitCode).toBe(42);
      },
      TEST_TIMEOUT,
    );

    it(
      "should handle multi-line output",
      async () => {
        const result = await sandbox.execute([
          "sh",
          "-c",
          "echo line1; echo line2; echo line3",
        ]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("line1");
        expect(result.stdout).toContain("line2");
        expect(result.stdout).toContain("line3");
      },
      TEST_TIMEOUT,
    );

    it(
      "should execute node commands",
      async () => {
        const result = await sandbox.execute([
          "node",
          "-e",
          "console.log(1 + 2)",
        ]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("3");
      },
      TEST_TIMEOUT,
    );
  });

  describe("file operations", () => {
    let sandbox: Sandbox;

    beforeEach(async () => {
      sandbox = await DockerSandbox.create();
    }, TEST_TIMEOUT);

    afterEach(async () => {
      await sandbox.cleanup();
    }, TEST_TIMEOUT);

    it(
      "should write and read files",
      async () => {
        await sandbox.writeFile("/tmp/test.txt", "hello sandbox");
        const content = await sandbox.readFile("/tmp/test.txt");
        expect(content).toBe("hello sandbox");
      },
      TEST_TIMEOUT,
    );

    it(
      "should handle multi-line content",
      async () => {
        const content = "line1\nline2\nline3";
        await sandbox.writeFile("/tmp/multi.txt", content);
        const result = await sandbox.readFile("/tmp/multi.txt");
        expect(result).toBe(content);
      },
      TEST_TIMEOUT,
    );

    it(
      "should handle special characters in content",
      async () => {
        const content = 'const x = "hello"\nconst y = `template ${"literal"}`';
        await sandbox.writeFile("/tmp/special.ts", content);
        const result = await sandbox.readFile("/tmp/special.ts");
        expect(result).toBe(content);
      },
      TEST_TIMEOUT,
    );

    it(
      "should write to nested paths when parent is created first",
      async () => {
        // Create parent directory first
        await sandbox.execute(["mkdir", "-p", "/tmp/nested"]);
        await sandbox.writeFile("/tmp/nested/test.txt", "nested content");
        const result = await sandbox.readFile("/tmp/nested/test.txt");
        expect(result).toBe("nested content");
      },
      TEST_TIMEOUT,
    );

    it(
      "should execute written files",
      async () => {
        const script = 'console.log("executed!")';
        await sandbox.writeFile("/tmp/script.js", script);
        const result = await sandbox.execute(["node", "/tmp/script.js"]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("executed!");
      },
      TEST_TIMEOUT,
    );
  });

  describe("runTests", () => {
    let sandbox: Sandbox;

    beforeEach(async () => {
      sandbox = await DockerSandbox.create();
    }, TEST_TIMEOUT);

    afterEach(async () => {
      await sandbox.cleanup();
    }, TEST_TIMEOUT);

    it(
      "should return passed=true for exit code 0",
      async () => {
        const result = await sandbox.runTests(["sh", "-c", "exit 0"]);
        expect(result.passed).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.summary).toBe("All tests passed");
      },
      TEST_TIMEOUT,
    );

    it(
      "should return passed=false for non-zero exit",
      async () => {
        const result = await sandbox.runTests(["sh", "-c", "exit 1"]);
        expect(result.passed).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.summary).toContain("failed");
        expect(result.summary).toContain("exit code 1");
      },
      TEST_TIMEOUT,
    );

    it(
      "should capture stdout from test command",
      async () => {
        const result = await sandbox.runTests([
          "sh",
          "-c",
          "echo 'Test output'; exit 0",
        ]);
        expect(result.passed).toBe(true);
        expect(result.stdout).toContain("Test output");
      },
      TEST_TIMEOUT,
    );

    it(
      "should capture stderr from failed tests",
      async () => {
        const result = await sandbox.runTests([
          "sh",
          "-c",
          "echo 'Error!' >&2; exit 1",
        ]);
        expect(result.passed).toBe(false);
        expect(result.stderr).toContain("Error!");
      },
      TEST_TIMEOUT,
    );
  });

  describe("cleanup", () => {
    it(
      "should remove container after cleanup",
      async () => {
        const sandbox = await DockerSandbox.create();
        await sandbox.cleanup();

        // Attempting to execute after cleanup should throw
        await expect(sandbox.execute(["echo", "test"])).rejects.toThrow(
          "Sandbox has been cleaned up",
        );
      },
      TEST_TIMEOUT,
    );

    it(
      "should be safe to call cleanup multiple times",
      async () => {
        const sandbox = await DockerSandbox.create();
        await sandbox.cleanup();
        // Second cleanup should not throw
        await expect(sandbox.cleanup()).resolves.not.toThrow();
      },
      TEST_TIMEOUT,
    );

    it(
      "should reject writeFile after cleanup",
      async () => {
        const sandbox = await DockerSandbox.create();
        await sandbox.cleanup();
        await expect(
          sandbox.writeFile("/tmp/test.txt", "content"),
        ).rejects.toThrow("Sandbox has been cleaned up");
      },
      TEST_TIMEOUT,
    );

    it(
      "should reject readFile after cleanup",
      async () => {
        const sandbox = await DockerSandbox.create();
        await sandbox.cleanup();
        await expect(sandbox.readFile("/tmp/test.txt")).rejects.toThrow(
          "Sandbox has been cleaned up",
        );
      },
      TEST_TIMEOUT,
    );
  });

  describe("integration", () => {
    it(
      "should support complete workflow: write file, run tests, get result",
      async () => {
        const sandbox = await DockerSandbox.create();
        try {
          // Write a test script
          const testScript = `
const assert = require('assert')

function add(a, b) {
  return a + b
}

assert.strictEqual(add(2, 3), 5)
assert.strictEqual(add(-1, 1), 0)
console.log('All assertions passed!')
`;
          await sandbox.writeFile("/tmp/test.js", testScript);

          // Run the test
          const result = await sandbox.runTests(["node", "/tmp/test.js"]);

          expect(result.passed).toBe(true);
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("All assertions passed!");
        } finally {
          await sandbox.cleanup();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      "should detect failing tests correctly",
      async () => {
        const sandbox = await DockerSandbox.create();
        try {
          // Write a failing test
          const failingTest = `
const assert = require('assert')
assert.strictEqual(1, 2) // This will fail
`;
          await sandbox.writeFile("/tmp/failing.js", failingTest);

          const result = await sandbox.runTests(["node", "/tmp/failing.js"]);

          expect(result.passed).toBe(false);
          expect(result.exitCode).not.toBe(0);
          expect(result.stderr).toContain("AssertionError");
        } finally {
          await sandbox.cleanup();
        }
      },
      TEST_TIMEOUT,
    );
  });
});
