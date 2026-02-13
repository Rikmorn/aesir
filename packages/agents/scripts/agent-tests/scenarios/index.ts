import type { AgentTestScenario } from "../types.js";
import { chainScenario } from "./chain.js";
import { delegationScenario } from "./delegation.js";
import { handoffScenario } from "./handoff.js";
import { rejectionScenario } from "./rejection.js";
import { subagentScenario } from "./subagent.js";
import { timeoutScenario } from "./timeout.js";
import { toolsScenario } from "./tools.js";

export const allScenarios: AgentTestScenario[] = [
  delegationScenario,
  handoffScenario,
  chainScenario,
  rejectionScenario,
  timeoutScenario,
  subagentScenario,
  toolsScenario,
];

export function getScenario(id: string): AgentTestScenario | undefined {
  return allScenarios.find((s) => s.id === id);
}

export function getScenariosByTag(tag: string): AgentTestScenario[] {
  return allScenarios.filter((s) => s.tags.includes(tag));
}
