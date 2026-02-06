---
phase: 56-goal-oriented-prompt-rewrites
plan: "02"
title: Dev-Agent Prompt Rewrite
subsystem: agents
tags: [prompt-engineering, constitutional-constraints, few-shot-examples, dev-agent]

dependency_graph:
  requires: []
  provides:
    - "Rewritten dev-agent prompt in constitutional + few-shot style"
    - "Traceability matrix mapping 60 old rules to new coverage"
  affects:
    - "Phase 59 (task lifecycle guidance will extend this prompt)"

tech_stack:
  added: []
  patterns:
    - "Constitutional constraint authoring (negative boundaries)"
    - "Few-shot reasoning examples (input -> reasoning -> action)"
    - "Selective chain-of-thought (<reasoning> blocks)"
    - "Constraint priority ordering (safety > correctness > efficiency)"
    - "Extended prompt structure (identity -> constraints -> domain knowledge -> examples -> tools -> context)"

file_tracking:
  key_files:
    created:
      - ".planning/phases/56-goal-oriented-prompt-rewrites/traceability-dev-agent.md"
    modified:
      - "packages/agents/definitions/dev-agent/prompt.md"

decisions:
  - id: "56-02-D1"
    decision: "7 constraints (not 6) -- added wait_for contract as framework-critical constraint"
    reasoning: "Research identified wait_for as a genuine framework contract (without it, conversation ends permanently). Too important to leave to model inference."
    alternatives: "6 constraints (rely on tools section note for wait_for)"
  - id: "56-02-D2"
    decision: "60 traceability rows (not ~35 estimated)"
    reasoning: "Research estimated ~35 by grouping multi-step procedures. Line-by-line extraction of individual imperative statements produced 60 rows for full traceability."
    alternatives: "Grouped extraction (~35 rows with less granularity)"
  - id: "56-02-D3"
    decision: "request_human_input usage note included in constraint #1 (not just tools section)"
    reasoning: "The approval flow (Slack notification + request_human_input pause) is a framework interaction pattern that the agent needs to get right. Mentioning it in the constraint co-locates the 'what' with the 'how'."
    alternatives: "Constraint says only 'get approval', tools section explains mechanism"

metrics:
  duration: "5m 21s"
  completed: "2026-02-06"
---

# Phase 56 Plan 02: Dev-Agent Prompt Rewrite Summary

Rewrote the dev-agent prompt from procedural workflows with SIMPLE/MODERATE/COMPLEX classification to constitutional constraints with 5 few-shot reasoning examples, plus a 60-row traceability matrix proving every removed rule is covered.

## What Was Done

### Task 1: Build dev-agent traceability matrix
**Commit:** `d06a814`

Extracted every imperative statement from the current dev-agent prompt.md into a structured traceability matrix. Each row maps an old rule to its failure mode and the new prompt element that covers it.

Key findings:
- 60 individual imperative statements across 6 prompt sections
- 8 rules explicitly marked as "Classification -> Remove" (SIMPLE/MODERATE/COMPLEX buckets + WRONG APPROACH/CODE BUG/MISSING DEPENDENCY/ENVIRONMENT ISSUE diagnostic categories)
- 7 rules marked as "Behavioral -> Drop (model-native)" (model handles natively)
- 5 framework contracts identified and preserved as hard constraints
- 5 domain knowledge entries preserved from sub-agent delegation section
- Cross-reference tables verify every constraint and example traces back to specific old rules

### Task 2: Rewrite dev-agent prompt
**Commit:** `1b6c7f0`

Rewrote prompt.md following the extended structure: identity -> constraints -> domain knowledge -> examples -> tools -> context.

**Identity section:**
- Goal-oriented (what the agent achieves, not how)
- Chain-of-thought guidance (<reasoning> blocks before significant decisions)
- Constraint priority ordering (safety > correctness > efficiency)

**Constraints section (7 constraints):**
1. Get human approval before creating PR for non-trivial changes
2. Never retry the same failed approach
3. After 3 failed approaches, escalate with details
4. Escalate infrastructure errors immediately
5. Share token budget, provide focused briefs
6. Never merge pull requests
7. wait_for contract (without it, conversation ends permanently)

**Domain knowledge section:**
- Sub-agent delegation guide preserved nearly verbatim
- Architectural fact (sub-agents have fresh context windows)
- Brief requirements checklist (objective, context, output format, boundaries)
- Good/bad brief examples retained

**Examples section (5 scenarios):**
1. "Simpler than it looks" -- CORS as config change, not middleware
2. "Harder than it looks" -- timezone bug reveals systemic date handling issue
3. "Wrong approach, not wrong execution" -- stale brief vs code bug diagnosis
4. "What the sub-agent needs vs what I know" -- auth pattern brief quality
5. "When to escalate" -- two migration failures suggest undocumented constraint

Every example shows the agent discovering something that changes its initial assessment. Example #3 covers error recovery wisdom. Example #5 demonstrates the escalation constraint in action.

**What was removed:**
- SIMPLE/MODERATE/COMPLEX classification gate (entire `<workflow_guidance>` section)
- WRONG APPROACH/MISSING DEPENDENCY/CODE BUG/ENVIRONMENT ISSUE diagnostic categories
- All prescriptive tool sequences ("FIRST call X, THEN call Y")
- All if/then branching trees
- "Always update Linear issue status" (behavioral preference, not safety boundary)
- "Prefer reading specific files over searching broadly" (efficiency preference)
- "Your first action is ALWAYS to read the issue" (prescriptive start)
- "Track what you have tried" (model does this natively via conversation history)

**Metrics:**
- Old prompt: 137 lines, ~8 strong directives (MUST/ALWAYS/NEVER/CRITICAL)
- New prompt: 118 lines, 3 strong directives (2x Never in constraints, 1x must in domain knowledge)
- Line reduction: 14% fewer lines with substantially richer reasoning examples

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Build dev-agent traceability matrix | d06a814 | traceability-dev-agent.md |
| 2 | Rewrite dev-agent prompt | 1b6c7f0 | dev-agent/prompt.md |

## Decisions Made

| ID | Decision | Reasoning |
|----|----------|-----------|
| 56-02-D1 | 7 constraints (added wait_for contract) | Too important for system correctness to leave to inference |
| 56-02-D2 | 60 traceability rows (line-by-line extraction) | Full granularity ensures no rule is missed |
| 56-02-D3 | Approval flow mechanism in constraint text | Co-locates what with how for a framework interaction pattern |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

All 11 verification checks passed:
1. Structure follows identity -> constraints -> domain knowledge -> examples -> tools -> context
2. Zero complexity classification (SIMPLE/MODERATE/COMPLEX)
3. Zero if/then branching trees
4. Zero prescriptive tool sequences
5. Zero diagnostic categorization buckets
6. Strong directive count: 3 (under 10 threshold)
7. Exactly 5 examples in examples section
8. Chain-of-thought guidance present in identity
9. Constraint priority ordering present in identity (safety > correctness > efficiency)
10. Error recovery covered by constraints #2-4 + Example #3
11. Sub-agent delegation guide preserved in domain knowledge section

## Self-Check: PASSED
