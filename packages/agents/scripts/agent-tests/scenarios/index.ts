import type { AgentTestScenario } from "../types.js";
import { chainScenario } from "./chain.js";
import { clarificationScenario } from "./clarification.js";
import { counterProposeScenario } from "./counter-propose.js";
import { delegationScenario } from "./delegation.js";
import { handoffScenario } from "./handoff.js";
import { identityScenario } from "./identity.js";
import { knowledgeFlushScenario } from "./knowledge-flush.js";
import { parallelAllFailScenario } from "./parallel-all-fail.js";
import { parallelAnyScenario } from "./parallel-any.js";
import { rejectionScenario } from "./rejection.js";
import { scheduledScenario } from "./scheduled.js";
import { subagentScenario } from "./subagent.js";
import { timeoutScenario } from "./timeout.js";
import { toolsScenario } from "./tools.js";
import { treeBudgetScenario } from "./tree-budget.js";

export const allScenarios: AgentTestScenario[] = [
  delegationScenario,
  handoffScenario,
  chainScenario,
  rejectionScenario,
  timeoutScenario,
  subagentScenario,
  toolsScenario,
  counterProposeScenario,
  clarificationScenario,
  parallelAnyScenario,
  parallelAllFailScenario,
  treeBudgetScenario,
  identityScenario,
  knowledgeFlushScenario,
  scheduledScenario,
];

export function getScenario(id: string): AgentTestScenario | undefined {
  return allScenarios.find((s) => s.id === id);
}

export function getScenariosByTag(tag: string): AgentTestScenario[] {
  return allScenarios.filter((s) => s.tags.includes(tag));
}
