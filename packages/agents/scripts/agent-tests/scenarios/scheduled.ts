import type { AgentTestScenario } from "../types.js";

export const scheduledScenario: AgentTestScenario = {
  id: "scheduled",
  name: "Scheduled Execution",
  description:
    "Tests that an agent with a schedule trigger can be started via event and completes successfully. The cron is set to never fire naturally (Jan 1 midnight) so this only tests the wiring.",
  trigger: {
    eventType: "testing.scheduled.start",
  },
  timeoutMs: 60_000,
  expect: `
    - One conversation created for test-scheduled-agent
    - Conversation completed successfully (status = "completed")
    - Agent completed its task with a summary of how it was triggered
    - No error events
    - Note: This scenario tests basic wiring via event trigger. Manual schedule trigger verification
      (POST /schedules/test-scheduled-agent/test-schedule/trigger) is a separate manual check.
  `,
  tags: ["schedule", "cron", "manual-trigger"],
};
