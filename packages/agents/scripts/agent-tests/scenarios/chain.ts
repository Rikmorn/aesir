import type { AgentTestScenario } from "../types.js";

export const chainScenario: AgentTestScenario = {
  id: "chain",
  name: "Chain Delegation (A→B→C)",
  description:
    "Tests multi-hop delegation: initiator delegates to a relay agent, which delegates further to an acceptor. Results propagate back up the chain.",
  trigger: {
    eventType: "testing.chain.start",
  },
  timeoutMs: 90_000,
  expect: `
    - Three conversations created: test-chain-initiator, test-chain-relay, test-delegate-acceptor
    - All three conversations completed successfully (status = "completed")
    - Initiator delegated to relay, relay delegated to acceptor (task parent chain visible in tasks table)
    - Task depth increments correctly: initiator's task depth 0, relay's delegated task depth 1, acceptor's delegated task depth 2 (NOTE: if all depths are 0, that's a known framework bug -- still flag as fail)
    - Handshake signals: relay accepted from initiator, acceptor accepted from relay
    - Completion signals: acceptor completed back to relay, relay completed back to initiator
    - Result propagation: initiator's completion result references relay's result, which references acceptor's result
    - Correct ordering at each hop: wait_for_task called BEFORE complete_task
    - No conversations stuck in "waiting" or "running" status
    - Transient tool failures that succeed on retry are acceptable -- only flag persistent failures where the tool never succeeded
  `,
  tags: ["delegation", "chain", "depth-tracking", "result-propagation"],
};
