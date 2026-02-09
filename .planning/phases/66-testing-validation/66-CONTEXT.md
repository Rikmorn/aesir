# Phase 66: Testing & Validation - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify that the v2.6 unified agent communication pipeline works correctly across all channels (Slack, Linear, GitHub), with observable test coverage for the full path from inbound event to outbound delivery. This phase validates work from Phases 60-65 — it does not add new functionality.

</domain>

<decisions>
## Implementation Decisions

### Test scope boundary
- Phase 66 tests the **communication pipeline layer only** — denormalizer dispatch, replyContext propagation, communication tool validation
- Integration MCP tool tests (GitHub `create_pr_comment`, Slack `reply_to_thread`/`send_message`) are **out of scope** — they belong to the integration layer, not the communication pipeline
- Phase 60 already verified MCP tools work at delivery time; Phase 66 does not retroactively re-verify them
- Echo filter tests for Slack/GitHub are **out of scope** — Slack uses Bolt's built-in bot_id filtering (predates v2.6), GitHub uses sender type check in webhook handler. Only Linear echo filter was Phase 65 scope and is already tested

### Audit-first approach
- Phase 66 **audits existing test coverage** against the 4 success criteria before writing new tests
- Criteria already satisfied by Phases 61-63 tests are marked as **pre-met** — not duplicated
- New tests are written only for actual gaps found during the audit
- TEST-01 (denormalizer matrix): likely pre-met by Phase 63's TDD tests (11 cases in denormalizer.test.ts)
- TEST-04 (ask options): likely pre-met by communication-tools.test.ts option rendering tests
- TEST-02 (propagation): most likely to need new work — crosses phase boundaries (61 + 62)
- TEST-03 (communication tool validation): likely pre-met by communication-tools.test.ts (15 cases)

### Integration test strategy
- All Phase 66 tests are **mock-based fast tests** — no testcontainers, no Docker, no real DB
- Tests run as part of `pnpm test:fast` suite
- Denormalizer tests mock `callMcpTool`; communication tool tests mock the denormalizer; propagation tests mock each boundary
- The type system (Zod discriminated union shared across all layers) already provides structural guarantees — tests verify wiring/data flow, not type compatibility

### Propagation test structure
- **Separate handoff tests per boundary**, not one monolithic chain test
- Handoff points: adapter→router, router→executor, executor→message builder
- Each test mocks the layer below and asserts replyContext is preserved in the output
- Failure isolation: a failing handoff test tells you exactly which boundary dropped replyContext
- Chain guarantee is structural (if A→B preserves and B→C preserves, A→C preserves) — transitivity doesn't need an end-to-end test
- Many handoff tests likely already exist from Phases 61/62 — audit first

### TEST-04 revision (ask capability asymmetry)
- **CRITICAL:** The ROADMAP success criterion #4 is factually incorrect about the implementation
- ask() renders options as **text instructions uniformly on ALL channels** — no Slack interactive buttons
- `send_approval_request` remains in the Slack integration for the router's legacy use but is NOT part of the communication layer
- This was a deliberate design decision during Phase 63 (not an oversight)
- TEST-04 should be revised to: "Verify that ask() with options renders text-formatted options consistently across all three channels — the denormalizer receives the same pre-rendered text regardless of channel"
- The ROADMAP criterion and REQUIREMENTS TEST-04 entry should be updated to match reality

### Claude's Discretion
- Exact test file organization for any new propagation tests (colocate with existing tests vs new file)
- Whether to add a JSONB round-trip micro-test for replyContext if the concern exists
- How to structure the audit report (inline in plan or separate artifact)

</decisions>

<specifics>
## Specific Ideas

- "Phase 66 is shaping up to be mostly 'audit and confirm existing coverage + write TEST-02 propagation handoff tests for any gaps.' That's a valid outcome for a validation phase."
- Integration MCP tool gaps (GitHub create_pr_comment, Slack tools) should be tracked as a separate todo for a future testing pass — do not lose them, but do not act on them in Phase 66
- Slack/GitHub echo filter gaps tracked as integration test debt — not Phase 66

</specifics>

<deferred>
## Deferred Ideas

- **Integration MCP tool tests** — GitHub `create_pr_comment` and Slack `reply_to_thread`/`send_message` have no MCP-level tests. Track as integration layer test debt.
- **Slack/GitHub echo filter tests** — Only Linear has echo filter tests. Slack uses Bolt's built-in bot_id filtering, GitHub uses sender type check. Track as integration layer test debt.
- **JSONB round-trip test** — if replyContext JSONB storage/retrieval is a concern, a single focused DB test could verify it. Not worth a full integration test setup.

</deferred>

---

*Phase: 66-testing-validation*
*Context gathered: 2026-02-09*
