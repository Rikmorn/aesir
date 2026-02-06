# Project Research Summary

**Project:** Aesir v2.5 Agentic Conversations
**Domain:** Agent coordination system with task primitives and conversation continuity
**Researched:** 2026-02-06
**Confidence:** HIGH

## Executive Summary

v2.5 Agentic Conversations adds task primitives, conversation reopening, and integration correlation to the existing Postgres-backed agent system. The research across stack, features, architecture, and pitfalls converges on a clear conclusion: this is an evolutionary milestone, not a revolutionary rewrite. Zero new runtime dependencies are needed -- the task primitive is a Postgres table, correlation tables live in existing integration schemas, and conversation reopening is a surgical extension of the existing signal mechanism.

The recommended approach is incremental deployment in four phases: prompt rewrites first (zero infrastructure risk, immediate quality improvement), conversation reopening second (establishes the signal pattern needed by task routing), task primitive with tools third (the new coordination layer), and prompt evolution fourth (agents learn to leverage tasks). This ordering minimizes risk by building on validated infrastructure before introducing novel capabilities. Each phase is independently deployable and backward-compatible.

The critical risk is not technical complexity but behavioral correctness. The task primitive is genuinely novel -- no major agent framework persists tasks as first-class database entities. Agent-authored handoffs are untested at this scale. Prompt rewrites from procedural state machines to constitutional constraints require systematic validation to prevent silent regression. The mitigation is evaluation-first: behavioral test suites before prompt changes, integration tests before correlation deployment, and explicit world-state injection when reopening conversations to prevent the agent from acting on stale context.

## Key Findings

### Recommended Stack

v2.5 requires zero new runtime dependencies. The stack work is schema definitions (Drizzle ORM), validation (Zod), tool registration (existing ToolRegistry), and prompt rewrites (markdown files). The existing Postgres + Drizzle + @anthropic-ai/sdk + pg-boss stack handles everything.

**Core technologies:**
- **Drizzle ORM 0.45.1** -- Schema for tasks, task_handoffs, task_correlations tables following existing patterns (agentsSchema, per-integration schemas, composite indexes)
- **Zod 3.25.67** -- Input validation for 6 new task tools, task lifecycle state machine, handoff content schema enforcement
- **Existing ToolRegistry** -- Registers new `task:` namespace (6 tools) alongside existing coordination, codebase, and integration tools
- **Existing MCP client** -- Extends headers with X-Task-ID for correlation recording (same pattern as X-Agent-ID and X-Correlation-ID)
- **PostgreSQL advisory locks** -- Recommended for task-level event serialization to avoid deadlock with conversation-level SKIP LOCKED

**Critical implementation note:** The existing schema.drizzle.ts contains a legacy `tasks` table from v1/v2. The v2.5 migration must handle this collision -- either drop the legacy table (if empty) or use a different name for the new primitive.

### Expected Features

The feature research validates the v2.5 spec against production agent frameworks and helpdesk systems. Task primitives are genuinely novel -- OpenAI, LangGraph, CrewAI, and Google ADK all treat conversations as the work unit, not tasks. Aesir's persisted, polymorphic, hierarchical task entity enables cross-conversation continuity that no framework provides.

**Must have (table stakes):**
- Task CRUD with status machine (created, active, paused, completed, cancelled) -- standard coordination pattern
- Task-conversation linking via nullable task_id FK -- backward-compatible
- Conversation reopening via reopen signal on terminal conversations -- Zendesk/Intercom pattern
- Integration correlation tables (per-integration) mapping external artifacts to tasks -- Temporal WorkflowId pattern
- 6 agent tools for task lifecycle (create, complete, pause, handoff, list, get_context) -- agent-facing interface
- Task-aware event routing with serialization (one active conversation per task) -- prevents race conditions

**Should have (differentiators):**
- Agent-authored handoffs -- no framework does this; higher potential quality but higher risk
- Polymorphic creator/assignee (agent-to-agent, agent-to-human, human-to-agent) -- forward-looking design
- Task hierarchies with parent-child relationships (max depth 5) -- enables work decomposition
- Constitutional + few-shot prompt rewrites -- validated by Anthropic's own guidance for Opus 4.6
- Integration-layer correlation recording (not router-side matching) -- most accurate boundary
- Routing priority inversion (task reference -> fast-path start -> slow path) -- O(1) DB lookup vs O(n) LLM classification

**Defer (v2+):**
- Agent-to-human task notification pathway (schema supports it, delivery mechanism is future work)
- Cross-agent task discovery for coordination (requires task history to accumulate first)
- Task analytics / cross-session learning (aggregating patterns across completed tasks)
- Proactive task creation (agents identifying work without event triggers, needs scheduling)
- Many-to-many artifact correlation (current design is one-to-one via primary key)

### Architecture Approach

The architecture research confirms that v2.5 is additive, not disruptive. New components (TaskService, 6 task tools, correlation stores per integration) plug into existing infrastructure. Modified components (ConversationExecutor, event routing, MCP client) extend existing patterns without breaking interfaces.

**Major components:**
1. **TaskService** (`framework/task-service.ts`) -- Thin persistence layer for CRUD on tasks/handoffs, no business logic (agent-first principle)
2. **Task tools** (`shared/tools/task/`) -- 6 tools in new `task:` namespace, registered via existing ToolRegistry with taskToolAdapter for DB injection
3. **Correlation stores** (per integration) -- `task_correlations` table in linear.*, github.*, slack.* schemas with (external_type, external_ref) primary key
4. **MCP header extension** -- X-Task-ID added when ToolContext has taskId, integration endpoints record correlation post-success
5. **Conversation reopening** -- Extend signal() to handle reopen on terminal status, transition to queued, append signal as user message
6. **Task-aware routing** -- Pre-router lookup in routeEvent() before EventRouter.handle(), uses FOR UPDATE on task row for serialization
7. **Task context injection** -- In worker-loop executeConversation(), fetch latest handoff and inject as <task_context> block before history compaction

**Critical pattern: Lock ordering** -- If task and conversation both need locks, always acquire task lock first (via advisory lock) then conversation lock (SKIP LOCKED). This prevents deadlock. Recommendation: Use PostgreSQL advisory locks (`pg_advisory_xact_lock(hashtext(task_id))`) for task serialization to keep locks in separate spaces.

**ToolContext.taskId collision** -- Existing field is used for sandbox container ID. Must rename to sandboxId before adding v2.5's task_id field. Affects 10 files: types.ts, worker-loop.ts, 5 codebase tool factories, CodebaseToolDeps type.

### Critical Pitfalls

The pitfalls research identified 7 CRITICAL, 6 MAJOR, 7 MODERATE, and 3 MINOR pitfalls across the four phases. The three highest-severity pitfalls require explicit mitigation:

1. **Conversation Reopening Creates Split-Brain Between History and World State** -- When a conversation completes at T1 and reopens at T2, the agent receives full prior history (factual about what happened) but the world may have changed (PR merged, issue closed, branch deleted). The agent acts confidently on stale information. **Prevention:** Inject a `<world_state>` context block when reopening that queries current state of known artifacts. Add constitutional constraint: "When resuming, verify current state of artifacts before acting." Signal payload must include delta information, not just "reopen."

2. **Task-Level Event Serialization Deadlocks with Conversation-Level SKIP LOCKED** -- The task primitive needs locks at the task level to serialize events. The executor uses SKIP LOCKED at the conversation level. If lock acquisition order is inconsistent, deadlock occurs. **Prevention:** Use advisory locks for task serialization (`pg_advisory_xact_lock(hashtext(task_id))`) -- separate lock space from row locks, cannot deadlock. Document canonical lock order: task first, conversation second.

3. **Prompt Rewrite Silently Regresses Agent Behavior Without Detection** -- Removing procedural state machines from prompts (10+ if/then rules in product-agent) and replacing with constitutional constraints risks losing hard-won behavioral fixes. Each rule exists because the agent failed without it. A 10% regression (95% -> 85% correct) is invisible without systematic evaluation. **Prevention:** Create behavioral test suite BEFORE rewriting (10-15 real scenarios per agent). Use promptfoo or equivalent for regression testing. Deploy with shadow mode (run both prompts, compare outputs). Rewrite incrementally, one behavioral area at a time.

Additional critical pitfall: **schema.drizzle.ts legacy table collision** -- The existing schema.drizzle.ts already has a `tasks` table from v1/v2. The migration must handle this (drop if empty, or use different name). Test migration against a database with the old table present.

## Implications for Roadmap

Based on research, suggested phase structure starting from Phase 56:

### Phase 56: Goal-Oriented Prompt Rewrites
**Rationale:** Zero infrastructure risk, immediate quality improvement. Establishes the constitutional + few-shot style that Phase 59 builds on. Can be done in parallel with Phase 57 but must complete before Phase 59.

**Delivers:**
- Product-agent prompt rewritten (removes state machine, adds constitutional constraints + few-shot examples)
- Dev-agent prompt rewritten (removes complexity classification, adds judgment-based guidance)
- Behavioral test suite for both agents (10-15 scenarios each, baseline established)

**Addresses:**
- MODERATE-6 (constitutional constraint conflicts) via explicit priority and pair testing
- MODERATE-4 (stale few-shot examples) via abstract examples
- CRITICAL-3 (prompt regression) via test suite

**Avoids:** All the procedural state machine anti-patterns documented in PROMPT_GUIDE.md and CRITICAL-3 pitfall.

**Research flag:** Standard patterns (Anthropic's official guidance), no deeper research needed.

---

### Phase 57: Conversation Reopening
**Rationale:** Surgical change to existing executor. Establishes the "signal on terminal conversation" pattern that Phase 58's task routing depends on. Minimal schema change (one new event type).

**Delivers:**
- `signal()` method extended to handle `reopen` signal type on completed/failed conversations
- Transition logic: terminal status -> queued, append signal as user message, reset retry count
- New event type: `agent.reopened` for observability
- Dashboard reopen button (POST /conversations/:id/reopen)

**Uses:** Existing signal infrastructure, FOR UPDATE lock pattern, existing message persistence

**Addresses:**
- CRITICAL-1 (stale world state) via context injection block in reopening flow
- MODERATE-5 (history explosion) via handoff-based context recommendation
- MINOR-3 (signal dedup array growth) via array capping

**Avoids:** New execution path confusion by using existing signal mechanism. Terminal status handling remains explicit (only `reopen` type triggers transition).

**Research flag:** Standard patterns (Zendesk/Intercom reopening), no deeper research needed.

---

### Phase 58: Task Primitive and Task-Aware Routing
**Rationale:** Core coordination capability. Three sub-phases (schema + service, agent tools, routing) must be done sequentially within this phase. Depends on Phase 57 for conversation reopening (used by task routing).

**Sub-phase 58a: Schema + TaskService + ToolContext Rename**
**Delivers:**
- Migration: tasks, task_handoffs tables in agents schema; task_id column on conversations
- Handle schema.drizzle.ts legacy table collision (verify state, DROP or rename)
- TaskService factory (CRUD for tasks/handoffs, thin persistence layer)
- Rename ToolContext.taskId to sandboxId (affects 10 files)
- Add task, handoff ID generators to createId in @aesir/types

**Sub-phase 58b: Agent Tools**
**Delivers:**
- 6 tool implementations in shared/tools/task/ (create_task, complete_task, pause_task, handoff_task, list_tasks, get_task_context)
- Task tool adapter pattern (inject TaskService via closure)
- Register tools in tool-factories.ts under new `task:` namespace
- Add tools to agent definition YAML files
- Set taskId in ToolContext from conv.task_id in worker-loop

**Sub-phase 58c: Task-Aware Routing + Integration Correlation**
**Delivers:**
- Task correlation tables in linear.*, github.*, slack.* schemas (external_type, external_ref PK)
- Correlation store per integration (record, lookup methods)
- MCP header extension: X-Task-ID in callMcpTool(), correlation recording in integration endpoints
- Task routing pre-check in routeEvent() with FOR UPDATE on task row (advisory lock recommended)
- Task context injection in worker-loop executeConversation() (latest handoff as <task_context>)
- Add taskId to NormalizedEvent, IncomingEvent schemas
- Integration webhook handlers: correlation lookup before event dispatch

**Uses:** Existing Drizzle ORM patterns, existing ToolRegistry, existing MCP client, existing EventRouter (extended), existing DB transaction patterns

**Implements:** TaskService component, task tools, correlation stores, task-aware routing layer

**Addresses:**
- CRITICAL-2 (deadlock) via advisory locks for task serialization
- CRITICAL-4 (schema collision) via explicit migration handling
- MAJOR-1 (correlation recording failure) via optimistic correlation or reconciliation job
- MAJOR-2 (task metadata bloat) via Zod schema with size limits
- MAJOR-5 (backward compatibility) via hasTask helper, null-safe code paths
- MAJOR-6 (circular delegation) via ancestry checks, max_subtasks_per_task limit

**Avoids:** Framework pattern-matching on handoff types (agent decides), auto-completion on external signals (agent decides), eager context loading (deliver latest handoff, tool for full history).

**Research flag:** Integration-specific edge cases need testing (Slack thread forking, GitHub force push, Linear status changes) -- these are MODERATE severity, handle as known limitations with fallback to slow path.

---

### Phase 59: Prompt Evolution for Task Lifecycle
**Rationale:** Agents learn to leverage task tools. Depends on Phase 58b (task tools exist) and Phase 56 (constitutional + few-shot style established). Updates all agent prompts, not just orchestrators.

**Delivers:**
- Update agent prompts to reference task lifecycle (create tasks for decomposition, complete on finish, pause with context, handoff with agent-authored content)
- Add handoff quality examples (few-shot with good/bad handoffs, structured content guidance)
- Add task-aware context section (<task_context> handling when present, fallback when absent)
- Constitutional constraint for handoffs: structured content requirements, token budget per handoff

**Uses:** Existing prompt.md structure, task tools from Phase 58b, PROMPT_GUIDE.md patterns

**Addresses:**
- MAJOR-3 (handoff telephone game) via structured handoff schema, full history access via get_task_context
- MODERATE-7 (bad handoffs) via structured schema enforcement, size limits, validation

**Avoids:** Prescriptive tool sequences (agent decides when to create/hand off tasks), state machines in natural language.

**Research flag:** Handoff quality validation needed -- this is novel territory, no production validation exists. Consider shadow testing handoff content (LLM-as-judge on handoff quality).

---

### Phase Ordering Rationale

- **Phase 56 first:** Prompt rewrites are independent and establish the style for Phase 59. Can be done in parallel with Phase 57 but must complete before Phase 59 to avoid conflicting prompt patterns.
- **Phase 57 second:** Conversation reopening is the simplest infrastructure change and establishes the signal pattern that Phase 58's task routing uses (reopened conversations are queued, task routing can create new conversations or signal existing ones).
- **Phase 58 third:** Task primitive is the core capability but requires three sequential sub-phases. Schema + service must exist before tools, tools must exist before routing can use them. Sub-phase 58c (correlation + routing) is the most complex and touches three integration packages.
- **Phase 59 fourth:** Prompt evolution requires task tools to be available and the constitutional + few-shot style to be established. This is where agents learn to actually use the task lifecycle.

**Dependency chain visualization:**
```
Phase 56 (Prompts) ────────────────────────────────────┐
                                                        ├──> Phase 59 (Prompt Evolution)
Phase 57 (Reopening) ──> Phase 58 (Task Primitive) ────┘
                         (58a -> 58b -> 58c sequentially)
```

**Risk mitigation through ordering:** Phases 56 and 57 are low-risk infrastructure extensions with clear rollback paths. Phase 58 is higher risk (new schema, new tools, routing changes) but is broken into three sub-phases that can each be validated before proceeding. Phase 59 is prompt-only (rollbackable) but depends on validated infrastructure.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 58c (Integration Correlation):** Each integration has edge cases (Slack thread forking, GitHub force push/branch reuse, Linear status change noise). The research identified these as MODERATE severity -- known limitations with slow-path fallback. During planning, decide which edge cases to handle in v2.5 vs document as known limitations.

**Phases with standard patterns (skip research-phase):**
- **Phase 56:** Anthropic's official prompt engineering guidance is comprehensive. The PROMPT_GUIDE.md is already written. No additional research needed.
- **Phase 57:** Zendesk/Intercom reopening patterns are well-documented. The existing signal infrastructure is well-understood. No additional research needed.
- **Phase 58a/58b:** Drizzle ORM patterns, ToolRegistry patterns, and ToolFactory patterns are all established in the codebase. Schema migration for a new table is standard. No additional research needed.
- **Phase 59:** This builds on Phase 56's style and uses Phase 58's tools. The uncertainty is handoff quality validation (novel), but this is an execution concern, not a research gap.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All patterns exist in codebase. Schema.drizzle.ts collision identified and mitigated. |
| Features | HIGH | Task primitives validated against 5 major frameworks (genuinely novel). Conversation reopening validated against Zendesk/Intercom. Integration correlation validated against Temporal WorkflowId pattern. |
| Architecture | HIGH | Based on direct codebase analysis. All modified components identified. Lock ordering and serialization patterns verified against PostgreSQL docs. |
| Pitfalls | HIGH | 23 pitfalls identified from PostgreSQL docs, prompt engineering literature, multi-agent system research, and direct codebase analysis. Each pitfall has prevention strategy and warning signs. |

**Overall confidence:** HIGH

The research converges on a clear implementation path. The stack is proven, the features are validated against production systems, the architecture is additive, and the pitfalls are well-characterized with concrete prevention strategies.

### Gaps to Address

**Agent-authored handoff quality:** No production system has validated agent-authored handoffs at this level. The research identifies this as a differentiator but also a risk (MAJOR-3 telephone game effect, MODERATE-7 bad handoffs). **Mitigation during planning:** Define structured handoff schema with required fields. Add handoff size limits. Include handoff quality examples in prompts. Consider LLM-as-judge evaluation for handoff content quality.

**Integration correlation edge cases:** The one-to-one correlation model (PK on external_type + external_ref) may be too restrictive for monorepo PRs fixing multiple issues. Slack thread forking, GitHub force push, and Linear status change noise are documented edge cases. **Mitigation during planning:** Accept one-to-one as MVP constraint. Route edge cases to slow path. Monitor correlation miss rate. Add many-to-many support in later milestone if needed.

**Conversation reopening world state drift:** The CRITICAL-1 pitfall (stale context on reopen) requires explicit world-state injection. The architecture research defines the pattern (context injection block), but the specific implementation needs validation. **Mitigation during planning:** Define which artifacts to query on reopen (correlated PRs, issues, threads). Implement context injection in Phase 57. Test with real external state changes between conversation runs.

**Prompt regression detection:** The behavioral test suite created in Phase 56 is new infrastructure. The project does not currently have prompt evaluation tooling. **Mitigation during planning:** Choose evaluation tool (promptfoo recommended), define test case format, establish baseline before rewrite. This is a one-time setup cost that pays dividends across all future prompt changes.

## Sources

### Primary (HIGH confidence)

**Stack research:**
- Anthropic Prompting Best Practices (Claude 4.6): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices
- Drizzle ORM Schema Declaration: https://orm.drizzle.team/docs/sql-schema-declaration
- PostgreSQL Explicit Locking Documentation: https://www.postgresql.org/docs/current/explicit-locking.html
- Existing codebase (packages/agents/src/framework/, packages/agents/src/shared/db/schema.ts, packages/integrations/*/src/db/schema.ts)

**Features research:**
- OpenAI Agents SDK Handoffs: https://openai.github.io/openai-agents-python/handoffs/
- CrewAI A2A Agent Delegation: https://docs.crewai.com/en/learn/a2a-agent-delegation
- LangGraph Persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- Google ADK Multi-Agents: https://google.github.io/adk-docs/agents/multi-agents/
- Zendesk Ticket Lifecycle: https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses
- Intercom Fin AI Agent: https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained
- Temporal Continue-As-New: https://docs.temporal.io/workflow-execution/continue-as-new
- GitHub Webhook Events: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- Linear Developers Webhooks: https://linear.app/developers/webhooks

**Architecture research:**
- Existing codebase (direct analysis of conversation-executor.ts, event-router.ts, worker-loop.ts, tool-factories.ts, mcp/client.ts)
- .planning/specs/2.5-agentic-conversations.md (implementation spec)
- .planning/specs/2.5-design-vision.md (architectural rationale)
- packages/agents/definitions/PROMPT_GUIDE.md (prompt authoring guide)

**Pitfalls research:**
- PostgreSQL JSONB and TOAST Performance: https://pganalyze.com/blog/5mins-postgres-jsonb-toast
- Debugging Deadlocks in Postgres (incident.io): https://incident.io/blog/debugging-deadlocks-in-postgres
- promptfoo regression testing: https://github.com/promptfoo/promptfoo
- Best Prompt Evaluation Tools 2025 (Braintrust): https://www.braintrust.dev/articles/best-prompt-evaluation-tools-2025
- Constitutional AI (Anthropic): https://arxiv.org/abs/2212.08073
- How Agent Handoffs Work (Towards Data Science): https://towardsdatascience.com/how-agent-handoffs-work-in-multi-agent-systems/
- Zendesk Context Panel: https://internalnote.com/context-in-zendesk/

### Secondary (MEDIUM confidence)

**Features research:**
- Microsoft Agent Framework Introduction: https://azure.microsoft.com/en-us/blog/introducing-microsoft-agent-framework/
- Top 7 Agentic AI Frameworks in 2026: https://www.alphamatch.ai/blog/top-agentic-ai-frameworks-2026
- Taxonomy of Hierarchical Multi-Agent Systems: https://arxiv.org/html/2508.12683

**Pitfalls research:**
- AI Agent Failures: Prompt Design Fixes: https://ctimes.tech/en/2026/01/08/ai-agent-failures-prompt-design-fixes-4-common-issues/
- Agent Handoffs Without Chaos: https://medium.com/@Quaxel/your-first-multi-agent-handoff-without-chaos-a9fe116c7812
- Slack thread_ts limitations: https://api.slack.com/incoming-webhooks
- CircleCI webhook duplication: https://support.circleci.com/hc/en-us/articles/115013353748-Troubleshooting-duplicate-builds-triggered-upon-every-commit-push

---
*Research completed: 2026-02-06*
*Ready for roadmap: yes*
