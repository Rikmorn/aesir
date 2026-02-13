/**
 * Evidence Collector
 *
 * Queries the database to gather all artifacts produced during a test scenario.
 * Returns structured evidence for LLM evaluation.
 */

import { eq, like, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  agentEvents,
  conversations,
  taskHandoffs,
  tasks,
} from "../../src/shared/db/schema.js";
import type {
  ConversationEvidence,
  EventEvidence,
  HandoffEvidence,
  TaskEvidence,
  TestEvidence,
} from "./types.js";

export async function collectEvidence(
  db: PostgresJsDatabase,
  correlationId: string,
  startTime: Date,
): Promise<TestEvidence> {
  // Find all conversations related to this test run.
  // The primary conversation ID is `{agent}-{correlationId}`.
  // Delegated conversations are `{agent}-{taskId}` where the task was created during this test.
  const primaryConvs = await db
    .select()
    .from(conversations)
    .where(like(conversations.id, `%-${correlationId}`));

  // Collect task IDs from primary conversations
  const primaryTaskIds = primaryConvs
    .map((c) => c.task_id)
    .filter((id): id is string => id !== null);

  // Find delegated tasks (children of primary tasks)
  const allTasks: TaskEvidence[] = [];
  const taskIdsToProcess = [...primaryTaskIds];
  const processedTaskIds = new Set<string>();

  while (taskIdsToProcess.length > 0) {
    const currentId = taskIdsToProcess.pop();
    if (!currentId) continue;
    if (processedTaskIds.has(currentId)) continue;
    processedTaskIds.add(currentId);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, currentId));

    if (task) {
      allTasks.push({
        id: task.id,
        parentId: task.parent_id,
        creatorId: task.creator_id,
        assigneeId: task.assignee_id,
        status: task.status,
        title: task.title,
        depth: task.depth,
        completionResult: task.completion_result,
        createdAt: task.created_at,
        completedAt: task.completed_at,
      });

      // Find child tasks
      const children = await db
        .select()
        .from(tasks)
        .where(eq(tasks.parent_id, currentId));
      for (const child of children) {
        taskIdsToProcess.push(child.id);
      }
    }
  }

  // Find all conversations linked to discovered tasks
  const allTaskIds = allTasks.map((t) => t.id);
  let delegatedConvs: (typeof primaryConvs)[number][] = [];
  if (allTaskIds.length > 0) {
    delegatedConvs = await db
      .select()
      .from(conversations)
      .where(
        or(
          ...allTaskIds.map((id) => eq(conversations.task_id, id)),
          ...allTaskIds.map((id) => like(conversations.id, `%-${id}`)),
        ),
      );
  }

  // Merge and deduplicate conversations
  const allConvsMap = new Map<string, (typeof primaryConvs)[number]>();
  for (const c of [...primaryConvs, ...delegatedConvs]) {
    allConvsMap.set(c.id, c);
  }
  const allConvs = Array.from(allConvsMap.values());

  // Also find sub-agent conversations (parent_conversation_id)
  const convIds = allConvs.map((c) => c.id);
  if (convIds.length > 0) {
    const subAgentConvs = await db
      .select()
      .from(conversations)
      .where(
        or(
          ...convIds.map((id) => eq(conversations.parent_conversation_id, id)),
        ),
      );
    for (const c of subAgentConvs) {
      allConvsMap.set(c.id, c);
    }
  }
  const finalConvs = Array.from(allConvsMap.values());
  const finalConvIds = finalConvs.map((c) => c.id);

  // Collect handoffs for all tasks
  let allHandoffs: HandoffEvidence[] = [];
  if (allTaskIds.length > 0) {
    const handoffRows = await db
      .select()
      .from(taskHandoffs)
      .where(or(...allTaskIds.map((id) => eq(taskHandoffs.task_id, id))));
    allHandoffs = handoffRows.map((h) => ({
      id: h.id,
      taskId: h.task_id,
      conversationId: h.conversation_id,
      handoffType: h.handoff_type,
      context: h.context,
      authorId: h.author_id,
      createdAt: h.created_at,
    }));
  }

  // Collect events for all conversations
  let allEvents: EventEvidence[] = [];
  if (finalConvIds.length > 0) {
    const eventRows = await db
      .select()
      .from(agentEvents)
      .where(
        or(...finalConvIds.map((id) => eq(agentEvents.conversation_id, id))),
      )
      .orderBy(agentEvents.conversation_id, agentEvents.sequence);
    allEvents = eventRows.map((e) => ({
      conversationId: e.conversation_id,
      agentDefinitionId: e.agent_definition_id,
      sequence: e.sequence,
      type: e.type,
      payload: e.payload,
      timestamp: e.timestamp,
      durationMs: e.duration_ms,
    }));
  }

  const convEvidence: ConversationEvidence[] = finalConvs.map((c) => ({
    id: c.id,
    agentDefinitionId: c.agent_definition_id,
    status: c.status,
    taskId: c.task_id,
    parentConversationId: c.parent_conversation_id,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  return {
    conversations: convEvidence,
    tasks: allTasks,
    handoffs: allHandoffs,
    events: allEvents,
    durationMs: Date.now() - startTime.getTime(),
  };
}
