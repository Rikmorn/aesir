import type { AgentTestScenario } from "../types.js";

export const counterProposeScenario: AgentTestScenario = {
  id: "counter-propose",
  name: "Counter-Propose Handshake",
  description:
    "Tests the counter-propose path: delegator sends a task, responder counter-proposes with modified scope, delegator accepts, responder completes the work.",
  trigger: {
    eventType: "testing.counterpropose.start",
  },
  timeoutMs: 60_000,
  expect: `
    - Two conversations created: one for test-counterpropose-delegator, one for test-counterpropose-responder
    - Both conversations completed successfully (status = "completed")
    - Responder called respond_task with type "counter_propose" (NOT "accept")
    - A task_counter_proposed signal was received by the delegator
    - After delegator accepts: responder resumed and called complete_task
    - Delegator called wait_for_task BEFORE complete_task
    - No conversations stuck in "waiting" or "running" status
    - No error events
  `,
  tags: ["negotiation", "counter-propose", "handshake"],
};
