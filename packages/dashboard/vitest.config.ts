import { resolve } from "node:path";
import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "dashboard",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
