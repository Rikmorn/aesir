---
phase: 39-history-manager
plan: 01
subsystem: agent-framework
tags: [history-manager, token-estimation, pruning, compaction, anthropic-sdk]
requires: [38-agent-and-tool-registries]
provides: [createHistoryManager, estimateTokens, estimateMessageTokens, Phase1-pruning]
affects: [39-02-summarization, 40-conversation-executor]
tech-stack:
  added: []
  patterns: [descriptor-replacement, head-tail-truncation, tool-tier-classification]
key-files:
  created:
    - packages/agents/src/framework/history-manager.ts
    - packages/agents/src/framework/history-manager.test.ts
  modified:
    - packages/agents/src/framework/index.ts
key-decisions:
  - "structuredClone for deep-cloning messages (correctness over performance)"
  - "Tool tier classification by name prefix rather than configurable map (simpler, sufficient for v2.3)"
  - "Safe null checks instead of non-null assertions (Biome lint compliance)"
  - "Helper functions in tests for type-safe content extraction (avoids TS strict null issues)"
duration: 10m33s
completed: 2026-02-01
---

# Phase 39 Plan 01: Phase 1 Pruning Pipeline Summary

Token-aware history compaction with chars/4 estimation, tool_use/tool_result boundary protection, file read deduplication, tiered descriptor replacement, and head+tail truncation (500+1500 token bias).

## Performance

| Metric | Value |
|--------|-------|
| Duration | 10m33s |
| Started | 2026-02-01T22:18:08Z |
| Completed | 2026-02-01T22:28:41Z |
| Tasks | 2/2 |
| Files created | 2 |
| Files modified | 1 |
| Lines added | ~1610 |

## Accomplishments

1. **Token estimation functions** -- `estimateTokens(text)` uses chars/4 ceil approximation for hot-path. `estimateMessageTokens(messages)` handles all Anthropic content block types (TextBlock, ToolUseBlock with name+input, ToolResultBlock with string or array content) plus 4 tokens per message structural overhead.

2. **Protected boundary calculation** -- Counts from end of messages array. Detects when boundary would split a tool_use/tool_result pair (user message with only tool_result blocks) and adjusts backward by 1 to include the preceding assistant message.

3. **File read deduplication** -- Scans unprotected messages end-to-start. Tracks file paths from `read_file` and `get_file_contents` tool_use inputs. Earlier reads of same path replaced with `[Duplicate file read: {path}. {N} tokens removed.]` descriptor.

4. **Tool type tier system** -- Classifies tools by name pattern into 5 tiers with different replacement strategies:
   - `file_read` (read_file, get_file_contents): head+tail truncation
   - `search_list` (search_codebase, list_directory, list_files): minimal descriptor with args
   - `command` (run_command): minimal descriptor with command and exit code extraction
   - `integration` (linear_*, github_*, slack_*): head+tail truncation
   - `unknown`: left unchanged

5. **Head+tail truncation** -- Preserves first 500 tokens (head) and last 1500 tokens (tail) of content, inserting `[... N tokens truncated ...]` marker. Biased toward tail (most recent content). Content below 2000 token threshold left unchanged.

6. **createHistoryManager factory** -- Exports `HistoryManager` interface with `compact()` method. Returns `CompactionResult` with phase ("none"/"pruned"/"summarized"), estimatedTokens, and tokensSaved. Phase 2 summarization placeholder for plan 02.

7. **24 unit tests** -- Comprehensive coverage: token estimation (3), message estimation (3), below threshold (2), protected boundary with pair splitting (3), file dedup (3), head+tail truncation (3), tool type tiers (4), immutability (1), full pipeline integration (2).

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Phase 1 pruning pipeline | `fb566f4` | history-manager.ts, index.ts |
| 2 | Unit tests | `c6096a5` | history-manager.test.ts |

## Files Created

- `packages/agents/src/framework/history-manager.ts` (665 lines) -- createHistoryManager factory, estimateTokens, estimateMessageTokens, Phase 1 pruning pipeline
- `packages/agents/src/framework/history-manager.test.ts` (945 lines) -- 24 unit tests for all pruning components

## Files Modified

- `packages/agents/src/framework/index.ts` -- Added barrel exports for createHistoryManager, estimateTokens, estimateMessageTokens, and type exports for HistoryConfig, CompactionResult, HistoryManager

## Decisions Made

1. **structuredClone for deep cloning** -- Used `structuredClone()` instead of JSON parse/stringify for deep cloning messages before mutation. More correct (handles edge cases JSON doesn't) and semantically clearer.

2. **Tool tier by name pattern** -- Classified tools by name prefix (linear_, github_, slack_) rather than a configurable map. This is simpler and sufficient for v2.3 where tool names follow established naming conventions from the MCP layer.

3. **Safe null checks over non-null assertions** -- Biome lint forbids `!` non-null assertions. Used explicit `if (!x)` guards with `continue` for array element access patterns, which is safer and cleaner.

4. **Test helper functions for type-safe extraction** -- Created `getToolResultContent()`, `getToolResultId()`, and `getToolUseId()` helpers to extract content from messages without running into TypeScript strict null check issues on array indexing.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

1. **TypeScript strict null checks on array indexing** -- Array element access like `messages[i]` returns `T | undefined` in strict mode. Resolved with explicit null guards (`if (!message) continue`) rather than non-null assertions, which Biome lint prohibits.

2. **Test content below pruneThreshold** -- Initial `run_command` test had content too small (47 tokens) to trigger pruning with threshold of 100. Fixed by adding verbose output to exceed the threshold.

## Next Phase Readiness

Plan 02 (Phase 2 summarization) can proceed immediately. The compact() method has a clear placeholder comment where Phase 2 logic will be added after Phase 1 pruning. The `CompactionResult.phase` already supports "summarized" as a return value. The `HistoryConfig.summaryThreshold` and `summaryModel` fields are defined and passed through. The `options` parameter for `anthropicClient`, `systemPrompt`, and `tools` is already in the interface signature.
