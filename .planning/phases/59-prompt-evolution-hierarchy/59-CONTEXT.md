# Phase 59: Prompt Evolution and Hierarchy Enforcement - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Update orchestrator prompts (product-agent, dev-agent) to leverage the task lifecycle with guidance on task creation, handoff writing, context consumption, and delegation. Add hierarchy guardrails to `create_task` (depth limit, subtask cap, circular delegation prevention). Workers (coder, researcher, tester) are unchanged -- they don't have task tools.

</domain>

<decisions>
## Implementation Decisions

### Task creation instinct

**Product-agent -- artifact commitment heuristic:**
- Create a task when the conversation will produce artifacts or decisions that need follow-up (issue creation, scope decisions). The task represents the engagement with the human, not the individual artifact.
- One task per engagement -- if a user request produces 3 issues, that's one task with 3 correlated artifacts.
- Conversations that stay informational (status checks, quick queries) don't create a task. No explicit "skip task" decision needed -- the agent just never reaches the artifact commitment point.
- Prompt guidance: judgment criterion in `<domain_knowledge>`, not a rule. "Create a task when your conversation will produce artifacts or decisions that need follow-up."

**Dev-agent -- always create immediately:**
- Every Linear issue conversation creates a task. This isn't a judgment call -- the trigger (linear.agent_session.created) IS a work assignment. Filtering already happened at the trigger level.
- Create early so every MCP call from the start gets correlated (branch, commit, PR).
- Prompt guidance: goal in `<domain_knowledge>` with the "why" (correlation, follow-up routing). "Every Linear issue you work on should have a corresponding task. Create the task early -- it links your work artifacts and enables follow-up routing."

**Task titling:** No prompt guidance needed. The model natively uses trigger context for titles. Don't prescribe copying external titles verbatim -- the agent's reframing is a feature. Good titles demonstrated implicitly through few-shot examples.

**Objective field:** Encourage usage. The objective captures intent beyond the title -- critical for follow-up conversations via `<task_context>`. Light note in `<domain_knowledge>`: "Use the objective to capture the intent behind the work -- the problem being solved or the outcome expected. This context persists across conversations."

### Handoff quality

**Dev-agent handoff priorities (completion):**
1. Artifacts -- PR URL, branch name, key files changed (the "where to look" anchor)
2. Key decisions -- why approach A over B, tradeoffs made, constraints discovered (highest-value content for maintaining consistency)
3. Known limitations -- things intentionally skipped, fragile areas, test gaps (distinguishes "deliberate scoping" from "oversight")

**Product-agent handoff priorities (completion):**
1. What was agreed with the human -- decisions made during the conversation (prevents re-asking or contradicting prior agreements)
2. The gap between ask and scope -- the delta between what the user originally wanted and what was scoped into an issue (unique to product-agent; distinguishes "deferred" from "forgotten")
3. Artifacts created -- Linear issue IDs, Slack thread references
4. Open threads -- "let's revisit later" items, unresolved requirements

**What NOT to include in handoffs:** Step-by-step logs of what the agent did, file diffs (PR has those), tool call sequences, conversation transcripts.

**Teaching handoff quality:** Through few-shot examples only. No good/bad example pairs -- bad examples in prompts are an anti-pattern (LLMs anchor on patterns, including negative ones). A single strong good example teaches by demonstration. **Spec correction: update "good/bad handoff examples" to "good handoff examples" to prevent planner from encoding bad examples.**

### Few-shot example scenarios

**One new example per agent, focused on consuming handoffs (not producing them):**

Teach consumption because that's where the judgment lives. Writing a handoff is mechanical (fill structured schema fields). Using a handoff to make better decisions teaches what makes handoffs valuable -- the agent learns what to write by seeing what's useful to consume.

**Dev-agent example -- PR review follow-up:**
- `<task_context>` shows prior handoff: PR created, approach chosen (e.g., JWT over sessions), known limitation (e.g., no refresh token rotation)
- Reviewer asks about a decision already captured in handoff -- agent reasons from key_decisions, explains tradeoff instead of revisiting
- Reviewer requests change that was a known limitation -- agent recognizes it wasn't an oversight, implements it
- Agent writes updated completion handoff

**Product-agent example -- user follow-up with scope change:**
- `<task_context>` shows prior handoff: user wanted broader scope, v1 scoped narrower, specific items deferred
- User returns asking about deferred item
- Agent reads ask-vs-scope gap, recognizes item was intentionally deferred, discusses rather than starting from scratch
- Creates new issue, writes updated handoff

Both examples use abstract reasoning (per PROMPT_GUIDE.md) rather than literal tool call syntax.

### Delegation patterns

**spawn_agent vs create_task(parentId):**
- In v2.5, dev-agent uses spawn_agent for sub-agent work (coder, researcher, tester). These are synchronous operations within a single conversation -- no independent lifecycle needed.
- create_task(parentId) is for asynchronous work that survives across conversations, assigned to different orchestrators. No v2.5 use case for dev-agent.
- Prompt should NOT teach subtask delegation. Examples show create_task for the agent's own task (no parentId), spawn_agent for sub-agent work.

**list_tasks / get_task_context usage:**
- Trust the injected `<task_context>` block (latest handoff, fetched fresh at start).
- Only call get_task_context reactively when the injection says "Call get_task_context for full history" (truncation or multiple handoffs).
- No prescriptive "always call list_tasks on startup" guidance. The tool exists, the agent reasons about when context suggests a follow-up. Adding startup rituals is procedural.

**product-agent list_tasks for dedup:** No guidance needed. Correlation handles same-thread follow-ups. New-thread-about-old-topic is a known correlation gap -- if frequent, fix via better correlation, not a prompt workaround.

### Hierarchy guardrails

**Limits:** Max depth 5, max subtasks per parent 10. Constants in create_task tool code.

**Error messages are the recovery mechanism:** No prompt guidance on limit recovery. Error messages already include current state and valid actions (e.g., "Cannot create subtask: parent task_abc123 already has 10 subtasks (maximum)"). The agent reasons from informative errors. Adding prompt guidance for rare-path recovery is speculative and poor token ROI.

**Circular delegation -- refined rule:**
- Consecutive same-assignee in parent chain = self-decomposition. **Allow.** (A → A → A is task breakdown, bounded by depth limit.)
- Non-consecutive same-assignee = circular delegation. **Block.** (A → B → A is hot potato.)
- Implementation: walk parent chain tracking whether a different assignee has been seen. If yes and new task's assignee reappears, reject.
- This refines the spec's original rule which would have incorrectly blocked dev-agent from creating subtasks assigned to itself.

### Claude's Discretion

- Exact prompt wording and section placement within the established structure (identity/constraints/domain_knowledge/examples/tools/context)
- How much context to include in the few-shot examples vs keeping them concise
- Whether to add a second example per agent showing the first-conversation arc (task creation + initial handoff) -- lower priority since it's more mechanical
- Graceful degradation note wording in `<domain_knowledge>`

</decisions>

<specifics>
## Specific Ideas

- Examples should show abstract reasoning patterns, not literal tool call syntax (decoupled from tool schemas per PROMPT_GUIDE.md)
- Handoff consumption examples are higher priority than handoff production examples -- "what's useful to consume" implicitly teaches "what to write"
- Spec says task lifecycle additions go in: `<domain_knowledge>` for concepts + handoff guidance, `<examples>` for 1-2 new few-shots, `<tools>` for task tool descriptions. No changes to `<identity>` or `<constraints>`.
- Graceful degradation is a note in `<domain_knowledge>`, not a constraint: "If no `<task_context>` is present, your core capabilities work the same way"
- Existing Phase 56 examples retained unchanged; new examples added alongside them

</specifics>

<deferred>
## Deferred Ideas

- Cross-agent delegation via create_task(parentId) -- no v2.5 use case, future milestone
- Proactive list_tasks for topic dedup -- known correlation gap; fix via better correlation infrastructure, not prompt workarounds
- Bad handoff examples in prompts -- anti-pattern; only add targeted constraints reactively if specific failure patterns emerge in practice
- User-level task affinity for new-thread-about-old-topic correlation

</deferred>

---

*Phase: 59-prompt-evolution-hierarchy*
*Context gathered: 2026-02-07*
