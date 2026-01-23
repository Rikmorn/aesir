import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "platform",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Exclude integration tests and sandbox tests from default run
    // (use test:integration for DB tests, sandbox tests require Docker)
    exclude: ["src/**/*.integration.test.ts", "src/sandbox/**/*.test.ts"],
    // Longer timeout for sandbox tests
    testTimeout: 30000,
  },
});
