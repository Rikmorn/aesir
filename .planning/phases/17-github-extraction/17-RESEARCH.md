# Phase 17: GitHub Extraction - Research

**Researched:** 2026-01-21
**Domain:** GitHub Integration Package Extraction
**Confidence:** HIGH

## Summary

This phase extracts the GitHub integration from `@aesir/integrations` into a standalone package `@aesir/integration-github`, following the pattern established by Phase 16 (Linear Extraction). The current GitHub integration consists of Octokit client operations (branches, commits, pull requests) without OAuth flow or webhook handling - these exist separately in `@aesir/agents`.

The extraction should:
1. Move GitHub-specific code from `packages/integrations/src/github/` to `packages/integrations/github/`
2. Add GitHub-specific database schema (`github.*`) for credentials and webhook deliveries
3. Implement OAuth flow (GitHub App or OAuth App authentication)
4. Add webhook signature verification using `X-Hub-Signature-256`
5. Create HTTP API layer with Express for webhooks and OAuth

**Primary recommendation:** Follow the Linear extraction pattern exactly, adapting for GitHub-specific authentication (GitHub Apps recommended over OAuth Apps) and webhook signature format (sha256= prefix instead of plain hex).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @octokit/rest | ^22.0.1 | GitHub REST API client | Already in use, provides convenience methods |
| @octokit/webhooks | ^13.x | Webhook signature verification | Official library, handles X-Hub-Signature-256 |
| @octokit/auth-app | ^7.x | GitHub App authentication | Standard for GitHub App JWT/installation tokens |
| express | ^4.21.0 | HTTP framework | Established pattern from Linear extraction |
| drizzle-orm | ^0.45.1 | Database ORM | Consistent with platform |
| neverthrow | ^8.2.0 | Result types | Consistent with Linear package |
| zod | 3.25.67 | Schema validation | Consistent with platform |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @octokit/webhooks-methods | ^5.x | Low-level signature verification | If not using full @octokit/webhooks |
| @octokit/auth-token | - | Token authentication | Already bundled with @octokit/rest |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @octokit/webhooks | Manual HMAC | Library handles edge cases, but adds dependency |
| GitHub App auth | OAuth App auth | OAuth Apps simpler but less secure, no fine-grained permissions |

**Installation:**
```bash
pnpm add @octokit/rest @octokit/webhooks @octokit/auth-app express drizzle-orm neverthrow zod pg
pnpm add -D @types/express @types/pg vitest typescript drizzle-kit
```

## Architecture Patterns

### Recommended Project Structure
```
packages/integrations/github/
├── src/
│   ├── api/           # HTTP routes (webhooks, oauth)
│   │   ├── routes.ts
│   │   ├── webhooks.ts
│   │   └── oauth.ts
│   ├── client/        # Octokit client factory
│   │   ├── factory.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── db/            # Database schema and credential store
│   │   ├── schema.ts
│   │   ├── schema.drizzle.ts
│   │   ├── client.ts
│   │   ├── credential-store.ts
│   │   ├── encryption.ts
│   │   └── migrations/
│   ├── oauth/         # OAuth/GitHub App token management
│   │   ├── flow.ts
│   │   └── token-store.ts
│   ├── operations/    # Branch, commit, PR operations (moved from current)
│   │   ├── branches.ts
│   │   ├── commits.ts
│   │   └── pull-requests.ts
│   ├── webhooks/      # Webhook signature verification and parsing
│   │   ├── signature.ts
│   │   ├── parser.ts
│   │   └── types.ts
│   ├── types/         # Config, errors
│   │   ├── config.ts
│   │   └── errors.ts
│   ├── index.ts       # Public exports
│   └── main.ts        # Service entry point
├── Dockerfile
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── .env.example
└── README.md
```

### Pattern 1: Webhook Signature Verification (GitHub-specific)
**What:** GitHub uses `X-Hub-Signature-256` header with `sha256=` prefix
**When to use:** All incoming webhooks
**Example:**
```typescript
// Source: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
import { verify } from "@octokit/webhooks-methods";

export async function verifyWebhookSignature(
  signature: string,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  // GitHub signature format: "sha256=<hex-digest>"
  // @octokit/webhooks-methods handles the prefix
  return verify(secret, rawBody, signature);
}
```

### Pattern 2: GitHub App Authentication
**What:** Authenticate as GitHub App installation for repository access
**When to use:** When acting on behalf of an installation (not a user)
**Example:**
```typescript
// Source: https://github.com/octokit/auth-app.js
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export function createGitHubAppClient(options: {
  appId: number;
  privateKey: string;
  installationId: number;
}): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: options.appId,
      privateKey: options.privateKey,
      installationId: options.installationId,
    },
  });
}
```

### Pattern 3: Token-based Authentication (Current)
**What:** Simple PAT or OAuth token authentication
**When to use:** Testing, simple integrations, user-delegated access
**Example:**
```typescript
// Source: Current codebase (packages/integrations/src/github/client.ts)
import { Octokit } from "@octokit/rest";

export function createGitHubClient(config: GitHubConfig): Octokit {
  return new Octokit({
    auth: config.token,
  });
}
```

### Pattern 4: Database Credential Store with ResultAsync
**What:** Store encrypted credentials with explicit error handling
**When to use:** All credential operations at service boundaries
**Example:**
```typescript
// Source: Linear extraction pattern (credential-store.ts)
import { fromPromise, type ResultAsync } from "neverthrow";
import { GitHubError } from "../types/errors.js";

export function createGitHubCredentialStore(
  options: GitHubCredentialStoreOptions,
): GitHubCredentialStore {
  const { db, logger } = options;

  return {
    store(input: StoreCredentialInput): ResultAsync<string, GitHubError> {
      return fromPromise(storeCredentialImpl(db, logger, input), (error) => {
        logger.error({ err: error }, "Failed to store GitHub credential");
        return new GitHubError("INT_GITHUB_TOKEN", "Failed to store credential", {
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      });
    },
    // ... other methods
  };
}
```

### Anti-Patterns to Avoid
- **Parsing JSON before signature verification:** Always use raw body string for HMAC verification
- **Using `===` for signature comparison:** Use timing-safe comparison to prevent timing attacks
- **Long-lived tokens without refresh:** GitHub App installation tokens expire in 1 hour
- **Storing unencrypted tokens:** Always encrypt at rest

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature | Manual HMAC | @octokit/webhooks-methods | Handles sha256= prefix, timing-safe comparison |
| GitHub App JWT | Manual JWT signing | @octokit/auth-app | Handles token refresh, expiry |
| API pagination | Manual page tracking | Octokit pagination helpers | Built into @octokit/rest |
| Rate limit handling | Manual retry logic | Octokit throttling plugin | Automatic backoff |

**Key insight:** The Octokit ecosystem has solved most GitHub integration problems. Using manual implementations increases risk of security vulnerabilities (timing attacks, improper signature handling).

## Common Pitfalls

### Pitfall 1: Raw Body Handling for Webhooks
**What goes wrong:** Using `express.json()` middleware parses the body, then `JSON.stringify()` produces different output
**Why it happens:** JSON serialization is not deterministic (whitespace, key order)
**How to avoid:** Use `express.raw({ type: 'application/json' })` and convert buffer to string
**Warning signs:** Signature verification always fails

### Pitfall 2: X-Hub-Signature-256 Format
**What goes wrong:** Expecting plain hex signature like Linear, but GitHub prefixes with `sha256=`
**Why it happens:** Different webhook providers use different formats
**How to avoid:** Use @octokit/webhooks-methods which handles the prefix
**Warning signs:** Signature verification fails even with correct secret

### Pitfall 3: GitHub App Installation ID Management
**What goes wrong:** Hardcoding installation ID or not tracking which repos belong to which installation
**Why it happens:** GitHub Apps can be installed on multiple orgs/repos
**How to avoid:** Store installation ID with credentials, use webhook events to track installations
**Warning signs:** API calls fail with "Not Found" for some repos

### Pitfall 4: Token Expiry for GitHub Apps
**What goes wrong:** Installation access tokens expire after 1 hour
**Why it happens:** GitHub Apps use short-lived tokens for security
**How to avoid:** Use @octokit/auth-app which handles automatic refresh
**Warning signs:** Intermittent 401 errors after ~1 hour of operation

### Pitfall 5: Webhook Event Header Name
**What goes wrong:** Using wrong header name for delivery ID
**Why it happens:** GitHub uses `X-GitHub-Delivery`, Linear uses `linear-delivery`
**How to avoid:** Check official docs for header names
**Warning signs:** Idempotency tracking fails

## Code Examples

Verified patterns from official sources:

### Webhook Handler (Express)
```typescript
// Source: Linear extraction pattern + GitHub docs
import type { Request, Response } from "express";
import { verify } from "@octokit/webhooks-methods";

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const deliveryId = req.headers["x-github-delivery"] as string | undefined;
  const eventType = req.headers["x-github-event"] as string | undefined;

  if (!signature || !deliveryId || !eventType) {
    res.status(400).json({ error: "Missing required headers" });
    return;
  }

  // Get raw body as string
  const rawBody = req.body.toString("utf-8");

  // Verify signature (timing-safe)
  const valid = await verify(process.env.GITHUB_WEBHOOK_SECRET!, rawBody, signature);
  if (!valid) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Parse and handle event
  const payload = JSON.parse(rawBody);
  // ... handle based on eventType

  res.status(200).json({ received: true });
}
```

### OAuth Flow (Web Application Flow)
```typescript
// Source: GitHub OAuth docs + Linear extraction pattern
export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const router = Router();

  router.get("/authorize", (_req, res) => {
    const state = generateState();
    oauthStates.set(state, { created: Date.now() });

    const params = new URLSearchParams({
      client_id: config.github.clientId,
      redirect_uri: config.github.oauthCallbackUrl,
      scope: "repo,read:org", // Adjust scopes as needed
      state,
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get("/callback", async (req, res) => {
    const { code, state } = req.query;
    // Validate state, exchange code for token
    // Store token in database
  });

  return router;
}
```

### Database Schema
```typescript
// Source: Linear extraction pattern
import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";

export const githubSchema = pgSchema("github");

export const credentials = githubSchema.table(
  "credentials",
  {
    id: text("id").primaryKey(),
    installation_id: text("installation_id"), // For GitHub Apps
    owner: text("owner").notNull(), // org or user
    encrypted_access_token: text("encrypted_access_token").notNull(),
    encrypted_refresh_token: text("encrypted_refresh_token"),
    token_type: text("token_type").default("Bearer"),
    scope: text("scope"),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("credentials_owner_unique").on(table.owner),
  ],
);

export const webhookDeliveries = githubSchema.table(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    delivery_id: text("delivery_id").notNull().unique(), // X-GitHub-Delivery
    event_type: text("event_type").notNull(),
    payload_hash: text("payload_hash"),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OAuth Apps | GitHub Apps | 2019+ | Better security, fine-grained permissions |
| X-Hub-Signature (SHA1) | X-Hub-Signature-256 (SHA256) | 2021 | Stronger signature algorithm |
| Long-lived PATs | Fine-grained PATs | 2022 | Repository-scoped tokens |
| Manual token management | @octokit/auth-app | Ongoing | Automatic refresh handling |

**Deprecated/outdated:**
- `X-Hub-Signature` header (SHA1): Use `X-Hub-Signature-256` (SHA256) instead
- Classic PATs with broad scopes: Migrate to fine-grained PATs or GitHub Apps

## Open Questions

Things that couldn't be fully resolved:

1. **GitHub App vs OAuth App Decision**
   - What we know: GitHub Apps are recommended for better security and granular permissions
   - What's unclear: Whether the current use case requires user-delegated access or app-level access
   - Recommendation: Start with OAuth App (simpler, current token approach compatible), add GitHub App support later if needed

2. **Webhook Events to Handle**
   - What we know: Current code handles `pull_request_review` events in agents
   - What's unclear: Full list of events the extracted package should handle
   - Recommendation: Move `pull_request_review` handling to GitHub package, expose event types for agents to subscribe

3. **Credential Model: Per-User vs Per-Installation**
   - What we know: Linear uses workspace-based credentials
   - What's unclear: Whether GitHub should use per-user (OAuth) or per-installation (App) model
   - Recommendation: Support both - `owner` field for OAuth, `installation_id` for GitHub Apps

## Sources

### Primary (HIGH confidence)
- [GitHub Docs - Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) - Signature verification
- [GitHub Docs - Differences between GitHub Apps and OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps) - Authentication model
- [@octokit/webhooks GitHub](https://github.com/octokit/webhooks.js) - Webhook library
- [@octokit/auth-app GitHub](https://github.com/octokit/auth-app.js) - App authentication
- Current codebase: `packages/integrations/linear/` - Extraction pattern reference

### Secondary (MEDIUM confidence)
- [@octokit/webhooks-methods npm](https://www.npmjs.com/package/@octokit/webhooks-methods) - Low-level verification
- [Nango Blog - GitHub App vs GitHub OAuth](https://nango.dev/blog/github-app-vs-github-oauth) - Comparison overview

### Tertiary (LOW confidence)
- None - all findings verified with official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing @octokit libraries, proven in production
- Architecture: HIGH - Following established Linear extraction pattern exactly
- Pitfalls: HIGH - Based on official GitHub docs and verified patterns

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (stable domain, 30 days appropriate)
