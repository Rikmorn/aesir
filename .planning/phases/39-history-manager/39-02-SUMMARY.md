---
phase: 39
plan: 02
subsystem: framework
tags: [history-manager, summarization, llm, anthropic, token-management, compaction]
requires:
  - "39-01 (Phase 1 pruning pipeline)"
provides:
  - "Complete history compaction pipeline (Phase 1 + Phase 2)"
  - "LLM-based structured summarization with artifact grounding"
  - "Summary detection and merge (prevents summarization drift)"
affects:
  - "Phase 40 (Executor will use history manager for context window management)"
tech-stack:
  added: []
  patterns:
    - "Ground-truth artifact injection in LLM summarization prompts"
    - "Single-summary-block-with-merge strategy for preventing drift"
    - "Graceful degradation: Phase 2 failure falls back to Phase 1"
key-files:
  created: []
  modified:
    - packages/agents/src/framework/history-manager.ts
    - packages/agents/src/framework/history-manager.test.ts
    - packages/agents/src/framework/index.ts
key-decisions:
  - decision: "Summary wrapped in <summary></summary> tags for reliable detection"
    rationale: "XML-style tags are simple to parse and unambiguous in conversation context"
  - decision: "Existing summaries replaced (merged) not nested"
    rationale: "Prevents summaries-of-summaries degradation; LLM sees old summary + new messages for context"
  - decision: "Error handling falls back to Phase 1 pruned result"
    rationale: "History manager is an optimization, not a safety mechanism -- best-effort is correct"
  - decision: "No anthropicClient skips Phase 2 gracefully"
    rationale: "Enables Phase 1-only usage in testing and environments without LLM access"
duration: 6m17s
completed: 2026-02-01
---

# Phase 39 Plan 02: Phase 2 Summarization Summary

LLM-based structured summarization with ground-truth artifact injection, summary detection/merge, and full compaction pipeline orchestration (estimate -> Phase 1 -> re-estimate -> Phase 2).

## Performance

| Metric | Value |
|--------|-------|
| Duration | 6m17s |
| Started | 2026-02-01T22:32:23Z |
| Completed | 2026-02-01T22:38:40Z |
| Tasks | 2/2 |
| Files modified | 3 |
| Lines (history-manager.ts) | 998 (was 665, +333) |
| Lines (test file) | 1695 (was 946, +749) |
| Tests | 41 (was 24, +17 new) |
| Framework tests | 163 (all passing) |

## Accomplishments

1. **Phase 2 summarization engine**: `generateSummary` calls Anthropic API with structured prompt that includes conversation transcript and ground-truth artifacts from session projection. Summary model and max_tokens configurable via agent definition YAML.

2. **Artifact injection**: `formatArtifacts` formats session projection artifacts as structured data within the prompt. The LLM is explicitly instructed not to paraphrase these machine-extracted values, preventing summarization drift.

3. **Summary detection and merge**: `containsSummary` scans messages for existing `<summary>` blocks. When found, the old summary is included in the messages passed to the summarizer, then the new summary replaces the old one -- no nesting.

4. **Pipeline orchestration**: Complete `compact()` pipeline: estimate tokens -> check prune threshold -> Phase 1 prune -> re-estimate -> check summary threshold -> Phase 2 summarize (if needed). Each gate is independently testable.

5. **Graceful degradation**: If LLM call fails (API error, timeout), falls back to Phase 1 pruned result. If no `anthropicClient` provided, Phase 2 is skipped entirely. If summary is somehow larger than what it replaces, returns pruned result.

6. **Comprehensive test coverage**: 17 new tests across 7 groups covering artifact formatting, summary detection, trigger conditions, generation with artifacts, merge behavior, error handling, and full end-to-end pipeline.

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Phase 2 summarization and pipeline | ad57d8d | formatArtifacts, containsSummary, serializeMessagesForSummary, generateSummary, compact() Phase 2 logic |
| 2 | Unit tests for Phase 2 and pipeline | 7178ee5 | 17 new tests, mock Anthropic client, buildLargeConversation helper |

## Files Modified

| File | Change |
|------|--------|
| `packages/agents/src/framework/history-manager.ts` | +333 lines: 4 new exported/internal functions, Phase 2 pipeline in compact() |
| `packages/agents/src/framework/history-manager.test.ts` | +749 lines: 17 new tests across 7 describe groups |
| `packages/agents/src/framework/index.ts` | Added exports for containsSummary and formatArtifacts |

## Decisions Made

1. **Summary tag format**: `<summary></summary>` XML-style tags for detection. Simple regex parsing, unambiguous in message content.

2. **Single-summary-block strategy**: When an existing summary is found, it is included in the messages-to-summarize (so the new summary has full context) and then the new summary replaces the old one at position 0. This prevents summaries-of-summaries.

3. **Protected boundary recalculation**: Phase 2 recalculates the protected boundary independently from Phase 1, ensuring consistent behavior even if Phase 1 modified message count.

4. **Summary size guard**: If the generated summary is somehow larger than the messages it replaces, the pipeline falls back to the Phase 1 pruned result rather than making things worse.

5. **Parameter rename**: Changed `_options` to `compactOptions` in the factory method to remove the unused-variable prefix now that Phase 2 uses it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertion for error handling fallback**
- **Found during:** Task 2
- **Issue:** Error handling test used `buildLargeConversation(5000, 4)` which creates file reads of ~1980 tokens each -- below the head+tail truncation threshold (2000 tokens). Phase 1 saved 0 tokens, causing `tokensSaved > 0` assertion to fail.
- **Fix:** Replaced with explicit file reads of 5000 tokens each that actually get truncated by Phase 1.
- **Files modified:** history-manager.test.ts

**2. [Rule 3 - Blocking] Fixed TypeScript type errors for mock `.mock.calls` access**
- **Found during:** Task 2
- **Issue:** `mockClient.messages.create.mock.calls` caused TS2339 because the type is the real Anthropic method, not `vi.fn()`. TypeScript doesn't know about the mock wrapper.
- **Fix:** Cast `mockClient.messages.create` to `Mock` type from vitest before accessing `.mock`.
- **Files modified:** history-manager.test.ts

## Issues Encountered

None beyond the auto-fixed items above.

## Next Phase Readiness

Phase 39 (History Manager) is now **complete**. Both Plan 01 (Phase 1 pruning) and Plan 02 (Phase 2 summarization) are implemented and tested.

- **Total tests:** 41 (24 from Plan 01 + 17 from Plan 02)
- **Total lines:** 998 (history-manager.ts) + 1695 (test file) = 2693 lines
- **All 163 framework tests passing** with no regressions

The History Manager is ready for integration into Phase 40 (Executor), which will call `compact()` at conversation boundaries to manage context window limits.
