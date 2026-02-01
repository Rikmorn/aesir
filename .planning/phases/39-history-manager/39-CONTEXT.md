# Phase 39: History Manager - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Three-phase conversation compaction that all agents get via config. Phase 1 pruning replaces old tool outputs with descriptors. Phase 2 structured summarization injects ground-truth artifacts from session projections. Phase 3 (agent-managed memory) is deferred to post-v2.3. Adding a new agent requires only history config in its YAML definition.

</domain>

<decisions>
## Implementation Decisions

### Phase 2 summarization scope
- Build both Phase 1 and Phase 2 in this phase — better to have it and not need it; easier to delete code later
- Phase 2 uses a single summary block that gets merged/updated incrementally (not multiple summary blocks)
- Passive grounding: artifact data (PR URLs, branch names, file paths, modified files) injected from event log projection as structured data the summarizer cannot paraphrase
- Active grounding (agent querying event log) deferred to post-v2.3 as part of agent-managed memory

### Pruning strategy — descriptor format
- Head+tail preservation for file reads: keep first ~500 tokens + last ~1500 tokens, truncate middle (OpenCode pattern)
- Biased toward tail (conclusions/exports more useful than headers)

### Pruning strategy — tool type tiers
- **File reads** (`read_file`, `get_file_contents`): Head+tail (500+1500 tokens)
- **Search/list results** (`search_codebase`, `list_directory`): Minimal descriptor only — tool name + args + token count removed. These are transient; the agent already acted on them
- **Command output** (`run_command`): Minimal descriptor only — tool name + command + exit code + token count removed
- **Integration results** (`linear:*`, `github:*`, `slack:*`): Head+tail — usually small enough that pruning rarely triggers

### Pruning strategy — deduplication
- Dedup by file path, not by exact argument match
- If the same file was read multiple times (regardless of line ranges), keep only the most recent read
- Agent's assistant reasoning (preserved in full) already captures what was learned from earlier reads

### Claude's Discretion
- Exact token counting mechanism (tiktoken, character approximation, or Anthropic's token counting)
- Summarization prompt engineering (the specific instructions given to the summary model)
- Error handling when compaction fails to reduce tokens sufficiently
- Phase 1 → Phase 2 transition logic (how to decide when Phase 1 isn't enough)
- Protected message boundary handling (what happens when a tool call spans the protected/unprotected boundary)

</decisions>

<specifics>
## Specific Ideas

- JetBrains NeurIPS 2025: Observation masking matched LLM summarization quality at 7% lower cost. Summarization actually caused agents to run 13-15% longer. This validates Phase 1 as the primary strategy.
- Community consensus (Claude Code, Cline, OpenCode): Compact at 65-75% context capacity, not 90%+. Earlier compaction preserves more working memory.
- MAJOR-3 pitfall from research: Summarization drift is the primary risk. Summaries of summaries degrade exponentially. Mitigation: inject artifact data as machine-readable structured data in the summary, not prose.
- MODERATE-5 pitfall: Pruned tool outputs might be needed after resume. Mitigation: head+tail preserves file structure; agent can re-read if needed.
- Summary artifact section should be clearly marked as ground truth from event log, e.g., `## Artifacts (from event log)` with structured data the summarizer is instructed not to modify.

</specifics>

<deferred>
## Deferred Ideas

- Agent-managed memory (Phase 3 history) — add `memory:save` and `memory:search` tools. Architecture supports it; no framework changes needed. Natural follow-up when Phase 1+2 are validated.
- Active grounding tool — agent queries event log to verify claims in the summary. Conceptually part of agent-managed memory.

</deferred>

---

*Phase: 39-history-manager*
*Context gathered: 2026-02-01*
