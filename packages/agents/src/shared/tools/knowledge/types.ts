/**
 * Shared types and constants for knowledge tools.
 */

export const KNOWLEDGE_TYPES = [
  "discovery",
  "constraint",
  "architecture_decision",
  "thought",
  "preference",
  "test_result",
] as const;

export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
