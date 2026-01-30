# Phase 32: Dev Agent Temporal Integration - Research

**Researched:** 2026-01-30
**Domain:** Temporal SDK workflow/activity patterns wrapping agentic tool-use loops
**Confidence:** HIGH

## Summary

Phase 32 wraps the orchestrator agentic loop (Phase 31) inside Temporal's durability envelope. Three new activities (`runOrchestratorPreApproval`, `runOrchestratorPostApproval`, `handleOrchestratorFeedback`) replace the legacy LangGraph-based activities. A simplified Temporal workflow replaces the existing 694-line `dev-agent-workflow.ts`.

The codebase already has all foundational pieces: `runAgentLoop()` (Phase 28), `runDevAgentOrchestrator()` (Phase 31), context snapshots (Phase 29), tools with `HUMAN_INPUT_MARKER` sentinel (Phase 30), and the existing Temporal signal/timeout patterns. This phase is primarily a wiring exercise -- connecting the orchestrator entry point to Temporal activities, parsing the `HUMAN_INPUT_MARKER` sentinel to pause workflows, and managing context snapshot handoff between activities.

The Temporal SDK version (`@temporalio/workflow` v1.14.1) supports all required patterns: `proxyActivities`, `wf.condition` with timeouts, signal handlers, query handlers, and `allHandlersFinished`. No new dependencies are needed.

**Primary recommendation:** Create new files alongside the existing ones (Phase 35 removes old files). Use the existing `dev-agent-workflow.ts` for signal/timeout pattern reference but build the new workflow from scratch. The three activities are thin wrappers around `runDevAgentOrchestrator()` with sentinel parsing and context snapshot write/read.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@temporalio/workflow` | ^1.14.1 | Workflow definition (signals, conditions, activity proxy) | Already in use, existing patterns |
| `@temporalio/worker` | ^1.14.1 | Worker registration (activities, workflow path) | Already in use |
| `@temporalio/client` | ^1.14.1 | Client for starting/signaling workflows | Already in use |
| `@anthropic-ai/sdk` | latest | LLM calls via `runAgentLoop()` | Phase 28 established |
| `drizzle-orm` | ^0.45.1 | Database access for context snapshots and task store | Phase 29 established |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aesir/platform` | workspace | `DevContainerManager`, `PinoLogger`, DB client | All activities need these |
| `@aesir/types` | workspace | `createId` for IDs, error types | Activity code |
| `vitest` | ^3.0.0 | Testing | Activity and workflow tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate activities | Single monolithic activity | Separate activities enable Temporal-level retry per phase and signal waits between phases; monolithic loses these benefits |
| Activity heartbeats | No heartbeats (current pattern) | Current activities don't heartbeat; agentic loops run 30+ min so heartbeats would enable cancellation. BUT heartbeats add complexity and the existing pattern works. Recommend: no heartbeats for v2.2, add in v2.3 if needed |
| `CancellationScope.withTimeout` | `wf.condition` timeouts | `wf.condition` is the established pattern in this codebase; no reason to change |

**Installation:** No new packages needed. All dependencies are already in `packages/agents/package.json`.

## Architecture Patterns

### Recommended File Structure
```
packages/agents/src/
├── dev-agent/
│   └── orchestrator/
│       ├── orchestrator.ts            # (Phase 31) runDevAgentOrchestrator
│       ├── orchestrator.test.ts       # (Phase 31) behavioral tests
│       └── system-prompts.ts          # (Phase 31) static prompts
├── shared/
│   ├── temporal/
│   │   ├── activities/
│   │   │   ├── dev-agent-activities.ts          # Legacy (Phase 35 removes)
│   │   │   ├── orchestrator-activities.ts       # NEW: 3 orchestrator activities
│   │   │   ├── orchestrator-activities.test.ts  # NEW: activity unit tests
│   │   │   └── infrastructure-activities.ts     # NEW: stopContainer, completeTask
│   │   │── workflows/
│   │   │   ├── dev-agent-workflow.ts             # Legacy (Phase 35 removes)
│   │   │   ├── orchestrator-workflow.ts          # NEW: simplified workflow
│   │   │   └── orchestrator-workflow.test.ts     # NEW: workflow unit tests
│   │   └── signals.ts                            # Existing signals (unchanged)
│   ├── db/
│   │   ├── context-manager.ts                    # Phase 29 (used by activities)
│   │   └── task-store.ts                         # Phase 29 (used by activities)
│   └── tools/
│       └── coordination/
│           └── request-human-input.ts            # Phase 30 (HUMAN_INPUT_MARKER)
```

### Pattern 1: Activity Wrapper Around Orchestrator
**What:** Each activity calls `runDevAgentOrchestrator()` then parses the result for the `HUMAN_INPUT_MARKER` sentinel and writes a context snapshot.
**When to use:** All three orchestrator activities follow this pattern.
**Example:**
```typescript
// Source: Codebase patterns from orchestrator.ts + context-manager.ts + request-human-input.ts
export async function runOrchestratorPreApproval(input: PreApprovalInput): Promise<PreApprovalOutput> {
  const deps = getDeps();
  const { taskId, issue, slackChannel, workflowId } = input;

  // Update task status
  await deps.taskStore.updateTask(taskId, { status: "researching" });

  // Run the orchestrator loop
  const result = await runDevAgentOrchestrator({
    issueId: issue.identifier,
    issueTitle: issue.title,
    containerManager: deps.containerManager,
    taskId,
    agentId: "dev-agent",
    correlationId: taskId,
    workflowId,
    db: deps.db,
    logger: deps.logger,
    maxIterations: 100,
  });

  // Parse for HUMAN_INPUT_MARKER in the output or trace
  const humanInputRequest = parseHumanInputMarker(result);

  // Write context snapshot for post-approval activity
  await deps.contextManager.writeSnapshot({
    taskId,
    workflowId,
    agentType: "dev-orchestrator",
    stage: "post-research-plan",
    summary: result.output,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  });

  return {
    status: result.status,
    plan: result.output,
    humanInputRequest,
    toolCallCount: result.toolCallCount,
    tokenCount: result.tokenCount,
  };
}
```

### Pattern 2: HUMAN_INPUT_MARKER Sentinel Parsing
**What:** The `request_human_input` tool returns a sentinel JSON in its `ToolResult.content`. The activity wrapper scans the agent loop trace for this sentinel to determine if the workflow should pause for human input.
**When to use:** Pre-approval and feedback activities parse this to signal the workflow to wait.
**Example:**
```typescript
// Source: request-human-input.ts HUMAN_INPUT_MARKER constant
import { HUMAN_INPUT_MARKER } from "../../tools/coordination/request-human-input.js";

interface HumanInputRequest {
  channel: string;
  message: string;
  requestType: "approval" | "clarification" | "escalation";
}

function parseHumanInputMarker(result: AgentLoopResult): HumanInputRequest | null {
  // Scan trace for tool_result steps from request_human_input
  for (const step of result.trace) {
    if (step.type === "tool_result" && step.toolName === "request_human_input") {
      try {
        const parsed = JSON.parse(step.output as string);
        if (parsed.type === HUMAN_INPUT_MARKER) {
          return {
            channel: parsed.channel,
            message: parsed.message,
            requestType: parsed.requestType,
          };
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  }
  // Also check the final output (the LLM may echo the sentinel)
  // But primary detection is via the trace
  return null;
}
```

**Important caveat:** The current `runAgentLoop()` trace records `tool_call` and `tool_result` steps. However, examining the code closely, the `tool_result` trace steps contain the `output` field with `result.content` (string). This is where the sentinel JSON will be. The trace step's `toolName` field identifies it as `request_human_input`. This is the reliable parsing path.

**However**, looking more carefully at `run-agent-loop.ts` lines 426-434, the trace records `tool_result` with `output: result.content`. But `result.content` for `request_human_input` is a JSON string containing `{ type: "human_input_requested", channel, message, requestType }`. So parsing `step.output` as JSON and checking for `type === HUMAN_INPUT_MARKER` is the correct approach.

### Pattern 3: Simplified Workflow with While-Loop Approval
**What:** The new workflow uses a while-loop for re-planning on rejection (replacing the nested conditional in the legacy workflow).
**When to use:** The new `orchestratorWorkflow` function.
**Example:**
```typescript
// Source: Existing dev-agent-workflow.ts pattern + simplification
export async function orchestratorWorkflow(
  input: OrchestratorWorkflowInput,
): Promise<OrchestratorWorkflowResult> {
  // Signal state
  const state = { approval: null, prFeedback: null, prCompletion: null, /* ... */ };

  // Register signal handlers (same signals as legacy)
  wf.setHandler(planApprovalSignal, (d) => { state.approval = d; });
  wf.setHandler(prFeedbackSignal, (f) => { state.prFeedback = f; });
  wf.setHandler(prCompletionSignal, (c) => { state.prCompletion = c; });
  wf.setHandler(escalationResolvedSignal, (r) => { state.escalationResolution = r; });

  // Phase 1: Setup container (separate activity)
  await setupContainerActivity(input);

  // Phase 2: Pre-approval loop (may repeat on rejection)
  let preApprovalResult;
  let approved = false;
  while (!approved) {
    preApprovalResult = await runOrchestratorPreApproval(input);

    // Wait for approval signal (with timeout pattern)
    const gotApproval = await wf.condition(() => state.approval !== null, REMINDER_TIMEOUT);
    if (!gotApproval) { /* reminder + extended wait */ }

    if (state.approval?.approved) {
      approved = true;
    } else {
      // Rejection: reset and loop -- orchestrator handles re-planning internally
      state.approval = null;
    }
  }

  // Phase 3: Post-approval execution
  const postResult = await runOrchestratorPostApproval(input);

  // Phase 4: PR wait + feedback loop
  while (true) {
    const gotSignal = await wf.condition(
      () => state.prCompletion !== null || state.prFeedback !== null,
      FEEDBACK_TIMEOUT,
    );

    if (state.prCompletion) { /* handle merge/close */ break; }
    if (state.prFeedback) {
      await handleOrchestratorFeedback({ ...input, feedback: state.prFeedback });
      state.prFeedback = null; // Reset for next round
      continue;
    }
    break; // Timeout
  }

  // Phase 5: Complete
  await completeTaskActivity(input);
  await wf.condition(wf.allHandlersFinished);
  return result;
}
```

### Pattern 4: Activity Dependency Injection
**What:** Activities use module-level deps initialized at worker startup, following the existing `initDevAgentActivities()` pattern.
**When to use:** All activities in the new file.
**Example:**
```typescript
// Source: Existing dev-agent-activities.ts pattern
export interface OrchestratorActivitiesDeps {
  containerManager: DevContainerManager;
  cleanup: DevContainerCleanup;
  git: DevContainerGit;
  contextManager: ContextManager;
  taskStore: TaskStore;
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
  repoUrl: string;
  githubToken: string;
  owner: string;
  repo: string;
  baseBranch: string;
  slackChannel: string;
}

let deps: OrchestratorActivitiesDeps | null = null;

export function initOrchestratorActivities(dependencies: OrchestratorActivitiesDeps): void {
  deps = dependencies;
}

function getDeps(): OrchestratorActivitiesDeps {
  if (!deps) throw new Error("Orchestrator activities not initialized");
  return deps;
}
```

### Pattern 5: Context Snapshot Handoff
**What:** Pre-approval writes a snapshot; post-approval reads it via the orchestrator's own tools (self-sufficient agents).
**When to use:** At every activity boundary.
**Decision from context:** "No injection of context into system prompts or initial messages by activity code. The same orchestrator code runs in both activities -- the difference is what context exists in the database when it starts."
**Implication:** The activity wrapper simply writes the snapshot. It does NOT pass context to the next orchestrator call. The orchestrator itself reads context via tools on its first action.

### Anti-Patterns to Avoid
- **Injecting context snapshots into the orchestrator's initial message:** The Phase 31 decision says agents are self-sufficient and fetch their own context. The activity wrapper should NOT read the previous snapshot and inject it.
- **Sharing mutable state between activities:** Each activity gets a fresh `runDevAgentOrchestrator()` call. State persistence is via context snapshots and the task store in PostgreSQL.
- **Using heartbeats for the agentic loop:** The existing activities don't heartbeat. Adding heartbeats would require threading `Context.current().cancellationSignal` through to the `AbortSignal` parameter. While technically better, it adds complexity for v2.2 without clear benefit since the existing 30-min timeout works.
- **Modifying `runAgentLoop()` for sentinel detection:** The sentinel is parsed AFTER the loop completes, by the activity wrapper. The loop itself is unchanged.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Context persistence | Custom JSON files | `ContextManager` from Phase 29 | Already built, tested, uses Drizzle with `agents.context_snapshots` table |
| Task state tracking | In-memory state | `TaskStore` from Phase 29 | Already built, tracks status, PR info, approval state in `agents.tasks` |
| Sentinel parsing | Custom loop modification | Parse `AgentLoopResult.trace` for `HUMAN_INPUT_MARKER` | Sentinel is in the tool result, accessible via trace steps |
| Signal definitions | New signal types | Existing signals from `signals.ts` | `planApprovalSignal`, `prFeedbackSignal`, `prCompletionSignal`, `escalationResolvedSignal` are unchanged |
| Timeout patterns | Custom timer logic | `wf.condition(() => ..., timeout)` | Already used in both existing workflows |
| Activity DI | Constructor injection | Module-level `initXxxActivities()` pattern | Established pattern in `dev-agent-activities.ts` |
| Workflow queries | Custom HTTP endpoints | `wf.defineQuery()` | Already used in existing workflows |

**Key insight:** Almost everything needed for Phase 32 already exists as building blocks. The primary work is wiring them together in new activity/workflow files, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Sentinel Detection After LLM Continues
**What goes wrong:** The `request_human_input` tool returns a sentinel JSON, but the LLM receives it as a tool result and may continue calling tools or producing text AFTER getting the sentinel response.
**Why it happens:** The tool's description says "MUST immediately end your turn and provide a summary" but LLMs don't always follow instructions perfectly. After the tool result, the LLM gets one more response where it might call more tools.
**How to avoid:** Parse the ENTIRE trace for any `request_human_input` tool call, regardless of whether the LLM continued after it. The presence of the sentinel anywhere in the trace means the workflow should pause. Also consider: the LLM's final text output after calling `request_human_input` is useful context (it's the "summary of current state" the tool description asks for) and should be included in the context snapshot.
**Warning signs:** Activity returns without detecting the sentinel even though `request_human_input` was called.

### Pitfall 2: Re-Planning Loop Deadlock
**What goes wrong:** On plan rejection, the workflow loops back to run pre-approval again, but the orchestrator doesn't know the plan was rejected because context isn't properly passed.
**Why it happens:** The orchestrator is "self-sufficient" (reads its own context), but after rejection, the rejection feedback needs to be available.
**How to avoid:** Two options: (a) Pass rejection feedback in the activity's `initialMessage` or `context` parameter of `runDevAgentOrchestrator()`. This is the EXCEPTION to the "no injection" rule -- rejection feedback is a Temporal signal payload, not a context snapshot. (b) Store rejection feedback in the task store, and the orchestrator reads it via tools. Option (a) is simpler and preferred.
**Warning signs:** Orchestrator produces the same plan after rejection.

### Pitfall 3: Workflow Code Determinism
**What goes wrong:** Workflow code must be deterministic for Temporal replay. Using `Date.now()`, `Math.random()`, or non-deterministic imports breaks replay.
**Why it happens:** Temporal replays workflow history on restart. Non-deterministic code produces different results on replay.
**How to avoid:** All non-deterministic work happens INSIDE activities. The workflow only calls activities, waits on signals, and manages state. This is already the pattern in the existing workflow. The new workflow should NOT import any agent code directly -- only use `proxyActivities`.
**Warning signs:** Workflow replay errors after worker restart.

### Pitfall 4: Activity Serialization Constraints
**What goes wrong:** Activity inputs and outputs must be JSON-serializable. The `AgentLoopResult` contains a `trace` array that could be very large (hundreds of steps for a complex task).
**Why it happens:** Temporal serializes all activity I/O through its codec. Large payloads (>2MB per argument, 4MB total gRPC limit) will fail.
**How to avoid:** Activities should NOT return the full `AgentLoopResult`. Instead, extract the relevant fields (status, output, toolCallCount, tokenCount) and return a slim result type. The trace is already written to the database by the trace recorder.
**Warning signs:** gRPC payload size errors from Temporal.

### Pitfall 5: Container Setup Timing
**What goes wrong:** The container needs to be running before the orchestrator loop starts, but who sets it up?
**Why it happens:** The Phase 32 context marks "whether container setup is a separate activity or part of pre-approval" as Claude's discretion.
**How to avoid:** Make container setup a SEPARATE activity. Reasoning: (1) Container setup is infrastructure, not LLM reasoning -- it should retry independently. (2) The existing workflow has it as a separate phase. (3) If container setup fails, we want a clear Temporal retry before starting the expensive orchestrator loop. (4) Container ID needs to be stored in the task store before the orchestrator runs.
**Warning signs:** Orchestrator fails because the container isn't ready.

### Pitfall 6: Worker Registration Collision
**What goes wrong:** Both the old and new workflows are registered on the same worker with the same task queue.
**Why it happens:** Phase 32 creates new files alongside legacy files (Phase 35 removes them).
**How to avoid:** The new workflow has a DIFFERENT function name (`orchestratorWorkflow` vs `devAgentWorkflow`). The worker's `workflowsPath` can point to a new index file that exports both. Or the new workflow can use a different task queue. Simplest: use a different task queue (`dev-agent-v2`) for the new workflow during transition, then consolidate in Phase 35.
**Warning signs:** Wrong workflow function gets invoked.

## Code Examples

### Example 1: Complete Activity Output Type
```typescript
// Activity outputs must be serializable and slim (no full trace)
export interface PreApprovalOutput {
  /** Agent loop completion status */
  status: AgentLoopStatus;
  /** Plan text for display in approval message */
  plan: string;
  /** Parsed human input request (if orchestrator called request_human_input) */
  humanInputRequest: HumanInputRequest | null;
  /** Tool call count for observability */
  toolCallCount: number;
  /** Token usage for cost tracking */
  tokenCount: { input: number; output: number };
}

export interface PostApprovalOutput {
  status: AgentLoopStatus;
  /** PR number if created */
  prNumber?: number;
  /** PR URL if created */
  prUrl?: string;
  /** Error message if failed */
  errorMessage?: string;
  toolCallCount: number;
  tokenCount: { input: number; output: number };
}

export interface FeedbackOutput {
  status: AgentLoopStatus;
  /** Whether fixes were applied */
  fixesApplied: boolean;
  errorMessage?: string;
  toolCallCount: number;
  tokenCount: { input: number; output: number };
}
```

### Example 2: Simplified Workflow Phase Enum
```typescript
// Source: Simplified from existing DevAgentWorkflowPhase
export type OrchestratorWorkflowPhase =
  | "pending"              // Workflow started
  | "setup"                // Container being set up
  | "pre_approval"         // Running research + planning
  | "awaiting_approval"    // Waiting for human approval signal
  | "post_approval"        // Running execution + testing + PR
  | "awaiting_pr"          // PR created, waiting for merge/feedback
  | "addressing_feedback"  // Handling PR review comments
  | "complete"             // Successfully completed (PR merged)
  | "failed"               // Unrecoverable error
  | "timeout";             // Workflow timed out
```

### Example 3: Worker Registration (New Activities)
```typescript
// Source: Existing worker.ts pattern
export async function createOrchestratorWorker(
  options: WorkerOptions = {},
): Promise<Worker> {
  // Create dependencies
  const containerManager = createDevContainerManager({ db, logger });
  const contextManager = createContextManager({ db, logger });
  const taskStore = createTaskStore({ db, logger });

  // Initialize orchestrator activities
  initOrchestratorActivities({
    containerManager,
    cleanup: createDevContainerCleanup({ db, logger }),
    git: createDevContainerGit({ manager: containerManager, logger }),
    contextManager,
    taskStore,
    db,
    logger,
    repoUrl: process.env.GITHUB_REPO_URL!,
    githubToken: process.env.GITHUB_TOKEN!,
    owner: process.env.GITHUB_OWNER!,
    repo: process.env.GITHUB_REPO!,
    baseBranch: process.env.GITHUB_BASE_BRANCH || "main",
    slackChannel: process.env.DEV_AGENT_SLACK_CHANNEL!,
  });

  // NOTE: No ChatAnthropic or PostgresSaver needed (LangGraph removed)
  // The orchestrator uses @anthropic-ai/sdk directly via runAgentLoop()

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: "dev-agent-v2",  // Different queue during transition
    workflowsPath: new URL(
      "../shared/temporal/workflows/orchestrator-workflow.js",
      import.meta.url,
    ).pathname,
    activities: {
      setupContainerActivity,
      runOrchestratorPreApproval,
      runOrchestratorPostApproval,
      handleOrchestratorFeedback,
      stopContainerActivity,
      completeTaskActivity,
    },
  });

  return worker;
}
```

### Example 4: Activity Retry Configuration
```typescript
// Source: Existing proxyActivities pattern + agentic loop considerations
const orchestratorActivities = proxyActivities<OrchestratorActivities>({
  startToCloseTimeout: "45 minutes",  // Increased from 30m: agentic loops with sub-agents take longer
  retry: {
    maximumAttempts: 2,               // Reduced from 3: retrying a 30-min LLM loop is expensive
    initialInterval: "10 seconds",    // Slightly longer than 5s: let transient issues settle
    backoffCoefficient: 2,
  },
});

const infrastructureActivities = proxyActivities<InfrastructureActivities>({
  startToCloseTimeout: "5 minutes",   // Container ops are fast
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 10 activity types wrapping LangGraph graph | 3 orchestrator + 2 infrastructure activities wrapping `runAgentLoop()` | Phase 32 | Simpler workflow, fewer activity boundaries |
| LangGraph `PostgresSaver` checkpoints | Context snapshots via `ContextManager` | Phase 29 | Semantic persistence instead of graph state serialization |
| `ChatAnthropic` from `@langchain/anthropic` | `@anthropic-ai/sdk` native tool-use | Phase 28 | Direct API, no abstraction layer |
| Separate activities for Slack/Linear updates | Orchestrator handles via tools | Phase 30-31 | Fewer activity types, LLM-driven side effects |
| `DevAgentPhase` 16-value enum | `OrchestratorWorkflowPhase` ~10 values | Phase 32 | Fewer phases because orchestrator handles transitions internally |

**Deprecated/outdated:**
- `runDevAgentGraphActivity`, `continueAfterApprovalActivity`, `handlePRFeedbackActivity`, `handleRePlanActivity`: replaced by orchestrator activities
- `updateSlackApprovalActivity`, `syncApprovalToLinearActivity`, `sendReminderActivity`: subsumed by orchestrator tools
- `DevAgentActivitiesDeps` with `ChatAnthropic` and `PostgresSaver`: replaced by `OrchestratorActivitiesDeps`

## Open Questions

### 1. Sentinel Parsing: Trace vs. Output
**What we know:** The `request_human_input` tool returns a JSON string containing `HUMAN_INPUT_MARKER` as its `ToolResult.content`. This appears in the trace as a `tool_result` step. The LLM also receives this as a tool result and may reference it in subsequent text.
**What's unclear:** Should we parse the trace (more reliable, sees every tool result) or the final output text (simpler, but LLM might not echo it)? The trace approach is more reliable because it catches the sentinel regardless of what the LLM outputs after.
**Recommendation:** Parse the trace. Specifically scan for steps where `type === "tool_result"` and `toolName === "request_human_input"`, then parse `step.output` as JSON and check for `type === HUMAN_INPUT_MARKER`.

**Note:** Looking at `run-agent-loop.ts` more carefully, the current trace records `tool_call` steps (lines 386-392) but the `tool_result` trace step (lines 427-434) is also recorded. Both have `toolName` and the result has `output: result.content`. So this approach works.

### 2. Re-Planning: Message Injection vs. Tool Discovery
**What we know:** When a plan is rejected, the orchestrator needs to know about the rejection feedback. The Phase 31 decision says agents are "self-sufficient" and fetch context via tools.
**What's unclear:** Rejection feedback is a Temporal signal payload -- it's not stored in the context snapshot or task store by default.
**Recommendation:** Store rejection feedback in the task store (`approval_feedback` column exists), then re-invoke the orchestrator with a message like `"Your previous plan for issue {issueId} was rejected. Read the task state for feedback and create a revised plan."` This preserves the self-sufficient principle while giving the orchestrator a hint to look for feedback.

### 3. Container Setup Activity: New or Reuse
**What we know:** The existing `setup-container.ts` LangGraph node spawns a container, configures git, clones the repo, and creates a branch. The new orchestrator handles branch creation via `github_create_branch` tool.
**What's unclear:** Should the new container setup activity include branch creation, or leave that to the orchestrator?
**Recommendation:** The setup activity should: (1) spawn container, (2) configure git credentials, (3) clone repo. Branch creation should be left to the orchestrator via its `github_create_branch` tool, because the orchestrator decides the branch name based on issue analysis. This separates infrastructure (activity) from reasoning (orchestrator).

### 4. Error Handling: Activity-Level vs. Orchestrator-Level
**What we know:** The orchestrator has error recovery logic in its system prompt (try 3 approaches then escalate). Temporal has automatic activity retry.
**What's unclear:** Which errors should Temporal retry (activity-level) vs. the orchestrator handle (loop-level)?
**Recommendation:**
- **Temporal retry**: Infrastructure errors (DB connection lost, Anthropic API 500, container not found). These are transient and retrying the whole activity makes sense.
- **Orchestrator handles**: Code errors (test failures, build failures, wrong approach). These need LLM reasoning, not blind retry.
- **Neither retries**: Token budget exhausted, max iterations hit. These are terminal conditions -- report as failed.
- **Implementation**: Catch infrastructure errors and let them propagate (Temporal retries). Catch orchestrator loop results with `status === "error"` and distinguish: if the error message is an Anthropic API error, re-throw for Temporal retry. If it's a loop-level failure, return it as the activity result.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/agents/src/shared/temporal/workflows/dev-agent-workflow.ts` -- existing signal/timeout/approval patterns (694 lines)
- Codebase analysis: `packages/agents/src/shared/temporal/activities/dev-agent-activities.ts` -- existing activity DI pattern
- Codebase analysis: `packages/agents/src/dev-agent/orchestrator/orchestrator.ts` -- Phase 31 entry point
- Codebase analysis: `packages/agents/src/shared/agent-loop/run-agent-loop.ts` -- Phase 28 core loop
- Codebase analysis: `packages/agents/src/shared/tools/coordination/request-human-input.ts` -- `HUMAN_INPUT_MARKER` sentinel
- Codebase analysis: `packages/agents/src/shared/db/context-manager.ts` -- Phase 29 context snapshots
- Codebase analysis: `packages/agents/src/shared/db/task-store.ts` -- Phase 29 task state
- Codebase analysis: `packages/agents/src/shared/db/schema.ts` -- agents schema tables

### Secondary (MEDIUM confidence)
- [Temporal TypeScript SDK - Activity Options](https://typescript.temporal.io/api/interfaces/common.ActivityOptions) -- activity timeout and retry configuration
- [Temporal TypeScript SDK - Failure Detection](https://docs.temporal.io/develop/typescript/failure-detection) -- heartbeat and cancellation patterns
- [Temporal TypeScript SDK - Message Passing](https://docs.temporal.io/develop/typescript/message-passing) -- signal + condition + timeout patterns
- [Temporal TypeScript SDK - Cancellation](https://docs.temporal.io/develop/typescript/cancellation) -- CancellationScope, activity cancellation types
- [Temporal TypeScript SDK - Core Application](https://docs.temporal.io/develop/typescript/core-application) -- activity definition and DI patterns
- [Temporal TypeScript SDK - Activity Namespace](https://typescript.temporal.io/api/namespaces/activity) -- Context.current(), heartbeat(), cancellationSignal

### Tertiary (LOW confidence)
- None. All findings verified against codebase and official Temporal documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: HIGH -- patterns established in existing codebase (Phases 28-31), Temporal SDK patterns verified
- Pitfalls: HIGH -- identified from codebase analysis and Temporal documentation, all specific to this implementation

**Research date:** 2026-01-30
**Valid until:** 2026-03-01 (60 days -- stable technology, no fast-moving dependencies)
