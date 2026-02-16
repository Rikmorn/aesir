import type { AgentTestScenario } from "../types.js";

export const toolsScenario: AgentTestScenario = {
  id: "tools",
  name: "Tool Integration Exercise",
  description:
    "Tests that various tool namespaces are wired correctly: knowledge:store, knowledge:query, directory:find.",
  trigger: {
    eventType: "testing.tools.start",
  },
  timeoutMs: 60_000,
  expect: `
    - One conversation created for test-tool-exerciser
    - Conversation completed successfully (status = "completed")
    - Tool calls include: create_task, knowledge_store (or knowledge:store), knowledge_query (or knowledge:query), directory_find (or directory:find), complete_task
    - All tool calls succeeded (no tool.failed events)
    - Knowledge store and query tools both completed without error
    - Directory find returned results
    - Agent's completion result summarizes tool outcomes
    - No error events
  `,
  tags: ["tools", "knowledge", "directory"],
};
