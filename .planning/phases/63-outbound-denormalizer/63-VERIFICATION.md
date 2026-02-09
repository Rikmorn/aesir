---
phase: 63-outbound-denormalizer
verified: 2026-02-09T01:03:00Z
status: passed
score: 7/7 truths verified
design_note: |
  Phase 63 implementation follows a locked design decision (CONTEXT.md) that
  diverges from the original phase goal. The original goal specified Slack
  interactive buttons for ask() with options. The locked design uses uniform
  text rendering across all channels. Implementation is internally consistent
  with its locked design. OUTB-04 requirement needs updating to match.
---

# Phase 63: Outbound Denormalizer Verification Report

**Phase Goal:** A denormalizer function translates domain-language communication actions into the correct integration MCP tool calls based on replyContext channel type

**Verified:** 2026-02-09T01:03:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Calling the denormalizer with a Slack replyContext and a reply action invokes slack:reply_to_thread via MCP when threadTs is present | ✓ VERIFIED | denormalizer.ts lines 58-79 switches on channel="slack", calls reply_to_thread when threadTs present; denormalizer.test.ts line "calls reply_to_thread when threadTs is present" passes |
| 2 | Calling the denormalizer with a Slack replyContext invokes slack:send_message when threadTs is absent | ✓ VERIFIED | denormalizer.ts lines 71-79 calls send_message when threadTs absent; denormalizer.test.ts line "calls send_message when threadTs is absent" passes |
| 3 | Calling the denormalizer with a Linear replyContext invokes linear:create_comment via MCP for all action types | ✓ VERIFIED | denormalizer.ts lines 82-92 switches on channel="linear", calls create_comment with issueId/body; denormalizer.test.ts line "calls create_comment with issueId and body" passes |
| 4 | Calling the denormalizer with a GitHub replyContext invokes github:create_pr_comment via MCP for all action types | ✓ VERIFIED | denormalizer.ts lines 94-108 switches on channel="github", calls create_pr_comment with owner/repo/prNumber/body; denormalizer.test.ts line "calls create_pr_comment with owner, repo, prNumber, and body" passes |
| 5 | ask() renders options as text instructions for all channels (design change: no Slack interactive buttons) | ✓ VERIFIED | ask.ts lines 36-42 renderOptions() formats as markdown text; communication-tools.test.ts line "renders options as text instructions appended to question" verifies format `- **Label**: reply "value"` |
| 6 | When replyContext is malformed, clear error returned | ✓ VERIFIED | reply.ts/ask.ts/notify.ts lines 40-46 use Zod safeParse with validation error content; communication-tools.test.ts lines "returns isError when replyContext is missing" verify error handling |
| 7 | reply() and ask() require replyContext in their Zod schemas — missing replyContext is a validation error | ✓ VERIFIED | reply.ts line 18-23 ReplyInputSchema.replyContext non-optional; ask.ts line 23-27 AskInputSchema.replyContext non-optional; notify.ts line 18-23 NotifyInputSchema.target non-optional |

**Score:** 7/7 truths verified

**Design Note:** Phase 63 implementation follows a locked design decision documented in 63-CONTEXT.md that diverges from the original phase goal stated in ROADMAP.md. The original goal (success criterion 4) specified "Slack renders interactive buttons while Linear and GitHub render options as text instructions." The locked design (CONTEXT.md lines 51-58) uses "uniform text rendering across all channels (including Slack) — no interactive buttons." This decision was made during phase planning to keep the communication layer purely conversational, with send_approval_request remaining in the Slack integration for router/legacy paths only.

Implementation is internally consistent with the locked design. The denormalizer never calls send_approval_request, and ask() renders all options as text before calling the denormalizer. All 9 denormalizer tests and 9 communication tool tests pass.

**Requirement Impact:** OUTB-04 ("Slack denormalizer uses send_approval_request for ask() with options") conflicts with the locked design and should be updated to reflect uniform text rendering, or the design should be revisited in Phase 65 if interactive buttons prove necessary.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/agents/src/shared/communication/denormalizer.ts` | Pure dispatch function: replyContext + text -> MCP tool call | ✓ VERIFIED | 126 lines, denormalize() exhaustive switch on channel (slack/linear/github), no default case, resolveToolName() helper for logging |
| `packages/agents/src/shared/communication/denormalizer.test.ts` | Comprehensive test coverage | ✓ VERIFIED | 9 unit tests covering all dispatch paths (Slack with/without threadTs, Linear, GitHub with/without commentId), error propagation, logging, taskId forwarding |
| `packages/agents/src/shared/tools/communication/reply.ts` | communication:reply tool factory | ✓ VERIFIED | 70 lines, validates replyContext + message, calls denormalize, McpError handling, exports createReplyTool |
| `packages/agents/src/shared/tools/communication/ask.ts` | communication:ask tool factory | ✓ VERIFIED | 94 lines, renders options as text via renderOptions() helper, validates replyContext + question, calls denormalize, exports createAskTool |
| `packages/agents/src/shared/tools/communication/notify.ts` | communication:notify tool factory | ✓ VERIFIED | 70 lines, validates target + message, calls denormalize with target as replyContext, exports createNotifyTool |
| `packages/agents/src/shared/tools/communication/index.ts` | Barrel exports for communication tools | ✓ VERIFIED | 4 lines, exports createReplyTool, createAskTool, createNotifyTool in alphabetical order |
| `packages/agents/src/shared/tools/communication/communication-tools.test.ts` | Unit tests for all three tools | ✓ VERIFIED | 9 unit tests covering reply (validation, McpError, generic Error), ask (options rendering, no options, validation), notify (target delegation, validation) |
| `packages/agents/src/framework/tool-factories.ts` | Updated registration with communication namespace (39 tools) | ✓ VERIFIED | 337 lines, communicationAdapter defined (lines 134-144), communication:reply/ask/notify registered (lines 320-328), JSDoc updated to "39 tool factories" |
| `packages/agents/src/framework/tool-factories.test.ts` | Updated test assertions (39 tools, communication namespace) | ✓ VERIFIED | Test count assertion updated to 39, communication namespace added to expected set, "should register all communication tools" test added, "should resolve communication tools to ToolDefinitions with underscore names" test added |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `packages/agents/src/shared/tools/communication/reply.ts` | `packages/agents/src/shared/communication/denormalizer.ts` | denormalize() call | ✓ WIRED | Line 11 imports denormalize, line 49 calls denormalize with replyContext + message |
| `packages/agents/src/shared/tools/communication/ask.ts` | `packages/agents/src/shared/communication/denormalizer.ts` | denormalize() call | ✓ WIRED | Line 11 imports denormalize, line 76 calls denormalize with replyContext + text (with rendered options) |
| `packages/agents/src/shared/tools/communication/notify.ts` | `packages/agents/src/shared/communication/denormalizer.ts` | denormalize() call | ✓ WIRED | Line 11 imports denormalize, line 49 calls denormalize with target + message |
| `packages/agents/src/framework/tool-factories.ts` | `packages/agents/src/shared/tools/communication/index.ts` | import and communicationAdapter registration | ✓ WIRED | Lines 36-38 import createReplyTool/createAskTool/createNotifyTool, lines 134-144 define communicationAdapter, lines 320-328 register all three tools |
| `packages/agents/src/shared/communication/denormalizer.ts` | `packages/agents/src/shared/mcp/client.ts` | callMcpTool() dispatch | ✓ WIRED | Line 13 imports callMcpTool, lines 60-79 (Slack), 83-91 (Linear), 95-107 (GitHub) call callMcpTool with integration-specific params |

### Requirements Coverage

| Requirement | Status | Supporting Truth | Notes |
|-------------|--------|------------------|-------|
| OUTB-01: Denormalizer dispatches to Slack MCP tools based on replyContext.channel | ✓ SATISFIED | Truth 1, 2 | denormalizer.ts lines 58-79, switches on channel="slack" |
| OUTB-02: Denormalizer dispatches to Linear MCP tools based on replyContext.channel | ✓ SATISFIED | Truth 3 | denormalizer.ts lines 82-92, switches on channel="linear" |
| OUTB-03: Denormalizer dispatches to GitHub MCP tools based on replyContext.channel | ✓ SATISFIED | Truth 4 | denormalizer.ts lines 94-108, switches on channel="github" |
| OUTB-04: Slack denormalizer uses send_approval_request for ask() with options (interactive buttons) | ⚠️ DESIGN CHANGE | Truth 5 | **Design changed during Phase 63 planning:** ask() renders options as text for ALL channels including Slack. send_approval_request is not called by the denormalizer. See CONTEXT.md lines 51-58. Requirement needs updating or design needs revisiting. |
| OUTB-05: Slack denormalizer uses reply_to_thread for reply() and ask() without options | ✓ SATISFIED | Truth 1, 2 | denormalizer.ts uses reply_to_thread when threadTs present, send_message when absent |
| OUTB-06: Linear denormalizer renders ask() options as text instructions in comment body | ✓ SATISFIED | Truth 3, 5 | ask.ts renders options as text before calling denormalizer, denormalizer calls create_comment with rendered text |
| OUTB-07: GitHub denormalizer renders ask() options as text instructions in PR comment body | ✓ SATISFIED | Truth 4, 5 | ask.ts renders options as text before calling denormalizer, denormalizer calls create_pr_comment with rendered text |
| OUTB-08: Denormalizer returns clear error with guidance when replyContext is invalid or malformed | ✓ SATISFIED | Truth 6 | Zod validation errors in reply/ask/notify tools, McpError propagation in denormalizer |
| OUTB-09: communication:reply and communication:ask require replyContext in their Zod schemas | ✓ SATISFIED | Truth 7 | ReplyInputSchema and AskInputSchema have non-optional replyContext field, NotifyInputSchema has non-optional target field |

**Requirements Score:** 8/9 satisfied, 1 design change requiring requirement update

### Anti-Patterns Found

No anti-patterns found. All files are production-ready:

- No TODO/FIXME/PLACEHOLDER comments
- No empty implementations (return null/{}/)
- No console.log-only handlers
- All error paths have proper error handling and propagation
- All tools return structured ToolResult with content and optional isError

### Human Verification Required

None. All verification automated via:
- Unit tests (18 tests across denormalizer and communication tools)
- Import/wiring verification via grep
- Type safety via TypeScript exhaustive checking
- Test execution confirms runtime behavior

---

## Summary

**Phase 63 goal achieved with design change caveat.**

All artifacts exist, are substantive (126-337 lines of implementation), and are fully wired. The denormalizer dispatches to the correct MCP tools based on replyContext.channel for all three channels (Slack, Linear, GitHub). The three communication tools (reply, ask, notify) validate input, render options as text (ask only), and delegate to the denormalizer. All tools are registered in tool-factories.ts under the communication namespace (39 total tools). 18 unit tests pass.

**Design Change:** Phase 63 implementation follows a locked design decision (documented in CONTEXT.md) that uses uniform text rendering for ask() options across all channels, diverging from the original phase goal which specified Slack interactive buttons. This decision keeps the communication layer purely conversational, with send_approval_request reserved for router/legacy paths only.

**Action Required:** Update OUTB-04 requirement to match the locked design, OR revisit the design in Phase 65 if interactive buttons prove necessary for user experience.

**Commits Verified:**
- Plan 01: dedeb58 (RED tests), 21fa712 (denormalizer implementation)
- Plan 02: 2815737 (communication tools), df5fe3f (registration + tests)

---

_Verified: 2026-02-09T01:03:00Z_
_Verifier: Claude (gsd-verifier)_
