import type { AgentTestScenario } from "../types.js";

export const treeBudgetScenario: AgentTestScenario = {
  id: "tree-budget",
  name: "Tree Budget Exhaustion",
  description:
    "Tests tree budget tracking: root agent with tight treeBudget delegates to a child. Verifies budget allocation, tree_budget tool, and exhaustion behavior.",
  trigger: {
    eventType: "testing.treebudget.start",
  },
  timeoutMs: 90_000,
  expect: `
    - Two conversations created: test-budget-root and test-budget-worker
    - The tree_budget tool was called by at least one agent and returned allocation/consumed/remaining data
    - At least one of these conditions is true:
      (a) tree_budget.warning event exists (80% threshold reached), OR
      (b) tree_budget.exhausted event exists, OR
      (c) a conversation failed with tree budget exhaustion
    - Root conversation eventually reaches terminal state (completed or failed)
    - Context injection visible: initial message includes "Tree budget:" text or treeBudget allocation info
    - No conversations stuck indefinitely
    - Budget tool calls succeeded (no tool.failed events for tree_budget)
  `,
  tags: ["tree-budget", "exhaustion", "delegation"],
};
