/**
 * Dev Agent Orchestrator Module
 *
 * Entry point and system prompts for the dev agent orchestrator.
 * The orchestrator replaces the 13-node LangGraph graph with an
 * agentic tool-use loop driven by static system prompts.
 *
 * Exports:
 * - runDevAgentOrchestrator: Top-level entry point
 * - OrchestratorOptions: Configuration interface
 * - System prompts: ORCHESTRATOR_, RESEARCHER_, CODER_, TESTER_SYSTEM_PROMPT
 */

export {
  type OrchestratorOptions,
  runDevAgentOrchestrator,
} from "./orchestrator.js";
export {
  CODER_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  TESTER_SYSTEM_PROMPT,
} from "./system-prompts.js";
