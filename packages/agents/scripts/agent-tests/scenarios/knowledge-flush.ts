import type { AgentTestScenario } from "../types.js";

export const knowledgeFlushScenario: AgentTestScenario = {
  id: "knowledge-flush",
  name: "Knowledge Flush Before Compaction",
  description:
    "Tests that knowledge flush fires before history compaction. Agent generates substantial output with a very low pruneThreshold (4000) to trigger compaction, verifying the flush mechanism.",
  trigger: {
    eventType: "testing.knowledgeflush.start",
  },
  timeoutMs: 120_000,
  expect: `
    - One conversation created for test-knowledge-flusher
    - Conversation completed successfully (status = "completed")
    - knowledge_store tool called at least once (manual storage)
    - knowledge_query tool called and returned results
    - If compaction occurred (summary message present or history was pruned):
      - A knowledge flush prompt was injected (look for knowledge_flush in events or tool calls)
      - knowledge_store called a second time during the flush
    - If compaction did NOT trigger (possible within token budget):
      - Manual knowledge operations still succeeded
      - This is acceptable -- the low pruneThreshold maximizes chances but doesn't guarantee compaction
    - No errors from knowledge tools (no tool.failed events for knowledge_store or knowledge_query)
    - Agent completed its task
  `,
  tags: ["knowledge", "flush", "compaction", "lifecycle-hooks"],
};
