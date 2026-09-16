import type { AgentTestScenario } from "../types.js";

export const clarificationScenario: AgentTestScenario = {
  id: "clarification",
  name: "Clarification Round-Trip",
  description:
    "Tests the clarification protocol: delegator sends a task, worker accepts then asks a clarification question, delegator answers, worker completes with the clarified information.",
  trigger: {
    eventType: "testing.clarify.start",
  },
  timeoutMs: 90_000,
  expect: `
    - Two conversations created: one for test-clarify-delegator, one for test-clarify-worker
    - Both conversations completed successfully (status = "completed")
    - Worker called clarify_task (sends task_clarification signal to delegator)
    - Delegator called answer_task (sends task_clarification_response signal to worker)
    - Worker resumed after receiving answer and called complete_task
    - Delegator's completion result references the worker's outcome
    - No conversations stuck in "waiting" or "running" status
    - No timeout signals -- the clarification round-trip completed normally
  `,
  tags: ["negotiation", "clarification", "multi-round"],
};
