/**
 * Dev Agent Module
 *
 * Agentic orchestrator that autonomously handles development tasks.
 * Uses sub-agents (researcher, coder, tester) coordinated by an
 * orchestrator loop, wrapped in Temporal for durability.
 */

// Orchestrator
export {
  ORCHESTRATOR_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  CODER_SYSTEM_PROMPT,
  TESTER_SYSTEM_PROMPT,
} from "./orchestrator/system-prompts.js";

export {
  type OrchestratorOptions,
  runDevAgentOrchestrator,
} from "./orchestrator/orchestrator.js";

// Worker
export {
  createOrchestratorWorker,
  type DevAgentWorkerOptions,
} from "./worker.js";
