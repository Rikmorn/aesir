import type { AgentTestScenario } from "../types.js";

export const delegationScenario: AgentTestScenario = {
  id: "delegation",
  name: "Basic Delegation",
  description:
    "Tests the full delegation pattern: assigner discovers an agent via directory, delegates a task, waits for handshake acceptance, waits for completion result, then completes its own task.",
  trigger: {
    eventType: "testing.delegate.start",
  },
  timeoutMs: 60_000,
  expect: `
    - Two conversations created: one for test-delegate-assigner, one for test-delegate-acceptor
    - Both conversations completed successfully (status = "completed")
    - Assigner tool sequence includes: create_task, directory_find, delegate_task, wait_for, wait_for_task, complete_task
    - Acceptor tool sequence includes: respond_task (accept), complete_task
    - A task_handshake handoff exists (acceptor accepting the delegation)
    - A task_completion handoff exists (acceptor completing the work)
    - Correct ordering: assigner called wait_for_task BEFORE complete_task (not the other way around)
    - Assigner's completion result references the acceptor's outcome
    - No conversations stuck in "waiting" or "running" status
    - No error events
  `,
  tags: ["delegation", "directory", "handshake", "completion-signal"],
};
