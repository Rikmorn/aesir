import type { AgentTestScenario } from "../types.js";

export const parallelAnyScenario: AgentTestScenario = {
  id: "parallel-any",
  name: "Parallel Delegation (any_sufficient)",
  description:
    "Tests parallel delegation with any_sufficient policy: delegator sends a group of 2 tasks, wakes on first completion, checks group status, and completes.",
  trigger: {
    eventType: "testing.parallel_any.start",
  },
  timeoutMs: 90_000,
  expect: `
    - Three conversations created: test-parallel-delegator, test-parallel-fast-worker, test-parallel-slow-worker
    - Delegator completed successfully (status = "completed")
    - At least one worker completed (any_sufficient policy satisfied)
    - Delegator called delegate_group (not individual delegate calls)
    - A delegation_groups record exists with policy any_sufficient
    - Delegator woke from wait_for_group after first completion (not after both)
    - Delegator called group_status after waking
    - No conversations stuck in "waiting" or "running" status
    - No error events on the delegator conversation
  `,
  tags: ["parallel", "delegation", "group", "any-sufficient"],
};
