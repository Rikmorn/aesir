/**
 * Test Runner
 *
 * Fires test events, polls for completion, collects evidence, evaluates.
 */

import { eq, like, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { conversations, tasks } from "../../src/shared/db/schema.js";
import { evaluate } from "./evaluator.js";
import { collectEvidence } from "./evidence.js";
import type { AgentTestScenario, TestResult } from "./types.js";

const AGENT_SERVICE_URL =
  process.env.AGENT_SERVICE_URL || "http://localhost:3004";
const POLL_INTERVAL_MS = 2000;

/**
 * Fire a test event to the agent service
 */
async function fireEvent(
  scenario: AgentTestScenario,
  correlationId: string,
): Promise<void> {
  const event = {
    id: `evt_test_${scenario.id}_${Date.now()}`,
    type: scenario.trigger.eventType,
    source: scenario.trigger.source ?? "testing",
    timestamp: new Date().toISOString(),
    correlationId,
    payload: { correlationKey: correlationId },
  };

  const response = await fetch(`${AGENT_SERVICE_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fire event: ${response.status} ${await response.text()}`,
    );
  }

  const result = await response.json();
  if (!result.received) {
    throw new Error(`Event not received: ${JSON.stringify(result)}`);
  }
}

/**
 * Poll until all conversations for this test have settled (completed/failed)
 * or the timeout is reached.
 */
async function waitForSettled(
  db: PostgresJsDatabase,
  correlationId: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Find all conversations matching this test
    const convs = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        taskId: conversations.task_id,
      })
      .from(conversations)
      .where(like(conversations.id, `%-${correlationId}`));

    if (convs.length === 0) {
      // Not started yet, keep polling
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Find all task IDs from primary conversations
    const taskIds = convs
      .map((c) => c.taskId)
      .filter((id): id is string => id !== null);

    // Find all delegated conversations (linked to child tasks)
    let delegatedConvs: { id: string; status: string }[] = [];
    if (taskIds.length > 0) {
      // Find child tasks recursively
      const allTaskIds = await findAllTaskIds(db, taskIds);
      if (allTaskIds.length > 0) {
        delegatedConvs = await db
          .select({ id: conversations.id, status: conversations.status })
          .from(conversations)
          .where(
            or(
              ...allTaskIds.map((id) => eq(conversations.task_id, id)),
              ...allTaskIds.map((id) => like(conversations.id, `%-${id}`)),
            ),
          );
      }
    }

    // Also find sub-agent conversations
    const primaryIds = convs.map((c) => c.id);
    let subAgentConvs: { id: string; status: string }[] = [];
    if (primaryIds.length > 0) {
      subAgentConvs = await db
        .select({ id: conversations.id, status: conversations.status })
        .from(conversations)
        .where(
          or(
            ...primaryIds.map((id) =>
              eq(conversations.parent_conversation_id, id),
            ),
          ),
        );
    }

    // Merge all conversations
    const allConvsMap = new Map<string, string>();
    for (const c of [...convs, ...delegatedConvs, ...subAgentConvs]) {
      allConvsMap.set(c.id, c.status);
    }

    const statuses = Array.from(allConvsMap.values());
    const allSettled = statuses.every(
      (s) => s === "completed" || s === "failed",
    );

    if (allSettled && statuses.length > 0) {
      return true;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return false; // Timed out
}

async function findAllTaskIds(
  db: PostgresJsDatabase,
  rootTaskIds: string[],
): Promise<string[]> {
  const allIds = new Set(rootTaskIds);
  const queue = [...rootTaskIds];

  while (queue.length > 0) {
    const currentId = queue.pop();
    if (!currentId) continue;
    const children = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parent_id, currentId));
    for (const child of children) {
      if (!allIds.has(child.id)) {
        allIds.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return Array.from(allIds);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single test scenario end-to-end
 */
export async function runScenario(
  db: PostgresJsDatabase,
  scenario: AgentTestScenario,
  log: (msg: string) => void,
): Promise<TestResult> {
  const correlationId = `test-${scenario.id}-${Date.now()}`;
  const startTime = new Date();

  log(`  Firing event: ${scenario.trigger.eventType}`);
  try {
    await fireEvent(scenario, correlationId);
  } catch (err) {
    return {
      scenario,
      verdict: "error",
      reasoning: `Failed to fire event: ${err}`,
      evidence: {
        conversations: [],
        tasks: [],
        handoffs: [],
        events: [],
        durationMs: 0,
      },
      durationMs: Date.now() - startTime.getTime(),
    };
  }

  log(
    `  Waiting for conversations to settle (timeout: ${scenario.timeoutMs / 1000}s)...`,
  );
  const settled = await waitForSettled(db, correlationId, scenario.timeoutMs);

  if (!settled) {
    log("  Timed out waiting for conversations to settle");
  }

  log("  Collecting evidence...");
  const evidence = await collectEvidence(db, correlationId, startTime);
  log(
    `  Found: ${evidence.conversations.length} conversations, ${evidence.tasks.length} tasks, ${evidence.handoffs.length} handoffs, ${evidence.events.length} events`,
  );

  log("  Evaluating with LLM...");
  try {
    const evaluation = await evaluate(scenario, evidence);
    return {
      scenario,
      verdict: evaluation.verdict,
      reasoning: evaluation.reasoning,
      evidence,
      durationMs: Date.now() - startTime.getTime(),
    };
  } catch (err) {
    return {
      scenario,
      verdict: "error",
      reasoning: `LLM evaluation failed: ${err}`,
      evidence,
      durationMs: Date.now() - startTime.getTime(),
    };
  }
}
