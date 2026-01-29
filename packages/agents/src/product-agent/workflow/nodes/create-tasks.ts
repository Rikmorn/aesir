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

import {
  createPinoLogger,
  generateCorrelationId,
  type PinoLogger,
} from "@aesir/platform";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { callMcpTool } from "../../../shared/mcp/index.js";
import { CREATE_TASKS_PROMPT } from "../prompts.js";
import type {
  CreatedTask,
  ProductAgentPhase,
  ProductAgentState,
  ProductAgentStateUpdate,
  SlackContext,
} from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:product-agent:create-tasks",
});

const AGENT_ID = "product-agent";

/**
 * Schema for a single generated task
 */
const GENERATED_TASK_SCHEMA = z.object({
  title: z.string().describe("Clear, actionable task title"),
  description: z
    .string()
    .describe("Detailed description with acceptance criteria"),
  priority: z
    .enum(["urgent", "high", "medium", "low"])
    .describe("Task priority level"),
  labels: z
    .array(z.string())
    .describe("Relevant labels like 'feature', 'bug', 'frontend', 'backend'"),
});

export type GeneratedTask = z.infer<typeof GENERATED_TASK_SCHEMA>;

/**
 * Schema for task list generation output
 */
export const TaskListSchema = z.object({
  tasks: z.array(GENERATED_TASK_SCHEMA).describe("List of tasks to create"),
  projectContext: z
    .string()
    .describe("Summary context for the dev agent to understand the project"),
});

export type TaskList = z.infer<typeof TaskListSchema>;

/**
 * Options for the create tasks node
 */
export interface CreateTasksNodeOptions {
  /** Team ID to create issues in (required) */
  teamId: string;
  /** LLM instance for task generation (default: Claude Sonnet) */
  llm?: ChatAnthropic;
  /** Model name if creating default LLM */
  model?: string;
  /** Correlation ID for tracking (optional, auto-generated if not provided) */
  correlationId?: string;
}

/**
 * Map priority string to Linear priority number
 * Linear: 0=none, 1=urgent, 2=high, 3=medium, 4=low
 */
function mapPriorityToLinear(
  priority: GeneratedTask["priority"],
): 0 | 1 | 2 | 3 | 4 {
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
 * Returns IDs for labels that exist, logs warnings for missing labels.
 */
async function resolveLabelIds(
  teamId: string,
  labelNames: string[],
  correlationId: string,
): Promise<string[]> {
  if (labelNames.length === 0) {
    return [];
  }

  try {
    const labels = await callMcpTool<Array<{ id: string; name: string }>>({
      integration: "linear",
      tool: "list_labels",
      params: { teamId },
      agentId: AGENT_ID,
      correlationId,
    });

    const labelMap = new Map<string, string>();

    // Build case-insensitive lookup map
    for (const label of labels) {
      labelMap.set(label.name.toLowerCase(), label.id);
    }

    // Resolve names to IDs, track missing labels
    const resolvedIds: string[] = [];
    const missingLabels: string[] = [];
    for (const name of labelNames) {
      const id = labelMap.get(name.toLowerCase());
      if (id) {
        resolvedIds.push(id);
      } else {
        missingLabels.push(name);
      }
    }

    // Log warnings for missing labels
    if (missingLabels.length > 0) {
      logger.warn(
        { missingLabels, teamId, correlationId },
        `Labels not found in Linear: ${missingLabels.join(", ")}`,
      );
    }

    return resolvedIds;
  } catch {
    // If label lookup fails, continue without labels
    logger.warn({}, "Failed to resolve labels, continuing without them");
    return [];
  }
}

/**
 * Build Slack thread URL from context.
 * Returns a markdown-friendly reference to the Slack thread.
 */
function buildSlackThreadUrl(slackContext: SlackContext): string {
  // Format: slack://channel?id={channelId}&message={threadTs}
  // We use the Slack deep link format for channel/thread
  const threadTsFormatted = slackContext.threadTs?.replace(".", "") || "";
  return `https://slack.com/app_redirect?channel=${slackContext.channelId}&message_ts=${threadTsFormatted}`;
}

/**
 * Create the create tasks node with injected dependencies.
 *
 * @param options - Node options with team ID
 * @returns Node function for LangGraph
 */
export function createTasksNode(options: CreateTasksNodeOptions) {
  const { teamId } = options;

  return async (state: ProductAgentState): Promise<ProductAgentStateUpdate> => {
    const nodeLogger = logger.child({ node: "create-tasks" });

    // Generate correlation ID if not provided
    const correlationId =
      options.correlationId || generateCorrelationId("agent");

    nodeLogger.debug(
      {
        messageCount: state.messages.length,
        hasWhat: state.requirements.what !== null,
        hasWhy: state.requirements.why !== null,
        teamId,
        correlationId,
      },
      "Generating and creating tasks from requirements",
    );

    try {
      // Use provided LLM or create default
      const llm =
        options.llm ??
        new ChatAnthropic({
          model: options.model ?? "claude-sonnet-4-20250514",
        });

      // Bind structured output schema (explicit type breaks infinite inference)
      const structuredLlm = llm.withStructuredOutput<TaskList>(TaskListSchema);

      // Build context from requirements
      const requirementsContext = buildRequirementsContext(state);

      // Generate task list
      const taskList = await structuredLlm.invoke([
        { role: "system", content: CREATE_TASKS_PROMPT },
        ...state.messages,
        { role: "user", content: requirementsContext },
      ]);

      nodeLogger.info(
        {
          taskCount: taskList.tasks.length,
          projectContext: taskList.projectContext.slice(0, 100),
        },
        `Generated ${taskList.tasks.length} task(s)`,
      );

      // Create tasks in Linear
      const createdTasks: CreatedTask[] = [];

      for (const task of taskList.tasks) {
        try {
          // Always add agent-ready label for dev-agent routing
          const allLabels = [...task.labels, "agent-ready"];
          nodeLogger.debug(
            { taskTitle: task.title, labels: allLabels },
            "Adding agent-ready label to task",
          );

          // Resolve label names to IDs
          const labelIds = await resolveLabelIds(
            teamId,
            allLabels,
            correlationId,
          );

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
            description: buildTaskDescription(
              task,
              taskList.projectContext,
              state.slackContext,
            ),
            priority: mapPriorityToLinear(task.priority),
          };

          // Only add labelIds if we have some (exactOptionalPropertyTypes)
          if (labelIds.length > 0) {
            issueParams.labelIds = labelIds;
          }

          // Create the issue via MCP
          const result = await callMcpTool<{
            id: string;
            identifier: string;
            title: string;
          }>({
            integration: "linear",
            tool: "create_issue",
            params: issueParams,
            agentId: AGENT_ID,
            correlationId,
          });

          createdTasks.push({
            id: result.id,
            identifier: result.identifier,
            title: result.title,
          });

          nodeLogger.info(
            {
              issueId: result.id,
              identifier: result.identifier,
              correlationId,
            },
            `Created task ${result.identifier}: ${result.title}`,
          );
        } catch (error) {
          nodeLogger.error(
            { err: error, taskTitle: task.title, correlationId },
            `Failed to create task: ${task.title}`,
          );
          // Continue with other tasks
        }
      }

      nodeLogger.info(
        { created: createdTasks.length, total: taskList.tasks.length },
        `Created ${createdTasks.length} of ${taskList.tasks.length} task(s)`,
      );

      return {
        createdTasks,
        phase: "complete" as ProductAgentPhase,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during task creation";

      nodeLogger.error({ err: error }, errorMessage);

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
  const parts: string[] = [
    "Based on the conversation, create tasks for the following:",
  ];

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

  parts.push(
    "Create well-structured tasks that a developer can implement independently.",
  );

  return parts.join("\n");
}

/**
 * Build the full task description for Linear.
 * Includes project context and optionally a Slack thread link.
 */
function buildTaskDescription(
  task: GeneratedTask,
  projectContext: string,
  slackContext: SlackContext | null,
): string {
  const parts: string[] = [];

  parts.push(task.description);
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push("**Project Context:**");
  parts.push(projectContext);

  // Add Slack conversation link if available
  if (slackContext?.channelId && slackContext.threadTs) {
    const slackUrl = buildSlackThreadUrl(slackContext);
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push(
      `**Context:** This issue was created from a [Slack conversation](${slackUrl})`,
    );
  }

  return parts.join("\n");
}
