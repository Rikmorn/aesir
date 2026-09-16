import { describe, expect, it } from "vitest";
import { createMockLogger } from "./index.js";

describe("@aesir/test-utils", () => {
  describe("createMockLogger", () => {
    it("captures log calls", () => {
      const logger = createMockLogger();

      logger.info({ userId: 123 }, "User logged in");
      logger.error("Something went wrong");

      expect(logger.calls).toHaveLength(2);
      expect(logger.getCallsAt("info")).toHaveLength(1);
      expect(logger.getCallsAt("error")).toHaveLength(1);
    });

    it("hasLoggedAt checks log messages", () => {
      const logger = createMockLogger();

      logger.info("User authenticated");
      logger.warn("Rate limit exceeded");

      expect(logger.hasLoggedAt("info")).toBe(true);
      expect(logger.hasLoggedAt("info", "authenticated")).toBe(true);
      expect(logger.hasLoggedAt("info", /authen/)).toBe(true);
      expect(logger.hasLoggedAt("info", "nonexistent")).toBe(false);
      expect(logger.hasLoggedAt("debug")).toBe(false);
    });

    it("clear removes all calls", () => {
      const logger = createMockLogger();

      logger.info("test");
      expect(logger.calls).toHaveLength(1);

      logger.clear();
      expect(logger.calls).toHaveLength(0);
    });
  });
});
