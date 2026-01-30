# Roadmap: Aesir v2.2 Agentic Architecture

## Overview

Replace LangGraph state machine architecture with agentic tool-use loops where LLMs make control flow decisions. Agents reason about what to do, use tools to act, observe results, and adapt -- instead of following predetermined graphs. The journey starts with the core runtime primitive, builds up through database schema, tools, and agents, then validates the full end-to-end flow works better than v2.1's fixed graphs.

## Milestones

- **v1.0 MVP** - Phases 1-9 (shipped 2026-01-19)
- **v2.0 Foundation** - Phases 10-22 (shipped 2026-01-25)
- **v2.1 Agents That Ship** - Phases 23-27 (shipped 2026-01-28)
- **v2.2 Agentic Architecture** - Phases 28-36 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (28, 29, 30...): Planned milestone work
- Decimal phases (28.1, 28.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 28: Agentic Loop Runtime** - Core `runAgentLoop()` function with Anthropic SDK native tool-use
- [x] **Phase 29: Database Schema & Context Management** - Storage layer for context snapshots, task state, and execution traces
- [x] **Phase 30: Agent Tool Library** - Codebase tools, MCP wrappers, git tools, spawn_agent, per-agent toolkits
- [x] **Phase 31: Dev Agent Orchestrator** - Orchestrator agentic loop with sub-agents (researcher, coder, tester)
- [ ] **Phase 32: Dev Agent Temporal Integration** - Temporal activities and simplified workflow wrapping the orchestrator
- [ ] **Phase 33: Product Agent** - Single adaptive agentic loop replacing LangGraph conversation graph
- [ ] **Phase 34: Smart Router** - Hybrid event classification (deterministic rules + LLM reasoning)
- [ ] **Phase 35: Guardrails & Cleanup** - LangGraph removal, cost budgets, token enforcement, hardening
- [ ] **Phase 36: End-to-End Validation** - Full flow testing proving agentic architecture works

## Phase Details

### Phase 28: Agentic Loop Runtime
**Goal**: A working `runAgentLoop()` function that iterates LLM calls with tool execution, forming the foundation every agent in v2.2 builds on
**Depends on**: Nothing (first phase of v2.2)
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07, LOOP-08, LOOP-09
**Success Criteria** (what must be TRUE):
  1. A minimal test agent can be given a system prompt and tools, call `runAgentLoop()`, and get back a structured result with status, output, tool call count, and token counts
  2. The loop correctly stops when the LLM responds with text only (no tool calls), when iteration limit is hit, when token budget is exhausted, or when AbortSignal fires
  3. Tool definitions use Zod schemas converted via `@anthropic-ai/sdk`'s `betaZodTool()` -- no LangChain imports exist in the runtime
  4. Tracing callbacks (`onToolCall`, `onResponse`) fire on every iteration, providing the hook points that Phase 29 will use for automatic trace recording
  5. The loop handles all Anthropic `stop_reason` values without breaking, including unexpected future values
**Plans**: 2 plans
Plans:
- [x] 28-01-PLAN.md -- SDK installation, types, token budget, errors, barrel exports
- [x] 28-02-PLAN.md -- Core runAgentLoop() implementation and comprehensive tests

### Phase 29: Database Schema & Context Management
**Goal**: Agents can persist semantic context across Temporal activity boundaries and all tool calls are automatically recorded for observability
**Depends on**: Phase 28
**Requirements**: CTXM-01, CTXM-02, CTXM-03, CTXM-04, CTXM-05, CTXM-06, CTXM-07, TRAC-01, TRAC-02, TRAC-03, TRAC-04, TRAC-05
**Success Criteria** (what must be TRUE):
  1. Three new tables exist in the `agents` PostgreSQL schema (`context_snapshots`, `tasks`, `execution_traces`) with proper Drizzle ORM definitions and migrations applied
  2. Context snapshots can be written at end of a Temporal activity (LLM self-summarization + programmatic extraction) and read at start of the next activity, providing continuity across approval waits
  3. Execution traces are recorded automatically via the `runAgentLoop()` tracing callbacks -- every tool call, tool result, LLM response, agent spawn, and agent completion is logged without manual instrumentation
  4. Traces support parent/child agent correlation via `parent_agent_instance_id`, enabling queries like "show me everything the coder sub-agent did for task X"
  5. Token counts (input + output) and duration are tracked per trace step, enabling cost analysis per task
**Plans**: 3 plans
Plans:
- [x] 29-01-PLAN.md -- Drizzle ORM schema, DB client, migration, and ID generators
- [x] 29-02-PLAN.md -- Trace recorder factory with buffered writes and callbacks
- [x] 29-03-PLAN.md -- Context manager and task store services

### Phase 30: Agent Tool Library
**Goal**: A complete library of typed tool definitions that agents can use to interact with codebases, integrations, git, and each other
**Depends on**: Phase 28, Phase 29
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07, TOOL-08
**Success Criteria** (what must be TRUE):
  1. Codebase tools (`read_file`, `write_file`, `search_codebase`, `list_directory`, `run_command`) execute inside dev containers via `DevContainerManager` and return results the LLM can reason about
  2. All 19 existing MCP tools (Linear 5, GitHub 9, Slack 5) are available as typed `ToolDefinition` objects wrapping `callMcpTool()` with Zod input schemas
  3. The `spawn_agent` tool creates a nested `runAgentLoop()` invocation with focused context and restricted tool set, returning the sub-agent's result to the calling orchestrator
  4. Tool errors are returned to the LLM with `isError: true` rather than throwing exceptions -- the LLM reasons about what went wrong instead of the loop crashing
  5. Per-agent toolkits are defined: orchestrator gets coordination + lightweight tools, researcher gets read-only, coder gets read+write, tester gets read+run
**Plans**: 3 plans
Plans:
- [x] 30-01-PLAN.md -- Codebase tools (read_file, write_file, search_codebase, list_directory, run_command)
- [x] 30-02-PLAN.md -- MCP integration tool wrappers (19 tools: Linear 5, GitHub 9, Slack 5)
- [x] 30-03-PLAN.md -- Coordination tools (spawn_agent, request_human_input) and per-agent toolkits

### Phase 31: Dev Agent Orchestrator
**Goal**: The dev agent reasons about tasks using sub-agents instead of following a fixed 13-node graph -- it decides what to research, how detailed to plan, whether to test, and how to recover from errors
**Depends on**: Phase 28, Phase 29, Phase 30
**Requirements**: DEVO-01, DEVO-02, DEVO-03, DEVO-04, DEVO-05, DEVO-09, DEVO-10, DEVO-11, DEVO-12, DEVO-13, DEVO-14
**Success Criteria** (what must be TRUE):
  1. The orchestrator agentic loop replaces the 13-node LangGraph graph -- no `routeByPhase()` or fixed phase enums drive control flow
  2. Sub-agents (researcher, coder, tester) are spawned with isolated context: the coder gets the plan and relevant files but not research history, the researcher gets the task but not code changes
  3. The orchestrator adapts to task complexity: a README edit skips research and detailed planning, while a feature implementation spawns researcher, plans in detail, spawns coder, then tester
  4. When tests fail, the agent reads error output, diagnoses the cause (wrong command, missing dependency, code bug), and tries a different approach -- not identical retries. After 3 distinct failed approaches, it escalates
  5. System prompt includes agent identity, issue details, project conventions, constraints, available tools, and sub-agent guidance
**Plans**: 2 plans
Plans:
- [x] 31-01-PLAN.md -- System prompts, orchestrator entry point, and toolkits update
- [x] 31-02-PLAN.md -- Behavioral tests for adaptive orchestrator decisions

### Phase 32: Dev Agent Temporal Integration
**Goal**: The dev agent orchestrator runs inside Temporal's durability envelope with proper activity boundaries, approval gates, and feedback loops
**Depends on**: Phase 31
**Requirements**: DEVO-06, DEVO-07, DEVO-08, DEVO-15
**Success Criteria** (what must be TRUE):
  1. `runOrchestratorPreApproval` Temporal activity runs research + planning via the orchestrator agentic loop and returns a plan for human approval
  2. `runOrchestratorPostApproval` Temporal activity runs execution + testing + PR creation via the orchestrator agentic loop, resuming from the context snapshot written by pre-approval
  3. `handleOrchestratorFeedback` Temporal activity addresses PR review comments by reading feedback, diagnosing issues, and making targeted fixes
  4. The simplified Temporal workflow follows: setup -> pre-approval loop -> approval wait -> post-approval loop -> PR wait -> feedback loop -> complete
**Plans**: TBD

### Phase 33: Product Agent
**Goal**: The product agent adapts its conversation strategy based on input clarity instead of following a fixed classify-analyze-clarify-confirm-create graph
**Depends on**: Phase 28, Phase 29, Phase 30
**Requirements**: PROD-01, PROD-02, PROD-03, PROD-04, PROD-05, PROD-06, PROD-07
**Success Criteria** (what must be TRUE):
  1. The product agent runs as a single agentic loop replacing the 6-node LangGraph graph -- the LLM decides whether to clarify, search for duplicates, or create an issue based on reasoning
  2. A clear request with all details (e.g., "Add a health check endpoint at /health that returns 200") creates a Linear issue in 1-2 tool calls without unnecessary clarification
  3. A vague request (e.g., "we need better error handling") triggers focused clarifying questions via Slack, with multi-turn conversation state maintained through Temporal signals
  4. The agent detects cancellation intent through LLM reasoning (no hardcoded phrase lists) and searches existing Linear issues for duplicates before creating new ones
**Plans**: TBD

### Phase 34: Smart Router
**Goal**: Events are routed to the correct agent workflow through a hybrid system -- deterministic rules for obvious events, LLM reasoning for ambiguous ones
**Depends on**: Phase 28, Phase 30
**Requirements**: ROUT-01, ROUT-02, ROUT-03, ROUT-04, ROUT-05, ROUT-06, ROUT-07
**Success Criteria** (what must be TRUE):
  1. Deterministic events (PR merged, approval button clicked, PR review submitted) route instantly via rules with zero LLM latency
  2. Ambiguous events (Slack mentions, Linear comments with unclear intent) route correctly via LLM reasoning within the 10-iteration limit
  3. The approval intent classifier from `dev-agent/classification/approval.ts` is absorbed into the LLM reasoning path -- no separate classification module
  4. All current v2.1 event types route correctly: `slack.app_mention.created`, `linear.comment.created`, `slack.block_actions.*`, `github.pull_request.*`, `slack.message.created` in thread
  5. If LLM routing fails or times out, the event is logged and an alert is sent -- events are never silently dropped
**Plans**: TBD

### Phase 35: Guardrails & Cleanup
**Goal**: Safety guardrails are enforced across all agents and all LangGraph code is removed from the codebase
**Depends on**: Phase 31, Phase 32, Phase 33, Phase 34
**Requirements**: GUAR-01, GUAR-02, GUAR-03, GUAR-04, GUAR-05, GUAR-06, GUAR-07, GUAR-08, GUAR-09
**Success Criteria** (what must be TRUE):
  1. All `run_command` tool calls execute inside `DevContainerManager` sandbox and agents cannot call `merge_pull_request` -- human merges only
  2. Token budget is enforced: the loop checks remaining budget before each LLM call and terminates gracefully if exhausted, with cost tracked per task across orchestrator and all sub-agents
  3. All four `@langchain/*` dependencies are removed from `@aesir/agents` package.json and all LangGraph code is deleted: graph definitions, node implementations, state schemas, phase enums, `routeByPhase()`, `code-workflow/` directory
  4. Temporal activity retry config is designed for agentic loops with appropriate retry count and backoff for LLM-heavy activities
  5. `PostgresSaver` checkpointer is removed -- context persistence fully handled by `agents.context_snapshots`
**Plans**: TBD

### Phase 36: End-to-End Validation
**Goal**: The complete v2.2 agentic architecture works end-to-end, proving agents reason about their actions instead of following fixed graphs
**Depends on**: Phase 35
**Requirements**: E2EV-01, E2EV-02, E2EV-03, E2EV-04, E2EV-05, E2EV-06, E2EV-07, E2EV-08, E2EV-09, E2EV-10, E2EV-11
**Success Criteria** (what must be TRUE):
  1. Full flow works: Slack message -> product agent -> Linear issue -> dev agent -> approved PR, with agents making reasoning decisions at each step
  2. Simple tasks are efficient: a README edit completes in under 10 tool calls with no test execution and no unnecessary research
  3. Error recovery is intelligent: when tests fail, the agent reads the error, diagnoses the cause, and fixes it -- not blind retry. Context survives Temporal boundaries (approval waits, crash recovery)
  4. All tool calls are queryable in `agents.execution_traces` with parent/child correlation, and all guardrails are enforced (iteration limits, sandbox-only commands, cost tracking)
  5. No `@langchain/*` dependencies remain in the agents package
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 28 -> 29 -> 30 -> 31 -> 32 -> 33 -> 34 -> 35 -> 36

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 28. Agentic Loop Runtime | 2/2 | Complete | 2026-01-29 |
| 29. Database Schema & Context | 3/3 | Complete | 2026-01-30 |
| 30. Agent Tool Library | 3/3 | Complete | 2026-01-30 |
| 31. Dev Agent Orchestrator | 2/2 | Complete | 2026-01-30 |
| 32. Dev Agent Temporal Integration | 0/TBD | Not started | - |
| 33. Product Agent | 0/TBD | Not started | - |
| 34. Smart Router | 0/TBD | Not started | - |
| 35. Guardrails & Cleanup | 0/TBD | Not started | - |
| 36. End-to-End Validation | 0/TBD | Not started | - |

---
*Roadmap created: 2026-01-29*
*Milestone: v2.2 Agentic Architecture (Phases 28-36)*
