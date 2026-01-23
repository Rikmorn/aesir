import { defineConfig } from "vitest/config";

// Dedicated config for integration tests only
// Usage: pnpm test:integration (or vitest run -c vitest.integration.config.ts)
export default defineConfig({
  test: {
    name: "integration-tests",
    environment: "node",
    // Only include integration test files
    include: ["packages/**/*.integration.test.ts"],
    // Longer timeout for database/container tests
    testTimeout: 60000,
    // Disable workspace projects - run tests directly
    // This avoids package-level exclude patterns
  },
});
