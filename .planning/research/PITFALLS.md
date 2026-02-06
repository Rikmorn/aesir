# Domain Pitfalls: v2.5 Agentic Conversations

**Domain:** Adding task primitives, conversation reopening, integration correlation, and prompt rewrites to an existing Postgres-backed agent system
**Researched:** 2026-02-06
**Overall confidence:** HIGH (analysis grounded in existing codebase, official PostgreSQL documentation, prompt engineering literature, and multi-agent system post-mortems)

---

## Critical Pitfalls

Mistakes that cause production outages, data corruption, or forced rewrites of recently-shipped work.

---

### CRITICAL-1: Conversation Reopening Creates Split-Brain Between Conversation State and World State

**Severity:** CRITICAL
**Phase to address:** Phase 2 (Conversation Reopening)

**What goes wrong:**
A conversation completes at time T1 with world state W1 (e.g., PR #42 is open, Linear issue AES-100 is "In Progress"). At time T2, a `reopen` signal arrives. The conversation is re-queued with its full prior history. The agent resumes and reads its own prior messages: "I created PR #42 and it's ready for review." But at T2, PR #42 may have been merged, closed, force-pushed, or had its branch deleted. The agent's history is factual about what *happened* but wrong about the *current state of the world*.

This is the most dangerous pitfall because the agent will act confidently on stale information. It will not question its own prior messages.

**Why it happens:**
The v2.5 spec states: "Agent receives full prior history plus the signal context on resume." History tells the agent what it did, but not what has changed since. The existing history manager compacts old tool results but does not inject fresh state. There is no mechanism in the current executor to refresh external state on reopen.

**Real-world analogy:**
Zendesk and Intercom both handle this by showing agents a *context panel* alongside the ticket history -- displaying the customer's current account state, recent interactions, and any changes since the ticket was last active. They separate "what happened" (ticket history) from "what is true now" (live context panel). Aesir needs an equivalent.

**Consequences:**
- Agent creates duplicate PRs because it thinks the original was never created (correlation not checked)
- Agent updates a Linear issue that was already moved to a different state by a human
- Agent writes code on a branch that no longer exists (force-pushed or deleted)
- Agent reports success based on stale information ("PR #42 is ready for review" when it was already merged)
- User trust erodes: the agent confidently states things that are demonstrably false

**Prevention:**
1. **Inject a `<world_state>` context block when reopening.** Before re-queuing the conversation, the executor (or routing layer) should query current state of known artifacts (via MCP tools or correlation lookups) and inject a summary as a system-level context block. This is the "Zendesk context panel" equivalent.
2. **Add a constitutional constraint to reopened-conversation prompts:** "When resuming a previous conversation, verify the current state of any artifacts you previously created before acting on them. Your history is accurate about what you did, but the world may have changed."
3. **Signal payload must include delta information.** The `reopen` signal should carry what changed, not just that something happened. "PR #42 received a review with requested changes" is actionable; "reopen" alone is not.
4. **Do NOT rely on the agent to self-correct.** The agent cannot know what it does not know. If the PR was deleted, no amount of prompt guidance will make the agent check for it unless the context injection tells it to.

**Warning signs:**
- Agent messages reference artifacts that no longer exist in their stated form
- Agent attempts to update resources that return 404 or conflict errors
- Agent creates duplicate artifacts (PRs, issues) because it cannot see the existing ones

**Confidence:** HIGH -- this is a fundamental design challenge, not speculative. Every helpdesk system that supports ticket reopening has had to solve this exact problem.

---

### CRITICAL-2: Task-Level Event Serialization Deadlocks with Conversation-Level SKIP LOCKED

**Severity:** CRITICAL
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The v2.5 spec introduces task-level serialization: "Events for the same task are serialized. Second event queued as signal, delivered when active conversation completes or pauses." The existing system uses `FOR UPDATE SKIP LOCKED` on the conversations table. The new system needs to also lock at the task level to serialize events. If these two locking mechanisms are not carefully ordered, a deadlock occurs:

- Worker A holds conversation lock for conv-1 (task T1), tries to acquire task lock for T1 to write a handoff
- Worker B holds task lock for T1 (processing a new event), tries to acquire conversation lock for conv-1 to deliver a signal

PostgreSQL will detect and abort one transaction, but the retry loop may recreate the same conditions.

**Why it happens:**
The current `claimConversations()` function uses a CTE with `FOR UPDATE SKIP LOCKED` on `agents.conversations`. The task primitive introduces a second lockable entity (`agents.tasks`). Any operation that needs to lock both must acquire them in a consistent order. The v2.5 spec does not specify a lock acquisition order.

**Consequences:**
- Intermittent deadlock errors under concurrent load
- Conversation retries that consume the retry budget on infrastructure errors (not agent errors)
- Worker starvation if one task's conversations keep deadlocking
- Non-reproducible in single-conversation testing; only surfaces under concurrent multi-task load

**Prevention:**
1. **Define and enforce a canonical lock order: task first, then conversation.** Document this as an invariant. All code paths that touch both tables must acquire the task lock before the conversation lock.
2. **Use advisory locks for task-level serialization** instead of row locks on the tasks table. `pg_advisory_xact_lock(hashtext(task_id))` provides the serialization without competing with the SKIP LOCKED mechanism on conversations. Advisory locks live in a separate lock space and cannot deadlock with row locks.
3. **Add a deadlock detection metric.** Monitor `pg_stat_activity` for `deadlock` wait events. Any non-zero count is a bug.
4. **Test with concurrent event delivery to the same task.** The unit test suite for the task primitive must include a test that fires 10+ events at the same task concurrently and verifies no deadlocks.

**Warning signs:**
- `ERROR: deadlock detected` in PostgreSQL logs
- Conversations failing with retry exhaustion on infrastructure errors
- Inconsistent behavior under load that disappears during debugging

**Confidence:** HIGH -- deadlocks between two-level locking are a well-documented PostgreSQL pitfall. The incident.io engineering blog documents an extended debugging session for exactly this pattern in a queue system.

---

### CRITICAL-3: Prompt Rewrite Silently Regresses Agent Behavior Without Detection

**Severity:** CRITICAL
**Phase to address:** Phase 1 (Prompt Rewrites)

**What goes wrong:**
The v2.5 spec calls for rewriting product-agent and dev-agent prompts from procedural state machines to constitutional + few-shot style. The current product-agent prompt has 10+ behavioral rules encoded as if/then branches (CLEAR REQUEST flow, VAGUE REQUEST flow, USER CONFIRMS flow, etc.). These encode hard-won behavioral fixes -- each rule exists because the agent failed without it. When you rewrite the prompt to constitutional style, you remove the explicit rules but may not capture the *reason* for the rule in the constitutional constraint.

Example: The current product-agent prompt has "IMPORTANT: Steps 1-5 happen in ONE turn." This exists because the agent was observed splitting the duplicate search and draft into separate turns, causing a confusing multi-message flow for users. A constitutional rewrite might say "Never ask the user to wait unnecessarily" -- which is vaguer and may not prevent the same split-turn behavior.

**Why it happens:**
Prompt rewrites are behavioral changes, not code refactors. You cannot run a linter or type checker to verify that the new prompt produces the same outputs for the same inputs. LLM behavior is probabilistic -- the same input might produce correct output 95% of the time with the old prompt and 85% of the time with the new one. This 10% regression is invisible without systematic evaluation.

The Prompt Authoring Guide correctly warns against state machines in natural language, but the transition from state machine to constitutional constraints requires understanding *why each rule exists*, not just removing rules.

**Consequences:**
- Agent starts asking unnecessary clarifying questions (lost the "clear request" fast path)
- Agent forgets to search for duplicates before creating issues (lost the explicit "search first" instruction)
- Agent creates issues without user confirmation (lost the explicit "confirm before creating" instruction)
- Dev-agent skips human approval for complex changes (lost the explicit approval gate)
- Behavioral regressions are noticed by users, not tests, eroding trust in the rewrite

**Prevention:**
1. **Create a behavioral test suite BEFORE rewriting prompts.** Document 10-15 real conversation scenarios for each agent with expected behavior. Include: clear request, vague request, duplicate found, user confirms, user cancels, multi-issue, tool failure. Run them against the current prompt to establish baseline.
2. **Use promptfoo or equivalent** for regression testing. Define test cases as YAML with expected outputs (tool calls made, messages sent, phase tags emitted). Run against both old and new prompts.
3. **For each if/then rule removed, document WHY it existed** and verify the constitutional constraint covers the same failure mode. Create a traceability matrix: old rule -> failure it prevented -> new constraint that covers it.
4. **Deploy prompt changes with a shadow mode.** Run both old and new prompts in parallel on the same inputs, compare outputs, flag divergences. This requires framework support (not currently in v2.3).
5. **Rewrite incrementally, not all at once.** Rewrite one behavioral area at a time (e.g., duplicate detection first), validate, then move to the next. The spec says "Both agents rewritten in parallel" -- this means two agents simultaneously, but each agent's prompt should still be rewritten incrementally within that parallel track.

**Warning signs:**
- Agent behavior changes that users report ("it used to do X, now it does Y")
- Phase tag distribution shifts (more `clarifying` phases, fewer `complete` phases, or vice versa)
- Tool call patterns change (fewer `linear_search_issues` calls suggesting duplicate check is being skipped)
- User satisfaction drops without any infrastructure change

**Confidence:** HIGH -- prompt regression is extensively documented in the prompt engineering literature. Promptfoo, Braintrust, and PromptLayer all exist specifically because this problem is common and hard to detect without tooling.

---

### CRITICAL-4: schema.drizzle.ts Legacy Table Name Collision with New tasks Table

**Severity:** CRITICAL
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The existing `schema.drizzle.ts` already contains a `tasks` table definition from the legacy v1/v2 system. It is explicitly retained to "prevent destructive DROP TABLE migrations" (documented in CLAUDE.md Gotchas). The v2.5 spec introduces a new `agents.tasks` table with a completely different schema (polymorphic creator/assignee, parent_id, status enum, etc.). If the migration is generated against the existing `schema.drizzle.ts`, drizzle-kit will attempt to ALTER the existing table instead of creating a new one, potentially corrupting the migration or dropping columns that contain legacy data.

**Why it happens:**
The CLAUDE.md Gotchas section explicitly warns: "schema.drizzle.ts retains old table definitions to prevent destructive DROP TABLE migrations -- do not clean it up." But the new v2.5 tasks table has the same name in the same schema namespace (`agents.tasks`). Drizzle-kit uses the drizzle schema file to determine what exists and what to change.

**Consequences:**
- Migration attempts ALTER TABLE on legacy tasks instead of creating new schema
- Legacy task data could be corrupted or dropped
- Migration may fail if column types are incompatible
- If migration succeeds but is wrong, rolling back becomes difficult

**Prevention:**
1. **Check if legacy `agents.tasks` table has any data in production/development databases.** If it is empty, the safest approach is to DROP it in a separate migration first, then create the new table.
2. **If legacy data exists, use a different table name** for the v2.5 task primitive (e.g., `agents.work_tasks` or `agents.task_items`) to avoid the collision entirely.
3. **If using the same name, write the migration manually** instead of relying on drizzle-kit generation. Explicitly DROP the old table (after verifying it is unused) and CREATE the new one in the same migration.
4. **Update `schema.drizzle.ts` carefully.** Replace the old `tasks` definition with the new one, and verify the generated migration is an explicit DROP + CREATE, not an ALTER.
5. **Test the migration against a database with the old table present.** Do not assume a fresh database test covers this case.

**Warning signs:**
- Drizzle-kit generating ALTER TABLE instead of CREATE TABLE
- Migration errors referencing columns that should not exist
- `schema.drizzle.ts` having two task-related definitions

**Confidence:** HIGH -- this is directly observable in the existing codebase. The legacy `tasks` table definition is at lines 116-157 of `schema.drizzle.ts`.

---

## Major Pitfalls

Mistakes that cause significant rework, architectural debt, or multi-day debugging sessions.

---

### MAJOR-1: Integration Correlation Recording Fails Silently When MCP Call Succeeds

**Severity:** MAJOR
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The v2.5 spec describes a two-step process: (1) agent calls MCP tool to create an artifact (e.g., `github_create_pull_request`), (2) integration records the correlation (PR #42 -> task T123). The spec says "Agent passes task_id as MCP call context." But if the MCP call succeeds (PR created) and then the correlation recording fails (DB error, timeout, integration crash), you have an artifact that exists in the external system but is invisible to the task routing system.

The next webhook for that artifact (e.g., PR review) will arrive with no task correlation, fall through to the slow path, and either create a new conversation or be misrouted.

**Why it happens:**
The MCP protocol is a request-response HTTP call. The artifact creation and correlation recording happen in the same integration service, but there is no transactional guarantee between "call external API" and "record correlation in database." External API calls cannot participate in database transactions.

**Consequences:**
- Orphaned artifacts that are invisible to the task system
- Webhook events for those artifacts get misrouted
- Agent creates duplicate artifacts because it cannot find the original via task correlation
- Debugging is difficult because the MCP call logs show success but no correlation exists

**Prevention:**
1. **Record the correlation BEFORE calling the external API (optimistic correlation).** Insert the correlation record with a `pending` status, call the external API, then update to `confirmed`. If the API call fails, delete the pending correlation. This ensures the correlation exists even if the post-API-call recording fails.
2. **Alternative: Record correlation in the same transaction as the webhook receipt.** When the first webhook arrives for a new artifact, check if the artifact was recently created by an agent (via MCP call logs or event log) and create the correlation retroactively.
3. **Add a reconciliation job** that periodically scans recent MCP `create_*` tool events in the event log and verifies that corresponding correlation records exist. Flag any orphaned artifacts.
4. **Make the MCP tool return the correlation ID** so the agent can verify the correlation was recorded. If the tool response does not include a correlation confirmation, the agent should log a warning.

**Warning signs:**
- MCP tool.succeeded events with no corresponding correlation record
- Webhook events hitting the slow path that should have been routed via task correlation
- Agent creating duplicate artifacts for the same task

**Confidence:** HIGH -- this is the classic distributed systems "exactly once" problem. The two-step pattern (call API, record locally) is inherently unreliable without compensation.

---

### MAJOR-2: Task Metadata JSONB Grows Unbounded as Conversations Accumulate

**Severity:** MAJOR
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The `tasks.metadata` column is JSONB with `DEFAULT '{}'`. The v2.5 spec does not specify any schema or size constraints on this field. Over time, agents, tools, or framework code will add metadata to tasks: artifact references, conversation summaries, intermediate results, error logs, integration-specific data. Once multiple conversations contribute metadata to a single task, the JSONB grows without bound.

This is the same JSONB bloat problem documented in CRITICAL-1 of the v2.3 pitfalls but applied to the tasks table. The v2.3 conversations table already demonstrated this risk with the `messages` column.

**Why it happens:**
JSONB columns with no schema enforcement attract unstructured data accumulation. Every feature addition adds "just one more field" to metadata. PostgreSQL rewrites the entire JSONB value on every UPDATE, and large JSONB values spill to TOAST storage with the performance cliffs documented in pganalyze benchmarks (10x slower reads for TOAST-compressed vs inline).

**Consequences:**
- Task queries slow down as metadata grows (TOAST decompression on every read)
- Write amplification on task updates (full JSONB rewrite per update)
- Index bloat if GIN indexes are added to metadata
- No way to query specific metadata fields efficiently without extracting to columns

**Prevention:**
1. **Define a Zod schema for `metadata`** and validate on write. Even a permissive schema (`z.record(z.unknown()).refine(jsonSize < 10KB)`) prevents unbounded growth.
2. **Use the handoffs table for conversation-scoped context**, not task metadata. Metadata should contain only task-level attributes (tags, priority overrides, custom fields), not accumulated conversation data.
3. **Set a hard size limit** on the metadata column (e.g., 10KB) enforced at the application layer. Log a warning at 5KB.
4. **Do not add metadata in hot paths.** If the agent loop is updating task metadata on every tool call, extract that to a separate table with append semantics.

**Warning signs:**
- `pg_column_size(metadata)` increasing over task lifetime
- Task queries getting slower for long-lived tasks
- Developers adding arbitrary keys to metadata without schema review

**Confidence:** HIGH -- this is a known PostgreSQL anti-pattern with extensive documentation. Heap's engineering blog specifically warns against unbounded JSONB growth in production systems.

---

### MAJOR-3: Handoff Content Degrades Through Delegation Chains (Telephone Game Effect)

**Severity:** MAJOR
**Phase to address:** Phase 4 (Prompt Evolution)

**What goes wrong:**
The v2.5 design relies on agent-authored handoffs as the primary context-passing mechanism. When Agent A completes a conversation and writes a handoff, then Agent B starts a new conversation using that handoff as context, the handoff is a *lossy summary*. If Agent B then delegates to Agent C with another handoff, the compression compounds. After 3-4 handoffs, critical details from the original conversation may be entirely lost.

This is the "telephone game" problem documented extensively in multi-agent system literature. Each handoff is a summarization step, and each summarization step loses information that may be relevant downstream.

**Why it happens:**
The v2.5 design vision states: "The agent knows what's important. An auto-summary treats everything equally." This is true for single handoffs but breaks down across chains. Agent A knows what was important in *its* conversation but not what will be important for Agent C three handoffs later. Agent A might omit a detail that seems irrelevant to its immediate successor but is critical for a downstream agent.

**Consequences:**
- Downstream agents lack context to make good decisions
- Agents repeat work because they do not know it was already done
- Debug investigations require tracing through multiple handoff records to reconstruct what happened
- Token budgets wasted on agents re-discovering information that was available but lost in a handoff

**Prevention:**
1. **The `get_task_context` tool should return ALL handoffs, not just the most recent.** The v2.5 spec says "only deliver most recent by default; older ones available via get_task_context tool." Make sure agents know to call this tool when the most recent handoff references prior work.
2. **Structured handoff content.** Define a schema for handoffs: `{ summary, artifacts_created: [], decisions_made: [], open_questions: [], key_constraints: [] }`. Structured data resists the telephone game better than free-text summaries because each field is explicitly maintained.
3. **Include a `handoff_chain_depth` field** on the handoff record. When depth exceeds 3, inject a warning to the receiving agent: "This task has been through multiple handoffs. Review the full handoff history via get_task_context before proceeding."
4. **Token budget allocation for handoff context.** Reserve a fixed portion of the token budget (e.g., 10%) for handoff context injection. If the handoff history exceeds this allocation, summarize the oldest handoffs but keep the most recent 2-3 intact.

**Warning signs:**
- Agents asking for information that exists in earlier handoffs
- Agents repeating work already completed in earlier conversations
- Handoff content getting progressively shorter and less specific through chains
- Users observing that agents "forgot" what was discussed earlier

**Confidence:** MEDIUM -- the telephone game effect is well-documented in multi-agent literature, but the severity depends on how deep delegation chains actually get in practice. The v2.5 depth limit of 5 mitigates but does not eliminate this.

---

### MAJOR-4: Event Router Task Lookup Adds Latency to Every Event, Including Non-Task Events

**Severity:** MAJOR
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The v2.5 routing priority is: (1) has task reference -> route to task, (2) unambiguous trigger -> fast-path start, (3) ambiguous -> reasoning path. Step 1 requires a database lookup on the integration correlation table for every incoming event, even events that have no task association (new issue assignments, first-time Slack messages, etc.). The current EventRouter.handle() is synchronous and pure -- no I/O. Adding a task lookup makes it async and database-dependent.

**Why it happens:**
The integration layer is supposed to attach the task reference before forwarding to the agent service ("Integration attaches task reference if correlation exists"). But this means every integration webhook handler now needs to do a correlation table lookup before forwarding. This lookup runs on the hot path of every webhook.

**Consequences:**
- Added latency (5-50ms per event) for all events, including those that will never match a task
- Database load increases linearly with event volume
- If the correlation table query is slow (missing index, table bloat), it becomes a bottleneck for all event routing
- The previously synchronous EventRouter.handle() becomes async, requiring refactoring of the router

**Prevention:**
1. **Keep the integration-side correlation lookup, but make it best-effort with a cache.** Cache recent correlations in memory (LRU, 5-minute TTL). Most webhooks arrive in clusters for the same artifact -- the first lookup populates the cache, subsequent ones are free.
2. **Add the correlation lookup to the integration webhook handler, not the EventRouter.** The EventRouter should remain synchronous with an optional `taskId` field on IncomingEvent. The integration sets it before forwarding. This keeps the router fast and pushes the DB lookup to the boundary.
3. **Index the correlation table properly.** `PRIMARY KEY (external_type, external_ref)` is already defined in the spec -- verify this is used as a covering index for the lookup.
4. **Monitor correlation lookup latency** with p50/p95/p99 metrics. Alert if p95 exceeds 10ms.

**Warning signs:**
- Event routing latency increasing after task primitive is deployed
- Correlation table queries appearing in `pg_stat_statements` with high total_exec_time
- EventRouter tests becoming flaky due to async/database dependency

**Confidence:** HIGH -- the performance impact is directly observable. The current EventRouter is synchronous; making it async is a significant architectural change.

---

### MAJOR-5: Backward Compatibility Break for Conversations Without Tasks

**Severity:** MAJOR
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The v2.5 spec adds `task_id TEXT REFERENCES agents.tasks(id)` to the conversations table (nullable). Existing conversations have no task_id. The new event routing prioritizes task lookup. If the routing code assumes all conversations have tasks, or if the task-based serialization logic does not handle the null case, existing conversations break.

More subtly: the v2.5 prompts (Phase 4) tell agents to "think in terms of tasks." If an agent receives a conversation without a task context, the prompt's task-oriented guidance creates confusion. The agent tries to call `get_task_context` and gets nothing.

**Why it happens:**
The spec correctly notes `nullable task_id on conversations` for backward compatibility. But behavioral backward compatibility is harder than schema backward compatibility. Every code path that touches task_id must handle null. Every prompt that references tasks must degrade gracefully when there is no task.

**Consequences:**
- Existing conversations cannot be signaled or reopened if routing assumes tasks
- Null pointer / undefined access errors in code that does `conversation.task_id.something`
- Agent confusion when prompted about tasks but no task exists
- Dashboard crashes or empty task panels for taskless conversations

**Prevention:**
1. **Add a `hasTask` helper function** used consistently throughout the codebase: `const hasTask = (conv) => conv.task_id !== null`. All task-related logic is gated behind this check.
2. **Keep the existing event routing paths intact.** Task lookup is a *new first step*, not a replacement. If no task correlation is found, fall through to the existing start/signal/slow_path routing.
3. **Prompt guidance must include a "no task" fallback.** "If you are operating within a task, use task tools for context. If no task is available (legacy conversation), operate as you did before."
4. **Dashboard must handle null task_id gracefully.** The task panel should show "No task associated" instead of crashing.
5. **Write explicit tests for the null-task-id path** at every layer: executor, router, dashboard, agent tools.

**Warning signs:**
- TypeError or null reference errors in production logs after deployment
- Agent tool calls failing because task_id is undefined
- Dashboard 500 errors on conversation detail pages

**Confidence:** HIGH -- nullable FK backward compatibility is a standard concern, but the behavioral layer (prompts, dashboard, routing) makes it more complex than a simple schema migration.

---

### MAJOR-6: Circular Task Delegation Creates Infinite Loops

**Severity:** MAJOR
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The v2.5 spec allows agents to create subtasks with `parent_id`. The depth limit is 5 levels. But the spec does not address circular delegation: Agent A creates task T1, delegates subtask T2 to Agent B, which delegates subtask T3 back to Agent A's agent type (or even the same agent instance). If Agent A interprets T3 as a new top-level task, it may create T4 delegating back to Agent B, creating an infinite delegation loop that consumes token budget and database resources.

**Why it happens:**
The `parent_id` column prevents tree cycles (a task cannot be its own ancestor), but it does not prevent semantic cycles where the same work bounces between agents. The depth limit prevents infinite depth but allows wide delegation at each level.

**Consequences:**
- Token budget exhausted on delegation overhead instead of actual work
- Database accumulates dozens of tasks that all describe the same problem
- Human observing the system sees a cascade of tasks being created with no progress
- Difficult to detect automatically because each individual delegation is valid

**Prevention:**
1. **The `create_task` tool should check for semantic cycles.** Before creating a subtask, query the parent chain and reject if the same `assignee_id` + `assignee_type` combination appears more than once in the ancestry.
2. **Add a `max_subtasks_per_task` limit** (e.g., 10). If a task already has 10 subtasks, the create_task tool should reject with an error message guiding the agent to consolidate.
3. **Prompt guidance:** "Do not delegate work back to an agent type that delegated to you. If you cannot complete a task, escalate to a human or pause the task with a handoff explaining the blocker."
4. **Monitor task creation rate per task tree.** Alert if more than 5 tasks are created within a single parent chain in a 10-minute window.

**Warning signs:**
- Rapid task creation with same or similar titles under the same parent
- Token budget exhaustion with little actual work output
- Task trees with depth approaching the limit (4-5 levels)

**Confidence:** MEDIUM -- the depth limit in the spec mitigates this, but semantic cycles (same work bouncing between agents) are a separate concern not addressed by depth limiting.

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or confusing behavior that requires investigation.

---

### MODERATE-1: Slack thread_ts Correlation Breaks When Thread Is Forked or Channel Changes

**Severity:** MODERATE
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
Slack correlation uses `thread_ts` (the timestamp of the parent message in a thread) as the external reference. But Slack threads can be "forked" -- a reply in a thread can be posted to the channel as a standalone message, creating a new `thread_ts`. If a user replies in the forked thread, the webhook arrives with a different `thread_ts` than the original correlation.

Additionally, Slack messages can be shared across channels, and the `thread_ts` is channel-scoped. A message shared to a different channel creates a new `thread_ts` in that channel.

**Why it happens:**
The Slack Events API sends webhook payloads with `thread_ts` referencing the parent message. But Slack's threading model is more complex than a simple parent-child tree. Thread forking, channel sharing, and reply broadcasting all create situations where the same logical conversation has multiple `thread_ts` values.

**Consequences:**
- Agent loses context: a user reply in a forked thread creates a new conversation instead of continuing the existing one
- Duplicate conversations for the same user request
- Confusing user experience: agent responds in the original thread but user is in the forked thread

**Prevention:**
1. **Store both `channel_id` and `thread_ts` in the correlation record.** The composite key prevents cross-channel confusion.
2. **When correlation lookup fails, check the original message's thread for related correlations** (via `conversations.replies` API).
3. **Accept that thread forking is an edge case and document it.** The initial implementation should handle the common case (direct thread replies) and route forked threads to the slow path for LLM classification.
4. **Do not try to solve thread forking in Phase 3.** Flag it as a known limitation and add handling in a later iteration if it proves to be a real problem.

**Warning signs:**
- Users reporting that the agent "forgot" their conversation
- Duplicate conversations with the same user about the same topic
- Correlation lookup misses for events that should match

**Confidence:** MEDIUM -- thread forking is a known Slack complexity, but its frequency in practice depends on user behavior. Most Slack conversations stay in their original thread.

---

### MODERATE-2: GitHub PR Correlation Breaks on Force Push, Branch Reuse, or PR Close/Reopen

**Severity:** MODERATE
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
GitHub PR correlation uses PR number as the external reference. But the relationship between a PR and the work it represents is more complex:

1. **Force push:** The PR number stays the same, but the commits change entirely. If the agent wrote the original commits and a human force-pushes different code, the agent's handoff context is stale.
2. **Branch reuse:** Developer creates PR #42 on branch `feature/auth`, closes it, then creates PR #43 on the same branch. If correlation is branch-based, both PRs map to the same branch correlation.
3. **PR close/reopen:** A PR can be closed and reopened. The close webhook triggers `pr_closed` signal. If the user then reopens the PR, there is no standard `pr_reopened` event in the current signal type map.

**Why it happens:**
The GitHub webhook model sends events for PR-level actions, but the correlation between a PR and the work it represents is not one-to-one. Branch reuse, force pushes, and PR lifecycle events create situations where the correlation record does not reflect reality.

**Consequences:**
- Agent acts on stale PR state after force push
- Branch-based correlations map to wrong PR after branch reuse
- PR reopen events are unhandled, creating orphaned work
- CI/CD events for force-pushed commits route to the wrong conversation

**Prevention:**
1. **Correlate on PR number, not branch name.** PR numbers are unique and stable. Branch names are reusable.
2. **Handle `pull_request.reopened` webhook** as a signal that resumes the task, not a new event.
3. **On force push events (`push` with `forced: true`), inject a context message** to the active conversation: "Warning: the branch was force-pushed. Your previous commits may no longer be present. Verify the current state before proceeding."
4. **Add PR `head_sha` to the correlation record** so that stale correlations (where head_sha does not match current PR head) can be detected.

**Warning signs:**
- Agent referencing commits that no longer exist in the PR
- Multiple correlations for the same branch with different PR numbers
- `pr_closed` signals for PRs that were subsequently reopened

**Confidence:** MEDIUM -- force push and branch reuse are well-known GitHub complexity areas, but their frequency depends on team workflow.

---

### MODERATE-3: Linear Issue Status Changes Incorrectly Trigger Conversation Reopening

**Severity:** MODERATE
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
Linear sends `issue.updated` webhooks for every status change. The current system explicitly ignores `linear.issue.updated` events (in `IGNORE_EVENT_TYPES`). With task correlation, status changes on correlated issues should route to the associated task. But not all status changes are meaningful: a human moving an issue from "In Progress" to "In Review" should not reopen an agent conversation that completed successfully.

If every status change on a correlated issue triggers a reopen signal, the agent will be constantly woken up for status changes that require no action.

**Why it happens:**
The `IGNORE_EVENT_TYPES` set currently blocks all `linear.issue.updated` events. With task correlation, some of these events become relevant (e.g., issue moved back to "Todo" after being "Done" might mean rework is needed). But distinguishing "meaningful" from "noise" status changes requires understanding the workflow semantics.

**Consequences:**
- Agent reopened repeatedly for status changes that need no action
- Token budget wasted on the agent reasoning about irrelevant status changes
- User frustration as the agent re-engages on issues they are actively managing
- Potential for the agent to take unwanted actions (updating the issue back)

**Prevention:**
1. **Define a whitelist of status transitions that trigger reopening.** Only specific transitions should create signals: "Done" -> "Todo" (rework), "Done" -> "In Progress" (revision). Normal forward progression should be ignored.
2. **Add the previous and new status to the correlation event payload** so the routing layer can filter without LLM involvement.
3. **Initially, keep `linear.issue.updated` in the ignore list** and only route status changes that arrive via explicit task correlation with meaningful transition data.
4. **Let the agent decide** by routing the event as a signal with the status change data, but include prompt guidance: "Status changes on your issues are informational. Only take action if the status change indicates rework or a problem."

**Warning signs:**
- Agent conversations reopening frequently for the same issue
- Agent making no substantive changes after reopening (just acknowledging the status change)
- Increased LLM costs from unnecessary conversation turns

**Confidence:** HIGH -- Linear webhook volume for status changes is high, and the current system already ignores these events for good reason.

---

### MODERATE-4: Few-Shot Examples in Prompts Become Stale as Tools Evolve

**Severity:** MODERATE
**Phase to address:** Phase 1 and Phase 4 (Prompt Rewrites and Prompt Evolution)

**What goes wrong:**
The v2.5 prompt rewrite introduces few-shot examples with reasoning. These examples reference specific tool names, parameters, and expected behaviors. When tools change (new parameters added, tool renamed, response format changed), the examples become incorrect. An example showing `linear_create_issue` with parameter `teamId` becomes wrong if the tool is renamed or the parameter changes.

Worse: the agent may follow the stale example and produce incorrect tool calls, getting errors that it does not understand because the example told it the call was correct.

**Why it happens:**
Few-shot examples are static text in prompt.md files. They are not validated against the current tool definitions. There is no automated check that example tool calls in prompts match the actual tool schemas. The examples will work when written but drift as tools evolve.

**Consequences:**
- Agent follows stale examples and gets tool call errors
- Agent confused by errors because its example said the call was correct
- Behavioral regression that appears as "the agent got dumber" but is actually a tool/prompt mismatch

**Prevention:**
1. **Use abstract examples, not literal tool calls.** Instead of `"Action: Call linear_create_issue with title='...' and teamId='...',"` use `"Action: Create the issue in Linear with the confirmed details."` This decouples examples from tool schemas.
2. **If literal tool calls are needed in examples, add a `<!-- tools: linear_create_issue, linear_search_issues -->` comment** at the top of the examples section. Build a CI check that verifies all referenced tools exist in the agent's tool list.
3. **Review prompt examples as part of any tool change.** Add a step to the tool modification checklist: "Check if any prompt.md files reference this tool in examples."
4. **Keep the number of tool-specific examples minimal.** The Prompt Authoring Guide already recommends 3-5 examples focusing on reasoning, not tool sequences. Follow this guidance strictly.

**Warning signs:**
- Agent tool call errors that match patterns shown in prompt examples
- Examples referencing tools that no longer exist or have different signatures
- Behavioral changes after tool updates with no prompt changes

**Confidence:** HIGH -- this is a well-known maintenance burden for few-shot prompts documented in prompt engineering literature.

---

### MODERATE-5: Conversation Reopening Explodes History Beyond Compaction Capacity

**Severity:** MODERATE
**Phase to address:** Phase 2 (Conversation Reopening)

**What goes wrong:**
A conversation completes with 50 messages. It is reopened and the agent processes 30 more messages. It completes again and is reopened again with 20 more messages. The conversation now has 100+ messages, potentially exceeding the history compaction threshold. The history manager compacts, but on the next reopen, the agent receives a compacted history that may have lost important details from the first conversation run.

The existing history manager was designed for single-run conversations. Reopening means conversations can grow indefinitely across multiple runs.

**Why it happens:**
The current history manager has `pruneThreshold` (default 80,000 tokens) and `protectedMessages` (default protecting recent messages). When a conversation is reopened, the "recent messages" are from the last run, and earlier runs' messages are in the pruning zone. The history manager does not distinguish between "messages from this run" and "messages from a previous run."

**Consequences:**
- Context from earlier runs is aggressively pruned, losing important decisions and artifacts
- Token budget consumed by history that is mostly old tool results
- History compaction creates summaries-of-summaries on multi-reopen conversations (the summary merger mitigates this but adds complexity)
- Agent performance degrades as the conversation grows across reopens

**Prevention:**
1. **Use handoffs as the primary context-passing mechanism for reopened conversations.** When a conversation completes, the agent writes a handoff. When it reopens, inject the handoff as context rather than preserving the full message history. This bounds the context to handoff size + new messages, not accumulated history.
2. **Consider resetting the message history on reopen** and injecting only the handoff plus the reopen signal. The full history remains in the database for debugging but is not loaded into the agent's context window.
3. **If preserving full history, increase the `protectedMessages` count** for reopened conversations to protect the handoff context and the reopen signal.
4. **Track reopen count on the conversation record.** After N reopens (e.g., 3), suggest creating a new conversation within the task instead of reopening the same one.

**Warning signs:**
- Conversations with messages arrays exceeding 200KB
- History compaction running on every reopen
- Agent asking for information that was in the pruned history
- Token budget exhaustion from context window size

**Confidence:** HIGH -- the history manager's behavior with growing conversations is directly observable in the codebase. The single-summary-block-with-merge strategy helps but does not eliminate the accumulation problem.

---

### MODERATE-6: Constitutional Constraints Conflict With Each Other

**Severity:** MODERATE
**Phase to address:** Phase 1 (Prompt Rewrites)

**What goes wrong:**
Constitutional constraints are negative rules ("never do X"). When multiple constraints are added, they can create contradictions that the agent must resolve by guessing which constraint takes priority:

- "Never create an issue without checking for duplicates" + "Never make the user wait unnecessarily" -> What if the duplicate check takes 10 seconds?
- "Never create an issue the user hasn't confirmed" + "Never ask more than one question at a time" -> If the user request covers two issues, you cannot confirm both without asking two questions.
- "Always verify artifact state before acting" + "Minimize token usage" -> Verification costs tokens.

**Why it happens:**
Each constraint is added to prevent a specific failure mode. But constraints interact in ways that are not obvious when writing them individually. The Prompt Authoring Guide warns against "directive stacking" but does not provide a method for detecting constraint conflicts.

**Consequences:**
- Agent behavior becomes unpredictable when multiple constraints are activated simultaneously
- Different conversations resolve the same constraint conflict differently (inconsistent behavior)
- Debugging becomes difficult because the agent is technically following one constraint while violating another
- Adding new constraints increases the combinatorial space of potential conflicts

**Prevention:**
1. **Test constraint pairs for conflicts.** For N constraints, test N*(N-1)/2 pairs with scenarios that activate both. This is feasible for 5-7 constraints but not for 15+.
2. **Explicitly prioritize constraints.** "Safety constraints override efficiency constraints. Correctness constraints override speed constraints." Give the agent a framework for resolving conflicts rather than leaving it to guess.
3. **Keep the constraint count low.** The Prompt Authoring Guide suggests 10 strong directives maximum for orchestrators. For constitutional constraints specifically, aim for 5-7 per agent.
4. **Use the few-shot examples to demonstrate constraint resolution.** Include an example where two constraints are in tension and show the reasoning for which one takes priority.

**Warning signs:**
- Agent behavior varying for similar inputs (same constraints, different resolution)
- Agent reasoning (in `<reasoning>` blocks) showing explicit constraint conflict resolution
- New constraints causing regressions in previously correct behavior

**Confidence:** MEDIUM -- constraint conflicts are documented in the constitutional AI literature (C3AI paper, Anthropic's Constitutional AI research), but the severity depends on how many constraints are added and how well they are tested.

---

### MODERATE-7: Agent Writes Bad Handoffs (Too Long, Missing Key Info, Hallucinated Context)

**Severity:** MODERATE
**Phase to address:** Phase 4 (Prompt Evolution)

**What goes wrong:**
The v2.5 design relies on agent-authored handoffs as the primary context bridge between conversations. But the agent is not inherently good at writing handoffs:

1. **Too long:** Agent dumps its entire reasoning into the handoff, consuming the next conversation's token budget.
2. **Missing key info:** Agent summarizes at the wrong level of abstraction, omitting artifact IDs, branch names, or specific error messages that the next conversation needs.
3. **Hallucinated context:** Agent includes information in the handoff that is not actually true -- confusing its own reasoning with facts.

**Why it happens:**
Writing a good handoff requires meta-cognition: understanding what the next agent/conversation will need, not just summarizing what happened. LLMs are generally poor at predicting what information will be needed by a different agent with different tools and context.

**Consequences:**
- Downstream conversations start with bad context, leading to wrong decisions
- Token budgets wasted on overly verbose handoffs
- Debugging requires manual review of handoff content to verify accuracy
- Trust in the task system erodes if handoff content is unreliable

**Prevention:**
1. **Enforce a structured handoff schema** via the `complete_task` and `handoff_task` tools. The tool should require specific fields: `summary` (max 500 chars), `artifacts` (list of IDs/URLs), `decisions` (list of key decisions), `blockers` (list of open issues). Reject handoffs that exceed size limits.
2. **Validate handoff content against known artifacts.** The tool can cross-reference artifact references in the handoff against the task's correlation records. If the handoff references a PR that is not correlated, flag it.
3. **Include handoff quality examples in prompts.** Show the agent good and bad handoff examples with reasoning about what makes each good or bad.
4. **Add a handoff size budget.** Handoff context JSONB should be capped at a fixed token count (e.g., 2000 tokens). The tool enforces this limit.

**Warning signs:**
- Handoff JSONB sizes exceeding 5KB regularly
- Downstream agents calling `get_task_context` immediately after starting (suggests the handoff was insufficient)
- Handoff content containing information that contradicts the event log

**Confidence:** MEDIUM -- agent-authored summaries are a known quality challenge, but the structured schema approach mitigates the worst cases.

---

## Minor Pitfalls

Mistakes that cause annoyance, minor delays, or cosmetic issues.

---

### MINOR-1: Task ID Generation Produces Non-Human-Readable IDs

**Severity:** MINOR
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The v2.5 spec defines `gen_task_id()` as the default ID generator for tasks. If this produces opaque IDs (e.g., `task_a7x9Kp2mN4qR8sT1`), they are difficult for humans to reference in Slack conversations, dashboard searches, or debugging sessions. Compare to Linear issue IDs (`AES-42`) which are memorable and typeable.

**Prevention:**
1. Use a sequential prefix + random suffix: `T-001-abc` (monotonic for ordering, random for uniqueness).
2. Or use a short nanoid with a prefix: `task_7K2m` (short enough to type, unique enough for the scale).
3. Whatever format is chosen, ensure it is greppable in logs and does not conflict with existing ID patterns (conversation IDs, event IDs).

**Confidence:** MEDIUM -- this is a design choice, not a bug. But poor ID ergonomics compound over time.

---

### MINOR-2: Dashboard Task Panel Requires Schema Extension in lib/schema.ts

**Severity:** MINOR
**Phase to address:** Phase 3 (Task Primitive)

**What goes wrong:**
The v2.4 dashboard uses a local schema (`lib/schema.ts`) that does NOT import from `@aesir/agents` (documented in project memory). Adding task visualization to the dashboard requires adding the tasks table definition to the dashboard's local schema, duplicating the definition. If the tasks schema changes, the dashboard schema must be updated in sync.

**Prevention:**
1. Follow the established pattern: copy the table definition to `packages/dashboard/lib/schema.ts`.
2. Add a comment linking to the source of truth in `packages/agents/src/shared/db/schema.ts`.
3. Consider a shared schema package in a future milestone to eliminate duplication.

**Confidence:** HIGH -- this is a direct consequence of the existing dashboard architecture pattern.

---

### MINOR-3: `delivered_signal_ids` JSONB Array Grows Unbounded on Long-Lived Conversations

**Severity:** MINOR
**Phase to address:** Phase 2 (Conversation Reopening)

**What goes wrong:**
The `conversations.delivered_signal_ids` column is a JSONB array used for signal deduplication. With conversation reopening, the same conversation receives signals across multiple runs. Each signal's dedup key is appended but never removed. For long-lived tasks with many events, this array grows without bound.

**Prevention:**
1. Cap the array at the last N entries (e.g., 100). Signals older than the most recent 100 are unlikely to be re-delivered.
2. Or rotate the array on reopen: clear delivered_signal_ids when a conversation transitions from terminal to queued.
3. Monitor the array size in production and add a maintenance job if it grows beyond expectations.

**Confidence:** HIGH -- the growth is directly observable from the code. The existing append-only pattern has no cleanup.

---

## Phase-Specific Pitfall Warnings

| Phase | Topic | Likely Pitfall | Severity | Mitigation |
|-------|-------|---------------|----------|------------|
| Phase 1 | Prompt Rewrites | Silent behavioral regression (CRITICAL-3) | CRITICAL | Behavioral test suite before rewrite |
| Phase 1 | Prompt Rewrites | Constitutional constraint conflicts (MODERATE-6) | MODERATE | Test constraint pairs, explicit priority |
| Phase 1 | Prompt Rewrites | Stale few-shot examples (MODERATE-4) | MODERATE | Abstract examples, CI validation |
| Phase 2 | Conversation Reopening | Stale world state on reopen (CRITICAL-1) | CRITICAL | Context injection block with current state |
| Phase 2 | Conversation Reopening | History explosion across reopens (MODERATE-5) | MODERATE | Handoff-based context, history reset |
| Phase 2 | Conversation Reopening | Signal dedup array growth (MINOR-3) | MINOR | Cap array, rotate on reopen |
| Phase 3 | Task Primitive | Deadlock between task and conversation locks (CRITICAL-2) | CRITICAL | Advisory locks, canonical lock order |
| Phase 3 | Task Primitive | schema.drizzle.ts legacy table collision (CRITICAL-4) | CRITICAL | Manual migration, verify table state |
| Phase 3 | Task Primitive | Silent correlation recording failure (MAJOR-1) | MAJOR | Optimistic correlation, reconciliation job |
| Phase 3 | Task Primitive | Task metadata JSONB bloat (MAJOR-2) | MAJOR | Zod schema, size limits |
| Phase 3 | Task Primitive | Backward compatibility for null task_id (MAJOR-5) | MAJOR | hasTask helper, null-safe code paths |
| Phase 3 | Task Primitive | Circular delegation loops (MAJOR-6) | MAJOR | Ancestry checks, subtask limits |
| Phase 3 | Task Primitive | Event router latency from task lookup (MAJOR-4) | MAJOR | Cache, integration-side lookup |
| Phase 3 | Task Primitive | Slack thread_ts correlation complexity (MODERATE-1) | MODERATE | Composite key, slow-path fallback |
| Phase 3 | Task Primitive | GitHub PR correlation edge cases (MODERATE-2) | MODERATE | PR number correlation, head_sha tracking |
| Phase 3 | Task Primitive | Linear status change noise (MODERATE-3) | MODERATE | Transition whitelist |
| Phase 4 | Prompt Evolution | Handoff telephone game effect (MAJOR-3) | MAJOR | Structured handoffs, full history access |
| Phase 4 | Prompt Evolution | Agent writes bad handoffs (MODERATE-7) | MODERATE | Structured schema, size limits, validation |

---

## "Looks Done But Isn't" Checklist

Items that appear complete after implementing but have hidden failure modes.

- [ ] **Conversation reopening "works" in tests but fails with stale context.** Single-conversation tests do not exercise the world-state drift problem. Must test with actual external state changes between conversation runs.
- [ ] **Task creation "works" but schema.drizzle.ts migration is wrong.** Testing against a fresh database will not catch the legacy table collision. Must test migration against a database with the old table present.
- [ ] **Event routing "works" but adds 50ms latency.** Functional tests pass but do not measure latency. Must add performance benchmarks for the routing hot path.
- [ ] **Prompt rewrites "work" on common cases but regress on edge cases.** Manual testing of 3-4 scenarios does not cover the behavioral space. Must run the full behavioral test suite.
- [ ] **Integration correlation "works" for create operations but not for the failure case.** Testing the happy path (create artifact, record correlation) does not cover the failure path (create artifact, correlation recording fails). Must test with simulated DB failures during correlation recording.
- [ ] **Handoff context "works" for single delegation but degrades through chains.** Testing one handoff does not reveal the telephone game effect. Must test with 3+ chained handoffs and verify information retention.
- [ ] **Task serialization "works" for sequential events but deadlocks under concurrent load.** Single-event tests pass. Must test with 10+ concurrent events targeting the same task.
- [ ] **Backward compatibility "works" for new conversations but breaks for existing ones.** Testing new conversations with tasks does not cover the null-task-id path. Must test existing conversations survive the migration unchanged.

---

## Recovery Strategies

When a pitfall is hit in production, what to do.

### Stale Context on Reopen (CRITICAL-1)
**Detection:** Agent messages reference non-existent artifacts or outdated states.
**Immediate:** Manually cancel the reopened conversation and start a fresh one with correct context.
**Root cause fix:** Implement context injection block in the reopening flow.

### Deadlock (CRITICAL-2)
**Detection:** `deadlock detected` in PostgreSQL logs, conversation retry exhaustion.
**Immediate:** Kill long-running transactions, increase `max_retries` temporarily.
**Root cause fix:** Switch to advisory locks for task serialization, enforce canonical lock order.

### Prompt Regression (CRITICAL-3)
**Detection:** User reports of changed behavior, phase tag distribution shifts.
**Immediate:** Roll back to previous prompt.md files (they are in git).
**Root cause fix:** Run behavioral test suite, identify specific regression, adjust constraints or examples.

### Migration Collision (CRITICAL-4)
**Detection:** Migration errors referencing unexpected columns.
**Immediate:** Manually fix the migration file before running it.
**Root cause fix:** Verify legacy table state and write manual migration.

### Orphaned Correlations (MAJOR-1)
**Detection:** Webhook events hitting slow path that should match correlations.
**Immediate:** Manually create correlation records for known orphaned artifacts.
**Root cause fix:** Implement reconciliation job, switch to optimistic correlation pattern.

### Task Metadata Bloat (MAJOR-2)
**Detection:** Increasing query latency on tasks table, growing `pg_total_relation_size`.
**Immediate:** Manually truncate oversized metadata fields.
**Root cause fix:** Add Zod validation with size limits, migrate existing oversized records.

---

## Sources

### PostgreSQL and Database
- [PostgreSQL Explicit Locking Documentation](https://www.postgresql.org/docs/current/explicit-locking.html) -- advisory locks, deadlock detection, lock ordering
- [5mins of Postgres: JSONB and TOAST Performance Cliffs](https://pganalyze.com/blog/5mins-postgres-jsonb-toast) -- TOAST compression benchmarks
- [The Hidden Cost of Using JSONB in Postgres](https://medium.com/@thequeryabhishk/the-hidden-cost-of-using-jsonb-in-postgres-bad78a2bf249) -- write amplification, HOT updates
- [When To Avoid JSONB In A PostgreSQL Schema (Heap)](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) -- unbounded JSONB growth patterns
- [Debugging Deadlocks in Postgres (incident.io)](https://incident.io/blog/debugging-deadlocks-in-postgres) -- production deadlock debugging
- [Locks in PostgreSQL -- Concurrency Benefits and Performance Challenges](https://stormatics.tech/blogs/locks-in-postgresql-concurrency) -- lock contention patterns

### Prompt Engineering and LLM Evaluation
- [promptfoo -- Test your prompts, agents, and RAGs](https://github.com/promptfoo/promptfoo) -- regression testing framework for prompts
- [The 5 Best Prompt Evaluation Tools in 2025 (Braintrust)](https://www.braintrust.dev/articles/best-prompt-evaluation-tools-2025) -- evaluation tooling landscape
- [AI Agent Failures: Prompt Design Fixes 4 Common Issues (ctimes)](https://ctimes.tech/en/2026/01/08/ai-agent-failures-prompt-design-fixes-4-common-issues/) -- common agent prompt failures
- [Avoiding Common Pitfalls in LLM Evaluation (HoneyHive)](https://www.honeyhive.ai/post/avoiding-common-pitfalls-in-llm-evaluation) -- evaluation methodology
- [C3AI: Crafting and Evaluating Constitutions for Constitutional AI](https://dl.acm.org/doi/10.1145/3696410.3714705) -- constitutional constraint conflict analysis
- [Constitutional AI: Harmlessness from AI Feedback (Anthropic)](https://arxiv.org/abs/2212.08073) -- foundational constitutional AI research

### Multi-Agent Systems and Handoffs
- [How Agent Handoffs Work in Multi-Agent Systems (Towards Data Science)](https://towardsdatascience.com/how-agent-handoffs-work-in-multi-agent-systems/) -- handoff patterns and context loss
- [Best Practices for Multi-Agent Orchestration and Reliable Handoffs (Skywork AI)](https://skywork.ai/blog/ai-agent-orchestration-best-practices-handoffs/) -- structured handoff approaches
- [Agent-as-Tools vs Handoff in Multi-Agent AI Systems](https://medium.com/@yuxiaojian/agent-as-tools-vs-handoff-in-multi-agent-ai-systems-11f66a0342c4) -- context loss in delegation patterns
- [Your First Multi-Agent Handoff Without Chaos](https://medium.com/@Quaxel/your-first-multi-agent-handoff-without-chaos-a9fe116c7812) -- handoff failure modes

### Helpdesk Systems (Conversation Reopening Reference)
- [About the Ticket Lifecycle and Ticket Statuses (Zendesk)](https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses) -- ticket reopening mechanics
- [Closing and Reopening Side Conversations (Zendesk)](https://support.zendesk.com/hc/en-us/articles/4604333207578-Closing-and-reopening-side-conversations) -- context management on reopen
- [Viewing User Interaction Context in Zendesk](https://internalnote.com/context-in-zendesk/) -- context panel design

### Integration-Specific
- [Sending Messages Using Incoming Webhooks (Slack)](https://api.slack.com/incoming-webhooks) -- thread_ts limitations
- [conversations.replies Method (Slack)](https://api.slack.com/methods/conversations.replies) -- thread reply correlation
- [Webhook Events and Payloads (GitHub Docs)](https://docs.github.com/en/webhooks/webhook-events-and-payloads) -- PR webhook payload structure
- [Troubleshooting Duplicate Builds (CircleCI)](https://support.circleci.com/hc/en-us/articles/115013353748-Troubleshooting-duplicate-builds-triggered-upon-every-commit-push) -- webhook duplication patterns

### Existing Codebase (primary source of truth)
- `packages/agents/src/framework/conversation-executor.ts` -- current signal handling, terminal state rejection
- `packages/agents/src/framework/event-router.ts` -- current synchronous routing, SIGNAL_AGENT_MAP
- `packages/agents/src/framework/worker-loop.ts` -- SKIP LOCKED claiming, wait_for interception
- `packages/agents/src/shared/db/schema.ts` -- current conversation schema (no task_id column)
- `packages/agents/src/shared/db/schema.drizzle.ts` -- legacy tasks table at lines 116-157
- `packages/agents/src/adapters/types.ts` -- IGNORE_EVENT_TYPES including linear.issue.updated
- `packages/agents/definitions/product-agent/prompt.md` -- current procedural state machine prompt
- `packages/agents/definitions/dev-agent/prompt.md` -- current complexity classification prompt
- `packages/agents/definitions/PROMPT_GUIDE.md` -- constitutional + few-shot authoring guidance
