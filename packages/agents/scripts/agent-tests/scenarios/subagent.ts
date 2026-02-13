import type { AgentTestScenario } from "../types.js";

export const subagentScenario: AgentTestScenario = {
  id: "subagent",
  name: "Sub-Agent Spawning",
  description:
    "Tests sub-agent spawning: parent agent spawns a child via coordination:spawn_agent, receives the child's result, and completes its own task.",
  trigger: {
    eventType: "testing.subagent.start",
  },
  timeoutMs: 60_000,
  expect: `
    - A parent conversation created for test-subagent-parent
    - A child conversation created for test-subagent-child (linked via parent_conversation_id)
    - Parent called coordination:spawn_agent tool
    - Child conversation completed with a text result
    - Parent received the child's result and completed its own task
    - Parent's completion result references the child's output
    - Both conversations completed successfully
    - No error events
  `,
  tags: ["subagent", "spawn", "result-propagation"],
};
