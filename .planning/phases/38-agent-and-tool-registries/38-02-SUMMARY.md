---
phase: 38-agent-and-tool-registries
plan: 02
subsystem: agent-definitions
tags: [yaml, agent-config, system-prompts, declarative]
requires:
  - 38-RESEARCH (agent definition schema design)
provides:
  - 5 agent definition directories with YAML config + prompt.md
  - Data-equivalent of all hardcoded agent configurations
  - Foundation for AgentRegistry to load definitions from disk
affects:
  - 38-03 (AgentRegistry loads these definitions)
  - 38-04 (ToolRegistry resolves tool refs from these definitions)
tech-stack:
  added: []
  patterns:
    - Agent definitions as YAML data files with separate prompt.md
    - namespace:tool_name format for tool references
key-files:
  created:
    - packages/agents/definitions/dev-agent/definition.yaml
    - packages/agents/definitions/dev-agent/prompt.md
    - packages/agents/definitions/product-agent/definition.yaml
    - packages/agents/definitions/product-agent/prompt.md
    - packages/agents/definitions/researcher/definition.yaml
    - packages/agents/definitions/researcher/prompt.md
    - packages/agents/definitions/coder/definition.yaml
    - packages/agents/definitions/coder/prompt.md
    - packages/agents/definitions/tester/definition.yaml
    - packages/agents/definitions/tester/prompt.md
  modified: []
key-decisions:
  - id: def-01
    decision: "Backticks unescaped from TS template literals in prompt.md files"
    reason: "prompt.md contains the actual prompt text, not the TypeScript encoding"
  - id: def-02
    decision: "history config values are v2.3 forward-looking, not from current codebase"
    reason: "pruneThreshold, protectedMessages, summaryThreshold, summaryModel are new v2.3 features designed in 38-RESEARCH"
  - id: def-03
    decision: "Sub-agents have standalone tokenBudget (100k) even though v2.2 shares parent budget"
    reason: "v2.3 executor will override with parent shared budget when spawning; standalone value for future independent use"
duration: 7m31s
completed: 2026-02-01
---

# Phase 38 Plan 02: Agent Definition Extraction Summary

Extracted all 5 agent definitions from hardcoded TypeScript into YAML config + prompt.md data files under packages/agents/definitions/.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 7m31s |
| Started | 2026-02-01T19:48:58Z |
| Completed | 2026-02-01T19:56:29Z |
| Tasks | 2/2 |
| Files created | 10 |

## Accomplishments

1. **Dev-agent definition** -- YAML config with 14 tools (3 codebase, 3 coordination, 2 linear, 4 github, 2 slack), 100 maxIterations, 500k tokenBudget, claude-sonnet-4-20250514 model, subAgents references to researcher/coder/tester, trigger on linear.agent_session.created
2. **Product-agent definition** -- YAML config with 5 tools (4 linear, 1 slack), 10 maxIterations, 50k tokenBudget, claude-sonnet-4-20250514 model, trigger on slack.app_mention.created
3. **Researcher sub-agent** -- 4 tools (read-only + run_command), 30 iterations, haiku model
4. **Coder sub-agent** -- 4 tools (read/write/search/run), 40 iterations, haiku model
5. **Tester sub-agent** -- 3 tools (read/search/run), 20 iterations, haiku model
6. **All prompts verified** -- Exact match with TypeScript string constants (with proper backtick unescaping for coder prompt)

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extract dev-agent and product-agent definitions | 86ce964 | definitions/dev-agent/*, definitions/product-agent/* |
| 2 | Extract researcher, coder, and tester sub-agent definitions | 1b610ef | definitions/researcher/*, definitions/coder/*, definitions/tester/* |

## Files Created

- `packages/agents/definitions/dev-agent/definition.yaml` -- Dev agent config (14 tools, 100 iterations, 500k tokens)
- `packages/agents/definitions/dev-agent/prompt.md` -- Dev agent system prompt (136 lines)
- `packages/agents/definitions/product-agent/definition.yaml` -- Product agent config (5 tools, 10 iterations, 50k tokens)
- `packages/agents/definitions/product-agent/prompt.md` -- Product agent system prompt (138 lines)
- `packages/agents/definitions/researcher/definition.yaml` -- Researcher config (4 tools, 30 iterations)
- `packages/agents/definitions/researcher/prompt.md` -- Researcher system prompt (37 lines)
- `packages/agents/definitions/coder/definition.yaml` -- Coder config (4 tools, 40 iterations)
- `packages/agents/definitions/coder/prompt.md` -- Coder system prompt (31 lines)
- `packages/agents/definitions/tester/definition.yaml` -- Tester config (3 tools, 20 iterations)
- `packages/agents/definitions/tester/prompt.md` -- Tester system prompt (51 lines)

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| def-01 | Backticks unescaped from TS template literals in prompt.md | prompt.md contains actual prompt text, not TypeScript encoding; LLM sees unescaped backticks at runtime |
| def-02 | history config values are v2.3 forward-looking | pruneThreshold, protectedMessages, summaryThreshold, summaryModel designed in 38-RESEARCH for new framework |
| def-03 | Sub-agents have standalone tokenBudget (100k) | v2.3 executor overrides with parent shared budget when spawning; standalone value for future independent use |

## Deviations from Plan

### Task 1 Commit Attribution

Task 1 files (dev-agent and product-agent definitions) were committed under the 38-01 commit (86ce964) due to parallel plan execution interference. A parallel agent (38-01) ran concurrently and its git operations picked up already-staged files from this plan. The content is correct and all files are properly tracked. This is a metadata issue only -- no content was lost or corrupted.

## Issues Encountered

1. **Pre-commit hook failures from parallel plan** -- The pre-commit hook runs `pnpm -r run build` which typechecks the entire workspace. A parallel plan (38-01) had staged files with temporary TypeScript errors, causing the hook to fail for this plan's commits. Resolved itself once the parallel plan completed its fixes.

2. **Parallel plan commit interference** -- Task 1 files were absorbed into the 38-01 commit. This is an artifact of running multiple plan executors concurrently against the same git repository without coordination locks.

## Next Phase Readiness

- **38-03 (AgentRegistry)**: Ready. All 5 definition directories exist with validated YAML configs and prompt.md files. AgentRegistry can load these via fs.readFile + yaml.parse.
- **38-04 (ToolRegistry wiring)**: Ready. Tool references use namespace:tool_name format matching ToolRegistry's validation pattern (`/^[a-z]+:[a-z_]+$/`).
