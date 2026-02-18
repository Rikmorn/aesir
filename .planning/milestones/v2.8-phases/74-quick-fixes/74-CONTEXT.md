# Phase 74: Quick Fixes - Context

**Gathered:** 2026-02-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve 4 known v2.7 E2E bugs (QF-01 through QF-04) so the test environment is clean for infrastructure work. All fixes are to existing code paths -- no new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Dev-agent question behavior (QF-02)
- **Default mode: state assumptions and go.** The agent communicates what it's doing and starts working ("I'm implementing X with approach Y"). No blocking, no waiting for permission. User can course-correct.
- **Delegation context = low interactivity.** Tasks from product-agent already have clarified requirements. Only ask if something is genuinely contradictory or technically impossible.
- **Direct trigger = medium interactivity.** Requirements may be sparse. A one-liner like "add logout button" doesn't need clarification. A vague "improve auth security" probably does.
- **Block only on genuine ambiguity** -- things the agent truly can't infer from context or the codebase. "The issue says 'fix auth' but there are 3 auth systems" is blocking. "Should I use the existing test pattern?" is not.
- **Bundle all unknowns into one ask + wait_for.** Every pause is a context switch for the user and idle time for the agent. Gather all questions, present in one message, wait once.
- **ask is for questions, reply is for statements.** QF-02 fix is narrowly scoped: stop using `reply` when the agent needs an answer. Don't overcorrect completion behavior -- `reply` + `complete_task` for completion stays as-is.
- **Channel-aware progress communication:**
  - Linear (ticket context): Update freely -- research findings, approach decisions, sub-agent delegations, PR links, blockers. Low-cost, attached to work artifact, builds audit trail.
  - Slack/reply (direct to requester): Outcomes and blockers only. PR opened, work complete, need input. Don't narrate progress.
  - notify (channel broadcast): Channel-relevant outcomes only. Merged, deployed, failed. Not progress.
- **Principle:** Communication cost should match the channel's attention cost.
- **Implementation:** Pure prompt change in dev-agent's prompt.md. No framework code, no classification logic, no `if (taskSource === 'delegation')`.

### Test agent notify strategy (QF-04)
- **Remove `communication:notify` from all test agent definitions.** Test agents don't have channel context (triggered by synthetic testing.* events). Giving them a tool they lack the context to use matches the v2.7 anti-pattern lesson.
- If a future test scenario needs to verify notification behavior, create a dedicated test agent with a mock channel configured -- don't pollute all 13 test agents.

### Test agent validation (QF-03)
- **Same validation as production agents.** Test agents must pass the same structural checks. No test-specific carveouts. If validation is too strict for sub-agents generally, fix the validator for all agents.
- **Audit all 13 test agents at once.** Small fixed set, likely created from the same template. Fix all, not just the currently failing ones. But keep scope tight: validate definitions and tool lists only. No prompt refactoring, no scenario improvements.
- **Add a structural validation test** that loads all `definitions/test-*/definition.yaml` through the agent registry and asserts no validation errors. Catches drift at `pnpm test` time instead of at integration test runtime.
- **Investigate what exactly fails:** If test agent definitions are missing required fields, add them. If the validator demands fields that shouldn't be required for the spawn context, relax the validator for all agents.

### Error surface style (QF-01)
- **Empty result, not null, not an error.** `get_task_context` returns `{ tasks: [], context: "No active tasks found for this conversation" }`. "No tasks" is information, not an exception.
- **No prompt guidance for the reopened-without-task scenario.** The agent has signal context (why it was reopened) and empty task result. It reasons from there. Don't encode if/then branches for edge cases.
- **Spawn validation errors should be specific** (while fixing QF-03). If spawn fails, include what actually failed ("missing required field 'model'") so the parent agent can report usefully. Same principle as RESIL-05.

### Test coverage
- **Three complementary tests, three failure modes:**
  1. Structural validation: "are all definitions valid?" (fast gate, `pnpm test`)
  2. QF-01 unit test: "does `get_task_context` handle missing tasks gracefully?" (behavior regression)
  3. QF-03 unit test: "does `spawn_agent` accept valid test agent definitions?" (spawn path regression)

### Claude's Discretion
- Exact prompt wording for dev-agent judgment criteria (follows the principles above)
- Which specific fields are causing QF-03 validation failures (investigate during implementation)
- Whether additional test agents beyond the 13 need adjustment

</decisions>

<specifics>
## Specific Ideas

- Dev-agent prompt should give judgment criteria, not a state machine: "Consider whether requirements are clear enough to begin. Tasks delegated from other agents have already been clarified -- execute unless something is contradictory."
- "State assumptions and go" matches how good human developers operate -- communicate what you're doing, flag genuine unknowns, don't ask permission for every decision
- The structural validation test is nearly free: load all test-* definitions through the registry, assert no errors

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 74-quick-fixes*
*Context gathered: 2026-02-16*
