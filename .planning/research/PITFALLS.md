# Domain Pitfalls: Platform Completion (v2.9)

**Domain:** Adding richer negotiation, parallel delegation, transparent materialization, tree-level token budgets, scheduled execution, sub-agent discovery, persistent agent identity, and knowledge retrieval enhancement to an existing multi-agent development platform
**Researched:** 2026-02-20
**Overall confidence:** HIGH (based on deep analysis of 2000+ lines of executor/worker-loop/signal code + external research on multi-agent failure modes)

**Key insight:** v2.9 is the most dangerous milestone since v2.3 (the original executor). Every phase touches the signal/wait machinery, the worker loop, or both. The existing system works because conversations are isolated with simple pause/resume semantics. v2.9 introduces cross-conversation state dependencies (tree budgets, task groups, bidirectional clarification), lifecycle hooks (identity updates, pre-compaction flush), and new execution triggers (cron schedules). Each individually is tractable. Combined, they create interaction effects that no phase tests in isolation.

---

## Critical Pitfalls

Mistakes that cause rewrites, deadlocks, data loss, or break existing single-agent functionality.

---

### CRITICAL-1: Clarification Deadlock From Nested Wait-For

**What goes wrong:** Phase 1 introduces bidirectional clarification: a target agent sends a `task_clarification` signal back to the delegator mid-task. The delegator must resume, process the question, answer, and re-pause to await completion. But the current executor only supports one `pending_wait` per conversation. When the delegator resumes on a clarification signal, processes it, and needs to re-wait, the executor must clear the old pending_wait, handle the clarification turn, and set a new pending_wait. If the agent calls `wait_for` during the clarification handling turn AND a `task_completion` signal arrives during that narrow window, the completion signal could be queued (conversation is `running`), but the new `pending_wait` types might not include `task_completion` if the agent only waits for `task_clarification` again.

**Why it happens in this codebase:** The `signalMatchesPendingWait()` function (signal-matching.ts:22-52) does strict type membership checking against `pendingWait.types`. The `wait_for_task` tool (wait-for-task-tool.ts:73-77) hardcodes `types: ["task_completion", "task_failure", "task_timeout"]`. Adding `task_clarification` to this list means the tool always listens for it. But if the agent uses plain `wait_for` instead of `wait_for_task` for the clarification response, the types array may not include completions. Multi-round clarification means the agent alternates between waiting-for-clarification-response and waiting-for-task-completion, with a different `pending_wait` configuration each time.

**Consequences:**
- Task completion signal arrives while delegator is waiting for clarification response -- signal queued but never consumed because `pending_wait.types` changed
- Delegator stuck waiting for clarification response that will never come (target already completed)
- Both conversations eventually timeout, wasting all work done

**Prevention:**
- Extend `wait_for_task` to always include `task_clarification` in its types array. This tool should be the ONLY mechanism for delegation waits -- never plain `wait_for`
- When the delegator resumes for a clarification, it must call `wait_for_task` (not `wait_for`) to re-pause. The prompt must make this clear: "After answering a clarification, always use wait_for_task to resume waiting"
- The worker loop's queued signal check (worker-loop.ts:1278-1334) already handles consuming queued signals on resume. Verify this works when the pending_wait types change between pause cycles
- Add an integration test: delegate -> target asks clarification -> delegator answers -> target completes. Verify completion signal is received

**Phase to address:** Phase 1 (Richer Negotiation) -- this is the core design challenge
**Detection:** Monitor for conversations that cycle between `waiting` and `running` more than 3 times on the same task

---

### CRITICAL-2: Parallel Task Group Completion Race Condition

**What goes wrong:** Phase 2 introduces task groups with completion policies (`all_required`, `any_sufficient`, `majority`). The delegator creates N parallel tasks and waits for the group to satisfy its policy. Completion signals arrive concurrently from different worker loop iterations. The signal aggregation logic must atomically check "does this new completion satisfy the policy?" But if two completions arrive simultaneously from two different workers processing `executor.signal()`, both read the same group state (e.g., 1 of 3 complete), both update it (now showing 2 of 3 from each transaction's perspective), and both conclude the policy is not yet satisfied. The actual state is 3 of 3 -- but neither transaction triggers the group completion signal.

**Why it happens in this codebase:** `executor.signal()` (conversation-executor.ts:353-567) uses `FOR UPDATE` row locks on the conversation row, which prevents concurrent modifications to the conversation. But the task group state is NOT on the conversation row -- it is in the tasks table (or a new task_groups table). If group state tracking is in a separate table without the same locking discipline, concurrent signals can race.

Even if the group state update uses `FOR UPDATE`, the aggregation check happens after the update. Two transactions could both update their respective task to "completed" and then both read the group state as "2 of 3 complete" (each seeing their own update but not the other's uncommitted change). Neither triggers the "all 3 complete" policy.

**Consequences:**
- `all_required` policy never fires -- delegator stuck waiting forever
- `any_sufficient` with N=1 fires correctly (single completion), but `majority` with N>1 can miss
- Token budget consumed by a delegator waiting for a signal that will never come

**Prevention:**
- Use `pg_advisory_xact_lock` on the task group ID for ALL completion signal processing. The lock serializes policy evaluation: only one completion signal evaluates the policy at a time
- The policy evaluation must happen INSIDE the same transaction that updates the task status. Read group state, update this task, evaluate policy, fire group completion signal -- all atomic
- Alternatively, use a single atomic UPDATE with a RETURNING clause: `UPDATE task_groups SET completed_count = completed_count + 1 RETURNING completed_count, total_count, policy`. The returned `completed_count` is the authoritative post-increment value. If it satisfies the policy, fire the signal
- Test with concurrent signal delivery: fire 3 completion signals within the same poll cycle and verify the group completion signal fires exactly once

**Phase to address:** Phase 2 (Parallel Delegation)
**Detection:** Monitor for task groups where all member tasks are "completed" but the group completion signal was never delivered

---

### CRITICAL-3: Tree-Level Token Budget Double-Spend Under Concurrency

**What goes wrong:** Phase 4 introduces tree-level token budgets that span all conversations in a delegation tree. The root task allocates 200k tokens, split across parallel delegates. Each conversation deducts tokens as it runs. But two parallel conversations in the same tree could both read `remaining = 50k`, each spend 30k, and both write back `remaining = 20k` instead of the correct `remaining = -10k`. The tree budget is silently overspent.

**Why it happens in this codebase:** The current `TokenBudget` (token-budget.ts) is an in-memory mutable object shared by reference between an orchestrator and its sub-agents. This works because sub-agents run synchronously within the same `executeConversation()` call (spawn-agent.ts:160-169). Tree-level budgets span SEPARATE conversations running on SEPARATE worker loop iterations, potentially on DIFFERENT workers. There is no shared in-memory state -- the budget must live in the database.

The `deduct(input, output)` method (token-budget.ts:71-73) does `this.remaining -= input + output`. In a database context, this becomes a read-modify-write on a shared row. Without proper locking, concurrent conversations will overwrite each other's deductions.

**Consequences:**
- Tree budget exceeded without any conversation receiving a budget exhaustion signal
- Actual token spend could be 2-3x the intended budget for parallel delegation trees
- Operators see higher-than-expected costs with no explanation in the dashboard

**Prevention:**
- Store tree budget as a single row with `remaining` column. Use atomic SQL: `UPDATE tree_budgets SET remaining = remaining - $deducted WHERE id = $treeId AND remaining >= $deducted RETURNING remaining`. If the RETURNING is empty, the budget is exhausted
- Never read-then-write the budget. Always use atomic decrement operations
- For the warning threshold (80%), use `remaining <= total * 0.2` in the query, not an in-memory check
- Budget checks should happen after each LLM response, not at conversation start. The `onResponse` callback in the worker loop (worker-loop.ts:1454-1480) is the natural hook -- add a tree budget deduction call here
- Consider a budget reservation pattern: when a conversation starts, it reserves a chunk (e.g., 20k tokens). If it uses less, it returns the remainder. This reduces lock contention from per-LLM-call deductions to per-conversation-start reservations

**Phase to address:** Phase 4 (Tree-Level Token Budgets) -- BUD-01 must use atomic SQL, not application-level locking
**Detection:** Dashboard comparison: sum of per-conversation token usage vs. tree budget total. Alert if sum exceeds total by >5%

---

### CRITICAL-4: Webhook Echo Loop From Transparent Materialization

**What goes wrong:** Phase 3 creates Linear tickets for transparently materialized tasks. When the delegated agent completes (MAT-03), the system updates the Linear ticket to "done." This fires a Linear webhook (`issue.updated`). The EventRouter processes it and potentially starts a NEW conversation or signals the existing one. That conversation does something that updates the ticket again. Infinite loop.

**Why it happens in this codebase:** The existing echo filter was removed (webhooks.ts:142: "Echo filter removed: agent activities and user comments are structurally distinct"). This worked for the v2.7 model where agents post agent activities, not issue updates. But transparent materialization means agents (via the materialization layer) will UPDATE issue status -- the same type of change a human makes. The echo filter cannot distinguish "agent-initiated status change via materialization" from "human status change" because both are issue updates.

The correlation service (work_correlations table) maps entities to conversations, but it does not track the DIRECTION of updates. It knows "Linear issue LIN-123 is correlated with conversation X" but not "the status change to 'done' originated from conversation X."

**Consequences:**
- Infinite webhook cycle: agent updates ticket -> webhook -> EventRouter -> signals conversation -> agent updates ticket
- At best: wasted processing and token consumption
- At worst: cascading state corruption as each cycle modifies the ticket differently

**Prevention:**
- Add a `pending_materializations` tracking mechanism. Before updating a Linear ticket, record the expected change (e.g., `{issueId: "LIN-123", field: "status", value: "done", expiresAt: +30s}`) in a fast-expiring store (Redis or a Postgres table with TTL)
- The adapter, when receiving a webhook, checks: "Is there a pending materialization that matches this change?" If yes, it is our own echo -- drop the event
- This is the same pattern Workato and n8n use for bidirectional sync: track outbound changes and suppress their inbound echoes
- Alternative: use Linear's `actor` field on webhooks. If the update was made by the Aesir OAuth application, suppress it. This is simpler but requires the materialization layer to always use the same OAuth identity
- The correlation service should track update direction: add `last_outbound_update_at` to the correlations table. If an inbound webhook arrives within 5 seconds of our outbound update to the same entity, suppress it

**Phase to address:** Phase 3 (Transparent Materialization) -- MAT-03 (bidirectional sync) is the danger zone
**Detection:** Monitor for rapid cycles of status changes on the same Linear issue within 10 seconds

---

### CRITICAL-5: Lifecycle Hook Ordering Creates Unpredictable Agent Turns

**What goes wrong:** Phases 7 and 8 both inject agent turns at lifecycle boundaries. Phase 7 injects an identity update turn before conversation completion. Phase 8 injects a pre-compaction knowledge flush turn before history compaction. The spec explicitly notes this: "Whichever is built first should establish the general lifecycle hook mechanism so the other plugs into it rather than duplicating the pattern." But if both hooks fire on the same conversation, the agent runs TWO extra turns: one for knowledge flush, one for identity update. The ordering matters -- if identity update runs first, it uses the full uncompacted history. If knowledge flush runs first and compaction follows, the identity update sees a summarized history and may write a worse identity document.

**Why it happens in this codebase:** The history compaction point is in `executeConversation()` (worker-loop.ts:1337-1349), after loading messages but before running the agent loop. The completion point is after the agent loop returns with `result.status === "completed"` (worker-loop.ts:1734-1778). These are different points in the execution flow. Adding hooks at both points means the agent loop may run 2-3 times per `executeConversation()` call: once for the main work, once for knowledge flush (before compaction), once for identity update (before completion).

Each extra agent turn costs tokens, and the turns compound. If the knowledge flush turn generates new knowledge that needs to be included in the identity update, the ordering dependency is real.

**Consequences:**
- Unpredictable token cost: conversations run 2-3x more agent turns than expected
- Ordering bugs: identity document updated before knowledge flush loses the flushed knowledge
- Compaction + flush + identity update in the wrong order could lose context
- Token budget exhaustion from unexpected extra turns

**Prevention:**
- Design the lifecycle hook mechanism as an ordered pipeline, not independent hooks. Define a clear execution order: (1) pre-compaction knowledge flush, (2) history compaction, (3) agent main loop, (4) pre-completion identity update. Each step is optional based on agent configuration
- Lifecycle hooks should be LIGHTWEIGHT: restricted tool set, short max iterations (3-5), dedicated token allocation that does not come from the main conversation budget
- Never run both hooks in the same `executeConversation()` call. Knowledge flush happens during compaction (which runs on RESUMED conversations), identity update happens at COMPLETION. These are inherently different lifecycle points and should not collide
- If an agent has both knowledge tools and identity tools, the compaction flush turn should ALSO update identity (merge the two hooks for that agent)

**Phase to address:** Phases 7 and 8 -- whichever ships first MUST establish the hook mechanism. The spec says this explicitly. Phase ordering: 8 before 7, since compaction hooks are simpler and establish the pattern
**Detection:** Log lifecycle hook execution count per conversation. Alert if >2 hooks fire in a single executeConversation() call

---

## High-Severity Pitfalls

Mistakes that cause significant issues but are recoverable without rewrites.

---

### HIGH-1: Counter-Propose Creates Unbounded Negotiation Loop

**What goes wrong:** Phase 1 adds counter-proposals: instead of flat accept/reject, the target agent can respond with a modified scope. The delegator then decides: accept the modification, reject, or try someone else. But what if the delegator counter-proposes the counter-proposal? Or the target issues another counter-proposal? Without a bound, negotiation can loop indefinitely, consuming tokens on both sides with no work being done.

**Why it happens in this codebase:** The current `respond_task` tool (respond-task.ts:18-32) has a simple `response: z.enum(["accept", "reject"])`. Adding `"counter_propose"` as a third option is straightforward. But the interaction pattern changes from a single request-response to potentially unbounded back-and-forth. The existing handshake timeout (via `wait_for` with `timeout: "30s"`) bounds the total time but not the number of rounds.

**Consequences:**
- Token budget consumed by negotiation overhead instead of actual work
- Delegator and target stuck in a negotiation loop until timeout fires
- Poor user experience: dashboard shows agents arguing about scope instead of working

**Prevention:**
- Hard limit on negotiation rounds: maximum 2 counter-proposals per delegation (configurable). After 2 counter-proposals, the next response must be accept or reject
- Track round count in the task metadata: `{ negotiation_rounds: N }`. The `respond_task` tool checks the count before allowing a counter-proposal
- The delegation handshake timeout bounds total time, but also add per-round tracking to the prompt: "You have had N rounds of negotiation. If you cannot agree on scope, reject and try someone else"
- Counter-proposals should include structured fields (`modified_scope`, `modified_estimate`) alongside free-text reasoning. This helps the delegator make a quick accept/reject decision without another LLM reasoning loop

**Phase to address:** Phase 1 (Richer Negotiation) -- NEG-06 (multi-round support) must include round limits
**Detection:** Dashboard metric: average negotiation rounds per delegation. Alert if >2 average

---

### HIGH-2: Scheduled Execution Overlap With Singleton Key Collision

**What goes wrong:** Phase 5 uses pg-boss for cron-scheduled agent execution. The overlap prevention (SCH-05) uses `skip` policy: if the previous scheduled run is still active, skip the new one. pg-boss implements this via `singletonKey` on the scheduled job. But pg-boss has a known limitation: scheduled jobs cannot run more than once per minute, and singleton key overlap detection uses debouncing with a 60-second resolution. If a schedule fires every minute and the previous run takes 61 seconds, the overlap detection may fail, starting two concurrent runs of the same scheduled agent.

**Why it happens in this codebase:** The timeout scheduler (timeout-scheduler.ts:247-253) already uses `singletonKey: conversationId` for timeout jobs. For scheduled execution, the singleton key would be `agentDefinitionId + scheduleName`. pg-boss's `schedule()` method (not `send()`) creates recurring cron jobs, but the singleton behavior differs from one-shot jobs. The debouncing offset calculation has had historical bugs (pg-boss changelog: "fixed debouncing offset calculation which would sometimes cause an interval overlap").

**Consequences:**
- Two instances of the same scheduled agent running simultaneously
- If the agent creates Linear tickets or other external artifacts, duplicates are created
- If the agent modifies shared state (knowledge entries, identity documents), concurrent writes can conflict

**Prevention:**
- Use `stately` queues (pg-boss v10+) for scheduled jobs: only 1 job queued and 1 job active. This is stricter than singleton
- Add application-level overlap detection: before creating the conversation from a scheduled trigger, check if an active conversation already exists for this agent + schedule combination. Use `executor.list({ agentDefinitionId, status: "running" })` as a guard
- Use a `pg_advisory_xact_lock` on a hash of `agentId + scheduleName` when processing scheduled job callbacks. This serializes schedule trigger processing
- Test with schedules that fire faster than agent execution time (e.g., every 30 seconds with a 60-second agent run)

**Phase to address:** Phase 5 (Scheduled Agent Execution) -- SCH-05 overlap prevention is the critical requirement
**Detection:** Monitor for concurrent conversations with the same `agent_definition_id` + schedule metadata

---

### HIGH-3: Sub-Agent Discovery Returns Wrong Match From Embedding Similarity

**What goes wrong:** Phase 6 introduces capability-based sub-agent discovery using pgvector embeddings. An orchestrator calls `spawn_agent` with `capability: "write production-quality code"` and the registry resolves to the coder sub-agent. But embedding similarity is fuzzy -- "write production-quality code" might also match a "documentation writer" sub-agent (high cosine similarity because both involve "writing"). The wrong sub-agent is spawned, wastes tokens, and returns unusable results.

**Why it happens in this codebase:** The entity directory already uses pgvector for capability matching (entity_directory table, schema.ts:466-495). The query uses cosine similarity ranking. Short capability descriptions ("write code", "run tests") have high overlap in embedding space. The DISC-07 fallback behavior (no match returns empty) does not help when there IS a match but it is wrong.

**Consequences:**
- Wrong sub-agent spawned, consuming shared token budget on useless work
- Orchestrator receives irrelevant results, must re-spawn with a different capability query
- If the wrong sub-agent modifies the sandbox (writes files, creates branches), cleanup is needed

**Prevention:**
- Require a minimum similarity threshold (e.g., 0.85 cosine similarity) for capability matches. Below the threshold, return no match rather than a weak match
- Sub-agent capabilities should be SPECIFIC, not generic. "Generate TypeScript implementation files with tests" is better than "write code" for disambiguation
- Add a `domain` field to sub-agent capabilities for coarse filtering before embedding search. Coder is `domain: "code"`, researcher is `domain: "codebase"`, tester is `domain: "testing"`. The query first filters by domain, then ranks by embedding similarity
- Keep the hardcoded `subAgents` YAML map as a fallback. If the capability query returns a sub-agent that is NOT in the agent's `subAgents` map, log a warning and fall back to the hardcoded mapping. This provides a safety net during the transition
- Test with adversarial capability queries that are semantically close but should resolve to different sub-agents

**Phase to address:** Phase 6 (Sub-Agent Discovery) -- DISC-05 semantic matching must include thresholds
**Detection:** Dashboard metric: sub-agent spawn outcomes. Track "spawned via discovery" vs "spawned via hardcoded" and success rates of each

---

### HIGH-4: Identity Document Token Bloat at Conversation Start

**What goes wrong:** Phase 7 injects all identity documents into the system prompt at conversation start (IDN-03). An agent with 5 identity document types (product_brief, architectural_model, stakeholder_map, domain_knowledge, working_context), each at their token limit (say 2000 tokens), adds 10k tokens to EVERY conversation's initial context. Over time, as documents grow, this fixed cost could reach 20-30k tokens before the agent processes a single message.

**Why it happens in this codebase:** The system prompt is loaded from `definition.systemPrompt` (prompt.md file content) and passed directly to `runAgentLoop` (worker-loop.ts:1483). Identity documents would be prepended or appended to this prompt. The history manager's `pruneThreshold` (default 80k tokens from history-manager.ts:33-34) includes the system prompt. With 30k tokens of identity documents, the effective conversation capacity drops to 50k before compaction triggers.

**Consequences:**
- Every conversation starts with a 10-30k token overhead
- Conversations hit compaction earlier, losing more context
- For short tasks (sub-agent spawns with low token budgets), identity injection could consume a significant fraction of the budget
- Cost increase: 10k tokens per conversation * N conversations/day = meaningful cost at scale

**Prevention:**
- Set per-document-type token limits that are conservative: 1000 tokens for product_brief, 500 for working_context, etc. Total identity injection should not exceed 5k tokens
- Do NOT inject identity documents for sub-agents. Sub-agents are focused workers that do not need persistent identity -- they inherit context from their parent's task description. Only orchestrator agents get identity injection
- Implement selective injection based on the incoming task type. A code review task does not need the full product brief. Use the initial message content to select relevant identity documents (requires a lightweight classification step)
- The `tokenBudget` configuration should account for identity overhead. If an agent has identity documents, its `tokenBudget` should be increased by the expected identity token cost
- IDN-07 (size management) must be aggressive: prompt the agent to summarize when approaching 80% of the limit, not at the limit

**Phase to address:** Phase 7 (Persistent Agent Identity) -- IDN-03 (context injection) must include token budgeting
**Detection:** Dashboard metric: identity document token count per agent. Alert if total exceeds 5k

---

### HIGH-5: Pre-Compaction Knowledge Flush Causes Side Effects

**What goes wrong:** Phase 8 injects a turn before history compaction prompting the agent to store knowledge. The flush turn runs with the agent's full tool set unless explicitly restricted (KR-06 open question). If the agent has integration tools (Linear, GitHub, Slack), it might use the flush turn to make external changes ("I should create a ticket for this before I forget") instead of just persisting knowledge. The flush turn was meant to be a focused preservation step, not a general-purpose agent turn.

**Why it happens in this codebase:** The `executeConversation()` function (worker-loop.ts:927-2015) runs the agent loop once per execution. Adding a flush turn means running `runAgentLoop()` a SECOND time before compaction, with the same tool set. The agent has no way to know this is a "restricted" turn unless the tools are explicitly filtered. LLMs do what they can with the tools they have -- if integration tools are available, they may be used.

**Consequences:**
- Unexpected external side effects during what should be an internal housekeeping step
- Duplicate ticket creation, unwanted Slack messages, or unintended GitHub operations
- Flush turn consuming tokens from the main conversation budget
- Confusion in the event log: tool calls during the flush turn look like regular agent activity

**Prevention:**
- RESTRICT the tool set during flush turns. Only provide `knowledge:store` and `knowledge:query`. Strip all integration, codebase, communication, and coordination tools
- Use a separate, cheaper model for flush turns (Haiku, matching the history compaction model from `summaryModel` config). This reduces cost and makes the flush lightweight
- Set a strict `maxIterations: 3` for flush turns. The agent should store 0-5 knowledge entries and respond with a sentinel ("nothing to store" or "stored N entries"). More than 3 iterations means the agent is doing something unintended
- Mark flush turn events in the event log with a distinct `agent_instance_id` prefix (e.g., `flush_inst_xxx`) so they are visually distinguishable in the dashboard
- KR-06 answers itself: restricted tool set is mandatory, not optional

**Phase to address:** Phase 8 (Knowledge Retrieval Enhancement) -- KR-05/KR-06
**Detection:** Monitor for non-knowledge tool calls during flush turns (any tool call to a non-`knowledge:` namespace)

---

### HIGH-6: Group Cancellation Races With In-Progress Completions

**What goes wrong:** Phase 2's `any_sufficient` policy fires when the first task in a group completes. The delegator may then cancel remaining tasks (PAR-06). But between the moment the delegator decides to cancel and the moment the cancellation signals reach the other conversations, one or more of those conversations may have already completed their work and sent completion signals. These "late" completion signals arrive at the delegator after it has already moved on, potentially re-waking it.

**Why it happens in this codebase:** `executor.cancel()` (conversation-executor.ts:591-657) transitions the conversation to `cancelled` and cancels pending timeouts. But it does NOT prevent the conversation from completing in the narrow window between "started" and "cancelled." The SKIP LOCKED claim (worker-loop.ts:894-918) only prevents two workers from claiming the same conversation -- it does not prevent a claimed and running conversation from completing while a cancel is in flight.

**Consequences:**
- Delegator receives unexpected completion signals after it has already processed the group result
- If the delegator is waiting for a new task group, the stale completion signal might match a different pending_wait
- Token waste: cancelled tasks that already completed did unnecessary work

**Prevention:**
- Completion signals should carry a `groupId` field. The delegator's pending_wait should include group-scoped matching (similar to taskId-scoped matching in signal-matching.ts:42-49)
- After satisfying a group policy, mark the group as "satisfied" in the database. Late completion signals for a satisfied group should be logged but not delivered to the delegator
- The `computeUpdatedDelegations()` function (worker-loop.ts:386-440) already handles removing completed delegations. Extend this to handle group-level delegation removal
- Use a dedicated signal type for group completion (`task_group_completion`) separate from individual task completion. The delegator waits for the group signal, not individual signals

**Phase to address:** Phase 2 (Parallel Delegation) -- PAR-05 (signal aggregation) and PAR-06 (group cancellation)
**Detection:** Monitor for completion signals delivered after group policy was already satisfied

---

## Moderate Pitfalls

Issues that cause friction or bugs but have straightforward fixes.

---

### MODERATE-1: Materialization Sync Creates Tight Coupling to Linear Availability

**What goes wrong:** Phase 3's bidirectional sync (MAT-03) means that task status changes update the Linear ticket and vice versa. If Linear's API is down or rate-limited, task completions fail to materialize externally. The internal task succeeds but the external artifact is stale. When Linear recovers, there is no reconciliation mechanism -- the ticket shows the old status.

**Prevention:**
- Materialization updates must be fire-and-forget with retry. Use pg-boss to queue materialization jobs. If the first attempt fails, retry with exponential backoff
- Never block task status transitions on materialization success. The internal task state is the source of truth; the external artifact is a projection
- Add a reconciliation job: periodically scan for materialized tasks where internal status != external artifact status and issue corrective updates
- The materialization interface (MAT-05) should include a `reconcile()` method alongside `materialize()` and `sync()`

**Phase to address:** Phase 3 (Transparent Materialization) -- MAT-03 is the risk, MAT-05 extensible interface must include reconciliation

---

### MODERATE-2: Schedule Registration Conflicts on Multi-Worker Deployments

**What goes wrong:** Phase 5 registers pg-boss scheduled jobs on startup (SCH-03). In a multi-worker deployment, every worker registers the same schedules. pg-boss's `schedule()` is idempotent (creates if not exists, updates if exists), but the registration race can cause duplicate schedule fires if workers start simultaneously and the idempotency check races.

**Prevention:**
- Use a startup lock: only one worker registers schedules. Use `pg_advisory_lock` during schedule registration. Other workers wait for the lock, then verify schedules exist (no-op)
- Alternatively, register schedules in a separate startup script (like the existing seed scripts: `pnpm seed:permissions`), not in the worker loop. This runs once per deployment, not once per worker
- pg-boss v11 supports multiple schedules per queue with a `key` option. Use `key: scheduleName` to prevent duplicate registrations

**Phase to address:** Phase 5 (Scheduled Agent Execution) -- SCH-03 registration must handle multi-worker startup

---

### MODERATE-3: Identity Document Versioning Creates Unbounded Storage Growth

**What goes wrong:** Phase 7 creates a new version on every identity document update (IDN-06). If an agent updates its identity document at the end of every conversation (which the prompt encourages), and the agent runs 10 conversations per day, that is 10 versions per document per day. Over weeks, the version history grows to hundreds of entries per document type per agent.

**Prevention:**
- Retain only the last N versions (e.g., 10) per document type. Older versions are archived or deleted on a schedule
- Use a compaction strategy similar to history manager: if the last 3 versions are very similar (high cosine similarity of content embeddings), keep only the most recent
- Version diffing should be lazy: compute and store diffs only when requested through the dashboard, not on every update
- Add a `version_count` column to the identity documents table. The `identity:update` tool checks this before creating a new version and triggers compaction if the count exceeds the limit

**Phase to address:** Phase 7 (Persistent Agent Identity) -- IDN-06 versioning must include retention policy

---

### MODERATE-4: Retrieval Strategy Abstraction Adds Latency Without Benefit in v2.9

**What goes wrong:** Phase 8 creates a pluggable retrieval pipeline with strategy registry, score fusion interface, and per-agent configuration. But in v2.9, only vector search ships as a concrete strategy (KRS-01 deferred to v3.0). The abstraction adds code complexity, an additional indirection layer, and potential latency (strategy resolution, weight application) with zero functional benefit until v3.0 adds real strategies.

**Prevention:**
- Design the abstraction but keep the implementation simple. The default vector strategy should be zero-overhead: if no retrieval config is specified in YAML, the pipeline calls the current vector search function directly with no abstraction layer in between
- Use the strategy interface as a TYPE contract, not a runtime dispatch. The registry resolves strategy names to functions, but with a single strategy registered, this is a direct call
- Do NOT introduce configuration complexity in YAML for v2.9. The `retrieval` config section should be documented but optional, with a note: "Additional strategies available in v3.0"
- The score fusion interface can be designed but should be dead code until a second strategy exists. Test it with a mock strategy in integration tests

**Phase to address:** Phase 8 (Knowledge Retrieval Enhancement) -- KR-01/KR-04 must be minimal-overhead for v2.9

---

### MODERATE-5: Concurrent Identity Document Updates From Parallel Conversations

**What goes wrong:** Phase 7's identity documents are scoped to an agent role, not a conversation (IDN-01). If two instances of dev-agent run simultaneously (which happens with parallel delegation), both may update the same identity document at conversation end. The spec acknowledges this (open question 4: "Last-write-wins with version history is probably sufficient for v1") but last-write-wins means the first conversation's identity update is silently overwritten by the second.

**Prevention:**
- Last-write-wins is acceptable for v1, but LOG the overwrite. If conversation A updates the architectural_model at 10:05:01 and conversation B overwrites it at 10:05:03, the dashboard should show both versions with their source conversations
- Use optimistic concurrency: include a `version` column. The `identity:update` tool does `UPDATE WHERE version = $expected_version`. If the version changed (another conversation updated it), retry with a merge prompt: "Your identity document was updated by another conversation. Here is their update: [diff]. Merge your update with theirs."
- For v1, the merge prompt is too complex. Accept last-write-wins but ensure both versions are retained in the version history (IDN-06) so nothing is lost

**Phase to address:** Phase 7 (Persistent Agent Identity) -- IDN-04 update mechanism

---

### MODERATE-6: Budget Exhaustion Signal Not Reaching All Tree Conversations

**What goes wrong:** Phase 4's BUD-04 requires that when the tree budget is approaching exhaustion, all active conversations in the tree receive a warning signal. But finding all active conversations in a delegation tree requires traversing the task hierarchy (tasks -> conversations -> active status). If one conversation is `waiting` (paused), the warning signal is queued but not immediately processed. When it resumes, the context may have changed.

**Prevention:**
- Budget warnings should be delivered via the existing signal mechanism, not a new mechanism. Use `executor.signal()` for each active conversation in the tree
- For waiting conversations, the signal is queued (existing behavior). When the conversation resumes, it processes the budget warning alongside whatever signal woke it
- The budget warning signal should include the current remaining budget and the percentage, so the agent can calibrate regardless of when it processes the warning
- Hard exhaustion (BUD-04) should be enforced at the executor level, not via signals. When the tree budget reaches zero, ALL conversations in the tree should have their `max_iterations` set to 0 in the database, preventing further LLM calls. This is an infrastructure guarantee, not an agent decision

**Phase to address:** Phase 4 (Tree-Level Token Budgets) -- BUD-04

---

## Minor Pitfalls

Low-severity issues that should be addressed but are not blockers.

---

### MINOR-1: Cron Timezone Confusion

**What goes wrong:** Phase 5's cron expressions need a timezone (SCH-05 open question). Developers define schedules in their local timezone but the system interprets them in UTC. "Monday 9am" becomes "Monday 9am UTC" which is "Monday 4am EST" or "Monday 12am PST."

**Prevention:**
- Default to UTC and document it clearly in the YAML schema validation error messages
- Add an optional `timezone` field in the schedule definition. Validate timezone strings against the IANA timezone database at definition load time (KR-08 validates at startup)
- The dashboard should always show schedule times in both UTC and the configured timezone

**Phase to address:** Phase 5 (Scheduled Agent Execution) -- SCH-02 format validation

---

### MINOR-2: Counter-Propose Creates Asymmetric Tool Availability

**What goes wrong:** Phase 1 adds `counter_propose` as a response type to `task:respond`. But only the TARGET agent has `task:respond` in its tool list. The DELEGATOR needs to process counter-proposals and respond (accept the modification, reject, or try someone else), but the delegator does not have a tool for explicitly accepting/rejecting a counter-proposal. The delegator's response is implicit in its next action (re-delegate, cancel, wait_for_task).

**Prevention:**
- The delegator does not need a new tool for counter-proposal handling. When a counter-proposal signal arrives, the delegator's conversation resumes with the modification details. The delegator can then: (a) call `wait_for_task` to accept and continue waiting, (b) call `executor.cancel()` on the target conversation and re-delegate, or (c) respond via the existing signal mechanism
- Add clear prompt guidance: "When you receive a counter-proposal, evaluate the modification. If acceptable, proceed with wait_for_task. If not, cancel the delegation and try someone else."
- Do NOT add a `delegator_respond` tool -- this would create unnecessary symmetry. The delegator's existing tools (wait_for_task, delegate_task, cancel via signal) are sufficient

**Phase to address:** Phase 1 (Richer Negotiation) -- NEG-01/NEG-02

---

### MINOR-3: Knowledge Flush Sentinel Detection Is Fragile

**What goes wrong:** Phase 8's pre-compaction flush (KR-06) expects the agent to respond with a sentinel if there is nothing to store. If the agent responds with natural language ("I don't have anything important to store") instead of a structured sentinel, the flush detection logic may not recognize it as "nothing to store" and retry the flush turn.

**Prevention:**
- Do not rely on text-based sentinel detection. Instead, check the tool call log: if the flush turn completed without calling `knowledge:store`, treat it as "nothing to store" regardless of the text response
- Set `maxIterations: 1` for the flush turn. The agent gets exactly one chance to store knowledge. If it does not call `knowledge:store` in that single iteration, flush is complete
- If the agent calls `knowledge:store` in the flush turn, allow up to `maxIterations: 3` to store multiple entries

**Phase to address:** Phase 8 (Knowledge Retrieval Enhancement) -- KR-06

---

## Phase-Specific Warning Matrix

| Phase | Topic | Likely Pitfall | Severity | Mitigation |
|-------|-------|---------------|----------|------------|
| Phase 1 | Richer Negotiation | Clarification deadlock from nested wait-for (CRITICAL-1) | CRITICAL | Extend wait_for_task to always include task_clarification |
| Phase 1 | Richer Negotiation | Unbounded negotiation loop (HIGH-1) | HIGH | Hard limit on counter-proposal rounds (max 2) |
| Phase 1 | Richer Negotiation | Asymmetric tool availability (MINOR-2) | MINOR | Delegator uses existing tools, no new tool needed |
| Phase 2 | Parallel Delegation | Completion race condition (CRITICAL-2) | CRITICAL | pg_advisory_xact_lock or atomic SQL with RETURNING |
| Phase 2 | Parallel Delegation | Group cancellation races (HIGH-6) | HIGH | Group-scoped signal matching, group "satisfied" flag |
| Phase 3 | Transparent Materialization | Webhook echo loop (CRITICAL-4) | CRITICAL | Outbound change tracking + actor-based echo suppression |
| Phase 3 | Transparent Materialization | Linear availability coupling (MODERATE-1) | MODERATE | Fire-and-forget materialization with pg-boss retry queue |
| Phase 4 | Tree-Level Token Budgets | Double-spend under concurrency (CRITICAL-3) | CRITICAL | Atomic SQL decrement, never read-modify-write |
| Phase 4 | Tree-Level Token Budgets | Warning signal not reaching all conversations (MODERATE-6) | MODERATE | Enforce exhaustion at executor level, not via signals |
| Phase 5 | Scheduled Agent Execution | Overlap with singleton collision (HIGH-2) | HIGH | Stately queues + application-level overlap check |
| Phase 5 | Scheduled Agent Execution | Multi-worker registration conflict (MODERATE-2) | MODERATE | Advisory lock during registration or separate seed script |
| Phase 5 | Scheduled Agent Execution | Timezone confusion (MINOR-1) | MINOR | Default UTC, optional IANA timezone field |
| Phase 6 | Sub-Agent Discovery | Wrong match from embedding similarity (HIGH-3) | HIGH | Minimum similarity threshold + domain pre-filter |
| Phase 7 | Persistent Agent Identity | Token bloat at conversation start (HIGH-4) | HIGH | Per-type token limits, skip for sub-agents |
| Phase 7 | Persistent Agent Identity | Concurrent update overwrites (MODERATE-5) | MODERATE | Last-write-wins with version history for v1 |
| Phase 7 | Persistent Agent Identity | Unbounded version storage (MODERATE-3) | MODERATE | Retain last N versions, compact similar versions |
| Phase 8 | Knowledge Retrieval Enhancement | Flush causes side effects (HIGH-5) | HIGH | Restrict tool set to knowledge: namespace only |
| Phase 8 | Knowledge Retrieval Enhancement | Abstraction overhead without benefit (MODERATE-4) | MODERATE | Zero-overhead default path, strategy as type contract |
| Phase 8 | Knowledge Retrieval Enhancement | Sentinel detection fragile (MINOR-3) | MINOR | Check tool call log, not text response |
| Phases 7+8 | Lifecycle Hooks | Ordering creates unpredictable turns (CRITICAL-5) | CRITICAL | Ordered pipeline, not independent hooks |

---

## Integration Pitfalls: Cross-Phase Interactions

These pitfalls emerge from the combination of multiple phases, not from any single phase alone.

### INTEGRATION-1: Parallel Delegation + Tree Budget + Clarification = Budget Death Spiral

Parallel delegation (Phase 2) creates N conversations from one budget. Tree-level budgets (Phase 4) split the budget across them. If one of those conversations uses clarification (Phase 1), the clarification round-trip consumes tokens from BOTH the delegator's budget share AND the target's budget share (the delegator must resume, process, re-pause). In a tree with 5 parallel tasks and frequent clarifications, the budget can be exhausted before any task completes.

**Mitigation:** Clarification should have a separate token allocation from the main task budget. Or: count clarification round-trips against the target's budget, not the delegator's (the target initiated the clarification).

### INTEGRATION-2: Scheduled Execution + Identity Documents = Stale Identity

A scheduled agent runs weekly (Phase 5). Its identity documents (Phase 7) are injected at conversation start. If the agent only runs once a week, the identity documents are updated at most weekly. But other agents may have stored knowledge (Phase 8) relevant to this agent's domain during the week. The scheduled agent starts with a week-old mental model.

**Mitigation:** Before injecting identity documents for scheduled agents, check if relevant knowledge entries have been stored since the last identity update. If so, append a "new knowledge since your last run" summary to the identity injection.

### INTEGRATION-3: Transparent Materialization + Parallel Delegation = Ticket Flood

A delegator creates 5 parallel tasks with `materialization: "transparent"`. Each creates a Linear ticket. If the delegator's task is also materialized, that is 6 Linear tickets for what is conceptually one unit of work. Humans see a flood of tickets and lose the forest for the trees.

**Mitigation:** Group materialization: when a task group is created with transparent materialization, create a SINGLE parent ticket with subtask links, not individual tickets. This requires the materialization layer to understand groups (Phase 2 + Phase 3 interaction).

### INTEGRATION-4: Sub-Agent Discovery + Capability-Based Spawn + Parallel Groups = Unpredictable Parallelism

A delegator creates a parallel group with `capability: "write code"` and `count: 3`. Sub-agent discovery (Phase 6) resolves to the coder sub-agent. But sub-agents are spawned within the parent's conversation (not as separate conversations). Parallel delegation (Phase 2) creates separate conversations. These are different execution models. If the delegator mixes capability-based spawn (sub-agent) with parallel delegation (cross-conversation), the interaction is undefined.

**Mitigation:** Parallel delegation is for orchestrator-to-orchestrator. Sub-agent spawning is for within-conversation. Do not allow capability-based discovery in `delegate_group`. Discovery is for `spawn_agent` only. Parallel delegation uses explicit entity directory lookups.

---

## The Overarching Risk: Signal Machinery Complexity

v2.9 pushes the signal/wait machinery harder than any previous milestone. Consider what happens to a single `executeConversation()` call after v2.9:

| Step | Before v2.9 | After v2.9 |
|------|-------------|------------|
| Signal types to match | 3-5 (approval, pr_review, etc.) | 10+ (task_completion, task_failure, task_timeout, task_handshake, task_clarification, task_group_completion, budget_warning, schedule_triggered...) |
| Wait-for configurations | Single wait_for per pause | Multiple wait_for cycles (clarification -> re-wait -> completion) |
| Pre-loop hooks | None | Knowledge flush (Phase 8) |
| Post-loop hooks | None | Identity update (Phase 7) |
| Budget checks | Per-conversation only | Per-conversation + tree-level |
| Signal sources | External (webhooks) + internal (timeouts) | External + internal + scheduled + budget + group aggregation |

Each addition is individually simple. Combined, the `executeConversation()` function grows from its current ~1100 lines to potentially ~1500+ lines with hooks, budget checks, and group signal handling. This is the single most important code path in the system.

**The most important mitigation across all phases:** Extract the lifecycle hook mechanism, budget checking, and signal aggregation into well-tested, composable modules. Do not grow `executeConversation()` linearly with each phase. Phase 8 should establish the hook pattern. Phase 4 should establish the budget check pattern. Phase 2 should establish the signal aggregation pattern. Each pattern should be independently testable and composable.

---

## Sources

### Web Research
- [Multi-Agent Coordination Strategies](https://galileo.ai/blog/multi-agent-coordination-strategies) -- Deadlock prevention, resource contention patterns
- [Why Multi-Agent LLM Systems Fail (MAST Taxonomy)](https://arxiv.org/html/2503.13657v1) -- 1600+ failure traces, specification/coordination = 79% of failures
- [17x Error Trap of Bag of Agents](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) -- Topology matters more than agent count
- [Preventing Infinite Loops in Bidirectional Syncs](https://www.workato.com/product-hub/how-to-prevent-infinite-loops-in-bi-directional-data-syncs/) -- Record hashing, directional flags for echo prevention
- [pg-boss Cron Scheduling Limitations](https://github.com/timgit/pg-boss/issues/427) -- Jobs cannot run more than once per minute
- [pg-boss v10 Singleton Behavior](https://github.com/timgit/pg-boss/releases/tag/10.0.0) -- Singleton key, stately queues
- [pg-boss v11 Multiple Schedules](https://github.com/timgit/pg-boss/releases/tag/11.0.0) -- Schedule per unique key
- [Expensively Quadratic: LLM Agent Cost Curve](https://blog.exe.dev/expensively-quadratic) -- Token budget growth in multi-turn agent conversations
- [Token-Budget-Aware LLM Reasoning](https://arxiv.org/html/2412.18547v1) -- Dynamic budget allocation by complexity
- [SagaLLM: Transaction Management for LLM Agents](https://www.vldb.org/pvldb/vol18/p4874-chang.pdf) -- Concurrent agent state consistency
- [Hybrid Search in PostgreSQL](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) -- Vector + keyword retrieval pitfalls

### Codebase Analysis (PRIMARY SOURCE)
- conversation-executor.ts -- Signal delivery, re-trigger logic, FOR UPDATE locking
- worker-loop.ts -- executeConversation lifecycle, signal consumption, history compaction, delegation context
- signal-matching.ts -- Type matching, taskId-scoped matching
- timeout-scheduler.ts -- pg-boss scheduling, singleton key usage
- wait-for-tool.ts / wait-for-task-tool.ts -- Wait state management, multi-type support
- token-budget.ts -- In-memory budget sharing pattern
- delegate-task.ts / respond-task.ts / complete-task.ts -- Delegation flow, handshake protocol
- spawn-agent.ts -- Sub-agent execution, shared budget, depth tracking
- schema.ts -- Table structure, task hierarchy, knowledge entries, entity directory
- knowledge store/query tools -- Embedding-based search, deduplication
