import type { AgentTestScenario } from "../types.js";

export const handoffScenario: AgentTestScenario = {
  id: "handoff",
  name: "Hand-off (Fire and Forget)",
  description:
    "Tests the hand-off pattern: assigner delegates a task, waits only for handshake acceptance, then completes its own task WITHOUT waiting for the acceptor's result.",
  trigger: {
    eventType: "testing.handoff.start",
  },
  timeoutMs: 60_000,
  expect: `
    - Two conversations created: one for test-handoff-assigner, one for test-handoff-acceptor
    - Both conversations completed successfully (status = "completed")
    - Assigner tool sequence includes: create_task, directory_find, delegate_task, wait_for, complete_task
    - IMPORTANT: wait_for (handshake) IS expected -- the assigner waits for accept/reject. The key distinction is that the assigner did NOT call wait_for_task -- it does not wait for the acceptor to finish their work.
    - Acceptor tool sequence includes: respond_task (accept), complete_task
    - Assigner completed its task after handshake acceptance, without waiting for the acceptor's completion result
    - The acceptor's completion signal may be queued on the assigner but never consumed (assigner already finished)
    - No conversations stuck in "waiting" or "running" status
    - No error events
  `,
  tags: ["handoff", "directory", "handshake"],
};
