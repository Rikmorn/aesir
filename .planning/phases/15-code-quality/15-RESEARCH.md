# Phase 15: Code Quality - Research

**Researched:** 2026-01-21
**Domain:** Error handling, validation, module organization, dead code detection
**Confidence:** HIGH

## Summary

This phase establishes consistent error handling, validation, and type safety patterns across the codebase. The key changes are:

1. **Result types at service boundaries** - Using neverthrow library to return `Result<T, E>` instead of throwing exceptions
2. **Zod validation for external inputs** - Webhook payloads and HTTP endpoints must validate incoming data
3. **Barrel exports via index.ts** - Each package exports public API only through index.ts
4. **Error hierarchy** - AppError base class in common package with domain-specific subclasses
5. **Dead code removal** - Using knip (successor to ts-prune) to find and remove unused exports

**Primary recommendation:** Install neverthrow, create AppError hierarchy in common package, wrap existing service boundaries with Result types, and run knip to identify dead code.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| neverthrow | 8.2.0 | Result type error handling | TypeScript-first, simple API, good ESLint plugin, gradual adoption |
| zod | 3.25.67 (installed) | Schema validation | Already in use for config, TypeScript-first, runtime validation |
| knip | latest | Dead code detection | Replaces ts-prune (maintenance mode), finds unused exports/dependencies/files |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| eslint-plugin-neverthrow | latest | Enforce Result consumption | Prevents forgetting to handle Results |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| neverthrow | Effect.ts | Effect is more powerful but huge paradigm shift - OUT OF SCOPE per REQUIREMENTS.md |
| knip | ts-prune | ts-prune is in maintenance mode, knip is actively maintained with more features |

**Installation:**
```bash
pnpm add neverthrow
pnpm add -D knip eslint-plugin-neverthrow
```

## Architecture Patterns

### Recommended Error Hierarchy Structure
```
packages/common/src/
├── errors/
│   ├── index.ts           # Export AppError and utilities
│   ├── app-error.ts       # AppError base class
│   └── to-app-error.ts    # Utility for wrapping unknown errors
packages/integrations/src/
├── errors/
│   ├── index.ts           # Export integration errors
│   └── integration-errors.ts  # LinearError, GitHubError, SlackError
packages/platform/src/
├── errors/
│   └── platform-errors.ts # DatabaseError, TemporalError
packages/agents/src/
├── errors/
│   └── agent-errors.ts    # AgentExecutionError, WorkflowError
```

### Pattern 1: AppError Base Class
**What:** Base error class with error code, cause chain, and metadata
**When to use:** All domain errors extend this
**Example:**
```typescript
// packages/common/src/errors/app-error.ts
export interface ErrorMetadata {
  [key: string]: unknown;
}

export interface RecoveryHint {
  isRecoverable: boolean;
  hint?: string;
}

export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly cause?: Error;
  readonly metadata: ErrorMetadata;
  readonly recovery?: RecoveryHint;
  readonly timestamp: Date;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      recovery?: RecoveryHint;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options?.cause;
    this.metadata = options?.metadata ?? {};
    this.recovery = options?.recovery;
    this.timestamp = new Date();

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  // HTTP status mapping - override in subclasses
  get httpStatus(): number {
    return 500;
  }
}
```

### Pattern 2: Domain-Specific Error Classes
**What:** Concrete error classes per integration/domain
**When to use:** When returning errors from service boundaries
**Example:**
```typescript
// packages/integrations/src/errors/integration-errors.ts
import { AppError, type ErrorMetadata, type RecoveryHint } from "@aesir/common";

// Error codes follow LAYER_COMPONENT_ERROR pattern
export class LinearError extends AppError {
  readonly code: string;

  constructor(
    code: "INT_LINEAR_NOT_FOUND" | "INT_LINEAR_RATE_LIMIT" | "INT_LINEAR_AUTH" | "INT_LINEAR_API",
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata; recovery?: RecoveryHint }
  ) {
    super(message, options);
    this.code = code;
  }

  get httpStatus(): number {
    switch (this.code) {
      case "INT_LINEAR_NOT_FOUND": return 404;
      case "INT_LINEAR_RATE_LIMIT": return 429;
      case "INT_LINEAR_AUTH": return 401;
      default: return 500;
    }
  }
}
```

### Pattern 3: Result Types at Service Boundaries
**What:** Functions return Result<T, E> instead of throwing
**When to use:** All public service functions, cross-package calls
**Example:**
```typescript
// packages/integrations/src/linear/client.ts
import { ok, err, type Result, ResultAsync, fromPromise } from "neverthrow";
import { LinearError } from "../errors/integration-errors.js";

export function readIssue(
  client: LinearClient,
  issueId: string
): ResultAsync<Issue, LinearError> {
  return fromPromise(
    client.issue(issueId),
    (error) => new LinearError(
      "INT_LINEAR_API",
      `Failed to read issue ${issueId}`,
      { cause: error instanceof Error ? error : new Error(String(error)), metadata: { issueId } }
    )
  ).andThen((issue) => {
    if (!issue) {
      return err(new LinearError(
        "INT_LINEAR_NOT_FOUND",
        `Issue not found: ${issueId}`,
        { metadata: { issueId } }
      ));
    }
    return ok(issue);
  });
}
```

### Pattern 4: toAppError Utility
**What:** Wrap unknown errors into AppError with proper typing
**When to use:** At catch boundaries when wrapping external library errors
**Example:**
```typescript
// packages/common/src/errors/to-app-error.ts
import { AppError, type ErrorMetadata } from "./app-error.js";

export class UnknownError extends AppError {
  readonly code = "UNKNOWN_ERROR";
}

export function toAppError(
  error: unknown,
  code: string,
  context?: ErrorMetadata
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const cause = error instanceof Error ? error : new Error(String(error));
  const message = cause.message || "An unknown error occurred";

  return new UnknownError(message, { cause, metadata: { ...context, originalCode: code } });
}
```

### Pattern 5: Zod Validation at Webhook Boundaries
**What:** Validate external payloads with Zod before processing
**When to use:** All HTTP endpoints, webhook handlers
**Example:**
```typescript
// packages/agents/src/api/webhooks/linear-agent-session.ts
import { z } from "zod";
import { err, ok, type Result } from "neverthrow";
import { ValidationError } from "@aesir/common";

const AgentSessionPayloadSchema = z.object({
  type: z.literal("AgentSessionEvent"),
  action: z.enum(["created", "prompted"]),
  webhookTimestamp: z.number(),
  webhookId: z.string(),
  agentSession: z.object({
    id: z.string(),
    issueId: z.string(),
    status: z.enum(["pending", "active", "completed"]),
    url: z.string(),
  }),
});

type AgentSessionPayload = z.infer<typeof AgentSessionPayloadSchema>;

function parseAgentSessionPayload(
  rawBody: string
): Result<AgentSessionPayload, ValidationError> {
  try {
    const json = JSON.parse(rawBody);
    const result = AgentSessionPayloadSchema.safeParse(json);

    if (!result.success) {
      return err(new ValidationError(
        "AGT_WEBHOOK_VALIDATION",
        "Invalid AgentSession payload",
        { metadata: { errors: result.error.flatten() } }
      ));
    }

    return ok(result.data);
  } catch (e) {
    return err(new ValidationError(
      "AGT_WEBHOOK_PARSE",
      "Failed to parse webhook body as JSON",
      { cause: e instanceof Error ? e : new Error(String(e)) }
    ));
  }
}
```

### Anti-Patterns to Avoid
- **Throwing from service boundaries:** Use Result types instead
- **Catching and re-throwing without context:** Always wrap with toAppError and add metadata
- **Generic error messages:** Include relevant IDs, timestamps, and context
- **Failing fast on validation:** Aggregate all validation errors before returning

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Result type | Custom discriminated union | neverthrow | Mature library with chaining, async support, ESLint plugin |
| Dead code detection | Custom AST analysis | knip | Handles edge cases, monorepo support, many plugins |
| Validation | Manual if/typeof checks | Zod | Type inference, error aggregation, transforms |
| Error hierarchy | Plain Error subclasses | AppError pattern | Consistent code, cause chain, metadata, HTTP mapping |

**Key insight:** neverthrow provides 80% of Effect.ts benefits with 20% of the learning curve. Zod is already established in the codebase for config validation.

## Common Pitfalls

### Pitfall 1: Forgetting to Handle Result
**What goes wrong:** Calling a function that returns Result but not checking isOk/isErr
**Why it happens:** Easy to forget when migrating from throw-based code
**How to avoid:** Install eslint-plugin-neverthrow to enforce Result consumption
**Warning signs:** TypeScript not complaining but runtime errors occurring

### Pitfall 2: Losing Error Context
**What goes wrong:** Wrapping errors without preserving the cause chain
**Why it happens:** Using `new Error(e.message)` instead of `{ cause: e }`
**How to avoid:** Always use toAppError with cause parameter, log at wrap point
**Warning signs:** Error logs missing stack traces or original error details

### Pitfall 3: Validation After Processing
**What goes wrong:** Validating input after already acting on it
**Why it happens:** Legacy code patterns, copy-paste from old handlers
**How to avoid:** Validate FIRST after signature verification, before any business logic
**Warning signs:** Partial side effects when validation fails

### Pitfall 4: Over-aggressive Result Wrapping
**What goes wrong:** Wrapping every internal function with Result
**Why it happens:** Misunderstanding "boundaries only" rule
**How to avoid:** Only wrap public functions and cross-package calls
**Warning signs:** Excessive `.andThen()` chains, hard-to-read internal code

### Pitfall 5: Inconsistent Error Codes
**What goes wrong:** Different patterns for error codes across packages
**Why it happens:** Multiple developers, no documented convention
**How to avoid:** Follow LAYER_COMPONENT_ERROR pattern strictly (e.g., INT_LINEAR_RATE_LIMIT)
**Warning signs:** Codes like "linear_error", "LinearNotFound", "ERROR_123"

## Code Examples

Verified patterns from official sources and codebase analysis:

### Wrapping External Library Calls
```typescript
// Source: neverthrow GitHub README + project conventions
import { ResultAsync, fromPromise } from "neverthrow";
import { LinearError } from "../errors/integration-errors.js";
import { logger } from "@aesir/common";

export function createIssue(
  client: LinearClient,
  params: CreateIssueParams
): ResultAsync<CreateIssueResult, LinearError> {
  return fromPromise(
    client.createIssue(params),
    (error) => {
      // Log at wrap point with full context
      logger.error({ err: error, params }, "Failed to create Linear issue");

      return new LinearError(
        "INT_LINEAR_API",
        "Failed to create issue",
        {
          cause: error instanceof Error ? error : new Error(String(error)),
          metadata: { teamId: params.teamId, title: params.title }
        }
      );
    }
  ).andThen((result) => {
    if (!result.success) {
      return err(new LinearError(
        "INT_LINEAR_API",
        "Linear API returned failure",
        { metadata: { params } }
      ));
    }
    return ok(result);
  });
}
```

### Service Factory with Result Types
```typescript
// Following existing factory pattern with Result additions
export interface CredentialStore {
  store(input: StoreCredentialInput): ResultAsync<string, CredentialError>;
  get(id: string): ResultAsync<DecryptedCredential | null, CredentialError>;
  getByProvider(
    workspaceId: string,
    provider: CredentialProvider
  ): ResultAsync<DecryptedCredential | null, CredentialError>;
}

export function createCredentialStore(
  options: CredentialStoreOptions
): CredentialStore {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for CredentialStore");
  if (!logger) throw new Error("logger is required for CredentialStore");

  return {
    store(input): ResultAsync<string, CredentialError> {
      return fromPromise(
        storeImpl(db, logger, input),
        (error) => new CredentialError("PLT_CRED_STORE", "Failed to store credential", {
          cause: error instanceof Error ? error : undefined,
          metadata: { workspaceId: input.workspaceId, provider: input.provider }
        })
      );
    },
    // ... other methods
  };
}
```

### Validation Error Aggregation
```typescript
// Source: Zod documentation + project conventions
import { z } from "zod";

const WebhookPayloadSchema = z.object({
  type: z.string(),
  webhookTimestamp: z.number(),
  webhookId: z.string(),
  data: z.unknown(),
});

export class ValidationError extends AppError {
  readonly code: string;
  readonly validationErrors: z.ZodError["flatten"]["fieldErrors"];

  constructor(
    code: string,
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      validationErrors?: z.ZodError["flatten"]["fieldErrors"];
    }
  ) {
    super(message, options);
    this.code = code;
    this.validationErrors = options?.validationErrors ?? {};
  }
}

function validateWebhookPayload(
  rawBody: string
): Result<WebhookPayload, ValidationError> {
  try {
    const json = JSON.parse(rawBody);
    const result = WebhookPayloadSchema.safeParse(json);

    if (!result.success) {
      // Aggregate ALL validation errors
      return err(new ValidationError(
        "WEBHOOK_VALIDATION",
        "Webhook payload validation failed",
        {
          validationErrors: result.error.flatten().fieldErrors,
          metadata: { receivedKeys: Object.keys(json) }
        }
      ));
    }

    return ok(result.data);
  } catch (e) {
    return err(new ValidationError(
      "WEBHOOK_PARSE",
      "Invalid JSON in webhook body",
      { cause: e instanceof Error ? e : new Error(String(e)) }
    ));
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ts-prune | knip | 2023 | knip finds more issues, better monorepo support |
| throw/catch everywhere | Result types at boundaries | Ongoing | Type-safe error handling, forces explicit handling |
| Manual validation | Zod schemas | Already adopted | Type inference, runtime validation |

**Deprecated/outdated:**
- ts-prune: Maintenance mode since 2023, use knip instead
- fp-ts Either: More complex than neverthrow, heavier bundle

## Codebase Analysis

### Current Error Handling Patterns
17 files currently use `throw new Error`:
- packages/integrations/src/db/credential-store.ts (factory validation)
- packages/integrations/src/services/*.ts (factory validation)
- packages/observability/src/services/execution-tracker.ts (factory validation)
- packages/platform/src/services/cleanup.ts (factory validation)
- packages/integrations/src/linear/client.ts (API errors)
- packages/integrations/src/linear/issues.ts (API errors)
- packages/platform/src/sandbox/docker-sandbox.ts (sandbox errors)
- packages/integrations/src/slack/notifications.ts (Slack errors)

### Service Boundaries Needing Migration
| Package | Service | Current | Target |
|---------|---------|---------|--------|
| integrations | CredentialStore | throws | ResultAsync |
| integrations | SyncCursorService | no throws | ResultAsync (for consistency) |
| integrations | WebhookIdempotencyService | no throws | ResultAsync (for consistency) |
| integrations | Linear client functions | throws | ResultAsync |
| integrations | GitHub client functions | throws | ResultAsync |
| integrations | Slack notifications | throws | ResultAsync |
| observability | ExecutionTracker | no throws | ResultAsync (for consistency) |
| platform | CleanupService | no throws | ResultAsync |
| agents | Webhook handlers | try/catch | Result |

### External Boundaries Needing Zod
| Location | Current Validation | Needs |
|----------|-------------------|-------|
| linear-agent-session.ts | Type guards + manual checks | Zod schema |
| github-pr-review.ts | Interface types only | Zod schema |
| Linear webhook types | TypeScript interfaces | Zod schemas |

### Index.ts Barrel Export Status
| Package | Has index.ts | Re-exports | Needs Audit |
|---------|-------------|------------|-------------|
| common | Yes | All submodules | Review what should be internal |
| platform | Yes | All + common | Review what should be internal |
| integrations | Yes | All + platform re-exports | Review what should be internal |
| observability | Yes | db + services | Review what should be internal |
| agents | Yes | Selective | Review what should be internal |

### Zod Usage
Currently used in:
- packages/common/src/config/env.ts (environment validation)
- packages/common/src/state/*.ts (LangGraph state schemas)
- packages/agents/src/product-agent/state.ts (product agent state)
- packages/agents/src/nodes/*.ts (code generation)
- packages/agents/src/tools/code-gen.ts (tool schemas)

**Not used in:** Webhook handlers, HTTP endpoints

### Migration Scope Estimate
- ~17 files with throw statements to migrate
- ~6 service interfaces to add Result types
- ~2 webhook handlers needing Zod validation
- ~5 index.ts files to audit for proper exports
- Unknown dead code (run knip to discover)

## Open Questions

Things that couldn't be fully resolved:

1. **ResultAsync vs Promise<Result> preference**
   - What we know: Both work, ResultAsync chains better
   - What's unclear: Team preference for consistency
   - Recommendation: Use ResultAsync for new code, document pattern

2. **Exact error code list**
   - What we know: Pattern is LAYER_COMPONENT_ERROR
   - What's unclear: Complete enumeration of all needed codes
   - Recommendation: Define codes as encountered, maintain central reference

3. **knip configuration for monorepo**
   - What we know: knip supports workspaces
   - What's unclear: Exact config for this specific monorepo structure
   - Recommendation: Research knip.json configuration during planning

## Sources

### Primary (HIGH confidence)
- [neverthrow GitHub](https://github.com/supermacro/neverthrow) - API reference, best practices
- [Zod documentation](https://zod.dev/) - Schema validation patterns
- [knip documentation](https://knip.dev) - Dead code detection, monorepo support

### Secondary (MEDIUM confidence)
- [Effective TypeScript - knip recommendation](https://effectivetypescript.com/2023/07/29/knip/) - ts-prune successor rationale
- Codebase analysis - Current patterns and migration scope

### Tertiary (LOW confidence)
- WebSearch results for error handling patterns - General best practices

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - neverthrow is well-established, Zod already in use
- Architecture: HIGH - Patterns verified against codebase and official docs
- Pitfalls: HIGH - Common issues documented in library wikis
- Migration scope: MEDIUM - File counts verified, effort estimates are approximate

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (30 days - stable domain)
