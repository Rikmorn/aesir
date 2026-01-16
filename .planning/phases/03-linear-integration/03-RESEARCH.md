# Phase 3: Linear Integration - Research

**Researched:** 2026-01-16
**Domain:** Linear API integration for AI agent workflow
**Confidence:** HIGH

<research_summary>
## Summary

Researched Linear's ecosystem for building an AI agent that reads/updates tasks via webhooks. The key discovery is that Linear has a dedicated **Agent Interaction SDK** released in 2025, providing first-class support for AI agents including agent sessions, semantic activities (thoughts, actions, responses), and delegation webhooks.

The standard approach uses the `@linear/sdk` TypeScript SDK with OAuth 2.0 authentication using `actor=app` mode. This makes the agent appear as an application (not a user), satisfying LIN-04. Agent delegation triggers webhook events, and the agent communicates progress via typed activities that appear in Linear's UI.

Key insight: Don't build a generic webhook handler. Use Linear's Agent Interaction framework which provides structured session lifecycle, user context via `promptContext`, and semantic activity types that render properly in Linear's UI.

**Primary recommendation:** Use OAuth 2.0 with `actor=app` + Agent Interaction SDK + typed activities. This gives native Linear agent UX rather than appearing as a generic bot.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @linear/sdk | 70.0.0 | Typed GraphQL client | Official SDK, auto-generated from production API, full type definitions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto | Built-in | Webhook signature verification | HMAC-SHA256 for all webhook handlers |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @linear/sdk | Raw GraphQL | SDK is strongly typed, handles pagination; raw GraphQL only if SDK missing feature |
| Custom integration | Linear MCP Server | MCP good for Claude Desktop/Cursor, but we need programmatic control for agent workflow |
| Polling | Webhooks | Webhooks are required (LIN-03), polling burns rate limits and adds latency |

**Installation:**
```bash
npm install @linear/sdk
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── integrations/
│   └── linear/
│       ├── client.ts          # LinearClient factory with OAuth token
│       ├── webhooks.ts        # Webhook handler + signature verification
│       ├── agent-session.ts   # Agent session lifecycle management
│       └── activities.ts      # Typed activity emitters
├── types/
│   └── linear.ts              # Shared types/interfaces
└── config/
    └── linear.ts              # OAuth config, webhook secret
```

### Pattern 1: OAuth 2.0 with Actor=App
**What:** Authentication that makes agent appear as application, not user
**When to use:** Always for agent integrations (LIN-04 requirement)
**Example:**
```typescript
// OAuth authorization URL with actor=app
const authUrl = new URL('https://linear.app/oauth/authorize');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'read write app:assignable app:mentionable');
authUrl.searchParams.set('actor', 'app'); // Critical: makes agent appear as app

// Token exchange
const tokenResponse = await fetch('https://api.linear.app/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authCode,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  }),
});
```

### Pattern 2: Webhook Signature Verification
**What:** HMAC-SHA256 verification of webhook payloads
**When to use:** All webhook handlers (security requirement)
**Example:**
```typescript
// Source: Linear official docs
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyWebhookSignature(
  signature: string,
  rawBody: string,
  secret: string
): boolean {
  const headerSignature = Buffer.from(signature, 'hex');
  const computedSignature = createHmac('sha256', secret)
    .update(rawBody)
    .digest();
  return timingSafeEqual(computedSignature, headerSignature);
}

// Usage in handler
const signature = request.headers.get('linear-signature');
const rawBody = await request.text();

if (!verifyWebhookSignature(signature, rawBody, WEBHOOK_SECRET)) {
  return new Response('Invalid signature', { status: 401 });
}

// Also validate timestamp to prevent replay attacks
const payload = JSON.parse(rawBody);
const timestamp = payload.webhookTimestamp;
const now = Date.now();
if (Math.abs(now - timestamp) > 60_000) {
  return new Response('Stale webhook', { status: 400 });
}
```

### Pattern 3: Agent Session Activities
**What:** Emit typed activities to communicate agent progress
**When to use:** After receiving delegation webhook, during task execution
**Example:**
```typescript
// Source: Linear Agent Interaction docs
import { LinearClient } from '@linear/sdk';

const linearClient = new LinearClient({ accessToken: oauthToken });

// Acknowledge session immediately (within 10 seconds)
await linearClient.createAgentActivity({
  agentSessionId: session.id,
  content: { type: 'thought', body: 'Analyzing task requirements...' }
});

// Emit action when doing something
await linearClient.createAgentActivity({
  agentSessionId: session.id,
  content: {
    type: 'action',
    action: 'Reading',
    parameter: 'linked GitHub repository'
  }
});

// Final response when done
await linearClient.createAgentActivity({
  agentSessionId: session.id,
  content: {
    type: 'response',
    body: 'Created PR #42 with implementation. Ready for review.'
  }
});

// Or report error
await linearClient.createAgentActivity({
  agentSessionId: session.id,
  content: { type: 'error', body: 'Failed to access repository: permission denied' }
});
```

### Pattern 4: Agent Plan Updates
**What:** Update task progress with checklist items
**When to use:** Multi-step tasks where user should see progress
**Example:**
```typescript
// Source: Linear Agent Interaction docs
await linearClient.agentSessionUpdate({
  id: session.id,
  plan: [
    { content: 'Read task requirements', status: 'completed' },
    { content: 'Generate implementation', status: 'inProgress' },
    { content: 'Run tests', status: 'pending' },
    { content: 'Create pull request', status: 'pending' }
  ]
});
```

### Anti-Patterns to Avoid
- **Using API key instead of OAuth:** Actions attributed to personal account, not agent
- **Polling for changes:** Burns rate limits, violates LIN-03, webhooks are the pattern
- **Not verifying webhook signatures:** Security vulnerability
- **Slow webhook response (>5s):** Linear retries, may disable webhook
- **Not emitting activity within 10s:** Session marked unresponsive
- **Modifying plan items individually:** Must replace entire array
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GraphQL queries | Custom fetch calls | @linear/sdk | SDK is typed, handles pagination, matches production API |
| Webhook verification | Custom crypto logic | Pattern from docs (see above) | Must use timing-safe comparison, raw body |
| OAuth token refresh | Manual token management | SDK handles if using OAuth | Tokens expire after 24h (post Oct 2025) |
| Agent UI rendering | Custom webhook responses | Agent Activity types | Activities render natively in Linear UI |
| Session state tracking | Custom state machine | Linear's session states | Linear tracks pending/active/complete automatically |

**Key insight:** Linear's Agent Interaction framework is purpose-built for AI agents. Fighting it by building generic webhook handlers means losing the native UX (activities in sidebar, plans as checklists, proper attribution).
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Webhook Response Timeout
**What goes wrong:** Webhook disabled after repeated failures
**Why it happens:** Handler takes >5 seconds to respond, or doesn't return 200
**How to avoid:** Respond 200 immediately, process async; emit activity within 10s
**Warning signs:** Webhook events stop arriving, "unresponsive" session status

### Pitfall 2: Using Personal API Key for Agent
**What goes wrong:** Agent actions appear as personal user, consume seat
**Why it happens:** API key is easiest auth method, but wrong for agents
**How to avoid:** Use OAuth 2.0 with `actor=app` parameter
**Warning signs:** Agent activity shows personal name instead of app name

### Pitfall 3: Parsing JSON Before Signature Verification
**What goes wrong:** Signature verification fails even with correct secret
**Why it happens:** JSON.parse then JSON.stringify changes whitespace/ordering
**How to avoid:** Verify signature against raw request body string
**Warning signs:** All webhooks fail signature verification

### Pitfall 4: Missing Scopes for Agent Features
**What goes wrong:** 403 errors when trying to be mentioned/assigned
**Why it happens:** Didn't request `app:assignable` and `app:mentionable` scopes
**How to avoid:** Include these scopes in OAuth authorization URL
**Warning signs:** Agent doesn't appear in @mention or assignee dropdowns

### Pitfall 5: Stale OAuth Token After 24 Hours
**What goes wrong:** API calls fail with 401 after working initially
**Why it happens:** Post Oct 2025 OAuth tokens expire in 24h, must refresh
**How to avoid:** Implement token refresh logic, store refresh_token
**Warning signs:** Integration works initially, breaks next day

### Pitfall 6: Not Handling Agent Session Lifecycle
**What goes wrong:** Sessions stuck in "pending" or "active" forever
**Why it happens:** Not emitting response/error activity to close session
**How to avoid:** Always emit `response` or `error` activity when done
**Warning signs:** Old sessions appear active in Linear UI
</common_pitfalls>

<code_examples>
## Code Examples

### LinearClient Factory with OAuth
```typescript
// Source: Linear SDK docs + OAuth actor docs
import { LinearClient } from '@linear/sdk';

interface LinearConfig {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function createLinearClient(config: LinearConfig): Promise<LinearClient> {
  // Check if token needs refresh (24h expiry post Oct 2025)
  if (Date.now() >= config.expiresAt - 60_000) {
    const refreshed = await refreshOAuthToken(config.refreshToken);
    config.accessToken = refreshed.accessToken;
    config.expiresAt = Date.now() + refreshed.expiresIn * 1000;
    // Persist updated config
  }

  return new LinearClient({ accessToken: config.accessToken });
}
```

### Webhook Handler Skeleton
```typescript
// Source: Linear Webhooks docs
import { createHmac, timingSafeEqual } from 'node:crypto';

interface WebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: string;
  data: unknown;
  webhookTimestamp: number;
  webhookId: string;
}

interface AgentSessionPayload {
  action: 'created' | 'prompted';
  type: 'AgentSession';
  data: {
    id: string;
    issueId: string;
    promptContext?: string; // Formatted context for agent
  };
  agentActivity?: {
    body: string; // Follow-up prompt from user
  };
}

export async function handleLinearWebhook(request: Request): Promise<Response> {
  const signature = request.headers.get('linear-signature');
  const rawBody = await request.text();

  // 1. Verify signature
  if (!verifySignature(signature!, rawBody, process.env.LINEAR_WEBHOOK_SECRET!)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  // 2. Validate timestamp (prevent replay)
  if (Math.abs(Date.now() - payload.webhookTimestamp) > 60_000) {
    return new Response('Stale', { status: 400 });
  }

  // 3. Respond immediately (must be <5s)
  // Process async after response
  setImmediate(() => processWebhook(payload));

  return new Response('OK', { status: 200 });
}

function verifySignature(sig: string, body: string, secret: string): boolean {
  const headerSig = Buffer.from(sig, 'hex');
  const computed = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(computed, headerSig);
}
```

### Agent Session Handler
```typescript
// Source: Linear Agent Interaction docs
import { LinearClient } from '@linear/sdk';

export async function handleAgentSession(
  payload: AgentSessionPayload,
  linearClient: LinearClient
): Promise<void> {
  const sessionId = payload.data.id;

  if (payload.action === 'created') {
    // New delegation - acknowledge immediately
    await linearClient.createAgentActivity({
      agentSessionId: sessionId,
      content: { type: 'thought', body: 'Processing task...' }
    });

    // Get issue context
    const issue = await linearClient.issue(payload.data.issueId);
    const context = payload.data.promptContext; // Pre-formatted by Linear

    // Start agent workflow (your implementation)
    await startAgentWorkflow(sessionId, issue, context, linearClient);
  } else if (payload.action === 'prompted') {
    // User sent follow-up - handle continuation
    const prompt = payload.agentActivity?.body;
    await handleFollowUp(sessionId, prompt, linearClient);
  }
}
```

### Issue Status Update
```typescript
// Source: Linear SDK docs
import { LinearClient } from '@linear/sdk';

export async function updateIssueStatus(
  linearClient: LinearClient,
  issueId: string,
  statusName: 'In Progress' | 'Done' | 'Todo'
): Promise<void> {
  // Get issue to find team
  const issue = await linearClient.issue(issueId);
  const team = await issue.team;

  // Get workflow states for team
  const states = await team?.states();
  const targetState = states?.nodes.find(s => s.name === statusName);

  if (!targetState) {
    throw new Error(`State "${statusName}" not found for team`);
  }

  // Update issue
  await linearClient.updateIssue(issueId, {
    stateId: targetState.id
  });
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Generic webhooks | Agent Interaction SDK | July 2025 | Native agent UX with activities, sessions, plans |
| API key auth | OAuth with actor=app | 2024 | Agent appears as app, not user |
| Access tokens forever | 24h expiry + refresh | Oct 2025 | Must implement token refresh logic |
| Custom MCP server | Linear's official MCP | May 2025 | For Claude Desktop/Cursor; we use direct SDK |
| Issue.delegate = assignee | Separate delegate field | 2025 | User stays assignee, agent is delegate |

**New tools/patterns to consider:**
- **Agent Interaction SDK**: First-class agent support with semantic activities
- **promptContext field**: Pre-formatted context in delegation webhooks (reduces API calls)
- **Agent Plans**: Checklist items that render in Linear UI for multi-step tasks

**Deprecated/outdated:**
- **actor=application**: Use `actor=app` instead
- **Community MCP servers**: Use official Linear MCP server if using MCP
- **Issue.delegate mirroring**: No longer mirrors to assignee field
</sota_updates>

<open_questions>
## Open Questions

1. **OAuth App Registration**
   - What we know: Need to create OAuth app in Linear settings
   - What's unclear: Exact scopes needed for all operations; approval process if any
   - Recommendation: Test with minimal scopes, add as needed

2. **Webhook Endpoint Hosting**
   - What we know: Must be HTTPS, publicly accessible, respond in <5s
   - What's unclear: Best hosting approach for this project (serverless vs always-on)
   - Recommendation: Decide during planning based on existing infra

3. **Multi-workspace Support**
   - What we know: Each workspace gets unique app ID, tokens are workspace-scoped
   - What's unclear: Whether Aesir needs multi-workspace support
   - Recommendation: Design for single workspace initially, abstract token storage
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [Linear Developers - OAuth Actor Authorization](https://linear.app/developers/oauth-actor-authorization) - actor=app setup
- [Linear Developers - Webhooks](https://linear.app/developers/webhooks) - webhook setup, signature verification
- [Linear Developers - Agent Interaction](https://linear.app/developers/agent-interaction) - activities, sessions, plans
- [Linear Developers - Getting Started (Agents)](https://linear.app/developers/agents) - agent setup, scopes
- [Linear Developers - SDK](https://linear.app/developers/sdk) - SDK usage
- [Linear Developers - GraphQL](https://linear.app/developers/graphql) - API operations
- [Linear Developers - Rate Limiting](https://linear.app/developers/rate-limiting) - limits and headers
- [@linear/sdk npm](https://www.npmjs.com/package/@linear/sdk) - version 70.0.0

### Secondary (MEDIUM confidence)
- [GitHub linear/linear](https://github.com/linear/linear) - SDK source, verified open source

### Tertiary (LOW confidence - needs validation)
- None - all findings from official Linear documentation
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Linear GraphQL API + @linear/sdk
- Ecosystem: OAuth 2.0, Webhooks, Agent Interaction SDK
- Patterns: actor=app auth, webhook verification, agent activities
- Pitfalls: Token expiry, signature verification, session lifecycle

**Confidence breakdown:**
- Standard stack: HIGH - official SDK, documented
- Architecture: HIGH - patterns from official docs
- Pitfalls: HIGH - documented in official troubleshooting
- Code examples: HIGH - adapted from official documentation

**Research date:** 2026-01-16
**Valid until:** 2026-02-16 (30 days - Linear API is stable)
</metadata>

---

*Phase: 03-linear-integration*
*Research completed: 2026-01-16*
*Ready for planning: yes*
