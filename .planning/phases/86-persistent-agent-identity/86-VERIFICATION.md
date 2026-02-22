---
phase: 86-persistent-agent-identity
verified: 2026-02-22T23:30:00Z
status: passed
score: 5/5 must-haves verified
human_verification:
  - test: "Start a new top-level dev-agent conversation and inspect the system prompt sent to the LLM"
    expected: "Identity documents XML block appears after prompt.md content when the agent has existing documents"
    why_human: "Requires live agent execution with existing identity documents in the database to observe injection"
  - test: "Let a dev-agent conversation complete, verify the pre-completion hook fires"
    expected: "An identity review turn appears in the conversation messages before the final end_turn, and any updated documents are persisted with the new version"
    why_human: "Requires live agent execution reaching the completed state to verify hook fires and injectTurn works end-to-end"
  - test: "Navigate to an agent detail page in the dashboard for an agent with identity documents"
    expected: "Identity section appears below schedules, cards are collapsible, History toggle reveals version list with char deltas and conversation links, Load more paginates correctly"
    why_human: "Visual and interactive behavior cannot be verified programmatically"
---

# Phase 86: Persistent Agent Identity Verification Report

**Phase Goal:** Agents accumulate understanding across conversations through structured identity documents, and the framework provides a lifecycle hook mechanism for injecting turns at conversation boundaries
**Verified:** 2026-02-22T23:30:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agents start every conversation with their accumulated identity documents injected into the system prompt | VERIFIED | `worker-loop.ts` line 1231: `if (options.identityService && !conv.parent_conversation_id)` calls `getCurrentDocuments` and appends XML block via `formatIdentityDocumentsBlock` before passing `systemPrompt` to runAgentLoop |
| 2 | Agents can update identity documents via `identity:update`, every update creates a new version (full history retained) | VERIFIED | `identity-service.ts` `updateDocument` uses `MAX(version)+1` and `INSERT` only (no DELETE). `update.ts` tool factory calls `identityService.updateDocument`. Append-only versioning confirmed. |
| 3 | 12,000-character hard limit per document and 5-document cap per agent, enforced at write time with full replacement semantics | VERIFIED | `IDENTITY_MAX_CHARS_PER_DOCUMENT = 12_000` and `IDENTITY_MAX_DOCUMENTS = 5` in `identity-service.ts`. Char limit throws at line 188, doc cap throws at line 209-224. Full replacement: every call is an INSERT. |
| 4 | Dashboard shows identity documents per agent with collapsible cards, version history with char count deltas, and conversation provenance links | VERIFIED | `agent-identity-panel.tsx`, `identity-document-card.tsx`, `identity-version-list.tsx` all present and substantive. Page integration confirmed: `agents/[id]/page.tsx` fetches `getIdentityDocumentsForAgent` and renders `AgentIdentityPanel` conditionally. Version list fetches API route, computes char deltas client-side, links to `/conversations/{id}`. |
| 5 | If identity documents fail to load, conversation starts without them (graceful degradation, not hard failure) | VERIFIED | `worker-loop.ts` line 1245: `catch (identityErr)` logs warning (`childLogger.warn`) and proceeds with original `definition.systemPrompt`. Conversation is not aborted. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/agents/src/shared/db/migrations/0020_add_identity_documents.sql` | VERIFIED | Creates `agents.identity_documents` with id, agent_id, document_type, content, version, conversation_id FK (ON DELETE SET NULL), created_at. Two indexes + unique constraint on (agent_id, document_type, version). |
| `packages/agents/src/shared/services/identity-service.ts` | VERIFIED | Exports `createIdentityService`, `IdentityService` interface, `IDENTITY_MAX_DOCUMENTS`, `IDENTITY_MAX_CHARS_PER_DOCUMENT`. All 5 methods implemented: getCurrentDocuments (DISTINCT ON), getDocumentHistory, updateDocument (with validation), getDocumentCount, health, close. |
| `packages/agents/src/shared/tools/identity/update.ts` | VERIFIED | Exports `createIdentityUpdateTool`. Uses `ctx.agentId` and `ctx.correlationId`. Calls `identityService.updateDocument`. Returns success with version + all document names, or error message with `isError: true`. |
| `packages/agents/src/shared/tools/identity/read.ts` | VERIFIED | Exports `createIdentityReadTool`. Optional `document_type` parameter. Returns single document or all current documents with type, version, updated timestamp, content. |
| `packages/agents/src/shared/tools/identity/index.ts` | VERIFIED | Barrel export for both tool factories. |
| `packages/agents/src/framework/lifecycle-hooks.ts` | VERIFIED | Exports `createLifecycleHookRegistry`, `LifecycleHookRegistry`, `LifecycleHook`, `LifecycleHookContext`. Map-based registration with duplicate detection. Sequential execution with per-hook try/catch. `injectTurn` function in context type. |
| `packages/agents/src/framework/worker-loop.ts` | VERIFIED | Identity injection at step 3d (before agent loop, top-level only). Pre-completion hooks at step 14a (before DB persistence, top-level completed path only). `formatIdentityDocumentsBlock` helper produces XML with type, version, updated attributes. |
| `packages/agents/src/service/main.ts` | VERIFIED | Creates `identityService` (line 136), passes to `registerAllTools` (line 145). Creates `lifecycleHooks` registry (line 150). Registers `identity-review` hook (line 154). Passes both to `createConversationExecutor` (lines 247-248). |
| `packages/dashboard/src/lib/schema.ts` | VERIFIED | `identityDocuments` table defined at line 264 mirroring the agents schema (id, agent_id, document_type, content, version, conversation_id, created_at). |
| `packages/dashboard/src/services/agents.ts` | VERIFIED | `getIdentityDocumentsForAgent` (line 169) and `getIdentityDocumentHistory` (line 215) implemented with DB queries. Types `IdentityDocumentSummary` and `IdentityDocumentVersion` exported. |
| `packages/dashboard/src/components/agents/agent-identity-panel.tsx` | VERIFIED | Client component. Renders `h3` header "Identity" + maps documents to `IdentityDocumentCard`. Exports `AgentIdentityPanel`. |
| `packages/dashboard/src/components/agents/identity-document-card.tsx` | VERIFIED | Client component. Collapsible with `expanded` state. Shows type, version, timestamp (relative), char count, content preview. Expanded shows full content in `<pre>`. History toggle renders `IdentityVersionList`. |
| `packages/dashboard/src/components/agents/identity-version-list.tsx` | VERIFIED | Client component. Fetches from `/dashboard/api/agents/{id}/identity/{type}` with pagination. Shows version number, timestamp, char count, char delta (green/red). Conversation links via Next.js `Link`. "Load more" button with `hasMore` check. |
| `packages/dashboard/src/app/api/agents/[id]/identity/[type]/route.ts` | VERIFIED | GET handler. Accepts limit (clamped 1-100) and offset (floored at 0). Calls `getIdentityDocumentHistory`. Returns JSON. |
| `packages/dashboard/src/app/agents/[id]/page.tsx` | VERIFIED | Imports `AgentIdentityPanel` and `getIdentityDocumentsForAgent`. Fetches in `Promise.all`. Conditionally renders `AgentIdentityPanel` below schedules when `identityDocuments.length > 0`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tool-factories.ts` | `identity/index.ts` | `registry.register("identity:update" / "identity:read")` | WIRED | Lines 436-439. `const is = options.identityService` passed to both factories. |
| `worker-loop.ts` | `identity-service.ts` | `getCurrentDocuments` at step 3d | WIRED | Line 1234: `await options.identityService.getCurrentDocuments(conv.agent_definition_id)` |
| `worker-loop.ts` | `lifecycle-hooks.ts` | `runPreCompletion` at step 14a | WIRED | Line 2038: `await options.lifecycleHooks.runPreCompletion(hookCtx)` |
| `main.ts` | `lifecycle-hooks.ts` | `createLifecycleHookRegistry` + `lifecycleHooks.register("identity-review", ...)` | WIRED | Lines 38, 150, 154 |
| `main.ts` | `identity-service.ts` | `createIdentityService` passed to `registerAllTools` and executor | WIRED | Lines 55, 136, 145, 247 |
| `agents/[id]/page.tsx` | `agent-identity-panel.tsx` | Rendered in sidebar when documents.length > 0 | WIRED | Lines 6, 105-110 |
| `services/agents.ts` | `lib/schema.ts` | `identityDocuments` Drizzle table reference in queries | WIRED | Line 26 imports `identityDocuments`, used in both query functions |
| `identity-version-list.tsx` | `services/agents.ts` | Client-side fetch to `/dashboard/api/agents/[id]/identity/[type]` | WIRED | Line 75 fetch URL matches API route path |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| IDN-01 | 86-01 | Identity document table with versioning scoped to agent role | SATISFIED | Migration 0020 creates `agents.identity_documents` with agent_id, document_type, content, version, conversation_id FK, created_at |
| IDN-02 | 86-01 | Document types extensible, no schema change for new types | SATISFIED | `document_type TEXT NOT NULL` (free text, not enum). No constraint restricting values. |
| IDN-03 | 86-02 | Context injection into system prompt at conversation start | SATISFIED | worker-loop.ts step 3d injects XML block via `formatIdentityDocumentsBlock` |
| IDN-04 | 86-01 | `identity:update` tool with full replacement semantics, new version on each call | SATISFIED | `update.ts` tool factory + `updateDocument` uses INSERT with `MAX(version)+1` |
| IDN-05 | 86-01 | `identity:read` tool for mid-conversation document refresh | SATISFIED | `read.ts` tool factory queries `getDocumentHistory` (single) or `getCurrentDocuments` (all) |
| IDN-06 | 86-01 | Every update creates new version, full history retained | SATISFIED | Append-only: no DELETE path in `identity-service.ts`. `getDocumentHistory` returns all versions. |
| IDN-07 | 86-01 | Size management -- character limit per document | SATISFIED (SCOPED) | `IDENTITY_MAX_CHARS_PER_DOCUMENT = 12_000` hard limit enforced at write time. RESEARCH.md explicitly documents user decision to use character limit (not configurable token limits per type) and no approaching-limit prompt. ROADMAP success criteria reflects this scope. |
| IDN-08 | 86-03 | Dashboard visibility with version history and comparison | SATISFIED | Identity section on agent detail page, collapsible cards, version list, char deltas, conversation provenance links |
| IDN-09 | 86-02 | Graceful degradation if documents fail to load | SATISFIED | try/catch in worker-loop.ts step 3d logs warning, proceeds with original systemPrompt |

**IDN-07 scope note:** REQUIREMENTS.md specifies "configurable token limits per type" with an "approaching limit" prompt. The RESEARCH.md records an explicit user decision to scope this to a hardcoded 12,000-character limit with no per-type configuration and no approaching-limit warning. The ROADMAP success criterion (SC-3) reflects this scoped implementation. IDN-07 is satisfied at the accepted scope.

**Orphaned requirements check:** All 9 IDN-01 through IDN-09 requirements are claimed across the 3 plans (86-01 claims IDN-01/02/04/05/06/07, 86-02 claims IDN-03/09, 86-03 claims IDN-08). No orphaned requirements.

### Anti-Patterns Found

No blockers or warnings. Observations:
- `identity-version-list.tsx` line 39: `return null` in helper `formatCharDelta` -- intentional (no delta for first version), not a stub.
- `biome-ignore` comment in `read.ts` line 57 -- intentional and properly justified (length checked on preceding line).

### Sub-Agent Exclusion Verified

- `coder/definition.yaml`, `researcher/definition.yaml`, `tester/definition.yaml` contain no `identity:update` or `identity:read` tools (verified via grep, no output).
- Sub-agent exclusion in worker-loop.ts: both identity injection (line 1231) and pre-completion hooks (line 2007) are gated on `!conv.parent_conversation_id`.

### Commit Verification

All 6 phase commits verified present in git log:
- `4ef4d644` -- feat(86-01): add identity documents schema and service
- `6d32ed17` -- feat(86-01): add identity tools and register in ToolRegistry
- `de727624` -- feat(86-02): lifecycle hooks and identity injection in worker loop
- `0f8bbc30` -- feat(86-02): add identity tools and prompt guidance to agent definitions
- `584c0d49` -- feat(86-03): dashboard schema and service layer for identity documents
- `4361527f` -- feat(86-03): identity UI components and agent detail page integration

### Human Verification Required

#### 1. Identity document injection (live agent)

**Test:** Start a new top-level dev-agent conversation and inspect the system prompt sent to the LLM (via observability logs or event log). Requires existing identity documents in the database.
**Expected:** An `<identity_documents>` XML block appears after prompt.md content, with one `<document>` element per document including type, version, and updated attributes.
**Why human:** Requires live agent execution with populated database. Grep confirms the code path exists and is wired but cannot verify the XML block is syntactically correct at runtime.

#### 2. Pre-completion identity review hook (live agent)

**Test:** Let a dev-agent conversation complete normally (not cancelled, not via budget exhaustion). Inspect the final message history.
**Expected:** A user-role turn containing `<identity_review>` XML appears in the messages before end_turn. If the agent updated any documents, new version rows exist in `agents.identity_documents`.
**Why human:** Requires live agent execution reaching the completed state. The injectTurn mechanism calls a nested `runAgentLoop` which cannot be verified statically.

#### 3. Dashboard identity panel (live UI)

**Test:** Open the agent detail page for dev-agent or product-agent in the dashboard at `/dashboard/agents/dev-agent` after seeding some identity documents.
**Expected:** Identity section appears below schedules. Cards are collapsible. Expanding shows full content. History toggle reveals version list. Char deltas display in green/red. Version numbers link to conversation detail pages. "Load more" paginates correctly at 20 items.
**Why human:** Interactive UI behavior, visual design correctness, and pagination UX cannot be verified programmatically.

---

_Verified: 2026-02-22T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
