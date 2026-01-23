import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "integration-linear",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Exclude integration tests from default run (use test:integration)
    exclude: ["src/**/*.integration.test.ts"],
  },
});
