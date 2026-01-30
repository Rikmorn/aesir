# Phase 31: Dev Agent Orchestrator - Research

**Researched:** 2026-01-30
**Domain:** LLM-first orchestrator with static system prompts, sub-agent delegation, error recovery, and tool-based context bootstrapping
**Confidence:** HIGH

## Summary

Researched how to build the dev agent orchestrator that replaces the 13-node LangGraph graph (`graph.ts`, `routeByPhase()`, `DevAgentPhaseSchema`) with an agentic loop where the LLM makes all control flow decisions. This is the centerpiece of v2.2: the orchestrator receives an issue ID, uses tools to discover everything it needs, reasons about task complexity, delegates to sub-agents (researcher, coder, tester), handles errors with distinct recovery approaches, and produces a plan (pre-approval) or a PR (post-approval).

The infrastructure is fully built: `runAgentLoop()` (Phase 28), context snapshots and trace recording (Phase 29), and the complete tool library with toolkit factories (Phase 30). Phase 31's sole contribution is the system prompts (orchestrator + sub-agents), the orchestrator entry point function that wires everything together, and the tests proving adaptive behavior. No new libraries, no new infrastructure -- only prompt engineering, integration code, and behavioral tests.

Key findings from Anthropic's official guidance: (1) Static system prompts work well for orchestrators when tools provide dynamic context -- Claude 4.5 models are exceptionally good at discovering state from the filesystem and tools. (2) Sub-agent delegation requires detailed task descriptions with objectives, output format, and clear boundaries -- vague instructions cause duplicated work. (3) Error recovery should be guided by prompt instructions that require analyzing the error before retrying, not by code-level retry logic. (4) Effort should scale to task complexity, which the prompt should explicitly instruct. (5) The orchestrator should save state to external memory (context snapshots) before context transitions.

**Primary recommendation:** Write four static system prompts (orchestrator, researcher, coder, tester) following Anthropic's structured contract format with XML-tagged sections. The orchestrator prompt is the most complex (~2000 words) and includes: identity, constraints, sub-agent guidance with delegation heuristics, error recovery protocol, and escalation rules. The entry point function wires `createOrchestratorToolkit()` + system prompt + `runAgentLoop()` with a simple initial message containing the issue ID.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.72.0 | LLM calls via `runAgentLoop()` | Already installed, Phase 28 |
| `zod` | 3.25.67 | Input validation for any new schemas | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aesir/platform` | workspace | DevContainerManager, PinoLogger | Container operations, logging |
| `@aesir/types` | workspace | `createId` for agent instance IDs | ID generation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static system prompts | Dynamic prompt assembly | User decision: static prompts. Dynamic adds code maintenance surface. Tools provide dynamic context. |
| Natural language sub-agent briefs | Structured JSON briefs | Natural language is more flexible for LLM consumption. JSON is more parseable but the sub-agent doesn't need to parse it -- it reads it. Recommend: natural language with structured sections. |
| LLM-only complexity assessment | Heuristic pre-classifier | User decision: LLM-only. No hardcoded classifiers. |

### Installation
```bash
# No new packages needed. All dependencies already installed from Phases 28-30.
```

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
  dev-agent/
    orchestrator/
      system-prompts.ts       # Static system prompts for all 4 agent types
      orchestrator.ts         # runDevAgentOrchestrator() entry point
      orchestrator.test.ts    # Behavioral tests for adaptive decisions
      index.ts                # Barrel export
```

### Pattern 1: Static System Prompts with XML Sections
**What:** Each agent type gets a single fixed string system prompt using XML-tagged sections for structure. No template interpolation, no dynamic assembly.
**When to use:** All four agent types (orchestrator, researcher, coder, tester).
**Why:** User decision (locked). Anthropic's official guidance confirms Claude 4.5 models are "extremely effective at discovering state from the local filesystem" and tools. GSD agents in this codebase use the same pattern successfully.

```typescript
// Source: Anthropic Claude 4 best practices + codebase GSD agents pattern
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are a dev agent orchestrator that implements Linear issues by writing code, running tests, and creating pull requests.

<identity>
You are part of the Aesir platform. You receive issue IDs and produce working code changes as pull requests. You reason about what to do -- you do not follow a fixed sequence of steps.
</identity>

<constraints>
- All code execution happens inside a sandboxed dev container. You cannot access the host.
- You must get human approval before creating a PR (use request_human_input).
- You cannot merge your own PRs.
- You share a token budget with your sub-agents. Be efficient.
</constraints>

<workflow_guidance>
Your first action should always be to read the issue details using get_issue (or linear_get_issue). Then decide your approach based on the task:

For simple tasks (typo fix, README update, config change):
- Read the relevant file(s) directly
- Make the change yourself or spawn a coder with a brief plan
- Skip research and detailed planning

For moderate tasks (add a function, update an endpoint, fix a bug):
- Spawn a researcher to explore relevant code
- Create a focused plan based on findings
- Spawn a coder to implement
- Spawn a tester to verify

For complex tasks (new feature, architectural change, multi-file refactor):
- Spawn a researcher for thorough codebase exploration
- Create a detailed plan with steps, files, and test strategy
- Get human approval before proceeding
- Spawn a coder for implementation
- Spawn a tester for comprehensive verification
- Create PR with detailed description

You decide the appropriate level of effort. There are no hardcoded rules -- use your judgment.
</workflow_guidance>

<sub_agent_delegation>
When spawning sub-agents, provide detailed briefs. Each sub-agent needs:
1. A clear objective (what to accomplish)
2. Relevant context (which files, what patterns to follow, what the plan says)
3. Expected output format (structured findings, code changes, test results)
4. Boundaries (what NOT to do, what to leave for you)

Bad brief: "Research the codebase"
Good brief: "Explore the authentication module in src/auth/. Find: (1) how tokens are currently validated, (2) where new validators should be added, (3) existing test patterns in auth.test.ts. Return a summary of findings with file paths and code snippets."

Sub-agents have their own fresh context windows. They cannot see your conversation history. Include everything they need in the brief.
</sub_agent_delegation>

<error_recovery>
When a sub-agent reports errors or test failures:
1. Read the error output carefully
2. Diagnose the root cause (wrong approach? missing dependency? code bug? environment issue?)
3. Try a DIFFERENT approach -- not the same thing again
4. Keep track of what you've tried

After 3 distinct failed approaches to the same problem, escalate to a human with:
- What you were trying to do
- What approaches you tried and why each failed
- Your best diagnosis of the underlying issue

Environment errors (ECONNREFUSED, permission denied, OOM) should be escalated immediately -- these cannot be fixed in code.
</error_recovery>

<available_tools>
Codebase (direct): read_file, search_codebase, list_directory
Delegation: spawn_agent (researcher, coder, tester)
Human: request_human_input (approval, clarification, escalation)
Linear: linear_get_issue, linear_update_issue_status
GitHub: github_create_branch, github_create_commit, github_create_pull_request, github_get_pull_request, github_merge_pull_request
Slack: slack_send_message, slack_send_approval_request

You do NOT have write_file or run_command directly. Delegate code changes to the coder sub-agent and test execution to the tester sub-agent.
</available_tools>`;
```

### Pattern 2: Orchestrator Entry Point Function
**What:** A function that composes toolkit + system prompt + `runAgentLoop()` into a callable unit for the Temporal activity.
**When to use:** Called by the Temporal activity (Phase 32) or standalone for testing.
**Why:** Keeps the orchestrator pure -- receives dependencies, returns result. Temporal integration is Phase 32's concern.

```typescript
// Source: Derived from Phase 28 runAgentLoop + Phase 30 toolkits
import { runAgentLoop } from "../../shared/agent-loop/run-agent-loop.js";
import { createTokenBudget } from "../../shared/agent-loop/token-budget.js";
import type { AgentLoopResult } from "../../shared/agent-loop/types.js";
import { createOrchestratorToolkit } from "../../shared/tools/toolkits.js";
import { createTraceRecorder } from "../../shared/db/trace-recorder.js";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./system-prompts.js";

export interface OrchestratorOptions {
  /** Issue ID (e.g., "AES-42") or full issue context */
  issueId: string;
  /** Optional title/description if available from triggering event */
  issueTitle?: string;
  issueDescription?: string;
  /** Container and runtime deps */
  containerManager: DevContainerManager;
  taskId: string;
  agentId: string;
  correlationId: string;
  workflowId: string;
  /** Database services */
  db: NodePgDatabase;
  logger: PinoLogger;
  /** Configuration overrides */
  maxIterations?: number;
  maxTokenBudget?: number;
  model?: string;
  /** Cancellation */
  abortSignal?: AbortSignal;
}

export async function runDevAgentOrchestrator(
  options: OrchestratorOptions,
): Promise<AgentLoopResult> {
  const tokenBudget = createTokenBudget(options.maxTokenBudget ?? 500_000);

  const traceRecorder = createTraceRecorder({
    db: options.db,
    logger: options.logger,
    taskId: options.taskId,
    workflowId: options.workflowId,
    agentType: "dev-orchestrator",
    agentInstanceId: createId.agentInstance(),
  });

  const toolkit = createOrchestratorToolkit({
    containerManager: options.containerManager,
    taskId: options.taskId,
    agentId: options.agentId,
    correlationId: options.correlationId,
    logger: options.logger,
    tokenBudget,
    abortSignal: options.abortSignal,
    traceRecorder,
  });

  // Build initial message -- minimal, tools provide the rest
  let initialMessage = `Implement issue ${options.issueId}.`;
  if (options.issueTitle) {
    initialMessage = `Implement issue ${options.issueId}: ${options.issueTitle}`;
  }

  const loopOptions = {
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    tools: toolkit,
    initialMessage,
    maxIterations: options.maxIterations ?? 100,
    tokenBudget,
    onToolCall: traceRecorder.onToolCall,
    onResponse: traceRecorder.onResponse,
    logger: options.logger.child({ component: "dev-orchestrator" }),
  };

  // Handle optional properties for exactOptionalPropertyTypes
  if (options.model !== undefined) {
    (loopOptions as Record<string, unknown>).model = options.model;
  }
  if (options.abortSignal !== undefined) {
    (loopOptions as Record<string, unknown>).abortSignal = options.abortSignal;
  }

  const result = await runAgentLoop(loopOptions);

  // Flush trace recorder
  await traceRecorder.flush();

  return result;
}
```

### Pattern 3: Sub-Agent System Prompts (Replacing Phase 30 Placeholders)
**What:** Detailed, focused system prompts for researcher, coder, and tester sub-agents. These replace the 1-line placeholders in `toolkits.ts`.
**When to use:** Phase 31 replaces the placeholder prompts with production-quality versions.
**Why:** Anthropic's guidance is clear: "Without detailed task descriptions, agents duplicate work, leave gaps, or fail to find necessary information."

```typescript
// Source: Anthropic multi-agent research system patterns + Claude 4 best practices
export const RESEARCHER_SYSTEM_PROMPT = `You are a code researcher. You explore codebases to understand architecture, patterns, and conventions.

<objective>
Analyze the codebase to answer the specific questions in your task brief. Your findings directly inform the implementation plan.
</objective>

<approach>
1. Start broad: list_directory at the repo root to understand structure
2. Search for patterns: search_codebase for relevant code
3. Read key files: read_file for the specific files that matter
4. Run exploratory commands if needed: run_command for grep, find, wc
5. Synthesize: summarize findings with file paths and code snippets
</approach>

<output_format>
Structure your findings as:
- RELEVANT FILES: paths and their purposes
- PATTERNS TO FOLLOW: coding conventions observed in the codebase
- DEPENDENCIES: packages or modules involved
- RISKS: potential issues or concerns
- UNKNOWNS: things you could not determine
</output_format>

<constraints>
- You have read-only intent. Do not modify files.
- Focus on what the orchestrator asked you to research. Do not go on tangents.
- Include specific file paths and code snippets, not vague descriptions.
- If you cannot find something, say so explicitly rather than guessing.
</constraints>`;

export const CODER_SYSTEM_PROMPT = `You are a code implementer. You write and modify code according to the plan provided in your task brief.

<objective>
Implement the code changes described in your task. Follow existing codebase patterns exactly.
</objective>

<approach>
1. Read the plan and understand what changes are needed
2. Read existing files that will be modified to understand current patterns
3. Implement changes using write_file
4. Run builds/lints to catch errors: run_command with the project's build tooling
5. Fix any issues found
</approach>

<code_quality>
- Follow patterns from existing code -- do not invent new approaches
- Use proper TypeScript types (no 'any' unless existing code uses it)
- Add JSDoc for public APIs
- Include error handling matching project patterns
- Respect exactOptionalPropertyTypes (do not assign undefined to optional properties)
</code_quality>

<constraints>
- Only make changes described in the plan. Do not refactor unrelated code.
- If the plan is unclear about something, implement your best interpretation and note it.
- Run the build after changes to catch compile errors.
- If you encounter a problem you cannot solve, report it clearly in your output.
</constraints>`;

export const TESTER_SYSTEM_PROMPT = `You are a test runner and failure diagnostician. You execute tests and analyze results.

<objective>
Run the specified tests and report results. If tests fail, diagnose the root cause.
</objective>

<approach>
1. Run the test command specified in your task brief
2. If tests pass, report success with a summary
3. If tests fail, analyze the error output:
   a. Read the failing test file to understand what it expects
   b. Read the implementation file to understand what it does
   c. Search for related patterns to understand conventions
4. Provide a clear diagnosis
</approach>

<diagnosis_categories>
- CODE BUG: Implementation does not match expected behavior (describe what's wrong)
- TEST BUG: Test expectations are incorrect (describe why)
- TYPE ERROR: TypeScript type mismatch (show the types involved)
- MISSING DEPENDENCY: Package not installed or import path wrong
- ENVIRONMENT ISSUE: Cannot be fixed in code (network, permissions, OOM) -- flag for escalation
</diagnosis_categories>

<output_format>
Report:
- TEST RESULT: pass/fail with counts
- If failed: DIAGNOSIS with category, root cause, and suggested fix
- CHANGED FILES: list any files that were modified during test analysis
</output_format>

<constraints>
- You can read files and run commands but should NOT write fixes unless explicitly asked.
- Focus on accurate diagnosis. A wrong diagnosis wastes the coder's time.
- If you see an environment issue, say so immediately -- do not try to fix it.
</constraints>`;
```

### Pattern 4: Adaptive Behavior via Prompt (Not Code)
**What:** The orchestrator adapts its approach based on the LLM's reasoning about the task, guided by prompt instructions. No `if/else` complexity classifiers in code.
**When to use:** Always -- this is the core architectural principle of v2.2.
**Why:** User decision (locked): "The overriding principle is to leverage the LLM." The prompt provides heuristics; the LLM applies judgment.

The orchestrator's `<workflow_guidance>` section provides effort-scaling heuristics:
- Simple tasks: skip research, brief plan, minimal testing
- Moderate tasks: researcher + coder + tester
- Complex tasks: thorough research, detailed plan, approval, implementation, comprehensive testing

The LLM reads the issue and decides. No code evaluates complexity.

### Pattern 5: Error Recovery Protocol in Prompt
**What:** The system prompt instructs the orchestrator to analyze errors, try distinct approaches, and escalate after 3 failures.
**When to use:** Whenever a sub-agent returns errors or test failures.
**Why:** DEVO-11, DEVO-13 requirements. The LLM must diagnose and vary its approach, not blindly retry.

Key prompt instructions:
1. "Read the error output carefully" -- forces analysis before action
2. "Diagnose the root cause" -- categories: wrong approach, missing dep, code bug, environment
3. "Try a DIFFERENT approach" -- explicitly prevents identical retries
4. "Keep track of what you've tried" -- provides LLM memory of previous attempts
5. "After 3 distinct failed approaches, escalate" -- the LLM counts, not the code

The orchestrator's conversation history naturally tracks previous attempts. The LLM sees its own prior tool calls and their results, so "keep track" is implicit in the conversation context.

### Pattern 6: Tools-Only Context Bootstrapping
**What:** The system prompt contains NO issue details or repo info. The initial message contains only the issue ID. Everything else is discovered via tools.
**When to use:** Always -- user decision (locked).
**Why:** Removes coupling between activity setup code and orchestrator behavior. The same loop works for any task.

```typescript
// The initial message is deliberately minimal
const initialMessage = `Implement issue ${issueId}.`;

// The system prompt instructs:
// "Your first action should always be to read the issue details using get_issue"
// The LLM then discovers everything it needs via tools
```

### Anti-Patterns to Avoid
- **Dynamic prompt assembly:** Do NOT build system prompts from templates with `${variable}` interpolation. The system prompt is a fixed string. Dynamic context comes from tools.
- **Heuristic complexity classifiers:** Do NOT write `if (title.includes("README")) skipResearch()`. The LLM decides based on its reading of the issue.
- **Fixed phase sequences:** Do NOT encode research-plan-execute-test as a mandatory sequence. The orchestrator reasons about what steps are needed.
- **Identical retries:** Do NOT loop `for (let i = 0; i < 3; i++) { runSameApproach() }`. The LLM must diagnose and vary.
- **Pre-loading context into prompts:** Do NOT read the issue in the activity and inject it into the system prompt. Let the orchestrator use `get_issue` itself.
- **Aggressive tool-use language in prompts:** Per Anthropic's Claude 4 guidance, Claude Opus 4.5 is more responsive to system prompts. Use "Use this tool when..." not "CRITICAL: You MUST use this tool."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Complexity classification | Heuristic classifier / regex matcher | LLM reasoning in the prompt | User decision: LLM-first. Hardcoded rules become maintenance burden. |
| Sub-agent spawning | Custom subprocess management | `spawn_agent` tool via `runAgentLoop()` | Phase 30 built this. Recursive loop with shared TokenBudget. |
| Error diagnosis | Pattern-matching on error strings | LLM reading error output via prompt guidance | The LLM is better at diagnosis than regex patterns. |
| Plan generation | Template-based plan builder | LLM reasoning with structured output | The orchestrator produces plans as part of its natural reasoning. |
| Retry logic with backoff | Code-level retry counter | Prompt-guided "try different approach" | DEVO-13 requires distinct approaches, not identical retries. |
| Token budget management | Custom cost tracker | `TokenBudget` from Phase 28 | Shared mutable object, already built and tested. |
| Trace recording | Custom logging | `createTraceRecorder()` from Phase 29 | Buffered writes, parent/child correlation, already built. |
| Toolkit composition | Ad-hoc tool array building | `createOrchestratorToolkit()` from Phase 30 | Tested, correct tool counts, proper filtering. |

**Key insight:** Phase 31 builds almost no infrastructure. It writes prompts, creates an entry point function, and tests behavioral outcomes. The infrastructure is 100% built in Phases 28-30.

## Common Pitfalls

### Pitfall 1: Over-Specifying the System Prompt
**What goes wrong:** System prompt becomes so detailed that the LLM follows it rigidly instead of reasoning adaptively.
**Why it happens:** Temptation to encode every possible scenario as an explicit instruction.
**How to avoid:** Provide heuristics and principles, not exhaustive rules. "For simple tasks, you can skip research" is better than "If the title contains 'fix typo' or 'update README' or 'change config', skip the research phase."
**Warning signs:** Orchestrator follows the same sequence for every task regardless of complexity.

### Pitfall 2: Vague Sub-Agent Briefs
**What goes wrong:** Sub-agent produces irrelevant output, wastes tokens, or duplicates work the orchestrator already did.
**Why it happens:** Orchestrator sends "Research the auth module" instead of a detailed brief with specific questions, file references, and expected output format.
**How to avoid:** The `<sub_agent_delegation>` section of the system prompt provides explicit good/bad examples. Include objective, context, output format, and boundaries in every brief.
**Warning signs:** Sub-agent returns generic exploration instead of answering specific questions.

### Pitfall 3: LLM Not Stopping After request_human_input
**What goes wrong:** Orchestrator calls `request_human_input` but then continues making tool calls.
**Why it happens:** The LLM decides to do more work despite the instruction to stop.
**How to avoid:** The `request_human_input` tool description says "IMPORTANT: After calling this tool, you MUST immediately end your turn." The Temporal activity wrapper (Phase 32) should also check for the `HUMAN_INPUT_MARKER` in the loop result regardless of LLM behavior.
**Warning signs:** Tool calls appear after `request_human_input` in execution traces.

### Pitfall 4: Context Window Overflow in Long Orchestrator Sessions
**What goes wrong:** Orchestrator hits `model_context_window_exceeded` after many tool calls and sub-agent spawns.
**Why it happens:** Each tool call adds input + result to the conversation. Sub-agent outputs can be large.
**How to avoid:** (1) Set `maxIterations` to 100 (spec default). (2) Sub-agents have lower limits (30/40/20). (3) Tool output is already truncated (100KB stdout, 50KB stderr per Phase 30). (4) Monitor via token budget. (5) Consider adding a prompt instruction about efficiency: "Be concise in tool calls. Read specific files, not entire directories."
**Warning signs:** `tokenCount.input` growing rapidly; `status: "max_tokens"` results.

### Pitfall 5: Error Recovery Becomes Identical Retries
**What goes wrong:** The orchestrator sees a test failure, spawns the coder with the same instructions, gets the same failure, repeats.
**Why it happens:** The LLM doesn't sufficiently vary its approach without explicit guidance.
**How to avoid:** The `<error_recovery>` section explicitly says "Try a DIFFERENT approach -- not the same thing again" and "Keep track of what you've tried." The orchestrator's conversation history shows previous attempts, making the LLM aware of what didn't work.
**Warning signs:** Execution traces show identical spawn_agent calls with the same task briefs.

### Pitfall 6: Orchestrator Doing Sub-Agent Work
**What goes wrong:** The orchestrator reads files, writes code, and runs tests directly instead of delegating.
**Why it happens:** The orchestrator has `read_file`, `search_codebase`, and `list_directory` tools for quick inspection. The LLM decides it's faster to do the work itself.
**How to avoid:** (1) The orchestrator does NOT have `write_file` or `run_command`. (2) The prompt says "Delegate code changes to the coder sub-agent and test execution to the tester sub-agent." (3) The orchestrator's codebase tools are for understanding, not implementation.
**Warning signs:** No `spawn_agent` calls in traces for tasks that should have used sub-agents.

### Pitfall 7: exactOptionalPropertyTypes Build Failures
**What goes wrong:** TypeScript build fails when assigning `undefined` to optional properties.
**Why it happens:** The project has `exactOptionalPropertyTypes: true`. Must use mutable-then-conditional-set pattern.
**How to avoid:** Use the pattern established in Phases 28-30: build object, then `if (value !== undefined) { obj.prop = value; }`.
**Warning signs:** TypeScript errors about `undefined` not being assignable.

## Code Examples

### Complete Orchestrator Entry Point
```typescript
// Source: Derived from Phase 28 runAgentLoop + Phase 30 toolkits + Phase 29 tracing
import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import { runAgentLoop } from "../../shared/agent-loop/run-agent-loop.js";
import { createTokenBudget } from "../../shared/agent-loop/token-budget.js";
import type {
  AgentLoopOptions,
  AgentLoopResult,
} from "../../shared/agent-loop/types.js";
import { createTraceRecorder } from "../../shared/db/trace-recorder.js";
import { createOrchestratorToolkit } from "../../shared/tools/toolkits.js";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./system-prompts.js";

export interface OrchestratorOptions {
  issueId: string;
  issueTitle?: string;
  containerManager: DevContainerManager;
  taskId: string;
  agentId: string;
  correlationId: string;
  workflowId: string;
  db: unknown; // NodePgDatabase - typed at call site
  logger: PinoLogger;
  maxIterations?: number;
  maxTokenBudget?: number;
  model?: string;
  abortSignal?: AbortSignal;
}

export async function runDevAgentOrchestrator(
  options: OrchestratorOptions,
): Promise<AgentLoopResult> {
  const tokenBudget = createTokenBudget(options.maxTokenBudget ?? 500_000);
  const agentInstanceId = createId.agentInstance();

  const traceRecorder = createTraceRecorder({
    db: options.db,
    logger: options.logger,
    taskId: options.taskId,
    workflowId: options.workflowId,
    agentType: "dev-orchestrator",
    agentInstanceId,
  });

  const toolkit = createOrchestratorToolkit({
    containerManager: options.containerManager,
    taskId: options.taskId,
    agentId: options.agentId,
    correlationId: options.correlationId,
    logger: options.logger,
    tokenBudget,
    traceRecorder,
    // abortSignal handled below for exactOptionalPropertyTypes
  });

  // Build initial message
  let initialMessage = `Implement issue ${options.issueId}.`;
  if (options.issueTitle) {
    initialMessage += ` Title: "${options.issueTitle}"`;
  }

  // Build loop options with mutable-then-conditional-set
  const loopOptions: AgentLoopOptions = {
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    tools: toolkit,
    initialMessage,
    maxIterations: options.maxIterations ?? 100,
    tokenBudget,
    onToolCall: traceRecorder.onToolCall,
    onResponse: traceRecorder.onResponse,
    logger: options.logger.child({
      component: "dev-orchestrator",
      agentInstanceId,
    }),
  };
  if (options.model !== undefined) {
    loopOptions.model = options.model;
  }
  if (options.abortSignal !== undefined) {
    loopOptions.abortSignal = options.abortSignal;
  }

  try {
    const result = await runAgentLoop(loopOptions);
    await traceRecorder.flush();
    return result;
  } catch (error) {
    await traceRecorder.flush();
    throw error;
  }
}
```

### Updating toolkits.ts to Use New Prompts
```typescript
// Source: Phase 30 toolkits.ts with Phase 31 prompt replacements
// Replace the 1-line placeholder prompts with imports from system-prompts.ts

import {
  RESEARCHER_SYSTEM_PROMPT,
  CODER_SYSTEM_PROMPT,
  TESTER_SYSTEM_PROMPT,
} from "../../dev-agent/orchestrator/system-prompts.js";

// In createOrchestratorToolkit(), update subAgentConfigs:
const subAgentConfigs: Record<string, AgentTypeConfig> = {
  researcher: {
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
    tools: createResearcherToolkit(deps),
    maxIterations: 30,
  },
  coder: {
    systemPrompt: CODER_SYSTEM_PROMPT,
    tools: createCoderToolkit(deps),
    maxIterations: 40,
  },
  tester: {
    systemPrompt: TESTER_SYSTEM_PROMPT,
    tools: createTesterToolkit(deps),
    maxIterations: 20,
  },
};
```

### Behavioral Test Pattern
```typescript
// Source: Testing adaptive behavior via mocked LLM responses
import { describe, it, expect, vi } from "vitest";

describe("DevAgentOrchestrator", () => {
  describe("adaptive behavior", () => {
    it("skips research for simple README edit", async () => {
      // Mock: LLM reads issue, sees "Update README", skips spawn_agent(researcher)
      // Verify: no researcher spawn in trace, coder spawned directly
    });

    it("spawns researcher for complex feature", async () => {
      // Mock: LLM reads issue, sees "Implement OAuth2 flow"
      // Verify: researcher spawned before coder
    });

    it("tries different approach after test failure", async () => {
      // Mock: first coder attempt fails tests, LLM spawns coder with different brief
      // Verify: second spawn_agent call has different task content
    });

    it("escalates after 3 distinct failures", async () => {
      // Mock: three different coder approaches all fail
      // Verify: request_human_input called with escalation type
    });
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 13-node LangGraph StateGraph | Single `runAgentLoop()` with LLM reasoning | v2.2 Phase 31 | LLM decides flow, not hardcoded graph |
| `routeByPhase()` switch statement | LLM tool selection | v2.2 Phase 31 | No phase enum, no routing logic |
| `DevAgentPhaseSchema` (16 phases) | No phases -- orchestrator reasons about state | v2.2 Phase 31 | State is in conversation context + context snapshots |
| `DevAgentState` (16 Zod fields) | `AgentLoopResult` + context snapshots | v2.2 Phase 31 | Simpler state, semantic context |
| Per-node LLM prompts (research, plan, execute) | 4 static system prompts | v2.2 Phase 31 | Fixed prompts, dynamic context via tools |
| Fixed research-plan-execute sequence | Adaptive based on task complexity | v2.2 Phase 31 | Simple tasks skip steps |
| `testAttempts` counter for retry limit | LLM tracks approaches in conversation | v2.2 Phase 31 | Distinct approaches, not identical retries |

**Deprecated/outdated (to remove in Phase 31):**
- `packages/agents/src/dev-agent/workflow/graph.ts` -- entire file replaced
- `packages/agents/src/dev-agent/workflow/state.ts` -- `DevAgentPhaseSchema`, `DevAgentStateAnnotation`
- `packages/agents/src/dev-agent/workflow/prompts.ts` -- per-phase prompts replaced by static system prompts
- `packages/agents/src/dev-agent/workflow/nodes/` -- all 13 node files
- `routeByPhase()` -- the central routing function

**Note:** Removal of old code is important but should be validated to not break imports from other packages. The `workflow/` directory should be preserved temporarily if Phase 32 (Temporal) needs the old Temporal workflow wrapper files. Check for imports before deleting.

## Open Questions

1. **Context snapshot integration at orchestrator boundaries**
   - What we know: Phase 29 built `createContextManager()` with `writeSnapshot()` and `readLatestSnapshot()`. The orchestrator should write a snapshot when it finishes (pre-approval or post-approval).
   - What's unclear: Should the snapshot write happen inside `runDevAgentOrchestrator()` or in the Temporal activity that calls it? The user decision says "context snapshots are read via tools, not injected into system prompts by activity code." This implies the orchestrator reads its own snapshots via tools.
   - Recommendation: Phase 31 focuses on the orchestrator logic. Context snapshot writes at activity boundaries belong to Phase 32 (Temporal integration). The orchestrator CAN read snapshots if it has a `read_context_snapshot` tool, but Phase 30 did not build that tool. Defer snapshot read/write integration to Phase 32. Phase 31 ensures the orchestrator output contains enough information for Phase 32 to write a snapshot.

2. **How the orchestrator reads its own previous context (post-approval resumption)**
   - What we know: After approval, a new Temporal activity starts. The orchestrator needs to know what it researched and planned.
   - What's unclear: Does the post-approval orchestrator get its context via: (a) a `read_context_snapshot` tool, (b) injection into the initial message by the Temporal activity, or (c) re-discovery via tools?
   - Recommendation: For Phase 31, design the orchestrator to work standalone (no snapshot dependency). Phase 32 will decide the context injection strategy. The orchestrator prompt should work whether context comes via tools or initial message.

3. **Sub-agent prompt location -- in toolkits.ts or in dev-agent/orchestrator/**
   - What we know: Phase 30 put placeholder prompts in `toolkits.ts`. The detailed prompts are agent-specific.
   - What's unclear: Should the detailed prompts live in `toolkits.ts` (shared) or in `dev-agent/orchestrator/system-prompts.ts` (agent-specific)?
   - Recommendation: Put all 4 prompts in `dev-agent/orchestrator/system-prompts.ts`. Update `toolkits.ts` to import them OR have the orchestrator entry point pass prompts to toolkit construction. The product agent (Phase 33) will have its own prompts. Sub-agent prompts may differ per orchestrator type.

4. **Whether to expose issue context in the initial message beyond the ID**
   - What we know: The user decision says "The initial message contains the issue ID (and optionally title/description if already available from the triggering event)."
   - What's unclear: How much pre-fetched context to include. Including title saves one tool call. Including full description saves more but couples the activity to the issue format.
   - Recommendation: Include `issueId` always, `issueTitle` if available (it often is from the webhook payload). Do NOT include the full description -- let the orchestrator fetch it via `get_issue`. This saves ~100 tokens on the initial message and keeps the orchestrator self-sufficient.

5. **Testing strategy for behavioral assertions**
   - What we know: Phase 31 must prove adaptive behavior (DEVO-09, DEVO-10, DEVO-12). This requires testing that the orchestrator makes different decisions for different inputs.
   - What's unclear: How to mock the LLM to produce controlled sequences of tool calls. The `runAgentLoop()` calls `client.messages.create()` which needs mocking.
   - Recommendation: Mock `@anthropic-ai/sdk` to return pre-scripted responses. The test creates a mock that returns `tool_use` blocks for expected tool calls. This is a standard pattern for testing LLM-driven code. Phase 28's test suite already mocks the Anthropic client -- follow that pattern.

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis (Phases 28-30 implementation code, all verified via Phase verification docs):
  - `packages/agents/src/shared/agent-loop/run-agent-loop.ts` -- core loop
  - `packages/agents/src/shared/agent-loop/types.ts` -- type definitions
  - `packages/agents/src/shared/tools/toolkits.ts` -- toolkit factories with placeholder prompts
  - `packages/agents/src/shared/tools/coordination/spawn-agent.ts` -- sub-agent spawning
  - `packages/agents/src/shared/tools/coordination/request-human-input.ts` -- human input sentinel
  - `packages/agents/src/shared/db/context-manager.ts` -- context snapshot service
  - `packages/agents/src/shared/db/trace-recorder.ts` -- trace recording callbacks
  - `packages/agents/src/dev-agent/workflow/graph.ts` -- existing 13-node graph (being replaced)
  - `packages/agents/src/dev-agent/workflow/state.ts` -- existing state schema (being replaced)
  - `packages/agents/src/dev-agent/workflow/prompts.ts` -- existing per-phase prompts (being replaced)
- [Anthropic Claude 4 Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices) -- official prompt engineering guidance for Claude 4.x models
- v2.2 spec (`2.2-spec.md`) sections 4 (Dev Agent Orchestrator), 6 (Context Management), 8 (Guardrails)

### Secondary (MEDIUM confidence)
- [Anthropic Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system) -- delegation patterns, task specificity, effort scaling, memory persistence
- [Anthropic Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) -- orchestrator-worker pattern, when to use it, error recovery

### Tertiary (LOW confidence)
- Optimal system prompt length and structure -- recommendations based on Anthropic guidance and engineering judgment, not A/B tested
- Error recovery effectiveness -- the prompt-guided "try different approach" pattern is theoretically sound but unvalidated for this specific domain

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, everything already installed and tested
- Architecture: HIGH -- follows exact patterns from Phases 28-30, user decisions are clear
- System prompts: MEDIUM -- content follows Anthropic's official guidance and matches existing codebase patterns (GSD agents), but prompt effectiveness requires runtime validation
- Error recovery: MEDIUM -- prompt-guided approach is sound (Anthropic recommends it) but specific wording needs tuning via E2E testing (Phase 36)
- Testing strategy: HIGH -- mock-based behavioral testing follows Phase 28's test patterns
- Pitfalls: HIGH -- derived from actual code reading and Anthropic's documented anti-patterns

**Research date:** 2026-01-30
**Valid until:** 2026-03-01 (30 days -- stable domain, no library changes expected)
