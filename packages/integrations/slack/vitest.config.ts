import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "integration-slack",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
