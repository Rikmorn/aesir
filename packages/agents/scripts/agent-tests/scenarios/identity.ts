import type { AgentTestScenario } from "../types.js";

export const identityScenario: AgentTestScenario = {
  id: "identity",
  name: "Identity Document Persistence",
  description:
    "Tests identity document persistence: agent writes a product_brief document, reads it back to verify, and reports the content in its completion result.",
  trigger: {
    eventType: "testing.identity.start",
  },
  timeoutMs: 60_000,
  expect: `
    - One conversation created for test-identity-writer
    - Conversation completed successfully (status = "completed")
    - identity_update tool called with document_type "product_brief"
    - identity_read tool called and returned the document content
    - Tool calls succeeded (no tool.failed events for identity tools)
    - Completion result references the document content
    - No error events
  `,
  tags: ["identity", "persistence", "lifecycle-hooks"],
};
