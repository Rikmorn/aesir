import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each package carries its own config, referenced here by directory. A root
    // `testTimeout` would not reach those projects (measured: a 6s test still
    // fails at the 5s default), so per-suite timeouts are set inside the two
    // inline projects below and in the package configs that need them.
    projects: [
      "packages/types",
      "packages/platform",
      "packages/observability",
      "packages/agents",
      "packages/integrations/linear",
      "packages/integrations/github",
      "packages/integrations/slack",
      "packages/test-utils",
      "packages/dashboard",

      {
        test: {
          name: "integration",
          include: ["packages/**/*.integration.test.ts"],
          // Spelling `exclude` replaces vitest's defaults rather than adding to
          // them, and @aesir/platform is symlinked into each package's
          // node_modules, so dropping defaultExclude matches the same file
          // several times over. The sandbox suite owns that directory,
          // including dev-container.integration.test.ts.
          exclude: [...defaultExclude, "packages/platform/src/sandbox/**"],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "sandbox",
          include: ["packages/platform/src/sandbox/**/*.test.ts"],
          // Docker container operations are slow.
          testTimeout: 120_000,
        },
      },
    ],

    // Vitest ignores project-level coverage settings when running from the root.
    coverage: {
      reporter: ["text", "html", "lcov"],
      thresholds: {
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
        "packages/integrations/**/*.ts": {
          lines: 50,
          functions: 50,
          branches: 50,
          statements: 50,
        },
        "packages/agents/**/*.ts": {
          lines: 50,
          functions: 50,
          branches: 50,
          statements: 50,
        },
      },
      // coverageConfigDefaults.exclude is [] in 5.0.1, yet removing the first
      // three below changes the report in no way (measured: same totals, same
      // 178 lines), so v8 drops them by an implicit rule the defaults array
      // does not describe. They are kept so the exclusion is stated rather
      // than resting on undocumented behaviour.
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/vitest.config.ts",
        "**/*.test.ts",
        "**/*.integration.test.ts",
        "**/*.e2e.test.ts",
        "**/db/migrations/**",
        // Entry points (minimal logic)
        "**/main.ts",
        // Type-only files (no runtime code)
        "**/types.ts",
        "**/schemas.ts",
        // Generated for drizzle-kit migration generation
        "**/*.drizzle.ts",
        // Helpers shouldn't count toward coverage
        "**/test-utils/**",
      ],
    },
  },
});
