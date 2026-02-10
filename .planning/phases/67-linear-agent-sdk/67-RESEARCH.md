# Phase 67: Linear Agent SDK - Research

**Researched:** 2026-02-10
**Domain:** Linear Agent SDK migration (OAuth actor=app, typed activities, token refresh)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Activity presentation:**
- Communication tool intents map to Linear activity types:
  - `reply` -> `response`
  - `ask` -> `elicitation`
  - `notify(reasoning)` -> `thought`
  - `notify(action)` -> `action`
  - Infrastructure-emitted -> `error` (on conversation failure)
- Thoughts are **explicit only** -- the agent decides when to surface thinking via `notify(reasoning)`. No auto-emission from `<reasoning>` blocks. The infrastructure does not inspect agent output to emit activities.
- Action activities are **explicit only** -- the agent judges which actions are worth surfacing (e.g., "Created branch feature/auth") via `notify(action)`. Infrastructure does not auto-detect tool calls.
- The 10-second initial thought on session creation is a **generic acknowledgment** (e.g., "Processing your request..."). No payload parsing, no dynamic context. Infrastructure owns this lifecycle event.
- On conversation failure, the **executor emits an error activity** with a brief message (e.g., "Token budget exhausted") before updating session state to `error`. Infrastructure owns lifecycle boundaries.
- Principle: Infrastructure owns two moments (session creation acknowledgment, session failure notification). Agent owns everything in between.

**Migration cutover:**
- **Hard cutover, no feature flag.** Deploy `actor=app` + activity tools + echo filter removal in one release. Old comment-based code is deleted.
- **No rollback path.** If something breaks, fix forward or revert the commit. Dev system, low risk.
- **OAuth re-auth is manual.** Update the OAuth flow to request `actor=app` + new scopes (`app:assignable`, `app:mentionable`). Re-authorize through Linear's OAuth flow after deployment. No migration script.
- **In-flight conversations break.** Accept breakage for conversations in `waiting` state from before the cutover. They can be re-triggered.
- **Agent name/avatar** configured in the Linear developer portal (OAuth app settings), not via API. Update portal settings before re-auth.

**Token refresh behavior:**
- **Dual-layer refresh:** proactive (setInterval at 80% token lifetime ~19h) + reactive (401 triggers immediate refresh + retry of failed request).
- **Proactive timer:** Simple `setInterval` in the Linear integration service. No pg-boss. On service restart, the interval restarts and reads expiry from DB. If the token expired during downtime, the reactive 401 path catches it.
- **Refresh failure handling:** The middleware retries the refresh a couple times with backoff. If all attempts fail, the MCP tool call returns an error to the agent. The agent decides what to do (retry, skip Linear, fail). No queuing of operations hoping the token comes back.
- **Revoked token alerting:** When refresh fails with a non-transient error (revoked, `invalid_grant`), log at ERROR level with clear message ("Linear refresh token revoked -- manual re-authorization required") and emit a Slack notification to the ops channel. This doesn't recover on its own -- proactive alerting prevents hours of silent failure.

**Agent Plans (LSDK-08):**
- **Cut from Phase 67.** Agent Plans (checklist-style progress in Linear UI mapped from task steps) is deferred to the backlog. Focus on core SDK migration.

### Claude's Discretion

- Exact wording of the generic 10-second acknowledgment thought
- Whether to investigate API-driven agent name/avatar as a bonus (portal config is the primary path)
- Error message wording for the error activity on conversation failure
- Retry count and backoff timing for token refresh middleware

### Deferred Ideas (OUT OF SCOPE)

- **Agent Plans (LSDK-08):** Checklist-style progress in Linear UI mapped from task steps. Cut from v2.7 Phase 67. Add to backlog for future phase.
- **API-driven agent identity:** Investigate whether the Linear API supports setting agent display name and avatar programmatically (in addition to portal config). Nice-to-have, not blocking.

</user_constraints>

## Summary

Phase 67 migrates the Linear integration from comment-based communication to Linear's native Agent SDK. The existing `@linear/sdk@70.0.0` already includes all required methods (`createAgentActivity`, `agentSessionUpdate`, `AgentActivityCreateInput`, `AgentActivityType` enum). No SDK upgrade is needed. The migration touches four major areas: (1) token refresh middleware with dual-layer refresh strategy, (2) OAuth flow changes for `actor=app` with new scopes, (3) new MCP tools for agent activities replacing `create_comment` in the denormalizer path, and (4) `agentSessionId` tracking from webhook through adapter to denormalizer, plus echo filter removal.

The existing codebase already has webhook parsing for `AgentSessionEvent` (`created` and `prompted` actions), dispatch routes for both event types, and adapter handling for `linear.agent_session.created` and `linear.agent_session.prompted`. The main gaps are: (a) no `agentSessionId` in `LinearReplyContext`, (b) denormalizer only calls `create_comment` for Linear, (c) no `create_agent_activity` MCP tool exists, (d) token refresh is per-request-only with no proactive refresh timer, and (e) the echo filter via `LINEAR_BOT_USER_ID` still exists in the webhook handler.

**Primary recommendation:** Build the token refresh middleware first (prerequisite for everything else), then add activity MCP tools and OAuth changes, then wire the session ID tracking and denormalizer routing, and finally remove the echo filter and old comment path.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@linear/sdk` | 70.0.0 | Linear API client with `createAgentActivity` and `agentSessionUpdate` | Already installed, confirmed to include agent activity types and methods |
| `drizzle-orm` | ^0.45.1 | Database operations for credential store and schema | Already used across all integration packages |
| `zod` | (workspace) | Input/output validation for MCP tools and webhook payloads | Standard validation across all Aesir packages |
| `neverthrow` | ^8.2.0 | ResultAsync for service boundary error handling | Standard pattern in credential store |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `express` | ^4.21.0 | HTTP server for webhooks and MCP | Already used in linear integration |
| `pino` (via `@aesir/platform`) | - | Structured logging | All logging throughout the phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `setInterval` for proactive refresh | pg-boss delayed job | pg-boss adds operational dependency; `setInterval` is simpler for single-service deployment, and reactive 401 catches edge cases |
| Raw `fetch` for token refresh | `@linear/sdk` built-in refresh | The SDK does not have built-in proactive refresh; raw fetch to `https://api.linear.app/oauth/token` is already used in `factory.ts` |

**Installation:** No new packages needed. Everything is already in the workspace.

## Architecture Patterns

### Recommended File Changes Structure

```
packages/integrations/linear/src/
  client/
    factory.ts                  # MODIFY: Add token refresh middleware wrapper
    types.ts                    # MODIFY: Add refresh config to LinearOAuthConfig
    refresh-middleware.ts       # NEW: Dual-layer token refresh logic
  oauth/
    flow.ts                    # MODIFY: Thread refresh middleware through client creation
    token-store.ts             # MINOR: Ensure refresh_token always persisted for actor=app
  api/
    oauth.ts                   # MODIFY: Add actor=app to auth URL, new scopes
    webhooks.ts                # MODIFY: Remove echo filter, add 10s thought on session.created
  webhooks/
    parser.ts                  # MODIFY: Add promptContext to prompted schema
    types.ts                   # MODIFY: Add promptContext field
  mcp/
    tools/
      activities.ts            # NEW: create_agent_activity, update_session_state MCP tools
      index.ts                 # MODIFY: Export new tool handlers
    schemas.ts                 # MODIFY: Add activity tool schemas
    server.ts                  # MODIFY: Register new tools, keep create_comment
  types/
    config.ts                  # MODIFY: Remove LINEAR_BOT_USER_ID env var
  main.ts                      # MODIFY: Start proactive refresh timer
  db/
    schema.ts                  # NO CHANGE (credentials table already has refresh_token, expires_at)

packages/agents/src/
  adapters/
    linear.ts                  # MODIFY: Include agentSessionId in replyContext
    types.ts                   # NO CHANGE (replyContext is already optional)
  shared/
    communication/
      types.ts                 # MODIFY: Add agentSessionId to LinearReplyContextSchema
      denormalizer.ts          # MODIFY: Route to activity tools when agentSessionId present
    tools/
      communication/
        notify.ts              # MODIFY: Add intent parameter (reasoning/action)
        reply.ts               # NO CHANGE (denormalizer handles routing)
        ask.ts                 # NO CHANGE (denormalizer handles routing)
  framework/
    conversation-executor.ts   # MODIFY: Emit error activity on conversation failure
```

### Pattern 1: Dual-Layer Token Refresh Middleware

**What:** A wrapper around the LinearClient that handles both proactive (timer) and reactive (401-retry) token refresh.

**When to use:** Every MCP tool call that creates a LinearClient from database credentials.

**Example:**
```typescript
// Source: Verified against @linear/sdk@70.0.0 types + existing factory.ts pattern

interface RefreshMiddlewareOptions {
  credentialStore: LinearCredentialStore;
  workspaceId: string;
  logger: PinoLogger;
}

/**
 * Wraps LinearClient creation with 401 retry logic.
 * On 401, refreshes token and retries the operation once.
 */
async function withTokenRefresh<T>(
  operation: (client: LinearClient) => Promise<T>,
  options: RefreshMiddlewareOptions,
): Promise<T> {
  const client = await createLinearClientFromDatabase(options.workspaceId);
  try {
    return await operation(client);
  } catch (error) {
    if (isAuthError(error)) {
      options.logger.info("401 received, attempting token refresh");
      await refreshAndPersist(options);
      const freshClient = await createLinearClientFromDatabase(options.workspaceId);
      return operation(freshClient);
    }
    throw error;
  }
}

/**
 * Proactive refresh: setInterval at 80% token lifetime.
 * Started in main.ts on service boot.
 */
function startProactiveRefresh(options: RefreshMiddlewareOptions): NodeJS.Timeout {
  const CHECK_INTERVAL_MS = 60_000; // Check every minute
  return setInterval(async () => {
    const cred = await options.credentialStore.getByWorkspace(options.workspaceId);
    if (cred.isErr() || !cred.value) return;
    const { expiresAt, refreshToken } = cred.value;
    if (!expiresAt || !refreshToken) return;
    const lifetime = expiresAt.getTime() - cred.value.createdAt.getTime();
    const threshold = cred.value.createdAt.getTime() + lifetime * 0.8;
    if (Date.now() >= threshold) {
      await refreshAndPersist(options);
    }
  }, CHECK_INTERVAL_MS);
}
```

### Pattern 2: Activity MCP Tool with Content Type Dispatch

**What:** A single `create_agent_activity` MCP tool that accepts typed content payloads.

**When to use:** The denormalizer calls this tool instead of `create_comment` when `agentSessionId` is present.

**Example:**
```typescript
// Source: Verified against @linear/sdk@70.0.0 AgentActivityCreateInput type

// Input schema for the MCP tool
const CreateAgentActivityInputSchema = z.object({
  agentSessionId: z.string().min(1),
  type: z.enum(["thought", "action", "response", "error", "elicitation"]),
  body: z.string().optional(),       // For thought, response, error, elicitation
  action: z.string().optional(),     // For action type
  parameter: z.string().optional(),  // For action type
  result: z.string().optional(),     // For action type (completion result)
  ephemeral: z.boolean().optional(), // Only for thought and action types
});

// Build content payload based on type
function buildActivityContent(input: CreateAgentActivityInput): Record<string, unknown> {
  switch (input.type) {
    case "thought":
    case "response":
    case "error":
    case "elicitation":
      return { type: input.type, body: input.body };
    case "action":
      return {
        type: "action",
        action: input.action,
        parameter: input.parameter,
        ...(input.result && { result: input.result }),
      };
  }
}

// Handler
async function handleCreateAgentActivity(context, args, deps): Promise<MCPToolResult> {
  const client = await createLinearClientFromDatabase(deps.workspaceId);
  const input = CreateAgentActivityInputSchema.parse(args);
  const result = await client.createAgentActivity({
    agentSessionId: input.agentSessionId,
    content: buildActivityContent(input),
    ...(input.ephemeral !== undefined && { ephemeral: input.ephemeral }),
  });
  return createToolResult(context, `Activity created: ${input.type}`, { success: result.success });
}
```

### Pattern 3: Denormalizer Routing with Session ID

**What:** The denormalizer checks `replyContext.agentSessionId`: present -> activity tools, absent -> comment tools.

**When to use:** Every outbound Linear message from the denormalizer.

**Example:**
```typescript
// In denormalizer.ts
case "linear": {
  if (replyContext.agentSessionId) {
    // Agent session active: use typed activity
    return callMcpTool({
      integration: "linear",
      tool: "create_agent_activity",
      params: {
        agentSessionId: replyContext.agentSessionId,
        type: resolveActivityType(intent), // reply->response, ask->elicitation, etc.
        body: text,
      },
      ...mcpBase,
    });
  }
  // No session: fall back to comment (product-agent path)
  return callMcpTool({
    integration: "linear",
    tool: "create_comment",
    params: { issueId: replyContext.issueId, body: text },
    ...mcpBase,
  });
}
```

### Pattern 4: Session ID Flow Through Adapter

**What:** The `agentSessionId` flows from webhook payload through normalizer -> adapter -> replyContext -> denormalizer.

**When to use:** Both `agent_session.created` and `agent_session.prompted` events.

**Example:**
```typescript
// In linear adapter
case "linear.agent_session.created": {
  const issueId = payload.issueId as string;
  const sessionId = payload.sessionId as string; // Already in normalize.ts output
  return {
    type: "linear.agent_session.created",
    data: { issueId, sessionId },
    source: "linear:webhook",
    correlationKey: issueId,
    deduplicationId: event.correlationId,
    message: `New agent session created for issue ${issueId}`,
    replyContext: {
      channel: "linear" as const,
      issueId,
      agentSessionId: sessionId, // NEW: session ID in replyContext
    },
  };
}
```

### Anti-Patterns to Avoid

- **Don't build a client wrapper class around LinearClient.** Use the existing factory function pattern (`createLinearClientFromDatabase`) with the refresh middleware wrapping specific operations. The SDK client is stateless per-request.
- **Don't auto-emit activities from agent loop internals.** The context decisions are clear: infrastructure owns session creation acknowledgment and failure notification only. Agent owns everything in between via communication tools.
- **Don't keep `create_comment` in the denormalizer path for sessions.** When `agentSessionId` is present, always use `create_agent_activity`. The `create_comment` path is preserved ONLY for the product-agent flow (no agent session context).
- **Don't parse webhook payload for the 10-second acknowledgment.** It's a generic "Processing your request..." thought, not a dynamic message derived from issue content.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GraphQL agent activity mutations | Raw GraphQL queries | `linearClient.createAgentActivity()` | SDK v70.0.0 has typed methods, handles serialization and errors |
| OAuth token refresh endpoint | Custom HTTP client | Existing `refreshOAuthToken()` in `factory.ts` | Already handles the Linear token endpoint correctly |
| Webhook signature verification | New verification code | Existing `verifyWebhookSignature()` | Already timing-safe HMAC-SHA256 |
| Activity type content builders | Per-type factory classes | Simple switch statement in MCP tool handler | Only 5 types, each 2-3 fields, factory classes are over-engineering |
| Session state tracking | Custom state machine | Linear tracks session state automatically from activity emissions | Per docs: "tracks session lifecycle automatically based on the last emitted activity" |

**Key insight:** Linear manages session state automatically based on the last emitted activity type. The `response` activity moves to `complete`, `error` moves to `error`, `elicitation` moves to `awaitingInput`, and `thought`/`action` moves to `active`. Aesir does NOT need to call `agentSessionUpdate` for state changes -- just emit the right activity type and Linear handles the rest.

## Common Pitfalls

### Pitfall 1: Webhook 5-Second Response Deadline

**What goes wrong:** The webhook handler must respond within 5 seconds or Linear retries. If the 10-second acknowledgment thought blocks the webhook response, Linear will retry and you get duplicate events.

**Why it happens:** Linear webhook docs specify 5 seconds max response time. The acknowledgment thought requires a Linear API call (which could take 1-2 seconds).

**How to avoid:** Respond to the webhook immediately (HTTP 200), then emit the thought activity asynchronously. The 10-second deadline is for the activity to appear in the UI, not for the webhook response.

**Warning signs:** Duplicate `agent_session.created` events appearing in the event log. Linear retrying webhooks.

**Implementation pattern:**
```typescript
// In webhook handler for agent_session.created:
// 1. Respond immediately
res.status(200).json({ received: true });
// 2. Fire async thought emission (not awaited)
emitAcknowledgmentThought(payload.agentSession.id).catch(err => {
  logger.error({ err, sessionId: payload.agentSession.id }, "Failed to emit acknowledgment thought");
});
```

### Pitfall 2: Token Refresh Race Condition

**What goes wrong:** Multiple concurrent MCP tool calls get 401, all try to refresh simultaneously, leading to multiple refresh attempts with potentially stale refresh tokens.

**Why it happens:** Linear refresh tokens may be single-use (common OAuth pattern). Multiple concurrent refreshes with the same refresh token can cause all but one to fail.

**How to avoid:** Use a mutex/lock around the refresh operation. Only one refresh should proceed at a time; other callers wait for the result.

**Warning signs:** `invalid_grant` errors in refresh attempts despite having a valid refresh token.

**Implementation pattern:**
```typescript
let refreshPromise: Promise<void> | null = null;

async function refreshWithLock(options: RefreshMiddlewareOptions): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshAndPersist(options).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
```

### Pitfall 3: Content Payload as JSONObject, Not Typed Object

**What goes wrong:** The SDK's `AgentActivityCreateInput.content` field is typed as `Scalars["JSONObject"]` (i.e., `Record<string, unknown>`), not as a discriminated union. TypeScript won't catch malformed content at compile time.

**Why it happens:** Linear's GraphQL schema uses a generic JSON scalar for the content field. The SDK faithfully reflects this.

**How to avoid:** Build a Zod schema for each content type in the MCP tool input validation. Validate before calling the SDK. The MCP tool acts as the type-safety boundary.

**Warning signs:** Activities created with wrong field names (e.g., `text` instead of `body`) that show up empty in Linear's UI.

### Pitfall 4: Ephemeral Activities Only for Thought and Action

**What goes wrong:** Setting `ephemeral: true` on a `response` or `error` activity has no effect or causes unexpected behavior.

**Why it happens:** Linear documentation specifies ephemeral is limited to `thought` and `action` types only.

**How to avoid:** Only pass `ephemeral` when the activity type is `thought` or `action`. The MCP tool schema should validate this constraint.

**Warning signs:** Activities disappearing unexpectedly or not disappearing when expected.

### Pitfall 5: Prompted Event Missing promptContext

**What goes wrong:** The `prompted` webhook may include `promptContext` (formatted issue details + comments) that differs from the user's actual message. Using `promptContext` as the message text gives the agent confusing context.

**Why it happens:** The `promptContext` field is a formatted string Linear constructs from the issue and recent comments. The user's actual prompt is separate.

**How to avoid:** The current adapter already uses `payload.prompt ?? payload.body` for prompted events. Verify that the prompted webhook payload includes the user's message in a distinct field from `promptContext`. The Zod schema should be updated to include `promptContext` as optional for logging, but the user's message should be extracted from the prompt/body field.

**Warning signs:** Agent receiving full issue context as a "user message" rather than the actual follow-up prompt.

### Pitfall 6: OAuth Scopes Must Include actor=app AND Feature Scopes

**What goes wrong:** Requesting `actor=app` but forgetting `app:assignable` and `app:mentionable` scopes. The agent authenticates as an app but can't be assigned issues or @mentioned.

**Why it happens:** `actor=app` is a parameter, not a scope. The scopes are separate and must be explicitly requested alongside standard `read,write`.

**How to avoid:** The OAuth authorize URL must include both `actor=app` parameter and `scope=read,write,app:assignable,app:mentionable`.

**Warning signs:** Agent appears in workspace but not in mention menu or assignment dropdown.

## Code Examples

### Linear SDK: Create Agent Activity (Verified from SDK v70.0.0 typings)

```typescript
// Source: @linear/sdk@70.0.0 dist/index-CExL-wAi.d.mts lines 123-138, 241-248

import type { LinearClient } from "@linear/sdk";

// Thought activity
await client.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "thought",
    body: "Analyzing the issue requirements...",
  },
});

// Action activity
await client.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "action",
    action: "Creating",
    parameter: "branch feature/auth-middleware",
  },
});

// Action with result
await client.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "action",
    action: "Created",
    parameter: "branch feature/auth-middleware",
    result: "Branch created from main at commit abc1234",
  },
});

// Response activity (signals session complete)
await client.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "response",
    body: "Implementation complete. PR #42 created.",
  },
});

// Elicitation activity (signals awaiting input)
await client.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "elicitation",
    body: "Should I use JWT or session-based authentication?",
  },
});

// Error activity (signals error state)
await client.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "error",
    body: "Token budget exhausted after 45 iterations.",
  },
});

// Ephemeral thought (disappears after next activity)
await client.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "thought",
    body: "Searching codebase...",
  },
  ephemeral: true,
});
```

### Linear SDK: Activity Type Enum (Verified from SDK v70.0.0 typings)

```typescript
// Source: @linear/sdk@70.0.0 dist/index-CExL-wAi.d.mts lines 241-248

enum AgentActivityType {
  Action = "action",
  Elicitation = "elicitation",
  Error = "error",
  Prompt = "prompt",    // User-generated, agents cannot create this type
  Response = "response",
  Thought = "thought",
}
```

### Linear SDK: Session Status Enum (Verified from SDK v70.0.0 typings)

```typescript
// Source: @linear/sdk@70.0.0 dist/index-CExL-wAi.d.mts lines 438-445

enum AgentSessionStatus {
  Active = "active",
  AwaitingInput = "awaitingInput",
  Complete = "complete",
  Error = "error",
  Pending = "pending",
  Stale = "stale",        // Note: "stale" exists in SDK, not in our spec mapping
}
```

### OAuth Authorize URL with actor=app (Verified from existing oauth.ts)

```typescript
// Source: packages/integrations/linear/src/api/oauth.ts lines 70-82

const params = new URLSearchParams({
  client_id: config.linear.clientId,
  redirect_uri: config.linear.oauthCallbackUrl || `http://localhost:${config.server.port}/oauth/callback`,
  response_type: "code",
  state,
  scope: "read,write,app:assignable,app:mentionable",  // CHANGED: added agent scopes
  actor: "app",                                          // CHANGED: was "application"
});

const authorizeUrl = `https://linear.app/oauth/authorize?${params.toString()}`;
```

### Token Refresh Endpoint (Verified from existing factory.ts)

```typescript
// Source: packages/integrations/linear/src/client/factory.ts lines 48-83

const response = await fetch("https://api.linear.app/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }),
});

// Response shape:
interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;   // seconds until expiration
  token_type: string;
  scope: string;
}
```

### Webhook Payload: Prompted Event (agentSession.prompted)

```typescript
// Source: Verified from SDK types + existing webhook parser
// The prompted webhook includes the user's message and session context

interface AgentSessionPromptedPayload {
  type: "AgentSessionEvent";
  action: "prompted";
  webhookTimestamp: number;
  webhookId: string;
  agentSession: {
    id: string;          // Session ID (needed for reply activities)
    issueId: string;
    status: "active";
    url: string;
    creator?: { id: string };
  };
  promptContext?: string; // Formatted issue context (Linear-generated, not user message)
  // User's actual prompt text is in agentSession or a separate field
  // TODO: Verify exact field name for user prompt text in prompted events
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `actor=application` in OAuth URL | `actor=app` (deprecated old form) | Linear SDK updates | Must use `actor=app` in authorize URL, not `actor=application` |
| Manual session state management | Automatic state tracking from activities | Linear Agent SDK | No need to call `agentSessionUpdate` for state. Activity type drives state. |
| Comment-based agent communication | Typed activities (thought, action, response, elicitation, error) | Linear Agent SDK | Activities appear in dedicated sidebar, not in comment thread |
| Echo filtering via bot user ID | Structurally distinct types (prompt vs activity) | Linear Agent SDK | Agent activities are a different type from user prompts, no filtering needed |
| Long-lived tokens (~10 years) | Short-lived tokens with refresh (~24h) | `actor=app` OAuth flow | Refresh tokens become mandatory, proactive refresh critical |

**Deprecated/outdated:**
- `actor=application` parameter: Use `actor=app` instead (Linear deprecated the old form)
- `LINEAR_BOT_USER_ID` env var: No longer needed with agent activities (structurally distinct from user content)

## Discretion Recommendations

### 10-Second Acknowledgment Thought Wording

**Recommendation:** "Looking into this..."

**Reasoning:** Short, natural, and matches the ephemeral nature of the acknowledgment. Alternatives like "Processing your request..." sound robotic. This thought should use `ephemeral: true` so it disappears when the agent emits its first real activity.

### Error Activity Wording on Conversation Failure

**Recommendation:** Use brief, informative messages that tell the user what happened without technical jargon:
- Token budget exhausted: "I've run out of processing capacity for this request. Please try again or simplify the request."
- Agent aborted: "I encountered an issue I couldn't recover from. Please try again."
- Unrecoverable error: "Something went wrong. Please try again or contact support."

### Token Refresh Retry Count and Backoff

**Recommendation:** 3 retries with exponential backoff (1s, 2s, 4s).

**Reasoning:** Transient failures (network blips, rate limits) typically resolve within a few seconds. Beyond 3 retries (~7s total), the issue is likely non-transient (revoked token, invalid grant). Keeping it fast is important because the MCP tool call is blocking.

```typescript
const REFRESH_RETRY_DELAYS = [1000, 2000, 4000]; // 3 attempts, ~7s total
```

## Open Questions

1. **Prompted event user message field**
   - What we know: The `prompted` webhook includes `promptContext` (Linear-generated formatted context) and the session object. The current adapter uses `payload.prompt ?? payload.body` from the normalized event.
   - What's unclear: The exact field name where the user's actual follow-up message appears in the raw prompted webhook payload. The SDK types show `promptContext` on the webhook payload but not a dedicated `prompt` field.
   - Recommendation: During implementation, log the raw prompted webhook payload to identify the exact field. The normalizer in `normalize.ts` currently extracts from `payload.prompt ?? payload.body` which suggests the field exists but needs verification. LOW confidence on exact field name.

2. **Token lifetime for actor=app**
   - What we know: Current tokens are long-lived (~10 years, no refresh). The `actor=app` flow returns short-lived tokens with refresh tokens. The research references mention the April 2026 deadline for token migration.
   - What's unclear: Exact token lifetime for `actor=app` tokens. The proactive refresh at 80% lifetime (~19h) suggests ~24h tokens, but this needs verification.
   - Recommendation: During implementation, log the `expires_in` value from the initial token exchange. The proactive refresh timer will adapt to whatever lifetime is returned. If tokens are shorter (e.g., 1 hour), the check interval should be more frequent than 60 seconds.

3. **Action activity rendering in Linear UI**
   - What we know: The `action` type has `action`, `parameter`, and optional `result` fields. From the context: "Research should verify Linear's `action` activity type behavior and rendering in the issue sidebar."
   - What's unclear: Exactly how `action` activities render (as expandable cards? inline text? with icons?).
   - Recommendation: Accept that rendering is Linear's concern. Emit well-structured actions with clear `action` verbs and `parameter` descriptions. Verify during testing that they appear as expected.

## Sources

### Primary (HIGH confidence)
- `@linear/sdk@70.0.0` type definitions (`index-CExL-wAi.d.mts`) - Verified `createAgentActivity`, `AgentActivityCreateInput`, `AgentActivityType`, `AgentSessionStatus`, `AgentSessionUpdateInput` types
- Existing codebase files (oauth.ts, factory.ts, webhooks.ts, denormalizer.ts, adapter/linear.ts, types.ts) - Current implementation verified
- Linear Developer Docs: [Agent Interactions](https://linear.app/developers/agent-interaction) - Activity types, content structures, GraphQL mutations, session state management, SDK usage
- Linear Developer Docs: [Getting Started](https://linear.app/developers/agents) - Authentication, scopes, session lifecycle, 10-second requirement
- Linear Developer Docs: [OAuth Actor Authorization](https://linear.app/developers/oauth-actor-authorization) - `actor=app` parameter, token behavior

### Secondary (MEDIUM confidence)
- Linear Developer Docs: [Webhooks](https://linear.app/developers/webhooks) - 5-second response deadline, retry behavior (3 retries)
- Session state auto-tracking claim from agent interaction docs ("tracks session lifecycle automatically based on the last emitted activity")

### Tertiary (LOW confidence)
- Exact prompted webhook payload field for user's message text (inferred from existing adapter code, not directly verified from docs)
- Token lifetime for `actor=app` tokens (~24h assumed from context decisions, needs runtime verification)
- `action` activity type rendering behavior in Linear UI (documented structure verified, visual rendering unverified)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - SDK v70.0.0 typings verified, all required methods exist
- Architecture: HIGH - Existing codebase patterns well understood, clear modification points identified
- Pitfalls: HIGH - Webhook deadline, token race condition, JSONObject typing all verified from docs/SDK
- Discretion items: MEDIUM - Recommendations based on engineering judgment, not hard requirements

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable - Linear Agent SDK is established, not fast-moving)
