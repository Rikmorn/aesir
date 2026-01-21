import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "integration-github",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
