/**
 * Agent Test Framework Types
 *
 * LLM-driven integration testing for agent collaboration primitives.
 * Like Vitest, but the evaluator is an LLM that judges emergent behavior.
 */

export interface AgentTestScenario {
  /** Unique scenario ID (used as correlationId prefix) */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this scenario tests */
  description: string;
  /** Event to fire to trigger the scenario */
  trigger: {
    eventType: string;
    /** Event source (default: "testing") */
    source?: string;
  };
  /** Max time to wait for all conversations to settle (ms) */
  timeoutMs: number;
  /** Natural language success criteria for LLM evaluation */
  expect: string;
  /** Tags for filtering (e.g., "delegation", "handoff", "tools") */
  tags: string[];
}

export interface ConversationEvidence {
  id: string;
  agentDefinitionId: string;
  status: string;
  taskId: string | null;
  parentConversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskEvidence {
  id: string;
  parentId: string | null;
  creatorId: string;
  assigneeId: string;
  status: string;
  title: string;
  depth: number;
  completionResult: Record<string, unknown> | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface HandoffEvidence {
  id: string;
  taskId: string;
  conversationId: string;
  handoffType: string;
  context: Record<string, unknown>;
  authorId: string;
  createdAt: Date;
}

export interface EventEvidence {
  conversationId: string;
  agentDefinitionId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  durationMs: number | null;
}

export interface TestEvidence {
  conversations: ConversationEvidence[];
  tasks: TaskEvidence[];
  handoffs: HandoffEvidence[];
  events: EventEvidence[];
  durationMs: number;
}

export type Verdict = "pass" | "fail" | "error";

export interface TestResult {
  scenario: AgentTestScenario;
  verdict: Verdict;
  reasoning: string;
  evidence: TestEvidence;
  durationMs: number;
}
