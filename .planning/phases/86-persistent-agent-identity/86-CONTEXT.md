# Phase 86: Persistent Agent Identity - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents accumulate understanding across conversations through structured identity documents injected into system prompts. Agents update their documents via tools, every update creates a new version (full history retained). Dashboard shows identity documents per agent with version history. The framework provides a lifecycle hook mechanism for injecting turns at conversation boundaries (shared with Phase 87's knowledge flush).

</domain>

<decisions>
## Implementation Decisions

### Document types and structure
- Document type is a **free-text string**, not an enum — schema stores any string the agent passes
- The system provides mechanism (store, version, inject, manage size); prompts provide judgment (what to maintain, when to update)
- Drop stakeholder_map (entity directory overlap) and domain_knowledge (too vague — other types ARE domain knowledge)
- Keep as **per-role prompt guidance**: product_brief, architectural_model, working_context, learned_preferences — plus role-specific types (qa-agent: quality_baseline, test_coverage_model)
- Identity documents are **synthesized mental models** (living summaries the agent rewrites), not individual facts (that's knowledge entries)
- Format: plain text / markdown prose — no structured fields per type
- Max **5 documents per agent** — controls injection token cost without limiting what the agent reasons about
- Keep existing `description` field for human-facing label; `capabilities` array is separate (deferred to v3.0+ with Phase 85)

### Document naming and dedup
- **Exact match** on document_type key — no semantic dedup
- identity:update tool response **lists all current documents**: "Updated 'architectural_model' (v3). Your documents: architectural_model, working_context, learned_preferences."
- Agent naturally consolidates because it sees its full set on every update
- If agent hits the 5-document cap, tool returns error with existing list — forces update or replace, not create

### Document visibility
- Identity documents are **private to the agent role** — agents cannot read each other's documents
- identity:update / identity:read are implicitly scoped to the calling agent's own agent_id (enforced at implementation level, not just convention)
- Cross-agent information sharing uses existing channels: knowledge entries (shared facts), entity directory (public profiles), delegation context (task-specific transfer)

### System prompt injection
- Identity docs appended to system prompt **after prompt.md content**, in an XML-delimited block:
  ```xml
  <identity_documents>
  <document type="architectural_model" version="7" updated="2026-02-20">
  [content]
  </document>
  </identity_documents>
  ```
- Include version number and last-updated timestamp in tags — gives agent temporal awareness without a separate read call
- **Inject all documents** for v1 — no selective filtering. The agent's identity IS its identity.
- **Sub-agents don't get identity documents** — they're ephemeral workers. Executor skips injection if none exist (backward compatible).
- **Graceful degradation** (IDN-09): if DB query fails, proceed with prompt.md only. Log a warning. Agent runs without identity context — higher cost (rediscovery), not hard failure.

### Update behavior
- **Two complementary paths:**
  1. **Mid-conversation (agent-initiated):** identity:update available as a regular tool — agent updates immediately when it discovers something important (don't defer to a moment that may never come)
  2. **Pre-completion hook (system-initiated):** executor injects a turn before completion prompting the agent to review and update
- **Full replacement only** — agent rewrites the entire document each time. No append, no patch. Versioning provides the changelog for free. Rewrite forces synthesis over accumulation.
- Hook **re-injects current documents** in the hook message (not just a nudge) — shows latest state including mid-conversation updates
- **No sentinel or structured response** for "nothing to update" — agent responds naturally, executor proceeds regardless of whether identity:update was called. No pattern-matching on agent output.
- **Hook fires only on happy path:** normal completion only. Not on sub-agents, failures, timeouts, budget exhaustion, or cancellation.
- **Shared lifecycle hook mechanism** with Phase 87 — executor runs registered hooks in sequence before finalizing conversation, not separate special-case codepaths

### Token limits
- **Character limit, not token limit:** `content.length > 12_000` — done. No tokenizer dependency needed.
- Hard **rejection at write time** — tool returns: "Document exceeds 12,000 character limit (submitted: 14,200). Rewrite more concisely."
- Agent rewrites and resubmits — LLMs are good at compression when given a clear constraint
- No proactive "approaching limit" warnings — rejection handles it cleanly at the point of action
- **Hardcoded defaults** for v1: `IDENTITY_MAX_DOCUMENTS = 5`, `IDENTITY_MAX_CHARS_PER_DOCUMENT = 12_000`. No per-agent YAML config — add configurability when someone actually hits the limit.
- Don't store char_count in schema — it's `content.length`, computable on read
- **No system prompt budget awareness** — just concatenate prompt.md + identity docs. Worst case: ~19,000 tokens of system prompt, leaving 181k for conversation. History compaction self-adjusts.

### Dashboard: identity section
- New **"Identity" section on agent detail page**, below schedules
- Each document as a **collapsible card**: document type, last updated timestamp, character count, content preview (first 2-3 lines)
- Expand to see full content
- **No overview page integration** — identity is per-agent introspection, not operational health
- **No editing from dashboard** — identity docs are agent-maintained. Operators view and audit; edits come from the agent via identity:update.
- **Hide section entirely** for agents without identity documents (same pattern as schedules)

### Dashboard: version history
- Current version shown by default (expanded)
- "History" toggle reveals **version list** below
- Each entry: version number, timestamp, character count delta (+340 / -120 chars), **conversation link** (click through to conversation that produced the version)
- Click to expand that version's full content
- **No diff tooling** for v1 — full rewrites make word-level diffs noisy. Reading two expanded versions is fast enough.
- **No timeline visualization** — version count is low, a list handles it fine
- **Paginate history** — show recent 20 versions with "load more" option. Don't load full history upfront.
- Store **conversation_id** on each version row as FK — free to capture at write time, valuable for tracing provenance

### Claude's Discretion
- Exact lifecycle hook registration API
- Database schema design (tables, columns, indexes)
- identity:read tool design and response format
- Pre-completion hook prompt wording
- Version list pagination implementation

</decisions>

<specifics>
## Specific Ideas

- "The key distinction from knowledge entries: identity documents are synthesized models, not individual facts. A knowledge entry is 'PR #123 introduced a caching layer.' An identity document is 'The system uses a three-tier caching strategy: L1 in-memory, L2 Redis, L3 CDN, introduced in Q1 and extended twice for session data and API responses.'"
- Operator story: "I want to understand why dev-agent made a weird architectural decision. Let me check its architectural model document and see how its understanding evolved." Agent detail -> Identity section -> expand document -> browse versions -> click conversation link.
- Per-role prompt guidance examples: product-agent maintains product brief + working context + learned preferences; dev-agent maintains architectural model + working context + learned preferences; qa-agent maintains quality baseline + test coverage model
- Tool response feedback loop: "Updated 'architectural_model' (v3). Your documents: architectural_model, working_context, learned_preferences." — agent sees its full set without a separate read call

</specifics>

<deferred>
## Deferred Ideas

- Selective injection (inject only relevant documents based on conversation context) — future optimization when/if system prompt size becomes a concern
- Per-agent YAML configuration of document limits — add when someone actually hits the hardcoded defaults
- Side-by-side diff tooling — add if operators request it after using the version list
- Cross-agent identity document reading — explicitly out of scope; use knowledge entries for shared understanding

</deferred>

---

*Phase: 86-persistent-agent-identity*
*Context gathered: 2026-02-22*
