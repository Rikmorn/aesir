# Domain Pitfalls: Multi-Agent Collaboration (v2.7)

**Domain:** Adding cross-agent delegation, shared memory, and completion signaling to an existing isolated-conversation system
**Researched:** 2026-02-10
**Overall confidence:** HIGH (based on deep codebase analysis + external research on multi-agent failure modes)

**Key insight from research:** Multi-agent LLM systems fail at 41-86.7% rates in production (arxiv.org/html/2503.13657v1). The primary failure categories are specification/coordination (79% combined), not infrastructure. The biggest risk to Aesir is not building the infrastructure wrong -- it is introducing coupling that breaks the reliable isolated-agent flows that work today.

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, cascading failures, or break existing single-agent functionality.

---

### CRITICAL-1: Completion Signal Lost to Terminal Conversation

**What goes wrong:** Agent A delegates to Agent B, calls `wait_for` with type `task_completion`, and pauses. Agent B finishes and the system fires a completion signal to Agent A's conversation. But Agent A's conversation has already been moved to a terminal state (failed due to timeout, cancelled by user, or garbage-collected). The signal is rejected because `executor.signal()` rejects signals to terminal conversations. The completion result is silently lost -- no one picks up Agent B's work output.

**Why it happens:** The current `signal()` implementation returns `{ action: "rejected" }` for terminal conversations (line 480 of conversation-executor.ts). This is correct for the current system where signals come from external events (PR reviews, user replies) that are contextual to an active conversation. But completion signals from delegated tasks represent *work product* -- losing them means wasted compute and broken workflows.

**Consequences:**
- Agent B completes substantial work (e.g., full PR implementation) but the delegator never sees the result
- The task tree shows subtask completed but parent task has no reaction -- work is orphaned
- Users see a failed parent conversation and a completed subtask with no connection between them
- Worst case: the system re-delegates the same work, burning tokens and creating duplicate PRs

**Prevention:**
- Add orphan-aware signal handling: when a completion signal targets a terminal conversation, log the completion in `agent_events` with a new event type (`signal.orphaned`) and store the full payload
- Add a `callbackConversationId` field to tasks (SIG-03 in spec) and check it before signal dispatch -- if the callback conversation is terminal, persist the result on the task itself (new `completion_result` JSONB column on tasks table)
- The dashboard must surface orphaned completions prominently (Phase 75 OBS-05)
- Consider a reopen-on-completion pattern: if the callback conversation is terminal but the task has meaningful results, automatically reopen the delegating conversation with the completion data

**Phase to address:** Phase 74 (Completion Signaling) -- this is the core problem the phase must solve
**Detection:** Monitor for `signal.orphaned` events; alert if count exceeds threshold per day

---

### CRITICAL-2: Delegation Depth Explosion and Management-Layer Anti-Pattern

**What goes wrong:** Agents start delegating instead of doing work. Product-agent delegates to dev-agent, dev-agent delegates a "research" task back to a new researcher via task delegation (not sub-agent spawn), that researcher delegates a "specific file lookup" to another agent. Four conversations running, four token budgets consumed, when a single sub-agent spawn would have sufficed. The system becomes a bureaucracy -- agents that only coordinate, never execute.

**Why it happens:** The spec correctly identifies this risk (DEL-07: "Delegation judgment guidance") but prompt-level guidance alone is insufficient. LLMs are biased toward delegation when they have delegation tools -- it feels like "doing something" without the cognitive load of actually solving the problem. Research shows agents in multi-agent systems duplicate effort and over-delegate, with "agents ping-pong the same task, each replanning because no one knows who owns it" (Augment Code analysis, 2025).

**Consequences:**
- Token budget consumed by coordination overhead (4x conversations for 1x unit of work)
- Latency explosion: each delegation hop adds handshake time + conversation startup time + LLM reasoning time
- Context dilution: each delegation step loses nuance from the original request (the "telephone game" effect documented in multi-agent research)
- Debugging nightmare: tracing failures across 4 conversations vs. reading 1 conversation log

**Prevention:**
- Enforce the sub-agent vs. delegation distinction architecturally, not just in prompts: sub-agents (coder, researcher, tester) are spawned within the parent's conversation and share its token budget. Cross-conversation delegation is only for orchestrator-to-orchestrator or orchestrator-to-human handoffs
- The existing `MAX_TASK_DEPTH = 5` limit (create-task.ts) is too generous for v1. Start at depth 3 (orchestrator -> orchestrator -> sub-agent is natural; deeper chains are almost certainly over-delegation). Increase only with evidence
- Add a `delegationBudget` concept: each task tree has a maximum total token budget across all conversations. When a delegation creates a new conversation, it draws from the tree budget, not an unlimited pool
- Track delegation-to-work ratio in the dashboard: if an agent creates more subtasks than tool calls, surface it as a health warning (Phase 75 OBS-05)
- Prompt guidance must be specific: "Use sub-agents (spawn_agent) for focused execution work within your expertise. Use task delegation only when the work genuinely requires a different agent's capabilities or a human's judgment."

**Phase to address:** Phase 73 (Task Delegation) must enforce architectural guardrails; Phase 76 (QA Agent) will stress-test depth limits
**Detection:** Dashboard metric: delegation depth per task tree, delegation-to-work-tool ratio per agent

---

### CRITICAL-3: Circular Wait / Deadlock Between Delegating Agents

**What goes wrong:** Agent A delegates to Agent B and calls `wait_for` expecting a `task_completion` signal. Agent B, while working, needs clarification and delegates back to Agent A (or signals Agent A for input). But Agent A is in `waiting` status -- it can only be woken by a signal matching its `pending_wait.type`. If Agent B sends a `clarification` signal but Agent A is waiting for `task_completion`, the signal is rejected (type mismatch, line 376 of conversation-executor.ts). Agent B is blocked waiting for clarification. Agent A is blocked waiting for completion. Deadlock.

**Why it happens:** The current `wait_for` mechanism is single-type: when an agent pauses, it specifies exactly which signal type will wake it. This is perfect for the current use case (wait for PR review, wait for approval) where the expected signal is well-defined. But delegation introduces bidirectional signaling -- the delegator needs to respond to both completions AND clarification requests from the delegate.

**Consequences:**
- Both conversations stuck in `waiting` state indefinitely
- pg-boss timeout eventually fires for both, waking them with unhelpful timeout messages
- The agents wake up, see a timeout, and have no way to know the other agent was trying to communicate
- If timeout fires for A first, A might re-delegate to a different agent, abandoning B's partial work
- Resource leak: waiting conversations hold message history in JSONB; many deadlocked conversations = database bloat

**Prevention:**
- Modify `wait_for` to accept multiple signal types: `wait_for({ types: ["task_completion", "task_clarification", "task_failed", "task_timeout"] })`. The `pending_wait.type` becomes `pending_wait.types` (array). Signal type matching checks membership in the array
- Alternative: add a `wait_for_task` variant that automatically registers for all task-lifecycle signal types (completion, failure, clarification, timeout). This keeps the simple `wait_for` for non-delegation use cases
- Enforce that delegators always include clarification in their wait types -- prompt guidance alone will not suffice because agents forget
- Add deadlock detection: a scheduled job that scans for pairs of conversations both in `waiting` status where each has a task referencing the other's callback conversation. Surface these in the dashboard

**Phase to address:** Phase 74 (Completion Signaling) for multi-type wait_for; Phase 73 (Task Delegation) for the `wait_for_task` variant
**Detection:** Scheduled query: `SELECT pairs FROM conversations WHERE status = 'waiting' AND circular_reference_exists`

---

### CRITICAL-4: Shared Memory Poisoning via Confident Hallucination

**What goes wrong:** Agent A discovers something about the codebase (e.g., "the auth middleware is located at src/middleware/auth.ts and uses JWT") and stores it via `knowledge:store` with high confidence. Later, the codebase changes -- auth moves to a different file or switches to session-based auth. Agent B queries shared memory, gets the stale entry, and proceeds based on wrong information. Worse: Agent B might store a *derived* conclusion ("since auth uses JWT, we need to validate tokens in the middleware") that reinforces the original wrong fact. The knowledge store becomes a self-reinforcing echo chamber of stale data.

**Why it happens:** LLMs assign confidence based on how certain they *feel* about information, not based on when they verified it or how it was obtained. Research on memory poisoning shows "a single compromised agent poisoned 87% of downstream decision-making within four hours" in simulated multi-agent systems (MintMCP, 2025). The stale data variant is less dramatic but more insidious -- the information was correct when stored, so there is no malicious intent to detect.

**Consequences:**
- Agents make decisions based on outdated codebase knowledge, leading to incorrect code changes
- Derived knowledge compounds the error -- two levels of wrong is harder to debug than one
- Trust in the knowledge store degrades, potentially causing agents to ignore valid knowledge
- Debugging difficulty: the root cause (stale knowledge entry) may be far removed from the symptom (broken code)

**Prevention:**
- All codebase-related knowledge entries must have mandatory `expiry` based on category: file locations expire in 24h, architecture decisions in 7d, general patterns in 30d. Never allow indefinite expiry for codebase facts
- Attach `source_hash` to knowledge entries: hash the source evidence (file content, tool result) that led to the knowledge. On query, optionally verify the source still matches (expensive but available for critical decisions)
- Knowledge entries store `verification_date` -- the last time the claim was independently verified. Query ranking should penalize entries with old verification dates
- Prevent derived-knowledge reinforcement loops: if Agent B stores knowledge that cites Agent A's knowledge entry as its source, and Agent A's entry expires, Agent B's derived entry should also be flagged for re-verification
- Start with a conservative scope for v1: only `discovery` and `constraint` types in shared memory. `architecture_decision` entries should require human confirmation before entering the shared pool

**Phase to address:** Phase 71 (Shared Memory) must implement expiry and verification infrastructure
**Detection:** Dashboard view of knowledge entries by age, confidence, verification date; alert on entries past 2x their intended expiry

---

### CRITICAL-5: Linear OAuth Token Migration Breaks Running Conversations

**What goes wrong:** The migration from long-lived OAuth tokens (valid ~10 years) to short-lived tokens (24h) with refresh tokens happens while agents have active conversations. The old token is migrated via `POST /oauth/migrate_old_token`, invalidating it immediately. Any in-flight MCP calls using the old token fail. If the refresh token rotation fails (Linear rotates refresh tokens, old one becomes unusable immediately), the entire integration goes dark -- no outbound communication to Linear until manual re-auth.

**Why it happens:** Linear's April 1, 2026 deadline for refresh token migration forces a token format change. The current credential store (`linear.credentials`) stores long-lived tokens and has no refresh logic. The migration endpoint returns a new short-lived token + refresh token, but existing code has no token refresh middleware. The `createLinearClientFromDatabase` factory creates a client once with a token and does not handle 401 retries with token refresh.

**Consequences:**
- All Linear MCP tool calls fail with 401 for up to 24 hours until someone notices
- The denormalizer cannot post agent activities to Linear -- agent appears unresponsive
- Webhook echo filtering (currently via `LINEAR_BOT_USER_ID`) continues working but outbound is broken
- If refresh token rotation fails, manual OAuth re-authorization is required (workspace admin)
- Running dev-agent conversations that need to post to Linear will fail and potentially exhaust retries

**Prevention:**
- Implement token refresh middleware in the Linear client factory BEFORE the `actor=app` migration. This is a prerequisite, not a phase 70 feature -- existing OAuth tokens also face the April 2026 deadline
- Use the migration endpoint (`POST /oauth/migrate_old_token`) in a maintenance window, not on-the-fly. Announce the migration, drain active conversations, migrate, verify, then resume
- Add 401 retry logic to `callMcpTool` that triggers a token refresh and retries once before propagating the error
- Store both access_token and refresh_token in `linear.credentials` with an `expires_at` timestamp. Proactively refresh tokens before expiry (e.g., at 80% of lifetime = ~19 hours)
- Test the migration path in a staging workspace first -- token migration is irreversible

**Phase to address:** Phase 70 (Linear Agent SDK) -- token refresh must be plan 70-01, not an afterthought
**Detection:** Monitor 401 error rates on Linear MCP tools; alert if > 0 within a 5-minute window

---

## High-Severity Pitfalls

Mistakes that cause significant issues but are recoverable without rewrites.

---

### HIGH-1: Fan-Out Delegation with Partial Completion

**What goes wrong:** Product-agent delegates three related subtasks to dev-agent simultaneously (e.g., "implement API endpoint", "add database migration", "update tests"). Two complete successfully, one fails. Product-agent receives two completion signals and one failure signal. It needs to decide: roll back the completed work? Proceed with partial results? Re-delegate the failed task? The agent has no framework-level support for this -- it must reason about partial completion from raw signal data.

**Why it happens:** The spec mentions parallel delegation as an open question (DEL, open question 3) but does not prescribe a solution. The existing task tree structure supports fan-out (multiple subtasks with the same parent) but has no concept of "all-or-nothing" or "partial completion policy." The agent receives individual completion/failure signals with no aggregation.

**Consequences:**
- Inconsistent state: two features merged but tests for the third are missing
- Agent makes poor partial-completion decisions (e.g., declaring success when 2/3 subtasks completed)
- Difficult to reason about: the agent sees signals arrive over time, with context fading between each

**Prevention:**
- For v1, strongly discourage parallel delegation in prompts. Sequential delegation (A then B then C) is simpler and avoids partial-completion ambiguity
- If parallel delegation is needed, add a `task_group` concept: subtasks can be grouped with a completion policy (`all_required`, `any_sufficient`, `majority`). The system aggregates completion signals and fires a single group-completion signal to the delegator
- At minimum, the delegator's wait_for must handle multiple completion signals for the same delegation batch. The `wait_for_task` variant should accept a list of subtask IDs to wait for
- Add a `delegated_subtask_ids` field to the parent task's metadata so the delegator can track which subtasks are outstanding when it wakes up

**Phase to address:** Phase 73 (Task Delegation) should implement sequential-only for v1; Phase 74 (Completion Signaling) should handle the aggregation if parallel is allowed
**Detection:** Task tree queries that show parent tasks with mixed-status subtasks

---

### HIGH-2: Entity Directory Returns Stale or Incorrect Capabilities

**What goes wrong:** The entity directory is seeded from YAML definitions at deploy time. Between deploys, capabilities change (a new agent is defined, an agent's tools change, a human's role changes). The directory is stale. Agent A queries "who can run tests?" and gets no results because the QA agent was added after the last seed. Or worse, the directory returns an agent whose capabilities were reduced -- the delegation fails after the handshake because the target cannot actually do the work.

**Why it happens:** The directory is a projection of YAML + config at a point in time. It has no live-update mechanism. The spec acknowledges this as open question DIR-04 ("Directory staleness -- re-seed on deploy?") but does not prescribe a solution.

**Consequences:**
- Delegation to non-existent or incapable agents, wasting a handshake round-trip
- Agents fall back to hardcoded agent IDs in their prompts, bypassing the directory entirely
- Human entries become stale as team members change roles or Slack channels

**Prevention:**
- Re-seed the directory on every deploy (add to CI/CD pipeline or service startup)
- Add a `last_seeded_at` timestamp to the directory table. The `directory:find` tool should warn if the directory is older than 24 hours
- For human entries, consider a periodic validation job (ping the Slack channel to verify it exists)
- The negotiation handshake (Phase 73) is the safety net: if the directory is wrong, the target agent rejects the task with a capability mismatch reason. The delegator retries with a different entity. This is why the handshake is critical -- it validates directory claims at runtime
- Do not allow agents to cache directory results across conversations. Each delegation should query fresh

**Phase to address:** Phase 72 (Entity Directory) for seeding infrastructure; Phase 73 (Task Delegation) for handshake as runtime validation
**Detection:** Dashboard metric: handshake rejection rate by reason. High "capability mismatch" rejections indicate stale directory

---

### HIGH-3: Callback Routing Breaks When Conversations Are Re-Triggered

**What goes wrong:** Agent A delegates a task with `callbackConversationId = "product-agent-FEAT-123"`. Agent A's conversation fails and is re-triggered as `"product-agent-FEAT-123-r2"` (the existing re-trigger mechanism, line 227 of conversation-executor.ts). Agent B completes and signals `"product-agent-FEAT-123"` -- the original, now-terminal conversation. The signal is rejected. The new conversation `"product-agent-FEAT-123-r2"` never receives the completion.

**Why it happens:** The re-trigger mechanism creates a new conversation with a suffixed ID. The callback stored in the delegated task still points to the original ID. There is no mechanism to update callback targets when conversations are re-triggered.

**Consequences:**
- Completion signals lost to terminal conversations (compounds with CRITICAL-1)
- The re-triggered conversation has no way to know about the delegation from the previous attempt
- Task tree shows completed subtask but the parent task's conversation is a dead end

**Prevention:**
- When a conversation is re-triggered, check if any active tasks have `callbackConversationId` pointing to the old ID. Update them to the new ID
- Store `callbackConversationId` resolution as a query, not a static value: "look up the latest active conversation for correlation key X" rather than "signal conversation ID Y"
- Alternative: callback routing should resolve through the task, not the conversation. When a subtask completes, look up the parent task, find the most recent active conversation for that task, and signal it. This is more robust than direct conversation ID references
- The re-trigger mechanism already preserves context from the previous attempt (line 239 of conversation-executor.ts). Extend this to include "pending delegated subtasks" information

**Phase to address:** Phase 74 (Completion Signaling) -- callback resolution strategy is the core design decision
**Detection:** Monitor for signals sent to conversation IDs with `-r` suffixes that no longer exist

---

### HIGH-4: History Compaction Destroys Delegation Context

**What goes wrong:** Agent A has a long conversation. It delegates to Agent B, pauses, and waits. When Agent B completes 2 hours later, Agent A resumes. The history manager compacts the conversation, and the delegation context (what was delegated, to whom, what was expected, the task IDs) gets summarized away. Agent A resumes with a summary that says "previously delegated work to dev-agent" but lacks the specific task ID, expected artifacts, or success criteria. The completion signal payload helps, but the agent has lost the reasoning context for what to do with the results.

**Why it happens:** The history manager (history-manager.ts) summarizes old messages when token count exceeds `pruneThreshold`. Delegation context is just another tool call result in the message history -- it gets the same treatment as any other old message. With a 2-hour wait and a complex conversation before the delegation, the delegation tool calls are very likely to be outside the `protectedMessages` boundary.

**Consequences:**
- Agent makes poor post-delegation decisions because it lacks context about what was delegated and why
- Agent re-delegates the same work because it doesn't remember the first delegation
- Agent ignores completion results because it can't match them to the original delegation intent

**Prevention:**
- Completion signal payloads must be self-contained: include the original task description, expected outcomes, and results. The agent should be able to resume from the signal payload alone without relying on conversation history
- Add delegation metadata to the conversation row (new JSONB column `active_delegations`) that survives history compaction. Track `{ taskId, delegateId, expectedOutcome, delegatedAt }` for each outstanding delegation
- The history manager should treat delegation tool calls (`task:delegate`, `wait_for` with task context) as protected messages that resist summarization, similar to how `<summary>` blocks are detected
- On resume after delegation, inject a `<delegation_context>` block (analogous to `<task_context>`) that provides structured information about the delegation, regardless of what the history manager did

**Phase to address:** Phase 74 (Completion Signaling) for self-contained signal payloads; Phase 73 (Task Delegation) for delegation context preservation
**Detection:** Monitor for agents that re-delegate tasks that already have completed subtasks

---

### HIGH-5: Agent Session Lifecycle Mismatch With Conversation Lifecycle

**What goes wrong:** Linear's Agent SDK expects agents to emit activities within specific timeframes: acknowledge within 10 seconds (emit a `thought` activity), then continue emitting activities while working. The Aesir conversation lifecycle is asynchronous -- a conversation is created as `queued`, waits for a worker to claim it (up to 5 seconds poll interval), then starts the agent loop. If the worker pool is busy (concurrency limit 3), the conversation might wait minutes to be claimed. Linear shows the agent session as unresponsive, and the user sees no acknowledgment.

**Why it happens:** Linear's agent session model assumes synchronous processing: webhook arrives, agent processes, agent responds. Aesir's model is async: webhook arrives, conversation is queued, conversation is claimed when a worker is available, agent processes. The gap between "conversation created" and "first agent activity" can be significant under load.

**Consequences:**
- Linear UI shows "agent is not responding" for sessions that are actually queued
- Users lose trust in the agent and start doing the work themselves
- If Linear has a hard timeout on initial response (the 10-second requirement), the session may be marked as errored before the agent even starts

**Prevention:**
- Emit a `thought` activity immediately when the webhook is received, before queuing the conversation. This is an infrastructure concern, not an agent decision -- the adapter or webhook handler should call `createAgentActivity({ type: "thought", content: "Starting work..." })` synchronously during event processing
- Track the Linear `agentSessionId` in the conversation row (or replyContext) so the denormalizer can map conversation events to Linear session activities
- Map conversation lifecycle events to Linear session states: `queued` -> `pending`, `running` -> `active`, `waiting` -> `awaitingInput`, `completed` -> `complete`, `failed` -> `error`
- Add periodic "heartbeat" activities while the agent is working (e.g., emit a `thought` activity every 60 seconds with current status). This requires the worker loop to emit outbound activities independent of the agent's tool calls

**Phase to address:** Phase 70 (Linear Agent SDK) -- the 10-second requirement must be in plan 70-03 (adapter/denormalizer), not left to the agent prompt
**Detection:** Monitor time-to-first-activity for Linear agent sessions; alert if > 10 seconds

---

### HIGH-6: Knowledge Store Becomes a Token Sink

**What goes wrong:** Agents liberally store knowledge entries because the prompt says "store discoveries for future agents." Every file path, every function signature, every architecture observation gets stored. The knowledge store grows to thousands of entries. When an agent queries "what do we know about authentication?", the query returns hundreds of entries, most redundant or trivially obvious. The agent's context is consumed by knowledge retrieval results instead of actual work.

**Why it happens:** Without clear guidance on *what is worth storing*, agents default to storing everything they learn. This is the "write amplification" problem: the cost of storing is zero (one tool call), but the cost of querying grows linearly with store size. Research shows that in multi-agent systems, shared memory tends to accumulate noise faster than signal (AgentPoison research, 2024).

**Consequences:**
- Knowledge query results consume disproportionate token budget
- Signal-to-noise ratio degrades, making useful knowledge harder to find
- Agents spend more time processing knowledge results than doing actual work
- Storage grows unbounded without active curation

**Prevention:**
- Rate-limit knowledge storage: maximum N entries per conversation (e.g., 5 for sub-agents, 10 for orchestrators)
- Implement deduplication: before storing, query existing knowledge with the same topic/entity and supersede rather than duplicate
- Knowledge entries must have a `relevance_scope` (e.g., "project:aesir", "file:src/auth/*"). Queries are scoped to prevent cross-project noise
- Implement a curation mechanism: periodic cleanup job that removes low-confidence entries older than their expiry, deduplicates similar entries, and surfaces uncurated entries in the dashboard
- For v1, consider read-only shared memory with a curated seed -- let agents query a knowledge base but only allow orchestrators to write. This prevents sub-agents from polluting the shared pool

**Phase to address:** Phase 71 (Shared Memory) must implement rate limits and deduplication from day one
**Detection:** Dashboard metric: knowledge store growth rate, average query result count, token consumption per knowledge query

---

## Moderate Pitfalls

Issues that cause friction or bugs but have straightforward fixes.

---

### MODERATE-1: Negotiation Handshake Blocks on Unresponsive Agent

**What goes wrong:** Agent A delegates to Agent B and expects a handshake response (accept/reject with estimate). Agent B is busy, crashed, or its worker pool is exhausted. The handshake never completes. Agent A is blocked waiting for an accept/reject that never comes.

**Prevention:**
- The handshake must have its own timeout, separate from the task timeout. If no handshake response within 30 seconds (configurable), the delegator should treat it as a rejection and try the next entity from the directory
- The handshake should be implemented as a fast-path signal exchange, not a full conversation start. Agent B's acceptance logic should run within the existing conversation if B is already active, or as a lightweight pre-conversation check if B needs to be started
- Add a `handshake_timeout` field to the delegation tool parameters

**Phase to address:** Phase 73 (Task Delegation) -- handshake timeout is required for the strategy abstraction

---

### MODERATE-2: Echo Storm From Linear Agent Activities

**What goes wrong:** The `actor=app` migration eliminates the need for echo filtering (LSDK-07) because agent activities and user prompts are structurally distinct. But during the migration period, if both `create_comment` and `createAgentActivity` are used, the old echo filter might incorrectly filter agent activities (the agent's new app identity might not match `LINEAR_BOT_USER_ID`). Or the filter might be removed too early, and old-style comments from the transition period create echo loops.

**Prevention:**
- Plan the migration as a hard cutover, not a gradual transition. In one deployment: switch to `actor=app`, replace `create_comment` with `createAgentActivity`, remove echo filter, update adapter for `prompted` events
- If a gradual migration is required, the echo filter must understand both identity types: `LINEAR_BOT_USER_ID` (old) and the app actor ID (new). Test this explicitly
- The existing echo filtering is at the integration layer (CLAUDE.md: "Echo filtering at integration layer only"). Verify that the integration layer filters by actor type, not just user ID, during migration

**Phase to address:** Phase 70 (Linear Agent SDK) -- plan 70-04 (remove echo filter) must be atomic with plan 70-03 (activity type mapping)

---

### MODERATE-3: Materialization Layer Creates Integration Coupling

**What goes wrong:** The task materialization layer (DEL-05) decides how to deliver a delegated task to the recipient: internal signal for agents, Slack message for humans, optionally Linear ticket for transparent delegation. This creates a dependency from the delegation system to all integration packages. If Slack is down, human delegation fails. If the Linear MCP endpoint is unresponsive, transparent materialization blocks.

**Prevention:**
- Materialization failures should not block delegation. If the external materialization fails (Slack message not sent, Linear ticket not created), the task is still created internally and the delegation handshake proceeds. The external artifact is best-effort
- Implement materialization as an async side-effect, not a synchronous prerequisite. Create the task, start the handshake, then fire-and-forget the external materialization. If it fails, log it and let the human check the dashboard instead
- The materialization layer should have circuit breakers per integration: if Slack is returning errors, stop trying to materialize to Slack and fall back to a dashboard notification
- This directly supports the spec's graceful degradation constraint: "collaboration enhances, isolation still works"

**Phase to address:** Phase 73 (Task Delegation) -- materialization must be async and fault-tolerant from plan 73-02

---

### MODERATE-4: Database Hot Path From Cross-Conversation Queries

**What goes wrong:** Delegation graph observability (Phase 75) and completion signaling (Phase 74) both need to query across conversations: "find all subtasks for this root task", "find the active conversation for this task", "trace the signal path from subtask to parent." These cross-conversation queries are inherently more expensive than single-conversation operations. Under load with many active delegation trees, these queries become the database bottleneck.

**Prevention:**
- Add composite indexes for cross-conversation queries: `idx_tasks_parent_status` on `(parent_id, status)`, `idx_conversations_task_status` on `(task_id, status)`, `idx_task_handoffs_task_created` already exists but verify it covers the completion signal lookup path
- Task tree queries should be recursive CTEs with depth limits (the existing `MAX_TASK_DEPTH = 5` provides a natural bound)
- Cache delegation graph data for the dashboard. Task trees change slowly (delegation events are infrequent compared to tool calls). A materialized view or cache layer with 30-second TTL is sufficient
- Signal dispatch should use direct lookups (`callbackConversationId`), not tree traversals. The tree is for observability, not for runtime signal routing

**Phase to address:** Phase 74 (Completion Signaling) for runtime query optimization; Phase 75 (Delegation Graph Observability) for dashboard query optimization

---

### MODERATE-5: Token Budget Not Shared Across Delegation Tree

**What goes wrong:** The existing `tokenBudget` mechanism (token-budget.ts) is shared between a parent agent and its sub-agents within a single conversation. But cross-conversation delegation creates new conversations with their own independent token budgets. A delegation tree with 3 levels could consume 3x the intended token budget because each conversation has its own `maxIterations` and `tokenBudget` from the agent definition.

**Prevention:**
- For v1, accept that cross-conversation token budgets are independent. The delegation handshake (estimate) provides a soft budget signal, and the timeout mechanism provides a hard limit
- For v2, add a `tree_token_budget` field to the root task. Each delegated task inherits a fraction of the remaining budget. The conversation executor reads the remaining tree budget and configures `tokenBudget` accordingly
- At minimum, log total token usage per task tree in the dashboard so operators can identify expensive delegation chains
- The existing `MAX_TASK_DEPTH` and `MAX_SUBTASKS_PER_PARENT` limits provide structural bounds on budget explosion, but they are blunt instruments

**Phase to address:** Phase 75 (Delegation Graph Observability) for token tracking; future milestone for budget enforcement

---

### MODERATE-6: Knowledge Classification Taxonomy Too Rigid or Too Flexible

**What goes wrong:** The spec proposes knowledge types: `discovery`, `architecture_decision`, `constraint`, `thought`. If the taxonomy is too rigid, agents miscategorize to fit the available types (storing a constraint as a discovery because it does not quite fit). If too flexible (extensible types), agents invent categories that are meaningless for querying ("general_info", "important_thing", "note").

**Prevention:**
- Start with a fixed, small taxonomy (4-5 types) and validate with real usage data before expanding
- Each type should have clear examples in the agent prompt: "discovery = factual observation about the codebase (file locations, API shapes, test patterns). constraint = limitation or requirement that affects decisions (rate limits, API compatibility, performance targets)"
- Log unclassified or frequently-miscategorized entries to inform taxonomy evolution
- The classification should affect storage and query behavior (per MEM-06), so getting it wrong has consequences. This is a reason to keep the taxonomy small and well-understood for v1

**Phase to address:** Phase 71 (Shared Memory) -- taxonomy design in plan 71-01

---

## Minor Pitfalls

Low-severity issues that should be addressed but are not blockers.

---

### MINOR-1: Linear `delegate` vs. `assignee` Semantic Confusion

**What goes wrong:** Linear's Agent SDK introduces a `delegate` concept separate from `assignee`. When an agent is delegated an issue, it becomes the `delegate`, not the `assignee` -- the human remains the assignee. Aesir's current model uses `assignee_type` and `assignee_id` on tasks. If the mapping between Linear's delegate/assignee and Aesir's task assignee is unclear, the agent might be assigned in Aesir but not delegated in Linear, or vice versa.

**Prevention:**
- Document the mapping explicitly: Linear `delegate` = Aesir `task.assignee_type=agent`. Linear `assignee` = human owner who initiated the work
- The adapter must map `delegate` field from webhooks, not `assignee`, when creating tasks from Linear events

**Phase to address:** Phase 70 (Linear Agent SDK) -- plan 70-03

---

### MINOR-2: Dashboard Performance Degradation From Delegation Graph Rendering

**What goes wrong:** The task tree view (Phase 75) renders delegation graphs with nodes (tasks), edges (delegation relationships), and signals (completion/failure/clarification). For a complex task tree (3 levels, 10 subtasks per level = 111 nodes), the React component becomes slow, especially with real-time signal flow visualization.

**Prevention:**
- Limit the initial render to the first 2 levels of the tree; expand deeper levels on demand
- Use virtualization for the timeline view (only render visible rows)
- Signals are historical data -- render them as a static timeline, not a real-time animation
- The existing SSE proxy (`/dashboard/api/sse/events`) should NOT push delegation graph updates in real-time. Poll every 30 seconds for graph changes

**Phase to address:** Phase 75 (Delegation Graph Observability) -- plan 75-02

---

### MINOR-3: Seed Script Race Condition With Multiple Deployments

**What goes wrong:** The entity directory is seeded from YAML via `pnpm seed:directory`. If two deployments run simultaneously (e.g., blue-green deployment), both seed scripts run concurrently and may create duplicate entries or fail on unique constraint violations.

**Prevention:**
- Use `ON CONFLICT DO UPDATE` (upsert) in the seed script, not `INSERT`
- Add a `seeded_at` timestamp to track freshness
- The seed script should be idempotent by design

**Phase to address:** Phase 72 (Entity Directory) -- plan 72-01

---

## Phase-Specific Warning Matrix

| Phase | Topic | Likely Pitfall | Severity | Mitigation |
|-------|-------|---------------|----------|------------|
| Phase 70 | Linear Agent SDK | Token migration breaks running conversations (CRITICAL-5) | CRITICAL | Implement refresh token middleware first; drain conversations before migration |
| Phase 70 | Linear Agent SDK | 10-second activity requirement vs. async queuing (HIGH-5) | HIGH | Emit thought activity synchronously in webhook handler |
| Phase 70 | Linear Agent SDK | Echo storm during migration (MODERATE-2) | MODERATE | Atomic cutover, not gradual migration |
| Phase 71 | Shared Memory | Knowledge poisoning from stale data (CRITICAL-4) | CRITICAL | Mandatory expiry, verification dates, source hashing |
| Phase 71 | Shared Memory | Knowledge store becomes token sink (HIGH-6) | HIGH | Rate limits, deduplication, relevance scoping |
| Phase 71 | Shared Memory | Classification taxonomy design (MODERATE-6) | MODERATE | Start small (4-5 types), validate before expanding |
| Phase 72 | Entity Directory | Stale capabilities (HIGH-2) | HIGH | Re-seed on deploy, handshake validates at runtime |
| Phase 73 | Task Delegation | Over-delegation / management layer (CRITICAL-2) | CRITICAL | Architectural enforcement of sub-agent vs. delegation boundary |
| Phase 73 | Task Delegation | Handshake blocks on unresponsive agent (MODERATE-1) | MODERATE | Handshake-specific timeout (30s default) |
| Phase 73 | Task Delegation | Materialization coupling (MODERATE-3) | MODERATE | Async best-effort materialization with circuit breakers |
| Phase 74 | Completion Signaling | Lost signals to terminal conversations (CRITICAL-1) | CRITICAL | Task-level result storage, orphan-aware signal handling |
| Phase 74 | Completion Signaling | Circular wait / deadlock (CRITICAL-3) | CRITICAL | Multi-type wait_for, deadlock detection job |
| Phase 74 | Completion Signaling | Callback routing breaks on re-trigger (HIGH-3) | HIGH | Resolve callbacks through tasks, not conversation IDs |
| Phase 74 | Completion Signaling | History compaction destroys delegation context (HIGH-4) | HIGH | Self-contained signal payloads, delegation context preservation |
| Phase 74 | Completion Signaling | Fan-out partial completion (HIGH-1) | HIGH | Sequential-only for v1; task groups for v2 |
| Phase 75 | Observability | Database hot path from cross-conversation queries (MODERATE-4) | MODERATE | Composite indexes, cached graph data, direct signal routing |
| Phase 75 | Observability | Dashboard rendering performance (MINOR-2) | MINOR | Lazy tree expansion, virtualization, poll not push |
| Phase 76 | QA Agent | All above pitfalls compound in the triangular workflow | VARIES | Phase 76 is the integration test -- every pitfall surfaced here should be resolved before Phase 76 begins |

---

## Graceful Degradation Analysis

The spec mandates: "Collaboration enhances, isolation still works." Here is an analysis of each new capability and what happens when it is unavailable.

| Capability | Unavailable When | Impact on Isolated Agents | Graceful? | Required Safeguard |
|-----------|-----------------|--------------------------|-----------|-------------------|
| Knowledge Store | pgvector extension down, table unreachable | Agents work without shared context (higher token cost for re-discovery) | YES, if tools return empty results not errors | `knowledge:query` must return `[]` on connection failure, not throw |
| Entity Directory | Directory table empty or unreachable | Agents cannot discover delegation targets; fall back to self-execution | YES, if prompt says "if directory is unavailable, do the work yourself" | `directory:find` must return `[]` on failure, not throw |
| Task Delegation | Delegation tool fails (directory down, materialization fails) | Agents cannot delegate; must execute work directly (the pre-v2.7 behavior) | YES, but only if agents have the tools to do the work themselves | Prompt guidance: "if delegation fails, consider whether you can handle this with sub-agents or directly" |
| Completion Signaling | Signal delivery fails (callback conversation gone) | Delegated work completes but delegator does not resume automatically | PARTIAL -- work is done but result is stranded | Orphan handling (CRITICAL-1) + dashboard visibility + timeout fallback |
| Linear Agent SDK | Linear API down, token expired | Agent cannot post activities to Linear; conversations continue internally | YES, with MCP error handling | MCP retry logic already exists; denormalizer errors should be non-fatal |

**Critical rule:** No collaboration tool failure should prevent an agent from completing its current conversation. Tool failures should return structured error results (not throw exceptions that crash the agent loop). The agent reasons about the error and adapts.

**Anti-pattern to avoid:** Adding collaboration tools as `required` dependencies that block conversation startup. If the knowledge store is unreachable, the conversation should still start -- the agent just won't have shared knowledge available.

---

## The Overarching Risk: Complexity Budget

The existing system works because it is simple: one conversation, one agent, isolated execution, SKIP LOCKED for concurrency. Each of the seven v2.7 phases adds complexity:

| Phase | New Concepts Introduced | New Failure Modes Introduced |
|-------|------------------------|------------------------------|
| 70 | Actor identity, session lifecycle, activity types, refresh tokens | Token rotation failures, timing requirements, migration period risks |
| 71 | Knowledge classification, shared state, expiry, scope policies | Stale data, noise accumulation, classification errors |
| 72 | Entity registry, capability matching, seeding lifecycle | Stale directory, false capability matches |
| 73 | Cross-conversation delegation, materialization, handshake protocol | Over-delegation, deadlocks, handshake timeouts |
| 74 | Callback routing, multi-type signals, orphan handling | Lost signals, partial completion, cascading failures |
| 75 | Task tree queries, cross-conversation tracing, signal visualization | Database load, dashboard performance |
| 76 | Three-agent workflow, feedback loops, re-delegation | All above, compounded |

Each phase's failure modes compound with the previous phases. Phase 76 (QA Agent) exercises every failure mode simultaneously. **The most important mitigation is phased delivery with validation**: do not start Phase 73 until Phase 72 is validated in production. Do not start Phase 74 until Phase 73's handshake mechanism is proven. Phase 76 should only begin when all preceding phases have been individually stress-tested.

---

## Sources

### Research Papers and Articles
- [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/html/2503.13657v1) -- 14 failure modes across 150+ execution traces, 41-86.7% failure rates
- [Multi-Agent Coordination Strategies](https://galileo.ai/blog/multi-agent-coordination-strategies) -- Galileo AI, 10 coordination strategies
- [17x Error Trap of Bag of Agents](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) -- Towards Data Science, topology matters more than agent count
- [Why Multi-Agent LLM Systems Fail and How to Fix Them](https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them) -- Augment Code, specification problems = 41.77%, coordination failures = 36.94%
- [Memory Poisoning Attack and Defense](https://arxiv.org/html/2601.05504) -- Memory poisoning in LLM agents
- [AI Agent Memory Poisoning](https://www.mintmcp.com/blog/ai-agent-memory-poisoning) -- 87% downstream decision contamination from single compromised agent
- [Cascading Failures in Agentic AI (OWASP ASI08)](https://adversa.ai/blog/cascading-failures-in-agentic-ai-complete-owasp-asi08-security-guide-2026/) -- OWASP security guide 2026

### Linear Developer Documentation
- [Getting Started -- Linear Agents](https://linear.app/developers/agents) -- Agent SDK overview, actor=app, scopes
- [Agent Interaction](https://linear.app/developers/agent-interaction) -- Session lifecycle, activity types, timing requirements
- [OAuth Actor Authorization](https://linear.app/developers/oauth-actor-authorization) -- actor=app parameter, migration from actor=application
- [OAuth 2.0 Authentication](https://linear.app/developers/oauth-2-0-authentication) -- Refresh token migration, April 2026 deadline, migration endpoint
- [Agent Interaction Guidelines and SDK Changelog](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk) -- SDK release details

### Architecture and Patterns
- [AWS Well-Architected: Graceful Degradation](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html) -- Transform hard dependencies into soft dependencies
- [AI Agent Observability -- OpenTelemetry](https://opentelemetry.io/blog/2025/ai-agent-observability/) -- Standards for multi-agent tracing
- [Agent Tracing for Multi-Agent AI Systems](https://www.getmaxim.ai/articles/agent-tracing-for-debugging-multi-agent-ai-systems/) -- Cross-agent debugging patterns
