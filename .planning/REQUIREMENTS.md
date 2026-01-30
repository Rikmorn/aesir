# Requirements: Aesir v2.2 Agentic Architecture

**Defined:** 2026-01-29
**Core Value:** End-to-end automated development workflow where agents reason about what to do, use tools to act, observe results, and adapt -- instead of following predetermined graphs.

## v2.2 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Agentic Loop Runtime

- [x] **LOOP-01**: Core `runAgentLoop()` function iterates: send to LLM -> receive tool calls -> execute tools -> feed results back -> repeat until LLM responds with text only or guardrail hit
- [x] **LOOP-02**: Uses `@anthropic-ai/sdk` native tool-use API (messages.create with tools parameter), replacing all `@langchain/anthropic` usage
- [x] **LOOP-03**: Tool definitions use Zod schemas converted to JSON Schema via SDK's `betaZodTool()` -- no separate conversion library
- [x] **LOOP-04**: Configurable iteration limit per agent invocation (default: 50 sub-agent, 100 orchestrator, 10 router)
- [x] **LOOP-05**: Configurable token budget per task, shared across orchestrator and all sub-agents via mutable counter
- [x] **LOOP-06**: AbortSignal support for clean cancellation of in-flight LLM calls
- [x] **LOOP-07**: Tracing callbacks (onToolCall, onResponse) called on every iteration for automatic trace recording
- [x] **LOOP-08**: Returns structured result: status (completed/max_iterations/max_tokens/aborted/error), output, structured output, tool call count, token counts, trace
- [x] **LOOP-09**: Handles all Anthropic `stop_reason` values (end_turn, tool_use, max_tokens, stop_sequence, and any new values) -- does not break on unexpected values

### Agent Tool Library

- [x] **TOOL-01**: Codebase tools execute inside dev container via DevContainerManager: `read_file`, `write_file`, `search_codebase`, `list_directory`, `run_command`
- [x] **TOOL-02**: MCP integration tools wrap existing `callMcpTool()` as ToolDefinitions -- Linear (5 tools), GitHub (9 tools), Slack (5 tools) -- all 19 existing MCP tools available
- [x] **TOOL-03**: Git tools wrap GitHub MCP operations: `create_branch`, `create_commit`, `create_pull_request`, `get_pull_request`, `merge_pull_request`
- [x] **TOOL-04**: `spawn_agent` coordinator tool creates a nested agentic loop with focused context and restricted tool set -- returns agent result to orchestrator
- [x] **TOOL-05**: `request_human_input` tool signals Temporal workflow to wait for human response, returns when signal received
- [x] **TOOL-06**: Each tool has Zod input schema, description string, and async execute function returning `{ content: string, isError?: boolean }`
- [x] **TOOL-07**: Tool errors returned to LLM with `isError: true` -- LLM reasons about errors instead of tool throwing exceptions that break the loop
- [x] **TOOL-08**: Per-agent tool sets (toolkits): orchestrator gets coordination + lightweight codebase tools, researcher gets read-only codebase tools, coder gets read+write codebase tools, tester gets read+run tools

### Dev Agent Orchestrator

- [ ] **DEVO-01**: Orchestrator agentic loop replaces the 13-node LangGraph graph and `routeByPhase()` switch statement
- [ ] **DEVO-02**: Orchestrator spawns focused sub-agents (researcher, coder, tester) with isolated context -- sub-agent gets task-relevant context only, not full history
- [ ] **DEVO-03**: Researcher sub-agent explores codebase with read-only tools, returns structured findings (relevant files, patterns, conventions)
- [ ] **DEVO-04**: Coder sub-agent implements changes with read+write tools, receives plan + relevant file contents + conventions as context
- [ ] **DEVO-05**: Tester sub-agent runs and diagnoses tests with read+run tools, receives changed files and project info (package manager, test runner)
- [x] **DEVO-06**: New Temporal activity `runOrchestratorPreApproval` -- research + plan -> returns plan for approval
- [x] **DEVO-07**: New Temporal activity `runOrchestratorPostApproval` -- execute + test + PR -> returns PR details
- [x] **DEVO-08**: New Temporal activity `handleOrchestratorFeedback` -- address PR review comments -> returns updated files
- [ ] **DEVO-09**: Orchestrator decides whether research is needed based on task complexity (README edit -> skip, feature -> research)
- [ ] **DEVO-10**: Orchestrator decides plan granularity (trivial change -> brief plan, complex -> detailed breakdown)
- [ ] **DEVO-11**: LLM-diagnosed error recovery -- when tests fail, agent reads error output, diagnoses cause, and fixes (not blind retry)
- [ ] **DEVO-12**: Orchestrator decides test approach based on task (docs-only -> no tests, feature -> unit tests, API change -> integration tests)
- [ ] **DEVO-13**: Escalation after 3 distinct approaches fail (LLM must try different approach each time, not identical retries)
- [ ] **DEVO-14**: System prompt includes agent identity, issue details, project conventions, constraints, available tools, sub-agent guidance
- [x] **DEVO-15**: Simplified Temporal workflow: setup -> pre-approval loop -> approval wait -> post-approval loop -> PR wait -> feedback loop -> complete

### Product Agent

- [x] **PROD-01**: Single agentic loop replaces the 6-node LangGraph graph (classify->analyze->clarify->confirm->create->notify)
- [x] **PROD-02**: Adapts to input clarity -- clear request with all details creates issue immediately (1-2 tool calls), vague request asks focused clarifying questions
- [x] **PROD-03**: Multi-turn conversation via Temporal `userReplySignal` waits between turns
- [x] **PROD-04**: Cancellation intent recognition via LLM reasoning (no hardcoded phrase list like "nevermind", "cancel", "nvm")
- [x] **PROD-05**: Duplicate detection -- searches existing Linear issues before creating, suggests updating existing if similar found
- [x] **PROD-06**: System prompt includes agent identity, full thread history, issue quality guidelines, clarification guidelines
- [x] **PROD-07**: Same timeout handling as current (24h reminder, 72h total)

### Smart Router

- [x] **ROUT-01**: Hybrid routing -- deterministic rules for unambiguous events (PR merged, button clicked, etc.), LLM reasoning only for ambiguous events (Slack messages, Linear comments with unclear intent)
- [x] **ROUT-02**: Replaces hardcoded event switches in `dev-agent/api/events.ts` and `product-agent/api/events.ts`
- [x] **ROUT-03**: Absorbs approval intent classifier from `dev-agent/classification/approval.ts` into LLM reasoning path
- [x] **ROUT-04**: Router tools: `query_running_workflows`, `start_workflow`, `signal_workflow`, `send_message` (for clarification)
- [x] **ROUT-05**: All current event types route correctly: `slack.app_mention.created`, `linear.comment.created`, `slack.block_actions.*`, `github.pull_request.*`, `slack.message.created` in thread
- [x] **ROUT-06**: Fallback: if LLM routing fails or times out, log the event and alert -- do not silently drop events
- [x] **ROUT-07**: Router iteration limit: 10 (should decide quickly)

### Context Management

- [x] **CTXM-01**: New database table `agents.context_snapshots` with semantic context (summary, completed_actions, pending_intent, known_issues, project_context, key_files, research_findings, plan)
- [x] **CTXM-02**: New database table `agents.tasks` with critical structured data (task_id, issue_id, workflow_id, status, container_id, branch_name, pr_number, approval_status, slack_channel)
- [x] **CTXM-03**: Context written at end of each Temporal activity via LLM self-summarization (one final LLM call) + programmatic extraction for structured fields
- [x] **CTXM-04**: Context read at start of activity resume -- post-approval activity receives summary of research and plan, post-crash resumes from latest snapshot
- [x] **CTXM-05**: Sub-agent context briefing -- orchestrator produces focused brief for each sub-agent (only relevant info, not full history) *(deferred to Phase 30/31 -- in-memory only per architectural decision)*
- [x] **CTXM-06**: Drizzle ORM schema definitions in `agents` PostgreSQL schema namespace
- [x] **CTXM-07**: Database migration for all new tables

### Execution Tracing

- [x] **TRAC-01**: New database table `agents.execution_traces` with parent/child agent correlation (agent_instance_id, parent_agent_instance_id)
- [x] **TRAC-02**: Every tool call, tool result, LLM response, agent spawn, and agent complete automatically logged via loop callbacks *(partial: tool_result deferred -- Phase 28 lacks onToolResult callback; 4 of 5 types recorded)*
- [x] **TRAC-03**: Token count (input + output) and duration tracked per step
- [x] **TRAC-04**: Traces queryable by task_id, workflow_id, and agent_instance_id
- [x] **TRAC-05**: No manual instrumentation required -- tracing is a runtime responsibility built into `runAgentLoop()`

### Guardrails & Hardening

- [ ] **GUAR-01**: All `run_command` tool calls execute inside DevContainerManager sandbox -- no host access
- [ ] **GUAR-02**: Agents cannot call `merge_pull_request` -- human merges only
- [ ] **GUAR-03**: Configurable guardrail values via AgentConfig (iteration limits, token budgets, model selection)
- [ ] **GUAR-04**: Temporal activity retry config designed for agentic loops -- appropriate retry count and backoff for LLM-heavy activities
- [ ] **GUAR-05**: Token budget enforcement -- loop checks remaining budget before each LLM call, terminates gracefully if exhausted
- [ ] **GUAR-06**: Cost tracking per task -- total tokens (input + output) aggregated across orchestrator and all sub-agents
- [ ] **GUAR-07**: All `@langchain/*` dependencies removed from `@aesir/agents`: `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`
- [ ] **GUAR-08**: LangGraph code deleted: graph definitions, node implementations, state schemas, phase enums, `routeByPhase()`, `code-workflow/` directory
- [ ] **GUAR-09**: `PostgresSaver` checkpointer removed -- replaced by agents.context_snapshots

### End-to-End Validation

- [ ] **E2EV-01**: Full flow works: Slack message -> product agent -> Linear issue -> dev agent -> approved PR
- [ ] **E2EV-02**: README edit completes in under 10 tool calls, no test execution, no unnecessary research
- [ ] **E2EV-03**: Simple feature: dev agent implements function, writes tests, runs with correct package manager (pnpm), creates PR
- [ ] **E2EV-04**: Test failure recovery: agent reads error, diagnoses cause (wrong command, missing dependency, code bug), and fixes -- not blind retry
- [ ] **E2EV-05**: Product agent adapts: clear request -> issue in 1-2 turns, vague request -> asks questions
- [ ] **E2EV-06**: Smart router handles all current v2.1 event types correctly
- [ ] **E2EV-07**: Context survives Temporal boundaries: agent resumes after approval wait with understanding of research and plan
- [ ] **E2EV-08**: Sub-agents get focused context: coder gets plan + files (not research history), researcher gets task (not code changes)
- [ ] **E2EV-09**: All tool calls queryable in `agents.execution_traces` with parent/child correlation
- [ ] **E2EV-10**: Guardrails enforced: loops terminate at limits, commands sandbox-only, cost tracked
- [ ] **E2EV-11**: No `@langchain/*` dependencies remain in agents package

## Future Requirements

Deferred to subsequent milestones. Tracked but not in v2.2 roadmap.

### Cross-Agent Collaboration

- **XAGT-01**: Dev agent can ask product agent to clarify mid-task via Temporal signals
- **XAGT-02**: QA agent reviews PRs before human approval

### Multi-LLM Support

- **MLLM-01**: Agent config supports different LLM providers (GPT-4, etc.)
- **MLLM-02**: Model selection per agent type

### New Agent Types

- **NAGT-01**: QA agent for automated code review
- **NAGT-02**: Docs agent for documentation updates
- **NAGT-03**: Reviewer agent for PR analysis

### Production Readiness

- **PRDY-01**: CI/CD pipeline for deployment
- **PRDY-02**: Monitoring and alerting for agent health
- **PRDY-03**: Multi-environment configuration (dev/staging/prod)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Codebase indexing / RAG | Agents explore via read_file/search_codebase tools. No vector DB needed. |
| Web search / internet research tools | Can be added as tools later. Not needed for core workflow. |
| UI for observing agent execution | Traces stored in DB, queryable via SQL. UI is separate concern. |
| Multi-repo support | Agents work on single configured repo. Future enhancement. |
| Streaming LLM responses | Non-streaming recommended for backend agents in Temporal. No real-time UI. |
| Claude Agent SDK | Build on raw @anthropic-ai/sdk for full control over Temporal integration. |
| Parallel sub-agents | Dev workflow is sequential (research->plan->code->test). Parallel adds complexity without benefit. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOOP-01 | Phase 28 | Complete |
| LOOP-02 | Phase 28 | Complete |
| LOOP-03 | Phase 28 | Complete |
| LOOP-04 | Phase 28 | Complete |
| LOOP-05 | Phase 28 | Complete |
| LOOP-06 | Phase 28 | Complete |
| LOOP-07 | Phase 28 | Complete |
| LOOP-08 | Phase 28 | Complete |
| LOOP-09 | Phase 28 | Complete |
| TOOL-01 | Phase 30 | Complete |
| TOOL-02 | Phase 30 | Complete |
| TOOL-03 | Phase 30 | Complete |
| TOOL-04 | Phase 30 | Complete |
| TOOL-05 | Phase 30 | Complete |
| TOOL-06 | Phase 30 | Complete |
| TOOL-07 | Phase 30 | Complete |
| TOOL-08 | Phase 30 | Complete |
| DEVO-01 | Phase 31 | Pending |
| DEVO-02 | Phase 31 | Pending |
| DEVO-03 | Phase 31 | Pending |
| DEVO-04 | Phase 31 | Pending |
| DEVO-05 | Phase 31 | Pending |
| DEVO-06 | Phase 32 | Complete |
| DEVO-07 | Phase 32 | Complete |
| DEVO-08 | Phase 32 | Complete |
| DEVO-09 | Phase 31 | Pending |
| DEVO-10 | Phase 31 | Pending |
| DEVO-11 | Phase 31 | Pending |
| DEVO-12 | Phase 31 | Pending |
| DEVO-13 | Phase 31 | Pending |
| DEVO-14 | Phase 31 | Pending |
| DEVO-15 | Phase 32 | Complete |
| PROD-01 | Phase 33 | Complete |
| PROD-02 | Phase 33 | Complete |
| PROD-03 | Phase 33 | Complete |
| PROD-04 | Phase 33 | Complete |
| PROD-05 | Phase 33 | Complete |
| PROD-06 | Phase 33 | Complete |
| PROD-07 | Phase 33 | Complete |
| ROUT-01 | Phase 34 | Complete |
| ROUT-02 | Phase 34 | Complete |
| ROUT-03 | Phase 34 | Complete |
| ROUT-04 | Phase 34 | Complete |
| ROUT-05 | Phase 34 | Complete |
| ROUT-06 | Phase 34 | Complete |
| ROUT-07 | Phase 34 | Complete |
| CTXM-01 | Phase 29 | Complete |
| CTXM-02 | Phase 29 | Complete |
| CTXM-03 | Phase 29 | Complete |
| CTXM-04 | Phase 29 | Complete |
| CTXM-05 | Phase 29 | Complete (deferred to Phase 30/31) |
| CTXM-06 | Phase 29 | Complete |
| CTXM-07 | Phase 29 | Complete |
| TRAC-01 | Phase 29 | Complete |
| TRAC-02 | Phase 29 | Complete (partial: tool_result deferred) |
| TRAC-03 | Phase 29 | Complete |
| TRAC-04 | Phase 29 | Complete |
| TRAC-05 | Phase 29 | Complete |
| GUAR-01 | Phase 35 | Pending |
| GUAR-02 | Phase 35 | Pending |
| GUAR-03 | Phase 35 | Pending |
| GUAR-04 | Phase 35 | Pending |
| GUAR-05 | Phase 35 | Pending |
| GUAR-06 | Phase 35 | Pending |
| GUAR-07 | Phase 35 | Pending |
| GUAR-08 | Phase 35 | Pending |
| GUAR-09 | Phase 35 | Pending |
| E2EV-01 | Phase 36 | Pending |
| E2EV-02 | Phase 36 | Pending |
| E2EV-03 | Phase 36 | Pending |
| E2EV-04 | Phase 36 | Pending |
| E2EV-05 | Phase 36 | Pending |
| E2EV-06 | Phase 36 | Pending |
| E2EV-07 | Phase 36 | Pending |
| E2EV-08 | Phase 36 | Pending |
| E2EV-09 | Phase 36 | Pending |
| E2EV-10 | Phase 36 | Pending |
| E2EV-11 | Phase 36 | Pending |

**Coverage:**
- v2.2 requirements: 78 total (9 categories)
- Mapped to phases: 78
- Unmapped: 0

---
*Requirements defined: 2026-01-29*
*Last updated: 2026-01-29 after roadmap creation (all 78 requirements mapped)*
