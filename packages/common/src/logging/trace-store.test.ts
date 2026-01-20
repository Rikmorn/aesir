import { beforeEach, describe, expect, it } from "vitest";
import { createLogger, type LogEntry } from "./logger.js";
import { createTraceStore, type TraceStore } from "./trace-store.js";

/**
 * Helper to create a LogEntry for testing
 */
function createTestEntry(
  action: string,
  taskId?: string,
  workflowId?: string,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: "info",
    action,
    context: {
      ...(taskId !== undefined && { taskId }),
      ...(workflowId !== undefined && { workflowId }),
    },
  };
}

describe("TraceStore", () => {
  let store: TraceStore;

  beforeEach(() => {
    store = createTraceStore();
  });

  describe("append()", () => {
    it("appends entry with taskId to correct bucket", () => {
      const entry = createTestEntry("test_action", "TASK-001");
      store.append(entry);

      const entries = store.getByTaskId("TASK-001");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toBe(entry);
    });

    it("handles multiple entries for same taskId", () => {
      const entry1 = createTestEntry("action_1", "TASK-001");
      const entry2 = createTestEntry("action_2", "TASK-001");
      const entry3 = createTestEntry("action_3", "TASK-001");

      store.append(entry1);
      store.append(entry2);
      store.append(entry3);

      const entries = store.getByTaskId("TASK-001");
      expect(entries).toHaveLength(3);
    });

    it("ignores entry without taskId (no error)", () => {
      const entry = createTestEntry("test_action");
      expect(() => store.append(entry)).not.toThrow();
      expect(store.size()).toBe(0);
    });

    it("ignores entry with empty string taskId", () => {
      const entry = createTestEntry("test_action", "");
      store.append(entry);
      expect(store.size()).toBe(0);
    });

    it("separates entries for different taskIds", () => {
      store.append(createTestEntry("action_1", "TASK-001"));
      store.append(createTestEntry("action_2", "TASK-002"));
      store.append(createTestEntry("action_3", "TASK-001"));

      expect(store.getByTaskId("TASK-001")).toHaveLength(2);
      expect(store.getByTaskId("TASK-002")).toHaveLength(1);
    });
  });

  describe("getByTaskId()", () => {
    it("returns entries for existing taskId", () => {
      const entry1 = createTestEntry("action_1", "TASK-001");
      const entry2 = createTestEntry("action_2", "TASK-001");

      store.append(entry1);
      store.append(entry2);

      const entries = store.getByTaskId("TASK-001");
      expect(entries).toContain(entry1);
      expect(entries).toContain(entry2);
    });

    it("returns empty array for unknown taskId", () => {
      store.append(createTestEntry("action_1", "TASK-001"));

      const entries = store.getByTaskId("TASK-UNKNOWN");
      expect(entries).toEqual([]);
    });

    it("returns entries in append order", () => {
      const entry1 = createTestEntry("first", "TASK-001");
      const entry2 = createTestEntry("second", "TASK-001");
      const entry3 = createTestEntry("third", "TASK-001");

      store.append(entry1);
      store.append(entry2);
      store.append(entry3);

      const entries = store.getByTaskId("TASK-001");
      expect(entries).toHaveLength(3);
      expect(entries[0]?.action).toBe("first");
      expect(entries[1]?.action).toBe("second");
      expect(entries[2]?.action).toBe("third");
    });
  });

  describe("getByWorkflowId()", () => {
    it("returns entries matching workflowId", () => {
      const entry1 = createTestEntry("action_1", "TASK-001", "WORKFLOW-A");
      const entry2 = createTestEntry("action_2", "TASK-001", "WORKFLOW-A");
      const entry3 = createTestEntry("action_3", "TASK-001", "WORKFLOW-B");

      store.append(entry1);
      store.append(entry2);
      store.append(entry3);

      const entries = store.getByWorkflowId("WORKFLOW-A");
      expect(entries).toHaveLength(2);
      expect(entries).toContain(entry1);
      expect(entries).toContain(entry2);
    });

    it("returns empty array for unknown workflowId", () => {
      store.append(createTestEntry("action_1", "TASK-001", "WORKFLOW-A"));

      const entries = store.getByWorkflowId("WORKFLOW-UNKNOWN");
      expect(entries).toEqual([]);
    });

    it("works across multiple taskIds", () => {
      store.append(createTestEntry("action_1", "TASK-001", "WORKFLOW-A"));
      store.append(createTestEntry("action_2", "TASK-002", "WORKFLOW-A"));
      store.append(createTestEntry("action_3", "TASK-003", "WORKFLOW-B"));

      const entries = store.getByWorkflowId("WORKFLOW-A");
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.context.taskId)).toContain("TASK-001");
      expect(entries.map((e) => e.context.taskId)).toContain("TASK-002");
    });
  });

  describe("clear()", () => {
    it("clears specific taskId when provided", () => {
      store.append(createTestEntry("action_1", "TASK-001"));
      store.append(createTestEntry("action_2", "TASK-002"));

      store.clear("TASK-001");

      expect(store.getByTaskId("TASK-001")).toEqual([]);
      expect(store.getByTaskId("TASK-002")).toHaveLength(1);
    });

    it("clears all entries when no argument", () => {
      store.append(createTestEntry("action_1", "TASK-001"));
      store.append(createTestEntry("action_2", "TASK-002"));
      store.append(createTestEntry("action_3", "TASK-003"));

      store.clear();

      expect(store.getByTaskId("TASK-001")).toEqual([]);
      expect(store.getByTaskId("TASK-002")).toEqual([]);
      expect(store.getByTaskId("TASK-003")).toEqual([]);
    });

    it("size() returns 0 after clear()", () => {
      store.append(createTestEntry("action_1", "TASK-001"));
      store.append(createTestEntry("action_2", "TASK-002"));

      expect(store.size()).toBe(2);
      store.clear();
      expect(store.size()).toBe(0);
    });
  });

  describe("size()", () => {
    it("returns total entry count across all tasks", () => {
      store.append(createTestEntry("action_1", "TASK-001"));
      store.append(createTestEntry("action_2", "TASK-001"));
      store.append(createTestEntry("action_3", "TASK-002"));

      expect(store.size()).toBe(3);
    });

    it("returns 0 for empty store", () => {
      expect(store.size()).toBe(0);
    });
  });

  describe("Integration with Logger", () => {
    it("Logger with customOutput appends to TraceStore", () => {
      const logger = createLogger({
        minLevel: "debug",
        console: false,
        output: (entry) => store.append(entry),
        defaultContext: { taskId: "TASK-100" },
      });

      logger.info("node_start", { message: "Starting node" });
      logger.info("node_end", { message: "Node complete" });

      const entries = store.getByTaskId("TASK-100");
      expect(entries).toHaveLength(2);
      expect(entries[0]?.action).toBe("node_start");
      expect(entries[1]?.action).toBe("node_end");
    });

    it("Child logger with taskId produces queryable entries", () => {
      const rootLogger = createLogger({
        minLevel: "debug",
        console: false,
        output: (entry) => store.append(entry),
      });

      const taskLogger = rootLogger.child({
        taskId: "TASK-200",
        workflowId: "WF-001",
      });

      taskLogger.info("generate_code", { message: "Generating code" });
      taskLogger.info("run_tests", { message: "Running tests" });

      // Query by taskId
      const taskEntries = store.getByTaskId("TASK-200");
      expect(taskEntries).toHaveLength(2);

      // Query by workflowId
      const workflowEntries = store.getByWorkflowId("WF-001");
      expect(workflowEntries).toHaveLength(2);

      // Verify context is preserved
      expect(taskEntries[0]?.context.taskId).toBe("TASK-200");
      expect(taskEntries[0]?.context.workflowId).toBe("WF-001");
    });
  });

  describe("createTraceStore()", () => {
    it("creates a new TraceStore instance", () => {
      const store1 = createTraceStore();
      const store2 = createTraceStore();

      store1.append(createTestEntry("action_1", "TASK-001"));

      expect(store1.size()).toBe(1);
      expect(store2.size()).toBe(0);
    });
  });
});
