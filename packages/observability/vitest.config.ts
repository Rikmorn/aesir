import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "observability",
    environment: "node",
    // Tests not yet implemented - integration tests require testcontainers
    passWithNoTests: true,
  },
});
