# Phase 5: Dev Agent - Research

**Researched:** 2026-01-16
**Domain:** Agentic Coding Workflow Orchestration (Test-Driven Iteration Loop)
**Confidence:** HIGH

<research_summary>
## Summary

Researched established patterns for agentic coding assistants that implement task-to-code workflows with test feedback loops. Phase 5 builds on the foundation from Phases 1-4 (LangGraph agent, sandbox, Linear, GitHub) to orchestrate a complete Dev Agent workflow.

Key finding: The Dev Agent is fundamentally a **Generator-Critic loop** with the test suite as the critic. The established pattern is: generate code → execute tests → interpret results → iterate until pass. Modern agentic coding tools (Claude Code, Cursor, GitHub Copilot Agent Mode) all follow this "agentic loop" pattern.

For multi-file output, use LangGraph's structured output approach: define a Zod schema for `FileChange[]` and use a formatting node to ensure consistent output. The sandbox already has `writeFile` and `runTests`—the agent just needs to produce structured file changes.

**Primary recommendation:** Implement a Generator-Critic loop where code generation produces structured `FileChange[]` output, tests serve as the critic, and the loop continues until tests pass or iteration limit is reached. Use existing LangGraph patterns from Phase 1.
</research_summary>

<standard_stack>
## Standard Stack

Phase 5 uses the stack already established in Phases 1-4:

### Core (Already Implemented)
| Library | Version | Purpose | Phase |
|---------|---------|---------|-------|
| @langchain/langgraph | 1.1.0 | Agent orchestration, ReAct loop | Phase 1 |
| @langchain/anthropic | latest | Claude LLM for code generation | Phase 1 |
| zod | 3.25.67 | Schema validation for structured output | Phase 1 |

### Integrations (Already Implemented)
| Component | Purpose | Phase |
|-----------|---------|-------|
| Sandbox (Docker) | File ops, test execution | Phase 2 |
| Linear Client | Read tasks, update status, emit activities | Phase 3 |
| GitHub Client | Create branches, commits, PRs | Phase 4 |

### New for Phase 5
| Pattern | Purpose | How |
|---------|---------|-----|
| Structured FileChange output | Multi-file code generation | Zod schema + formatting node |
| Generator-Critic loop | Test-driven iteration | State-based loop with test feedback |
| Workflow orchestration | Task → Code → Test → PR | Custom StateGraph (not just ReAct) |

**No new dependencies needed.** Phase 5 is orchestration of existing components.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended: Generator-Critic Loop with Test Feedback

The Dev Agent follows the established "agentic loop" pattern from modern coding assistants:

```
┌────────────────────────────────────────────────────────────────┐
│                        Dev Agent Workflow                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐ │
│  │ Linear  │───▶│  Branch   │───▶│ Generate │───▶│  Write   │ │
│  │  Task   │    │  Create   │    │   Code   │    │  Files   │ │
│  └─────────┘    └───────────┘    └───────────┘    └──────────┘ │
│                                        ▲               │        │
│                                        │               ▼        │
│                                   ┌────┴────┐    ┌──────────┐  │
│                                   │  Parse  │◀───│   Run    │  │
│                                   │ Errors  │    │  Tests   │  │
│                                   └─────────┘    └──────────┘  │
│                                        │               │        │
│                                        │          pass │        │
│                                        │               ▼        │
│                                   ┌─────────┐    ┌──────────┐  │
│                                   │  Loop   │    │  Commit  │  │
│                                   │  Limit? │    │    PR    │  │
│                                   └─────────┘    └──────────┘  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Pattern 1: Structured FileChange Output

**What:** Code generation returns an array of file changes, not a single string
**When to use:** Always for multi-file operations
**Example:**
```typescript
// FileChange schema for structured output
const FileChangeSchema = z.object({
  path: z.string().describe("Relative file path from project root"),
  content: z.string().describe("Complete file content"),
  operation: z.enum(["create", "update", "delete"]).describe("File operation type"),
});

const CodeGenerationOutputSchema = z.object({
  files: z.array(FileChangeSchema).describe("Files to create or modify"),
  reasoning: z.string().describe("Explanation of the implementation approach"),
});

type CodeGenerationOutput = z.infer<typeof CodeGenerationOutputSchema>;
```

### Pattern 2: Test Feedback Loop (Generator-Critic)

**What:** Run tests, parse failures, feed back to generator
**When to use:** Core iteration pattern for test-driven development
**Example:**
```typescript
// State for test feedback loop
const DevAgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (x, y) => x.concat(y) }),
  task: Annotation<LinearTask>({ reducer: (_, y) => y }),
  files: Annotation<FileChange[]>({ reducer: (_, y) => y }),
  testResult: Annotation<TestResult | null>({ reducer: (_, y) => y }),
  iterationCount: Annotation<number>({ reducer: (_, y) => y, default: () => 0 }),
  status: Annotation<"coding" | "testing" | "fixing" | "complete" | "failed">({
    reducer: (_, y) => y,
    default: () => "coding",
  }),
});

// Conditional routing based on test result
function routeAfterTest(state: DevAgentState): "fix_code" | "commit" | "fail" {
  if (state.testResult?.passed) return "commit";
  if (state.iterationCount >= MAX_FIX_ITERATIONS) return "fail";
  return "fix_code";
}
```

### Pattern 3: LLM-Based Error Interpretation

**What:** Use LLM to parse test failures and generate targeted fixes
**When to use:** When test errors need interpretation
**Example:**
```typescript
// Prompt for fixing code based on test feedback
const fixPrompt = `
The tests failed with the following output:

stdout:
${testResult.stdout}

stderr:
${testResult.stderr}

The current files are:
${files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

Analyze the test failure and generate corrected file contents.
Focus on fixing the specific error without unnecessary changes.
`;
```

### Pattern 4: Workflow as Custom StateGraph

**What:** Full workflow is a StateGraph, not just ReAct
**When to use:** When workflow has distinct phases (task pickup → coding → testing → PR)
**Why:** ReAct is for tool-calling agents; Dev Agent needs workflow orchestration
**Example:**
```typescript
const workflow = new StateGraph(DevAgentState)
  .addNode("pickup_task", pickupTaskNode)
  .addNode("create_branch", createBranchNode)
  .addNode("generate_code", generateCodeNode)
  .addNode("write_files", writeFilesNode)
  .addNode("run_tests", runTestsNode)
  .addNode("fix_code", fixCodeNode)
  .addNode("commit_and_pr", commitAndPRNode)
  .addEdge("__start__", "pickup_task")
  .addEdge("pickup_task", "create_branch")
  .addEdge("create_branch", "generate_code")
  .addEdge("generate_code", "write_files")
  .addEdge("write_files", "run_tests")
  .addConditionalEdges("run_tests", routeAfterTest)
  .addEdge("fix_code", "write_files")
  .addEdge("commit_and_pr", "__end__");
```

### Anti-Patterns to Avoid
- **ReAct for workflow orchestration:** ReAct is for "reason about which tool to call." Dev Agent workflow is deterministic—use StateGraph.
- **String concatenation for multi-file output:** Use structured Zod schema for reliable parsing.
- **Synchronous CI waiting:** For complex projects, consider async polling (not needed for MVP with fast unit tests).
- **No iteration limit on fix loop:** Always cap iterations to prevent runaway costs.
- **Retrying without context:** Each fix attempt should include previous failure context.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Phase 5 reuses existing components—nothing needs hand-rolling:

| Problem | Use Instead | Why |
|---------|-------------|-----|
| Agent loop | LangGraph StateGraph | State management, checkpointing, error handling |
| File operations | Sandbox.writeFile/readFile | Already implemented, Docker isolated |
| Test execution | Sandbox.runTests | Already returns TestResult with passed/stdout/stderr |
| Branch creation | GitHub.createBranch | Already implemented |
| Commit creation | GitHub.createCommit | Already handles multi-file via Git Data API |
| PR creation | GitHub.createPullRequest | Already implemented with body formatting |
| Task reading | Linear.readIssue | Already implemented |
| Status updates | Linear.updateIssueStatus | Already implemented |
| Activity logging | Linear.emitThought/emitAction | Already implemented |

**Key insight:** Phase 5 is pure orchestration. The building blocks exist—the challenge is wiring them together with proper state management and error handling.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Infinite Fix Loop
**What goes wrong:** Agent keeps trying to fix code that can't be fixed, burning tokens
**Why it happens:** No iteration cap, or cap set too high
**How to avoid:** Set MAX_FIX_ITERATIONS (recommend 3-5); exit with "failed" status if exceeded
**Warning signs:** Token costs spiraling on single task, long-running executions

### Pitfall 2: Lost Context on Fix Iterations
**What goes wrong:** Each fix attempt starts fresh, repeating same mistakes
**Why it happens:** Not including previous test failures in fix prompt
**How to avoid:** Accumulate test feedback in state; include in fix prompt
**Warning signs:** Agent makes same mistake repeatedly, oscillating between fixes

### Pitfall 3: Partial File Writes
**What goes wrong:** Agent writes some files, test fails, partial state in sandbox
**Why it happens:** Not treating file writes as atomic
**How to avoid:** Write all files before running tests; on failure, files remain for next iteration
**Warning signs:** Test failures don't match code; stale files in sandbox

### Pitfall 4: Overly Broad Code Generation
**What goes wrong:** Agent rewrites entire file to fix small test failure
**Why it happens:** Fix prompt not specific enough
**How to avoid:** Include specific error location; ask for minimal changes
**Warning signs:** Large diffs for small fixes, introducing new bugs

### Pitfall 5: Status Not Updated on Failure
**What goes wrong:** Linear task stuck in "In Progress" after agent fails
**Why it happens:** Error handling doesn't update Linear status
**How to avoid:** Always update Linear status in finally block or error handler
**Warning signs:** Tasks appear in progress but no agent activity

### Pitfall 6: Sandbox Not Cleaned Up
**What goes wrong:** Docker containers accumulate, resource exhaustion
**Why it happens:** Cleanup not called on error paths
**How to avoid:** Use try/finally pattern; call sandbox.cleanup() always
**Warning signs:** `docker ps -a` shows many stopped containers
</common_pitfalls>

<code_examples>
## Code Examples

### Dev Agent State Schema
```typescript
// Source: LangGraph patterns + Aesir conventions
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

// File change schema for structured output
export const FileChangeSchema = z.object({
  path: z.string(),
  content: z.string(),
  operation: z.enum(["create", "update", "delete"]),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

// Dev agent state
export const DevAgentState = Annotation.Root({
  // Messages for LLM context
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),

  // Task from Linear
  taskId: Annotation<string>({ reducer: (_, y) => y }),
  taskDescription: Annotation<string>({ reducer: (_, y) => y }),

  // GitHub context
  branchName: Annotation<string | null>({ reducer: (_, y) => y, default: () => null }),
  prNumber: Annotation<number | null>({ reducer: (_, y) => y, default: () => null }),

  // Generated files
  files: Annotation<FileChange[]>({ reducer: (_, y) => y, default: () => [] }),

  // Test feedback
  testResult: Annotation<TestResult | null>({ reducer: (_, y) => y, default: () => null }),
  testAttempts: Annotation<number>({ reducer: (_, y) => y, default: () => 0 }),

  // Workflow status
  status: Annotation<"pending" | "coding" | "testing" | "fixing" | "complete" | "failed">({
    reducer: (_, y) => y,
    default: () => "pending",
  }),
});
```

### Code Generation with Structured Output
```typescript
// Source: LangGraph structured output patterns
import { ChatAnthropic } from "@langchain/anthropic";

const llm = new ChatAnthropic({ model: "claude-sonnet-4-20250514" });

const CodeGenOutputSchema = z.object({
  files: z.array(FileChangeSchema),
  reasoning: z.string(),
});

async function generateCode(state: typeof DevAgentState.State) {
  const structuredLlm = llm.withStructuredOutput(CodeGenOutputSchema);

  const prompt = `
You are implementing a task for a TypeScript project.

Task: ${state.taskDescription}

Generate the files needed to implement this task.
Each file should be complete and ready to run.
Follow TypeScript best practices.
`;

  const result = await structuredLlm.invoke(prompt);
  return { files: result.files, status: "testing" as const };
}
```

### Test Feedback and Fix Loop
```typescript
// Source: Generator-Critic pattern
async function runTests(state: typeof DevAgentState.State) {
  // Write files to sandbox
  for (const file of state.files) {
    await sandbox.writeFile(file.path, file.content);
  }

  // Run tests
  const testResult = await sandbox.runTests(["npm", "test"]);

  return {
    testResult,
    testAttempts: state.testAttempts + 1,
    status: testResult.passed ? "complete" : "fixing",
  };
}

async function fixCode(state: typeof DevAgentState.State) {
  const structuredLlm = llm.withStructuredOutput(CodeGenOutputSchema);

  const prompt = `
The tests failed. Fix the code.

Task: ${state.taskDescription}

Test output:
${state.testResult?.stdout}
${state.testResult?.stderr}

Current files:
${state.files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n')}

Generate corrected files. Make minimal changes to fix the specific error.
`;

  const result = await structuredLlm.invoke(prompt);
  return { files: result.files, status: "testing" as const };
}
```

### Workflow Routing
```typescript
// Source: LangGraph conditional edges
const MAX_TEST_ATTEMPTS = 5;

function routeAfterTest(state: typeof DevAgentState.State): "fix" | "commit" | "fail" {
  if (state.testResult?.passed) return "commit";
  if (state.testAttempts >= MAX_TEST_ATTEMPTS) return "fail";
  return "fix";
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential test → fix | Parallel exploration branches | 2025 | Some agents explore multiple fix paths simultaneously |
| Sync CI waiting | Async CI polling | 2025 | Better for long test suites (not needed for MVP with fast unit tests) |
| ReAct for everything | Custom StateGraph for workflows | 2024-2025 | ReAct for tool selection; StateGraph for deterministic workflows |
| String output parsing | Structured output with Zod | 2024 | LLMs now reliably produce structured JSON |

**New patterns to consider (future phases):**
- **Judge agent for completion:** Separate agent validates if task is truly complete
- **Parallel fix exploration:** Run multiple fix attempts, pick best one
- **Async CI feedback:** Poll CI status instead of blocking (for long test suites)

**Not needed for MVP:**
- Async CI feedback (unit tests are fast)
- Parallel fix exploration (adds complexity)
- Judge agent (tests are the judge for now)
</sota_updates>

<open_questions>
## Open Questions

1. **Repository context for code generation**
   - What we know: Agent needs to understand existing code structure
   - What's unclear: How much context to provide (full files? summaries? just relevant parts?)
   - Recommendation: Start with task description only; add file context incrementally if needed

2. **Test command discovery**
   - What we know: Sandbox.runTests takes command array
   - What's unclear: How agent knows which test command to run
   - Recommendation: Configuration per project (package.json scripts, or explicit config)

3. **Multi-test-file handling**
   - What we know: Task may require multiple test files
   - What's unclear: Whether to run all tests or just relevant ones
   - Recommendation: Run all tests for MVP; optimize later with test selection

4. **PR review feedback loop**
   - What we know: GH-04 requires responding to PR feedback
   - What's unclear: When/how to re-enter workflow for PR comments
   - Recommendation: Handle as separate workflow trigger (webhook on PR comment)
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [LangGraph Structured Output How-To](https://langchain-ai.github.io/langgraph/how-tos/react-agent-structured-output/) - Forcing structured output from agents
- [Agentic Patterns - CI Feedback Loop](https://agentic-patterns.com/patterns/coding-agent-ci-feedback-loop/) - Established pattern for test-driven agent loops
- Phase 1 Research (01-RESEARCH.md) - LangGraph patterns, StateGraph, structured output

### Secondary (MEDIUM confidence)
- [The Agentic Engineering Loop](https://jarbon.medium.com/the-ai-engineering-loop-e4064f2e1c4c) - Industry perspective on agentic coding
- [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) - Generator-Critic pattern documentation
- [Double Loop Model for Agentic Coding](https://testdouble.com/insights/youre-holding-it-wrong-the-double-loop-model-for-agentic-coding) - Exploration vs refinement phases
- [State of Agent Engineering 2025](https://www.langchain.com/state-of-agent-engineering) - Industry trends and challenges

### Tertiary (LOW confidence - validate in implementation)
- Test iteration limits (3-5 recommended) - Community consensus, adjust based on task complexity
- Minimal fix changes guidance - Best practice but LLM compliance varies
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: LangGraph StateGraph workflow orchestration
- Ecosystem: Uses existing Phases 1-4 components (no new libraries)
- Patterns: Generator-Critic loop, structured output, test feedback
- Pitfalls: Iteration limits, context preservation, cleanup

**Confidence breakdown:**
- Standard stack: HIGH - uses existing implemented components
- Architecture: HIGH - established agentic coding patterns
- Pitfalls: HIGH - common issues in agentic systems
- Code examples: MEDIUM - patterns verified, specific implementation TBD in planning

**Research date:** 2026-01-16
**Valid until:** 2026-02-16 (30 days - patterns are stable)
</metadata>

---

*Phase: 05-dev-agent*
*Research completed: 2026-01-16*
*Ready for planning: yes*
