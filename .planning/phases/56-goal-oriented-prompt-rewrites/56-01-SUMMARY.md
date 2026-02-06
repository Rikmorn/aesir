---
phase: 56-goal-oriented-prompt-rewrites
plan: "01"
name: Product-Agent Prompt Rewrite
subsystem: agents
tags: [prompt-engineering, constitutional-constraints, few-shot, product-agent]

dependency-graph:
  requires: []
  provides:
    - "Rewritten product-agent prompt in constitutional + few-shot style"
    - "Traceability matrix mapping 79 old procedural rules to new coverage"
  affects:
    - "Phase 59 (Prompt Evolution) may add task lifecycle content to this prompt"

tech-stack:
  added: []
  patterns:
    - "Constitutional constraint authoring (negative boundaries)"
    - "Few-shot with reasoning (input -> reasoning -> action)"
    - "Selective chain-of-thought (<reasoning> blocks)"
    - "Constraint priority ordering (safety > correctness > efficiency)"
    - "Extended prompt structure: identity -> constraints -> domain knowledge -> examples -> tools -> context"

file-tracking:
  key-files:
    created:
      - ".planning/phases/56-goal-oriented-prompt-rewrites/traceability-product-agent.md"
    modified:
      - "packages/agents/definitions/product-agent/prompt.md"

decisions:
  - id: PROMPT-STRUCT-EXTEND
    decision: "Extended PROMPT_GUIDE.md structure with domain_knowledge section between constraints and examples"
    rationale: "Issue quality criteria are reference material, not constraints or examples. They need their own slot."
  - id: PHASE-TAG-SIMPLIFY
    decision: "Phase tags simplified to one sentence in identity as observability convention"
    rationale: "Research confirmed framework does NOT parse phase tags. Reduced from 15+ references to 1 sentence."
  - id: CONSTRAINT-COUNT
    decision: "6 constitutional constraints, zero MUST/ALWAYS/NEVER/CRITICAL directives"
    rationale: "Constitutional negatives (sentence case 'Never') replace directive stacking. Each constraint prevents a specific real failure."
  - id: DROP-MODEL-NATIVE
    decision: "Dropped 27 rules as model-native per PROMPT_GUIDE.md Rule 7 and user decision"
    rationale: "Cancellation phrase lists, intent detection encoding, conversation etiquette rules, phase tag procedures, error classification gates -- all encoding work the model does natively."

metrics:
  duration: "4m 7s"
  completed: "2026-02-06"
---

# Phase 56 Plan 01: Product-Agent Prompt Rewrite Summary

Rewrote product-agent prompt from procedural state machine (6 if/then branches, ~50 prescriptive steps, 79 imperative statements) to constitutional + few-shot style with 6 constraints and 5 reasoning examples, using extended prompt structure with domain knowledge section.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Build product-agent traceability matrix | d5e5cff | traceability-product-agent.md |
| 2 | Rewrite product-agent prompt | be57466 | product-agent/prompt.md |

## What Was Built

### Traceability Matrix (79 rows)

The matrix maps every imperative statement from the original 144-line prompt to its replacement mechanism:

| Category | Count |
|----------|-------|
| Framework contract -> Keep as constraint | 7 |
| Behavioral -> Constraint | 10 |
| Behavioral -> Example | 11 |
| Behavioral -> Constraint + Example | 4 |
| Domain knowledge -> Keep | 9 |
| Context-reading -> Move to tools | 5 |
| Behavioral -> Drop (model-native) | 27 |
| **Total** | **79** |

All 13 sections of the original prompt are represented. Every row has a specific "New Coverage" entry identifying the replacement.

### Rewritten Prompt

Structure: `<identity>` -> `<constraints>` -> `<domain_knowledge>` -> `<examples>` -> `<tools>` -> `<context>`

**Identity**: Goal-oriented (2 sentences), chain-of-thought guidance (`<reasoning>` blocks), constraint priority ordering (safety > correctness > efficiency), phase tag as observability convention.

**Constraints** (6 constitutional negatives):
1. Never create without searching for duplicates
2. Never create an issue user hasn't seen and confirmed
3. Never ignore cancellation intent
4. Communicate only through slack_send_message (text is internal)
5. Call wait_for to pause (without it, conversation ends permanently)
6. Never claim success if tool call failed

**Domain Knowledge**: Issue quality criteria preserved nearly verbatim from original.

**Examples** (5 few-shot with reasoning):
1. Clear bug report -- search + draft + confirm in one turn
2. Vague request -- ask for clarification
3. Multi-concern -- handle separately, confirm each
4. Duplicate found -- present existing, ask how to proceed
5. Constraint tension -- related-but-different issue, mention as context without derailing

**Tools**: Slack context usage moved here (channel, thread, team ID extraction). Tools listed by purpose, not by name.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Extended prompt structure with `<domain_knowledge>` section | Issue quality criteria need their own section between constraints and examples |
| 6 constitutional constraints in sentence case | Each prevents a specific real failure; no directive stacking |
| Phase tags as 1-sentence observability convention | Framework doesn't parse them (confirmed by code analysis) |
| 27 rules dropped as model-native | Cancellation phrases, intent detection, conversation etiquette, error classification -- all model-native capabilities |
| Abstract actions in examples (no tool names) | Tool names change; reasoning patterns are stable |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

| Check | Result |
|-------|--------|
| No if/then branching (IF, THEN, CLEAR REQUEST, etc.) | PASS -- zero matches |
| No prescriptive tool sequences (FIRST, Step 1, etc.) | PASS -- zero matches |
| Strong directive count under 10 | PASS -- zero MUST/ALWAYS/NEVER/CRITICAL/IMPORTANT (all caps) |
| Exactly 5 examples | PASS -- examples 1-5 present |
| Chain-of-thought guidance in identity | PASS -- `<reasoning>` block mentioned |
| Constraint priority ordering in identity | PASS -- safety > correctness > efficiency |
| wait_for framework contract preserved | PASS -- in constraints and tools |
| slack_send_message communication constraint preserved | PASS -- in constraints |
| Phase tag simplified to observability | PASS -- 1 sentence in identity |
| No tool names in examples | PASS -- abstract actions only |
| All 13 original sections covered in matrix | PASS -- section coverage table verified |

## Next Phase Readiness

No blockers. The product-agent prompt is ready for manual testing (deferred -- no eval tooling in Phase 56 scope). Phase 59 (Prompt Evolution) can add task lifecycle content to this prompt without conflicts.

## Self-Check: PASSED
