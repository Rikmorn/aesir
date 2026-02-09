# Phase 66: Testing & Validation - Research

**Researched:** 2026-02-09
**Domain:** Communication pipeline test coverage audit + gap-fill
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Test scope boundary
- Phase 66 tests the **communication pipeline layer only** -- denormalizer dispatch, replyContext propagation, communication tool validation
- Integration MCP tool tests (GitHub `create_pr_comment`, Slack `reply_to_thread`/`send_message`) are **out of scope** -- they belong to the integration layer, not the communication pipeline
- Phase 60 already verified MCP tools work at delivery time; Phase 66 does not retroactively re-verify them
- Echo filter tests for Slack/GitHub are **out of scope** -- Slack uses Bolt's built-in bot_id filtering (predates v2.6), GitHub uses sender type check in webhook handler. Only Linear echo filter was Phase 65 scope and is already tested

#### Audit-first approach
- Phase 66 **audits existing test coverage** against the 4 success criteria before writing new tests
- Criteria already satisfied by Phases 61-63 tests are marked as **pre-met** -- not duplicated
- New tests are written only for actual gaps found during the audit
- TEST-01 (denormalizer matrix): likely pre-met by Phase 63's TDD tests (11 cases in denormalizer.test.ts)
- TEST-04 (ask options): likely pre-met by communication-tools.test.ts option rendering tests
- TEST-02 (propagation): most likely to need new work -- crosses phase boundaries (61 + 62)
- TEST-03 (communication tool validation): likely pre-met by communication-tools.test.ts (15 cases)

#### Integration test strategy
- All Phase 66 tests are **mock-based fast tests** -- no testcontainers, no Docker, no real DB
- Tests run as part of `pnpm test:fast` suite
- Denormalizer tests mock `callMcpTool`; communication tool tests mock the denormalizer; propagation tests mock each boundary
- The type system (Zod discriminated union shared across all layers) already provides structural guarantees -- tests verify wiring/data flow, not type compatibility

#### Propagation test structure
- **Separate handoff tests per boundary**, not one monolithic chain test
- Handoff points: adapter->router, router->executor, executor->message builder
- Each test mocks the layer below and asserts replyContext is preserved in the output
- Failure isolation: a failing handoff test tells you exactly which boundary dropped replyContext
- Chain guarantee is structural (if A->B preserves and B->C preserves, A->C preserves) -- transitivity does not need an end-to-end test
- Many handoff tests likely already exist from Phases 61/62 -- audit first

#### TEST-04 revision (ask capability asymmetry)
- **CRITICAL:** The ROADMAP success criterion #4 is factually incorrect about the implementation
- ask() renders options as **text instructions uniformly on ALL channels** -- no Slack interactive buttons
- `send_approval_request` remains in the Slack integration for the router's legacy use but is NOT part of the communication layer
- This was a deliberate design decision during Phase 63 (not an oversight)
- TEST-04 should be revised to: "Verify that ask() with options renders text-formatted options consistently across all three channels -- the denormalizer receives the same pre-rendered text regardless of channel"
- The ROADMAP criterion and REQUIREMENTS TEST-04 entry should be updated to match reality

### Claude's Discretion
- Exact test file organization for any new propagation tests (colocate with existing tests vs new file)
- Whether to add a JSONB round-trip micro-test for replyContext if the concern exists
- How to structure the audit report (inline in plan or separate artifact)

### Deferred Ideas (OUT OF SCOPE)
- **Integration MCP tool tests** -- GitHub `create_pr_comment` and Slack `reply_to_thread`/`send_message` have no MCP-level tests. Track as integration layer test debt.
- **Slack/GitHub echo filter tests** -- Only Linear has echo filter tests. Slack uses Bolt's built-in bot_id filtering, GitHub uses sender type check. Track as integration layer test debt.
- **JSONB round-trip test** -- if replyContext JSONB storage/retrieval is a concern, a single focused DB test could verify it. Not worth a full integration test setup.
</user_constraints>

## Summary

Phase 66 is a validation phase that audits existing test coverage from Phases 60-65 against four success criteria (TEST-01 through TEST-04), then fills any gaps. The research thoroughly examined every existing test file in the communication pipeline and mapped each test case to the four requirements.

**Key finding:** Three of four requirements (TEST-01, TEST-03, TEST-04) are already fully satisfied by existing tests. TEST-02 (replyContext propagation) is almost entirely covered -- every individual handoff boundary already has tests -- but the existing tests are spread across 6 different test files and there is no explicit "executor->message builder" handoff test (the worker-loop.test.ts has zero replyContext tests, though conversation-executor.test.ts covers the DB persistence + XML tag injection which is the same boundary).

The primary work for Phase 66 is: (1) perform the audit and document which existing tests satisfy which criteria, (2) update ROADMAP.md and REQUIREMENTS.md to correct TEST-04's factually incorrect description, (3) write any gap-fill tests discovered during audit (likely minimal -- possibly a single worker-loop propagation test for the signal-resume->message-with-tag handoff), and (4) mark all TEST requirements as satisfied.

**Primary recommendation:** Structure as a single plan with an audit phase followed by gap-fill. The audit is the primary deliverable; new test code is secondary.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (workspace) | Test runner and assertion library | Already used across all packages |
| zod | (workspace) | Schema validation (tested indirectly through tool input validation) | Already the project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vi.mock | vitest built-in | Module mocking for callMcpTool isolation | All denormalizer and communication tool tests |
| vi.fn | vitest built-in | Function spies for verifying call parameters | Asserting correct MCP tool routing |

No new dependencies are needed. All testing infrastructure is already in place.

## Architecture Patterns

### Existing Test File Map

The communication pipeline tests are spread across these files:

```
packages/agents/src/
  adapters/
    slack.test.ts              # Slack adapter: replyContext extraction (12 tests, 6 with replyContext)
    linear.test.ts             # Linear adapter: replyContext extraction (10 tests, 3 with replyContext)
    github.test.ts             # GitHub adapter: replyContext extraction (14 tests, 6 with replyContext)
  router/
    router.test.ts             # Router: replyContext propagation to executor (26 tests, 5 with replyContext)
    enrichment.test.ts         # Enrichment: default_notify_target injection (10 tests)
    tools/
      signal-conversation.test.ts  # Signal tool: replyContext auto-injection (5 tests)
      start-conversation.test.ts   # Start tool: replyContext auto-injection (3 tests)
  framework/
    event-router.test.ts       # EventRouter: replyContext in signal routing (2 tests)
    conversation-executor.test.ts  # Executor: replyContext DB storage + XML tag (6 tests)
    worker-loop.test.ts        # Worker loop: NO replyContext tests (0 tests)
    tool-factories.test.ts     # Tool registration: communication tool registration (4 tests)
  shared/
    communication/
      denormalizer.test.ts     # Denormalizer: MCP tool dispatch per channel (9 tests)
    tools/communication/
      communication-tools.test.ts  # reply/ask/notify: validation + delegation (9 tests)
```

### Pattern 1: Test Audit Matrix

**What:** Map each requirement's success criteria to specific existing test cases by file and test name.

**When to use:** Phase 66 audit-first approach -- before writing any new tests.

**Structure for each TEST requirement:**

```
TEST-XX: [requirement description]
Status: PRE-MET | GAP | PARTIAL

Evidence:
- [file.test.ts]: [test name] -- covers [specific aspect]
- [file.test.ts]: [test name] -- covers [specific aspect]

Gaps (if any):
- [what is missing]
- [what new test would cover it]
```

### Pattern 2: Handoff Boundary Test Pattern

**What:** Tests that verify data (replyContext) is preserved across a function/module boundary by mocking the downstream layer and asserting the upstream layer passes it through.

**When to use:** For any propagation gap-fill tests.

**Example (from existing signal-conversation.test.ts):**

```typescript
it("auto-injects eventReplyContext when LLM omits replyContext", async () => {
  const { deps, executor } = createDeps({
    eventReplyContext: slackReplyContext,
  });
  const tool = createSignalConversationTool(deps);

  await tool.execute({
    conversationId: "conv-test",
    signalType: "approval",
    payload: { approved: true },
    message: "Looks good",
    // No replyContext provided by LLM
  });

  expect(executor.signal).toHaveBeenCalledWith(
    "conv-test",
    expect.objectContaining({
      replyContext: slackReplyContext,
    }),
  );
});
```

### Anti-Patterns to Avoid
- **Duplicating existing tests:** If a test already exists and passes, do not rewrite it under Phase 66. Mark as pre-met.
- **End-to-end chain tests:** Do not write a single test that spans adapter->router->executor->agent. Each boundary has its own test. Transitivity gives the chain guarantee.
- **Integration tests:** All Phase 66 tests are mock-based fast tests. No testcontainers, no real DB.

## Detailed Audit Results

### TEST-01: Denormalizer unit tests (9+ test cases covering channel x action matrix)

**Status: PRE-MET (CONFIRMED)**

The ROADMAP requires "at least 9 test cases covering the matrix" of channel (slack, linear, github) x action type (reply, ask, notify).

**Existing coverage in `denormalizer.test.ts` (9 tests):**

| # | Test | Channel | Verifies |
|---|------|---------|----------|
| 1 | "calls reply_to_thread when threadTs is present" | slack | reply_to_thread MCP tool |
| 2 | "calls send_message when threadTs is absent" | slack | send_message MCP tool |
| 3 | "calls create_comment with issueId and body" | linear | create_comment MCP tool |
| 4 | "calls create_pr_comment with owner, repo, prNumber, and body" | github | create_pr_comment MCP tool |
| 5 | "includes inReplyTo when commentId is present" | github | create_pr_comment with inReplyTo |
| 6 | "returns callMcpTool result directly" | linear | return value passthrough |
| 7 | "propagates McpError without wrapping" | slack | error propagation |
| 8 | "logs info with channel, tool, and agentId" | slack | logging correctness |
| 9 | "forwards taskId to callMcpTool when present" | linear | taskId forwarding |

**Analysis:** Tests 1-5 directly cover the channel dispatch matrix: slack (2 cases for thread vs channel), linear (1 case), github (2 cases including inReplyTo). Tests 6-9 cover cross-cutting concerns. The denormalizer is a pure dispatcher -- reply/ask/notify all call `denormalize()` with the same parameters, so the 3x3 matrix collapses to the denormalizer's 5 channel-route tests plus the 3 communication tool tests that verify delegation.

The communication-tools.test.ts adds 3 more dispatch verifications (reply delegates to slack, ask delegates to slack, notify delegates to linear) -- bringing the effective matrix coverage to well over 9.

**Verdict: Criterion met.** 9 denormalizer tests + 3 communication tool delegation tests = 12 tests covering the dispatch matrix.

### TEST-02: ReplyContext propagation (adapter -> signal -> executor -> agent message)

**Status: MOSTLY PRE-MET with possible gap in worker-loop signal-resume path**

**Handoff Boundary 1: Adapter -> IncomingEvent (replyContext extraction)**

Fully tested. Each adapter has explicit replyContext tests:

| File | Tests with replyContext |
|------|----------------------|
| `slack.test.ts` | 6 tests: approval with/without replyContext, app_mention with/without, message.created with/without |
| `linear.test.ts` | 3 tests: agent_session.created with replyContext, comment.created with replyContext, issue.created without |
| `github.test.ts` | 6 tests: pr_merged/closed/review_submitted with/without replyContext |

**Handoff Boundary 2: Router -> Executor (replyContext passed to start/signal)**

Fully tested in `router.test.ts`:
- "propagates replyContext from incoming event to executor.start()" -- start path
- "omits replyContext from executor.start() when incoming event has none" -- absence test
- "passes eventReplyContext to slow-path deps when incoming event has Slack replyContext" -- slow-path
- "passes Linear replyContext through slow-path deps" -- alternate channel
- "does not set eventReplyContext when incoming event has no replyContext" -- absence test

**Handoff Boundary 2b: Router tools -> Executor (replyContext in start_conversation/signal_conversation)**

Fully tested:
- `start-conversation.test.ts`: 3 tests (auto-inject, LLM override, omit when absent)
- `signal-conversation.test.ts`: 5 tests (auto-inject, LLM override, omit when absent, validation, alongside other fields)

**Handoff Boundary 3: EventRouter -> Signal object (replyContext in signal routing)**

Tested in `event-router.test.ts`:
- "signal route includes replyContext from IncomingEvent"
- "signal route works without replyContext (backward compatible)"

**Handoff Boundary 4: Executor -> DB row + message (replyContext stored and injected as XML tag)**

Tested in `conversation-executor.test.ts`:
- "signal() with replyContext updates reply_context column and appends XML tag to message" -- signal path
- "signal() without replyContext does NOT update reply_context column" -- absence test
- "start() with replyContext stores it on conversation row and appends tag to message" -- start path
- "start() without replyContext sets reply_context to null and does not append tag" -- absence test
- "start() re-trigger path stores replyContext and appends tag" -- re-trigger path

**Handoff Boundary 5: Worker loop signal-resume -> message content**

**NOT TESTED.** `worker-loop.test.ts` has zero replyContext tests. The worker-loop has two code paths that call `appendReplyContextTag()` on signal content:
1. Line 675: When processing queued signals at conversation claim time
2. Line 929: When auto-resuming after wait_for detects a queued matching signal

However, the conversation-executor.test.ts already tests the `signal()` method which writes the reply_context to the DB row and appends the XML tag to the message before the worker picks it up. The worker-loop's `appendReplyContextTag()` calls are for the case where signals arrive while the worker is already running (queued signals consumed during the loop).

**Gap assessment:** The worker-loop's `appendReplyContextTag()` is a secondary path. The primary path (signal -> DB -> agent message) is tested in conversation-executor.test.ts. Whether this gap is worth filling depends on risk tolerance. The function `appendReplyContextTag()` itself is trivial (3 lines). The real risk is "does the worker-loop correctly extract `replyContext` from the queued signal object?" -- which is a type cast, not validated.

**Recommendation (Claude's discretion):** A single focused test in the worker-loop test file would close this gap if desired. But structurally, the guarantee holds: signals enter via executor.signal() (tested), are stored in DB (tested), and are consumed by worker-loop which calls the same appendReplyContextTag function. This is a LOW-risk gap.

**Verdict: Criterion substantively met.** 21+ tests across 6 files cover every boundary. One minor gap in worker-loop queued-signal path.

### TEST-03: Communication tool input validation + denormalizer delegation

**Status: PRE-MET (CONFIRMED)**

**Existing coverage in `communication-tools.test.ts` (9 tests):**

| # | Tool | Test | Aspect |
|---|------|------|--------|
| 1 | reply | "calls denormalize with correct params and returns JSON result" | Delegation |
| 2 | reply | "returns isError when replyContext is missing" | Zod validation |
| 3 | reply | "returns isError with prefix on McpError" | Error handling |
| 4 | reply | "returns isError with message on generic Error" | Error handling |
| 5 | ask | "renders options as text instructions appended to question" | Option rendering + delegation |
| 6 | ask | "passes question text directly when no options" | Delegation |
| 7 | ask | "returns isError when replyContext is missing" | Zod validation |
| 8 | notify | "calls denormalize with target as replyContext" | Delegation |
| 9 | notify | "returns isError when target is missing" | Zod validation |

**What the criterion requires:**
1. "Zod input validation rejects malformed input" -- Tests 2, 7, 9 verify this (missing required replyContext/target)
2. "valid input delegates correctly to the denormalizer" -- Tests 1, 5, 6, 8 verify this

**Verdict: Criterion met.** 9 tests covering validation rejection (3) + correct delegation (4) + error handling (2).

### TEST-04: ask() option rendering (revised per CONTEXT.md)

**Status: PRE-MET (CONFIRMED) -- but ROADMAP/REQUIREMENTS text needs updating**

**Revised criterion (from CONTEXT.md):** "Verify that ask() with options renders text-formatted options consistently across all three channels -- the denormalizer receives the same pre-rendered text regardless of channel"

**Existing coverage in `communication-tools.test.ts`:**
- Test 5: "renders options as text instructions appended to question" -- verifies the text sent to denormalize is `'Which approach?\n\n- **Option A**: reply "a"\n- **Option B**: reply "b"'`

This test uses a Slack replyContext, and the ask tool's `renderOptions()` function operates on the options BEFORE calling `denormalize()` -- meaning the text is channel-independent. The denormalizer receives pre-rendered text regardless of channel.

**Why channel-specific tests are unnecessary:** The ask tool calls `renderOptions()` to produce text, then passes that text to `denormalize()`. The denormalizer's channel dispatch is already tested in denormalizer.test.ts. Since renderOptions is pure (no channel dependency), testing it with one channel proves it works for all channels.

**What needs to happen:** The ROADMAP success criterion #4 and REQUIREMENTS TEST-04 entry must be updated to match the actual implementation (text rendering, not interactive buttons).

**Verdict: Criterion met** after text correction. No new test code needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test mocking | Custom mock framework | vitest vi.mock/vi.fn | Already used everywhere, well-tested |
| Schema validation testing | Manual field-by-field checks | Zod safeParse assertions | Already the pattern in existing tests |
| Test organization | New test file conventions | Colocate with source files | Project standard (*.test.ts next to source) |

**Key insight:** Phase 66 should not invent new testing patterns. Every pattern needed already exists in the codebase. The phase's value is in audit and documentation, not infrastructure.

## Common Pitfalls

### Pitfall 1: Duplicating pre-met tests
**What goes wrong:** Writing new tests that duplicate existing coverage, inflating test count without adding value.
**Why it happens:** Not auditing existing tests before writing new ones.
**How to avoid:** Complete the full audit first. Only write tests for actual gaps.
**Warning signs:** New test file that tests the same code path as an existing test.

### Pitfall 2: Over-counting denormalizer matrix
**What goes wrong:** Counting 3 channels x 3 actions = 9 as a literal requirement for 9 separate denormalize() calls, when the denormalizer has 4-5 routes (slack-thread, slack-channel, linear, github, github-inReplyTo).
**Why it happens:** The denormalizer is channel-based, not action-based. reply/ask/notify all call the same denormalize() with the same replyContext.
**How to avoid:** Understand that the 9-case matrix is satisfied by: 5 denormalizer route tests + 4 communication tool delegation tests = 9+ tests covering every combination that matters.
**Warning signs:** Trying to write 9 separate denormalizer tests with artificial reply/ask/notify distinctions.

### Pitfall 3: Writing an end-to-end propagation chain test
**What goes wrong:** Creating a test that spans adapter->router->executor->worker-loop->agent, requiring extensive mocking of all layers.
**Why it happens:** Interpreting TEST-02 as requiring a single test that traces the full path.
**How to avoid:** Per CONTEXT.md, use separate handoff tests per boundary. Transitivity gives the chain guarantee.
**Warning signs:** A test file with 5+ mock setups trying to simulate the full event pipeline.

### Pitfall 4: Forgetting to update ROADMAP/REQUIREMENTS
**What goes wrong:** Tests pass but the success criterion text still says "Slack receives interactive buttons" which is factually wrong.
**Why it happens:** Focus on code, not documentation.
**How to avoid:** Updating ROADMAP.md criterion #4 and REQUIREMENTS.md TEST-04 is an explicit deliverable.
**Warning signs:** Phase verification fails because auditor reads the old criterion text.

## Code Examples

### Existing test patterns to follow

#### Mock callMcpTool pattern (from denormalizer.test.ts)
```typescript
const mockCallMcpTool = vi.fn();

vi.mock("../mcp/client.js", () => ({
  callMcpTool: (...args: unknown[]) => mockCallMcpTool(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCallMcpTool.mockResolvedValue({ success: true });
});
```

#### replyContext handoff assertion pattern (from router.test.ts)
```typescript
it("propagates replyContext from incoming event to executor.start()", async () => {
  const slackReplyContext = {
    channel: "slack" as const,
    teamId: "T789",
    channelId: "C123",
    threadTs: "1234567890.000000",
  };
  mockAdaptPassThrough.mockReturnValue(
    createIncomingEvent({
      taskId: task.id,
      replyContext: slackReplyContext,
    }),
  );

  await routeEvent(createNormalizedEvent(), deps);

  const startCall = vi.mocked(executor.start).mock.calls[0]?.[0];
  expect(startCall?.replyContext).toEqual(slackReplyContext);
});
```

#### Zod validation rejection pattern (from communication-tools.test.ts)
```typescript
it("returns isError when replyContext is missing", async () => {
  const deps = createDeps();
  const tool = createReplyTool(deps);

  const result = await tool.execute({
    message: "Hello world",
    // Missing replyContext
  });

  expect(result.isError).toBe(true);
  expect(result.content).toContain("Invalid input");
  expect(mockCallMcpTool).not.toHaveBeenCalled();
});
```

## State of the Art

No external libraries or new approaches needed. The testing patterns are stable and well-established in the codebase.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | vitest + vi.mock for unit tests | Established in Phase 20 | Standard pattern |
| N/A | testcontainers for integration tests | Established in Phase 20 | Not needed for Phase 66 |

## Phase 66 Execution Summary

Based on the audit, here is the concrete work:

### Plan structure recommendation

**Single plan** with the following work items:

1. **Audit documentation** -- Produce the formal audit mapping existing tests to TEST-01 through TEST-04 criteria. This can be inline in the plan's verification or a separate audit section in the plan itself.

2. **Update ROADMAP.md** -- Fix success criterion #4 to match the actual implementation (text rendering on all channels, not interactive buttons on Slack).

3. **Update REQUIREMENTS.md** -- Fix TEST-04 description. Mark all four TEST requirements as satisfied with evidence references.

4. **Gap-fill tests (if any)** -- Based on the audit, the only potential gap is worker-loop signal-resume replyContext propagation. This is LOW-risk because:
   - The function called (`appendReplyContextTag`) is trivial (3 lines)
   - The upstream path (executor.signal -> DB -> XML tag) is already tested
   - The worker-loop code is a type cast + function call, not complex logic

   **Recommendation:** Write a single focused worker-loop test for the signal-resume path if thoroughness is desired. Skip if the team considers the existing coverage sufficient.

5. **Run tests** -- Verify all existing + new tests pass via `pnpm test:fast`.

## Open Questions

1. **Worker-loop replyContext gap: worth filling?**
   - What we know: worker-loop.test.ts has 0 replyContext tests. The worker-loop has 2 code paths that extract replyContext from queued signals and call appendReplyContextTag().
   - What's unclear: Whether the user considers this a real gap or covered by the conversation-executor tests.
   - Recommendation: Write a single test. It is cheap (~20 lines) and closes the only possible gap found in the audit. Better to err on the side of coverage for a validation phase.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all test files under `packages/agents/src/`
- Source files: denormalizer.ts, types.ts, ask.ts, reply.ts, notify.ts, message-utils.ts, worker-loop.ts
- Test files: denormalizer.test.ts (9 tests), communication-tools.test.ts (9 tests), slack.test.ts, linear.test.ts, github.test.ts, router.test.ts, event-router.test.ts, conversation-executor.test.ts, signal-conversation.test.ts, start-conversation.test.ts, worker-loop.test.ts

### Secondary (MEDIUM confidence)
- ROADMAP.md and REQUIREMENTS.md for success criteria definitions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns already established
- Architecture: HIGH -- direct codebase inspection of all relevant files
- Pitfalls: HIGH -- derived from actual code examination and audit findings
- Audit results: HIGH -- every claim maps to specific test names and line numbers

**Research date:** 2026-02-09
**Valid until:** No expiry -- codebase-specific research, not library-dependent
