/**
 * Create Tasks Node
 *
 * LangGraph node that creates Linear issues from gathered requirements.
 * Uses LLM structured output to generate task definitions, then creates them in Linear.
 *
 * Key design decisions:
 * - Structured output with Zod schema for reliable task generation
 * - Calls createIssue for each task (injects LinearClient via options)
 * - Stores created tasks in state.createdTasks
 * - Sets state.phase to 'complete' when done
 */

import { ChatAnthropic } from "@langchain/anthropic";
import type { LinearClient } from "@linear/sdk";
import { z } from "zod";
import type { ProductAgentState, ProductAgentStateUpdate, ProductAgentPhase, CreatedTask } from "../state.js";
import { createIssue, listLabels, type LabelInfo } from "../../../integrations/linear/issues.js";
import { CREATE_TASKS_PROMPT } from "../prompts.js";
import { createLogger } from "../../../logging/logger.js";

const logger = createLogger({ defaultContext: { module: "create-tasks" } });

/**
 * Schema for a single generated task
 */
const GeneratedTaskSchema = z.object({
  title: z.string().describe("Clear, actionable task title"),
  description: z.string().describe("Detailed description with acceptance criteria"),
  priority: z
    .enum(["urgent", "high", "medium", "low"])
    .describe("Task priority level"),
  labels: z
    .array(z.string())
    .describe("Relevant labels like 'feature', 'bug', 'frontend', 'backend'"),
});

export type GeneratedTask = z.infer<typeof GeneratedTaskSchema>;

/**
 * Schema for task list generation output
 */
export const TaskListSchema = z.object({
  tasks: z.array(GeneratedTaskSchema).describe("List of tasks to create"),
  projectContext: z
    .string()
    .describe("Summary context for the dev agent to understand the project"),
});

export type TaskList = z.infer<typeof TaskListSchema>;

/**
 * Options for the create tasks node
 */
export interface CreateTasksNodeOptions {
  /** LinearClient for creating issues (required) */
  linearClient: LinearClient;
  /** Team ID to create issues in (required) */
  teamId: string;
  /** LLM instance for task generation (default: Claude Sonnet) */
  llm?: ChatAnthropic;
  /** Model name if creating default LLM */
  model?: string;
}

/**
 * Map priority string to Linear priority number
 * Linear: 0=none, 1=urgent, 2=high, 3=medium, 4=low
 */
function mapPriorityToLinear(priority: GeneratedTask["priority"]): 0 | 1 | 2 | 3 | 4 {
  const mapping: Record<GeneratedTask["priority"], 0 | 1 | 2 | 3 | 4> = {
    urgent: 1,
    high: 2,
    medium: 3,
    low: 4,
  };
  return mapping[priority];
}

/**
 * Resolve label names to Linear label IDs.
 * Returns IDs for labels that exist, ignores unknown labels.
 */
async function resolveLabelIds(
  linearClient: LinearClient,
  teamId: string,
  labelNames: string[]
): Promise<string[]> {
  if (labelNames.length === 0) {
    return [];
  }

  try {
    const labels = await listLabels(linearClient, teamId);
    const labelMap = new Map<string, string>();

    // Build case-insensitive lookup map
    labels.forEach((label: LabelInfo) => {
      labelMap.set(label.name.toLowerCase(), label.id);
    });

    // Resolve names to IDs
    const resolvedIds: string[] = [];
    for (const name of labelNames) {
      const id = labelMap.get(name.toLowerCase());
      if (id) {
        resolvedIds.push(id);
      }
    }

    return resolvedIds;
  } catch {
    // If label lookup fails, continue without labels
    logger.warn("label_resolution_failed", {
      message: "Failed to resolve labels, continuing without them",
    });
    return [];
  }
}

/**
 * Create the create tasks node with injected dependencies.
 *
 * @param options - Node options with LinearClient and team ID
 * @returns Node function for LangGraph
 */
export function createTasksNode(options: CreateTasksNodeOptions) {
  const { linearClient, teamId } = options;

  return async (state: ProductAgentState): Promise<ProductAgentStateUpdate> => {
    const nodeLogger = logger.child({ node: "create-tasks" });

    nodeLogger.debug("create_tasks_start", {
      message: "Generating and creating tasks from requirements",
      context: {
        messageCount: state.messages.length,
        hasWhat: state.requirements.what !== null,
        hasWhy: state.requirements.why !== null,
        teamId,
      },
    });

    try {
      // Use provided LLM or create default
      const llm =
        options.llm ??
        new ChatAnthropic({ model: options.model ?? "claude-sonnet-4-20250514" });

      // Bind structured output schema
      const structuredLlm = llm.withStructuredOutput(TaskListSchema);

      // Build context from requirements
      const requirementsContext = buildRequirementsContext(state);

      // Generate task list
      const taskList = await structuredLlm.invoke([
        { role: "system", content: CREATE_TASKS_PROMPT },
        ...state.messages,
        { role: "user", content: requirementsContext },
      ]);

      nodeLogger.info("tasks_generated", {
        outcome: "success",
        message: `Generated ${taskList.tasks.length} task(s)`,
        context: {
          taskCount: taskList.tasks.length,
          projectContext: taskList.projectContext.slice(0, 100),
        },
      });

      // Create tasks in Linear
      const createdTasks: CreatedTask[] = [];

      for (const task of taskList.tasks) {
        try {
          // Resolve label names to IDs
          const labelIds = await resolveLabelIds(linearClient, teamId, task.labels);

          // Build issue params - handle exactOptionalPropertyTypes
          const issueParams: {
            teamId: string;
            title: string;
            description: string;
            priority: 0 | 1 | 2 | 3 | 4;
            labelIds?: string[];
          } = {
            teamId,
            title: task.title,
            description: buildTaskDescription(task, taskList.projectContext),
            priority: mapPriorityToLinear(task.priority),
          };

          // Only add labelIds if we have some (exactOptionalPropertyTypes)
          if (labelIds.length > 0) {
            issueParams.labelIds = labelIds;
          }

          // Create the issue
          const result = await createIssue(linearClient, issueParams);

          createdTasks.push({
            id: result.id,
            identifier: result.identifier,
            title: result.title,
          });

          nodeLogger.info("task_created", {
            outcome: "success",
            message: `Created task ${result.identifier}: ${result.title}`,
            context: {
              issueId: result.id,
              identifier: result.identifier,
            },
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error creating task";

          nodeLogger.error("task_creation_failed", {
            outcome: "failure",
            message: `Failed to create task: ${task.title}`,
            context: { error: errorMessage },
          });
          // Continue with other tasks
        }
      }

      nodeLogger.info("create_tasks_complete", {
        outcome: "success",
        message: `Created ${createdTasks.length} of ${taskList.tasks.length} task(s)`,
        context: {
          created: createdTasks.length,
          total: taskList.tasks.length,
        },
      });

      return {
        createdTasks,
        phase: "complete" as ProductAgentPhase,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error during task creation";

      nodeLogger.error("create_tasks_error", {
        outcome: "failure",
        message: errorMessage,
      });

      // On error, stay in creating phase (can retry)
      return {
        phase: "creating" as ProductAgentPhase,
      };
    }
  };
}

/**
 * Build context for the task creation prompt based on requirements.
 */
function buildRequirementsContext(state: ProductAgentState): string {
  const parts: string[] = ["Based on the conversation, create tasks for the following:"];

  if (state.requirements.what) {
    parts.push(`## What to Build`);
    parts.push(state.requirements.what);
    parts.push("");
  }

  if (state.requirements.why) {
    parts.push(`## Why It's Needed`);
    parts.push(state.requirements.why);
    parts.push("");
  }

  if (state.requirements.who) {
    parts.push(`## Target Users`);
    parts.push(state.requirements.who);
    parts.push("");
  }

  if (state.requirements.acceptanceCriteria.length > 0) {
    parts.push(`## Acceptance Criteria`);
    state.requirements.acceptanceCriteria.forEach((ac) => {
      parts.push(`- ${ac}`);
    });
    parts.push("");
  }

  if (state.requirements.constraints.length > 0) {
    parts.push(`## Constraints`);
    state.requirements.constraints.forEach((c) => {
      parts.push(`- ${c}`);
    });
    parts.push("");
  }

  parts.push("Create well-structured tasks that a developer can implement independently.");

  return parts.join("\n");
}

/**
 * Build the full task description for Linear.
 */
function buildTaskDescription(task: GeneratedTask, projectContext: string): string {
  const parts: string[] = [];

  parts.push(task.description);
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push("**Project Context:**");
  parts.push(projectContext);

  return parts.join("\n");
}
