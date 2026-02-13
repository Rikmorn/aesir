/**
 * LLM Evaluator
 *
 * Feeds test evidence + success criteria to an LLM and gets a verdict.
 * Uses Haiku for speed and cost efficiency.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AgentTestScenario, TestEvidence, Verdict } from "./types.js";

const EVALUATION_MODEL = "claude-haiku-4-5-20251001";

export interface EvaluationResult {
  verdict: Verdict;
  reasoning: string;
}

function formatEvidence(evidence: TestEvidence): string {
  const sections: string[] = [];

  // Conversations
  sections.push("## Conversations");
  for (const c of evidence.conversations) {
    sections.push(
      `- **${c.id}** (agent: ${c.agentDefinitionId}, status: ${c.status}, task: ${c.taskId ?? "none"}, parent_conv: ${c.parentConversationId ?? "none"})`,
    );
  }

  // Tasks
  sections.push("\n## Tasks");
  for (const t of evidence.tasks) {
    sections.push(
      `- **${t.id}** (status: ${t.status}, depth: ${t.depth}, creator: ${t.creatorId}, assignee: ${t.assigneeId}, parent_task: ${t.parentId ?? "root"})`,
    );
    if (t.completionResult) {
      sections.push(
        `  completion_result: ${JSON.stringify(t.completionResult).slice(0, 500)}`,
      );
    }
  }

  // Handoffs
  sections.push("\n## Handoffs");
  if (evidence.handoffs.length === 0) {
    sections.push("- (none)");
  }
  for (const h of evidence.handoffs) {
    sections.push(
      `- **${h.handoffType}** on task ${h.taskId} by ${h.authorId} (conv: ${h.conversationId})`,
    );
    sections.push(`  context: ${JSON.stringify(h.context).slice(0, 300)}`);
  }

  // Events (grouped by conversation, showing tool calls and signals)
  sections.push("\n## Events (tool calls and signals, chronological)");
  const byConv = new Map<string, typeof evidence.events>();
  for (const e of evidence.events) {
    if (!byConv.has(e.conversationId)) byConv.set(e.conversationId, []);
    byConv.get(e.conversationId)?.push(e);
  }
  for (const [convId, events] of byConv) {
    sections.push(`\n### ${convId}`);
    for (const e of events) {
      const toolName =
        e.type === "tool.called" ||
        e.type === "tool.succeeded" ||
        e.type === "tool.failed"
          ? ` (${(e.payload as Record<string, unknown>).tool_name ?? "unknown"})`
          : "";
      const extra =
        e.type === "signal.received"
          ? ` signal_type=${(e.payload as Record<string, unknown>).signalType ?? "?"}`
          : "";
      sections.push(
        `  ${e.sequence}. ${e.type}${toolName}${extra} [${e.timestamp.toISOString()}]${e.durationMs ? ` ${e.durationMs}ms` : ""}`,
      );
    }
  }

  sections.push(`\n## Timing`);
  sections.push(`Total duration: ${evidence.durationMs}ms`);

  return sections.join("\n");
}

export async function evaluate(
  scenario: AgentTestScenario,
  evidence: TestEvidence,
): Promise<EvaluationResult> {
  const client = new Anthropic();

  const prompt = `You are a test evaluator for an agentic development platform. You are given a test scenario description, success criteria, and evidence collected from the database after running the test.

Your job is to determine whether the test PASSED or FAILED based on the evidence.

## Test Scenario
**Name:** ${scenario.name}
**Description:** ${scenario.description}

## Success Criteria
${scenario.expect}

## Evidence Collected
${formatEvidence(evidence)}

## Instructions
Evaluate the evidence against each success criterion. Be thorough but concise.

Respond in this exact format:
VERDICT: PASS or FAIL
REASONING:
- [criterion 1]: [pass/fail] - [brief explanation]
- [criterion 2]: [pass/fail] - [brief explanation]
...
SUMMARY: [one sentence overall summary]`;

  const response = await client.messages.create({
    model: EVALUATION_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse verdict
  const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL)/i);
  const verdict: Verdict = verdictMatch
    ? (verdictMatch[1].toLowerCase() as Verdict)
    : "error";

  return { verdict, reasoning: text };
}
