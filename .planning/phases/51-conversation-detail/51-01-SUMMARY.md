# Phase 51 Plan 01: Data Foundation and UI Primitives Summary

**One-liner:** Schema update for messages JSONB column, 4 conversation detail service functions, formatEventType utility, and shadcn Collapsible/ScrollArea components

## What Was Done

### Task 1: Add messages column to schema and install shadcn components
- Added `messages` JSONB column to `conversations` table in `packages/dashboard/src/lib/schema.ts`, matching canonical agents schema column order (after `agent_definition_version`, before `status`)
- Installed shadcn/ui Collapsible component (`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`) for expandable event timeline rows
- Installed shadcn/ui ScrollArea component (`ScrollArea`, `ScrollBar`) for scrollable payload containers
- Fixed Biome lint issues in generated shadcn files (missing semicolons, import type, import ordering)
- Commit: `ea1e133`

### Task 2: Add service layer functions for conversation detail data
- Added `getConversationById` -- SELECT with LEFT JOIN to `agent_sessions` for artifacts and `last_event_at`, returns `ConversationDetail` or null
- Added `getConversationEvents` -- SELECT all events ordered by `sequence ASC` for timeline rendering, returns `ConversationEvent[]`
- Added `getConversationMessages` -- SELECT messages JSONB column, returns `unknown[]` for Anthropic message format
- Added `getChildConversations` -- SELECT child conversations by `parent_conversation_id`, ordered by `created_at ASC`, returns `ChildConversation[]`
- Added 3 new interfaces: `ConversationDetail`, `ConversationEvent`, `ChildConversation`
- Added `asc` to drizzle-orm imports
- Used destructuring (`const [row] = rows`) to satisfy TypeScript strict `noUncheckedIndexedAccess`
- Commit: `f4b6bfb`

### Task 3: Add formatEventType utility
- Added `formatEventType` to `packages/dashboard/src/lib/format.ts`
- Converts dot-separated event types to human-readable labels (e.g., "tool.called" -> "Tool Called")
- Special case for "llm" -> "LLM" (uppercase acronym)
- Commit: `f2d0fd1`

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Destructuring for row access (`const [row] = rows`) | TypeScript strict mode with `noUncheckedIndexedAccess` rejects `rows[0]` even after length guard; destructuring narrows correctly |
| `getChildConversations` as separate function | Sub-agent links in metadata sidebar need child conversations independently from parent detail |
| ConversationEvent.type as `string` not `AgentEventType` | Service interface uses string for flexibility; UI components can narrow as needed |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed shadcn generated file lint errors**
- **Found during:** Task 1
- **Issue:** shadcn CLI generates files without semicolons and with non-Biome-compliant import ordering, which blocks the pre-commit hook
- **Fix:** Ran `pnpm run lint:fix` on the two generated files to apply Biome formatting and import type fixes
- **Files modified:** `packages/dashboard/src/components/ui/collapsible.tsx`, `packages/dashboard/src/components/ui/scroll-area.tsx`
- **Commit:** `ea1e133`

**2. [Rule 1 - Bug] Fixed TypeScript strict mode `noUncheckedIndexedAccess` errors**
- **Found during:** Task 2
- **Issue:** `rows[0]` is possibly undefined under strict TypeScript, even after `rows.length === 0` guard. Caused 12 compile errors.
- **Fix:** Changed to destructuring pattern (`const [row] = rows; if (!row) return null;`) which TypeScript narrows correctly
- **Files modified:** `packages/dashboard/src/services/conversations.ts`
- **Commit:** `f4b6bfb`

## Artifacts

### Files Created
- `packages/dashboard/src/components/ui/collapsible.tsx` -- shadcn Collapsible, CollapsibleTrigger, CollapsibleContent
- `packages/dashboard/src/components/ui/scroll-area.tsx` -- shadcn ScrollArea, ScrollBar

### Files Modified
- `packages/dashboard/src/lib/schema.ts` -- Added messages JSONB column to conversations table
- `packages/dashboard/src/services/conversations.ts` -- Added 4 query functions, 3 interfaces, asc import
- `packages/dashboard/src/lib/format.ts` -- Added formatEventType utility

## Verification Results

- TypeScript typecheck: PASS (zero errors)
- Biome lint: PASS (zero errors)
- Schema has messages column: CONFIRMED
- Service exports 7 functions (3 existing + 4 new): CONFIRMED
- formatEventType exported: CONFIRMED
- shadcn components exist: CONFIRMED
- Full Next.js build: PASS

## Next Phase Readiness

Plan 01 provides the complete data foundation for Plans 02 and 03:
- **Plan 02** (Event Timeline) can import `ConversationEvent` from services and `Collapsible`/`ScrollArea` from UI
- **Plan 03** (Message Panel + Page Assembly) can import `ConversationDetail`, `getConversationById`, `getConversationMessages`, `getChildConversations`, and `formatEventType`

No blockers for subsequent plans.

---
*Completed: 2026-02-04 (~4 minutes)*
*Phase: 51-conversation-detail, Plan: 01*
