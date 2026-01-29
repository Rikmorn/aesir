import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "types",
    environment: "node",
    // Types package has no runtime code to test
    passWithNoTests: true,
  },
});
