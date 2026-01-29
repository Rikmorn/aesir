# Pitfalls: Replacing LangGraph with Agentic Tool-Use Loops (v2.2)

**Domain:** LangGraph-to-agentic-loop migration in TypeScript agent platform
**Researched:** 2026-01-29
**Overall Confidence:** HIGH (based on Anthropic engineering docs, MAST taxonomy paper, Spotify production data, Aesir v2.1 codebase analysis)

This document is specific to Aesir v2.2 -- the "brain transplant" that replaces LangGraph fixed-node graphs with agentic tool-use loops via `@anthropic-ai/sdk`. It covers pitfalls at the intersection of the existing Temporal/MCP/container infrastructure and the new agentic architecture.

---

## Critical Pitfalls

Mistakes that cause architectural rewrites, data loss, or system-wide failures.

---

### Pitfall 1: Prompt Over-Specification Creates Brittleness Worse Than the Graph

**Severity:** Critical
**Phase to address:** Phase 3 (Dev Agent Orchestrator), Phase 4 (Product Agent)

**What goes wrong:**
Teams escaping rigid graph-based agents often recreate the rigidity inside system prompts. The v2.1 problem was a 16-phase enum with `routeByPhase()` switch statement. The v2.2 danger is a system prompt that says "First, research the codebase. Then create a plan. Then request approval. Then spawn a coder. Then spawn a tester..." -- encoding the same fixed pipeline in natural language. The agent dutifully follows the sequence even when it makes no sense (running tests on a README change, researching a trivial fix).

This is exactly the failure Anthropic identified: "At one extreme, we see engineers hardcoding complex, brittle logic in their prompts to elicit exact agentic behavior. This approach creates fragility and increases maintenance complexity over time." They call this finding the wrong "altitude" for prompts.

**Why it happens:**
The v2.1 code has 13 nodes with deeply embedded domain knowledge (detect package manager, check non-code extensions, run affected tests, commit atomically). When migrating, the instinct is to encode all these behaviors into the system prompt to ensure nothing is lost. This produces a 2000+ token prompt that is effectively a graph expressed in English.

**Warning signs:**
- System prompt reads like a step-by-step procedure rather than principles and goals
- Agent always follows the same sequence regardless of task complexity
- Simple tasks (README edits) still trigger all phases
- Prompt changes require extensive regression testing because behavior is tightly coupled to specific wording

**Prevention:**
- Follow Anthropic's guidance: "Provide principles over patterns." Tell the agent what good looks like, not how to get there step by step
- Structure prompts as: identity + goals + constraints + available tools + when-to-escalate. Let the model's reasoning decide the sequence
- Validate with the README-edit test: does a docs-only change trigger research, planning, approval, coder spawn, tester spawn? If yes, prompt is too prescriptive
- Start with the most constrained prompt and relax iteratively using execution traces to verify behavior
- Use the "think" tool (Anthropic recommendation) to let Claude reason about what to do next before acting, rather than encoding the reasoning in the prompt

**Sources:**
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (HIGH)
- [Anthropic: Claude 4 Best Practices](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices) (HIGH)

---

### Pitfall 2: Agentic Loop Never Terminates (Infinite Tool-Call Loops)

**Severity:** Critical
**Phase to address:** Phase 1 (Agentic Loop Runtime), Phase 7 (Guardrails)

**What goes wrong:**
The agent enters a loop where it repeatedly calls the same tool with the same or similar arguments, never making progress toward completion. Unlike the v2.1 execute node that retries identically 3 times (a known problem, lines 237-273 of `execute.ts`), the agentic loop can burn through 50+ iterations calling `run_command("pnpm test")` after each failed attempt, generating hundreds of thousands of tokens without any code changes between attempts.

Anthropic's own engineering team documented this with Haiku 4.5: "some models can enter a repetitive loop, calling the same tool for an action already completed. The model fails to correctly process the tool's output, update its internal plan, and move on." This was observed even with explicit feedback that the action was redundant.

Real-world data from the MAST taxonomy (NeurIPS 2025) found that "Step Repetition" accounts for 13.2% of all multi-agent system failures -- the second most common failure mode.

**Why it happens:**
- The LLM lacks working memory about what it has already tried. Each iteration sees the full history but may not reason about the pattern of repeated failures
- Tool results that are long or noisy (test output with hundreds of lines) push useful context out of the attention window
- The agent has no explicit "tried X, it failed, try Y instead" scaffolding -- reasoning about approach changes is implicit
- `stop_reason` handling may miss edge cases: `max_tokens` mid-tool-call, `pause_turn` from server tools, or `model_context_window_exceeded`

**Warning signs:**
- Same tool called 3+ times with identical or near-identical arguments
- Token usage climbing linearly without corresponding progress (no new files written, no status changes)
- Tool results growing repetitive (same error output)
- Agent "reasoning" text between tool calls becomes shorter or more repetitive

**Prevention:**
- **Hard iteration limit** in `runAgentLoop()`: default 50 for sub-agents, 100 for orchestrator, 10 for router (spec values are correct)
- **Duplicate detection**: Track last N tool calls. If same tool + same args appears 3+ times, inject a system message: "You have called {tool} with identical arguments {N} times. The result will not change. Either try a different approach or explain why you are stuck."
- **Cost budget enforcement**: Track cumulative input+output tokens. Abort with `max_tokens` status when budget exceeded
- **Handle ALL stop_reasons**: `end_turn`, `tool_use`, `max_tokens`, `pause_turn`, `refusal`, `model_context_window_exceeded`. Missing `pause_turn` caused a significant production bug in PydanticAI (GitHub issue #2600)
- **Tool result truncation**: Large tool outputs (test results, file contents) should be truncated to the last N lines or summarized before being fed back. Spotify found that "many of their verifiers use regular expressions to extract only the most relevant error messages on failure and return a very short success message otherwise"

**Sources:**
- [MAST: Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) (HIGH)
- [Anthropic: Handling Stop Reasons](https://docs.anthropic.com/en/api/handling-stop-reasons) (HIGH)
- [Spotify: Feedback Loops in Background Coding Agents](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) (HIGH)
- [PydanticAI pause_turn bug](https://github.com/pydantic/pydantic-ai/issues/2600) (HIGH)

---

### Pitfall 3: Context Window Exhaustion Degrades Agent Intelligence Mid-Task

**Severity:** Critical
**Phase to address:** Phase 1 (Agentic Loop Runtime), Phase 6 (Context Management)

**What goes wrong:**
Tool results accumulate in the conversation history. A coder sub-agent that reads 5 files (each ~200 lines), writes 3 files, and runs tests twice has generated ~50K tokens of tool results. The system prompt, task briefing, and reasoning add another ~10K tokens. At 60K tokens, the agent is approaching practical limits where the "lost in the middle" effect degrades reasoning quality -- the model over-weights the beginning (system prompt) and end (recent tool results) while under-weighting the middle (earlier research findings, plan details).

Anthropic explicitly warns: "even when content fits within the allowed token count, LLMs tend to weigh the beginning and end of the prompt more heavily, meaning important context placed in the middle may be undervalued by the model."

The v2.1 architecture avoided this entirely -- each LangGraph node got a fresh LLM call with only the relevant state fields. The node boundary naturally limited context. Removing nodes means losing this implicit context scoping.

**Why it happens:**
- The Anthropic API is stateless: every request requires the full conversation history
- Tool results (file contents, command output, search results) are verbose. JSON tool results are especially token-heavy
- Each iteration adds both the assistant's reasoning AND the tool result to the growing history
- No automatic pruning -- the developer must implement compaction/summarization

**Warning signs:**
- Agent starts making errors about things it correctly identified earlier (regression in reasoning)
- Agent re-reads files it already has in context (forgot it already read them)
- Later iterations produce lower-quality output than early iterations
- Token input count per iteration grows monotonically

**Prevention:**
- **Tool result clearing**: Once a tool result has been processed and the agent has acted on it, replace verbose results with summaries. Anthropic recommends: "once a tool has been called deep in the message history, why would the agent need to see the raw result again? One of the safest lightest touch forms of compaction is tool result clearing"
- **Priority-based context management**: System prompt and current task = always kept. Recent tool results = always kept. Older tool results = summarized or cleared. The JetBrains NeurIPS 2025 paper calls this "observation masking" -- reducing observation resolution while preserving action and reasoning history
- **Sub-agent architecture is the primary defense**: The orchestrator + sub-agent design in the v2.2 spec is inherently good for context management. Each sub-agent starts with a fresh context window containing only its focused brief. This is the "context isolation" pattern Anthropic found achieves "90.2% performance improvement" for parallelizable tasks
- **Monitor context occupancy**: Log percentage of context window used per iteration. Trigger compaction at 80-85% occupancy, hard stop at 95%
- **Keep tool results lean**: `read_file` results should be truncated for very large files. `run_command` results should capture only stderr + last N lines of stdout. `search_codebase` should limit to top N results

**Sources:**
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (HIGH)
- [JetBrains: Efficient Context Management (NeurIPS 2025)](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) (HIGH)
- [GetMaxim: Context Window Management Strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) (MEDIUM)

---

### Pitfall 4: Temporal Activity Replay with LLM Calls Creates Silent Failures

**Severity:** Critical
**Phase to address:** Phase 3 (Dev Agent Orchestrator), Phase 1 (Agentic Loop Runtime)

**What goes wrong:**
Temporal requires workflow code to be deterministic. LLM calls are inherently non-deterministic. The v2.1 architecture wraps the entire LangGraph execution in a single Temporal activity (`runDevAgentGraphActivity`), which is correct -- activities can be non-deterministic. But Temporal retries failed activities, and retrying an activity that contains an agentic loop means re-running the entire loop from scratch, potentially:

1. **Costing 2-3x tokens**: A 30-minute activity that burned 200K tokens gets retried, burning another 200K tokens, likely producing different results
2. **Side effects repeated**: If the agent already created a branch, wrote files, or sent Slack messages before the activity failed, the retry will attempt all of these again
3. **Different results on retry**: The LLM may take a completely different approach on retry, producing code that conflicts with partially-committed work from the first attempt

The v2.2 spec proposes 3 retries with 5s exponential backoff for activities (same as v2.1). For a 30-minute `runOrchestratorPostApproval` activity, this means up to 4 full executions of the agentic loop -- potentially 2 hours and 800K tokens for a single task.

**Why it happens:**
- The Temporal retry config is carried over from v2.1 where activities were simpler (single graph execution)
- LLM-based activities are not idempotent -- same inputs produce different outputs and different side effects
- Developers forget that Temporal records activity results in event history. On replay, stored results are used. But on retry (activity failure), the activity actually re-executes

**Warning signs:**
- Duplicate branches, commits, or PR comments in GitHub
- Duplicate Slack messages
- Token costs are 2-4x expected per task
- Temporal UI shows activity retries for agentic loop activities

**Prevention:**
- **Reduce retry count for LLM activities**: Set `maximumAttempts: 1` for agentic loop activities. If the loop fails, it should fail fast and surface the error rather than blindly retry. The orchestrator should decide whether to retry based on the error type
- **Idempotency guards on side effects**: Before creating a branch, check if it exists. Before sending a Slack message, check if one was already sent for this stage. Use the existing `IdempotencyChecker` from `@aesir/observability`
- **Checkpoint-and-resume pattern**: Persist context snapshots (as the v2.2 spec proposes) before each major side effect. On retry, read the last snapshot and resume from where the previous attempt left off, not from scratch
- **Separate LLM activities from side-effect activities**: Instead of one monolithic `runOrchestratorPostApproval` activity, consider: `runAgentLoop` (LLM reasoning, max 1 retry) + `createBranch` (idempotent, can retry) + `createPR` (idempotent, can retry). This gives Temporal granular retry control
- **Activity heartbeats**: Use Temporal heartbeats for long-running agentic loop activities to report progress and detect stuck activities earlier than the 30-minute timeout

**Sources:**
- [Temporal: Building Dynamic AI Agents](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal) (HIGH)
- [Temporal: Non-Determinism Documentation](https://docs.temporal.io/workflow-definition) (HIGH)
- [Temporal + OpenAI Integration](https://www.infoq.com/news/2025/09/temporal-aiagent/) (MEDIUM)

---

### Pitfall 5: Sub-Agent Context Briefing Is Lossy or Hallucinated

**Severity:** Critical
**Phase to address:** Phase 3 (Dev Agent Orchestrator), Phase 6 (Context Management)

**What goes wrong:**
The orchestrator spawns a sub-agent (researcher, coder, tester) with a briefing derived from its own reasoning. This briefing is the sub-agent's entire world -- it has no other context. If the orchestrator omits critical information, over-summarizes, or hallucinates details, the sub-agent operates on wrong assumptions.

Microsoft's Azure SRE Agent team documented exactly this failure: "results showed a bimodal distribution: when handoffs worked, everything worked; when they didn't, the agent got lost." They observed "a clear cliff -- problems requiring more than four handoffs almost always failed."

Anthropic/Cognition noted the sub-agent "lacks context from the main agent that would otherwise be needed to do anything beyond answering a well-defined question."

In Aesir specifically, the orchestrator must brief the coder with: the approved plan, relevant file contents, coding conventions, package manager, test runner. If any of these are wrong (e.g., orchestrator says "use npm" when the repo uses pnpm -- exactly the v2.1 bug), the coder will produce incorrect code.

**Why it happens:**
- The orchestrator generates briefs using LLM summarization, which is lossy by nature
- Critical structured data (branch name, package manager, file paths) gets embedded in natural language and may be distorted
- The orchestrator may hallucinate details it never actually verified (claiming a file exists that it never read)
- Context transfer happens via `spawn_agent` tool, which has no schema validation for brief quality

**Warning signs:**
- Sub-agents asking "clarifying" questions that the orchestrator already answered in its own reasoning
- Coder producing code that contradicts the plan
- Tester using wrong commands (npm instead of pnpm)
- Researcher exploring areas unrelated to the task

**Prevention:**
- **Structured briefs with validated fields**: The `spawn_agent` tool should accept a typed schema, not just a string. Include explicit fields: `{ task, plan, relevantFiles, packageManager, testRunner, conventions, constraints }`. Validate required fields before spawning
- **Include raw data, not just summaries**: Pass actual file contents (truncated) alongside summaries. The coder needs to see the real code, not the orchestrator's description of it
- **Sub-agent self-verification**: Each sub-agent's first action should be to verify its understanding. The coder should read the target file before modifying it. The tester should verify the package manager before running tests. Build this into sub-agent system prompts
- **Context snapshots for audit**: Write the exact brief given to each sub-agent into `agents.execution_traces`. This creates an audit trail for debugging "why did the coder do that?"
- **Separate structured data from semantic context**: Store branch name, PR number, package manager, etc. in `agents.tasks` (typed columns), not in JSONB summaries. The v2.2 spec already proposes this -- enforce it strictly

**Sources:**
- [Microsoft: Context Engineering for Azure SRE Agent](https://techcommunity.microsoft.com/blog/appsonazureblog/context-engineering-lessons-from-building-azure-sre-agent/4481200/) (HIGH)
- [MAST: Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) (HIGH)
- [Anthropic: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (HIGH)

---

## High Pitfalls

Mistakes that cause significant rework, delays, or degraded quality.

---

### Pitfall 6: Cost Explosion from Agentic Loops (10-100x Fixed Graph)

**Severity:** High
**Phase to address:** Phase 1 (Agentic Loop Runtime), Phase 7 (Guardrails)

**What goes wrong:**
The v2.1 fixed graph makes ~8 LLM calls per task (one per node). The v2.2 agentic loop could make 50-200+ calls per task: orchestrator (20-30 iterations) + researcher sub-agent (20-30) + coder sub-agent (30-50) + tester sub-agent (10-20). Each call sends the growing conversation history, so input tokens compound. A single task could consume 500K-1M tokens.

Real-world data: "although inference costs have come down, prototyping and working with agents can consume roughly 100x more tokens during inference." Anthropic's own data shows "agents use 4x more tokens than chat, and multi-agent systems use 15x more tokens."

One team's experience: "the first full-month invoice came in near $15k, the second $35k, and by month three it was touching $60k."

**Why it happens:**
- Agentic loops inherently require more LLM calls than fixed graphs -- each "decision" that was a switch statement is now an LLM call
- Context window growth means later iterations are more expensive (more input tokens per call)
- Sub-agent spawning multiplies costs: each sub-agent has its own conversation history
- No inherent cost pressure -- the agent does not "know" it is spending money

**Warning signs:**
- Average tokens-per-task exceeding budget (the spec suggests 500K default)
- Simple tasks consuming as many tokens as complex tasks
- Sub-agent token usage dominated by input tokens (context bloat)
- Monthly API cost growing faster than task volume

**Prevention:**
- **Token budget per task**: The spec's `maxTokenBudget` is essential. Track cumulative tokens across orchestrator + all sub-agents. Default 500K is reasonable for complex tasks but should be configurable
- **Token budget per sub-agent**: Don't let a single sub-agent consume the entire task budget. Allocate proportionally: researcher 20%, coder 40%, tester 20%, orchestrator overhead 20%
- **Model tiering**: Use Claude Sonnet (cheaper, fast) for sub-agents and the router. Reserve Claude Opus for complex orchestrator decisions only when needed. The spec currently defaults everything to `claude-sonnet-4-20250514` which is correct
- **Prompt caching**: The Anthropic SDK supports `cache_control: {"type": "ephemeral"}` for system prompts and tool definitions. Since these are identical across iterations of the same agent loop, caching them can reduce input token costs by 90% for the cached portion. This is a LangGraph-removal advantage -- LangChain's wrapper had bugs with `cache_control` (GitHub issue #33635)
- **Early task classification**: Before entering the full orchestrator loop, classify task complexity. README edits should take 5-10 tool calls, not 50. Use the router or a lightweight pre-check to set appropriate budgets
- **Cost dashboard**: Log tokens per iteration, per sub-agent, per task in `agents.execution_traces`. Build alerts for tasks exceeding 2x average cost

**Sources:**
- [Adaline Labs: Token Burnout](https://labs.adaline.ai/p/token-burnout-why-ai-costs-are-climbing) (MEDIUM)
- [FinOps in the Age of AI](https://www.finout.io/blog/finops-in-the-age-of-ai-a-cpos-guide-to-llm-workflows-rag-ai-agents-and-agentic-systems) (MEDIUM)
- [Traceloop: LLM Token Usage and Cost Per User](https://www.traceloop.com/blog/from-bills-to-budgets-how-to-track-llm-token-usage-and-cost-per-user) (MEDIUM)

---

### Pitfall 7: Smart Router LLM Overhead and Misclassification

**Severity:** High
**Phase to address:** Phase 5 (Smart Router)

**What goes wrong:**
The v2.1 event routing is a switch statement -- zero-cost, deterministic, never wrong for known event types. The v2.2 smart router routes every event through an LLM call. This introduces:

1. **Latency**: 500ms-2s per event for LLM classification vs. sub-millisecond switch
2. **Cost**: Every Slack message, every Linear webhook, every GitHub event triggers an LLM call, even when the routing is obvious
3. **Misclassification**: The LLM may route a `slack.block_actions.approved` event (approval button click) to the wrong workflow, or misinterpret a `linear.comment.created` event's intent. The v2.1 approval classifier already exists in `classification/approval.ts` and uses Claude -- but it only fires for ambiguous comment events, not for every single event

The MAST taxonomy found "Disobey Task Specification" (15.7%) as the single most common multi-agent failure -- when the router misclassifies, the downstream agent receives a task it cannot handle.

**Why it happens:**
- Over-engineering: not every routing decision benefits from LLM reasoning. `github.pull_request.merged` always means "signal the dev-agent workflow" -- there is no ambiguity
- LLM-based classification struggles with structured event payloads that have clear type fields
- Cost of routing is invisible (small per-event, large in aggregate)

**Warning signs:**
- Event processing latency increases 10-100x compared to v2.1
- LLM router costs exceed agent execution costs for simple workflows
- Events with unambiguous types (button clicks, webhook status changes) being processed by LLM
- Router occasionally routes events to wrong agents or drops events entirely

**Prevention:**
- **Hybrid router**: Use deterministic rules for unambiguous event types (button clicks, PR merge, PR close, direct @mention). Use LLM only for events that require interpretation (comment intent, ambiguous mentions, free-form text). This is the "cascading methods" pattern: "use a fast keyword/rule filter for obvious cases, semantic router next, and finally an LLM for catch-all"
- **Fallback to deterministic**: If LLM classification confidence is below threshold, fall back to rule-based routing. If no rule matches, ask for clarification rather than guessing
- **Precomputed event signatures**: Many events have a single valid routing. `slack.block_actions.approved` with `action_id: "approve_plan"` always signals approval. Map these deterministically
- **Budget the router separately**: The spec's `routerMaxIterations: 10` is correct but also add a cost cap. The router should never consume more than ~1K tokens per event
- **Log misclassifications**: Every routing decision goes into traces. Periodically review "what the router decided" vs. "what the correct routing was" to identify systematic errors

**Sources:**
- [Vellum: LLM Router Fallback Strategies](https://www.vellum.ai/blog/what-to-do-when-an-llm-request-fails) (MEDIUM)
- [Botpress: AI Agent Routing Guide](https://botpress.com/en/blog/ai-agent-routing) (MEDIUM)
- [Red Hat: LLM Semantic Router](https://developers.redhat.com/articles/2025/05/20/llm-semantic-router-intelligent-request-routing) (MEDIUM)

---

### Pitfall 8: LangGraph Removal Breaks In-Flight Workflows

**Severity:** High
**Phase to address:** Phase 3 (Dev Agent Orchestrator), Phase 6 (Context Management)

**What goes wrong:**
v2.1 has running Temporal workflows that reference LangGraph activities (`runDevAgentGraphActivity`, `continueAfterApprovalActivity`). Removing LangGraph code and replacing activities means:

1. **Running workflows fail**: A workflow waiting for `planApprovalSignal` will eventually try to call `continueAfterApprovalActivity` which no longer exists. Temporal will throw a non-deterministic error because the workflow code has changed while executions are in flight
2. **Checkpoint data is orphaned**: `@langchain/langgraph-checkpoint-postgres` stores serialized graph state in PostgreSQL. This data becomes orphaned when the dependency is removed. Not harmful but creates confusion
3. **Activity signatures change**: Even if you keep the same activity names, the input/output types change. Temporal detects this as non-deterministic code change

**Why it happens:**
- Temporal's determinism requirement means workflow code cannot change while executions are running
- The spec proposes replacing all activity implementations simultaneously, which means zero in-flight workflows can survive the transition
- PostgreSQL checkpoint tables have no migration path to the new `agents.context_snapshots` schema

**Warning signs:**
- Non-deterministic errors in Temporal UI after deployment
- Orphaned data in `langgraph_checkpoints` tables
- Workflows stuck in "running" state that never complete

**Prevention:**
- **Drain in-flight workflows before deploying v2.2**: Before deploying new code, ensure all running workflows have completed, timed out, or been terminated. This is a deployment procedure, not a code change
- **Version workflow definitions**: Use Temporal's workflow versioning (`wf.patched()` or task queue versioning) to run v2.1 and v2.2 workflows side-by-side during transition. New tasks go to v2.2, existing tasks continue on v2.1
- **Keep old activity implementations temporarily**: For the transition period, register both old and new activities on the worker. Old workflows call old activities, new workflows call new activities
- **Clean up checkpoint data**: Write a migration that drops or archives the LangGraph checkpoint tables after all v2.1 workflows are complete. Don't leave orphaned tables indefinitely
- **Plan the cutover**: This is an operational procedure, not just a code deployment. Document it: (1) stop accepting new tasks, (2) wait for in-flight completion, (3) deploy v2.2, (4) resume accepting tasks

**Sources:**
- [Temporal: Workflow Determinism](https://docs.temporal.io/workflow-definition) (HIGH)
- [Temporal: Non-Determinism Explanation](https://community.temporal.io/t/why-cant-workflows-contain-non-deterministic-code-and-how-does-using-activity-solve-the-problem/3231) (HIGH)

---

### Pitfall 9: Testing Agentic Loops with Unit Tests Is a False Sense of Security

**Severity:** High
**Phase to address:** Phase 7 (Guardrails & Hardening), Phase 8 (E2E Validation)

**What goes wrong:**
The v2.1 node-based architecture is testable: each node is a pure function (state in, partial state out). You can unit test `createExecuteNode()` with mocked dependencies. The v2.2 agentic loop is fundamentally non-deterministic -- the same system prompt + tools + initial message can produce different tool-call sequences on different runs.

Teams that replace node unit tests with mock-LLM tests get a false sense of security. The mocked LLM always returns the "expected" sequence, so tests pass. But in production, the real LLM takes a different path and hits an untested code branch.

The NeurIPS 2025 paper on testing LLM systems identified the core mismatch: "AI testing typically treats the 'input sample' as the test unit, while the behavior of an LLM application system is a composite triggering structure composed of 'prompt chaining + state memory + multi-agent coordination.'"

**Why it happens:**
- Developers apply deterministic testing habits to non-deterministic systems
- Mocking the LLM removes the very thing being tested (the LLM's decision-making)
- The v2.1 test structure (node unit tests with vitest) does not translate to agentic loops
- There is no equivalent of "this specific node always produces this output"

**Warning signs:**
- All tests pass with mocked LLM but agent fails with real LLM
- Test coverage appears high but is only testing tool execution, not agent reasoning
- No tests exercise the loop's termination conditions, guardrails, or error recovery
- Tests never use actual LLM calls

**Prevention:**
- **Layer your testing strategy**:
  1. **Deterministic unit tests** for tool implementations, context snapshot serialization, Temporal workflow structure, guardrail enforcement. These are still pure functions
  2. **LLM-mocked integration tests** for the agentic loop mechanics: Does the loop correctly handle `end_turn`? Does it enforce `maxIterations`? Does it record traces? Mock the LLM to return a scripted sequence
  3. **Statistical behavior tests** with real LLM: Run the same scenario 5-10 times with the real API. Verify that outcomes are consistently correct (pass@k), not that the exact tool sequence matches. Accept that the path varies; test the destination
  4. **Scenario-based regression tests**: For each v2.1 failure case (wrong package manager, tests on docs, stuck loops), create a regression scenario with expected behavioral outcome. Run with real LLM
- **LLM-as-judge for output quality**: Use a separate LLM call to evaluate whether the agent's final output (PR, plan, issue) meets quality criteria. Spotify uses this pattern: "evaluate a diff using LLMs as a judge"
- **Budget for real-LLM testing**: Agentic tests with real API calls are expensive. Budget for it explicitly. Run statistical tests nightly or pre-release, not on every commit. Run deterministic tests on every commit
- **Snapshot the reasoning, not the output**: Instead of asserting exact outputs, capture and review the agent's reasoning traces. Build a "golden dataset" of correct traces for comparison

**Sources:**
- [Medium: Deterministic vs Non-Deterministic Testing](https://medium.com/@promptedmind28/deterministic-software-testing-vs-non-deterministic-llm-agent-testing-what-you-need-to-know-f3abd5f9009d) (MEDIUM)
- [Scott Logic: Testing Open-Source LLMs in Multi-Agent Workflows](https://blog.scottlogic.com/2025/10/27/testing-open-source-llms.html) (MEDIUM)
- [Spotify: Background Coding Agents](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) (HIGH)

---

### Pitfall 10: Losing the Implicit Guardrails of the Graph Topology

**Severity:** High
**Phase to address:** Phase 7 (Guardrails), Phase 3 (Dev Agent Orchestrator)

**What goes wrong:**
The v2.1 graph topology encodes implicit safety constraints that are easy to overlook:

- The graph cannot skip the approval node -- it is structurally impossible to go from planning to execution without passing through `request-approval` and the Temporal signal wait
- The graph always runs verify before create-pr -- code is always tested before PR creation
- The graph never gives the execute node access to `create_pull_request` -- only the `create-pr` node has that capability
- The graph prevents concurrent execution of plan + execute -- the topological ordering enforces sequencing
- The `NON_CODE_EXTENSIONS` check in execute.ts (line 38-57) enforces that docs-only changes skip testing -- this logic is hardcoded at the node level

When you replace the graph with an agentic loop, ALL of these constraints become the LLM's responsibility. The LLM must "decide" to get approval, "decide" to run tests, "decide" not to self-merge. If the prompt is imprecise or the LLM has a bad generation, these safety properties can be violated.

**Why it happens:**
- Graph topology is a form of "type system" for agent behavior -- removing it removes compile-time safety
- Teams focus on replicating functionality but forget about the implicit constraints
- The v2.2 spec lists guardrails (no self-merge, sandbox enforcement) but does not enumerate ALL implicit constraints from the graph

**Warning signs:**
- Agent creates PR without getting approval (skipped the step)
- Agent runs code outside the sandbox container
- Agent attempts to merge its own PR
- Agent sends code changes without running tests (no verification)

**Prevention:**
- **Enumerate all v2.1 implicit constraints**: Walk through the graph topology in `graph.ts` and document every constraint the topology enforces. Then implement each as an explicit guardrail:
  - Tool permissions: Orchestrator can only call `request_approval`, `create_branch`, `create_commit`, `create_pull_request` -- NOT `merge_pull_request`
  - State gates: `create_pull_request` tool should check if approval has been received (query `agents.tasks` for `approval_status = "approved"`)
  - Process enforcement: `create_commit` should verify that tests have been run (check execution traces)
- **Tool-level enforcement, not prompt-level**: Don't rely on the prompt to prevent the agent from self-merging. Remove `merge_pull_request` from the agent's tool set entirely. Don't rely on the prompt to enforce sandbox -- make `run_command` always execute via `DevContainerManager`
- **State machine in the Temporal workflow**: The Temporal workflow should enforce the phase ordering. The `runOrchestratorPreApproval` activity physically cannot create a PR because the workflow waits for approval before calling `runOrchestratorPostApproval`. This is the correct architecture -- the v2.2 spec already proposes this
- **Audit log with assertions**: After each activity completes, assert that expected side effects occurred. Did pre-approval activity produce a plan? Did post-approval activity run tests before creating PR? Log violations as warnings, fail on critical violations

**Sources:**
- [Anthropic: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (HIGH)
- [OWASP Top 10 for Agentic Applications](https://www.lasso.security/blog/owasp-top-10-for-agentic-applications) (MEDIUM)

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or degraded developer experience.

---

### Pitfall 11: Debugging "Why Did the Agent Do That?" Is Orders of Magnitude Harder

**Severity:** Medium
**Phase to address:** Phase 7 (Guardrails & Observability)

**What goes wrong:**
In v2.1, debugging is straightforward: check which node executed, check the state at that node, trace the `routeByPhase()` logic. The graph is deterministic, so the same input always produces the same path. In v2.2, the agent took a specific path because of its internal reasoning, which may be opaque, inconsistent, or impossible to reproduce.

When an agent writes incorrect code, the question "why did it choose to modify file X instead of file Y?" requires analyzing the full conversation trace: what the orchestrator reasoned, what brief it gave the coder, what the coder read, and how it interpreted the brief. This is a distributed debugging problem across multiple LLM sessions.

**Why it happens:**
- LLM reasoning is not deterministic -- the same prompt may produce different reasoning on retry
- Multi-agent systems create distributed traces that span multiple LLM sessions
- The "why" is embedded in the model's internal reasoning, which may not be fully externalized even with thinking tokens

**Prevention:**
- **Comprehensive execution tracing** (the v2.2 spec's `agents.execution_traces` table is essential): Record every tool call, every tool result, every LLM response, every sub-agent spawn with parent-child correlation
- **Require the "think" tool**: Anthropic's think tool lets the agent externalize reasoning before acting. Make this available and prompt agents to use it. This creates a readable audit trail of decision-making
- **Correlation across sub-agents**: The `parent_agent_instance_id` field in the spec is critical. It lets you trace from "PR has wrong code" back through "coder received this brief" to "orchestrator decided to brief with this context"
- **Build trace analysis tools early**: A SQL query that shows the full trace for a task (orchestrator reasoning -> sub-agent briefs -> sub-agent actions -> outcomes) should be available from Phase 7. Don't wait for a UI
- **Reproduce-friendly logging**: Log the exact inputs to each `messages.create()` call: model, system prompt, messages array, tools array. This allows replaying the exact scenario in a test environment

**Sources:**
- [Anthropic: The "think" tool](https://www.anthropic.com/engineering/claude-think-tool) (HIGH)
- [W&B: LLM Debugging, Tracing, and Monitoring](https://wandb.ai/onlineinference/genai-research/reports/A-guide-to-LLM-debugging-tracing-and-monitoring--VmlldzoxMzk1MjAyOQ) (MEDIUM)

---

### Pitfall 12: Agent Marks Task Complete Without Verification

**Severity:** Medium
**Phase to address:** Phase 3 (Dev Agent Orchestrator), Phase 4 (Product Agent)

**What goes wrong:**
Anthropic explicitly documented this failure mode from their own experience: "One final major failure mode was Claude's tendency to mark a feature as complete without proper testing. Absent explicit prompting, Claude tended to make code changes but would fail to recognize that the feature didn't work end-to-end."

In the v2.2 context, the coder sub-agent writes files and returns "done" without running tests. Or the orchestrator creates a PR without verifying that the coder's changes actually address the issue. The v2.1 graph forced verification through the `verify` node -- the topology made it impossible to skip. The agentic loop has no such structural guarantee.

Devin's team warns similarly: "Think of the agent as a junior coding partner whose decision-making can be unreliable."

**Why it happens:**
- LLMs are optimistic -- they generate "success" responses that match the expected output format even when the actual work is incomplete
- Without explicit verification tools, the agent cannot actually check its own work
- The agent may conflate "I wrote the code" with "the feature works"

**Prevention:**
- **Verification in sub-agent prompts**: The tester sub-agent's system prompt should explicitly state: "Your job is not done until tests pass. Run the tests. If they fail, analyze the error and report it. Do not claim success without test output showing PASS"
- **Orchestrator verification**: After coder returns, the orchestrator should ALWAYS spawn a tester, regardless of complexity. The spec already proposes this pattern -- enforce it as a guardrail, not just a suggestion
- **Spotify's "verifier" pattern**: Make verification automatic and opaque to the agent. The verification loop runs independently, returns pass/fail, and the agent only knows it must call verification -- not what it does or how. This prevents the agent from gaming or skipping verification
- **End-to-end testing tools**: Anthropic found that "providing Claude with browser automation tools dramatically improved performance, as the agent was able to identify and fix bugs that weren't obvious from the code alone." For Aesir's dev-agent, this means the tester sub-agent should have tools beyond `run_command("pnpm test")` -- it should be able to verify behavior, not just test results

**Sources:**
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (HIGH)
- [Devin: Coding Agents 101](https://devin.ai/agents101) (MEDIUM)
- [Spotify: Feedback Loops in Background Coding Agents](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) (HIGH)

---

### Pitfall 13: One-Shotting Complex Tasks Instead of Incremental Progress

**Severity:** Medium
**Phase to address:** Phase 3 (Dev Agent Orchestrator)

**What goes wrong:**
Anthropic's key finding: "the agent tended to try to do too much at once -- essentially attempting to one-shot the app. Often, this led to the model running out of context in the middle of its implementation, leaving the next session to start with a feature half-implemented and undocumented."

In Aesir's context, the coder sub-agent receives a plan with 5 steps and tries to implement all of them in a single burst of tool calls without committing intermediate progress. If it fails partway through, all work is lost because nothing was checkpointed.

**Why it happens:**
- LLMs are trained to be helpful and complete -- they want to finish the whole task
- Without explicit "commit after each step" instructions, agents batch all changes
- The v2.1 execute node committed after each step (line 278-284 of `execute.ts`) -- this discipline must be carried forward

**Prevention:**
- **Prompt for incremental commits**: System prompt should say: "After completing each logical unit of work, commit your changes. Do not wait until everything is done. If you fail partway through, your completed work should be preserved"
- **Checkpoint sub-agent progress**: The coder sub-agent should have a `checkpoint()` tool that commits current changes and records progress. This is not a Git commit -- it is an internal state save
- **Plan step boundaries**: When the orchestrator passes a plan to the coder, each step should be a separate instruction with a clear boundary. The coder should verify each step works before moving to the next
- **Context window planning**: For multi-file changes, estimate whether the full implementation fits in one sub-agent context window. If not, split into multiple coder invocations

**Sources:**
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (HIGH)
- [Sanity: Staff Engineer's Journey with Claude Code](https://www.sanity.io/blog/first-attempt-will-be-95-garbage) (MEDIUM)

---

### Pitfall 14: Anthropic SDK Migration Introduces Subtle Behavioral Differences

**Severity:** Medium
**Phase to address:** Phase 1 (Agentic Loop Runtime)

**What goes wrong:**
The v2.1 codebase uses `@langchain/anthropic` `ChatAnthropic` for text completion and `withStructuredOutput()` for the approval classifier. Replacing with `@anthropic-ai/sdk` `messages.create()` introduces differences:

1. **Structured output handling changes**: LangChain's `withStructuredOutput()` uses a specific Anthropic feature (likely constrained decoding or tool-use-as-structured-output). The native SDK uses `tools` with a schema, which has slightly different failure modes
2. **Error types change**: LangChain wraps Anthropic errors in its own error hierarchy. Code catching `LangChainError` will not catch `Anthropic.APIError`
3. **Rate limiting behavior changes**: LangChain may have had its own retry/backoff logic that masked Anthropic 429s. The native SDK requires explicit handling
4. **Token counting changes**: LangChain may report token usage differently than the native SDK's `response.usage` field
5. **Streaming behavior differs**: If any existing code uses streaming, the LangChain streaming interface is fundamentally different from the SDK's streaming

**Why it happens:**
- LangChain abstracts away provider-specific behavior. Removing the abstraction exposes underlying differences
- The v2.1 codebase has exactly 2 LLM usage patterns (text completion, structured output) which are simple -- but migration bugs are still possible
- Error handling and retry logic in the MCP client (`callMcpTool`) may need updating

**Prevention:**
- **Map all LLM usage points before migrating**: There are exactly 2 patterns in v2.1: (1) `ChatAnthropic.invoke()` for text completion in nodes, (2) `withStructuredOutput()` for approval classification. Both are replaced by `messages.create()` with/without `tools`
- **Port error handling explicitly**: Create a mapping of LangChain errors to Anthropic SDK errors. Update all catch blocks
- **Test the approval classifier separately**: The structured output pattern for approval classification is the most likely to behave differently. Test with edge cases: ambiguous comments, multi-line feedback, non-English text
- **Use prompt caching from day one**: The native SDK supports `cache_control` properly, which LangChain's wrapper had issues with. This is a v2.2 advantage -- implement it in the loop runtime from the start
- **Verify token counting**: Ensure the `response.usage.input_tokens` and `response.usage.output_tokens` fields match expected values. Build cost tracking on the SDK's native usage reporting

**Sources:**
- [Anthropic SDK: Tool Use Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview) (HIGH)
- [Anthropic: Handling Stop Reasons](https://docs.anthropic.com/en/api/handling-stop-reasons) (HIGH)

---

### Pitfall 15: Context Snapshots Lose Critical Information at Temporal Boundaries

**Severity:** Medium
**Phase to address:** Phase 6 (Context Management)

**What goes wrong:**
The v2.2 spec proposes saving context snapshots at Temporal activity boundaries. The orchestrator completes pre-approval (research + plan) and saves a snapshot. After approval, the post-approval activity reads the snapshot to resume. But the snapshot is an LLM-generated summary -- it is lossy by nature.

If the snapshot loses critical details (a specific file that needs modification, a convention the researcher discovered, a dependency constraint), the post-approval agent operates on incomplete information. This is the same class of problem as Pitfall 5 (sub-agent briefing) but at a different boundary.

The v2.1 architecture had the opposite problem: LangGraph checkpoints serialized the ENTIRE state (16 fields, all file contents), which was too much. The v2.2 approach risks going too far in the other direction.

**Why it happens:**
- LLM summarization is lossy and the loss is unpredictable -- you do not know what was dropped
- The snapshot is a single text field (`summary`) plus JSONB blobs -- there is no schema validation for completeness
- Long-running tasks may accumulate nuanced context that cannot be summarized in a paragraph

**Prevention:**
- **Hybrid approach: structured + semantic**: The v2.2 spec already proposes `agents.tasks` for structured data (PR number, branch name, container ID) and `agents.context_snapshots` for semantic data (summary, findings). Enforce that all critical structured data goes into typed columns, not JSONB summaries
- **Snapshot validation**: After writing a snapshot, have the LLM read it back and verify: "Given this summary, could you continue the task? What information is missing?" This is a lightweight self-check
- **Include raw plan in snapshot**: The approved plan should be stored verbatim in `context_snapshots.plan` (JSONB), not summarized. The plan is a structured artifact that the post-approval agent needs exactly
- **Include key file list**: The `key_files` JSONB field should contain both paths and brief content summaries. The post-approval agent should re-read these files rather than relying on summaries
- **Test boundary transitions specifically**: Create test scenarios where pre-approval discovers nuanced context (a file naming convention, an unusual dependency) and verify the post-approval agent respects it. This is the most important regression test for context management

**Sources:**
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (HIGH)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (HIGH)

---

## Minor Pitfalls

Mistakes that cause annoyance, minor delays, or cosmetic issues.

---

### Pitfall 16: Tool Definitions Bloat the System Prompt

**Severity:** Minor (cost impact can be significant at scale)
**Phase to address:** Phase 2 (Agent Tool Library)

**What goes wrong:**
Each tool definition includes: name, description, and JSON Schema for inputs. With 21+ MCP tools plus codebase tools plus agent coordination tools, the tool definitions alone can consume 5-10K tokens per LLM call. Since these are sent on every iteration of the agentic loop, the cost adds up.

Anthropic warns: "One of the most common failure modes we see is bloated tool sets that cover too much functionality or lead to ambiguous decision points about which tool to use."

**Prevention:**
- **Scope tools per agent type**: Researcher gets read-only tools. Coder gets read+write tools. Tester gets read+run tools. Orchestrator gets coordination tools. Don't give every agent every tool
- **Use prompt caching for tool definitions**: Since tool schemas are static per agent type, cache them with `cache_control: {"type": "ephemeral"}`. This reduces the cost to near-zero after the first call
- **Concise tool descriptions**: Write descriptions for the LLM, not for humans. "Read a file from the repository" is sufficient -- don't include usage examples, edge cases, or parameter explanations in the tool description
- **Combine related tools**: Instead of `search_codebase_regex`, `search_codebase_glob`, `search_codebase_literal`, have one `search_codebase(pattern, type)` tool

---

### Pitfall 17: LLM Rate Limits Collide with Temporal Activity Timeouts

**Severity:** Minor (can become High under load)
**Phase to address:** Phase 1 (Agentic Loop Runtime)

**What goes wrong:**
Anthropic's API has rate limits (requests per minute, tokens per minute). An agentic loop making rapid sequential calls can hit 429 errors. The loop retries with backoff. But Temporal has a `startToCloseTimeout` of 30 minutes. If rate limiting causes enough delays, the activity times out and Temporal retries it -- which starts the loop over and hits rate limits again, creating a cascading failure.

**Prevention:**
- **Implement rate limit awareness in the loop runtime**: When receiving a 429, use the `retry-after` header value. Log the delay. If total delayed time exceeds a threshold (e.g., 50% of the activity timeout), abort with a clear error rather than timing out
- **Use Temporal heartbeats**: Heartbeat during rate limit waits to prevent Temporal from thinking the activity is stuck. Heartbeat with context: `{ status: "rate_limited", retryAfter: 30, iteration: 15 }`
- **Separate rate limit budgets**: If running orchestrator + sub-agents concurrently, they share the same API key's rate limit. Consider sequencing sub-agents or using separate API key tiers
- **Monitor 429 frequency**: If rate limits are hit regularly, it indicates either the loop is too aggressive or the API tier is too low. This is an operational concern, not a code concern

---

### Pitfall 18: Agent Output Format Drift Over Long Conversations

**Severity:** Minor
**Phase to address:** Phase 3 (Dev Agent Orchestrator), Phase 4 (Product Agent)

**What goes wrong:**
Early in the conversation, the agent follows the system prompt's output format precisely. After 20+ iterations and a large context, the agent starts producing responses in slightly different formats -- field names change, JSON structure shifts, required fields are omitted. This is a manifestation of "lost in the middle" where the system prompt's formatting instructions lose influence as the conversation grows.

**Prevention:**
- **Use structured output (tool-use)** for all machine-consumed outputs: The agent's "done" signal should be a tool call (`complete_task({ summary, filesChanged })`), not a text response that needs parsing
- **Repeat key format requirements** in tool result messages, not just the system prompt
- **Keep conversations short**: The sub-agent architecture naturally helps by giving each sub-agent a fresh, short conversation

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation | Severity |
|-------|---------------|------------|----------|
| Phase 1: Agentic Loop Runtime | Building loop without all `stop_reason` handling (#2) | Handle `end_turn`, `tool_use`, `max_tokens`, `pause_turn`, `refusal`, `model_context_window_exceeded` from day one | Critical |
| Phase 1: Agentic Loop Runtime | No token tracking from the start (#6) | Build cost tracking into the loop runtime. Don't add it later | High |
| Phase 2: Tool Library | Bloated tool definitions (#16) | Scope tools per agent type. Use prompt caching | Minor |
| Phase 2: Tool Library | Tool results too verbose (#3) | Truncate/summarize tool results before appending to conversation | Critical |
| Phase 3: Dev Agent Orchestrator | Prompt recreates the graph (#1) | Principles over patterns. Test with README-edit scenario | Critical |
| Phase 3: Dev Agent Orchestrator | Losing implicit graph guardrails (#10) | Enumerate all v2.1 constraints. Enforce via tool permissions and state gates | High |
| Phase 3: Dev Agent Orchestrator | Sub-agent briefing quality (#5) | Structured briefs with validated fields. Include raw data, not just summaries | Critical |
| Phase 4: Product Agent | Agent skips clarification on ambiguous requests | System prompt should say "When in doubt, ask" | Medium |
| Phase 5: Smart Router | LLM overhead for unambiguous events (#7) | Hybrid deterministic+LLM routing | High |
| Phase 6: Context Management | Lossy snapshots at boundaries (#15) | Hybrid structured + semantic. Store plans verbatim | Medium |
| Phase 6: Context Management | No migration path from LangGraph checkpoints (#8) | Drain in-flight workflows. Use Temporal workflow versioning | High |
| Phase 7: Guardrails | Agent marks task complete without verification (#12) | Mandatory verification. Spotify's opaque verifier pattern | Medium |
| Phase 7: Guardrails | Debugging is impossible without traces (#11) | Build trace analysis tools. Use "think" tool | Medium |
| Phase 8: E2E Validation | False confidence from mocked tests (#9) | Layer testing: deterministic + mocked-LLM + real-LLM statistical | High |
| Phase 8: E2E Validation | v2.1 regression cases not covered | Create explicit scenarios for each v2.1 failure case in the spec | High |

---

## V2.1 Failure Case Regression Matrix

Each v2.1 failure from the spec must be explicitly tested in v2.2. This matrix maps each failure to its prevention mechanism:

| V2.1 Failure | Root Cause | V2.2 Prevention | How to Test |
|--------------|------------|-----------------|-------------|
| Runs tests on docs-only changes | Graph always routes through verify node | LLM reasoning decides whether to test. System prompt: "Documentation-only changes do not require test execution" | Scenario: Submit README edit. Assert: no `run_command("pnpm test")` in traces |
| Wrong package manager (3 blind retries) | `execute.ts` retries identically without LLM reasoning | LLM reads error, diagnoses "wrong package manager", adapts approach | Scenario: Repo uses pnpm. Assert: agent uses pnpm (not npm/yarn). If first attempt uses wrong pm, second attempt corrects |
| Simple tasks require full plan approval | No complexity-aware routing | Orchestrator reasons about complexity. Configurable `requireApproval` per complexity level | Scenario: Trivial typo fix. Assert: agent completes with fewer tool calls than complex feature |
| Execute node processes sequentially, cannot adapt | Fixed step-by-step execution without feedback | Agentic loop naturally adapts -- if step 2 fails, agent reasons about why and adjusts | Scenario: Plan step 2 depends on step 1 output. Assert: agent reads step 1 output before executing step 2 |
| Classification outside expected patterns breaks flow | Hardcoded enum for approval intents | Smart router uses LLM reasoning, handles unknown intents gracefully | Scenario: User responds with ambiguous comment. Assert: router either classifies or asks for clarification, does not crash |

---

## Sources Summary

### HIGH Confidence (Official docs, engineering blogs from practitioners)

- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Handling Stop Reasons](https://docs.anthropic.com/en/api/handling-stop-reasons)
- [Anthropic: Tool Use Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [Anthropic: Claude 4 Best Practices](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)
- [Anthropic: The "think" tool](https://www.anthropic.com/engineering/claude-think-tool)
- [MAST: Why Do Multi-Agent LLM Systems Fail? (NeurIPS 2025)](https://arxiv.org/abs/2503.13657)
- [Spotify: Background Coding Agents Part 3 - Feedback Loops](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)
- [Microsoft: Context Engineering for Azure SRE Agent](https://techcommunity.microsoft.com/blog/appsonazureblog/context-engineering-lessons-from-building-azure-sre-agent/4481200/)
- [Temporal: Building Dynamic AI Agents](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal)
- [Temporal: Workflow Definition & Determinism](https://docs.temporal.io/workflow-definition)

### MEDIUM Confidence (Community verified, credible multi-source)

- [JetBrains: Efficient Context Management (NeurIPS 2025)](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [Devin: Coding Agents 101](https://devin.ai/agents101)
- [Sanity: Staff Engineer's Journey with Claude Code](https://www.sanity.io/blog/first-attempt-will-be-95-garbage)
- [Simon Willison: Designing Agentic Loops](https://simonwillison.net/2025/Sep/30/designing-agentic-loops/)
- [OWASP Top 10 for Agentic Applications](https://www.lasso.security/blog/owasp-top-10-for-agentic-applications)

### LOW Confidence (Single source, needs validation)

- Token cost projections (10-100x) are order-of-magnitude estimates that vary dramatically by task complexity, model choice, and implementation quality. Aesir-specific costs should be measured during Phase 8 E2E validation.
