import type { AgentTestScenario } from "../types.js";

export const timeoutScenario: AgentTestScenario = {
  id: "timeout",
  name: "Delegation Timeout",
  description:
    "Tests the timeout path: assigner delegates to an agent that never responds. The 30s handshake timeout should fire, and the assigner should handle it gracefully.",
  trigger: {
    eventType: "testing.timeout.start",
  },
  timeoutMs: 90_000,
  expect: `
    - Two conversations created: test-timeout-assigner and test-delegate-staller
    - Staller conversation completed (it has no respond tool, so it just ends)
    - Assigner was paused waiting for task_handshake
    - After ~30 seconds, the timeout signal should have fired and resumed the assigner
    - Assigner completed its own task with a result noting the timeout
    - Both conversations ended in "completed" or "failed" status (no indefinite "waiting")
    - A signal.received event with timeout context exists on the assigner's conversation
    - No infinite wait — the scenario completed within the timeout window
  `,
  tags: ["delegation", "timeout", "error-handling"],
};
