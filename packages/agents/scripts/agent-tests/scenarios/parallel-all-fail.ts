import type { AgentTestScenario } from "../types.js";

export const parallelAllFailScenario: AgentTestScenario = {
  id: "parallel-all-fail",
  name: "Parallel Delegation (all_required + Failure)",
  description:
    "Tests parallel delegation with all_required policy where one worker rejects. The group becomes unsatisfiable and the delegator handles the partial failure gracefully.",
  trigger: {
    eventType: "testing.parallel.allfail.start",
  },
  timeoutMs: 90_000,
  expect: `
    - Three conversations created: test-parallel-allfail-delegator, test-parallel-fast-worker, test-delegate-rejector
    - Rejector's task was rejected (respond_task with type "reject")
    - Delegator woke because all_required became unsatisfiable (one rejection)
    - Delegator called cancel_group OR completed after checking group_status
    - Delegator completed with a result noting the partial failure
    - No conversations stuck in "waiting" or "running" status indefinitely
    - Delegator used delegate_group (not individual delegate calls)
  `,
  tags: ["parallel", "delegation", "group", "all-required", "failure"],
};
