# Phase 59: Prompt Evolution and Hierarchy Enforcement - Research

**Researched:** 2026-02-07
**Domain:** Agent prompt engineering + task tool hierarchy guardrails
**Confidence:** HIGH

## Summary

Phase 59 has two distinct workstreams: (1) updating product-agent and dev-agent prompts to incorporate task lifecycle awareness -- creating tasks, writing quality handoffs, consuming `<task_context>`, and graceful degradation; and (2) adding hierarchy guardrails to the `create_task` tool -- max depth 5, max subtasks 10, and circular delegation prevention.

The prompt work builds on the Phase 56 prompt rewrites which established the current prompt structure (identity -> constraints -> domain_knowledge -> examples -> tools -> context) and the Phase 58.2 task tools which are already registered in both agent definitions. The prompts currently have zero task lifecycle guidance -- the tools exist in the YAML definitions but the agents have no domain knowledge or examples teaching them when or how to use task tools.

The hierarchy guardrail work is a focused code change to the existing `create_task` tool factory, adding three validation checks before the `taskService.create()` call. The circular delegation detection uses a refined rule: consecutive same-assignee in the parent chain (A -> A) is allowed (self-decomposition), but non-consecutive same-assignee (A -> B -> A) is blocked (circular delegation).

**Primary recommendation:** Split into two plans -- one for prompt evolution (both agents), one for hierarchy guardrails. The prompt plan should be a single plan modifying both prompts since the patterns are shared. The guardrail plan is a focused code change to one file with tests.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Task creation instinct:**
- Product-agent: artifact commitment heuristic. Create a task when the conversation will produce artifacts or decisions that need follow-up. One task per engagement. Informational conversations don't create tasks. Prompt guidance as judgment criterion in `<domain_knowledge>`, not a rule.
- Dev-agent: always create immediately. Every Linear issue conversation creates a task. Create early for MCP correlation. Prompt guidance as goal in `<domain_knowledge>` with the "why" (correlation, follow-up routing).
- Task titling: No prompt guidance needed. Model natively uses trigger context for titles.
- Objective field: Encourage usage. Light note in `<domain_knowledge>`.

**Handoff quality:**
- Dev-agent handoff priorities (completion): (1) Artifacts -- PR URL, branch, key files; (2) Key decisions -- approach chosen, tradeoffs; (3) Known limitations -- intentional omissions, fragile areas.
- Product-agent handoff priorities (completion): (1) What was agreed with the human; (2) Gap between ask and scope; (3) Artifacts created; (4) Open threads.
- What NOT to include: step-by-step logs, file diffs, tool call sequences, conversation transcripts.
- Teaching handoff quality: Good examples only. No bad examples. Single strong good example teaches by demonstration.

**Few-shot example scenarios:**
- One new example per agent, focused on consuming handoffs (not producing them).
- Dev-agent: PR review follow-up scenario. `<task_context>` shows prior handoff, reviewer asks about decision already captured, agent reasons from key_decisions.
- Product-agent: user follow-up with scope change. `<task_context>` shows prior handoff with ask-vs-scope gap, user returns asking about deferred item, agent reads gap and recognizes intentional deferral.
- Both examples use abstract reasoning, not literal tool call syntax.

**Delegation patterns:**
- spawn_agent for synchronous sub-agent work (coder, researcher, tester). create_task(parentId) for asynchronous cross-conversation work.
- No v2.5 use case for dev-agent subtask delegation via create_task(parentId). Prompt should NOT teach subtask delegation.
- Trust injected `<task_context>` block. Only call get_task_context reactively when injection says "Call get_task_context for full history."
- No prescriptive "always call list_tasks on startup" guidance.

**Hierarchy guardrails:**
- Max depth 5, max subtasks per parent 10. Constants in create_task tool code.
- Error messages are the recovery mechanism. No prompt guidance for limit recovery.
- Circular delegation refined rule: consecutive same-assignee = self-decomposition (allow). Non-consecutive same-assignee = circular delegation (block). Implementation: walk parent chain tracking whether a different assignee has been seen.

### Claude's Discretion

- Exact prompt wording and section placement within the established structure (identity/constraints/domain_knowledge/examples/tools/context)
- How much context to include in the few-shot examples vs keeping them concise
- Whether to add a second example per agent showing the first-conversation arc (task creation + initial handoff) -- lower priority since it's more mechanical
- Graceful degradation note wording in `<domain_knowledge>`

### Deferred Ideas (OUT OF SCOPE)

- Cross-agent delegation via create_task(parentId) -- no v2.5 use case, future milestone
- Proactive list_tasks for topic dedup -- known correlation gap; fix via better correlation infrastructure, not prompt workarounds
- Bad handoff examples in prompts -- anti-pattern; only add targeted constraints reactively if specific failure patterns emerge in practice
- User-level task affinity for new-thread-about-old-topic correlation
</user_constraints>

## Standard Stack

This phase doesn't introduce new libraries. It modifies existing files:

### Core Files Modified

| File | Purpose | Change Type |
|------|---------|-------------|
| `packages/agents/definitions/dev-agent/prompt.md` | Dev-agent system prompt | Add task lifecycle to domain_knowledge, new example, update tools section |
| `packages/agents/definitions/product-agent/prompt.md` | Product-agent system prompt | Add task lifecycle to domain_knowledge, new example, update tools section |
| `packages/agents/src/shared/tools/task/create-task.ts` | create_task tool factory | Add hierarchy guardrails (depth, subtask cap, circular delegation) |

### Supporting Files

| File | Purpose | Change Type |
|------|---------|-------------|
| `packages/agents/src/shared/tools/task/types.ts` | Task tool shared types/constants | Add MAX_DEPTH, MAX_SUBTASKS constants |
| `packages/agents/src/shared/services/task-service.ts` | TaskService | Already has all needed methods (get, listByParent). No changes needed. |

### Test Files

| File | Purpose | Change Type |
|------|---------|-------------|
| `packages/agents/src/shared/tools/task/create-task.test.ts` | create_task unit tests | Add tests for hierarchy guardrails |

## Architecture Patterns

### Pattern 1: Prompt Section Placement

**What:** Task lifecycle content goes into specific prompt sections per the established Phase 56 structure and locked decisions.

**Sections to modify (both agents):**

```
<domain_knowledge>
  EXISTING content (sub-agent delegation for dev-agent, issue quality for product-agent)
  + NEW: Task lifecycle concepts
    - When to create tasks (different per agent)
    - Objective field purpose
    - Handoff content priorities (different per agent)
    - Graceful degradation note
</domain_knowledge>

<examples>
  EXISTING examples (Phase 56, retained unchanged)
  + NEW: One handoff-consumption example per agent
</examples>

<tools>
  EXISTING tool categories
  + NEW: Task tools category with purpose descriptions
</tools>
```

**What NOT to modify:**
- `<identity>` -- rewritten in Phase 56, no changes needed
- `<constraints>` -- task creation is judgment, not a safety boundary
- `<context>` -- framework-injected, not manually edited

### Pattern 2: Few-Shot Example Structure (Abstract Reasoning)

**What:** Per PROMPT_GUIDE.md, examples use abstract reasoning patterns, not literal tool call syntax. This is critical for decoupling from tool schemas.

**Structure:**
```markdown
**Example N: [Descriptive title]**

[Setup -- what the agent sees, including task_context if relevant]

Reasoning: [Agent's internal reasoning about the situation, referencing
information from task_context to inform decisions. Shows HOW the agent
uses handoff information, not just THAT it uses it.]

Action: [What the agent does, described conceptually, not as tool call syntax]
```

**Key principle from PROMPT_GUIDE Rule 3:** Include reasoning in every example. Without it, examples are just a lookup table. The reasoning teaches the judgment pattern.

### Pattern 3: Hierarchy Guardrails as Pre-Validation

**What:** Guardrails added as validation checks in the create_task tool factory BEFORE the `taskService.create()` call.

**Flow:**
```
create_task execute():
  1. Parse and validate input (existing)
  2. IF parentId provided:
     a. Fetch parent task via taskService.get()
     b. Walk parent chain (up to 5 iterations):
        - Count depth
        - Track assignees for circular delegation detection
     c. Count existing children via taskService.listByParent()
     d. Check depth limit (MAX_DEPTH = 5)
     e. Check subtask cap (MAX_SUBTASKS = 10)
     f. Check circular delegation
  3. Call taskService.create() (existing)
  4. Handle linking (existing)
```

**Error format:** Same `{ content, isError: true }` pattern used by status transition errors. Messages include current state and guidance.

### Pattern 4: Circular Delegation Detection Algorithm

**What:** Walk the parent chain, tracking whether a different assignee has appeared. If yes and the new task's assignee matches a previous one, reject.

```typescript
// Pseudocode for the circular delegation check
async function detectCircularDelegation(
  taskService: TaskService,
  parentId: string,
  newAssigneeType: string,
  newAssigneeId: string,
): Promise<{ isCircular: boolean; chainDescription?: string }> {
  let currentId: string | null = parentId;
  let depth = 0;
  let seenDifferentAssignee = false;
  const chain: Array<{ id: string; assigneeType: string; assigneeId: string }> = [];

  while (currentId && depth < MAX_DEPTH) {
    const task = await taskService.get(currentId);
    if (!task) break; // DB error or orphaned parent -- fail safe

    chain.push({
      id: task.id,
      assigneeType: task.assignee_type,
      assigneeId: task.assignee_id,
    });

    // Check if this assignee differs from the new task's assignee
    if (task.assignee_type !== newAssigneeType || task.assignee_id !== newAssigneeId) {
      seenDifferentAssignee = true;
    }

    // If we've seen a different assignee and now see the new assignee again
    // in the chain, it's circular delegation (A -> B -> A)
    if (seenDifferentAssignee &&
        task.assignee_type === newAssigneeType &&
        task.assignee_id === newAssigneeId) {
      // Actually, the check is on the NEW task's assignee appearing
      // in the chain AFTER a different assignee. Let me re-think...
    }

    currentId = task.parent_id ?? null;
    depth++;
  }

  // After walking the chain, check: does the new assignee appear
  // in the ancestor chain with a different assignee between them?
  // Walk from parent upward. If we see a different assignee followed
  // by the new assignee, that's circular.

  for (let i = 0; i < chain.length; i++) {
    const ancestor = chain[i];
    if (!ancestor) continue;
    if (ancestor.assigneeType === newAssigneeType &&
        ancestor.assigneeId === newAssigneeId) {
      // Same assignee as new task in the chain
      if (seenDifferentAssignee) {
        // A different assignee exists between new task and this ancestor
        return { isCircular: true, chainDescription: formatChain(chain, newAssigneeType, newAssigneeId) };
      }
      // else: consecutive same-assignee (self-decomposition), allowed
    } else {
      seenDifferentAssignee = true;
    }
  }

  return { isCircular: false };
}
```

**Corrected algorithm (clearer):**

Walk parent chain from immediate parent upward. Track whether a "different" assignee has been encountered. The "different" means different from the new task's assignee. Reset logic:

1. Start with `seenDifferentAssignee = false`
2. For each ancestor (parent, grandparent, ...):
   - If ancestor has a DIFFERENT assignee from the new task -> set `seenDifferentAssignee = true`
   - If ancestor has the SAME assignee as the new task AND `seenDifferentAssignee` is true -> CIRCULAR
   - If ancestor has the SAME assignee as the new task AND `seenDifferentAssignee` is false -> SELF-DECOMPOSITION (fine, continue)

This correctly handles:
- `devA -> devA -> devA` -> all same, seenDifferent never true -> ALLOWED (self-decomposition)
- `devA -> prodA -> devA` -> at prodA, seenDifferent=true, then at devA, same + seenDifferent=true -> BLOCKED
- `devA -> devA -> prodA -> devA` -> at devA (parent), same, fine. At prodA, seenDifferent=true. At devA (root), same + seenDifferent -> BLOCKED

### Anti-Patterns to Avoid

- **Prescriptive tool sequences in prompts:** Don't write "1. call create_task, 2. call complete_task." Let the agent reason about when to use task tools.
- **State machines for task lifecycle:** Don't encode "IF first conversation THEN create_task, IF follow-up THEN get_task_context." The domain knowledge explains concepts; the agent decides.
- **Bad examples in prompts:** Per locked decision, only good examples. No "here's what a bad handoff looks like" -- LLMs anchor on patterns.
- **Over-prescribing handoff format:** The structured schema (summary, key_decisions, artifacts, etc.) is enforced by the tool. The prompt teaches WHAT to include via priorities and examples, not HOW to format it.
- **Adding constraints for task creation:** Task creation is judgment (for product-agent) or a goal (for dev-agent), not a safety boundary. It belongs in `<domain_knowledge>`, not `<constraints>`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Depth counting | Walk chain in tool code each time | `taskService.get()` in a loop bounded by MAX_DEPTH | Simple, bounded (max 5 iterations), no stored column to maintain |
| Subtask counting | Custom SQL query | `taskService.listByParent(parentId)` then `.length` | Method already exists, returns the data we need |
| Handoff schema enforcement | Manual validation in prompt | `complete_task` and `handoff_task` Zod schemas | Tool-layer validation is reliable; prompt guidance is aspirational |
| Task context injection | Prompt instructions to "call get_task_context first" | Worker loop `buildTaskContextBlock()` | Already implemented in Phase 58.2, auto-injected |

## Common Pitfalls

### Pitfall 1: Prompt Bloat from Task Lifecycle Content

**What goes wrong:** Adding too much task lifecycle content inflates the prompt, consuming tokens that should go to agent reasoning. Product-agent especially has a tight 50K token budget.
**Why it happens:** Temptation to explain every aspect of the task lifecycle comprehensively.
**How to avoid:** Follow the "light note" approach from the locked decisions. The domain_knowledge section should be 100-200 words of task lifecycle content per agent. The example teaches more than paragraphs of explanation.
**Warning signs:** Task lifecycle section in domain_knowledge exceeding 300 words.

### Pitfall 2: Examples That Teach Tool Syntax Instead of Reasoning

**What goes wrong:** The few-shot example shows literal tool call parameters (e.g., `create_task({ title: "...", assigneeType: "agent" })`), coupling the example to the tool schema.
**Why it happens:** Natural impulse to be concrete. Tool calls feel "specific."
**How to avoid:** Follow PROMPT_GUIDE.md -- examples show abstract reasoning patterns. "Create a task to track this work" not `create_task(...)`. The agent knows the tool interface from the tool definitions.
**Warning signs:** Any JSON or function call syntax in the example's Action section.

### Pitfall 3: N+1 Queries in Hierarchy Validation

**What goes wrong:** Walking the parent chain issues one DB query per ancestor (up to 5). Plus one query for subtask count. Plus the actual create. That's up to 7 queries for a single create_task call with a parent.
**Why it happens:** The chain walk is inherently sequential (each ancestor's parent_id comes from the previous query).
**How to avoid:** Accept the N+1 for now -- max 5 iterations is bounded and acceptable. A recursive CTE could fetch the entire chain in one query, but adds complexity. The simple approach is correct and the depth limit bounds the cost.
**Warning signs:** Only if create_task latency becomes a concern, which is unlikely at current scale.

### Pitfall 4: Failing Open vs Failing Closed on DB Errors

**What goes wrong:** During parent chain walk, a DB error or missing parent could silently allow an invalid task to be created.
**Why it happens:** Error handling defaults to "skip and continue."
**How to avoid:** Per the locked decision: "DB errors during the walk reject the creation (fail safe -- don't allow a task you can't validate)." If `taskService.get()` throws during the walk, return an error to the agent.
**Warning signs:** Any `catch` block in the chain walk that silently continues.

### Pitfall 5: Existing Examples Disrupted by New Content

**What goes wrong:** Adding task lifecycle content accidentally modifies the meaning or context of the existing Phase 56 examples.
**Why it happens:** The new domain_knowledge content or example placement changes the semantic context that surrounds existing examples.
**How to avoid:** Per locked decision: "Existing Phase 56 examples retained unchanged." Add new examples AFTER existing ones with a clear separator. Don't modify existing example text.
**Warning signs:** Any diff that touches existing example content in prompt.md.

### Pitfall 6: Inconsistent Prompt Structure Between Agents

**What goes wrong:** Dev-agent and product-agent get differently structured task lifecycle content, making maintenance harder.
**Why it happens:** Each agent has different task creation triggers and handoff priorities, so content diverges.
**How to avoid:** Use the same structural pattern for both prompts (e.g., same subsection headings in domain_knowledge, same example format). Only the content differs (the what), not the structure (the how).
**Warning signs:** One prompt has a "Task Lifecycle" subsection but the other doesn't.

## Code Examples

### Hierarchy Constants (types.ts addition)

```typescript
// Source: CONTEXT.md locked decisions
/** Maximum depth of parent_id chains (system-wide safety limit) */
export const MAX_TASK_DEPTH = 5;

/** Maximum subtasks per parent task (system-wide safety limit) */
export const MAX_SUBTASKS_PER_PARENT = 10;
```

### Depth Check in create_task

```typescript
// Source: Existing create-task.ts pattern + CONTEXT.md decisions
async function checkDepth(
  taskService: TaskService,
  parentId: string,
): Promise<{ depth: number; error?: string }> {
  let currentId: string | null = parentId;
  let depth = 1; // New task would be at depth 1 (parent is depth 0 root)

  while (currentId) {
    if (depth >= MAX_TASK_DEPTH) {
      return {
        depth,
        error: `Cannot create task: would exceed maximum depth of ${MAX_TASK_DEPTH} levels.`,
      };
    }
    const task = await taskService.get(currentId);
    if (!task) {
      return {
        depth,
        error: `Cannot create task: parent chain broken at ${currentId}.`,
      };
    }
    currentId = task.parent_id ?? null;
    depth++;
  }

  return { depth };
}
```

### Subtask Cap Check

```typescript
// Source: Existing listByParent pattern + CONTEXT.md decisions
async function checkSubtaskCap(
  taskService: TaskService,
  parentId: string,
): Promise<{ count: number; error?: string }> {
  const children = await taskService.listByParent(parentId);
  if (children.length >= MAX_SUBTASKS_PER_PARENT) {
    return {
      count: children.length,
      error: `Cannot create subtask: parent ${parentId} already has ${children.length} subtasks (maximum ${MAX_SUBTASKS_PER_PARENT}).`,
    };
  }
  return { count: children.length };
}
```

### Circular Delegation Check

```typescript
// Source: CONTEXT.md refined circular delegation rule
async function checkCircularDelegation(
  taskService: TaskService,
  parentId: string,
  newAssigneeType: string,
  newAssigneeId: string,
): Promise<{ isCircular: boolean; error?: string }> {
  let currentId: string | null = parentId;
  let seenDifferentAssignee = false;

  while (currentId) {
    const task = await taskService.get(currentId);
    if (!task) {
      return {
        isCircular: false,
        error: `Cannot create task: parent chain broken at ${currentId}.`,
      };
    }

    const sameAssignee =
      task.assignee_type === newAssigneeType &&
      task.assignee_id === newAssigneeId;

    if (sameAssignee && seenDifferentAssignee) {
      return {
        isCircular: true,
        error:
          `Cannot create task: circular delegation -- ` +
          `${newAssigneeId} delegates to ${task.assignee_id} which delegates back to ${newAssigneeId}.`,
      };
    }

    if (!sameAssignee) {
      seenDifferentAssignee = true;
    }

    currentId = task.parent_id ?? null;
  }

  return { isCircular: false };
}
```

### Dev-Agent domain_knowledge Addition (Approximate)

```markdown
## Task Lifecycle

Every Linear issue you work on should have a corresponding task. Create the task early -- it links your work artifacts (branches, commits, PRs) and enables follow-up routing when events arrive for those artifacts later.

Use the objective to capture the intent behind the work -- the problem being solved or the outcome expected. This context persists across conversations.

When completing a task, focus your handoff on:
- Artifacts produced -- PR URL, branch name, key files changed
- Key decisions -- why you chose this approach, tradeoffs made
- Known limitations -- things intentionally skipped, fragile areas

Leave out step-by-step logs, file diffs, or tool call sequences -- the PR has those.

If no <task_context> is present, your core capabilities work the same way. Task tools enhance your ability to maintain continuity but are not required for any operation.
```

### Product-Agent domain_knowledge Addition (Approximate)

```markdown
## Task Lifecycle

Create a task when your conversation will produce artifacts or decisions that need follow-up. The task represents the engagement with the human, not the individual artifact -- if a user request produces three issues, that is one task with three correlated artifacts. Pure informational conversations (status checks, quick queries) do not need tasks.

Use the objective to capture the intent behind the work. This context persists across conversations.

When completing a task, focus your handoff on:
- What was agreed with the human -- decisions made during the conversation
- The gap between ask and scope -- what the user originally wanted versus what was scoped
- Artifacts created -- Linear issue IDs, Slack thread references
- Open threads -- deferred items, "let's revisit later" items

Leave out conversation back-and-forth, search steps, or message wording.

If no <task_context> is present, your core capabilities work the same way.
```

### Dev-Agent Example (Handoff Consumption)

```markdown
**Example 6: Following up on reviewed work**

The conversation starts with a PR review signal. <task_context> shows the prior
handoff: a PR was created for JWT authentication, the approach chose JWT over
sessions because of the stateless API architecture, and refresh token rotation
was listed as a known limitation intentionally deferred.

Reasoning: The reviewer is asking about two things. First, why sessions were not
used -- that is captured in the handoff's key decisions. I can explain the
tradeoff directly instead of re-investigating. Second, they want refresh token
rotation added -- the handoff lists this as a known limitation, not an oversight.
Since it was a deliberate scope decision, I should implement it as a follow-up
rather than defending the omission. I will spawn a researcher to understand the
current token handling, then a coder to add rotation.

Action: Respond to the reviewer explaining the JWT-over-sessions decision from
the handoff context. Acknowledge the refresh token request as a valid addition
to the original scope. Research the current implementation, plan the addition,
and update the PR. Write an updated completion handoff noting the added rotation
and any new decisions made.
```

### Product-Agent Example (Handoff Consumption)

```markdown
**Example 6: User returns about deferred scope**

The conversation starts with a user message in a new thread. <task_context> shows
the prior handoff: the user originally wanted both email and SMS notifications for
deploy failures. V1 was scoped to email only, with SMS explicitly listed in the
ask-vs-scope gap as "deferred to avoid blocking on SMS provider selection."

Reasoning: The user is asking about SMS notifications. The handoff shows this was
intentionally deferred, not forgotten -- there was a specific reason (SMS provider
selection). I should acknowledge the prior conversation, reference the deferral
reason, and discuss whether the provider decision has been made rather than
starting from scratch. If the user is ready to proceed, I can create a new issue
scoped to SMS notifications, linking it to the original email notification work.

Action: Message the user acknowledging the prior conversation and the deferral.
Ask whether the SMS provider has been selected, since that was the blocking
reason. If ready, draft an issue for SMS notifications, reference the original
email notification issue for context. Write a handoff noting the expanded scope
and provider decision.
```

## State of the Art

| Aspect | Current State | After Phase 59 |
|--------|---------------|----------------|
| Task tools in agent YAML | Listed in tools array | Same (no change) |
| Task tools in prompts | Zero mention | domain_knowledge + example + tools section |
| create_task hierarchy checks | None | Depth (5), subtask cap (10), circular delegation |
| Prompt structure | identity/constraints/domain_knowledge/examples/tools/context | Same structure, expanded content |
| Phase 56 examples | 5 per agent | 5 original + 1 new per agent |

## Open Questions

1. **Depth counting edge case: should the root task count as depth 1 or depth 0?**
   - What we know: The spec says "max 5 levels of parent_id depth." A task with no parent is at the root.
   - What's unclear: Does "5 levels" mean 5 levels of nesting (root -> 4 children deep) or 5 ancestors in the parent chain?
   - Recommendation: Interpret as "max 5 levels of nesting" meaning a root task can have children at depths 1-4 (4 levels of subtasks). The parent chain walk stops at 5 iterations regardless. This is consistent with the "bounded at 5 iterations" language in the spec.

2. **Should the tools section list all six task tools individually?**
   - What we know: Current tools sections group tools by category with purpose descriptions. Dev-agent has 6 categories. Product-agent has 5 categories.
   - What's unclear: Whether to list each task tool or describe them as a category.
   - Recommendation: Describe as a category with a brief note on the key tools (create_task, complete_task, get_task_context). Listing all six would add token overhead without proportional value -- the agent sees the full tool schemas in its tool definitions. Focus the tools section on purpose and judgment, not on repeating the schema.

3. **Should the new example be numbered as Example 6 (continuing from Phase 56's 5 examples)?**
   - What we know: Phase 56 established 5 examples per agent. CONTEXT says "existing Phase 56 examples retained unchanged."
   - What's unclear: Whether to number sequentially or use a separate numbering scheme.
   - Recommendation: Number sequentially (Example 6) to maintain the established pattern. Adding a separator comment ("--- Task lifecycle examples ---") between old and new helps readability but is optional.

## Sources

### Primary (HIGH confidence)
- `packages/agents/definitions/dev-agent/prompt.md` -- current dev-agent prompt (Phase 56 rewrite)
- `packages/agents/definitions/product-agent/prompt.md` -- current product-agent prompt (Phase 56 rewrite)
- `packages/agents/definitions/PROMPT_GUIDE.md` -- prompt authoring rules (7 rules + anti-patterns)
- `packages/agents/src/shared/tools/task/create-task.ts` -- current create_task implementation
- `packages/agents/src/shared/tools/task/types.ts` -- status transitions, type definitions
- `packages/agents/src/shared/services/task-service.ts` -- TaskService interface (get, listByParent, etc.)
- `packages/agents/src/framework/worker-loop.ts` -- buildTaskContextBlock(), task context injection
- `packages/agents/src/framework/tool-factories.ts` -- task tool registration pattern
- `.planning/specs/2.5-agentic-conversations.md` -- spec Phase 4 (Prompt Evolution) + hierarchy guardrails
- `.planning/phases/59-prompt-evolution-hierarchy/59-CONTEXT.md` -- locked decisions
- `.planning/phases/56-goal-oriented-prompt-rewrites/traceability-dev-agent.md` -- Phase 56 traceability
- `.planning/phases/56-goal-oriented-prompt-rewrites/traceability-product-agent.md` -- Phase 56 traceability

### Secondary (MEDIUM confidence)
- `packages/agents/definitions/dev-agent/definition.yaml` -- tool list includes all 6 task tools
- `packages/agents/definitions/product-agent/definition.yaml` -- tool list includes all 6 task tools

## Metadata

**Confidence breakdown:**
- Prompt evolution: HIGH -- direct access to current prompts, PROMPT_GUIDE, traceability matrices, and locked decisions. All patterns are clear.
- Hierarchy guardrails: HIGH -- direct access to current create_task code, TaskService API, and the refined circular delegation algorithm from CONTEXT.md.
- Few-shot examples: HIGH -- locked decisions provide specific scenarios. PROMPT_GUIDE provides format rules.

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (stable -- prompt patterns and tool code are internal, not dependent on external library versions)
