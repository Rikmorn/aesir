# Phase 68: Shared Memory - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents store and retrieve classified knowledge with semantic search, enabling collaboration efficiency through shared context across conversations. Knowledge persists beyond individual conversations so agents in delegation chains don't redundantly re-discover the same things.

Tools: `knowledge:store`, `knowledge:query`, `knowledge:update`. Schema: `agents.knowledge_entries` with pgvector. Embedding: provider-agnostic interface — Ollama for development, Voyage AI for production.

</domain>

<decisions>
## Implementation Decisions

### Knowledge Tool UX

**knowledge:store** — minimal input, maximum inference:
- Required fields (3): `type`, `topic`, `content`
- `type`: one of 6 fixed classifications (discovery, constraint, architecture_decision, thought, preference, test_result)
- `topic`: short label used for deduplication matching (exact, case-insensitive, trimmed)
- `content`: the actual knowledge, max 2000 characters — reject with error if exceeded ("Content exceeds 2000 character limit. Summarize the key points or split into multiple entries.")
- Auto-inferred: `author` (from agentId in tool context), `expiry` (from type defaults), `scope` (from type defaults), `created_at` (system timestamp)
- Optional overrides: `scope` (override type-based default), `tags` (additional filtering labels)
- Skip for v1: confidence scores — agents are bad at self-calibrating confidence. Relevance ranking uses recency + type filtering instead.
- Response: `{ id, topic, type }` — same shape regardless of whether dedup triggered

**knowledge:query** — lean results with a hard cap:
- Query parameters: `query` (semantic search text), `type` (optional filter), `topic` (optional exact match), `limit` (optional, default 10, max 25)
- Per result: `id`, `type`, `topic`, `content`, `author`, `createdAt` (ISO string)
- Omit from results: embedding, expires_at, scope, tags
- Similarity threshold (e.g., 0.3 cosine) to avoid returning garbage when nothing matches
- No pagination, no total count — agents query, scan top results, act

**knowledge:update** — two operations, clear semantics:
- `action: "supersede"` — creates new entry that replaces the old one. Old entry gets `superseded_by` reference and is excluded from queries. Required: `content`. Optional: `type`, `topic` overrides.
- `action: "invalidate"` — marks entry as invalid with optional `reason`. No replacement. Excluded from queries.
- No "extend" operation — accumulation creates unbounded growth, ambiguous authorship, and incoherent entries. To add to existing knowledge: query, incorporate, supersede with complete replacement.

### Scope & Visibility

Default scope per type — one type private, five shared:
| Type | Default Scope | Rationale |
|------|--------------|-----------|
| discovery | shared | Useful to everyone ("Auth uses JWT at src/middleware/auth.ts") |
| constraint | shared | Applies to all agents ("API rate limit is 100/min") |
| architecture_decision | shared | Cross-cutting by definition |
| preference | shared | Project/user preferences |
| test_result | shared | Factual, cross-agent |
| thought | private | Working memory, reasoning scratchpad — noise to other agents |

Access control is a hard constraint, not a filter parameter:
- Every query returns: all shared entries + querying agent's own private entries
- Never returns another agent's private entries
- No `scope` parameter on query — this is invisible row-level security, not a user choice

Author visibility: return `author` (agentId) on every entry for provenance tracing and debugging. Don't build trust hierarchies in prompts — author is a fact about provenance, not a credibility score.

YAML-based scope overrides (MEM-06): deferred. The defaults above are sensible and unlikely to change soon. If overrides are needed later, add then.

### Expiry & Deduplication

Expiry enforcement — dual mechanism:
- Query-time filter: `WHERE expires_at > NOW()` on every query. Correctness guarantee — expired entries never appear regardless of cleanup state.
- Background cleanup: periodic job hard-deletes entries expired more than 24h ago. Keeps table and indexes lean. 24h buffer for debugging recently-expired entries.
- Hard delete, not soft delete. Entries are ephemeral by design. Event log captures when entries were stored for audit trails.

Expiry durations by type (from MEM-04):
| Type | Duration |
|------|----------|
| discovery | 24h |
| constraint | 30d |
| architecture_decision | 7d |
| thought | 24h |
| preference | 30d |
| test_result | 7d |

Supersession resets expiry: new entry gets a fresh timer from its type starting at creation time. If someone thought it was worth updating, it's still relevant.

Deduplication on store (MEM-07/MEM-08):
- Match key: exact topic (case-insensitive, trimmed) + same type
- On match: auto-supersede silently. Old entry gets `superseded_by`, new entry created. Response is identical to a fresh store.
- No match: create new entry
- No semantic similarity for dedup — topic is an identifier, not prose. Exact matching is simple, predictable, debuggable.
- Agents can also manually deduplicate via query → assess → supersede flow using `knowledge:update`

### Embedding Pipeline

Provider-agnostic embedding interface — Ollama for development, Voyage AI for production.

**Provider switching:**
- `EMBEDDING_PROVIDER=ollama|voyage` env var, validated by Zod at startup
- `ollama` → validate `OLLAMA_URL` exists (defaults to Docker service name `ollama:11434`)
- `voyage` → validate `VOYAGE_API_KEY` exists, fail fast if missing
- Invalid/missing `EMBEDDING_PROVIDER` → startup error with clear message
- No auto-detection or key-sniffing — explicit provider selection prevents silent fallback

**Configurable vector dimensions:**
- `EMBEDDING_DIMENSIONS` env var — `768` for Ollama dev models, `1024` for Voyage AI production
- pgvector column and HNSW index are dimension-specific, so this must be consistent per environment
- Schema migration uses the configured dimension

**Ollama (development):**
- Single container in docker-compose, REST API (`POST /api/embeddings`)
- Lightweight embedding model (e.g., nomic-embed-text, 768 dimensions)
- No API key needed — local service

**Voyage AI (production):**
- Direct HTTP (fetch + retry) or SDK — planner decides based on ecosystem
- `VOYAGE_API_KEY` as env var, same pattern as `ANTHROPIC_API_KEY` (static key, not OAuth)
- Model: voyage-3 (or latest appropriate model), 1024 dimensions

**EmbeddingService interface:**
- Single interface, two implementations (OllamaEmbedding, VoyageEmbedding)
- `embed(text: string): Promise<number[] | null>` — returns vector or null on failure
- `embedBatch(texts: string[]): Promise<(number[] | null)[]>` — batch support for seed scripts

**Embed source:** `"{topic}: {content}"` — concatenate both. Topic gives the model a strong domain anchor, content provides nuance. Don't embed `type` — it's a structured filter, not a similarity signal.

**Synchronous embedding with graceful degradation:**
1. Write row with metadata (topic, type, content, scope, expiry)
2. Call embedding provider for vector
3. Success → update row with vector
4. Failure → log warning, row stays with null vector, still queryable by structured fields (type, topic)

**Query embedding fallback:**
- If embedding the query text fails, fall back to structured-only search using provided filters (type, topic)
- If no structured filters provided either, return empty — a pure semantic search with no embedding has nothing to work with
- Aligns with MEM-08: partial functionality over silent failure

### Claude's Discretion

- Voyage AI SDK vs raw HTTP — check ecosystem, pick based on maintenance quality
- Embedding model version selection (voyage-3 vs newer for production, specific Ollama model for dev)
- Ollama model selection for development (nomic-embed-text or similar lightweight embedding model)
- Background cleanup job implementation (pg-boss scheduled job vs setInterval)
- HNSW index parameters (ef_construction, m) — tune for the expected entry volume
- Similarity threshold value (suggested 0.3 cosine, tune based on testing)
- Content character limit exact value (suggested 2000, adjust if testing shows different sweet spot)

</decisions>

<specifics>
## Specific Ideas

- Knowledge store should feel effortless: 3 required fields, everything else inferred. Agents should store knowledge freely, not hesitate because the form is heavy.
- Content cap enforced as rejection with helpful error message — truncation creates subtle data quality problems (half an architecture decision is worse than none).
- Access control is invisible and correct by default — agents don't think about scope, the system enforces it.
- Deduplication is automatic and silent on store — the convenience path just does the right thing.
- Author is provenance, not a trust score — useful for debugging, not for agent credibility hierarchies.

</specifics>

<deferred>
## Deferred Ideas

- YAML-based scope overrides — defaults are sensible, add configuration when a real use case emerges
- Confidence scores on knowledge entries — agents are bad at self-calibration, use recency + type filtering instead
- Extend operation on knowledge:update — accumulation footgun, supersede with complete replacement instead
- Active knowledge curation (agent/human reviews and prunes) — passive decay via expiry for v1

</deferred>

---

*Phase: 68-shared-memory*
*Context gathered: 2026-02-10*
