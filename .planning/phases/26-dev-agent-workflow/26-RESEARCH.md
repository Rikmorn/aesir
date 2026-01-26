# Phase 26: Dev Agent Workflow - Research

**Researched:** 2026-01-26
**Domain:** Agent workflow orchestration (LangGraph + Temporal + Dev Container)
**Confidence:** HIGH

## Summary

Phase 26 implements the dev-agent workflow that receives Linear issues with "agent-ready" labels and produces mergeable PRs. The workflow operates inside persistent dev containers, performing research, planning, execution, and feedback handling.

The codebase already has substantial infrastructure in place:
- **DevContainerManager** (Phase 24): `spawn()`, `execute()`, `findByTaskId()` methods ready
- **DevContainerGit**: Git operations inside containers (clone, branch, credentials)
- **MCP Client**: `callMcpTool()` for all integration communication
- **Existing dev-workflow.ts**: Basic LangGraph graph with pickup_task, create_branch, generate_code, run_tests, fix_code, commit_pr nodes
- **Temporal patterns**: Signal-based approval workflow, activity wrapping for LangGraph

Key gaps to address:
1. **Research phase**: Need new nodes for codebase exploration via shell commands
2. **Planning phase**: Need ResearchContext -> ExecutionPlan transformation with confidence levels
3. **HITL approval**: Dual-channel (Linear comment + Slack) with signal-based waiting
4. **Event handling**: DEV-01/02 - receiving and filtering Linear issue events
5. **PR feedback loop**: DEV-19/20/21 - resume container for review feedback
6. **Slack update_message**: MCP-02 - new MCP tool needed

**Primary recommendation:** Extend existing dev-workflow.ts with research/planning nodes, wrap in Temporal workflow for HITL, and add event handler for Linear webhooks.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @langchain/langgraph | ^0.2.0 | Agent state machine | Already used for product-agent and existing dev-workflow |
| @temporalio/workflow | existing | Durable execution, signals | Already used for approval workflows, HITL |
| dockerode | existing | Container management | DevContainerManager already implemented |
| zod | existing | Schema validation | Project-wide pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @langchain/anthropic | ^0.3.0 | LLM for reasoning | Research/planning nodes |
| @langchain/langgraph-checkpoint-postgres | ^0.1.0 | State persistence | Multi-turn conversations |
| pino | existing | Structured logging | All operations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LangGraph | Pure Temporal activities | LangGraph provides better LLM tooling, structured output |
| Temporal signals | Polling | Signals are cleaner for HITL, already established |
| Shell execution | Direct file APIs | Shell matches "developer in container" model |

**Installation:**
No new dependencies required - all are already in `packages/agents/package.json`.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/dev-agent/
├── index.ts              # Barrel exports
├── main.ts               # HTTP server entry (port 3004)
├── api/
│   ├── routes.ts         # Express routes
│   └── events.ts         # Event handler for Linear webhooks
├── graph.ts              # LangGraph StateGraph definition
├── state.ts              # State annotation (extends DevWorkflowState)
├── prompts.ts            # LLM prompts for research/planning
├── nodes/
│   ├── index.ts          # Barrel export
│   ├── receive-issue.ts  # DEV-01/02: Filter and validate
│   ├── setup-container.ts # DEV-03/04: Spawn + clone
│   ├── research.ts       # DEV-05/06: Explore codebase
│   ├── plan.ts           # DEV-07: Create ExecutionPlan
│   ├── request-approval.ts # DEV-08: Dual-channel HITL
│   ├── execute.ts        # DEV-10/11/12: Write code, test, commit
│   ├── verify.ts         # DEV-13/14/15: Full test, lint, push
│   ├── create-pr.ts      # DEV-16/17/18: PR + status + notify
│   └── handle-feedback.ts # DEV-19/20/21: PR review feedback
└── runner.ts             # High-level workflow runner
```

### Pattern 1: Event-Driven Agent Startup
**What:** Agent receives normalized events via HTTP POST /events
**When to use:** All agent entry points from external webhooks
**Example:**
```typescript
// Source: packages/agents/src/product-agent/api/events.ts (existing pattern)
export function createDevAgentEventsHandler(deps: DevAgentEventsDeps) {
  return async (req: EventsRequest, res: EventsResponse): Promise<void> => {
    const event = NormalizedEventSchema.parse(JSON.parse(req.rawBody));

    // DEV-01: Only handle linear.issue events
    if (event.source !== "linear" || !event.type.startsWith("linear.issue")) {
      res.status(200).json({ ignored: true, reason: "Not a Linear issue event" });
      return;
    }

    // DEV-02: Filter for agent-ready label
    const payload = event.payload as LinearIssuePayload;
    const hasAgentReadyLabel = payload.labels?.some(l => l.name === "agent-ready");

    if (!hasAgentReadyLabel) {
      res.status(200).json({ ignored: true, reason: "No agent-ready label" });
      return;
    }

    // Start Temporal workflow
    await workflowClient.workflow.start("devAgentWorkflow", {
      taskQueue: "dev-agent",
      workflowId: `dev-agent-${payload.id}`,
      args: [{ taskId: payload.id, issueIdentifier: payload.identifier }],
    });
  };
}
```

### Pattern 2: Shell-Based Research in Container
**What:** LangGraph node executes shell commands to explore codebase
**When to use:** Research phase (DEV-05/06)
**Example:**
```typescript
// Source: Architecture from 2.1-rob-context.md
export function createResearchNode(deps: { manager: DevContainerManager }) {
  return async function researchNode(state: DevAgentState): Promise<Partial<DevAgentState>> {
    const { manager } = deps;
    const { taskId } = state;

    // Step 1: Find relevant files
    const grepResult = await manager.execute(taskId, {
      command: ["rg", "-l", state.searchTerms.join("|"), "src/"],
      workdir: "/workspace/repo",
      timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
    });

    // Step 2: Read key files
    const relevantFiles = grepResult.stdout.trim().split("\n").slice(0, 10);
    const fileContents: Record<string, string> = {};

    for (const file of relevantFiles) {
      const cat = await manager.execute(taskId, {
        command: ["cat", file],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
      });
      if (cat.exitCode === 0) {
        fileContents[file] = cat.stdout;
      }
    }

    // Step 3: LLM synthesizes research context
    const researchContext = await synthesizeResearchContext(state, fileContents);

    return { researchContext, status: "planning" };
  };
}
```

### Pattern 3: Dual-Channel Approval (HITL)
**What:** Post plan to Linear AND Slack, accept approval from either
**When to use:** Plan approval (DEV-08/09)
**Example:**
```typescript
// Source: Approval flow from 2.1-rob-context.md
export async function requestApprovalActivity(
  taskId: string,
  plan: ExecutionPlan,
  slackChannel: string,
): Promise<void> {
  // Post full plan to Linear as comment
  await callMcpTool({
    integration: "linear",
    tool: "create_comment",
    params: { issueId: taskId, body: formatPlanAsMarkdown(plan) },
    agentId: "dev-agent",
    correlationId: `plan-${taskId}`,
  });

  // Update Linear status
  await callMcpTool({
    integration: "linear",
    tool: "update_issue_status",
    params: { issueId: taskId, statusName: "Awaiting Approval" },
    agentId: "dev-agent",
    correlationId: `plan-${taskId}`,
  });

  // Send summary to Slack with buttons
  await callMcpTool({
    integration: "slack",
    tool: "send_approval_request",
    params: {
      channel: slackChannel,
      taskId,
      title: `Plan Ready: ${plan.title}`,
      summary: plan.summary,
      prUrl: "", // No PR yet
    },
    agentId: "dev-agent",
    correlationId: `plan-${taskId}`,
  });
}
```

### Pattern 4: Temporal Workflow with Signal Wait
**What:** Workflow waits for approval signal before continuing
**When to use:** Human-in-the-loop checkpoints (DEV-09)
**Example:**
```typescript
// Source: packages/platform/src/temporal/workflows/approval-workflow.ts
export async function devAgentWorkflow(input: DevAgentWorkflowInput): Promise<DevAgentWorkflowResult> {
  const state = {
    decision: null as ApprovalDecision | null,
    feedback: null as string | null,
  };

  // Setup signal handlers
  wf.setHandler(approvalSignal, (d: ApprovalDecision) => { state.decision = d; });
  wf.setHandler(prFeedbackSignal, (f: string) => { state.feedback = f; });

  // Run research and planning
  await runResearchActivity(input.taskId);
  await runPlanningActivity(input.taskId);
  await requestApprovalActivity(input.taskId, plan, input.slackChannel);

  // Wait for approval (timeout: 24h stop container, 72h reminder)
  const approved = await wf.condition(
    () => state.decision !== null,
    "24 hours",
  );

  if (!approved) {
    // Timeout - stop container, send reminder
    await stopContainerActivity(input.taskId);
    await sendReminderActivity(input.taskId, input.slackChannel);

    // Wait another 48h
    const lateApproval = await wf.condition(() => state.decision !== null, "48 hours");
    if (!lateApproval) {
      return { success: false, outcome: "timeout" };
    }

    // Resume container
    await resumeContainerActivity(input.taskId);
  }

  // Continue with execution...
}
```

### Pattern 5: Container-Based Code Execution
**What:** Write files and run tests via shell in container
**When to use:** Execution phase (DEV-10/11/12)
**Example:**
```typescript
// Source: Architecture from 2.1-rob-context.md
export async function executeFileChange(
  manager: DevContainerManager,
  taskId: string,
  change: FileChange,
): Promise<void> {
  const { path, content, operation } = change;

  if (operation === "create" || operation === "update") {
    // Write file via heredoc
    const result = await manager.execute(taskId, {
      command: ["sh", "-c", `cat > ${path} << 'AESIR_EOF'\n${content}\nAESIR_EOF`],
      workdir: "/workspace/repo",
      timeoutMs: DEV_CONTAINER_TIMEOUTS.default,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to write ${path}: ${result.stderr}`);
    }
  } else if (operation === "delete") {
    await manager.execute(taskId, {
      command: ["rm", "-f", path],
      workdir: "/workspace/repo",
    });
  }
}
```

### Anti-Patterns to Avoid
- **Direct SDK imports in agent**: Use MCP calls, not `@linear/sdk` directly
- **Blocking LangGraph for HITL**: Use Temporal for long waits, LangGraph for reasoning
- **Full test suite on every change**: Run affected tests only (DEV-11), full suite before push (DEV-13)
- **Single-channel approval**: Always post to both Linear (record) AND Slack (notification)
- **Unbounded retries**: 3 self-fix attempts (DEV context), then escalate

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Container management | Docker API wrapper | DevContainerManager | Already handles spawn, execute, cleanup |
| Git operations | exec("git ...") manually | DevContainerGit | Handles credentials, branch naming |
| Integration calls | HTTP fetch to APIs | callMcpTool | Retry logic, rate limiting, permissions |
| HITL waiting | Polling/timers | Temporal signals | Durable, survives restarts |
| LLM structured output | JSON parsing | withStructuredOutput | Type-safe, handles errors |
| State persistence | Custom DB | LangGraph checkpointer | Already configured with PostgreSQL |

**Key insight:** Phase 24 built DevContainerManager specifically for this workflow. Use it - don't reinvent container orchestration.

## Common Pitfalls

### Pitfall 1: Agent-Ready Label Timing
**What goes wrong:** Issue created without label, label added later - agent misses it
**Why it happens:** Webhook fires on issue.created, but label.added is separate event
**How to avoid:** Handle both `linear.issue.created` (check labels) AND `linear.issue.updated` (label added)
**Warning signs:** Issues with agent-ready label sitting unprocessed

### Pitfall 2: Container Not Found on Resume
**What goes wrong:** PR feedback arrives, workflow tries to resume, container gone
**Why it happens:** 24h timeout stopped container, but workflow didn't track this
**How to avoid:** Store container state in DB (DevContainerStore), check before resume, re-spawn if needed
**Warning signs:** "Container not found" errors in feedback handling

### Pitfall 3: Test Failures Loop Forever
**What goes wrong:** Agent keeps trying to fix tests that can't be fixed (env issue)
**Why it happens:** No limit on fix attempts, no detection of unfixable issues
**How to avoid:** 3 attempt limit (context decision), detect patterns like "ECONNREFUSED", escalate immediately
**Warning signs:** Same error message in consecutive fix attempts

### Pitfall 4: Approval Signal Race Condition
**What goes wrong:** User approves in Linear AND Slack simultaneously, workflow processes both
**Why it happens:** Two webhooks arrive, both try to signal workflow
**How to avoid:** Check if decision already made before processing signal, use Temporal's single-signal semantics
**Warning signs:** Duplicate execution logs, double status updates

### Pitfall 5: Lost Research Context
**What goes wrong:** Research finds relevant files, but planning doesn't use them
**Why it happens:** ResearchContext artifact not properly structured or passed
**How to avoid:** Strict schema for ResearchContext, include in state, verify in planning node
**Warning signs:** Plans that miss obvious patterns found during research

### Pitfall 6: Shell Injection in File Writes
**What goes wrong:** File content contains heredoc delimiter, write fails or corrupts
**Why it happens:** Using `cat > file << 'EOF'` with content containing "EOF"
**How to avoid:** Use unique delimiter (e.g., `AESIR_EOF_${randomId}`), escape content, or use base64 encoding
**Warning signs:** Files with truncated content, shell syntax errors

## Code Examples

Verified patterns from the existing codebase:

### Receiving Linear Issue Events
```typescript
// Source: Pattern from packages/agents/src/product-agent/api/events.ts
import { NormalizedEventSchema, type NormalizedEvent } from "@aesir/common";

interface LinearIssuePayload {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  labels?: Array<{ name: string }>;
}

export function createDevAgentEventsHandler(deps: {
  workflowClient: TemporalClient;
  slackChannel: string;
}) {
  return async (req: EventsRequest, res: EventsResponse): Promise<void> => {
    const event = NormalizedEventSchema.parse(JSON.parse(req.rawBody));

    if (event.source !== "linear") {
      return res.status(200).json({ ignored: true });
    }

    const payload = event.payload as LinearIssuePayload;
    const hasLabel = payload.labels?.some(l => l.name === "agent-ready");

    if (event.type === "linear.issue.created" && hasLabel) {
      await startWorkflow(deps.workflowClient, payload);
    } else if (event.type === "linear.issue.updated" && hasLabel) {
      // Check if this is a label-added event
      await startWorkflow(deps.workflowClient, payload);
    }

    res.status(200).json({ received: true });
  };
}
```

### DevAgentState Extension
```typescript
// Source: Extends packages/common/src/state/dev-workflow-state.ts
import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

// Research context artifact
export const ResearchContextSchema = z.object({
  relevantFiles: z.array(z.object({
    path: z.string(),
    purpose: z.string(),
    patterns: z.array(z.string()),
  })),
  existingPatterns: z.array(z.string()),
  dependencies: z.array(z.string()),
  risks: z.array(z.string()),
  unknowns: z.array(z.string()),
});

// Execution plan artifact
export const ExecutionPlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  confidenceReasoning: z.string(),
  steps: z.array(z.object({
    description: z.string(),
    files: z.array(z.string()),
    testStrategy: z.string(),
  })),
  estimatedChanges: z.string(),
  risks: z.array(z.string()),
});

export const DevAgentStateAnnotation = Annotation.Root({
  // Inherit from DevWorkflowState...
  taskId: Annotation<string>(),
  // Add research/planning state
  researchContext: Annotation<z.infer<typeof ResearchContextSchema> | null>({
    reducer: (_, incoming) => incoming,
    default: () => null,
  }),
  executionPlan: Annotation<z.infer<typeof ExecutionPlanSchema> | null>({
    reducer: (_, incoming) => incoming,
    default: () => null,
  }),
  approvalStatus: Annotation<"pending" | "approved" | "rejected" | "changes_requested">({
    reducer: (_, incoming) => incoming,
    default: () => "pending",
  }),
  prFeedback: Annotation<string | null>({
    reducer: (_, incoming) => incoming,
    default: () => null,
  }),
});
```

### Research Node with Shell Commands
```typescript
// Source: DevContainerManager from packages/platform/src/sandbox/dev-container.ts
export function createResearchNode(deps: {
  manager: DevContainerManager;
  llm: ChatAnthropic;
}) {
  return async function researchNode(
    state: DevAgentStateType,
  ): Promise<Partial<DevAgentStateType>> {
    const { manager, llm } = deps;
    const { taskId, taskDescription } = state;

    // Extract search terms from task
    const terms = extractSearchTerms(taskDescription);

    // Find relevant files
    const grepResult = await manager.execute(taskId, {
      command: ["rg", "-l", terms.join("|"), "src/", "--type", "ts"],
      workdir: "/workspace/repo",
      timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
    });

    // Read file contents
    const files = grepResult.stdout.trim().split("\n").filter(Boolean);
    const contents: Record<string, string> = {};

    for (const file of files.slice(0, 15)) {
      const cat = await manager.execute(taskId, {
        command: ["cat", file],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
      });
      contents[file] = cat.stdout;
    }

    // Get project structure
    const tree = await manager.execute(taskId, {
      command: ["tree", "src/", "-L", "3", "--noreport"],
      workdir: "/workspace/repo",
      timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
    });

    // LLM synthesizes research
    const structuredLlm = llm.withStructuredOutput(ResearchContextSchema);
    const researchContext = await structuredLlm.invoke(buildResearchPrompt({
      taskDescription,
      fileContents: contents,
      projectStructure: tree.stdout,
    }));

    return {
      researchContext,
      status: "planning",
    };
  };
}
```

### MCP-Based Slack Update Message (NEW - MCP-02)
```typescript
// Source: Pattern from packages/integrations/slack/src/mcp/tools/messages.ts
// NOTE: This tool needs to be ADDED to Slack integration

// In slack/src/mcp/schemas.ts:
export const UpdateMessageInputSchema = z.object({
  channel: z.string().min(1, "Channel is required"),
  ts: z.string().min(1, "Message timestamp is required"),
  text: z.string().optional(),
  blocks: z.array(z.unknown()).optional(),
});

// In slack/src/mcp/tools/messages.ts, add to switch:
case "update_message": {
  const validation = UpdateMessageInputSchema.safeParse(args);
  if (!validation.success) {
    return createErrorResult(context, `Invalid input: ${validation.error.message}`);
  }

  const { channel, ts, text, blocks } = validation.data;

  const result = await client.chat.update({
    channel,
    ts,
    text: text || "",
    blocks: blocks as (Block | KnownBlock)[],
  });

  return createToolResult(context, `Message updated in ${channel}`, {
    ts: result.ts,
    channel: result.channel,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| API-based file ops | Container shell execution | Phase 24 | Dev agent works like real developer |
| Single sandbox | Persistent named containers | Phase 24 | Feedback loop possible |
| Direct SDK imports | MCP layer | Phase 19 | Clean agent/integration boundary |
| Polling for approval | Temporal signals | Already present | Cleaner HITL |

**Deprecated/outdated:**
- `@aesir/integrations` direct imports for agents: Use `callMcpTool` instead
- Per-file API calls: Use shell commands in container

## Open Questions

Things that couldn't be fully resolved:

1. **Container timeout vs workflow timeout**
   - What we know: Container stops at 24h, reminder at 72h
   - What's unclear: Should workflow also timeout, or wait indefinitely?
   - Recommendation: Workflow waits up to 7 days (match approval-workflow pattern), container restarts on resume

2. **Affected tests detection (DEV-11)**
   - What we know: Decision says "run affected tests only"
   - What's unclear: How to determine which tests are affected by file changes
   - Recommendation: Use filename matching (change `foo.ts` -> run `foo.test.ts`), or use Jest's `--findRelatedTests`

3. **CI failure detection (context decision)**
   - What we know: Should detect unfixable issues (env, infra) and escalate immediately
   - What's unclear: Exact patterns to match
   - Recommendation: Match patterns like "ECONNREFUSED", "ENOENT", "Permission denied", "Docker", "OOM"

4. **Slack channel configuration**
   - What we know: Need to send updates to a channel
   - What's unclear: Where channel ID comes from (env var? per-issue? per-team?)
   - Recommendation: Use env var `DEV_AGENT_SLACK_CHANNEL` for V1, enhance later

## Sources

### Primary (HIGH confidence)
- `packages/platform/src/sandbox/dev-container.ts` - DevContainerManager implementation
- `packages/platform/src/sandbox/dev-container-git.ts` - Git operations
- `packages/agents/src/mcp/client.ts` - MCP client pattern
- `packages/platform/src/temporal/workflows/approval-workflow.ts` - HITL signal pattern
- `packages/agents/src/product-agent/api/events.ts` - Event handling pattern
- `packages/agents/src/dev-workflow.ts` - Existing dev workflow graph
- `packages/common/src/state/dev-workflow-state.ts` - Existing state schema
- `.planning/2.1-rob-context.md` - Architecture vision and flow diagrams

### Secondary (MEDIUM confidence)
- `packages/agents/src/product-agent/graph.ts` - LangGraph StateGraph patterns
- `packages/agents/src/temporal/workflows/product-agent-workflow.ts` - Temporal + LangGraph integration

### Tertiary (LOW confidence)
- None - all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing libraries already in package.json
- Architecture: HIGH - Following established patterns from Phase 24/25
- Pitfalls: HIGH - Based on actual codebase analysis and documented decisions
- MCP-02 (update_message): MEDIUM - Implementation pattern clear, but tool needs to be added

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (stable domain, all dependencies already present)
