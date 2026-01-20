---
phase: 13-data-layer
plan: 01
subsystem: data-layer
tags: [drizzle, postgres, nanoid, config]

dependency_graph:
  requires: [12-observability]
  provides: [drizzle-orm, db-config, prefixed-ids]
  affects: [13-02, 13-03, 13-04, 13-05]

tech_stack:
  added: [drizzle-orm@0.45.1, drizzle-kit@0.31.8, pg@8.17.2]
  patterns: [prefixed-id-generation, component-db-config]

key_files:
  created:
    - packages/common/src/db/ids.ts
    - packages/common/src/db/index.ts
  modified:
    - packages/common/package.json
    - packages/platform/package.json
    - packages/integrations/package.json
    - packages/common/src/config/env.ts
    - packages/common/src/index.ts

decisions:
  - id: 13-01-a
    choice: "24-char nanoid for IDs"
    reason: "Better collision resistance than UUIDv4, URL-safe"
  - id: 13-01-b
    choice: "Separate DB env vars over DATABASE_URL"
    reason: "Better for Kubernetes secret injection"
  - id: 13-01-c
    choice: "CREDENTIAL_ENCRYPTION_KEY optional"
    reason: "Allow running without encryption during initial setup"

metrics:
  duration: 3m 29s
  completed: 2026-01-20
---

# Phase 13 Plan 01: Data Layer Foundation Setup Summary

**One-liner:** Installed Drizzle ORM with PostgreSQL driver, added component-based DB config, and created prefixed ID generator using nanoid.

## What Was Built

### 1. Drizzle ORM Dependencies

Installed Drizzle ORM ecosystem across packages:

- **@aesir/common**: `pg@8.17.2`, `@types/pg@8.16.0` (shared DB utilities)
- **@aesir/platform**: `drizzle-orm@0.45.1`, `pg@8.17.2`, `drizzle-kit@0.31.8`, `@types/pg@8.16.0`
- **@aesir/integrations**: `drizzle-orm@0.45.1`, `pg@8.17.2`, `drizzle-kit@0.31.8`, `@types/pg@8.16.0`

### 2. Database Environment Variables

Replaced single `DATABASE_URL` with component variables:

```typescript
// New env vars with defaults
DB_HOST: z.string().default("localhost"),
DB_PORT: z.coerce.number().default(5432),
DB_USER: z.string().default("temporal"),
DB_PASSWORD: z.string().default("temporal"),
DB_NAME: z.string().default("temporal"),

// Encryption key for credential store
CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),
```

Config object maintains backward-compatible `url` property:

```typescript
config.database.url // "postgresql://temporal:temporal@localhost:5432/temporal"
config.database.encryptionKey // undefined or 64-char hex key
```

### 3. Prefixed ID Generator

Created `createId` factory using nanoid with typed prefixes:

```typescript
import { createId } from "@aesir/common";

createId.credential();     // "cred_3Rl0LW0fx2PuPFauygac1Zo0"
createId.execution();      // "exec_..."
createId.workspace();      // "ws_..."
createId.configuration();  // "conf_..."
createId.webhookDelivery(); // "whd_..."
createId.syncCursor();     // "sync_..."
```

- 24-char nanoid provides ~143 bits of entropy (better than UUIDv4)
- URL-safe alphanumeric alphabet (0-9, A-Z, a-z)
- Total ID length: 29 chars (5 prefix + 24 random)

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| c9c302b | chore | Install Drizzle ORM dependencies |
| 50fc191 | feat | Add database environment variables |
| 3e54a4a | feat | Create prefixed ID generator |

## Files Changed

| File | Change |
|------|--------|
| packages/common/package.json | Added pg, @types/pg |
| packages/platform/package.json | Added drizzle-orm, pg, drizzle-kit, @types/pg |
| packages/integrations/package.json | Added drizzle-orm, pg, drizzle-kit, @types/pg |
| packages/common/src/config/env.ts | Replaced DATABASE_URL with component vars |
| packages/common/src/db/ids.ts | New - prefixed ID generator |
| packages/common/src/db/index.ts | New - db module exports |
| packages/common/src/index.ts | Added db module export |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All verification criteria passed:

1. `pnpm install` succeeds from root
2. `pnpm --filter @aesir/common build` succeeds
3. `pnpm --filter @aesir/platform typecheck` succeeds
4. `pnpm --filter @aesir/integrations typecheck` succeeds
5. drizzle-orm appears in platform and integrations package.json
6. env.ts contains DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
7. createId.credential() returns string matching pattern `cred_[A-Za-z0-9]{24}`

## Next Phase Readiness

Ready for 13-02 (Credential Store Schema):

- Drizzle ORM installed in @aesir/integrations
- createId.credential() available for primary keys
- config.database.encryptionKey available for AES-256 encryption
- pg driver ready for connection pool setup
