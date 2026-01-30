---
phase: 31-dev-agent-orchestrator
verified: 2026-01-30T13:10:08Z
status: gaps_found
score: 3/5 must-haves verified
gaps:
  - truth: "The orchestrator agentic loop replaces the 13-node LangGraph graph -- no routeByPhase() or fixed phase enums drive control flow"
    status: partial
    reason: "Orchestrator module exists as complete replacement architecture but is NOT wired into production execution path yet. The old LangGraph workflow (dev-agent/workflow/graph.ts with routeByPhase) still exists and is still exported from dev-agent/index.ts. Phase 32 will wire orchestrator into Temporal activities."
    artifacts:
      - path: "packages/agents/src/dev-agent/orchestrator/orchestrator.ts"
        issue: "Module exists and is functional but not used by Temporal activities"
      - path: "packages/agents/src/dev-agent/workflow/graph.ts"
        issue: "Old 13-node graph still exists and is production code path"
    missing:
      - "Temporal activities using runDevAgentOrchestrator (deferred to Phase 32)"
      - "Old LangGraph workflow removal (deferred to Phase 35 per ROADMAP)"
  - truth: "When tests fail, the agent reads error output, diagnoses the cause, and tries a different approach -- not identical retries"
    status: uncertain
    reason: "System prompt includes error recovery guidance instructing the orchestrator to 'TRY A DIFFERENT APPROACH' and 'Do NOT retry the same thing.' Behavioral tests mock LLM responses that demonstrate distinct approaches. However, there is NO PROOF the prompt is good enough to make Claude actually reason this way in practice. Tests prove the orchestrator CAN adapt IF Claude follows instructions, not that Claude WILL follow them."
    artifacts:
      - path: "packages/agents/src/dev-agent/orchestrator/system-prompts.ts"
        issue: "Prompt guidance exists but effectiveness unproven"
      - path: "packages/agents/src/dev-agent/orchestrator/orchestrator.test.ts"
        issue: "Tests mock ideal LLM behavior, don't validate actual LLM reasoning"
    missing:
      - "Real-world validation that Claude follows error recovery guidance (deferred to Phase 36 E2E validation)"
      - "Prompt iteration based on actual LLM behavior in production"
---

# Phase 31: Dev Agent Orchestrator Verification Report

**Phase Goal:** The dev agent reasons about tasks using sub-agents instead of following a fixed 13-node graph -- it decides what to research, how detailed to plan, whether to test, and how to recover from errors

**Verified:** 2026-01-30T13:10:08Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The orchestrator agentic loop replaces the 13-node LangGraph graph -- no routeByPhase() or fixed phase enums drive control flow | ⚠️ PARTIAL | Orchestrator module exists with runDevAgentOrchestrator() entry point that calls runAgentLoop() with ORCHESTRATOR_SYSTEM_PROMPT and 14-tool toolkit. However, old LangGraph workflow still exists at dev-agent/workflow/graph.ts with routeByPhase() still exported. Phase 32 will wire orchestrator into Temporal; Phase 35 will remove old code. |
| 2 | Sub-agents (researcher, coder, tester) are spawned with isolated context: the coder gets the plan and relevant files but not research history | ✓ VERIFIED | System prompt section <sub_agent_delegation> instructs: "Sub-agents have their own fresh context windows. They cannot see your conversation history. Include everything they need in the brief." Tests verify spawn_agent tool calls with focused task parameters. |
| 3 | The orchestrator adapts to task complexity: a README edit skips research and detailed planning, while a feature implementation spawns researcher, plans in detail, spawns coder, then tester | ✓ VERIFIED | System prompt defines 3-tier complexity model (SIMPLE/MODERATE/COMPLEX) with different workflows. Test "skips researcher for simple task" verifies spawn_agent(coder) without spawn_agent(researcher). Test "spawns researcher before coder for complex task" verifies researcher->coder->tester sequence. |
| 4 | When tests fail, the agent reads error output, diagnoses the cause, and tries a different approach -- not identical retries. After 3 distinct failed approaches, it escalates | ? UNCERTAIN | System prompt <error_recovery> section instructs: "TRY A DIFFERENT APPROACH: Do NOT retry the same thing" and "After 3 distinct failed approaches...escalate to a human via request_human_input." Tests mock LLM responses that demonstrate distinct approaches (session auth fails -> JWT auth succeeds). However, tests prove orchestrator CAN adapt IF Claude follows prompt, not that Claude WILL follow it in practice. No real-world validation. |
| 5 | System prompt includes agent identity, issue details, project conventions, constraints, available tools, and sub-agent guidance | ✓ VERIFIED | ORCHESTRATOR_SYSTEM_PROMPT has 6 XML sections: <identity>, <constraints>, <workflow_guidance>, <sub_agent_delegation>, <error_recovery>, <available_tools>. Total 2727 words across all 4 prompts. All sections present with appropriate content. |

**Score:** 3/5 truths fully verified, 1 partial, 1 uncertain

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| packages/agents/src/dev-agent/orchestrator/system-prompts.ts | 4 static system prompts (orchestrator, researcher, coder, tester) | ✓ VERIFIED | All 4 prompts exported. Orchestrator ~1300 words with 6 XML sections. Sub-agents ~300-400 words each with 4 sections. No template interpolation. |
| packages/agents/src/dev-agent/orchestrator/orchestrator.ts | runDevAgentOrchestrator() entry point function | ✓ VERIFIED | 183 lines. Creates token budget (default 500k), trace recorder, toolkit (14 tools), calls runAgentLoop with ORCHESTRATOR_SYSTEM_PROMPT. Returns AgentLoopResult. |
| packages/agents/src/dev-agent/orchestrator/index.ts | Barrel export for orchestrator module | ✓ VERIFIED | Exports runDevAgentOrchestrator, OrchestratorOptions, and all 4 system prompts |
| packages/agents/src/shared/tools/toolkits.ts | Updated toolkits importing production prompts from system-prompts.ts | ✓ VERIFIED | Imports RESEARCHER_SYSTEM_PROMPT, CODER_SYSTEM_PROMPT, TESTER_SYSTEM_PROMPT from ../../dev-agent/orchestrator/system-prompts.js. Placeholder prompts removed. 112 existing toolkit tests pass. |
| packages/agents/src/dev-agent/orchestrator/orchestrator.test.ts | Behavioral tests proving adaptive orchestrator decisions | ✓ VERIFIED | 765 lines, 14 test cases covering DEVO-01, DEVO-02, DEVO-09, DEVO-10, DEVO-11, DEVO-12, DEVO-13. All tests pass. Mocks Anthropic SDK to verify tool call sequences. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| orchestrator.ts | runAgentLoop | import and call | ✓ WIRED | Line 176: `const result = await runAgentLoop(loopOptions)` |
| orchestrator.ts | createOrchestratorToolkit | import and call | ✓ WIRED | Line 144: `const tools = createOrchestratorToolkit(toolkitDeps)` |
| toolkits.ts | system-prompts.ts | import sub-agent prompts | ✓ WIRED | Line 26: imports RESEARCHER, CODER, TESTER prompts from dev-agent/orchestrator |
| orchestrator.ts | createTraceRecorder | import and call | ✓ WIRED | Lines 120-127: creates trace recorder with onToolCall/onResponse callbacks passed to runAgentLoop |

### Requirements Coverage

Phase 31 mapped requirements from REQUIREMENTS.md:

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| DEVO-01: Orchestrator replaces 13-node graph and routeByPhase() | ⚠️ PARTIAL | Architecture exists but not wired into production (Phase 32). Old graph still exists (Phase 35 removal). |
| DEVO-02: Spawns focused sub-agents with isolated context | ✓ SATISFIED | System prompt instructs isolated context. Tests verify spawn_agent tool usage. |
| DEVO-03: Researcher sub-agent explores with read-only tools | ✓ SATISFIED | RESEARCHER_SYSTEM_PROMPT defines read-only exploration approach with structured output format. |
| DEVO-04: Coder sub-agent implements with read+write tools | ✓ SATISFIED | CODER_SYSTEM_PROMPT defines implementation approach following existing patterns. |
| DEVO-05: Tester sub-agent runs/diagnoses tests with read+run tools | ✓ SATISFIED | TESTER_SYSTEM_PROMPT defines test execution and 5-category diagnosis framework. |
| DEVO-09: Orchestrator decides research need based on complexity | ✓ SATISFIED | System prompt defines simple/moderate/complex tiers. Test verifies simple task skips researcher. |
| DEVO-10: Orchestrator decides plan granularity | ✓ SATISFIED | System prompt instructs: "trivial change -> brief plan, complex -> detailed breakdown" |
| DEVO-11: LLM-diagnosed error recovery with different approaches | ? NEEDS VALIDATION | Prompt guidance exists. Tests mock ideal behavior. No real-world validation that Claude follows it. |
| DEVO-12: Orchestrator decides test approach based on task | ✓ SATISFIED | System prompt includes test decision guidance in workflow_guidance section. |
| DEVO-13: Escalation after 3 distinct approaches fail | ? NEEDS VALIDATION | Prompt instructs "After 3 distinct failed approaches...escalate to human." Test mocks this behavior. No real validation. |
| DEVO-14: System prompt includes identity, constraints, tools, guidance | ✓ SATISFIED | All 6 required XML sections present with appropriate content. |

**Requirements Status:** 8/11 satisfied, 1 partial (DEVO-01), 2 need validation (DEVO-11, DEVO-13)

### Anti-Patterns Found

None detected. Code quality checks:

- ✓ TypeScript compilation: Clean (`npx tsc --noEmit` passes)
- ✓ All tests pass: 14/14 orchestrator tests + 112 toolkit tests
- ✓ No stub patterns: grep for TODO/FIXME/placeholder found none in orchestrator module
- ✓ No console.log only implementations
- ✓ Proper exports and wiring verified

### Human Verification Required

#### 1. Prompt Effectiveness - Adaptive Complexity Assessment

**Test:** Create 3 Linear issues: (1) "Fix typo in README.md: change 'recieve' to 'receive'", (2) "Add a validateEmail() function to src/utils/validation.ts following the pattern of validatePhone()", (3) "Implement OAuth2 authentication flow with JWT tokens and refresh token rotation"

Run `runDevAgentOrchestrator()` for each issue in a test environment with real Anthropic API calls (not mocks).

**Expected:**
- Issue 1: Orchestrator calls linear_get_issue, reads README.md, spawns coder directly (no researcher)
- Issue 2: Orchestrator spawns researcher to find validatePhone pattern, then spawns coder with research findings
- Issue 3: Orchestrator spawns researcher for thorough exploration, creates detailed plan, spawns coder, spawns tester

**Why human:** Tests mock ideal LLM behavior. Need to validate Claude actually follows the 3-tier complexity guidance when given real issues with no pre-scripted responses.

#### 2. Prompt Effectiveness - Error Recovery with Different Approaches

**Test:** Set up a scenario where tests fail due to wrong approach (e.g., using sessions in edge runtime where they're not supported). Let orchestrator attempt recovery.

**Expected:**
- First failure: Orchestrator reads error output, diagnoses "sessions not supported in edge runtime"
- Second attempt: Uses DIFFERENT approach (JWT tokens instead of sessions)
- If that fails with a different error: Third attempt uses yet another distinct approach
- After 3 distinct failures: Calls request_human_input with summary of approaches tried

**Why human:** Tests mock the LLM returning different approaches. Need to validate Claude actually diagnoses errors, reasons about root causes, and chooses genuinely different strategies -- not just retrying the same thing with minor variations.

#### 3. Sub-Agent Context Isolation

**Test:** Spawn researcher to explore auth patterns. After researcher completes, spawn coder to implement auth. Inspect the actual spawn_agent tool calls made by the orchestrator.

**Expected:**
- Researcher spawn_agent call includes: task description, expected output format
- Researcher spawn_agent call does NOT include: previous conversation history, unrelated research findings
- Coder spawn_agent call includes: plan, relevant files from research, patterns to follow
- Coder spawn_agent call does NOT include: full research conversation, researcher's exploration process

**Why human:** Tests verify spawn_agent is called but don't validate the QUALITY of briefs. Need to verify orchestrator includes "everything the sub-agent needs" without including irrelevant history.

### Gaps Summary

**Gap 1: Orchestrator not wired into production execution path**

The orchestrator module is complete and functional as a standalone reasoning engine. However:
- Temporal activities still call the old LangGraph workflow (dev-agent/workflow/graph.ts)
- Old workflow with routeByPhase() and 13 nodes still exists and is exported
- runDevAgentOrchestrator() has no callers outside of tests

This is BY DESIGN per 31-CONTEXT.md line 9: "Temporal integration is Phase 32 -- this phase builds the reasoning engine standalone."

**Resolution:** Phase 32 will create new Temporal activities (runOrchestratorPreApproval, runOrchestratorPostApproval, handleOrchestratorFeedback) that call runDevAgentOrchestrator(). Phase 35 will remove the old LangGraph code.

**Gap 2: No validation that prompts are effective in practice**

System prompts include comprehensive guidance for:
- Adaptive complexity assessment (simple/moderate/complex workflows)
- Error recovery with different approaches ("Do NOT retry the same thing")
- Escalation after 3 distinct failures
- Sub-agent context isolation

Behavioral tests prove the orchestrator CAN follow this guidance IF Claude generates the expected tool calls. Tests do NOT prove Claude WILL follow it when given real issues and real LLM reasoning.

**Resolution:** Phase 36 (End-to-End Validation) will test the full system with real Anthropic API calls. If prompts are ineffective, Phase 36 will iterate on prompt content based on observed LLM behavior.

**Alternative:** Run manual validation tests (see Human Verification Required section) before proceeding to Phase 32. This would de-risk Phase 32 implementation by proving the prompts work. However, this adds friction to the roadmap flow. Recommend proceeding to Phase 32 and validating in Phase 36 as planned.

---

_Verified: 2026-01-30T13:10:08Z_
_Verifier: Claude (gsd-verifier)_
