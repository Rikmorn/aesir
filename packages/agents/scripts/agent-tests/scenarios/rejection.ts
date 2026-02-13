import type { AgentTestScenario } from "../types.js";

export const rejectionScenario: AgentTestScenario = {
  id: "rejection",
  name: "Delegation Rejection",
  description:
    "Tests the rejection path: assigner delegates to an agent that always rejects. The assigner should handle the rejection gracefully and complete its own task.",
  trigger: {
    eventType: "testing.reject.start",
  },
  timeoutMs: 60_000,
  expect: `
    - Two conversations created: test-reject-assigner and test-delegate-rejector
    - Both conversations completed successfully (status = "completed")
    - Rejector called respond_task with a rejection (not acceptance)
    - A task_handshake handoff exists with rejection context
    - Assigner received the rejection signal and handled it gracefully
    - Assigner completed its own task with a result noting the rejection
    - No task_completion handoff from the rejector (it rejected, so no completion)
    - No conversations stuck in "waiting" or "running" status
    - No error events
  `,
  tags: ["delegation", "rejection", "handshake", "error-handling"],
};
