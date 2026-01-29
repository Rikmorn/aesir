# Architecture Patterns: Agentic Tool-Use Loop Integration

**Domain:** Agentic development platform -- replacing LangGraph state machine with agentic tool-use loops
**Researched:** 2026-01-29
**Overall confidence:** HIGH (codebase analysis) / MEDIUM (external patterns)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Temporal + Agentic Loops: Integration Architecture](#2-temporal--agentic-loops-integration-architecture)
3. [Sub-Agent Spawning Patterns](#3-sub-agent-spawning-patterns)
4. [Context Boundary Design](#4-context-boundary-design)
5. [Tool Definition Architecture](#5-tool-definition-architecture)
6. [MCP-to-Tool-Definition Bridging](#6-mcp-to-tool-definition-bridging)
7. [Database Schema for Agentic State](#7-database-schema-for-agentic-state)
8. [Migration Path: LangGraph to Agentic Loops](#8-migration-path-langgraph-to-agentic-loops)
9. [Spec Validation and Gaps](#9-spec-validation-and-gaps)
10. [Recommended Build Order](#10-recommended-build-order)
11. [Sources and Confidence Assessment](#11-sources-and-confidence-assessment)

---

## 1. Executive Summary

The v2.2 architecture replaces LangGraph's fixed state machine (13 nodes, 16 phases, `routeByPhase()` switch statement) with agentic tool-use loops where the LLM decides control flow. The existing Temporal workflow infrastructure remains intact -- it continues to provide durable execution, signal-based human-in-the-loop gates, and timeout handling. The change is surgical: swap what runs inside Temporal activities, not the Temporal orchestration itself.

**The key architectural insight from production systems (Temporal's official AI cookbook, OpenAI Codex on Temporal, Anthropic's multi-agent research system):**

> The workflow owns the deterministic shell (loops, signal waits, timeouts). Activities own the non-deterministic work (LLM calls, tool execution). The agentic loop runs inside an activity, not as the workflow itself.

This aligns perfectly with Aesir's current structure. Today, `runDevAgentGraphActivity` runs a LangGraph graph inside a Temporal activity. Tomorrow, it runs an agentic tool-use loop instead. Temporal's role does not change.

**Core changes required:**

| Layer | Current | Target | Effort |
|-------|---------|--------|--------|
| LLM SDK | `@langchain/anthropic` (text only) | `@anthropic-ai/sdk` (native tool-use) | New dependency, remove 4 old |
| Agent logic | LangGraph StateGraph with 13 nodes | `runAgentLoop()` function with tools | New runtime, delete graph code |
| State persistence | `PostgresSaver` graph checkpoints | Context snapshots in `agents.*` tables | New schema, new write/read logic |
| Control flow | `routeByPhase()` switch on 16 phases | LLM decides next tool call | Prompt engineering |
| Activity boundary | Activity runs full graph | Activity runs agentic loop | Modify activity functions |
| Event routing | Hardcoded switch in `events.ts` | LLM-based smart router | New component |

---

## 2. Temporal + Agentic Loops: Integration Architecture

### 2.1 The Production Pattern

**Confidence: HIGH** (verified across Temporal official docs, blog, and community repos)

The established pattern for combining Temporal with LLM tool-use loops separates concerns at the activity boundary:

```
Temporal Workflow (deterministic)
  |
  |-- Activity: runOrchestratorPreApproval()
  |     |
  |     +-- runAgentLoop(systemPrompt, tools, "Research and plan for AES-42")
  |           |
  |           +-- LLM call -> tool_use -> execute tool -> feed result back
  |           +-- LLM call -> tool_use (spawn_agent) -> nested loop
  |           +-- LLM call -> text only -> done
  |           |
  |           return AgentLoopResult (plan, context summary)
  |
  |-- wf.condition(() => approval !== null, "24 hours")  [signal wait]
  |
  |-- Activity: runOrchestratorPostApproval()
  |     |
  |     +-- runAgentLoop(systemPrompt, tools, "Execute approved plan")
  |           |
  |           +-- ... (similar loop)
  |           |
  |           return AgentLoopResult (PR URL, files changed)
  |
  |-- wf.condition(() => completion !== null, "7 days")  [signal wait]
  |
  |-- Activity: completeTask()
```

**Why the agentic loop goes INSIDE an activity, not as the workflow itself:**

1. **Determinism requirement**: Temporal workflows must be deterministic for replay. LLM calls are non-deterministic. Therefore, LLM calls must be in activities.
2. **Replay efficiency**: If the workflow crashes after the pre-approval loop completes but before the signal wait, Temporal replays by reading the activity result from history -- it does NOT re-run the LLM calls. This is critical for cost control.
3. **Timeout enforcement**: Activity `startToCloseTimeout` (30 minutes for dev agent) caps the duration of the agentic loop. If the loop gets stuck, Temporal terminates the activity and triggers retry policy.
4. **Retry semantics**: Temporal retries the entire activity on failure (3 attempts with exponential backoff). A stuck agentic loop that errors out gets a fresh start from the beginning of that phase.

### 2.2 Mapping to Aesir's Current Architecture

The current Temporal workflow (`dev-agent-workflow.ts`) already has the correct structure. Here is the mapping:

**Current activities -> New activities:**

| Current Activity | What It Does | New Activity | What Changes |
|-----------------|--------------|--------------|-------------|
| `runDevAgentGraphActivity` | Runs LangGraph graph from start | `runOrchestratorPreApproval` | Runs agentic loop instead of graph |
| `continueAfterApprovalActivity` | Runs LangGraph from execute phase | `runOrchestratorPostApproval` | Runs agentic loop with approved plan context |
| `handlePRFeedbackActivity` | Runs LangGraph from feedback phase | `runOrchestratorFeedback` | Runs agentic loop with feedback context |
| `handleRePlanActivity` | Runs LangGraph from re-plan phase | (folded into pre-approval) | Orchestrator re-plans as part of its loop |
| `stopContainerActivity` | Stops container (currently no-op) | Unchanged | Keep as-is |
| `sendReminderActivity` | Sends Slack reminder | Could fold into orchestrator tools | Keep separate for simplicity |
| `updateSlackApprovalActivity` | Updates Slack message | Fold into orchestrator tools | Orchestrator calls send_message directly |
| `syncApprovalToLinearActivity` | Posts approval to Linear | Fold into orchestrator tools | Orchestrator calls create_comment directly |
| `completeTaskActivity` | Updates Linear, notifies Slack, cleans up | Simplify | Orchestrator handles most via tools |

**What the workflow file changes look like:**

The workflow structure simplifies because the orchestrator handles more transitions internally. The key change is that `runOrchestratorPreApproval` returns a structured plan result, and `runOrchestratorPostApproval` receives the approved plan as context. The signal handling, timeout logic, and `wf.condition()` calls remain identical.

### 2.3 Activity Timeout and Cost Handling

**Current timeouts (kept as-is):**
- Dev agent activities: 30 min `startToCloseTimeout`, 3 retries, 5s exponential backoff
- Product agent activities: 5 min `startToCloseTimeout`

**New guardrails layered inside the activity:**
- `maxIterations` (50 per sub-agent, 100 per orchestrator): Loop exits with `max_iterations` status
- `maxTokenBudget` (500K default): Loop exits with `max_tokens` status
- `AbortSignal` from Temporal's heartbeat/cancellation mechanism

**Recommendation:** Keep the existing Temporal timeout at 30 minutes. The agentic loop's iteration limit is the primary guardrail. The Temporal timeout is the safety net if the iteration limit somehow fails (e.g., very long tool executions). If a sub-agent runs 50 iterations with each taking ~30 seconds (LLM call + tool execution), that is ~25 minutes -- within the 30 minute window.

### 2.4 State Passing Between Activities

**Current pattern (kept):** Activities return serializable results. The workflow stores these in local mutable state. Subsequent activities receive relevant data as input parameters.

```typescript
// Current pattern in dev-agent-workflow.ts (lines 266-275):
let graphResult = await runDevAgentGraphActivity({ taskId, issue, slackChannel });
state.phase = graphResult.phase;
state.prNumber = graphResult.prNumber;
// ... later ...
graphResult = await continueAfterApprovalActivity({ taskId, issue, slackChannel });
```

**New pattern:** Activities return richer structured results. Context summaries are written to DB inside the activity. The workflow passes task identifiers, not full context.

```typescript
// New pattern:
const preApprovalResult = await runOrchestratorPreApproval({
  taskId, issue, slackChannel, containerId
});
// preApprovalResult contains: { plan, slackMessageTs, contextSnapshotId }
// Context details are in DB, not passed through workflow state

// ... signal wait for approval ...

const postApprovalResult = await runOrchestratorPostApproval({
  taskId, issue, slackChannel, containerId,
  contextSnapshotId: preApprovalResult.contextSnapshotId
});
// postApprovalResult contains: { prNumber, prUrl, contextSnapshotId }
```

**Why write context to DB rather than pass through Temporal:**
1. Temporal event history has a size limit (50MB default). Full conversation histories with tool results can be large.
2. Context summaries are semantically compressed by the LLM before writing -- much smaller than raw conversation history.
3. DB allows querying context across activities (for debugging, observability).
4. Sub-agent spawning within an activity needs DB access for context anyway.

---

## 3. Sub-Agent Spawning Patterns

### 3.1 In-Process Spawning (Recommended for Aesir)

**Confidence: HIGH** (validated by Anthropic's multi-agent research system architecture)

The spec proposes `spawn_agent` as a tool the orchestrator calls. This should be **in-process**: a nested function call that creates a fresh `runAgentLoop()` invocation with its own system prompt, tools, and context window.

**Why in-process:**

| Factor | In-Process | Out-of-Process (Temporal activity) |
|--------|-----------|-----------------------------------|
| Latency | ~0ms overhead | 100ms+ (Temporal scheduling) |
| Context passing | Direct object reference | Must serialize to Temporal history |
| Failure boundary | Fails with parent activity | Independent retry |
| Token tracking | Shared budget counter | Separate, harder to aggregate |
| Timeout | Parent activity timeout covers all | Each sub-agent has its own timeout |
| Implementation | Function call | Temporal child workflow or activity |

**In-process is correct because:**
1. Sub-agents are short-lived (5-50 tool calls, < 5 minutes each)
2. They share the parent's container ID for codebase tools
3. They need to return structured results synchronously to the orchestrator
4. The orchestrator needs to reason about sub-agent results immediately
5. A single activity timeout (30 min) covers the orchestrator + all its sub-agents

**When out-of-process would be better (not applicable to Aesir v2.2):**
- Sub-agents that take > 30 minutes independently
- Sub-agents that need independent retry semantics
- Sub-agents on different machines (distributed)
- Sub-agents that outlive the parent

### 3.2 Implementation: `spawn_agent` as a Tool

```typescript
// Conceptual implementation
const spawnAgentTool: ToolDefinition = {
  name: "spawn_agent",
  description: "Spawn a focused sub-agent with specific tools and context",
  inputSchema: z.object({
    agentType: z.enum(["researcher", "coder", "tester"]),
    task: z.string().describe("What the sub-agent should accomplish"),
    context: z.record(z.unknown()).optional()
      .describe("Additional context for the sub-agent"),
  }),
  execute: async (input) => {
    const subAgentConfig = SUB_AGENT_CONFIGS[input.agentType];

    const result = await runAgentLoop({
      systemPrompt: subAgentConfig.systemPrompt(input.task, input.context),
      tools: subAgentConfig.tools,  // Focused tool set, NOT all tools
      initialMessage: input.task,
      maxIterations: 50,  // Sub-agent limit
      // Share parent's token budget tracker
      onToolCall: parentTracer.createChildTracer(input.agentType),
    });

    // Return summary to orchestrator (NOT full conversation)
    return {
      content: result.output,  // LLM's final summary of work done
      isError: result.status !== "completed",
    };
  },
};
```

### 3.3 Context Isolation Between Sub-Agents

**Critical design principle from Anthropic's multi-agent research:**

> The sub-agent response contains only the sub-agent's final output message. Even if the sub-agent made multiple tool calls, went through extended thinking, or generated intermediate responses during its execution, the parent agent only sees the end result.

This means:
- **Orchestrator -> Sub-agent:** Orchestrator composes a focused brief (task + relevant context + conventions). This goes as the `initialMessage` to the sub-agent's loop.
- **Sub-agent -> Orchestrator:** Sub-agent returns its final text output (summary of findings, or list of files changed). NOT the full conversation history.
- **Context window isolation:** Each sub-agent starts with a fresh context window. It does not inherit the orchestrator's conversation history.

**This is exactly what Aesir needs because:**
- Researcher needs task description + repo structure, NOT the orchestrator's prior tool calls
- Coder needs plan + relevant files, NOT research conversation history
- Tester needs changed files + test runner info, NOT coding conversation

### 3.4 Scaling Effort to Complexity

Anthropic documented a critical lesson: agents over-spawn without explicit guidance. Their solution: embed scaling rules in the system prompt.

**For Aesir:**

```
Simple task (README edit, config change):
  - Orchestrator handles directly (no sub-agents)
  - 5-15 tool calls total

Medium task (add endpoint, fix bug):
  - 1 researcher (10-20 tool calls)
  - 1 coder (15-30 tool calls)
  - 1 tester (5-10 tool calls)

Complex task (new feature with tests):
  - 1 researcher (15-30 tool calls)
  - 1-2 coders (20-40 tool calls each)
  - 1 tester (10-20 tool calls)
```

The orchestrator's system prompt should include these scaling guidelines. The LLM decides whether to spawn based on task complexity.

---

## 4. Context Boundary Design

### 4.1 Where Context Snapshots Are Written

Context snapshots serve a specific purpose: **they bridge Temporal activity boundaries** where the in-memory conversation history of an agentic loop is lost.

**Write points:**

| When | What | Why |
|------|------|-----|
| End of pre-approval activity | Research findings, plan, project context | Orchestrator needs this after approval wait |
| End of post-approval activity | Execution summary, PR details, files changed | For completion and feedback handling |
| End of feedback activity | Feedback addressed summary | In case of crash recovery |
| On error/escalation | Full state dump for debugging | Human needs context to help |
| Sub-agent brief (NOT persisted to DB) | Focused task description | In-memory only, passed as initialMessage |

**Do NOT write at:**
- Every tool call (too much overhead, traces table handles this)
- Between sub-agent invocations within a single activity (unnecessary -- in-memory)
- Before spawning a sub-agent (pass context directly, no DB round-trip)

### 4.2 Where Context Snapshots Are Read

| When | What | Why |
|------|------|-----|
| Start of post-approval activity | Pre-approval snapshot (plan, research summary) | Reconstruct orchestrator context after signal wait |
| Start of feedback activity | Post-approval snapshot (PR details, execution context) | Know what was built to address feedback |
| Crash recovery (Temporal replay) | Latest snapshot for the task | Resume with understanding of what was done |
| Smart router context lookup | Task status from `agents.tasks` table | Know which workflows are active |

### 4.3 Snapshot Content Design

The spec proposes `agents.context_snapshots` with a mix of structured and semantic fields. This is sound. The key insight:

**Critical data (must be exact) goes in `agents.tasks` table:**
- `container_id`, `branch_name`, `pr_number`, `pr_url`
- `approval_status`, `slack_channel`, `slack_message_ts`

**Semantic context (LLM-generated summary) goes in `agents.context_snapshots`:**
- `summary`: "Researched the codebase, found existing /health pattern in integration services..."
- `completed_actions`: What steps were taken
- `project_context`: Detected package manager, test framework, conventions
- `research_findings`: Structured research output
- `plan`: The approved execution plan

**Why this split matters:**
The orchestrator's post-approval system prompt can say: "You previously researched and planned: {snapshot.summary}. The approved plan is: {snapshot.plan}. The branch is: {task.branch_name}. Now execute the plan."

The summary is lossy (LLM-compressed) but sufficient for reasoning. The task fields are exact (PR numbers, branch names) and used for tool calls.

### 4.4 Temporal Replay and Context

A subtle but important point: when Temporal replays a workflow after crash, it does NOT re-execute completed activities. It reads their return values from the event history. So:

1. Pre-approval activity completes -> result stored in Temporal history
2. Crash happens during signal wait
3. Temporal replays: reads pre-approval result from history (no re-execution)
4. Signal arrives -> post-approval activity runs fresh (not replayed)
5. Post-approval reads context from DB using `contextSnapshotId` from step 1

This means context snapshots must be durable (DB) -- they survive crashes. The activity return values stored in Temporal are just pointers (`contextSnapshotId`), not the full context.

---

## 5. Tool Definition Architecture

### 5.1 Recommended: Per-Agent Toolkits (Composable)

**Confidence: HIGH** (aligns with Anthropic's guidance and the spec's design)

Do NOT use a single global registry. Instead, compose tool sets per agent type:

```
tools/
  base/
    codebase.ts       -- read_file, write_file, search_codebase, list_directory, run_command
    integration.ts    -- MCP wrappers: get_issue, create_issue, send_message, etc.
    git.ts            -- create_branch, create_commit, create_pull_request
  toolkits/
    researcher.ts     -- codebase.readOnly + run_command (read-only tools)
    coder.ts          -- codebase.all + run_command (read+write tools)
    tester.ts         -- codebase.readOnly + run_command (read+run tools)
    orchestrator.ts   -- integration.all + git.all + spawn_agent + codebase.readOnly
    product-agent.ts  -- integration.slack + integration.linear
    router.ts         -- workflow management tools
```

**Why per-agent toolkits:**
1. **Context window efficiency**: Each tool definition consumes tokens. Coder does not need Linear tools. Tester does not need write_file.
2. **Safety**: Researcher cannot write files. Tester cannot create PRs. Enforce at the tool level.
3. **Clarity**: When debugging, you can see exactly what tools an agent had access to.
4. **Anthropic's finding**: Performance degrades with > ~20 tools. Sub-agents should have 5-10 focused tools.

### 5.2 Tool Definition Interface

The spec's `ToolDefinition` interface is correct. Here is the refined version:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodSchema;  // Zod schema, converted to JSON Schema for Anthropic API
  execute: (input: unknown) => Promise<ToolResult>;
}

interface ToolResult {
  content: string;          // Text fed back to LLM
  isError?: boolean;        // LLM sees this as an error to reason about
  structuredData?: unknown; // Optional structured data for programmatic use
}
```

**Zod-to-Anthropic conversion:** The `@anthropic-ai/sdk` provides `betaZodTool` helper that converts Zod schemas to Anthropic's tool format automatically. This is the recommended approach -- no manual JSON Schema conversion needed.

### 5.3 Tool Registry Pattern

Each toolkit exports a function that creates tools with injected dependencies:

```typescript
// tools/base/codebase.ts
export function createCodebaseTools(deps: {
  manager: DevContainerManager;
  taskId: string;
}): ToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read the contents of a file in the repository",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repo root"),
      }),
      execute: async (input) => {
        const result = await deps.manager.execute(deps.taskId, {
          command: ["cat", input.path],
          workdir: "/workspace/repo",
          timeoutMs: 5000,
        });
        if (result.exitCode !== 0) {
          return { content: `Error: ${result.stderr}`, isError: true };
        }
        return { content: result.stdout };
      },
    },
    // ... more tools
  ];
}
```

```typescript
// tools/toolkits/researcher.ts
export function createResearcherToolkit(deps: CodebaseToolsDeps): ToolDefinition[] {
  const codebaseTools = createCodebaseTools(deps);
  // Researcher gets read-only tools only
  return codebaseTools.filter(t =>
    ["read_file", "search_codebase", "list_directory", "run_command"].includes(t.name)
  );
}
```

---

## 6. MCP-to-Tool-Definition Bridging

### 6.1 The Bridge Pattern

Aesir already has 21 MCP tools across 3 integration services. These need to become `ToolDefinition` objects that the LLM can invoke via native tool-use.

**The bridge is thin:** Each MCP tool already has a name and params. The bridge adds a Zod schema (for the LLM to understand the parameters) and an execute function (that calls `callMcpTool()`).

```typescript
// tools/base/integration.ts
function createMcpToolBridge(config: {
  integration: McpIntegration;
  tool: string;
  description: string;
  inputSchema: ZodSchema;
  agentId: string;
  correlationId: string;
}): ToolDefinition {
  return {
    name: `${config.integration}_${config.tool}`,  // e.g., "linear_get_issue"
    description: config.description,
    inputSchema: config.inputSchema,
    execute: async (input) => {
      try {
        const result = await callMcpTool({
          integration: config.integration,
          tool: config.tool,
          params: input as Record<string, unknown>,
          agentId: config.agentId,
          correlationId: config.correlationId,
        });
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: `MCP tool error: ${message}`, isError: true };
      }
    },
  };
}
```

### 6.2 Schema Definition Strategy

The MCP server-side tools already have schemas (used for input validation). However, these schemas are on the server side and not exposed to the agent client. The agent must define its own Zod schemas for each MCP tool.

**Two approaches:**

**Option A: Manual Zod schemas (Recommended for v2.2)**
Define Zod schemas in `tools/base/integration.ts` for each MCP tool. There are only 21 tools -- this is a manageable one-time effort.

```typescript
const getIssueSchema = z.object({
  issueId: z.string().describe("Linear issue ID or identifier (e.g., 'AES-42')"),
});

const createIssueSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().optional().describe("Issue description in markdown"),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
  labels: z.array(z.string()).optional(),
  teamId: z.string().describe("Linear team ID"),
});
```

**Option B: Auto-discovery from MCP servers**
Each MCP server already has `GET /mcp/tools` that lists available tools. Could fetch schemas at startup and convert to Zod. But this adds complexity and a startup dependency on all integration services being available.

**Recommendation: Option A.** The manual schemas give better descriptions (optimized for LLM understanding, not API validation). 21 tools is not a maintenance burden. Auto-discovery can be added later if the tool count grows significantly.

### 6.3 Tool Naming Convention

MCP tools are currently namespaced by integration endpoint (the agent specifies `integration: "linear"` and `tool: "get_issue"` separately). For the LLM, tools need unique flat names.

**Convention:** `{integration}_{tool_name}`

Examples:
- `linear_get_issue`, `linear_create_issue`, `linear_update_issue_status`
- `github_create_branch`, `github_create_commit`, `github_create_pull_request`
- `slack_send_message`, `slack_send_approval_request`

This avoids collisions and makes tool purpose clear to the LLM.

---

## 7. Database Schema for Agentic State

### 7.1 Schema Design

**Confidence: HIGH** (spec's schema is well-designed; recommendations are refinements)

The spec proposes three tables in an `agents` schema. Here is the refined design with rationale for each decision:

#### agents.tasks (critical structured data)

```sql
CREATE SCHEMA IF NOT EXISTS agents;

CREATE TABLE agents.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL UNIQUE,              -- Linear issue ID (e.g., UUID)
  issue_identifier TEXT,                     -- Human-readable (e.g., "AES-42")
  agent_type TEXT NOT NULL,                  -- "dev" or "product"
  workflow_id TEXT,                          -- Temporal workflow ID (e.g., "dev-agent-{uuid}")
  status TEXT NOT NULL DEFAULT 'pending',    -- pending|researching|planning|approved|executing|in_review|complete|failed|escalated

  -- Container & branch (exact, not LLM-summarized)
  container_id TEXT,
  branch_name TEXT,

  -- PR info (exact)
  pr_number INTEGER,
  pr_url TEXT,

  -- Approval (exact)
  approval_status TEXT DEFAULT 'pending',    -- pending|approved|rejected
  approval_feedback TEXT,

  -- Error tracking
  error TEXT,
  escalation_reason TEXT,

  -- Slack context (for message updates)
  slack_channel TEXT,
  slack_message_ts TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_task_id ON agents.tasks(task_id);
CREATE INDEX idx_tasks_workflow_id ON agents.tasks(workflow_id);
CREATE INDEX idx_tasks_status ON agents.tasks(status);
```

**Rationale:** This table holds data that must be exact. PR number 47 is always 47 -- it should never be LLM-summarized. The orchestrator updates this table directly when it creates a branch, opens a PR, etc. This is similar to the existing workflow state but persisted to a proper schema instead of Temporal's opaque event history.

#### agents.context_snapshots (semantic context)

```sql
CREATE TABLE agents.context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL REFERENCES agents.tasks(task_id),
  workflow_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,                  -- "dev-orchestrator", "product", "researcher"
  stage TEXT NOT NULL,                       -- "post-research", "post-plan", "post-execution", "post-feedback"

  -- LLM-generated semantic context
  summary TEXT NOT NULL,                     -- Natural language summary of work done
  completed_actions JSONB DEFAULT '[]',      -- Array of action descriptions
  pending_intent TEXT,                       -- What agent planned to do next
  known_issues JSONB DEFAULT '[]',           -- Problems encountered
  project_context JSONB DEFAULT '{}',        -- { packageManager, testRunner, framework, conventions }
  key_files JSONB DEFAULT '[]',              -- Array of { path, relevance }
  research_findings JSONB,                   -- Structured research output (if applicable)
  plan JSONB,                                -- Execution plan (if applicable)

  -- Usage metrics
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  token_count JSONB DEFAULT '{}',            -- { input, output }
  duration_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_context_snapshots_task ON agents.context_snapshots(task_id);
CREATE INDEX idx_context_snapshots_workflow ON agents.context_snapshots(workflow_id);
CREATE INDEX idx_context_snapshots_stage ON agents.context_snapshots(task_id, stage);
```

**Refinement from spec:** Added `duration_ms` for performance tracking. Removed `updated_at` because snapshots are immutable -- you create a new one, you do not update an existing one.

#### agents.execution_traces (observability)

```sql
CREATE TABLE agents.execution_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,                  -- "dev-orchestrator", "researcher", "coder", "tester"
  agent_instance_id TEXT NOT NULL,           -- UUID per agent invocation
  parent_agent_instance_id TEXT,             -- NULL for orchestrator, set for sub-agents

  step_number INTEGER NOT NULL,              -- Sequential within agent instance
  type TEXT NOT NULL,                        -- "tool_call" | "tool_result" | "llm_request" | "llm_response" | "agent_spawn" | "agent_complete"

  -- Tool details
  tool_name TEXT,                            -- NULL for LLM responses
  input JSONB,                               -- Tool params or LLM messages
  output JSONB,                              -- Tool result or LLM response

  -- Cost tracking
  token_count_input INTEGER,
  token_count_output INTEGER,
  duration_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_execution_traces_task ON agents.execution_traces(task_id);
CREATE INDEX idx_execution_traces_instance ON agents.execution_traces(agent_instance_id);
CREATE INDEX idx_execution_traces_parent ON agents.execution_traces(parent_agent_instance_id);

-- Partitioning recommendation for production (traces grow fast):
-- Consider partitioning by created_at (monthly) if table grows beyond 10M rows
```

**Refinement from spec:** Added `parent_agent_instance_id` index for querying sub-agent trees. Added partitioning recommendation note.

### 7.2 Relationship to Existing Schemas

The new `agents` schema sits alongside existing schemas:

```
PostgreSQL Database
  |-- platform.*           (workspaces, config)
  |-- integrations.*       (legacy shared)
  |-- observability.*      (agent_executions - keep for backward compatibility)
  |-- linear.*             (credentials, webhooks, MCP permissions)
  |-- github.*             (credentials, webhooks, MCP permissions)
  |-- slack.*              (credentials, events, MCP permissions)
  |-- agents.*             (NEW: tasks, context_snapshots, execution_traces)
```

**Migration consideration:** The existing `observability.agent_executions` table tracks lifecycle events (started, completed, failed). This overlaps with `agents.tasks.status`. Options:
1. Keep both: `observability` for backward compat, `agents` for new features
2. Migrate: Move `agent_executions` queries to use `agents.tasks`

**Recommendation:** Keep `observability.agent_executions` for now, write to both during transition. Deprecate after v2.2 stabilizes.

### 7.3 Drizzle ORM Integration

All existing Aesir schemas use Drizzle ORM. The new tables should follow the same pattern:

```typescript
// packages/agents/src/db/schema.ts (new file)
import { pgSchema, text, integer, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

export const agentsSchema = pgSchema("agents");

export const tasks = agentsSchema.table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: text("task_id").notNull().unique(),
  // ... etc
});
```

---

## 8. Migration Path: LangGraph to Agentic Loops

### 8.1 Coexistence Strategy

**Confidence: MEDIUM** (no direct precedents found for LangGraph -> native migration; based on general incremental migration principles)

LangGraph and agentic loops CAN coexist during migration. The key insight: **Temporal activities are the isolation boundary.** Each activity is a black box -- it can run LangGraph or an agentic loop. The Temporal workflow does not care.

**Migration order:**

```
Phase 1: Build runAgentLoop() runtime + tool definitions
  [LangGraph still running for both agents]

Phase 2: Replace dev agent activities with agentic loop activities
  [Product agent still on LangGraph]

Phase 3: Replace product agent activities with agentic loop
  [Both agents on agentic loops]

Phase 4: Remove LangGraph dependencies
  [Clean break]
```

### 8.2 Incremental Migration Steps

**Step 1: Build the new runtime alongside the old one**
- Add `@anthropic-ai/sdk` to dependencies (keep `@langchain/*` temporarily)
- Build `runAgentLoop()` in a new directory: `packages/agents/src/shared/agent-loop/`
- Build tool definitions in `packages/agents/src/shared/tools/`
- Test independently with a minimal agent

**Step 2: Create new activity functions**
- Create `runOrchestratorPreApproval()` that calls `runAgentLoop()` instead of `graph.invoke()`
- Keep the same return type as the existing activity (same `RunDevAgentGraphOutput` interface)
- Worker registers both old and new activities

**Step 3: Swap the Temporal workflow to use new activities**
- Update `dev-agent-workflow.ts` to call new activities
- Keep old activities available for rollback
- Feature flag or environment variable to switch

**Step 4: Product agent migration**
- Same pattern: new activity function, swap in workflow

**Step 5: Remove LangGraph**
- Delete `workflow/graph.ts`, `workflow/nodes/`, `workflow/state.ts`, `code-workflow/`
- Remove `@langchain/*` from `package.json`
- Remove `PostgresSaver` initialization from `worker.ts`

### 8.3 Rollback Strategy

If the agentic loop produces worse results than LangGraph:
1. The Temporal workflow can be updated to call the old activity functions
2. LangGraph code is still in the codebase until Step 5
3. Feature flag in worker.ts: `USE_AGENTIC_LOOP=true/false`
4. Running workflows complete with their current activity (no in-flight breakage)

### 8.4 What Breaks During Migration

**Nothing breaks if you follow the activity boundary.** The Temporal workflow does not change shape -- it still calls activities and waits for signals. The activities just run different code internally.

**Potential issues:**
1. **Different return shapes:** If new activities return different data than old ones, the workflow needs updating. Mitigate: keep the same `RunDevAgentGraphOutput` interface initially, evolve later.
2. **State format mismatch:** LangGraph checkpoints are in a different format than context snapshots. Solution: during migration, write to both (LangGraph checkpoints for old code, context snapshots for new).
3. **Observability gaps:** Existing LangGraph tracing (`shared/tracing/`) will not trace the new loop. Solution: build tracing into `runAgentLoop()` from day one via `onToolCall`/`onResponse` callbacks.

---

## 9. Spec Validation and Gaps

### 9.1 What the Spec Gets Right

1. **Temporal integration approach:** Keeping Temporal for orchestration, signals, timeouts. Running agentic loops inside activities. This matches the production pattern.

2. **Sub-agent as in-process:** `spawn_agent` as a nested function call with fresh context is the right choice for short-lived focused agents.

3. **Context snapshot design:** Separating critical structured data (tasks table) from semantic context (snapshots table) is sound.

4. **Tool library design:** MCP wrapping, codebase tools via DevContainerManager, per-agent tool sets -- all correct.

5. **Guardrails:** Iteration limits, token budgets, sandbox enforcement -- necessary and well-specified.

6. **Migration plan:** Phased replacement of agents, keeping infrastructure stable.

### 9.2 Gaps and Risks in the Spec

#### Gap 1: Smart Router as Single Point of Failure

**Risk: MEDIUM**

The spec replaces hardcoded event routing with an LLM-based smart router. Every incoming webhook triggers an LLM call to decide routing. This adds:
- Latency: 1-3 seconds per event (LLM inference)
- Cost: Every webhook = LLM tokens
- Failure mode: If the router LLM call fails, no events get routed

**Recommendation:** Implement the smart router as a hybrid:
- **Fast path (deterministic):** Well-known event types with clear routing (e.g., `slack.block_actions.approved` always goes to dev agent approval signal) handled by code, no LLM.
- **Slow path (LLM):** Ambiguous events (e.g., `linear.comment.created` -- is this approval, guidance, or just a comment?) go through LLM classification.

This preserves the current reliability for common paths while adding LLM reasoning for ambiguous cases. The existing `classifyApprovalIntent()` already uses this pattern -- it is LLM-based classification for comment interpretation.

#### Gap 2: Context Snapshot Generation Inside the Agentic Loop

**Risk: LOW-MEDIUM**

The spec says context is written "at the end of each Temporal activity." But how? The agentic loop needs to generate a summary of its own work. Options:

1. **LLM self-summary (recommended):** Before the loop exits, add one final LLM call: "Summarize what you accomplished, what you found, and what comes next." This produces the context snapshot.
2. **Programmatic extraction:** Parse the trace to extract key facts. Cheaper but lower quality.
3. **Both:** Use programmatic extraction for structured fields (tool call count, files changed) and LLM summary for semantic fields.

**Recommendation:** Option 3. The `runAgentLoop()` function should have a `summarize` phase at the end that:
- Counts tool calls and tokens (programmatic)
- Extracts structured data from tool results (programmatic)
- Asks the LLM to produce a natural language summary (one final call)

#### Gap 3: Token Budget Tracking Across Sub-Agents

**Risk: LOW**

The spec mentions `maxTokenBudget` but does not specify how it is shared across orchestrator and sub-agents within a single activity.

**Recommendation:** Use a shared mutable counter:

```typescript
class TokenBudget {
  private remaining: number;
  constructor(total: number) { this.remaining = total; }
  consume(tokens: number): boolean {
    this.remaining -= tokens;
    return this.remaining > 0;
  }
  get isExhausted(): boolean { return this.remaining <= 0; }
}
```

Pass this into `runAgentLoop()` options. The loop checks before each LLM call. Sub-agents receive the same budget object, so orchestrator + all sub-agents share one pool.

#### Gap 4: Re-Plan Loop in Temporal Workflow

**Risk: LOW**

The current workflow has a complex re-plan loop (reject -> re-plan -> re-approve) with nested `wf.condition()` calls and a TODO about "full re-planning loops needing recursion or a while loop." The spec simplifies this by folding re-planning into the orchestrator loop, but does not specify how the Temporal workflow handles multiple rejection cycles.

**Recommendation:** Simplify the workflow to use a `while` loop:

```typescript
// Simplified approval loop
let approved = false;
while (!approved) {
  const result = await runOrchestratorPreApproval({ ... });
  // Wait for approval
  await wf.condition(() => state.approval !== null, TIMEOUT);
  if (state.approval?.approved) {
    approved = true;
  } else {
    // Reset, next iteration re-runs pre-approval with feedback
    state.approval = null;
  }
}
```

This is cleaner than the current nested conditional approach.

#### Gap 5: Product Agent Conversation History

**Risk: LOW**

The product agent currently uses LangGraph's `PostgresSaver` checkpointer for multi-turn conversation history (thread_id = Slack thread timestamp). The spec replaces this with context snapshots, but the product agent needs turn-by-turn conversation state, not just end-of-activity summaries.

**Recommendation:** For the product agent, store the full conversation in the Temporal workflow's local state (it is already there as `currentMessage` in the loop). The agentic loop for each turn starts fresh with the latest user message + a context summary of prior turns. This is sufficient because:
- Product conversations are short (< 20 turns)
- Each turn is independent: user message -> agent response
- Context summary captures "we discussed X, user confirmed Y"

#### Gap 6: Anthropic SDK `betaZodTool` is Beta

**Risk: LOW**

The `betaZodTool` helper in `@anthropic-ai/sdk` is currently under a `beta` import path. This means the API may change.

**Recommendation:** Use `betaZodTool` for now (it significantly simplifies tool definition). Wrap it in a thin adapter so that if the API changes, only the adapter needs updating. The underlying concept (Zod -> JSON Schema -> Anthropic tool format) is stable even if the helper API changes.

---

## 10. Recommended Build Order

Based on dependency analysis, here is the recommended build order with rationale:

### Phase 1: Agentic Loop Runtime + SDK Migration (Foundation)

**Build:** `runAgentLoop()`, Anthropic SDK integration, tool definition interface, tracing callbacks

**Why first:** Everything depends on this. Cannot build tools without the runtime. Cannot build agents without tools working in the loop.

**Dependencies:** None (greenfield)

**Key files:**
- `packages/agents/src/shared/agent-loop/runtime.ts` (new)
- `packages/agents/src/shared/agent-loop/types.ts` (new)
- `packages/agents/src/shared/agent-loop/tracing.ts` (new)

**Validation:** Minimal test agent that reads files and answers questions.

### Phase 2: Database Schema + Context Management

**Build:** Drizzle schema definitions, migrations, context read/write functions

**Why second:** Tools and agents need somewhere to write traces and context. Building this early means all subsequent phases can use it.

**Dependencies:** Phase 1 (types from runtime)

**Key files:**
- `packages/agents/src/db/schema.ts` (new)
- `packages/agents/src/db/migrations/001_agents_schema.sql` (new)
- `packages/agents/src/shared/agent-loop/context.ts` (new)

### Phase 3: Tool Library

**Build:** All tool definitions -- codebase tools, MCP bridges, git tools, spawn_agent

**Why third:** Depends on runtime (Phase 1) for types. Depends on DB (Phase 2) for traces.

**Dependencies:** Phase 1, Phase 2

**Key files:**
- `packages/agents/src/shared/tools/codebase.ts` (new)
- `packages/agents/src/shared/tools/integration.ts` (new)
- `packages/agents/src/shared/tools/git.ts` (new)
- `packages/agents/src/shared/tools/coordination.ts` (new -- spawn_agent)
- `packages/agents/src/shared/tools/toolkits/*.ts` (new -- per-agent sets)

**Validation:** Each tool independently tested. MCP bridges tested against running integration services.

### Phase 4: Dev Agent Orchestrator

**Build:** Orchestrator system prompts, sub-agent configs, new Temporal activities, workflow update

**Why fourth:** This is the largest and most complex agent. Depends on all prior phases.

**Dependencies:** Phase 1, 2, 3

**Key files:**
- `packages/agents/src/dev-agent/orchestrator/prompts.ts` (new)
- `packages/agents/src/dev-agent/orchestrator/sub-agents.ts` (new)
- `packages/agents/src/shared/temporal/activities/dev-agent-activities.ts` (modified)
- `packages/agents/src/shared/temporal/workflows/dev-agent-workflow.ts` (modified)
- `packages/agents/src/dev-agent/worker.ts` (modified)

**Validation:** Full issue -> research -> plan -> approval -> execute -> PR flow.

### Phase 5: Product Agent

**Build:** Product agent agentic loop, new activity, workflow simplification

**Why fifth:** Smaller agent, benefits from patterns established in Phase 4.

**Dependencies:** Phase 1, 2, 3

**Key files:**
- `packages/agents/src/product-agent/agent/prompts.ts` (new)
- `packages/agents/src/shared/temporal/activities/product-agent-activity.ts` (modified)
- `packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts` (modified)

**Validation:** Slack message -> clarification -> issue creation.

### Phase 6: Smart Router

**Build:** LLM-based event classification, hybrid fast/slow path, workflow management tools

**Why sixth:** Can be built after agents work. Current hardcoded routing works in the interim.

**Dependencies:** Phase 1, Phase 4 (needs working dev agent to route to)

**Key files:**
- `packages/agents/src/shared/router/router.ts` (new)
- `packages/agents/src/shared/router/tools.ts` (new)
- `packages/agents/src/dev-agent/api/events.ts` (modified to use router)
- `packages/agents/src/product-agent/api/events.ts` (modified to use router)

### Phase 7: Guardrails, Cleanup, Hardening

**Build:** Cost tracking, escalation policies, LangGraph removal, dependency cleanup

**Why last:** Polish phase. All functionality works. Remove old code, add safety features.

**Dependencies:** All prior phases

**Key actions:**
- Delete `workflow/graph.ts`, `workflow/nodes/`, `workflow/state.ts`, `code-workflow/`
- Remove `@langchain/*` from package.json
- Remove `PostgresSaver` initialization
- Add cost budget enforcement
- Add escalation policies
- E2E validation

### Phase 8: End-to-End Validation

**Build:** Full flow testing, regression testing, performance baselines

---

## 11. Sources and Confidence Assessment

### Sources Used

| Source | Type | Confidence | Used For |
|--------|------|------------|----------|
| Codebase analysis (all files read) | Primary | HIGH | Current architecture understanding |
| v2.2 spec (2.2-spec.md) | Primary | HIGH | Target architecture |
| [Temporal: Dynamic AI Agents](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal) | Official blog | HIGH | Activity boundary pattern |
| [Temporal AI Cookbook: Agentic Loop](https://docs.temporal.io/ai-cookbook/agentic-loop-tool-call-openai-python) | Official docs | HIGH | Tool-use loop in Temporal |
| [Anthropic Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system) | Official blog | HIGH | Sub-agent spawning, context boundaries |
| [Anthropic SDK TypeScript](https://github.com/anthropics/anthropic-sdk-typescript) | Official repo | HIGH | betaZodTool, tool runner |
| [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript) | Official repo | MEDIUM | Agent SDK patterns (separate from base SDK) |
| [Temporal: OpenAI Agents SDK Integration](https://temporal.io/blog/announcing-openai-agents-sdk-integration) | Official blog | MEDIUM | Patterns (OpenAI-specific but applicable) |
| [Google ADK Multi-Agent Docs](https://google.github.io/adk-docs/agents/multi-agents/) | Official docs | MEDIUM | Sub-agent patterns |
| [OpenAI Agents SDK Multi-Agent](https://openai.github.io/openai-agents-python/multi_agent/) | Official docs | MEDIUM | Multi-agent orchestration |
| Various WebSearch results | Community | LOW | Ecosystem survey, validation |

### Confidence Assessment

| Area | Confidence | Reason |
|------|-----------|--------|
| Temporal + agentic loop integration | HIGH | Temporal's official docs explicitly describe this pattern. Codex uses it in production. |
| Sub-agent spawning (in-process) | HIGH | Anthropic's own multi-agent system uses this pattern. Multiple frameworks converge on it. |
| Context boundary design | MEDIUM-HIGH | Logical extension of Temporal activity boundaries. No contradicting sources, but specific to Aesir's needs. |
| Tool definition architecture | HIGH | `@anthropic-ai/sdk` betaZodTool is documented. Per-agent toolkits are standard practice. |
| MCP-to-tool bridging | HIGH | Direct application of existing `callMcpTool()` with Zod wrapper. Straightforward. |
| Database schema | MEDIUM | Schema design is standard PostgreSQL. No direct precedent for this exact structure, but follows established patterns. |
| Migration path | MEDIUM | Activity boundary isolation is the key enabler. No direct LangGraph-to-native migration references found, but the pattern is sound. |
| Smart router hybrid approach | MEDIUM | Recommendation based on risk analysis, not external precedent. |

### Open Questions

1. **Anthropic SDK tool runner vs. manual loop:** The SDK provides `toolRunner()` that automates the loop. Should Aesir use it or implement a manual loop? Manual gives more control (token tracking, custom tracing, abort). Recommend manual loop with the SDK as the LLM client only.

2. **Context window management for long tasks:** What happens when a sub-agent's conversation history exceeds the context window? The SDK supports automatic compaction (summarizing history when tokens exceed threshold). Need to evaluate if this is needed for Aesir's use case (sub-agents are typically < 50 iterations, unlikely to exceed 200K context).

3. **Streaming vs. non-streaming LLM calls:** The spec does not mention streaming. For long-running tool calls, streaming provides earlier feedback. But it adds complexity. Recommend non-streaming for v2.2, add streaming later for UX improvements.

4. **Smart router: when should it be LLM-based vs. deterministic?** The spec proposes fully LLM-based. Research suggests hybrid is safer. Need to define the exact boundary during Phase 6 implementation.
