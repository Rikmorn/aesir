import { describe, expect, it } from "vitest";
import { generateCorrelationId } from "./correlation.js";
import { createChildLogger, createLogger } from "./pino-logger.js";

describe("createLogger", () => {
  it("should create a pino logger instance", () => {
    const logger = createLogger({ component: "test" });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should include service in base bindings", () => {
    const logger = createLogger({ service: "test-service" });
    const bindings = logger.bindings();
    expect(bindings.service).toBe("test-service");
  });

  it("should include component in base bindings", () => {
    const logger = createLogger({ component: "integrations:github" });
    const bindings = logger.bindings();
    expect(bindings.component).toBe("integrations:github");
  });

  it("should include correlation ID in base bindings", () => {
    const correlationId = generateCorrelationId("req");
    const logger = createLogger({ correlationId });
    const bindings = logger.bindings();
    expect(bindings.correlationId).toBe(correlationId);
  });

  it("should default service to aesir", () => {
    const logger = createLogger();
    const bindings = logger.bindings();
    expect(bindings.service).toBe("aesir");
  });

  it("should not include undefined optional fields", () => {
    const logger = createLogger({ service: "test" });
    const bindings = logger.bindings();
    expect(bindings.component).toBeUndefined();
    expect(bindings.correlationId).toBeUndefined();
  });
});

describe("createChildLogger", () => {
  it("should create a child logger with additional context", () => {
    const parent = createLogger({ service: "test" });
    const child = createChildLogger(parent, { component: "child-component" });

    const bindings = child.bindings();
    expect(bindings.service).toBe("test");
    expect(bindings.component).toBe("child-component");
  });

  it("should inherit parent bindings", () => {
    const parent = createLogger({
      service: "test",
      correlationId: "parent_123",
    });
    const child = createChildLogger(parent, { component: "child" });

    const bindings = child.bindings();
    expect(bindings.correlationId).toBe("parent_123");
  });

  it("should allow adding arbitrary context fields", () => {
    const parent = createLogger({ service: "test" });
    const child = createChildLogger(parent, {
      taskId: "TASK-001",
      workflowId: "WF-123",
    });

    const bindings = child.bindings();
    expect(bindings.taskId).toBe("TASK-001");
    expect(bindings.workflowId).toBe("WF-123");
  });
});

describe("generateCorrelationId", () => {
  it("should generate ID with correct prefix", () => {
    expect(generateCorrelationId("req")).toMatch(/^req_/);
    expect(generateCorrelationId("agent")).toMatch(/^agent_/);
    expect(generateCorrelationId("tool")).toMatch(/^tool_/);
    expect(generateCorrelationId("api")).toMatch(/^api_/);
    expect(generateCorrelationId("job")).toMatch(/^job_/);
  });

  it("should generate unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCorrelationId("req"));
    }
    expect(ids.size).toBe(100);
  });

  it("should generate IDs of expected length", () => {
    const id = generateCorrelationId("req");
    // Format: prefix_ + 16 chars
    expect(id.length).toBe("req_".length + 16);
  });
});
