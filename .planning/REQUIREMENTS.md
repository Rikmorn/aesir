# Requirements: Aesir v2.2 Agentic Architecture

**Defined:** 2026-01-29
**Core Value:** End-to-end automated development workflow where agents reason about what to do, use tools to act, observe results, and adapt — instead of following predetermined graphs.

## v2.2 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Agentic Loop Runtime

- [ ] **LOOP-01**: Core `runAgentLoop()` function iterates: send to LLM → receive tool calls → execute tools → feed results back → repeat until LLM responds with text only or guardrail hit
- [ ] **LOOP-02**: Uses `@anthropic-ai/sdk` native tool-use API (messages.create with tools parameter), replacing all `@langchain/anthropic` usage
- [ ] **LOOP-03**: Tool definitions use Zod schemas converted to JSON Schema via SDK's `betaZodTool()` — no separate conversion library
- [ ] **LOOP-04**: Configurable iteration limit per agent invocation (default: 50 sub-agent, 100 orchestrator, 10 router)
- [ ] **LOOP-05**: Configurable token budget per task, shared across orchestrator and all sub-agents via mutable counter
- [ ] **LOOP-06**: AbortSignal support for clean cancellation of in-flight LLM calls
- [ ] **LOOP-07**: Tracing callbacks (onToolCall, onResponse) called on every iteration for automatic trace recording
- [ ] **LOOP-08**: Returns structured result: status (completed/max_iterations/max_tokens/aborted/error), output, structured output, tool call count, token counts, trace
- [ ] **LOOP-09**: Handles all Anthropic `stop_reason` values (end_turn, tool_use, max_tokens, stop_sequence, and any new values) — does not break on unexpected values

### Agent Tool Library

- [ ] **TOOL-01**: Codebase tools execute inside dev container via DevContainerManager: `read_file`, `write_file`, `search_codebase`, `list_directory`, `run_command`
- [ ] **TOOL-02**: MCP integration tools wrap existing `callMcpTool()` as ToolDefinitions — Linear (5 tools), GitHub (9 tools), Slack (5 tools) — all 19 existing MCP tools available
- [ ] **TOOL-03**: Git tools wrap GitHub MCP operations: `create_branch`, `create_commit`, `create_pull_request`, `get_pull_request`, `merge_pull_request`
- [ ] **TOOL-04**: `spawn_agent` coordinator tool creates a nested agentic loop with focused context and restricted tool set — returns agent result to orchestrator
- [ ] **TOOL-05**: `request_human_input` tool signals Temporal workflow to wait for human response, returns when signal received
- [ ] **TOOL-06**: Each tool has Zod input schema, description string, and async execute function returning `{ content: string, isError?: boolean }`
- [ ] **TOOL-07**: Tool errors returned to LLM with `isError: true` — LLM reasons about errors instead of tool throwing exceptions that break the loop
- [ ] **TOOL-08**: Per-agent tool sets (toolkits): orchestrator gets coordination + lightweight codebase tools, researcher gets read-only codebase tools, coder gets read+write codebase tools, tester gets read+run tools

### Dev Agent Orchestrator

- [ ] **DEVO-01**: Orchestrator agentic loop replaces the 13-node LangGraph graph and `routeByPhase()` switch statement
- [ ] **DEVO-02**: Orchestrator spawns focused sub-agents (researcher, coder, tester) with isolated context — sub-agent gets task-relevant context only, not full history
- [ ] **DEVO-03**: Researcher sub-agent explores codebase with read-only tools, returns structured findings (relevant files, patterns, conventions)
- [ ] **DEVO-04**: Coder sub-agent implements changes with read+write tools, receives plan + relevant file contents + conventions as context
- [ ] **DEVO-05**: Tester sub-agent runs and diagnoses tests with read+run tools, receives changed files and project info (package manager, test runner)
- [ ] **DEVO-06**: New Temporal activity `runOrchestratorPreApproval` — research + plan → returns plan for approval
- [ ] **DEVO-07**: New Temporal activity `runOrchestratorPostApproval` — execute + test + PR → returns PR details
- [ ] **DEVO-08**: New Temporal activity `handleOrchestratorFeedback` — address PR review comments → returns updated files
- [ ] **DEVO-09**: Orchestrator decides whether research is needed based on task complexity (README edit → skip, feature → research)
- [ ] **DEVO-10**: Orchestrator decides plan granularity (trivial change → brief plan, complex → detailed breakdown)
- [ ] **DEVO-11**: LLM-diagnosed error recovery — when tests fail, agent reads error output, diagnoses cause, and fixes (not blind retry)
- [ ] **DEVO-12**: Orchestrator decides test approach based on task (docs-only → no tests, feature → unit tests, API change → integration tests)
- [ ] **DEVO-13**: Escalation after 3 distinct approaches fail (LLM must try different approach each time, not identical retries)
- [ ] **DEVO-14**: System prompt includes agent identity, issue details, project conventions, constraints, available tools, sub-agent guidance
- [ ] **DEVO-15**: Simplified Temporal workflow: setup → pre-approval loop → approval wait → post-approval loop → PR wait → feedback loop → complete

### Product Agent

- [ ] **PROD-01**: Single agentic loop replaces the 6-node LangGraph graph (classify→analyze→clarify→confirm→create→notify)
- [ ] **PROD-02**: Adapts to input clarity — clear request with all details creates issue immediately (1-2 tool calls), vague request asks focused clarifying questions
- [ ] **PROD-03**: Multi-turn conversation via Temporal `userReplySignal` waits between turns
- [ ] **PROD-04**: Cancellation intent recognition via LLM reasoning (no hardcoded phrase list like "nevermind", "cancel", "nvm")
- [ ] **PROD-05**: Duplicate detection — searches existing Linear issues before creating, suggests updating existing if similar found
- [ ] **PROD-06**: System prompt includes agent identity, full thread history, issue quality guidelines, clarification guidelines
- [ ] **PROD-07**: Same timeout handling as current (24h reminder, 72h total)

### Smart Router

- [ ] **ROUT-01**: Hybrid routing — deterministic rules for unambiguous events (PR merged, button clicked, etc.), LLM reasoning only for ambiguous events (Slack messages, Linear comments with unclear intent)
- [ ] **ROUT-02**: Replaces hardcoded event switches in `dev-agent/api/events.ts` and `product-agent/api/events.ts`
- [ ] **ROUT-03**: Absorbs approval intent classifier from `dev-agent/classification/approval.ts` into LLM reasoning path
- [ ] **ROUT-04**: Router tools: `query_running_workflows`, `start_workflow`, `signal_workflow`, `send_message` (for clarification)
- [ ] **ROUT-05**: All current event types route correctly: `slack.app_mention.created`, `linear.comment.created`, `slack.block_actions.*`, `github.pull_request.*`, `slack.message.created` in thread
- [ ] **ROUT-06**: Fallback: if LLM routing fails or times out, log the event and alert — do not silently drop events
- [ ] **ROUT-07**: Router iteration limit: 10 (should decide quickly)

### Context Management

- [ ] **CTXM-01**: New database table `agents.context_snapshots` with semantic context (summary, completed_actions, pending_intent, known_issues, project_context, key_files, research_findings, plan)
- [ ] **CTXM-02**: New database table `agents.tasks` with critical structured data (task_id, issue_id, workflow_id, status, container_id, branch_name, pr_number, approval_status, slack_channel)
- [ ] **CTXM-03**: Context written at end of each Temporal activity via LLM self-summarization (one final LLM call) + programmatic extraction for structured fields
- [ ] **CTXM-04**: Context read at start of activity resume — post-approval activity receives summary of research and plan, post-crash resumes from latest snapshot
- [ ] **CTXM-05**: Sub-agent context briefing — orchestrator produces focused brief for each sub-agent (only relevant info, not full history)
- [ ] **CTXM-06**: Drizzle ORM schema definitions in `agents` PostgreSQL schema namespace
- [ ] **CTXM-07**: Database migration for all new tables

### Execution Tracing

- [ ] **TRAC-01**: New database table `agents.execution_traces` with parent/child agent correlation (agent_instance_id, parent_agent_instance_id)
- [ ] **TRAC-02**: Every tool call, tool result, LLM response, agent spawn, and agent complete automatically logged via loop callbacks
- [ ] **TRAC-03**: Token count (input + output) and duration tracked per step
- [ ] **TRAC-04**: Traces queryable by task_id, workflow_id, and agent_instance_id
- [ ] **TRAC-05**: No manual instrumentation required — tracing is a runtime responsibility built into `runAgentLoop()`

### Guardrails & Hardening

- [ ] **GUAR-01**: All `run_command` tool calls execute inside DevContainerManager sandbox — no host access
- [ ] **GUAR-02**: Agents cannot call `merge_pull_request` — human merges only
- [ ] **GUAR-03**: Configurable guardrail values via AgentConfig (iteration limits, token budgets, model selection)
- [ ] **GUAR-04**: Temporal activity retry config designed for agentic loops — appropriate retry count and backoff for LLM-heavy activities
- [ ] **GUAR-05**: Token budget enforcement — loop checks remaining budget before each LLM call, terminates gracefully if exhausted
- [ ] **GUAR-06**: Cost tracking per task — total tokens (input + output) aggregated across orchestrator and all sub-agents
- [ ] **GUAR-07**: All `@langchain/*` dependencies removed from `@aesir/agents`: `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`
- [ ] **GUAR-08**: LangGraph code deleted: graph definitions, node implementations, state schemas, phase enums, `routeByPhase()`, `code-workflow/` directory
- [ ] **GUAR-09**: `PostgresSaver` checkpointer removed — replaced by agents.context_snapshots

### End-to-End Validation

- [ ] **E2EV-01**: Full flow works: Slack message → product agent → Linear issue → dev agent → approved PR
- [ ] **E2EV-02**: README edit completes in under 10 tool calls, no test execution, no unnecessary research
- [ ] **E2EV-03**: Simple feature: dev agent implements function, writes tests, runs with correct package manager (pnpm), creates PR
- [ ] **E2EV-04**: Test failure recovery: agent reads error, diagnoses cause (wrong command, missing dependency, code bug), and fixes — not blind retry
- [ ] **E2EV-05**: Product agent adapts: clear request → issue in 1-2 turns, vague request → asks questions
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
| Parallel sub-agents | Dev workflow is sequential (research→plan→code→test). Parallel adds complexity without benefit. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOOP-01 through LOOP-09 | TBD | Pending |
| TOOL-01 through TOOL-08 | TBD | Pending |
| DEVO-01 through DEVO-15 | TBD | Pending |
| PROD-01 through PROD-07 | TBD | Pending |
| ROUT-01 through ROUT-07 | TBD | Pending |
| CTXM-01 through CTXM-07 | TBD | Pending |
| TRAC-01 through TRAC-05 | TBD | Pending |
| GUAR-01 through GUAR-09 | TBD | Pending |
| E2EV-01 through E2EV-11 | TBD | Pending |

**Coverage:**
- v2.2 requirements: 67 total
- Mapped to phases: 0
- Unmapped: 67 ⚠️

---
*Requirements defined: 2026-01-29*
*Last updated: 2026-01-29 after initial definition*
