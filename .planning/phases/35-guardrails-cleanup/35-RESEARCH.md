# Phase 35: Guardrails & Cleanup - Research

**Researched:** 2026-01-30
**Domain:** Safety guardrails (token budgets, sandbox enforcement, merge protection), Temporal retry policy for LLM activities, LangGraph removal
**Confidence:** HIGH

## Summary

Phase 35 has three distinct work streams: (1) safety guardrails enforcement, (2) Temporal activity retry config for agentic loops, and (3) NUCLEAR removal of all LangGraph code and dependencies. The codebase is in excellent shape for this work -- v2.2 agentic architecture is fully built (Phases 28-34), and the legacy LangGraph code exists alongside it, clearly separated.

The guardrails work is mostly about wiring existing capabilities together. The `TokenBudget` class already exists and is integrated into `runAgentLoop()`. The `DevContainerManager` is already the execution backend for all codebase tools. The `merge_pull_request` tool is already defined in `github-tools.ts` and filtered into the orchestrator toolkit in `toolkits.ts`. The work is: enhance TokenBudget with warning/exhaustion behavior, remove merge_pull_request from toolkit, and add system prompt guardrails.

The LangGraph removal is the largest work stream. There are 21+ files in `code-workflow/`, 18+ files in `workflow/`, plus `shared/tracing/langgraph-tracer.ts`, `shared/state/agent-state.ts`, and the legacy `dev-agent-activities.ts` (plural) that wraps the LangGraph graph. The `worker.ts` file creates both the legacy worker (with `PostgresSaver` and `ChatAnthropic`) and the v2.2 orchestrator worker.

**Primary recommendation:** Execute in this order: (1) guardrails first (they protect the running system), (2) Temporal retry config (uses the v2.2 orchestrator workflow), (3) LangGraph removal last (destructive, depends on nothing else).

## Standard Stack

No new libraries are needed for this phase. This is about removing dependencies and configuring existing ones.

### Core (Already in Use)
| Library | Version | Purpose | Role in Phase 35 |
|---------|---------|---------|-------------------|
| `@anthropic-ai/sdk` | ^0.72.0 | LLM API calls | Token usage already tracked via `response.usage` |
| `@temporalio/workflow` | ^1.14.1 | Workflow orchestration | Retry config tuning in `proxyActivities` |
| `drizzle-orm` | ^0.45.1 | Database ORM | Token aggregation queries |
| `zod` | 3.25.67 | Schema validation | Config schemas for guardrail values |

### To Remove (GUAR-07)
| Library | Current Version | Reason for Removal |
|---------|-----------------|-------------------|
| `@langchain/anthropic` | ^0.3.0 | Replaced by `@anthropic-ai/sdk` |
| `@langchain/core` | ^0.3.0 | LangGraph dependency, no longer needed |
| `@langchain/langgraph` | ^0.2.0 | Replaced by `runAgentLoop()` |
| `@langchain/langgraph-checkpoint-postgres` | ^0.1.0 | Replaced by `agents.context_snapshots` |

### No New Dependencies
This phase requires zero new `npm install` commands. Everything needed is already in the codebase.

## Architecture Patterns

### Pattern 1: Token Budget Warning and Graceful Exhaustion

**What:** Enhance the existing `TokenBudget` to support a warning threshold (~20% remaining) and a reserved buffer (~5K tokens) for final summarization.

**Current state:** `TokenBudget` (in `token-budget.ts`) has `total`, `remaining`, `isExhausted()`, `deduct()`. The `runAgentLoop()` checks `isExhausted()` at the top of each iteration and returns `status: "max_tokens"`.

**Enhancement needed:**

```typescript
// Source: packages/agents/src/shared/agent-loop/token-budget.ts (current code + enhancement)
export interface TokenBudget {
  readonly total: number;
  remaining: number;
  isExhausted(): boolean;
  /** NEW: Check if budget is below warning threshold */
  isWarning(): boolean;
  /** NEW: Check if only the reserve buffer remains (for graceful wrap-up) */
  isReserveOnly(): boolean;
  deduct(input: number, output: number): void;
}

// Configuration values
const WARNING_THRESHOLD_RATIO = 0.20; // 20% remaining triggers warning
const RESERVE_BUFFER = 5_000;         // 5K tokens reserved for final summary

export function createTokenBudget(total: number): TokenBudget {
  return {
    total,
    remaining: total,
    isExhausted() {
      return this.remaining <= 0;
    },
    isWarning() {
      return this.remaining <= this.total * WARNING_THRESHOLD_RATIO;
    },
    isReserveOnly() {
      return this.remaining <= RESERVE_BUFFER;
    },
    deduct(input: number, output: number) {
      this.remaining -= input + output;
    },
  };
}
```

**Warning notification:** The loop in `runAgentLoop()` should check `isWarning()` after each deduction and fire a callback once. The orchestrator activity wires this callback to send a Slack notification. The "once" behavior is critical -- do not send a warning every iteration.

**Graceful exhaustion:** When `isReserveOnly()` is true, the loop should enter a "wrap-up" mode where it makes one final LLM call with a special system prompt suffix telling the agent to summarize progress for resumption, then exits with `status: "max_tokens"`.

### Pattern 2: Merge Protection via Toolkit Filtering

**What:** Remove `github_merge_pull_request` from all agent toolkits. Add system prompt guardrails.

**Current state:** In `toolkits.ts`, `createOrchestratorToolkit()` includes `github_merge_pull_request` in its GitHub tool filter list (line 222-226). The system prompt in `system-prompts.ts` already says "You cannot merge your own pull requests" (line 33) and the tool description says "Only merge PRs that have been reviewed and approved" but the tool is still available.

**The fix is surgical:**
1. Remove `"github_merge_pull_request"` from the filter array in `createOrchestratorToolkit()` (line 225)
2. Update the tool count comment (14 tools -> 13 tools)
3. Update the `<available_tools>` section in `ORCHESTRATOR_SYSTEM_PROMPT` to remove the merge tool listing and add education about human merging
4. The `merge_pull_request` tool definition in `github-tools.ts` stays (it is still a valid MCP tool, just not given to agents)

### Pattern 3: Cost Tracking via Execution Traces Aggregation

**What:** Track per-task token costs using the existing `execution_traces` table which already has `token_count_input` and `token_count_output` columns.

**Current state:** The trace recorder already writes per-step token counts to `execution_traces`. The `orchestratorWorkflow` already accumulates `totalTokens` in workflow state. The `context_snapshots` table also stores `token_count` JSON.

**Recommendation: Query-time aggregation** (Claude's discretion area).

Rationale:
- Expected data volumes are modest: ~100-500 trace rows per task (one per LLM call + tool call), ~10-50 tasks per day initially
- Query-time aggregation via `SUM(token_count_input), SUM(token_count_output)` with `GROUP BY task_id` is trivial at this scale
- Materialized summaries add write complexity (update on every trace insert) for a dashboard that does not exist yet
- When the dashboard is built, a materialized view or summary table can be added without changing the write path

**Query pattern:**
```sql
-- Per-task token totals
SELECT
  task_id,
  SUM(token_count_input) as total_input,
  SUM(token_count_output) as total_output,
  SUM(token_count_input + token_count_output) as total_tokens
FROM agents.execution_traces
WHERE task_id = $1
GROUP BY task_id;
```

**No separate cost alerting:** The token budget cap with the 20% warning is sufficient. A separate alert threshold adds complexity without value -- the budget cap already prevents runaway costs, and the warning notification already alerts the user before exhaustion.

### Pattern 4: Temporal Activity Retry Config for Agentic Loops

**What:** Configure appropriate retry policies for the two activity categories (orchestrator vs infrastructure).

**Current state:** In `orchestrator-workflow.ts`:
- Orchestrator activities: `startToCloseTimeout: "45 minutes"`, `maximumAttempts: 2`, `initialInterval: "10 seconds"`, `backoffCoefficient: 2`
- Infrastructure activities: `startToCloseTimeout: "5 minutes"`, `maximumAttempts: 3`, `initialInterval: "5 seconds"`, `backoffCoefficient: 2`

**Research findings on LLM activity retry:**

Per Temporal's official AI cookbook and community best practices:
1. **Disable client-side retries** -- Let Temporal handle all retry logic. The Anthropic SDK has its own retry logic that can interfere.
2. **Bundle related LLM calls** into a single activity when outputs are interdependent (which our orchestrator loop already does).
3. **Use heartbeats** for long-running activities to prevent premature timeout.
4. **Cap maximum attempts** to prevent runaway costs. LLM activities are expensive.
5. **Match timeouts to task duration** -- 45 minutes for an agentic loop is reasonable given that a complex task may involve 50+ LLM calls at ~5-10 seconds each.

**Recommended retry config:**

```typescript
// Orchestrator activities (LLM-heavy, expensive)
const orchestratorActivities = proxyActivities<OrchestratorActivities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "5 minutes",  // NEW: heartbeat every 5 min
  retry: {
    maximumAttempts: 2,          // Keep at 2 (1 retry)
    initialInterval: "30 seconds", // INCREASE from 10s -- give transient issues time to clear
    backoffCoefficient: 2,
    maximumInterval: "2 minutes", // NEW: cap backoff growth
    nonRetryableErrorTypes: [     // NEW: don't retry permanent failures
      "TokenBudgetExhaustedError",
      "AgentAbortedError",
    ],
  },
});

// Infrastructure activities (deterministic, cheap)
const infrastructureActivities = proxyActivities<InfrastructureActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,           // Keep at 3
    initialInterval: "5 seconds", // Keep at 5s
    backoffCoefficient: 2,
    maximumInterval: "30 seconds", // NEW: cap backoff
  },
});
```

**Key changes from current config:**
- Add `heartbeatTimeout` for orchestrator activities (requires implementing heartbeat in the activity)
- Increase `initialInterval` to 30 seconds for orchestrator retries (transient API issues often resolve in 10-30s)
- Add `maximumInterval` caps to prevent excessive backoff
- Add `nonRetryableErrorTypes` to avoid retrying budget exhaustion or user abort
- Disable Anthropic SDK's built-in retry by passing `maxRetries: 0` to the client constructor

**Heartbeat implementation:** In `runAgentLoop()`, fire `activity.heartbeat()` from `@temporalio/activity` after each LLM response. This keeps the activity alive during long loops without increasing the timeout. Note: heartbeat import must be conditional (only available inside activity context, not in tests).

### Pattern 5: LangGraph NUCLEAR Removal

**What:** Delete all LangGraph code, remove all 4 `@langchain/*` dependencies, drop checkpoint tables.

**Inventory of files to delete:**

**`code-workflow/` directory (21 files):**
```
packages/agents/src/dev-agent/code-workflow/  (entire directory)
  ├── index.ts
  ├── runner.ts
  ├── runner.test.ts
  ├── workflow.ts
  ├── workflow.test.ts
  ├── nodes/
  │   ├── index.ts
  │   ├── generate-code.ts, generate-code.test.ts
  │   ├── fix-code.ts, fix-code.test.ts
  │   ├── run-tests.ts, run-tests.test.ts
  │   ├── pickup-task.ts, pickup-task.test.ts
  │   ├── create-branch.ts, create-branch.test.ts
  │   └── commit-pr.ts, commit-pr.test.ts
  └── state/
      ├── index.ts
      ├── dev-workflow-state.ts
      └── dev-workflow-state.test.ts
```

**`workflow/` directory (18 files):**
```
packages/agents/src/dev-agent/workflow/  (entire directory)
  ├── index.ts
  ├── graph.ts          (createDevAgentGraph, routeByPhase)
  ├── state.ts          (DevAgentState, DevAgentPhase enum, etc.)
  ├── prompts.ts        (old LangGraph prompts, NOT the v2.2 system-prompts.ts)
  └── nodes/
      ├── index.ts
      ├── receive-issue.ts
      ├── setup-container.ts
      ├── research.ts
      ├── plan.ts
      ├── request-approval.ts
      ├── execute.ts
      ├── verify.ts
      ├── create-pr.ts
      ├── notify.ts
      ├── complete.ts
      ├── escalate.ts
      ├── handle-feedback.ts
      └── re-plan.ts
```

**`shared/tracing/` (LangGraph tracer -- 3 files):**
```
packages/agents/src/shared/tracing/
  ├── index.ts                    (re-exports LangGraphTracer)
  ├── langgraph-tracer.ts         (extends @langchain/core BaseCallbackHandler)
  └── langgraph-tracer.test.ts
```

**`shared/state/` (LangGraph agent state -- 3 files):**
```
packages/agents/src/shared/state/
  ├── index.ts                    (re-exports AgentState etc.)
  ├── agent-state.ts              (uses @langchain/langgraph Annotation)
  └── agent-state.test.ts
```

**Legacy activity files:**
```
packages/agents/src/shared/temporal/activities/
  ├── dev-agent-activities.ts     (wraps LangGraph graph, uses ChatAnthropic, PostgresSaver)
  ├── dev-agent-activity.ts       (wraps code-workflow runner)
  ├── dev-agent-activity.test.ts  (tests for legacy activity)
  ├── github-activities.ts        (contains mergePRActivity -- LangGraph-era)
  └── github-activities.test.ts   (tests for legacy activity)
```

**Legacy workflow:**
```
packages/agents/src/shared/temporal/workflows/
  └── dev-agent-workflow.ts       (legacy Temporal workflow wrapping LangGraph graph)
```

**Files to UPDATE (not delete):**
```
packages/agents/src/dev-agent/index.ts           - Remove all LangGraph re-exports
packages/agents/src/dev-agent/worker.ts           - Remove createDevAgentWorker(), PostgresSaver, ChatAnthropic
packages/agents/src/dev-agent/main.ts             - Remove any LangGraph imports
packages/agents/src/dev-agent/api/events.ts       - Remove LangGraph imports if present
packages/agents/src/shared/temporal/workflows/index.ts - Remove devAgentWorkflow export
packages/agents/src/dev-agent/classification/approval.ts - Check for @langchain imports
packages/agents/src/dev-agent/classification/approval.test.ts - Same
packages/agents/package.json                      - Remove 4 @langchain/* deps
```

**Platform cleanup:**
```
packages/platform/src/services/cleanup.ts          - Remove checkpoint cleanup code
```

**Database migration:**
```
-- New migration: drop LangGraph checkpoint tables
DROP TABLE IF EXISTS checkpoint_writes;
DROP TABLE IF EXISTS checkpoint_blobs;
DROP TABLE IF EXISTS checkpoints;
```

### Pattern 6: Sandbox Enforcement Verification

**What:** Verify that all `run_command` tool calls execute inside `DevContainerManager` -- no host access.

**Current state:** This is already correctly implemented. The `createRunCommandTool()` in `codebase-tools.ts` takes a `CodebaseToolDeps` which includes `containerManager: DevContainerManager`. Every tool execution calls `deps.containerManager.execute(deps.taskId, ...)` which runs commands inside the Docker container.

**Verification strategy:** This is not a code change but a verification task:
1. Confirm that `createRunCommandTool` (and all codebase tools) only use `containerManager.execute()`
2. Confirm there are no `child_process.exec/spawn` calls in the agents package
3. Confirm there are no direct file system access calls (`fs.readFile`, `fs.writeFile`) in the agents package
4. Write a verification test that asserts the tool calls `containerManager.execute` with the correct task ID

The codebase tool tests already verify this (see `codebase-tools.test.ts` lines 81-92 which check the exact `containerManager.execute` call).

### Recommended Project Structure After Cleanup

```
packages/agents/src/
├── dev-agent/
│   ├── api/              # HTTP handlers (unchanged)
│   ├── classification/   # Approval classifier (check for @langchain imports)
│   ├── orchestrator/     # v2.2 orchestrator (KEEP - this is the new system)
│   │   ├── orchestrator.ts
│   │   ├── orchestrator.test.ts
│   │   └── system-prompts.ts
│   ├── utils/            # Package manager detection (unchanged)
│   ├── main.ts           # HTTP server entry (update imports)
│   ├── worker.ts         # Temporal worker (remove legacy, keep orchestrator worker)
│   ├── index.ts          # Updated barrel (remove LangGraph exports)
│   └── README.md         # Update to reflect v2.2 architecture
│
│   # DELETED: workflow/ directory (LangGraph HITL graph)
│   # DELETED: code-workflow/ directory (LangGraph code gen)
│
├── product-agent/        # Already v2.2 (no changes needed)
│   ├── orchestrator/
│   └── ...
│
├── router/               # Smart router (no changes needed)
│
└── shared/
    ├── agent-loop/       # Core loop (ENHANCE: warning, graceful exhaustion)
    │   ├── run-agent-loop.ts
    │   ├── token-budget.ts
    │   ├── types.ts
    │   └── errors.ts
    ├── db/               # Database (unchanged)
    ├── mcp/              # MCP client (unchanged)
    ├── temporal/
    │   ├── activities/
    │   │   ├── orchestrator-activities.ts    # KEEP
    │   │   ├── infrastructure-activities.ts   # KEEP
    │   │   ├── product-agent-activity.ts      # KEEP (already v2.2)
    │   │   # DELETED: dev-agent-activities.ts (LangGraph wrapper)
    │   │   # DELETED: dev-agent-activity.ts (code-workflow wrapper)
    │   │   # DELETED: github-activities.ts (legacy merge activity)
    │   │   └── their test files
    │   ├── workflows/
    │   │   ├── orchestrator-workflow.ts        # KEEP (update retry config)
    │   │   ├── product-agent-workflow.ts       # KEEP
    │   │   ├── index.ts                        # UPDATE (remove devAgentWorkflow)
    │   │   # DELETED: dev-agent-workflow.ts (legacy LangGraph workflow)
    │   │   └── their test files
    │   ├── signals.ts    # KEEP
    │   └── types.ts      # KEEP (remove legacy types if any)
    ├── tools/            # Tool definitions (UPDATE: remove merge from toolkit)
    │   ├── codebase/     # KEEP
    │   ├── coordination/ # KEEP
    │   ├── integration/  # KEEP (github-tools.ts stays, merge tool stays as MCP tool)
    │   └── toolkits.ts   # UPDATE (remove merge from orchestrator toolkit)
    │
    # DELETED: tracing/ directory (LangGraphTracer)
    # DELETED: state/ directory (LangGraph agent state)
```

### Anti-Patterns to Avoid

- **Deleting merge_pull_request from github-tools.ts:** The tool definition must stay -- it is a valid MCP tool that the GitHub integration supports. It is only removed from agent toolkits. Defense-in-depth means both the tool is unavailable AND the prompt says humans merge.
- **Removing @langchain imports piecemeal:** Use the grep-and-destroy approach. After all file deletions, grep for any remaining references. Missing one import causes a build failure that is hard to diagnose.
- **Adding heartbeat inside the workflow code:** Heartbeats are an activity concept. They must be called from the activity implementation (e.g., `orchestrator-activities.ts`), not from the workflow definition.
- **Retrying token budget exhaustion:** This is a permanent condition. The token budget is shared and mutable. If it is exhausted in attempt 1, it will still be exhausted in attempt 2. Mark as non-retryable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom token estimator | `response.usage.input_tokens` / `output_tokens` from Anthropic API | Exact counts per response, already used in runAgentLoop |
| Cost aggregation | Custom event system | SQL `SUM()` query on `execution_traces` | Data already there, query is trivial |
| Checkpoint persistence | Custom state saver | `agents.context_snapshots` table | Already built in Phase 29 |
| Command sandboxing | Docker CLI calls | `DevContainerManager.execute()` | Already built in Platform package |
| Retry logic | Custom retry wrappers | Temporal `proxyActivities` retry config | Built into the framework |
| Client retry disabling | Custom HTTP interceptor | `new Anthropic({ maxRetries: 0 })` | SDK parameter, not custom code |

**Key insight:** Phase 35 is primarily about configuration, wiring, and deletion -- not building new subsystems. Every capability needed already exists in the codebase.

## Common Pitfalls

### Pitfall 1: LangGraph Import Leakage
**What goes wrong:** After deleting LangGraph files, a deeply nested import chain still references `@langchain/core` and the build fails with an opaque "module not found" error.
**Why it happens:** Barrel exports (`index.ts`) re-export from deleted modules. Types imported in other files still reference LangGraph types.
**How to avoid:** After all file deletions: (1) `grep -r "@langchain" packages/agents/src/` with zero tolerance, (2) `grep -r "langgraph" packages/agents/src/` with zero tolerance, (3) `grep -r "PostgresSaver" packages/agents/src/` with zero tolerance, (4) `grep -r "ChatAnthropic" packages/agents/src/` with zero tolerance, (5) run `pnpm typecheck` to catch dangling type references.
**Warning signs:** Any remaining barrel export that references a deleted module.

### Pitfall 2: Worker Boot Failure After Removal
**What goes wrong:** The `worker.ts` bootstrap function creates both legacy and orchestrator workers. Removing legacy imports without updating bootstrap causes startup crash.
**Why it happens:** `bootstrap()` at the bottom of `worker.ts` calls `createDevAgentWorker()` which imports `PostgresSaver` and `ChatAnthropic`. After removing these deps, the import fails.
**How to avoid:** Change `bootstrap()` to call `createOrchestratorWorker()` instead. Remove `createDevAgentWorker()` entirely. Update Docker entrypoint if it references the legacy worker.
**Warning signs:** Container fails to start after dependency removal.

### Pitfall 3: Temporal Workflow History Incompatibility
**What goes wrong:** Existing running workflows on the `dev-agent` task queue expect the legacy activity names. Removing them causes workflow task failures.
**Why it happens:** Temporal replays workflow history, which includes scheduled activity names. If the activity no longer exists in the worker, replay fails.
**How to avoid:** The v2.2 orchestrator already uses a separate task queue (`dev-agent-v2`). Ensure no legacy workflows are running before removing the legacy worker. If any are running, let them complete or terminate them manually.
**Warning signs:** Temporal UI shows workflow task failures after deployment.

### Pitfall 4: Token Budget Warning Fires Every Iteration
**What goes wrong:** After the budget drops below 20%, every subsequent iteration triggers a Slack notification, flooding the channel.
**Why it happens:** `isWarning()` returns true for every check once below threshold.
**How to avoid:** Add a `warningFired: boolean` flag to `TokenBudget`. The warning callback fires once and sets the flag. Subsequent checks short-circuit.
**Warning signs:** Multiple "budget running low" messages for the same task.

### Pitfall 5: Heartbeat Inside Workflow Code
**What goes wrong:** Importing `@temporalio/activity` inside workflow code breaks Temporal's deterministic execution model.
**Why it happens:** Workflow code runs in a sandboxed environment. Activity imports are not available.
**How to avoid:** Heartbeats must be called from activity implementations only. Pass heartbeat as a callback from the activity to `runAgentLoop()` via options, or have the activity emit heartbeats around the loop call.
**Warning signs:** Temporal worker crashes with sandbox violation error.

### Pitfall 6: Removing Checkpoint Tables Without Migration
**What goes wrong:** Checkpoint tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`) are dropped via raw SQL instead of a proper migration, causing migration tool confusion.
**Why it happens:** These tables were created by `PostgresSaver.setup()`, not by Drizzle migrations. They exist in the public schema, not a managed schema.
**How to avoid:** Create a proper SQL migration file that drops these tables with `IF EXISTS`. Also clean up the cleanup service that references them (`packages/platform/src/services/cleanup.ts`).
**Warning signs:** Migration runner shows inconsistent state.

## Code Examples

### Token Budget Warning Integration in Agent Loop

```typescript
// In runAgentLoop() -- after tokenBudget.deduct()
// Source: Enhancement to packages/agents/src/shared/agent-loop/run-agent-loop.ts

// Track token usage
tokenBudget?.deduct(response.usage.input_tokens, response.usage.output_tokens);

// Check warning threshold (fires once)
if (tokenBudget?.isWarning() && !tokenBudget.warningFired) {
  tokenBudget.warningFired = true;
  options.onBudgetWarning?.({
    total: tokenBudget.total,
    remaining: tokenBudget.remaining,
    usedPercent: Math.round(((tokenBudget.total - tokenBudget.remaining) / tokenBudget.total) * 100),
  });
}

// Check reserve-only for graceful wrap-up
if (tokenBudget?.isReserveOnly()) {
  // Make one final call with wrap-up instruction
  // ... then return with status "max_tokens"
}
```

### Merge Protection in Toolkit

```typescript
// Source: packages/agents/src/shared/tools/toolkits.ts (line 220-226)
// BEFORE:
const orchestratorGitHub = allGitHub.filter((t) =>
  [
    "github_create_branch",
    "github_create_commit",
    "github_create_pull_request",
    "github_get_pull_request",
    "github_merge_pull_request",  // REMOVE THIS LINE
  ].includes(t.name),
);

// AFTER:
const orchestratorGitHub = allGitHub.filter((t) =>
  [
    "github_create_branch",
    "github_create_commit",
    "github_create_pull_request",
    "github_get_pull_request",
  ].includes(t.name),
);
```

### System Prompt Update for Merge Education

```typescript
// Source: packages/agents/src/dev-agent/orchestrator/system-prompts.ts
// Update <available_tools> section, replace the merge_pull_request entry:

// BEFORE:
// - github_merge_pull_request: Merge a PR (only if explicitly instructed by a human).

// AFTER:
// Note: You do NOT have a merge tool. Humans review and merge pull requests.
// After creating a PR, report completion and let a human reviewer handle merging.
```

### Disable Anthropic SDK Built-in Retries

```typescript
// Source: packages/agents/src/shared/agent-loop/run-agent-loop.ts
// When creating the Anthropic client:

const client = new Anthropic({
  maxRetries: 0, // Let Temporal handle retries
});
```

### Orchestrator Retry Config Update

```typescript
// Source: packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts

const orchestratorActivities = proxyActivities<OrchestratorActivities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "5 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
    nonRetryableErrorTypes: [
      "TokenBudgetExhaustedError",
      "AgentAbortedError",
    ],
  },
});
```

### Token Budget Config via AgentConfig

```typescript
// Source: packages/agents/src/shared/config/ (or orchestrator options)
// Recommendation: Keep it simple via OrchestratorOptions default

export interface OrchestratorOptions {
  // ... existing fields
  /** Maximum token budget (default: 500_000, override via env TOKEN_BUDGET_DEFAULT) */
  maxTokenBudget?: number;
}

// In orchestrator.ts:
const defaultBudget = Number(process.env.TOKEN_BUDGET_DEFAULT) || 500_000;
const tokenBudget = createTokenBudget(options.maxTokenBudget ?? defaultBudget);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LangGraph state machine | Agentic tool-use loop | v2.2 (Phases 28-34) | Agents reason about control flow |
| `@langchain/anthropic` ChatAnthropic | `@anthropic-ai/sdk` direct | v2.2 Phase 28 | Native tool-use, no wrapper overhead |
| PostgresSaver checkpoints | `agents.context_snapshots` | v2.2 Phase 29 | Semantic context, not raw state |
| Fixed 8-node pipeline | Orchestrator + sub-agents | v2.2 Phase 31 | Complexity-aware delegation |
| All same retry config | Split orchestrator/infra | v2.2 Phase 32 | Appropriate retry per activity type |

**Deprecated/outdated:**
- `@langchain/langgraph` state machine: Replaced by `runAgentLoop()` in Phase 28
- `routeByPhase()` function: Replaced by LLM reasoning in orchestrator prompt
- `DevAgentPhase` 16-value enum: No longer used, orchestrator decides workflow
- `PostgresSaver.fromConnString()`: Replaced by Drizzle-managed `context_snapshots`
- `code-workflow/`: Simple LangGraph pipeline, replaced by orchestrator delegating to coder sub-agent

## Open Questions

1. **Heartbeat implementation location**
   - What we know: Heartbeats must be called from activity context, not workflow. The `runAgentLoop()` is called from inside the activity.
   - What's unclear: Whether to pass `activity.heartbeat` as a callback option to `runAgentLoop()` or have the activity wrapper emit heartbeats periodically on a timer around the loop call.
   - Recommendation: Use a callback option on `AgentLoopOptions` (`onHeartbeat?: () => void`). The loop calls it after each LLM response. The activity sets it to `activity.heartbeat`. Tests pass `undefined`. This keeps the loop framework-agnostic.

2. **Legacy workflow termination**
   - What we know: The legacy `dev-agent` task queue may have running workflows. The v2.2 `dev-agent-v2` queue is separate.
   - What's unclear: Whether there are any running legacy workflows in production at the time of deployment.
   - Recommendation: Before deploying Phase 35, query Temporal for any running workflows on `dev-agent` queue and terminate them. This is a one-time operational step, not a code change.

3. **Checkpoint table ownership**
   - What we know: `PostgresSaver.setup()` creates `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` in the public schema. These are not managed by Drizzle migrations.
   - What's unclear: Whether other services depend on these tables.
   - Recommendation: Create a SQL migration to drop them with `IF EXISTS`. Since they are in the public schema and only used by LangGraph, no other service depends on them.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- Direct reading of all files referenced above (24+ files across agents, platform, integrations)
- **[Temporal Retry Policies Documentation](https://docs.temporal.io/encyclopedia/retry-policies)** -- Default values, parameter semantics
- **[Temporal Activity Timeouts Blog](https://temporal.io/blog/activity-timeouts)** -- startToCloseTimeout vs scheduleToCloseTimeout guidance
- **[Temporal AI Cookbook - Agentic Loop](https://docs.temporal.io/ai-cookbook/agentic-loop-tool-call-openai-python)** -- Official pattern for LLM activities in Temporal

### Secondary (MEDIUM confidence)
- **[Temporal AI Agents Guide](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal)** -- Best practices for retry + heartbeat with LLM agents
- **[Temporal + Pydantic AI Integration](https://ai.pydantic.dev/durable_execution/temporal/)** -- Recommendation to disable client retries, verified against official docs
- **[Anthropic Usage and Cost API](https://docs.anthropic.com/en/api/usage-cost-api)** -- Token usage tracking available per response
- **[Temporal Failure Handling Blog](https://temporal.io/blog/failure-handling-in-practice)** -- Retry logic patterns, nonRetryableErrorTypes usage

### Tertiary (LOW confidence)
- **[ActiveWizards Temporal AI Guide](https://activewizards.com/blog/indestructible-ai-agents-a-guide-to-using-temporal)** -- Community guide, corroborated by official docs
- **[DEV Community Temporal + AI Agents](https://dev.to/akki907/temporal-workflow-orchestration-building-reliable-agentic-ai-systems-3bpm)** -- Community patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Based on direct codebase reading, no new libraries
- Architecture (guardrails): HIGH -- Straightforward enhancement of existing code
- Architecture (LangGraph removal): HIGH -- Complete file inventory from codebase scan
- Architecture (retry config): HIGH -- Temporal official docs + AI cookbook
- Pitfalls: HIGH -- Derived from actual code structure and known Temporal constraints

**Research date:** 2026-01-30
**Valid until:** 2026-03-01 (30 days -- stable, no fast-moving dependencies)
