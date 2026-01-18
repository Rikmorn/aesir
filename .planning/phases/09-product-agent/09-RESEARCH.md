# Phase 9: Product Agent - Research

**Researched:** 2026-01-18
**Domain:** Conversational requirements gathering agent with Slack + LangGraph + Linear
**Confidence:** HIGH

<research_summary>
## Summary

Researched the ecosystem for building a conversational Product Agent that lives in Slack, gathers requirements through natural dialogue, and creates structured Linear tasks. The standard approach combines Slack's Bolt SDK with LangGraph for conversation state management, using the interrupt pattern for guided requirement gathering.

Key finding: The critical architecture decision is whether to build as a Slack AI Assistant (using Slack's new Agents & AI Apps features) vs a traditional bot (using app_mention events). The AI Assistant approach provides better UX (dedicated panel, suggested prompts, thread context management) but requires enabling specific Slack platform features. For this use case, the AI Assistant approach is recommended as it aligns with the "conversational thinking partner" vision.

For multi-agent orchestration with the Dev Agent, LangGraph Swarm provides clean handoff patterns with context preservation. The Product Agent should be designed as a LangGraph node that can hand off to Dev Agent orchestration via Temporal.

**Primary recommendation:** Use Slack Bolt JS with AI Assistant features for the Slack interface, LangGraph for conversation state/requirement gathering logic, and structured output for Linear task creation. Design handoff to existing Temporal-based Dev Agent workflow.
</research_summary>

<standard_stack>
## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @slack/bolt | 4.x | Slack app framework | Official SDK with AI Assistant support |
| @langchain/langgraph | 0.2.x | Conversation state machine | Already in codebase, handles complex flows |
| @langchain/core | 0.3.x | LLM abstraction + structured output | Already in codebase |
| @linear/sdk | 70.x | Linear task creation | Already in codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @slack/socket-mode | 2.x | WebSocket connection to Slack | Development/testing (not production) |
| langgraph-checkpoint-sqlite | 0.1.x | Conversation persistence | Already in codebase for checkpointing |
| zod | 3.25.x | Task schema validation | Already in codebase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bolt JS AI Assistant | Traditional app_mention bot | AI Assistant has better UX but requires platform feature enablement |
| LangGraph interrupt | Plain conversation loops | Interrupt provides cleaner human-in-the-loop but adds complexity |
| Socket Mode | HTTP webhooks | Socket simpler for dev but HTTP required for production scale |

**Installation:**
```bash
npm install @slack/bolt @slack/socket-mode
# Existing dependencies already include LangGraph, Linear SDK
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── integrations/slack/
│   ├── bolt-app.ts          # Slack Bolt app initialization
│   ├── assistant/           # AI Assistant handlers
│   │   ├── thread-started.ts
│   │   ├── user-message.ts
│   │   └── context-store.ts
│   └── index.ts
├── agents/
│   ├── product-agent/
│   │   ├── conversation-graph.ts  # LangGraph for requirement gathering
│   │   ├── state.ts               # Conversation state schema
│   │   ├── nodes/
│   │   │   ├── gather-context.ts
│   │   │   ├── clarify-requirements.ts
│   │   │   ├── create-tasks.ts
│   │   │   └── confirm-handoff.ts
│   │   └── index.ts
│   └── index.ts
└── temporal/
    └── activities/
        └── product-agent-activities.ts  # Temporal activities for task creation
```

### Pattern 1: Slack AI Assistant with LangGraph Backend
**What:** Slack's Assistant class handles the Slack-specific concerns (thread context, suggested prompts, status updates) while LangGraph manages the conversation logic.
**When to use:** Conversational agents that need guided multi-turn interactions.
**Example:**
```typescript
// Source: Slack Bolt JS docs + LangGraph patterns
import { App, Assistant } from '@slack/bolt';
import { StateGraph } from '@langchain/langgraph';

const assistant = new Assistant({
  threadStarted: async ({ say, setSuggestedPrompts, saveThreadContext }) => {
    await say("Hi! I'm here to help you turn ideas into Linear tasks. What would you like to build?");
    await setSuggestedPrompts({
      prompts: [
        { title: "New feature", message: "I want to add a new feature..." },
        { title: "Bug fix", message: "There's a bug that..." },
        { title: "Improvement", message: "I want to improve..." }
      ]
    });
    await saveThreadContext();
  },
  userMessage: async ({ message, say, setStatus, client }) => {
    await setStatus({ status: 'is gathering requirements...' });

    // Get thread history for LangGraph context
    const history = await client.conversations.replies({
      channel: message.channel,
      ts: message.thread_ts || message.ts
    });

    // Process through LangGraph conversation graph
    const result = await productAgentGraph.invoke({
      messages: history.messages,
      currentMessage: message.text
    });

    await say(result.response);
  }
});

app.assistant(assistant);
```

### Pattern 2: Interrupt-Based Requirement Gathering
**What:** LangGraph's interrupt pattern to pause for clarification, confirmation, or decisions.
**When to use:** When requirements need human confirmation before proceeding.
**Example:**
```typescript
// Source: LangGraph how-to docs
import { interrupt, Command } from '@langchain/langgraph';

async function gatherRequirementsNode(state: ConversationState) {
  // Analyze current requirements completeness
  const analysis = await analyzeRequirements(state.requirements);

  if (!analysis.complete) {
    // Pause to ask clarifying question
    const userInput = interrupt({
      question: analysis.nextQuestion,
      reason: 'Need clarification on: ' + analysis.missingField
    });

    return {
      ...state,
      messages: [...state.messages, { role: 'user', content: userInput }]
    };
  }

  // Requirements complete, proceed to task creation
  return new Command({
    goto: 'createTasks',
    update: { requirementsComplete: true }
  });
}
```

### Pattern 3: Structured Output for Linear Task Creation
**What:** Use LLM structured output to generate properly formatted Linear tasks.
**When to use:** Converting conversation into actionable tasks.
**Example:**
```typescript
// Source: LangChain structured output docs
import { z } from 'zod';

const LinearTaskSchema = z.object({
  title: z.string().describe("Clear, actionable task title"),
  description: z.string().describe("Detailed description with acceptance criteria"),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  labels: z.array(z.string()).describe("Relevant labels like 'feature', 'bug', 'tech-debt'"),
  estimate: z.number().optional().describe("Story points estimate"),
});

const TaskListSchema = z.object({
  tasks: z.array(LinearTaskSchema),
  projectContext: z.string().describe("Context for the Dev Agent"),
});

const createTasksLLM = llm.withStructuredOutput(TaskListSchema);

async function createTasksNode(state: ConversationState) {
  const tasks = await createTasksLLM.invoke([
    { role: 'system', content: TASK_CREATION_PROMPT },
    ...state.messages
  ]);

  // Create tasks in Linear
  for (const task of tasks.tasks) {
    await linearClient.createIssue({
      teamId: state.teamId,
      title: task.title,
      description: task.description,
      priority: mapPriority(task.priority),
      labelIds: await resolveLabelIds(task.labels),
    });
  }

  return { ...state, createdTasks: tasks.tasks };
}
```

### Anti-Patterns to Avoid
- **Stateless conversation handling:** Each message MUST have access to full conversation history. Don't lose context between turns.
- **Monolithic conversation flow:** Break into discrete nodes (gather, clarify, confirm, create) for testability and debugging.
- **Direct Slack WebClient in conversation logic:** Separate Slack concerns (Assistant handlers) from business logic (LangGraph nodes).
- **Missing confirmation before task creation:** Always confirm with user before creating tasks in Linear - this is irreversible.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Slack thread context | Custom context tracking | Bolt's `threadContextStore` | Built-in, handles edge cases like thread-started vs message events |
| Conversation state persistence | In-memory or custom DB | LangGraph checkpointer | Already integrated, handles interrupts/resume correctly |
| Multi-turn message history | Manual array management | LangGraph's `add_messages` reducer | Handles deduplication, update-by-ID, proper ordering |
| Requirement completeness check | Manual field checking | LLM structured analysis | LLM understands semantic completeness better than rules |
| Task decomposition | Rule-based splitting | LLM with structured output | Handles natural language nuance, produces better task boundaries |
| Status indicators | Custom typing simulation | Bolt's `setStatus` API | Native Slack UI, clears automatically |

**Key insight:** The combination of Slack Bolt's AI Assistant features and LangGraph's conversation patterns handles 90% of the infrastructure. Focus effort on the requirement gathering prompts and task quality—that's where the value is.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Context Loss Across Messages
**What goes wrong:** Bot responds without understanding previous conversation, asking same questions repeatedly.
**Why it happens:** Not retrieving thread history before processing each message, or not using checkpointer.
**How to avoid:** Always call `conversations.replies` with thread_ts, pass full history to LangGraph, use SqliteSaver checkpointer.
**Warning signs:** User says "I already told you that" or repeats information.

### Pitfall 2: Socket Mode in Production
**What goes wrong:** Slack connection drops, messages missed, scaling issues.
**Why it happens:** Socket Mode is designed for development, not production workloads.
**How to avoid:** Use HTTP Request URLs for production deployment. Socket Mode only for local dev.
**Warning signs:** Intermittent message failures, connection timeout errors.

### Pitfall 3: Task Creation Without Confirmation
**What goes wrong:** User gets surprised by tasks they didn't want, has to clean up Linear.
**Why it happens:** Optimizing for speed over accuracy, not implementing confirmation step.
**How to avoid:** Always show preview of tasks before creating. Implement explicit "yes, create these" confirmation.
**Warning signs:** Users deleting/modifying tasks immediately after creation.

### Pitfall 4: Overly Rigid Requirement Templates
**What goes wrong:** Conversation feels like filling out a form, not natural dialogue.
**Why it happens:** Trying to extract specific fields in specific order.
**How to avoid:** Let LLM analyze what's been captured naturally, only ask about gaps. Don't enforce order.
**Warning signs:** Users say "just let me explain" or skip suggested prompts.

### Pitfall 5: Vague Task Descriptions
**What goes wrong:** Dev Agent struggles to implement tasks, asks for clarification, or builds wrong thing.
**Why it happens:** Not prompting LLM to include acceptance criteria, not validating task quality.
**How to avoid:** System prompt must require acceptance criteria. Validate tasks have clear "done" definition.
**Warning signs:** Dev Agent failing on tasks, multiple iterations, tasks stuck in review.

### Pitfall 6: Missing Handoff Context
**What goes wrong:** Dev Agent picks up task but lacks context about why/how decisions were made.
**Why it happens:** Only storing task title/description, not conversation insights.
**How to avoid:** Store conversation summary in Linear task description or comments. Include relevant context.
**Warning signs:** Dev Agent making wrong assumptions about implementation approach.
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### Slack Bolt AI Assistant Setup
```typescript
// Source: Slack Bolt JS docs - AI Assistant tutorial
import { App, Assistant } from '@slack/bolt';
import { SocketModeClient } from '@slack/socket-mode';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true, // Use HTTP for production
});

const assistant = new Assistant({
  threadStarted: async ({ say, setSuggestedPrompts, saveThreadContext, context }) => {
    const { channelId } = context;

    // Contextual greeting based on where assistant was opened
    if (channelId) {
      await say("I can help turn this conversation into actionable tasks. What's on your mind?");
    } else {
      await say("What would you like to build today?");
    }

    await setSuggestedPrompts({
      prompts: [
        { title: "New feature", message: "I want to build a feature that..." },
        { title: "Improvement", message: "I want to improve..." },
      ]
    });
  },

  userMessage: async ({ message, say, setStatus, getThreadContext, client }) => {
    const threadContext = await getThreadContext();

    await setStatus({ status: 'is thinking...' });

    // Get conversation history
    const replies = await client.conversations.replies({
      channel: message.channel,
      ts: message.thread_ts ?? message.ts,
    });

    // Process with your LLM/LangGraph here
    const response = await processWithAgent(replies.messages, threadContext);

    await say(response);
  }
});

app.assistant(assistant);
```

### LangGraph Conversation State Schema
```typescript
// Source: LangGraph TypeScript patterns
import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

const ProductAgentState = Annotation.Root({
  // Conversation messages
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // Gathered requirements
  requirements: Annotation<{
    what: string | null;
    why: string | null;
    who: string | null;
    acceptanceCriteria: string[];
    constraints: string[];
  }>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({
      what: null,
      why: null,
      who: null,
      acceptanceCriteria: [],
      constraints: [],
    }),
  }),

  // Workflow state
  phase: Annotation<'gathering' | 'clarifying' | 'confirming' | 'creating' | 'complete'>({
    reducer: (_, next) => next,
    default: () => 'gathering',
  }),

  // Created tasks
  createdTasks: Annotation<Array<{ id: string; title: string }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // Slack context
  slackContext: Annotation<{
    channelId: string;
    threadTs: string;
    userId: string;
  }>(),
});
```

### Requirement Completeness Analysis
```typescript
// Source: LangChain structured output patterns
import { z } from 'zod';

const RequirementAnalysisSchema = z.object({
  isComplete: z.boolean().describe("Are requirements sufficient to create tasks?"),
  missingElements: z.array(z.string()).describe("What information is still needed"),
  nextQuestion: z.string().optional().describe("Best next question to ask"),
  confidence: z.enum(['high', 'medium', 'low']).describe("Confidence in understanding"),
  summary: z.string().describe("Summary of what we understand so far"),
});

const analyzeRequirementsLLM = llm.withStructuredOutput(RequirementAnalysisSchema);

async function analyzeRequirements(state: typeof ProductAgentState.State) {
  return await analyzeRequirementsLLM.invoke([
    {
      role: 'system',
      content: `Analyze the conversation to determine if we have enough information to create Linear tasks.

Requirements need:
- Clear description of WHAT to build
- Understanding of WHY it's needed
- Acceptance criteria (how to know it's done)
- Any constraints or technical considerations

If missing critical info, suggest ONE focused follow-up question.`
    },
    ...state.messages
  ]);
}
```

### Handoff to Dev Agent via Temporal
```typescript
// Source: Existing Aesir Temporal patterns
import { WorkflowClient } from '@temporalio/client';

async function handoffToDevAgent(
  taskId: string,
  context: { summary: string; decisions: string[] }
) {
  const client = await getTemporalClient();

  // Start the existing dev agent workflow for this task
  await client.workflow.start('devAgentWorkflow', {
    taskQueue: 'dev-agent',
    workflowId: `dev-agent-${taskId}`,
    args: [{
      taskId,
      context: context.summary,
      decisions: context.decisions,
    }],
  });

  return { workflowId: `dev-agent-${taskId}`, taskId };
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| app_mention event handlers | Slack AI Assistant class | 2024 | Better UX with dedicated panel, suggested prompts, status |
| Manual thread context tracking | `threadContextStore` in Bolt | 2024 | Built-in context persistence across messages |
| Simple conversation loops | LangGraph interrupt pattern | 2025 | Cleaner human-in-the-loop, better state management |
| Hardcoded prompts | Dynamic suggested prompts | 2024 | Context-aware prompt suggestions per channel/user |
| Full message history always | LangGraph message reducers | 2025 | Smarter deduplication, update-by-ID support |

**New tools/patterns to consider:**
- **Slack's chatStream API:** Real-time streaming responses to Slack (like ChatGPT's typing effect). Improves perceived responsiveness for long-running LLM calls.
- **LangGraph Swarm:** For future multi-agent expansion (research agent, planning agent, etc.). Clean handoff patterns already established.
- **Feedback buttons in Slack:** Built-in thumbs up/down with `reaction_added` events. Valuable for improving prompts over time.

**Deprecated/outdated:**
- **RTM API for bots:** Replaced by Socket Mode and Events API. Don't use RTM.
- **Interactive message attachments:** Use Block Kit instead for all interactive elements.
- **Manual OAuth flows for Slack:** Slack's CLI handles this now for development. Only implement OAuth for distribution.
</sota_updates>

<open_questions>
## Open Questions

Things that need resolution during planning:

1. **AI Assistant vs Traditional Bot?**
   - What we know: AI Assistant provides better UX but requires enabling Slack platform feature
   - What's unclear: Whether the workspace has this feature enabled, setup requirements
   - Recommendation: Design for AI Assistant, fall back to app_mention if needed

2. **Task Assignee Handling?**
   - What we know: Linear tasks can have assignees, Dev Agent picks up assigned tasks
   - What's unclear: Should Product Agent auto-assign to a "dev-agent" user, or leave unassigned?
   - Recommendation: Create tasks unassigned, let separate workflow/human assign based on capacity

3. **Multi-Task vs Single-Task Flow?**
   - What we know: One conversation might produce multiple tasks
   - What's unclear: Should each task trigger Dev Agent immediately, or batch for review?
   - Recommendation: Create all tasks, let existing Dev Agent triggers handle pickup

4. **Conversation Persistence Scope?**
   - What we know: LangGraph checkpointer persists state, Slack threads persist messages
   - What's unclear: How long to retain conversation state? What happens on thread reopen?
   - Recommendation: Keep state as long as Slack thread exists. Resume conversation on any thread message.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [LangGraph Multi-Turn Conversation Guide](https://langchain-ai.github.io/langgraph/how-tos/multi-agent-multi-turn-convo-functional/) - interrupt pattern, user input collection
- [Slack Bolt JS AI Assistant Tutorial](https://docs.slack.dev/tools/bolt-js/tutorials/ai-assistant/) - Assistant class, thread context, suggested prompts
- [Slack AI Apps Best Practices](https://docs.slack.dev/ai/ai-apps-best-practices/) - status updates, prompts, feedback collection
- [LangGraph Swarm GitHub](https://github.com/langchain-ai/langgraph-swarm-py) - handoff patterns, context preservation

### Secondary (MEDIUM confidence)
- [Towards Data Science: Agent Handoffs](https://towardsdatascience.com/how-agent-handoffs-work-in-multi-agent-systems/) - handoff mechanics, verified against LangGraph docs
- [LangGraph Checkpointing Best Practices](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025) - persistence patterns, verified against official docs
- [Slack bolt-python-ai-chatbot sample](https://github.com/slack-samples/bolt-python-ai-chatbot) - conversation patterns, multi-provider architecture

### Tertiary (LOW confidence - needs validation)
- Thread context storage for long-running conversations - implementation details vary by use case, test during development
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Slack Bolt JS + LangGraph conversation agents
- Ecosystem: Slack AI Assistant features, Linear SDK, existing Temporal infrastructure
- Patterns: Guided conversation, requirement gathering, structured task output, agent handoff
- Pitfalls: Context loss, production deployment, task quality, handoff state

**Confidence breakdown:**
- Standard stack: HIGH - Using existing dependencies + official Slack SDK
- Architecture: HIGH - Based on official patterns from LangGraph and Slack docs
- Pitfalls: MEDIUM - Based on general patterns, some specific to this use case
- Code examples: HIGH - From official documentation and existing codebase patterns

**Research date:** 2026-01-18
**Valid until:** 2026-02-18 (30 days - Slack AI features stable, LangGraph patterns established)
</metadata>

---

*Phase: 09-product-agent*
*Research completed: 2026-01-18*
*Ready for planning: yes*
