# Phase 73: QA Agent + Validation Workflow - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Define a QA agent (YAML + prompt.md) and wire a triangular product-dev-QA delegation workflow that exercises the entire v2.7 collaboration stack end-to-end. QA agent is a validation vehicle, not a production QA system. One happy-path validation run, observed through the dashboard.

</domain>

<decisions>
## Implementation Decisions

### QA Agent Responsibilities
- Two thin checks only: (1) run test command via `codebase:run_command` — binary exit code pass/fail, (2) read PR diff via GitHub MCP `get_pull_request` and LLM-assess whether it matches the delegation brief
- Requirements source is the delegation brief from `task:delegate` — the task description + expectations. Not the original Linear ticket, not shared memory (though QA can query for supplementary context)
- No coverage thresholds, no regression detection, no code style/lint checking, no security scanning, no structured test report parsing
- Results communicated via both signal AND shared memory: store findings first (`knowledge:store`, type `test_result`), then signal completion/failure. Memory failure is non-fatal (MEM-09)
- Knowledge entries include: test result type, pass/fail, failed test names (not full output), PR/branch reference, brief summary. Expiry follows `test_result` defaults from MEM-07

### QA Agent Scope & Targeting
- QA only accepts verification tasks — capabilities scoped tightly to "verify code changes by running tests and reviewing PR diffs" and "validate implementation against task requirements"
- No artificial "reject if delegator isn't dev-agent" rule — capabilities and prompt guidance naturally route only verification tasks to QA
- No sub-agents — QA does all work in its own loop (2-3 tool calls per invocation). Delegation back to dev-agent uses `task:delegate`, not sub-agent spawn

### Failure-to-Fix Loop
- When QA fails: delegates fix to dev-agent via `task:delegate` with self-contained brief (failed test names + error messages, PR/branch ref, original task description, QA's one-paragraph assessment, relevant knowledge references)
- QA retains ownership: delegates fix, calls `wait_for_task`, resumes on completion signal, re-runs both checks in its own loop
- Fresh delegation for each fix (new conversation, new token budget, clean context). Shared memory bridges implementation context
- Retry limit: delegation depth (DEL-09 max depth 3) naturally caps fix cycles. product(1)→dev(2)→QA(3)→dev-fix(4) uses depth 4. Second fix attempt would hit depth 5 — rejected by framework
- When depth limit prevents further fixes: QA signals failure up to dev-agent with accumulated context (what was tried, remaining failures). Each level manages its own subtree

### E2E Validation Approach
- NOT a Vitest test file — a documented validation procedure with real agents and real LLM calls
- Trigger: `pnpm validate:workflow` script that POSTs a synthetic normalized event to `POST /events` (bypasses Linear, mimics what the adapter would produce)
- Feature request: "Add a /health endpoint that returns { status: 'ok', version: '<package version>' }" — small, predictable, tests can exist
- Script prints root task ID and dashboard URL, optionally polls task tree API for progress. Human takes over from there
- Required services: PostgreSQL + GitHub integration + agent-service (`docker compose up postgresql github-integration agent-service`). Linear/Slack optional — graceful degradation handles absent integrations
- Pass criteria: manual checklist verified through dashboard (Phase 75):
  1. Task tree shows full triangle (product→dev→QA, plus fix subtree if triggered)
  2. Handshakes visible — accept + estimate on each delegation
  3. Signals flow chronologically — delegation created, accepted, completed
  4. Health indicators green (no orphans, no unresolved timeouts)
  5. Knowledge entries exist (`SELECT * FROM agents.knowledge_entries WHERE type = 'test_result'`)
  6. Conversation links show coherent message history

### QA Agent Personality & Model
- Voice: skeptical verifier, not adversarial critic. Evidence over opinion, brief is the contract, binary decisiveness
- Reports observed facts (test output, diff contents), not subjective quality judgments
- Minimal communication — stores findings in knowledge, signals completion/failure. Shortest conversations in the system
- No code suggestions in fix delegation — QA says what's wrong, dev decides how to fix
- Model: Haiku 4.5 — QA's work is thin, tool call sequence is near-deterministic, binary decisions. Cost-efficient
- Same sandbox as dev-agent — `codebase:run_command` targets the same workspace. No separate container

### QA Agent vs Tester Sub-Agent
- Tester sub-agent: internal to dev-agent, spawned within dev-agent's conversation, shared token budget, runs tests during implementation loop ("does my code work before I commit"). Not in directory
- QA agent: independent orchestrator in entity directory, discovered via `directory:find`, delegated to via `task:delegate`, separate conversation and budget, runs tests as independent verification ("does someone else's code work before I accept"). In directory
- Dev-agent uses tester sub-agent for implementation iteration, delegates to QA for independent verification. DEL-07 guidance: "if it's in your subAgents list, spawn. If you need directory:find, delegate"

### Claude's Discretion
- Exact capability strings for QA agent definition.yaml (verification-specific, not vague)
- QA agent prompt structure and exact wording
- Token budget for QA agent conversations
- Validation script implementation details (polling interval, output format)
- How the synthetic event payload is structured to trigger product-agent

</decisions>

<specifics>
## Specific Ideas

- Feature request for validation: "Add a /health endpoint that returns { status: 'ok', version: '<package version>' }" — chosen for predictability and small scope
- QA agent should have the shortest conversations in the system — minimal narration, mostly tool calls and structured signals
- Dashboard is the assertion layer — Phase 75 was built for exactly this observation
- Agents failing on unreachable integrations (Slack/Linear) during validation is actually a good test of graceful degradation

</specifics>

<deferred>
## Deferred Ideas

- Production QA capabilities (coverage analysis, regression detection, continuous monitoring) — PQA-01, PQA-02, PQA-03
- Comprehensive multi-agent test harness — PQA-03 (building test infrastructure for multi-agent scenarios is a milestone)
- Product-agent → QA direct delegation — future scope if broader QA needs emerge
- QA agent re-architecting suggestions when approach is fundamentally wrong — out of scope for validation vehicle

</deferred>

---

*Phase: 73-qa-agent-validation-workflow*
*Context gathered: 2026-02-11*
