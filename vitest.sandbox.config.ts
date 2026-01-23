import { defineConfig } from "vitest/config";

// Dedicated config for sandbox/Docker tests
// Usage: pnpm test:sandbox (or vitest run -c vitest.sandbox.config.ts)
// Requires Docker to be running
export default defineConfig({
  test: {
    name: "sandbox-tests",
    environment: "node",
    // Only include sandbox test files
    include: ["packages/platform/src/sandbox/**/*.test.ts"],
    // Long timeout - Docker container operations are slow
    testTimeout: 120000,
    // No workspace projects - run tests directly
  },
});
