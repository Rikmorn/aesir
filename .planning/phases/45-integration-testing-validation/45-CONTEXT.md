# Phase 45: Integration Testing + Validation - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate the v2.3 framework works correctly end-to-end. Write automated integration tests (testcontainers + real Postgres) for all 8 spec lifecycle flows at both framework and HTTP layers. Provide a manual E2E validation checklist for real webhook testing. Mark legacy Temporal tests for Phase 47 cleanup. No new capabilities — this phase proves what Phases 37-44 built.

</domain>

<decisions>
## Implementation Decisions

### Automated Integration Tests — Lifecycle Flows (All 8)
- All 8 flows from the spec's Testing Strategy section, with real Postgres via testcontainers
- Tests prove cross-component wiring works (not just individual components with mocks)
- The 8 flows:
  1. Start -> Run -> Complete
  2. Start -> Pause -> Signal -> Resume -> Complete (full pause/resume cycle)
  3. Start -> Pause -> Timeout -> Resume (timeout enforcement wakes paused conversation)
  4. Start -> Pause -> Queue Signal -> Resume (signal arrives before wait_for, gets queued)
  5. Duplicate Start (second start with same conversation ID is idempotent)
  6. Duplicate Signal (second identical signal is no-op)
  7. Sub-agent Spawn (parent spawns child, child completes, parent sees result)
  8. History Compaction (long conversation triggers pruning, agent resumes correctly)

### Automated Integration Tests — Two Test Layers
- **Framework layer**: Call ConversationExecutor.start(), .signal(), .get() programmatically — tests framework wiring without HTTP concerns
- **HTTP layer**: POST to /events with webhook payloads, GET /conversations/:id — tests full stack including Express routing, adapter normalization, event router
- Both layers needed: framework tests validate plumbing, HTTP tests validate surface area

### Manual E2E Validation — Real Webhooks
- Test both dev-agent and product-agent flows with real webhooks (Linear, GitHub, Slack)
- Provide a step-by-step checklist that tells the user exactly what to trigger and what to verify
- Checklist should warn about known limitations at this phase (e.g., Temporal code still on disk, old DB tables still present) so user doesn't chase false problems
- Manual E2E complements automated tests — automated covers repeatable programmatic flows, manual covers real-world webhook delivery and integration behavior

### Legacy Test Handling
- Mark Temporal-specific tests as legacy with skip markers and comments
- Do NOT delete them — Phase 47 deletes Temporal code and its tests together
- Purpose: keep test output clean, make tests easy to find for Phase 47 cleanup
- Tests that cover code still in use (agent-loop, tools, MCP client) stay untouched

### Test Scope — Extend, Delete, Create
- **Extend**: If existing unit tests for framework components need additional scenarios based on integration test findings, extend them
- **Delete**: If tests cover functionality that's been replaced and is no longer reachable (dead code paths), delete them
- **Create**: New integration tests for the 8 lifecycle flows + HTTP layer tests for the service entry point

### Claude's Discretion
- Test file organization and naming conventions
- Mock strategy for LLM calls in integration tests (mock Anthropic SDK responses)
- Testcontainers configuration details (Postgres version, schema setup)
- Specific assertions per test (what DB state, event log entries, session projection records to verify)
- Whether to use a shared test database or isolated per-test databases
- How to simulate the agent loop in integration tests (real runAgentLoop with mocked LLM, or stub the agent loop entirely)

</decisions>

<specifics>
## Specific Ideas

- The test inventory shows framework unit tests are comprehensive (43 files, 8,000+ lines). The gap is cross-component integration and HTTP layer coverage.
- `service/main.ts` (260 lines) has zero test coverage — it wires all components but nobody has tested the bootstrap sequence or route handlers.
- The existing `dev-agent/integration.test.ts` is a placeholder (skipped in CI). It may serve as a starting point or template.
- Temporal is already fully disconnected (no containers, no workers, no env vars, no wiring). The v2.3 executor is the only live path. No dual-mode routing or feature flags needed.
- The research flagged specific high-risk scenarios: "test sending signal 0ms after wait_for" (MAJOR-1), "test killing process mid-loop" (CRITICAL-2). Integration tests should explicitly cover these timing-sensitive cases.
- For manual E2E: user has done end-to-end testing in previous milestones and expects things to work. The checklist should focus on what's different in v2.3 (single service, /events endpoint, conversation management endpoints) and flag anything that's known not to work yet.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 46 may be obsolete**: Temporal is already fully disconnected by Phase 44. Phase 46's core purpose (feature flag cutover + 7-day drain) is already satisfied. Phase 47 handles physical cleanup (delete code, drop tables). Consider skipping or merging Phase 46 when planning reaches it — the roadmap may need restructuring.
- **Full end-to-end regression suite**: Comprehensive E2E testing across all milestones can wait until after all phases are complete. Phase 45 covers v2.3-specific validation only.
- **Performance/stress testing**: Concurrent conversation handling, memory pressure under load, event log throughput — deferred to post-milestone work.
- **CI integration**: Making integration tests run in CI pipeline is deferred to when CI/CD is addressed (currently deferred to v3.0 per roadmap).

</deferred>

---

*Phase: 45-integration-testing-validation*
*Context gathered: 2026-02-03*
