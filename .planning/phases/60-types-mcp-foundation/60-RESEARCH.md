# Phase 60: Types & MCP Foundation - Research

**Researched:** 2026-02-08
**Domain:** Zod type definitions, PostgreSQL schema migration, MCP tool registration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **ReplyContext shape**: Zod-first discriminated union on `channel` with three variants: `slack` (teamId, channelId, threadTs optional), `linear` (issueId), `github` (owner, repo, prNumber, commentId optional). Slack `threadTs` optional for reply/notify unification. Drop `NotifyTarget` as separate type. Keep GitHub `commentId` in type but don't populate/use it yet.
- **MessageContent type**: Fields: `text` (string, markdown body) and `options` (optional array of {label, value, style?}). Drop `semantic` field. Drop `metadata` field.
- **MCP tool: Linear create_comment**: Already exists in Linear integration code but not registered in MCP server tool list. Verify existing implementation before wiring up. Seed permissions: dev-agent AND product-agent.
- **MCP tool: GitHub create_pr_comment**: New MCP tool using `issues.createComment` from Octokit (NOT `pulls.createReview`). Pass-through error handling. Seed permissions: dev-agent only.
- **reply_context storage**: Add `reply_context JSONB` column to conversations table (nullable, no default). Last-wins overwrite. Store from both start() and signal(). Existing rows get null.
- **Type placement**: All communication types in `packages/agents/src/shared/communication/types.ts`. ReplyContext, MessageContent, and CommunicationToolDeps in same file. NOT in `@aesir/types`.

### Claude's Discretion
- Exact Zod schema field constraints (min lengths, value validation)
- Migration file naming and ordering
- CommunicationToolDeps interface shape (follows McpToolDeps pattern)
- Whether to add a barrel export from shared/communication/

### Deferred Ideas (OUT OF SCOPE)
- Inline review comment replies (GitHub `pulls.createReplyForReviewComment`)
- `semantic` field on MessageContent
- `reply_to_review_comment` MCP tool
</user_constraints>

## Summary

Phase 60 defines the foundational types and exposes two MCP tools needed by the entire v2.6 unified communication system. The research shows all four work areas are well-constrained with low risk:

1. **Type definitions** (ReplyContext, MessageContent, CommunicationToolDeps) -- a new `shared/communication/types.ts` file with Zod schemas. No dependencies to resolve, no circular import concerns.
2. **Linear `create_comment` MCP tool** -- ALREADY FULLY IMPLEMENTED at both the integration HTTP layer AND the MCP SDK server layer. The handler exists (`handleCreateComment` in `issues.ts`), it is already imported in `api/mcp.ts`, listed in `TOOL_DEFINITIONS`, and wired in the `switch/case`. The ONLY gap is on the agent side: `linear-tools.ts` does not create a wrapper for it, and `tool-factories.ts` does not register `linear:create_comment`. Permissions are already seeded for both `dev-agent` and `product-agent`.
3. **GitHub `create_pr_comment` MCP tool** -- needs a new handler function, new Zod schemas, registration in both the MCP SDK server and HTTP router, and agent-side wrapper + factory registration. The `addPRComment` operation function already exists using `octokit.rest.issues.createComment`.
4. **`reply_context` JSONB column** -- a straightforward `ALTER TABLE` migration adding one nullable column. No index needed (it's a projection for fast access, not a query target).

**Primary recommendation:** Split into 3 plans: (A) Type definitions + migration, (B) Linear create_comment agent-side wiring + tests, (C) GitHub create_pr_comment full stack + permission seeding.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zod | existing (v3.x) | Schema validation for ReplyContext, MessageContent, and tool inputs | Already used across entire codebase for all schemas |
| drizzle-orm | existing | Schema definition for conversations table column | Project standard ORM |
| @octokit/rest | existing | GitHub API calls for `issues.createComment` | Already used in github integration |
| @linear/sdk | existing | Linear API calls for `client.createComment` | Already used in linear integration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| express | existing | MCP HTTP route handlers | GitHub integration MCP router |
| express-rate-limit | existing | Rate limiting on MCP endpoints | Already configured |

### Alternatives Considered
None -- all libraries are already in use. No new dependencies needed.

## Architecture Patterns

### Recommended File Structure
```
packages/agents/src/shared/communication/
├── types.ts              # ReplyContext, MessageContent, CommunicationToolDeps
└── index.ts              # Barrel export (optional, recommended)

packages/agents/src/shared/tools/integration/
├── linear-tools.ts       # ADD create_comment wrapper (7th tool)
└── github-tools.ts       # ADD create_pr_comment wrapper (10th tool)

packages/agents/src/framework/
├── tool-factories.ts     # ADD linear:create_comment, github:create_pr_comment registrations

packages/agents/src/shared/db/
├── schema.ts             # ADD reply_context column to conversations
├── schema.drizzle.ts     # ADD reply_context column (keep in sync)
└── migrations/
    └── 0006_add_reply_context.sql  # New migration

packages/integrations/github/src/
├── mcp/
│   ├── schemas.ts        # ADD CreatePRCommentInput/Output schemas
│   ├── tools/
│   │   └── pullrequests.ts  # ADD handleCreatePRComment handler
│   └── server.ts         # ADD create_pr_comment to tool list + handler routing
├── api/
│   └── mcp.ts            # ADD create_pr_comment to TOOL_DEFINITIONS + switch/case

packages/integrations/linear/src/
├── mcp/
│   └── server.ts         # ADD create_comment to tool list + handler routing (ALREADY DONE in api/mcp.ts)

packages/integrations/github/scripts/
└── seed-permissions.ts   # ADD create_pr_comment for dev-agent
```

### Pattern 1: MCP Tool Handler (GitHub integration side)
**What:** Standard handler function pattern used by all GitHub MCP tools.
**When to use:** When adding a new tool to the GitHub integration MCP layer.
**Example:**
```typescript
// Follow exact pattern from handleCreateBranch, handleCreatePR, etc.
export async function handleCreatePRComment(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<PRCommentOutput>> {
  const { db, credentialStore, owner } = deps;

  // 1. Permission check
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_pr_comment" },
  );
  if (!hasPermission) { return createErrorResult(context, "Permission denied..."); }

  // 2. Input validation
  const parseResult = CreatePRCommentInputSchema.safeParse(args);
  if (!parseResult.success) { return createErrorResult(context, `Invalid input: ...`); }

  // 3. Execute via Octokit
  const octokit = await createGitHubClientFromDatabase(credentialStore, owner);
  const comment = await addPRComment(octokit, ...);

  // 4. Return result
  return createToolResult(context, `Comment created...`, output);
}
```

### Pattern 2: Agent-Side MCP Wrapper (agents package)
**What:** Thin ToolDefinition wrapper using `createMcpToolWrapper`.
**When to use:** When registering an integration tool for agent use.
**Example:**
```typescript
// In linear-tools.ts or github-tools.ts
const createCommentSchema = z.object({
  issueId: z.string().describe("Linear issue identifier"),
  body: z.string().describe("Comment body in markdown"),
});

createMcpToolWrapper({
  integration: "linear",
  toolName: "create_comment",
  displayName: "linear_create_comment",
  description: "Create a comment on a Linear issue...",
  inputSchema: createCommentSchema,
}, deps);
```

### Pattern 3: Zod Discriminated Union
**What:** Use `z.discriminatedUnion` for ReplyContext with `channel` as discriminator.
**When to use:** When defining the ReplyContext schema.
**Example:**
```typescript
const SlackReplyContextSchema = z.object({
  channel: z.literal("slack"),
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  threadTs: z.string().optional(),
});

const LinearReplyContextSchema = z.object({
  channel: z.literal("linear"),
  issueId: z.string().min(1),
});

const GitHubReplyContextSchema = z.object({
  channel: z.literal("github"),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  commentId: z.number().int().positive().optional(),
});

export const ReplyContextSchema = z.discriminatedUnion("channel", [
  SlackReplyContextSchema,
  LinearReplyContextSchema,
  GitHubReplyContextSchema,
]);

export type ReplyContext = z.infer<typeof ReplyContextSchema>;
```

### Pattern 4: SQL Migration Convention
**What:** Hand-written SQL in `migrations/` directory with journal entry.
**When to use:** Any database schema change.
**Example:**
```sql
-- 0006: Add reply_context column for v2.6 unified communication
ALTER TABLE agents.conversations
  ADD COLUMN reply_context JSONB;
```
Note: No `DEFAULT` needed (nullable), no index needed (projection column, not queried).

### Anti-Patterns to Avoid
- **Importing from integration packages in agents**: Agent-side tool wrappers define their own local Zod schemas. NEVER import from `@aesir/integration-linear` or `@aesir/integration-github`.
- **Adding columns via Drizzle push/generate**: Migrations are hand-written SQL files. The `schema.drizzle.ts` file tracks state for drizzle-kit but actual migrations are authored manually.
- **Skipping schema.drizzle.ts sync**: Both `schema.ts` and `schema.drizzle.ts` MUST be updated together. Failure to sync causes drizzle-kit to generate destructive migrations.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zod discriminated union | Manual type narrowing | `z.discriminatedUnion("channel", [...])` | Zod handles runtime validation + TypeScript narrowing automatically |
| MCP tool boilerplate | Custom HTTP + validation | `createMcpToolWrapper(config, deps)` | Handles input validation, error wrapping, retry logic |
| GitHub API comment creation | Raw HTTP to GitHub API | `addPRComment()` from `operations/pull-requests.ts` | Already handles Octokit instantiation and error logging |
| Permission checking | Manual DB queries | `checkGitHubToolPermission` / `checkLinearToolPermission` | Standardized allow-list pattern with deny-by-default |

**Key insight:** Phase 60 is almost entirely about wiring existing patterns to new use cases. The only net-new code is the GitHub `handleCreatePRComment` handler and the communication types file.

## Common Pitfalls

### Pitfall 1: Linear create_comment is Partially Done -- Two Layers Exist
**What goes wrong:** Assuming `create_comment` needs to be implemented from scratch, or assuming it needs no work.
**Why it happens:** There are TWO MCP exposure layers: (a) the MCP SDK Server in `mcp/server.ts` and (b) the HTTP API Router in `api/mcp.ts`. The HTTP Router (`api/mcp.ts`) already has `create_comment` fully wired. The SDK Server (`mcp/server.ts`) does NOT -- it lists 6 tools, missing `create_comment` in both `ListToolsRequestSchema` handler and `CallToolRequestSchema` handler.
**How to avoid:** Update BOTH layers. However, the primary path used at runtime is the HTTP Router (agents call via `callMcpTool` which makes HTTP POST requests). The SDK Server is secondary. Both should be consistent.
**Warning signs:** The HTTP Router has 7 tools in TOOL_DEFINITIONS but the SDK Server has only 6 tools registered.

### Pitfall 2: schema.ts and schema.drizzle.ts Must Stay In Sync
**What goes wrong:** Adding `reply_context` to `schema.ts` but not `schema.drizzle.ts`, or vice versa.
**Why it happens:** Two schema files exist for different purposes: `schema.ts` uses `@aesir/types` imports (runtime), `schema.drizzle.ts` uses only `drizzle-orm` + `nanoid` (for drizzle-kit migration generation).
**How to avoid:** Always update both files in the same commit. Verify with `pnpm run typecheck` after.
**Warning signs:** drizzle-kit generating unexpected DROP/CREATE statements.

### Pitfall 3: Migration Journal Must Be Updated
**What goes wrong:** Creating the migration SQL file but not adding it to `meta/_journal.json`.
**Why it happens:** Drizzle-kit's `migrate` command reads the journal to determine which migrations to run.
**How to avoid:** Add a new entry to `_journal.json` with idx=5, tag matching the filename (without `.sql`), and a reasonable timestamp.
**Warning signs:** Migration not running despite file existing.

### Pitfall 4: Agent-Side Tool Naming Convention
**What goes wrong:** Using `create_comment` as the displayName instead of `linear_create_comment`.
**Why it happens:** The MCP server-side tool name is `create_comment`, but agent-side tools are prefixed with the integration name to avoid collisions.
**How to avoid:** Follow the established pattern: MCP server `toolName` = `create_comment`, agent `displayName` = `linear_create_comment`. The `tool-factories.ts` registration uses the namespace format: `linear:create_comment` maps to displayName `linear_create_comment`.
**Warning signs:** `mcpAdapter` throws "tool not found" because it searches by displayName.

### Pitfall 5: GitHub create_pr_comment Permission Scope
**What goes wrong:** Seeding permissions for product-agent when only dev-agent should have access.
**Why it happens:** Other tools give product-agent read access to GitHub. The context decision is clear: product-agent doesn't interact with GitHub PRs for commenting.
**How to avoid:** Only seed `create_pr_comment` for `dev-agent` in `seed-permissions.ts`.
**Warning signs:** Product-agent unexpectedly commenting on PRs.

## Code Examples

### Communication Types File
```typescript
// packages/agents/src/shared/communication/types.ts
import { z } from "zod";
import type { PinoLogger } from "@aesir/platform";

// ─── ReplyContext ────────────────────────────────────────────────────────────

const SlackReplyContextSchema = z.object({
  channel: z.literal("slack"),
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  threadTs: z.string().optional(),
});

const LinearReplyContextSchema = z.object({
  channel: z.literal("linear"),
  issueId: z.string().min(1),
});

const GitHubReplyContextSchema = z.object({
  channel: z.literal("github"),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  commentId: z.number().int().positive().optional(),
});

export const ReplyContextSchema = z.discriminatedUnion("channel", [
  SlackReplyContextSchema,
  LinearReplyContextSchema,
  GitHubReplyContextSchema,
]);

export type ReplyContext = z.infer<typeof ReplyContextSchema>;

// ─── MessageContent ─────────────────────────────────────────────────────────

export const MessageContentSchema = z.object({
  text: z.string().min(1),
  options: z.array(z.object({
    label: z.string().min(1),
    value: z.string().min(1),
    style: z.enum(["primary", "danger"]).optional(),
  })).optional(),
});

export type MessageContent = z.infer<typeof MessageContentSchema>;

// ─── CommunicationToolDeps ──────────────────────────────────────────────────

export interface CommunicationToolDeps {
  agentId: string;
  correlationId: string;
  taskId?: string;
  logger: PinoLogger;
}
```

### Agent-Side Linear create_comment Wrapper Addition
```typescript
// Add to linear-tools.ts alongside existing schemas
const createCommentSchema = z.object({
  issueId: z.string().describe("Linear issue ID or identifier (e.g., 'ABC-123')"),
  body: z.string().describe("Comment body in markdown format"),
});

// Add to createLinearTools() return array
createMcpToolWrapper({
  integration: "linear",
  toolName: "create_comment",
  displayName: "linear_create_comment",
  description: "Create a comment on a Linear issue. Use this to add notes, updates, status reports, or reply to discussions on an issue.",
  inputSchema: createCommentSchema,
}, deps),
```

### Tool-Factories Registration Addition
```typescript
// Add to registerAllTools() in the Linear section
registry.register(
  "linear:create_comment",
  mcpAdapter(createLinearTools, "linear_create_comment"),
);

// Add to registerAllTools() in the GitHub section
registry.register(
  "github:create_pr_comment",
  mcpAdapter(createGitHubTools, "github_create_pr_comment"),
);
```

### GitHub create_pr_comment Schemas
```typescript
// Add to packages/integrations/github/src/mcp/schemas.ts
export const CreatePRCommentInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  pullNumber: z.number().int().positive("Pull number must be positive"),
  body: z.string().min(1, "Comment body is required"),
});

export type CreatePRCommentInput = z.infer<typeof CreatePRCommentInputSchema>;

export const PRCommentOutputSchema = z.object({
  id: z.number(),
  body: z.string(),
  user: z.string(),
  createdAt: z.string(),
});

export type PRCommentOutput = z.infer<typeof PRCommentOutputSchema>;
```

### Migration SQL
```sql
-- 0006: Add reply_context for v2.6 unified agent communication
-- Nullable JSONB column storing the last-received ReplyContext.
-- No default needed (null = no reply context yet).
-- No index needed (projection column for fast access, not a query filter).

ALTER TABLE agents.conversations
  ADD COLUMN reply_context JSONB;
```

### Migration Journal Entry
```json
{
  "idx": 5,
  "version": "7",
  "when": 1739059200000,
  "tag": "0006_add_reply_context",
  "breakpoints": true
}
```

### Permission Seeding Addition (GitHub)
```typescript
// Add to PERMISSIONS array in seed-permissions.ts
{ agentId: "dev-agent", toolName: "create_pr_comment", allowed: true },
```

## Critical Discovery: Linear create_comment Integration State

The investigation revealed an important asymmetry in the Linear `create_comment` implementation:

| Layer | Status | Details |
|-------|--------|---------|
| **Handler function** (`mcp/tools/issues.ts`) | DONE | `handleCreateComment` fully implemented with permission check, input validation, Linear SDK call |
| **Barrel export** (`mcp/tools/index.ts`) | DONE | `handleCreateComment` already exported |
| **HTTP Router** (`api/mcp.ts`) | DONE | Listed in `TOOL_DEFINITIONS`, wired in `switch/case`, has task correlation recording |
| **MCP SDK Server** (`mcp/server.ts`) | MISSING | Not in `ListToolsRequestSchema` handler, not in `CallToolRequestSchema` handler |
| **Agent-side wrapper** (`linear-tools.ts`) | MISSING | No Zod schema, no `createMcpToolWrapper` call |
| **Agent-side registration** (`tool-factories.ts`) | MISSING | No `linear:create_comment` registered |
| **Permission seeding** (`seed-permissions.ts`) | DONE | Already seeded for dev-agent AND product-agent |

The runtime MCP call path goes: agent -> `callMcpTool` -> HTTP POST to `api/mcp.ts` -> `handleCreateComment`. So the HTTP Router being done means the **tool already works at the integration level**. The remaining work is:
1. Add to `mcp/server.ts` (for SDK consistency, though not used at runtime)
2. Add agent-side wrapper in `linear-tools.ts`
3. Register in `tool-factories.ts`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `mcp/server.ts` (MCP SDK protocol) | `api/mcp.ts` (HTTP REST) | v2.2 | Agents use HTTP, not SDK protocol. Both layers should stay in sync. |

**Deprecated/outdated:**
- The MCP SDK Server (`mcp/server.ts`) in both integrations is a secondary interface. The primary runtime path is the Express HTTP Router (`api/mcp.ts`). Both must be kept in sync but only the HTTP path is exercised by agents.

## Open Questions

1. **Should `mcp/server.ts` be updated for Linear create_comment?**
   - What we know: The HTTP router already handles it. The SDK server is used by the `@modelcontextprotocol/sdk` but agents use the HTTP path.
   - What's unclear: Whether any other consumer uses the SDK server directly.
   - Recommendation: Update both for consistency. The work is minimal (add to tool list + switch case in `server.ts`). Mark as low-priority within the plan.

2. **Migration timestamp value for _journal.json**
   - What we know: Existing entries use millisecond timestamps. The convention appears to be roughly sequential.
   - Recommendation: Use current date epoch milliseconds. The exact value doesn't matter -- drizzle-kit uses `idx` for ordering.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/integrations/linear/src/mcp/tools/issues.ts` -- confirmed `handleCreateComment` exists (lines 472-563)
- Codebase inspection: `packages/integrations/linear/src/api/mcp.ts` -- confirmed `create_comment` in TOOL_DEFINITIONS and switch handler (lines 129-146, 339-355)
- Codebase inspection: `packages/integrations/linear/src/mcp/server.ts` -- confirmed `create_comment` MISSING from server (6 tools, not 7)
- Codebase inspection: `packages/integrations/github/src/operations/pull-requests.ts` -- confirmed `addPRComment` using `octokit.rest.issues.createComment` (lines 175-205)
- Codebase inspection: `packages/agents/src/shared/tools/integration/mcp-wrapper.ts` -- confirmed `createMcpToolWrapper` pattern
- Codebase inspection: `packages/agents/src/shared/db/schema.ts` -- confirmed conversations table structure
- Codebase inspection: `packages/integrations/linear/scripts/seed-permissions.ts` -- confirmed create_comment already seeded for both agents
- Codebase inspection: `packages/integrations/github/scripts/seed-permissions.ts` -- confirmed create_pr_comment NOT yet seeded

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all patterns established
- Architecture: HIGH -- every touch point verified with exact line numbers
- Pitfalls: HIGH -- discovered through direct code comparison (SDK vs HTTP asymmetry)

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (stable codebase patterns, no external dependency risk)
