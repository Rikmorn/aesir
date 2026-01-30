# Phase 36: End-to-End Validation - Research

**Researched:** 2026-01-30
**Domain:** End-to-end validation of v2.2 agentic architecture -- verification-only, no new features
**Confidence:** HIGH

## Summary

Phase 36 is a **validation-only** phase. All implementation work (Phases 28-35) is complete. The 11 E2EV requirements demand proving the system works end-to-end, from Slack message through to approved PR, with intelligent agent behavior at every step.

This research identifies what needs to be validated, how to validate it (code inspection, automated tests, manual verification, or infrastructure-dependent testing), and what the current test/build state looks like. The key finding is that validation falls into three categories:

1. **Static verification** (code inspection): E2EV-06, E2EV-08, E2EV-09, E2EV-10, E2EV-11 can be verified by reading code, running existing tests, and querying database schemas.
2. **Automated test verification**: E2EV-02, E2EV-04, E2EV-05 can be verified by writing targeted behavioral tests that mock the Anthropic SDK and exercise agent logic.
3. **Infrastructure-dependent verification**: E2EV-01, E2EV-03, E2EV-07 require running Docker Compose with real/mocked services.

**Primary recommendation:** Start with static verification (cheapest, fastest), then write behavioral tests for agent reasoning, then validate infrastructure-dependent flows. Fix the pre-existing test build failures first so all validation runs cleanly.

## Current State Assessment

### Test Infrastructure State
**Confidence: HIGH** (directly observed by running tests)

The test suite has two categories of failures:

1. **Package resolution failures (19 test files):** Vitest cannot resolve `@aesir/types` and `@aesir/platform` packages because workspace dependencies need to be built first (`pnpm build` must run base packages). This is a build order issue, not a code issue.

2. **Pre-existing assertion failures (5 tests in 1 file):** `platform/src/temporal/client.test.ts` has 5 failing assertions related to legacy exports. These are documented in STATE.md as pending todos.

**When base packages are built:** The 14 test files in `packages/agents` that can resolve their imports all pass (313 tests pass, 11 skipped, 8 todo).

### Build State
**Confidence: HIGH** (directly observed)

- `@aesir/types` builds successfully
- `@aesir/platform` builds successfully
- Integration packages (`github`, `linear`, `slack`) have pre-existing TypeScript errors unrelated to v2.2 work
- `@aesir/agents` builds successfully when base packages are built

### Dependency State
**Confidence: HIGH** (grep verified)

Zero `@langchain/*` imports exist anywhere in `packages/agents/`. The package.json has no `@langchain/*` dependencies. E2EV-11 is already verifiable as PASS.

## Validation Strategy

### Verification Categories

Each E2EV requirement maps to a verification approach:

| Requirement | Description | Verification Type | Evidence Needed |
|-------------|-------------|-------------------|-----------------|
| E2EV-01 | Full flow: Slack -> product agent -> Linear -> dev agent -> PR | Infrastructure + Manual | Docker Compose running, real API calls or comprehensive mocks |
| E2EV-02 | README edit < 10 tool calls, no tests, no research | Behavioral Test | Mock SDK, count tool calls, verify no test/research calls |
| E2EV-03 | Simple feature: implement, test, correct pkg mgr, PR | Infrastructure + Manual | Docker running, real container, real LLM calls |
| E2EV-04 | Test failure recovery: diagnose, not blind retry | Behavioral Test + Code Inspection | Mock SDK with failure scenario, verify different approaches |
| E2EV-05 | Product agent adapts: clear -> quick, vague -> questions | Behavioral Test | Mock SDK, test both clear and vague inputs |
| E2EV-06 | Smart router handles all event types | Code Inspection + Existing Tests | 9 deterministic rules, router test files cover all |
| E2EV-07 | Context survives Temporal boundaries | Code Inspection + Test | Context manager writes/reads verified, activity wiring inspected |
| E2EV-08 | Sub-agents get focused context | Code Inspection | Toolkit separation verified, system prompts inspected |
| E2EV-09 | All tool calls queryable in execution_traces | Code Inspection + DB Schema | Schema has parent/child correlation, trace recorder verified |
| E2EV-10 | Guardrails enforced: limits, sandbox, cost | Code Inspection (Phase 35 verified) | Already verified in Phase 35, cross-reference here |
| E2EV-11 | No @langchain/* dependencies | Static Check | grep and package.json inspection |

### Prerequisite: Fix Test Infrastructure

Before any validation, the test environment must be clean:

1. **Build base packages** before running tests: `pnpm --filter @aesir/types build && pnpm --filter @aesir/platform build`
2. **Fix or document the 5 pre-existing platform test failures** (temporal/client.test.ts)
3. **Ensure `pnpm test:fast` passes** for all files that can resolve dependencies

## Architecture Patterns

### Pattern 1: Behavioral Testing via SDK Mocking

For E2EV-02, E2EV-04, E2EV-05, the validation approach is to write behavioral tests that mock the Anthropic SDK at the boundary and verify agent reasoning behavior.

**What:** Create test scenarios that exercise `runAgentLoop()` with mocked `Anthropic.messages.create()` returning scripted tool_use responses. Count tool calls, verify tool selection, and check output.

**When to use:** Validating agent reasoning behavior without real LLM calls (deterministic, fast, free).

**Example pattern (from existing orchestrator.test.ts):**
```typescript
// The codebase already uses SDK-level mocking
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

// Script a sequence of LLM responses
mockCreate
  .mockResolvedValueOnce(/* first response: tool_use for linear_get_issue */)
  .mockResolvedValueOnce(/* second response: tool_use for read_file */)
  .mockResolvedValueOnce(/* third response: end_turn with text */);
```

**Key insight:** The orchestrator prompt's 3-tier complexity model (simple/moderate/complex) defines expected behavior. Tests should verify the simple path (E2EV-02) uses fewer tools and skips research.

### Pattern 2: Code Inspection Verification

For E2EV-06 through E2EV-11, verification is primarily code inspection with documentation of evidence.

**What:** Systematically inspect source code, database schemas, and test files to verify requirements are met. Document with file paths, line numbers, and code snippets.

**When to use:** Requirements that describe structural properties (tool availability, schema fields, dependency absence) rather than runtime behavior.

**Evidence format** (established in Phase 35 VERIFICATION.md):
```markdown
#### N. [Requirement Name]
**Status:** PASS
**Evidence:**
- [File path]: [What it shows]
- [grep result]: [What it proves]
- [Test output]: [What it demonstrates]
```

### Pattern 3: Infrastructure-Dependent Validation

For E2EV-01 and E2EV-03, full validation requires running infrastructure.

**What:** Start Docker Compose, run migrations, seed permissions, then trigger real workflows.

**Prerequisites:**
- Docker Compose running (PostgreSQL, Temporal, all services)
- Database migrations applied (`pnpm db:migrate`)
- MCP permissions seeded
- Real Anthropic API key configured
- Real or mocked Linear/GitHub/Slack tokens

**Limitation:** These tests cost real money (LLM API calls) and require external service credentials. They cannot be automated as part of the standard test suite.

**Recommended approach:** Document these as manual verification scenarios with step-by-step runbooks. The existing `e2e-verification/e2e-UAT.md` established this pattern (12 scenarios tested manually in v2.1).

### Anti-Patterns to Avoid

- **Trying to write automated E2E tests that call real LLM APIs:** These are expensive, non-deterministic, and slow. Use behavioral tests with mocked SDK instead.
- **Conflating "validation" with "new test coverage":** Phase 36 is about PROVING the system works, not about increasing test coverage percentages. Some proofs are code inspection, some are tests, some are manual verification.
- **Treating infrastructure-dependent requirements as blocked:** Even without full Docker Compose running, the code can be verified structurally and key integration points tested with mocks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| E2E test framework | Custom E2E harness | Manual verification runbook + behavioral unit tests | Full E2E needs real infrastructure and LLM; behavioral tests cover reasoning logic |
| SDK mocking pattern | New mock infrastructure | Existing vi.mock pattern from orchestrator.test.ts | Already proven in Phases 31-34 tests |
| Verification report format | New format | Phase 35's VERIFICATION.md format | Already established, planner knows how to use it |
| Test runner | Custom test orchestrator | `pnpm test:fast` (existing) | Already configured, workspace-aware |

## Common Pitfalls

### Pitfall 1: Running Validation Without Building Base Packages
**What goes wrong:** 19 test files fail with "Failed to resolve entry for package" errors.
**Why it happens:** Vitest resolves workspace dependencies via `dist/` output, which does not exist until packages are built.
**How to avoid:** Always run `pnpm --filter @aesir/types build && pnpm --filter @aesir/platform build` before running tests.
**Warning signs:** "Failed to resolve entry for package @aesir/types" in test output.

### Pitfall 2: Confusing Pre-Existing Failures with Validation Failures
**What goes wrong:** The 5 failing tests in `platform/temporal/client.test.ts` are flagged as validation failures.
**Why it happens:** These failures exist before Phase 36 work starts. They are legacy exports that were never updated.
**How to avoid:** Document the pre-existing state before starting validation. Only NEW failures count against E2EV requirements.
**Warning signs:** Failures in files outside `packages/agents/`.

### Pitfall 3: Trying to Test LLM Reasoning Deterministically
**What goes wrong:** Writing tests that assert exact tool call sequences from the LLM, which break when prompt wording changes.
**Why it happens:** LLMs are non-deterministic. The same prompt can produce different tool call orders.
**How to avoid:** Test behavioral properties, not exact sequences. E.g., for E2EV-02: assert tool call count < 10 and assert no test execution tools called. Do NOT assert the exact sequence of tools.
**Warning signs:** Tests that mock `messages.create` with a single fixed sequence and assert exact call order.

### Pitfall 4: Missing Concurrent Agent Context for Cost Tracking
**What goes wrong:** Cost tracking tests only check orchestrator tokens, missing sub-agent tokens.
**Why it happens:** `getTaskTokenUsage()` aggregates by `task_id`, but if sub-agent traces use different task_id values, they are missed.
**How to avoid:** Verify that all trace recorder instances (orchestrator AND sub-agents) use the same `taskId`. Check the `createTraceRecorder` call in `orchestrator.ts` and the sub-agent spawn path in `spawn-agent.ts`.
**Warning signs:** Token totals that seem low (only orchestrator tokens, not including sub-agent work).

### Pitfall 5: Assuming E2EV-07 Can Be Tested Without Temporal
**What goes wrong:** Trying to write a unit test for "context survives Temporal boundaries" without actual Temporal workflow execution.
**Why it happens:** Context persistence is a Temporal activity boundary concern -- the context manager writes at activity end and reads at activity start.
**How to avoid:** Split verification into: (1) unit test that context manager read/write works, (2) code inspection that activities write snapshots, (3) code inspection that post-approval reads prior snapshot. Full Temporal integration test is optional (infrastructure-dependent).

## Requirements Mapping to Verification Plans

### E2EV-01: Full Flow (Slack -> product agent -> Linear -> dev agent -> PR)
**Type:** Infrastructure-dependent / Manual
**Verify by:**
1. Document the event flow through code: Slack event -> router fast-path / slow-path -> Temporal workflow start -> activity execution
2. Verify each handoff point exists in code (event handlers, router rules, workflow definitions)
3. If Docker Compose available: manual walkthrough
**Key files:**
- `router/fast-path.ts` (linear-agent-session-created rule)
- `shared/temporal/workflows/orchestrator-workflow.ts` (full workflow)
- `product-agent/orchestrator/orchestrator.ts` (product agent entry)
- `docker-compose.yml` (service wiring)

### E2EV-02: README Edit Efficiency (< 10 tool calls)
**Type:** Behavioral test + Code inspection
**Verify by:**
1. Inspect orchestrator system prompt's "SIMPLE TASKS" section -- confirms README edits should skip research
2. Write behavioral test: mock SDK to simulate a README edit scenario, verify tool_call_count < 10 and no test tools called
**Key files:**
- `dev-agent/orchestrator/system-prompts.ts` (SIMPLE TASKS guidance)
- `dev-agent/orchestrator/orchestrator.ts` (entry point)
- `shared/agent-loop/run-agent-loop.ts` (loop mechanics)

### E2EV-03: Simple Feature Implementation
**Type:** Infrastructure-dependent + Code inspection
**Verify by:**
1. Verify orchestrator system prompt includes package manager awareness (pnpm)
2. Verify coder sub-agent has write_file and run_command tools
3. Verify tester sub-agent has run_command tool
4. If Docker available: manual test with simple feature task

### E2EV-04: Test Failure Recovery (Intelligent, Not Blind Retry)
**Type:** Code inspection + Behavioral test
**Verify by:**
1. Inspect error_recovery section of ORCHESTRATOR_SYSTEM_PROMPT -- 4-step diagnostic process, 5 error categories, 3-attempt escalation
2. Inspect TESTER_SYSTEM_PROMPT -- 5 diagnosis categories (CODE BUG, TEST BUG, TYPE ERROR, MISSING DEPENDENCY, ENVIRONMENT ISSUE)
3. Write behavioral test: mock SDK with test failure -> verify agent reads error, spawns different approach
**Key files:**
- `dev-agent/orchestrator/system-prompts.ts` (error_recovery, tester prompt)
- `shared/tools/coordination/spawn-agent.ts` (sub-agent spawning)

### E2EV-05: Product Agent Adaptiveness
**Type:** Code inspection + Behavioral test
**Verify by:**
1. Inspect PRODUCT_AGENT_SYSTEM_PROMPT for adaptive behavior guidance
2. Verify maxIterations=10 for product agent (quick turnaround)
3. Write behavioral test: (a) clear request -> assert issue created in 1-2 tool calls, (b) vague request -> assert send_message with questions
**Key files:**
- `product-agent/orchestrator/system-prompts.ts` (conversation rules, behavior)
- `product-agent/orchestrator/orchestrator.ts` (maxIterations=10)

### E2EV-06: Smart Router Handles All Event Types
**Type:** Code inspection + Existing tests
**Verify by:**
1. Enumerate all 9 deterministic rules in `fast-path.ts`
2. Verify slow-path covers: `slack.app_mention.created`, `linear.comment.created`, `slack.message.created` (threads)
3. Run existing router tests: `fast-path.test.ts`, `slow-path.test.ts`, `router.test.ts`
4. Cross-reference against v2.1 event types
**Key files:**
- `router/fast-path.ts` (9 rules: 7 actionable + 2 ignore)
- `router/slow-path.ts` (LLM reasoning for ambiguous events)
- `router/fast-path.test.ts`, `router/router.test.ts`, `router/slow-path.test.ts`

### E2EV-07: Context Survives Temporal Boundaries
**Type:** Code inspection + Unit test
**Verify by:**
1. Verify `orchestrator-activities.ts` calls `contextManager.writeSnapshot()` at end of each activity
2. Verify post-approval activity reads prior snapshot via `contextManager.readLatestSnapshot()`
3. Verify snapshot contains semantic fields: summary, completed_actions, pending_intent, key_files, research_findings, plan
4. Run `context-manager.test.ts` to verify read/write mechanics
**Key files:**
- `shared/temporal/activities/orchestrator-activities.ts` (write at activity end)
- `shared/db/context-manager.ts` (read/write implementation)
- `shared/db/schema.ts` (context_snapshots table schema)

### E2EV-08: Sub-Agents Get Focused Context
**Type:** Code inspection
**Verify by:**
1. Verify toolkit separation in `toolkits.ts`: researcher (4 tools), coder (4 tools), tester (3 tools), orchestrator (13 tools)
2. Verify sub-agent system prompts are focused: researcher is read-only, coder is implementation, tester is diagnosis
3. Verify spawn_agent passes only the task brief (not full orchestrator history) -- `spawn-agent.ts` creates a fresh `runAgentLoop` call with only the brief as initialMessage
**Key files:**
- `shared/tools/toolkits.ts` (per-role tool sets)
- `dev-agent/orchestrator/system-prompts.ts` (4 prompts: orchestrator, researcher, coder, tester)
- `shared/tools/coordination/spawn-agent.ts` (spawn creates fresh context)

### E2EV-09: All Tool Calls Queryable in execution_traces
**Type:** Code inspection + DB schema verification
**Verify by:**
1. Verify schema has `agent_instance_id` and `parent_agent_instance_id` columns for parent/child correlation
2. Verify trace recorder's `onToolCall` callback is wired in `orchestrator.ts`
3. Verify trace recorder's `onResponse` callback is wired in `orchestrator.ts`
4. Verify sub-agent traces inherit `taskId` but get their own `agentInstanceId`
5. Run `trace-recorder.test.ts` to verify persistence mechanics
**Key files:**
- `shared/db/schema.ts` (execution_traces table with parent/child columns)
- `shared/db/trace-recorder.ts` (onToolCall, onResponse callbacks)
- `dev-agent/orchestrator/orchestrator.ts` (wiring)

### E2EV-10: Guardrails Enforced
**Type:** Cross-reference Phase 35 VERIFICATION.md
**Verify by:**
1. Phase 35 VERIFICATION.md already verified all 9 GUAR requirements as PASS
2. Cross-reference: sandbox enforcement (GUAR-01), merge protection (GUAR-02), configurable limits (GUAR-03), retry config (GUAR-04), budget enforcement (GUAR-05), cost tracking (GUAR-06)
3. Run existing guardrail tests: `token-budget.test.ts`, `agent-config.test.ts`
**Key files:**
- `.planning/phases/35-guardrails-cleanup/35-VERIFICATION.md` (complete evidence)
- `shared/agent-loop/token-budget.ts` (budget enforcement)
- `shared/config/agent-config.test.ts` (config tests)

### E2EV-11: No @langchain/* Dependencies
**Type:** Static check
**Verify by:**
1. `grep -r "@langchain" packages/agents/` returns zero results
2. `packages/agents/package.json` has no `@langchain/*` entries
3. Phase 35 VERIFICATION.md already verified this as PASS (GUAR-07)
**Evidence:** Already collected during this research. Zero matches found.

## State of the Art

| Old Approach (v2.1) | Current Approach (v2.2) | What Changed | Impact on Validation |
|----------------------|-------------------------|--------------|---------------------|
| LangGraph state machine | `runAgentLoop()` tool-use loop | Phase 28 | Agent behavior is prompt-driven, not graph-driven. Test reasoning via prompts. |
| Fixed 13-node graph | Orchestrator + sub-agents | Phase 31 | Complexity is in prompts and tool selection. Validate via toolkit inspection. |
| PostgresSaver checkpoints | `agents.context_snapshots` | Phase 29 | Context is semantic (LLM summaries), not mechanical (state serialization). |
| Hardcoded event routing | Smart router (rules + LLM) | Phase 34 | 9 deterministic rules cover unambiguous events. LLM handles the rest. |
| `@langchain/anthropic` | `@anthropic-ai/sdk` | Phase 28 | SDK mocking is simpler (single `messages.create` method). |

## Open Questions

1. **Docker Compose availability for E2EV-01 and E2EV-03:**
   - What we know: Docker Compose config exists and is well-defined. All services have health checks.
   - What is unclear: Whether the current environment has all required API keys (ANTHROPIC_API_KEY, Linear/GitHub/Slack tokens) for manual E2E testing.
   - Recommendation: Validate structurally first (code inspection). Document manual test runbook for when infrastructure is available. Do not block on infrastructure availability.

2. **Pre-existing test failures baseline:**
   - What we know: 5 tests fail in `platform/temporal/client.test.ts`, 19 test files have resolution errors (need build), 11 tests are skipped.
   - What is unclear: Whether the 5 platform test failures should be fixed in Phase 36 or deferred.
   - Recommendation: Fix the build order issue (prerequisite). Document the 5 platform failures as pre-existing. Do not count them against E2EV validation.

3. **Behavioral test depth for E2EV-02, E2EV-04, E2EV-05:**
   - What we know: The existing test pattern (mock SDK at module level, script responses) works well.
   - What is unclear: How many test scenarios are sufficient to "prove" agent reasoning is intelligent.
   - Recommendation: One scenario per requirement is sufficient for validation. This is not a comprehensive test suite -- it is proof of capability.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all files referenced above
- Direct test execution (`pnpm test:fast` and `npx vitest run packages/agents`)
- Phase 35 VERIFICATION.md (verified 2026-01-30)
- Phase 35 RESEARCH.md (comprehensive technical analysis)
- STATE.md (current project state)
- REQUIREMENTS.md (all 78 requirements with traceability)

### Secondary (MEDIUM confidence)
- `e2e-verification/e2e-UAT.md` (v2.1 manual testing precedent)
- `docker-compose.yml` (infrastructure configuration)
- `2.2-spec.md` (architectural intent and target experience)

## Metadata

**Confidence breakdown:**
- Validation strategy: HIGH - directly informed by codebase inspection and existing test patterns
- Requirements mapping: HIGH - each requirement mapped to specific files and verification approach
- Pitfalls: HIGH - observed directly from running tests and inspecting code
- Infrastructure assessment: MEDIUM - Docker Compose config inspected but not run during research

**Research date:** 2026-01-30
**Valid until:** Indefinite (this research is about validating existing code, not tracking evolving libraries)
