import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Projects mode for monorepo - each package has its own vitest.config.ts
    projects: ["packages/*"],
  },
});
