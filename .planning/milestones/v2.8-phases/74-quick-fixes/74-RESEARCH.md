# Phase 74: Quick Fixes - Research

**Researched:** 2026-02-16
**Domain:** Bug fixes in existing agent framework code (task tools, spawn validation, communication tools, agent prompts)
**Confidence:** HIGH

## Summary

Phase 74 resolves 4 known v2.7 E2E bugs. All fixes are to existing code paths -- no new capabilities, no new packages, no new dependencies. The changes span two categories: code fixes (QF-01, QF-03, QF-04) and a prompt change (QF-02).

The root causes are well-understood from reading the source code directly. QF-01 is a tool returning `isError: true` when it should return informational empty results. QF-02 is a dev-agent prompt issue where the agent uses `reply` (fire-and-forget) instead of `ask` + `wait_for` (blocking) when it needs user input. QF-03 is a hardcoded `z.enum(["researcher", "coder", "tester"])` in the spawn_agent tool that rejects any other role name. QF-04 is test agents having `communication:notify` in their tool list despite lacking the channel context to use it.

**Primary recommendation:** Fix each bug at its root cause. Write unit tests that prevent regression. Add a structural validation test that loads all test agent definitions through the registry at `pnpm test` time.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Dev-agent question behavior (QF-02)
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

#### Test agent notify strategy (QF-04)
- **Remove `communication:notify` from all test agent definitions.** Test agents don't have channel context (triggered by synthetic testing.* events). Giving them a tool they lack the context to use matches the v2.7 anti-pattern lesson.
- If a future test scenario needs to verify notification behavior, create a dedicated test agent with a mock channel configured -- don't pollute all 13 test agents.

#### Test agent validation (QF-03)
- **Same validation as production agents.** Test agents must pass the same structural checks. No test-specific carveouts. If validation is too strict for sub-agents generally, fix the validator for all agents.
- **Audit all 13 test agents at once.** Small fixed set, likely created from the same template. Fix all, not just the currently failing ones. But keep scope tight: validate definitions and tool lists only. No prompt refactoring, no scenario improvements.
- **Add a structural validation test** that loads all `definitions/test-*/definition.yaml` through the agent registry and asserts no validation errors. Catches drift at `pnpm test` time instead of at integration test runtime.
- **Investigate what exactly fails:** If test agent definitions are missing required fields, add them. If the validator demands fields that shouldn't be required for the spawn context, relax the validator for all agents.

#### Error surface style (QF-01)
- **Empty result, not null, not an error.** `get_task_context` returns `{ tasks: [], context: "No active tasks found for this conversation" }`. "No tasks" is information, not an exception.
- **No prompt guidance for the reopened-without-task scenario.** The agent has signal context (why it was reopened) and empty task result. It reasons from there. Don't encode if/then branches for edge cases.
- **Spawn validation errors should be specific** (while fixing QF-03). If spawn fails, include what actually failed ("missing required field 'model'") so the parent agent can report usefully. Same principle as RESIL-05.

#### Test coverage
- **Three complementary tests, three failure modes:**
  1. Structural validation: "are all definitions valid?" (fast gate, `pnpm test`)
  2. QF-01 unit test: "does `get_task_context` handle missing tasks gracefully?" (behavior regression)
  3. QF-03 unit test: "does `spawn_agent` accept valid test agent definitions?" (spawn path regression)

### Claude's Discretion
- Exact prompt wording for dev-agent judgment criteria (follows the principles above)
- Which specific fields are causing QF-03 validation failures (investigate during implementation)
- Whether additional test agents beyond the 13 need adjustment

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QF-01 | `get_task_context` returns null gracefully on reopened conversations without tasks (ISS-003) | Root cause identified: tool returns `isError: true` when `ctx.taskId` is undefined. Fix: return informational content instead of error. See [QF-01 Root Cause Analysis](#qf-01-get_task_context-crash-on-reopened-conversations). |
| QF-02 | Dev-agent uses `ask` + `wait_for` for questions instead of `reply` (ISS-007) | Current prompt analyzed. Fix: pure prompt change in `dev-agent/prompt.md`. See [QF-02 Dev-Agent Question Behavior](#qf-02-dev-agent-question-behavior). |
| QF-03 | `spawn_agent` works for test agents -- fix validation mismatch vs production sub-agents (ISS-022) | Root cause identified: hardcoded `z.enum(["researcher", "coder", "tester"])` rejects test agent roles like "worker". Fix: make agentType accept any string from the parent's subAgents keys. See [QF-03 Spawn Agent Validation](#qf-03-spawn-agent-validation-mismatch). |
| QF-04 | `communication:notify` works for test agents (ISS-023) | Root cause identified: test agents have the tool but lack channel context. Fix: remove `communication:notify` from all test agent definitions. See [QF-04 Test Agent Notify](#qf-04-test-agent-notify-without-channel-context). |
</phase_requirements>

## Architecture Patterns

### Files Affected

```
packages/agents/
├── definitions/
│   ├── dev-agent/prompt.md                          # QF-02: prompt rewrite
│   ├── test-delegate-assigner/definition.yaml       # QF-04: remove notify
│   ├── test-timeout-assigner/definition.yaml        # QF-04: remove notify
│   ├── test-reject-assigner/definition.yaml         # QF-04: remove notify
│   ├── test-chain-initiator/definition.yaml         # QF-04: remove notify
│   ├── test-handoff-assigner/definition.yaml        # QF-04: remove notify
│   └── test-tool-exerciser/definition.yaml          # QF-04: remove notify + update prompt
├── src/
│   ├── shared/tools/
│   │   ├── task/get-task-context.ts                 # QF-01: graceful empty return
│   │   └── coordination/spawn-agent.ts              # QF-03: dynamic agentType validation
│   └── framework/
│       └── (no framework changes needed)
└── scripts/agent-tests/scenarios/tools.ts           # QF-04: update scenario expectations
```

### Pattern: Fix at Source, Test at Boundary

Each fix modifies exactly one source of truth, then adds a test at the call boundary:

- QF-01: Change `get-task-context.ts` behavior when no taskId, add unit test
- QF-02: Change `dev-agent/prompt.md` wording, no framework test (prompt = behavior)
- QF-03: Change `spawn-agent.ts` input schema, add unit test
- QF-04: Change YAML definitions, add structural validation test

### Anti-Patterns to Avoid
- **Adding framework workarounds for agent behavior bugs:** QF-02 is a prompt fix, not a framework fix. Don't add code that detects when the agent uses `reply` incorrectly and corrects it.
- **Test-specific carveouts in validation:** If the spawn_agent schema is too strict for test agents, it's too strict for any agent with custom sub-agent roles. Fix it for everyone.
- **Hardcoded enum values for extensible concepts:** The `agentType` enum `["researcher", "coder", "tester"]` was wrong from the start. Sub-agent roles are defined per-agent in YAML; the tool should validate against the parent's actual `subAgents` mapping.

## Code Examples

### QF-01: get_task_context Graceful Empty Return

**Current behavior** (`packages/agents/src/shared/tools/task/get-task-context.ts` lines 43-49):
```typescript
const taskId = parsed.data.taskId ?? ctx.taskId;
if (!taskId) {
  return {
    content: "No task ID provided and no task associated with this conversation.",
    isError: true,  // <-- BUG: this is informational, not an error
  };
}
```

**Fix:** Return a non-error informational response:
```typescript
const taskId = parsed.data.taskId ?? ctx.taskId;
if (!taskId) {
  return {
    content: "No active tasks found for this conversation.",
    // No isError -- "no tasks" is information, not a failure
  };
}
```

The `isError: true` flag tells the LLM the tool call failed, causing it to retry or error out. Removing the flag lets the agent reason about the empty state naturally.

### QF-03: Dynamic agentType Validation

**Current behavior** (`packages/agents/src/shared/tools/coordination/spawn-agent.ts` lines 27-36):
```typescript
const SpawnAgentInputSchema = z.object({
  agentType: z
    .enum(["researcher", "coder", "tester"])  // <-- BUG: hardcoded, rejects "worker"
    .describe("Type of sub-agent to spawn"),
  task: z.string().describe("Task description for the sub-agent to execute"),
  context: z.string().optional().describe("Additional context to prepend to the task"),
});
```

**Problem:** `test-subagent-parent` has `subAgents: { worker: test-subagent-child }`. The prompt tells it to spawn with role "worker". The Zod enum rejects "worker" before the tool ever looks at the parent's `subAgents` mapping.

**Fix:** Change `agentType` from a hardcoded enum to a `z.string()`, and let the existing subAgents mapping validation (lines 85-93) handle invalid roles:
```typescript
const SpawnAgentInputSchema = z.object({
  agentType: z
    .string()
    .min(1)
    .describe("Role of sub-agent to spawn (must match a key in the agent's subAgents mapping)"),
  task: z.string().describe("Task description for the sub-agent to execute"),
  context: z.string().optional().describe("Additional context to prepend to the task"),
});
```

The tool already validates the role against the parent's `subAgents` mapping at line 85-93 and returns a descriptive error listing available roles. The Zod enum was a redundant, incomplete guard. The subAgents mapping check is the proper validation.

**Also update the tool description** (line 57-61) to be dynamic rather than hardcoding "researcher/coder/tester":
```typescript
description:
  "Spawn a focused sub-agent to perform a specific task. " +
  "The agent type must match a role defined in this agent's subAgents mapping. " +
  "Each sub-agent shares the token budget with the orchestrator.",
```

### QF-04: Remove notify from Test Agent Definitions

**Agents with `communication:notify` that need it removed:**

| Agent | Has notify? | Action |
|-------|-------------|--------|
| test-delegate-assigner | Yes | Remove |
| test-timeout-assigner | Yes | Remove |
| test-reject-assigner | Yes | Remove |
| test-chain-initiator | Yes | Remove |
| test-handoff-assigner | Yes | Remove |
| test-tool-exerciser | Yes | Remove + update prompt + update scenario |

**Agents without `communication:notify` (no change needed):**

| Agent | Tools |
|-------|-------|
| test-delegate-acceptor | task:respond, task:complete_task, task:get_task_context |
| test-handoff-acceptor | task:respond, task:complete_task, task:get_task_context |
| test-delegate-rejector | task:respond, task:get_task_context |
| test-delegate-staller | task:get_task_context |
| test-chain-relay | task:respond, task:create_task, task:complete_task, task:delegate, task:get_task_context, coordination:wait_for, coordination:wait_for_task, directory:find |
| test-subagent-parent | task:create_task, task:complete_task, coordination:spawn_agent |
| test-subagent-child | task:get_task_context |

**Special case: test-tool-exerciser.** This agent exists specifically to exercise tool namespaces. Its test scenario (`tools.ts`) expects `communication_notify` to be called. Removing the tool means:
1. Remove `communication:notify` from `test-tool-exerciser/definition.yaml`
2. Remove step 5 (notification) from `test-tool-exerciser/prompt.md`
3. Update `scenarios/tools.ts` expectations to remove the notify expectation

### QF-02: Dev-Agent Prompt Changes

**Scope:** Modify the `<domain_knowledge>` section "Working with Humans" in `dev-agent/prompt.md`. The current prompt describes the tools but doesn't give judgment criteria for WHEN to use `ask` + `wait_for` vs `reply`.

**Current prompt section** (lines 59-67):
```markdown
## Working with Humans

You communicate with humans through three tools: reply, ask, and notify. Reply where they're talking to you.

- **reply()** sends a message back to whoever triggered the current conversation or signal.
- **ask()** is like reply but signals that you need a response before continuing.
- **notify()** sends a message to an explicit target channel.
```

**What to add (judgment criteria, not procedures):**

The prompt needs to teach the agent:
1. Default mode is "state assumptions and go" -- communicate what you're doing, don't ask permission
2. `ask` + `wait_for` is for genuine ambiguity the agent can't resolve from context or codebase
3. Bundle unknowns into one ask -- don't pause multiple times
4. Channel-aware communication: Linear = progress trail, Slack/reply = outcomes only, notify = channel-relevant outcomes only

These map directly to the locked decisions. The exact wording is Claude's discretion.

**Key principle for prompt wording:** Follow the PROMPT_GUIDE.md rules -- judgment criteria, not state machines. "Consider whether requirements are clear enough to begin" not "IF delegation THEN skip questions; IF direct THEN classify as simple/complex".

### Structural Validation Test

New test file: `packages/agents/src/framework/agent-definitions.test.ts` (or similar location).

```typescript
import { createAgentRegistry } from "./agent-registry.js";
import { join } from "node:path";

describe("agent definitions structural validation", () => {
  it("should load all test-* definitions without validation errors", async () => {
    const definitionsDir = join(__dirname, "../../definitions");
    const registry = createAgentRegistry({ definitionsDir, logger: mockLogger });
    const allDefs = await registry.list();
    const testDefs = allDefs.filter(d => d.id.startsWith("test-"));

    expect(testDefs.length).toBeGreaterThan(0);
    // Each test agent loaded successfully through Zod validation
    for (const def of testDefs) {
      expect(def.id).toBeTruthy();
      expect(def.systemPrompt).toBeTruthy();
    }
  });

  it("should load all production definitions without validation errors", async () => {
    // Same for non-test agents
    const definitionsDir = join(__dirname, "../../definitions");
    const registry = createAgentRegistry({ definitionsDir, logger: mockLogger });
    const allDefs = await registry.list();

    expect(allDefs.length).toBeGreaterThanOrEqual(6); // dev, product, qa, coder, researcher, tester
    for (const def of allDefs) {
      expect(def.id).toBeTruthy();
      expect(def.systemPrompt).toBeTruthy();
    }
  });
});
```

This catches definition drift at `pnpm test` time. If someone adds a required field to `AgentDefinitionYamlSchema` or corrupts a YAML file, this test fails immediately.

## Common Pitfalls

### Pitfall 1: Overcorrecting QF-02 Beyond ask/reply Scope

**What goes wrong:** Prompt rewrite changes completion behavior, affecting how the agent reports finished work or interacts during delegation.
**Why it happens:** QF-02 is about question-asking behavior, but the prompt section covers all communication. It's tempting to "improve" everything.
**How to avoid:** The locked decision says "ask is for questions, reply is for statements. Don't overcorrect completion behavior -- `reply` + `complete_task` for completion stays as-is."
**Warning signs:** The prompt diff touches completion/delegation sections that weren't broken.

### Pitfall 2: Breaking spawn_agent Existing Tests

**What goes wrong:** Changing the Zod schema from `z.enum(...)` to `z.string()` could make existing unit tests fail if they assert specific Zod error messages.
**Why it happens:** The test at `spawn-agent.test.ts` currently tests `execute({ agentType: "coder", ... })` which works with both enum and string schemas. But if any test relies on Zod rejecting invalid enum values, it would need updating.
**How to avoid:** Check the existing tests. The current tests at `spawn-agent.test.ts` pass "coder" and "researcher" -- both valid strings. The test for "unknown agent type" (line 205) passes "coder" but with a subAgents mapping that only has "researcher", so the error comes from the subAgents check, not the Zod schema. No test should break.
**Warning signs:** Test failures with Zod validation error message changes.

### Pitfall 3: Test-Tool-Exerciser Scenario Desync

**What goes wrong:** Removing `communication:notify` from test-tool-exerciser without updating the scenario expectations causes the tools integration test to fail.
**Why it happens:** The scenario at `scripts/agent-tests/scenarios/tools.ts` explicitly expects `communication_notify` in the tool calls list and expects "Notification was sent successfully".
**How to avoid:** Update all three files: definition.yaml, prompt.md, and scenarios/tools.ts. The scenario expectations and the agent's actual tool list must stay in sync.
**Warning signs:** The `tools` scenario passes locally but fails in integration tests.

### Pitfall 4: Structural Test Path Resolution

**What goes wrong:** The structural validation test uses a relative path to the definitions directory that doesn't resolve correctly in all test runners.
**Why it happens:** Vitest can run tests from different working directories. `__dirname` works in CJS but may need different handling for ESM.
**How to avoid:** Use `import.meta.url` and `fileURLToPath` for ESM path resolution, or use the project's existing pattern for resolving paths to the definitions directory. Check how `createAgentRegistry` is used in `main.ts`.
**Warning signs:** Test works locally but fails in CI.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent type validation | Custom validation logic in spawn-agent | The existing `subAgents` mapping check (already at line 85-93) | Already handles unknown types with descriptive error listing available roles |
| Question detection | Framework code that inspects agent output to detect questions | Prompt guidance (QF-02) | Agent-first principle: the agent decides when to ask, not a wrapper |
| Notify failure handling | Try/catch wrapper or fallback channel for test agents | Remove the tool entirely | Anti-pattern lesson from v2.7: don't give tools to agents that lack context to use them |

## State of the Art

No external dependencies or version changes needed. All fixes are to internal code.

| Component | Current State | Change |
|-----------|---------------|--------|
| `get-task-context.ts` | Returns `isError: true` when no taskId | Returns informational message, no error flag |
| `spawn-agent.ts` | Hardcoded `z.enum(["researcher", "coder", "tester"])` | `z.string().min(1)` -- validates against actual subAgents mapping |
| `dev-agent/prompt.md` | No judgment criteria for ask vs reply | Add communication judgment section |
| 6 test agent definitions | Have `communication:notify` without channel context | Remove the tool from all 6 |
| (new) structural test | Does not exist | Loads all definitions through registry, asserts no errors |

## Open Questions

1. **Exact definitions directory path resolution for structural test**
   - What we know: `main.ts` constructs the path. The registry test uses a temp directory.
   - What's unclear: Best ESM-compatible approach for the structural test to find `packages/agents/definitions/`
   - Recommendation: Check how `main.ts` resolves it and follow the same pattern. Likely `new URL('../../definitions', import.meta.url)`.

2. **Should the spawn_agent tool description list available roles dynamically?**
   - What we know: The current description hardcodes "researcher, coder, tester". After the fix, any string role is valid.
   - What's unclear: Whether the description should try to list actual roles (it can't -- description is static, roles come from the parent definition at runtime).
   - Recommendation: Make the description generic ("must match a role in the agent's subAgents mapping") and rely on the error message from the subAgents check to list available roles. The LLM already knows its roles from the system prompt.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** (all files read directly):
  - `packages/agents/src/shared/tools/task/get-task-context.ts` -- QF-01 root cause
  - `packages/agents/src/shared/tools/coordination/spawn-agent.ts` -- QF-03 root cause (line 29: hardcoded enum)
  - `packages/agents/src/shared/tools/communication/notify.ts` -- QF-04 tool behavior
  - `packages/agents/definitions/dev-agent/prompt.md` -- QF-02 current state
  - All 13 `definitions/test-*/definition.yaml` -- QF-03/QF-04 audit
  - `packages/agents/src/framework/worker-loop.ts` -- spawn context setup, task injection
  - `packages/agents/src/framework/types.ts` -- AgentDefinitionYamlSchema, ToolContext
  - `packages/agents/src/framework/agent-registry.ts` -- definition loading and Zod validation
  - `packages/agents/src/shared/tools/coordination/spawn-agent.test.ts` -- existing test coverage
  - `packages/agents/src/framework/tool-factories.test.ts` -- existing registration tests
  - `packages/agents/scripts/agent-tests/scenarios/tools.ts` -- tools scenario expectations
  - `packages/agents/scripts/agent-tests/scenarios/subagent.ts` -- subagent scenario expectations
  - `.planning/qa/2.7-issues.md` -- original issue descriptions

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` -- QF-01 through QF-04 requirement descriptions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing code
- Architecture: HIGH - all root causes verified by reading source
- Pitfalls: HIGH - based on reading actual test files and scenario definitions

**Research date:** 2026-02-16
**Valid until:** N/A (internal codebase fixes, not dependent on external APIs or libraries)
