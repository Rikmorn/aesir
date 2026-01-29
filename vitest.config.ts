import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default test timeout (10s for unit tests, packages can override for integration)
    testTimeout: 10000,

    // Projects mode for monorepo - each package has its own vitest.config.ts
    // Note: packages/integrations/{linear,github,slack} are nested packages
    projects: [
      "packages/types",
      "packages/platform",
      "packages/observability",
      "packages/agents",
      "packages/integrations",
      "packages/integrations/linear",
      "packages/integrations/github",
      "packages/integrations/slack",
      "packages/test-utils",
    ],
    // Coverage configuration at workspace level
    // Note: Vitest ignores project-level coverage settings when running from root
    coverage: {
      // Enabled via CLI flag --coverage (off by default for faster tests)
      enabled: false,
      // V8 provider for fast, native coverage collection
      provider: "v8",
      // Output formats: text for console, html for browser, lcov for CI tools
      reporter: ["text", "html", "lcov"],
      // Coverage reports directory
      reportsDirectory: "./coverage",
      // Per-package thresholds using glob patterns
      thresholds: {
        // Core packages: higher thresholds (shared, foundational code)
        "packages/types/**/*.ts": {
          lines: 70,
          functions: 70,
          branches: 70,
          statements: 70,
        },
        "packages/platform/**/*.ts": {
          lines: 70,
          functions: 70,
          branches: 70,
          statements: 70,
        },
        "packages/observability/**/*.ts": {
          lines: 70,
          functions: 70,
          branches: 70,
          statements: 70,
        },
        // Integration packages: moderate thresholds (external service wrappers)
        "packages/integrations/**/*.ts": {
          lines: 50,
          functions: 50,
          branches: 50,
          statements: 50,
        },
        // Agent packages: moderate thresholds (orchestration logic)
        "packages/agents/**/*.ts": {
          lines: 50,
          functions: 50,
          branches: 50,
          statements: 50,
        },
      },
      // Files to exclude from coverage
      exclude: [
        // Dependencies and build output
        "**/node_modules/**",
        "**/dist/**",
        // Test files (all test patterns)
        "**/*.test.ts",
        "**/*.integration.test.ts",
        "**/*.e2e.test.ts",
        "**/__tests__/**",
        "**/__mocks__/**",
        // Database migrations and scripts
        "**/db/migrations/**",
        "**/db/scripts/**",
        // Entry points (minimal logic)
        "**/main.ts",
        // Type-only files (no runtime code)
        "**/types.ts",
        "**/schemas.ts",
        // Legacy code (pending cleanup)
        "**/_legacy/**",
        // Vitest config files
        "**/vitest.config.ts",
        // Drizzle schema files (for migration generation)
        "**/*.drizzle.ts",
        // Test utilities (helpers shouldn't count toward coverage)
        "**/test-utils/**",
      ],
    },
  },
});
