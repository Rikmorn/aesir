import type { AgentTestScenario } from "../types.js";

export const toolsScenario: AgentTestScenario = {
  id: "tools",
  name: "Tool Integration Exercise",
  description:
    "Tests that various tool namespaces are wired correctly: knowledge:store, knowledge:query, directory:find, communication:notify.",
  trigger: {
    eventType: "testing.tools.start",
  },
  timeoutMs: 60_000,
  expect: `
    - One conversation created for test-tool-exerciser
    - Conversation completed successfully (status = "completed")
    - Tool calls include: create_task, knowledge_store (or knowledge:store), knowledge_query (or knowledge:query), directory_find (or directory:find), communication_notify (or communication:notify), complete_task
    - All tool calls succeeded (no tool.failed events)
    - Knowledge store and query tools both completed without error
    - Directory find returned results
    - Notification was sent successfully
    - Agent's completion result summarizes tool outcomes
    - No error events
  `,
  tags: ["tools", "knowledge", "directory", "communication"],
};
