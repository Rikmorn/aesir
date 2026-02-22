# Phase 86: Persistent Agent Identity - Research

**Researched:** 2026-02-22
**Domain:** Agent identity document storage, system prompt injection, lifecycle hooks, dashboard UI
**Confidence:** HIGH

## Summary

Phase 86 introduces a versioned identity document system that gives agents accumulated understanding across conversations. The core pieces are: (1) a new `agents.identity_documents` table with full version history, (2) `identity:update` and `identity:read` agent tools, (3) system prompt injection of identity documents at conversation start, (4) a shared lifecycle hook mechanism in the executor for pre-completion prompting, and (5) a dashboard identity section on the agent detail page with version history.

The codebase already has strong precedents for every component: the knowledge entries system (table + tools + service), the task context injection pattern in the worker loop, and the agent detail page layout with tabs and collapsible panels. This phase follows established patterns throughout, which reduces risk. The main engineering challenge is the lifecycle hook mechanism -- it must be generic enough to share with Phase 87's knowledge flush while being specific enough to inject an identity review turn before completion.

**Primary recommendation:** Follow the knowledge entries pattern (service + tools + migration) for storage, inject identity documents into the system prompt string in the worker loop (after `definition.systemPrompt`), and implement lifecycle hooks as a registered array of async functions called in `executeConversation` before the completion path.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Document type is a **free-text string**, not an enum -- schema stores any string
- The system provides mechanism; prompts provide judgment for what to maintain
- Drop stakeholder_map and domain_knowledge types; keep as **per-role prompt guidance**: product_brief, architectural_model, working_context, learned_preferences
- Identity documents are **synthesized mental models**, not individual facts
- Format: plain text / markdown prose -- no structured fields per type
- Max **5 documents per agent** -- controls injection token cost
- Keep existing `description` field; `capabilities` array deferred to v3.0+
- **Exact match** on document_type key -- no semantic dedup
- identity:update tool response **lists all current documents**
- If agent hits 5-document cap, tool returns error with existing list
- Identity documents are **private to the agent role** -- scoped by agent_id
- identity:update / identity:read implicitly scoped to calling agent's own agent_id
- Cross-agent info sharing uses existing channels (knowledge entries, directory, delegation context)
- Identity docs appended to system prompt **after prompt.md content** in XML-delimited block
- Include version number and last-updated timestamp in tags
- **Inject all documents** for v1 -- no selective filtering
- **Sub-agents don't get identity documents** -- executor skips injection if none exist
- **Graceful degradation** (IDN-09): if DB query fails, proceed with prompt.md only, log warning
- **Two complementary update paths:** mid-conversation tool + pre-completion hook
- **Full replacement only** -- agent rewrites entire document each time, no append/patch
- Hook **re-injects current documents** in the hook message
- **No sentinel or structured response** for "nothing to update" -- agent responds naturally
- **Hook fires only on happy path:** normal completion only (not sub-agents, failures, timeouts, budget exhaustion, cancellation)
- **Shared lifecycle hook mechanism** with Phase 87
- **Character limit, not token limit:** `content.length > 12_000`
- Hard **rejection at write time** -- tool returns error with char count
- No proactive "approaching limit" warnings
- **Hardcoded defaults** for v1: `IDENTITY_MAX_DOCUMENTS = 5`, `IDENTITY_MAX_CHARS_PER_DOCUMENT = 12_000`
- No per-agent YAML config
- Don't store char_count in schema -- computable on read
- **No system prompt budget awareness** -- just concatenate prompt.md + identity docs
- Dashboard: new **"Identity" section on agent detail page**, below schedules
- Each document as a **collapsible card**: document type, last updated timestamp, character count, content preview
- **No overview page integration** -- per-agent introspection only
- **No editing from dashboard** -- agent-maintained, operators view and audit
- **Hide section entirely** for agents without identity documents
- Current version shown by default (expanded)
- "History" toggle reveals **version list** below
- Each entry: version number, timestamp, character count delta, **conversation link**
- Click to expand that version's full content
- **No diff tooling** for v1
- **No timeline visualization**
- **Paginate history** -- show recent 20 versions with "load more"
- Store **conversation_id** on each version row as FK

### Claude's Discretion
- Exact lifecycle hook registration API
- Database schema design (tables, columns, indexes)
- identity:read tool design and response format
- Pre-completion hook prompt wording
- Version list pagination implementation

### Deferred Ideas (OUT OF SCOPE)
- Selective injection (inject only relevant documents based on conversation context)
- Per-agent YAML configuration of document limits
- Side-by-side diff tooling
- Cross-agent identity document reading
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IDN-01 | Identity document table -- structured, versioned documents scoped to agent role | New `agents.identity_documents` table with agent_id, document_type, content, version, conversation_id, timestamps. See Schema Design section. |
| IDN-02 | Document types -- extensible set, new types without schema change | CONTEXT locks to free-text string for document_type. No enum in schema. Per-role guidance in prompt.md. |
| IDN-03 | Context injection -- identity docs injected into system prompt at conversation start | Worker loop modification: query documents after loading definition, append XML block to systemPrompt before passing to runAgentLoop. See Injection Pattern. |
| IDN-04 | identity:update tool -- agents update documents mid-conversation or at end | New tool factory in `shared/tools/identity/`. Full replacement semantics, char limit enforcement, document list in response. |
| IDN-05 | identity:read tool -- agents explicitly read their identity documents | Simple tool that queries current versions for the agent's own agent_id. Useful for mid-conversation refresh. |
| IDN-06 | Document versioning -- every update creates new version, full history retained | Each row IS a version. Primary query uses (agent_id, document_type, version DESC LIMIT 1) for current. No delete path. |
| IDN-07 | Size management -- character limit per document | CONTEXT: `content.length > 12_000` hard rejection at tool level. No tokenizer dependency. Hardcoded constant. |
| IDN-08 | Dashboard visibility -- identity documents viewable with version history | New Identity section on agent detail page. Collapsible cards, version list with "load more" pagination, conversation links. |
| IDN-09 | Graceful degradation -- if load fails, conversation starts without them | try/catch in worker loop injection code, log warning, proceed with prompt.md only. Same pattern as task context injection. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.38 | Database schema + queries | Already used for all agents schema tables |
| zod | ^3.25 | Input validation for tools | Standard pattern for all tool input schemas |
| nanoid | ^5 | ID generation for document rows | Used by createId patterns throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nuqs | ^2 | URL state for dashboard tabs/pagination | Already used in agent-detail-tabs for tab state |
| next | ^15 | Dashboard SSR pages and API routes | Existing dashboard framework |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate versions table | Single table (row-per-version) | Row-per-version is simpler, queries are straightforward, no joins needed. More rows but identity docs are low-volume. |
| Token counting | Character counting | CONTEXT locks character limit. Avoids tokenizer dependency. ~4 chars/token approximation is good enough. |
| JSONB content | TEXT content | TEXT is correct -- content is prose/markdown, not structured data. |

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/
  src/
    shared/
      tools/
        identity/
          index.ts           # Barrel export
          update.ts           # identity:update tool factory
          read.ts             # identity:read tool factory
      services/
        identity-service.ts   # IdentityService factory (query, update, list)
      db/
        migrations/
          0020_add_identity_documents.sql
        schema.ts             # Add identityDocuments table
        schema.drizzle.ts     # Mirror for drizzle-kit
    framework/
      lifecycle-hooks.ts      # Shared hook mechanism (new)
      worker-loop.ts          # Modified: inject identity docs + run hooks
      tool-factories.ts       # Register identity:update, identity:read
      types.ts                # LifecycleHook type, ToolContext additions
    service/
      main.ts                 # Wire IdentityService

packages/dashboard/
  src/
    app/agents/[id]/page.tsx     # Add identity section
    components/agents/
      agent-identity-panel.tsx   # Identity section component
      identity-document-card.tsx # Collapsible document card
      identity-version-list.tsx  # Version history with pagination
    services/agents.ts           # Add getIdentityDocuments query
    lib/schema.ts                # Add identityDocuments mirror table
```

### Pattern 1: Identity Service (follows KnowledgeService pattern)
**What:** Factory function returning `{ getCurrentDocuments, getDocumentHistory, updateDocument }` methods.
**When to use:** All identity document operations go through this service.
**Example:**
```typescript
// Source: established pattern from packages/agents/src/shared/services/knowledge-service.ts
export interface IdentityService {
  /** Get all current (latest version) documents for an agent */
  getCurrentDocuments(agentId: string): Promise<IdentityDocument[]>;
  /** Get version history for a specific document type */
  getDocumentHistory(
    agentId: string,
    documentType: string,
    options?: { limit?: number; offset?: number }
  ): Promise<IdentityDocumentVersion[]>;
  /** Create or update a document (creates new version row) */
  updateDocument(params: {
    agentId: string;
    documentType: string;
    content: string;
    conversationId: string;
  }): Promise<{ version: number; documentType: string; allDocuments: string[] }>;
}

export function createIdentityService(opts: {
  db: AgentsDb;
  logger: PinoLogger;
}): IdentityService { ... }
```

### Pattern 2: System Prompt Injection (follows task context injection pattern)
**What:** In `executeConversation`, after loading the definition and before running the agent loop, query identity documents and append to system prompt.
**When to use:** Every non-sub-agent conversation.
**Example:**
```typescript
// In worker-loop.ts executeConversation(), after step 1 (load agent definition)
// Before step 11 (run agent loop)

// Step 1c: Inject identity documents into system prompt
const isSubAgent = !!conv.parent_conversation_id;
let systemPrompt = definition.systemPrompt;

if (!isSubAgent && identityService) {
  try {
    const docs = await identityService.getCurrentDocuments(conv.agent_definition_id);
    if (docs.length > 0) {
      const identityBlock = buildIdentityBlock(docs);
      systemPrompt = `${systemPrompt}\n\n${identityBlock}`;
    }
  } catch (err) {
    // IDN-09: graceful degradation
    childLogger.warn({ err }, "Failed to load identity documents (non-fatal)");
  }
}

// Then in the agent loop options:
const loopOptions = {
  systemPrompt,  // Now includes identity docs
  ...
};
```

### Pattern 3: Lifecycle Hooks (new mechanism, shared with Phase 87)
**What:** A registered array of async hook functions that the executor calls before finalizing a completed conversation. Each hook can inject a user turn and run a mini agent loop iteration.
**When to use:** Pre-completion identity review, knowledge flush (Phase 87), future needs.
**Example:**
```typescript
// lifecycle-hooks.ts
export interface LifecycleHookContext {
  conversationId: string;
  agentDefinitionId: string;
  agentDefinitionVersion: string;
  messages: Anthropic.MessageParam[];
  systemPrompt: string;
  tools: ToolDefinition[];
  model: string;
  logger: PinoLogger;
  /** Run one more agent loop iteration with an injected user turn */
  injectTurn(userMessage: string): Promise<AgentLoopResult>;
}

export type LifecycleHook = (ctx: LifecycleHookContext) => Promise<void>;

// Registration: hooks are registered in order, executed sequentially
export interface LifecycleHookRegistry {
  register(name: string, hook: LifecycleHook): void;
  runPreCompletion(ctx: LifecycleHookContext): Promise<void>;
}
```

### Pattern 4: Identity XML Block
**What:** Format identity documents as XML for system prompt injection.
**Example:**
```xml
<identity_documents>
<document type="architectural_model" version="7" updated="2026-02-20T14:30:00Z">
The system uses a three-tier architecture: API gateway (Express), service layer
(domain logic), and persistence (PostgreSQL). Key patterns include CQRS for
reads vs writes, event sourcing for audit, and SKIP LOCKED for work distribution.
</document>
<document type="working_context" version="3" updated="2026-02-19T09:15:00Z">
Currently working on v2.9 platform completion. The dashboard is Next.js 15 with
App Router. Agent communication uses a denormalizer pattern for channel routing.
</document>
</identity_documents>
```

### Pattern 5: Pre-Completion Hook Message
**What:** The injected user turn that prompts identity review before completion.
**Example:**
```
<identity_review>
Before completing this conversation, review whether your understanding has evolved.
Your current identity documents:

<document type="architectural_model" version="7" updated="2026-02-20T14:30:00Z">
[full content]
</document>

<document type="working_context" version="3" updated="2026-02-19T09:15:00Z">
[full content]
</document>

If any documents need updating based on what you learned in this conversation,
use identity_update now. If your documents are already current, proceed to end
your turn normally.
</identity_review>
```

### Anti-Patterns to Avoid
- **Don't use token counting:** CONTEXT locks to character counting. No tokenizer dependency.
- **Don't append/patch documents:** Full replacement only. Versioning provides the changelog.
- **Don't add structured fields per document type:** Content is free-form prose. The agent decides structure.
- **Don't pattern-match on hook response:** The executor proceeds regardless of whether identity:update was called during the hook turn.
- **Don't fire hooks on non-happy-path exits:** No hooks on sub-agents, failures, timeouts, budget exhaustion, or cancellation.
- **Don't create a separate versions table:** Row-per-version in a single table. The "current" document is just `ORDER BY version DESC LIMIT 1` per (agent_id, document_type).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ID generation | Custom ID scheme | `createId.identityDocument()` or `nanoid()` | Consistent with existing ID patterns |
| Input validation | Manual checks | Zod schemas in tool factories | All tools use Zod, consistent error messages |
| Database access | Raw SQL in tools | IdentityService via factory | Separation of concerns, testability |
| System prompt building | String concatenation | `buildIdentityBlock()` helper | Centralized XML formatting, testable |
| Dashboard data access | Direct DB queries in components | Service layer function | Matches existing `services/agents.ts` pattern |

**Key insight:** Every component in this phase has an exact precedent in the codebase. The knowledge system (KnowledgeService + knowledge tools + migration) is the closest analog for the backend. The agent schedule panel is the closest analog for the dashboard UI.

## Common Pitfalls

### Pitfall 1: Forgetting to Skip Sub-Agents
**What goes wrong:** Sub-agents get identity document injection, wasting tokens on ephemeral workers.
**Why it happens:** The injection code runs for all conversations in `executeConversation`.
**How to avoid:** Check `conv.parent_conversation_id` -- if present, skip identity injection. The CONTEXT locks this: "Sub-agents don't get identity documents."
**Warning signs:** Sub-agent conversations with unexpectedly high token counts.

### Pitfall 2: Hook Running on Non-Happy-Path
**What goes wrong:** Pre-completion hook fires when the agent failed, timed out, or was cancelled, adding unnecessary token cost to already-failed conversations.
**Why it happens:** The completion path in the worker loop has multiple branches (waitForState, completed, error, max_tokens).
**How to avoid:** Only inject the hook turn when `result.status === "completed"` AND `!waitForState.triggered` AND `!conv.parent_conversation_id`. The CONTEXT locks this.
**Warning signs:** Hook-related tool calls appearing in failed conversation event logs.

### Pitfall 3: Schema Drift Between schema.ts and schema.drizzle.ts
**What goes wrong:** drizzle-kit generates destructive migrations because the two schema files are out of sync.
**Why it happens:** The codebase maintains two schema files -- `schema.ts` (runtime, with types) and `schema.drizzle.ts` (drizzle-kit, without external deps).
**How to avoid:** Update both files in the same plan/commit. The gotchas section in CLAUDE.md explicitly warns about this.
**Warning signs:** drizzle-kit generating DROP TABLE statements.

### Pitfall 4: Dashboard Schema Not Updated
**What goes wrong:** Dashboard queries fail because `packages/dashboard/src/lib/schema.ts` doesn't have the new table.
**Why it happens:** Dashboard maintains its own local schema copy (no import from @aesir/agents).
**How to avoid:** Add `identityDocuments` table definition to the dashboard schema file.
**Warning signs:** TypeScript errors in dashboard service layer.

### Pitfall 5: Race Between Mid-Conversation Update and Hook
**What goes wrong:** Agent updates a document mid-conversation, then the hook shows stale documents.
**Why it happens:** The hook re-injects current documents, but "current" means whatever's in the DB at hook time.
**How to avoid:** This is actually fine -- the hook should query fresh documents from the DB, which will include mid-conversation updates. The CONTEXT confirms: "Hook re-injects current documents in the hook message (not just a nudge) -- shows latest state including mid-conversation updates."
**Warning signs:** None -- this is the correct behavior by design.

### Pitfall 6: Conversation ID FK on Version Rows
**What goes wrong:** Identity document versions created during the pre-completion hook reference the conversation correctly, but the FK constraint blocks deletion of conversations.
**Why it happens:** The CONTEXT requires `conversation_id` as FK on each version row.
**How to avoid:** Use `ON DELETE SET NULL` on the FK constraint. Conversations can be deleted without losing identity document versions -- the provenance link becomes null but the content is preserved.
**Warning signs:** Foreign key constraint violations on conversation deletion.

### Pitfall 7: System Prompt Token Explosion
**What goes wrong:** 5 documents x 12,000 chars each = 60,000 chars (~15,000 tokens) added to system prompt.
**Why it happens:** No per-conversation budget awareness.
**How to avoid:** CONTEXT explicitly accepts this: "No system prompt budget awareness -- just concatenate prompt.md + identity docs. Worst case: ~19,000 tokens of system prompt, leaving 181k for conversation." History compaction self-adjusts. This is a known and accepted tradeoff.

## Code Examples

Verified patterns from the existing codebase:

### Database Migration Pattern (from 0007_add_knowledge_entries.sql)
```sql
-- Phase 86: Persistent Agent Identity
-- Creates agents.identity_documents table for versioned agent identity

CREATE TABLE agents.identity_documents (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  document_type       TEXT NOT NULL,
  content             TEXT NOT NULL,
  version             INTEGER NOT NULL,
  conversation_id     TEXT REFERENCES agents.conversations(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

-- Current document lookup: latest version per (agent_id, document_type)
CREATE INDEX idx_identity_agent_type_version
  ON agents.identity_documents(agent_id, document_type, version DESC);

--> statement-breakpoint

-- Conversation provenance: find all versions created in a conversation
CREATE INDEX idx_identity_conversation
  ON agents.identity_documents(conversation_id);

--> statement-breakpoint

-- Enforce max 5 distinct document types per agent (application-level, not DB constraint)
-- The tool enforces this, but the index supports the check query
CREATE INDEX idx_identity_agent_distinct_types
  ON agents.identity_documents(agent_id, document_type);
```

### Tool Registration Pattern (from tool-factories.ts)
```typescript
// ── Identity tools (2) ──────────────────────────────────────────
const ids = options.identityService;
registry.register("identity:update", (ctx) =>
  createIdentityUpdateTool(ids, ctx),
);
registry.register("identity:read", (ctx) =>
  createIdentityReadTool(ids, ctx),
);
```

### Agent Definition YAML Addition
```yaml
# In dev-agent/definition.yaml tools section:
tools:
  - identity:update
  - identity:read
  # ... existing tools
```

### Dashboard Collapsible Card Pattern (from agent-schedule-panel.tsx structure)
```tsx
// Identity document card with expand/collapse
function IdentityDocumentCard({ doc }: { doc: IdentityDocument }) {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <div>
          <span className="font-mono text-sm">{doc.documentType}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            v{doc.version} &middot; {formatRelative(doc.createdAt)}
            &middot; {doc.content.length.toLocaleString()} chars
          </span>
        </div>
        <ChevronDown className={cn("h-4 w-4", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="border-t p-3">
          <pre className="whitespace-pre-wrap text-sm">{doc.content}</pre>
          {/* History toggle */}
          <button onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Hide History" : "Show History"}
          </button>
          {showHistory && <IdentityVersionList agentId={doc.agentId} type={doc.documentType} />}
        </div>
      )}
    </div>
  );
}
```

### Worker Loop Injection Point (from existing task context injection at line ~1103)
```typescript
// In executeConversation, after step 1 (load definition) and before step 11 (run agent loop)
// This follows the exact same pattern as task context injection (step 3b)

// Existing code at step 11:
const loopOptions = {
  systemPrompt: definition.systemPrompt,  // <-- This is where we modify
  ...
};

// After phase 86, this becomes:
const loopOptions = {
  systemPrompt: systemPrompt,  // <-- Variable modified by identity injection
  ...
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agents start fresh each conversation | Agents get accumulated identity context injected | Phase 86 | Agents maintain understanding across conversations |
| No pre-completion hook mechanism | Shared lifecycle hook registry | Phase 86 | Enables Phase 87 knowledge flush and future hooks |
| System prompt = prompt.md only | System prompt = prompt.md + identity docs | Phase 86 | ~5-15K additional tokens in system prompt per conversation |

## Open Questions

1. **Hook execution budget**
   - What we know: The hook injects a user turn and runs one more agent loop iteration. This costs tokens.
   - What's unclear: Should the hook iteration be counted against the agent's normal maxIterations, or should it be "free"?
   - Recommendation: Run the hook as a separate `runAgentLoop` call with `maxIterations: 3` (enough for identity_update + end_turn). This avoids counting against the main budget and prevents the agent from going on tangents during the hook.

2. **IdentityService wiring into WorkerLoopOptions**
   - What we know: The identity service needs to be accessible in `executeConversation` for injection and in tool factories for the tools.
   - What's unclear: Whether to pass via WorkerLoopOptions (like taskService) or via ToolContext (like delegationDeps).
   - Recommendation: Pass via WorkerLoopOptions (same as taskService pattern). The worker loop needs it for injection, and tools get it via the service reference in `registerAllTools`. This is the established pattern.

3. **Dashboard data source**
   - What we know: Dashboard reads from DB directly (local schema) for conversations/events/sessions, but reads from agent-service HTTP API for agent definitions.
   - What's unclear: Should identity documents be fetched via HTTP API (new endpoint) or direct DB query?
   - Recommendation: Direct DB query from the dashboard service layer. Identity documents are simple table reads, not definition data. Matches the pattern used for conversations, events, and sessions. Add to `services/agents.ts`.

## Sources

### Primary (HIGH confidence)
- Codebase: `packages/agents/src/framework/worker-loop.ts` -- executeConversation function, injection patterns
- Codebase: `packages/agents/src/shared/db/schema.ts` -- existing table definitions and patterns
- Codebase: `packages/agents/src/shared/tools/knowledge/store.ts` -- tool factory pattern
- Codebase: `packages/agents/src/framework/tool-factories.ts` -- tool registration pattern
- Codebase: `packages/agents/src/service/main.ts` -- service wiring and bootstrap
- Codebase: `packages/dashboard/src/app/agents/[id]/page.tsx` -- agent detail page layout
- Codebase: `packages/dashboard/src/lib/schema.ts` -- dashboard local schema pattern
- Codebase: `packages/dashboard/src/services/agents.ts` -- dashboard service layer pattern
- Codebase: `.interface-design/system.md` -- dashboard design system

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions -- all locked decisions are from user context session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- every pattern has an exact codebase precedent
- Schema design: HIGH -- follows established table patterns (knowledge_entries, schedule_state)
- Tool implementation: HIGH -- exact same pattern as knowledge tools
- System prompt injection: HIGH -- same pattern as task context injection in worker loop
- Lifecycle hooks: MEDIUM -- new mechanism, but simple (array of async functions, sequential execution)
- Dashboard UI: HIGH -- follows existing agent detail page patterns
- Pitfalls: HIGH -- identified from direct codebase analysis

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable domain, internal codebase)
