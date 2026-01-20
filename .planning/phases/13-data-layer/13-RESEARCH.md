# Phase 13: Data Layer - Research

**Researched:** 2026-01-20
**Domain:** PostgreSQL schema management, ORM tooling, credential encryption
**Confidence:** HIGH

## Summary

Research focused on five critical domains for implementing PostgreSQL-based data layer with multi-schema organization: ORM/query builder selection (Drizzle vs Kysely vs Prisma), PostgreSQL multi-schema patterns, credential encryption approaches, migration tooling, and prefixed ID generation.

**Key findings:**
- **Drizzle ORM emerges as the optimal choice** for this project: native TypeScript schema definition, excellent multi-schema support via `pgSchema`, SQL migration files, serverless-friendly lightweight design, and active 2025-2026 ecosystem
- **Multi-schema organization is well-supported** across all major tools, with per-schema migration tracking achievable through configuration
- **Application-level encryption is strongly preferred** over pgcrypto for credential storage, with envelope encryption + KMS being the industry standard pattern
- **Migration idempotency is handled automatically** by tracking tables, with PostgreSQL's transactional DDL enabling atomic migrations
- **24-character nanoid with prefixes** provides excellent collision resistance (better than UUIDv4) while maintaining human readability

**Primary recommendation:** Use Drizzle ORM with per-package schema definitions, SQL migrations via drizzle-kit, and application-level credential encryption. Defer KMS integration in favor of simple application-level encryption for Phase 13.

## Standard Stack

The established libraries/tools for Node.js PostgreSQL data layers in 2025-2026:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | 0.36+ (2025-26) | Type-safe ORM with native PostgreSQL support | Code-first TypeScript schema, SQL migration files, multi-schema native support, lightweight (serverless-friendly), active ecosystem in 2025-2026 |
| drizzle-kit | Latest (CLI) | Migration generation and application | Generates SQL from schema diffs, applies migrations with tracking, per-schema config support |
| node-postgres (pg) | 8.x | PostgreSQL driver | Official Node.js PostgreSQL driver, mature connection pooling, used by all major ORMs |
| nanoid | 5.x | Unique ID generation | Cryptographically secure, URL-safe, 24-char provides better collision resistance than UUIDv4 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv-flow | Latest | Environment configuration | Already in project, manages DB connection params |
| @types/pg | Latest | TypeScript types for pg | Type safety for raw pg operations if needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Drizzle | Kysely | Kysely is pure query builder (no schema definition), requires separate migration tooling, better for existing databases. Drizzle's code-first approach fits greenfield better. |
| Drizzle | Prisma | Prisma has heavier runtime (15MB vs <2MB), slower queries (240ms vs 75ms per benchmarks), schema in .prisma files (not TypeScript). Better for teams wanting maximum hand-holding. |
| nanoid | cuid2 | cuid2 is more secure (collision-resistant by design) but intentionally slower. nanoid's speed is fine for non-adversarial contexts. |
| nanoid | ulid | ulid provides lexicographic sorting via timestamp prefix, but leaks timing information. Use if time-based sorting is critical. |

**Installation:**
```bash
npm install drizzle-orm drizzle-kit pg nanoid --legacy-peer-deps
npm install -D @types/pg --legacy-peer-deps
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── platform/
│   ├── db/
│   │   ├── schema.ts              # Drizzle schema definitions (pgSchema)
│   │   ├── client.ts              # Database connection + Drizzle instance
│   │   └── migrations/            # SQL migration files
│   └── ...
├── integrations/
│   ├── db/
│   │   ├── schema.ts              # Integrations schema definitions
│   │   ├── credentials.ts         # Credential access + encryption
│   │   └── migrations/            # SQL migration files
│   └── ...
└── temporal/
    └── db/
        ├── schema.ts              # Observability schema definitions
        └── migrations/            # SQL migration files
```

### Pattern 1: Per-Package Schema Definition
**What:** Each package (platform, integrations, temporal) owns its schema namespace and migration directory
**When to use:** Multi-package monorepo with logical domain separation
**Example:**
```typescript
// src/integrations/db/schema.ts
import { pgTable, text, timestamp, pgSchema } from 'drizzle-orm/pg-core';

export const integrationsSchema = pgSchema('integrations');

export const credentials = integrationsSchema.table('credentials', {
  id: text('id').primaryKey(), // e.g., 'cred_abc123xyz...'
  workspace_id: text('workspace_id').notNull(),
  provider: text('provider').notNull(), // 'linear', 'github', 'slack'
  encrypted_access_token: text('encrypted_access_token').notNull(),
  encrypted_refresh_token: text('encrypted_refresh_token'),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});
```

### Pattern 2: Per-Package Database Client
**What:** Each package instantiates its own Drizzle client with schema-specific configuration
**When to use:** Maximum flexibility during development while patterns emerge
**Example:**
```typescript
// src/integrations/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20, // PostgreSQL recommendation: (cores * 2) + 1
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Handle pool errors
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

export const db = drizzle(pool, { schema });
```

### Pattern 3: Application-Level Credential Encryption
**What:** Encrypt credentials in application code before storing, decrypt on retrieval
**When to use:** Always for OAuth tokens and sensitive credentials (industry standard 2025)
**Example:**
```typescript
// src/integrations/db/credentials.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { db } from './client.js';
import { credentials } from './schema.js';
import { eq } from 'drizzle-orm';

// Encryption key from environment (32 bytes for AES-256)
const ENCRYPTION_KEY = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY!, 'hex');

function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // Store IV + encrypted data together
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(ciphertext: string): string {
  const [ivHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export async function storeCredential(params: {
  provider: string;
  workspace_id: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
}) {
  const id = `cred_${nanoid(24)}`;

  await db.insert(credentials).values({
    id,
    workspace_id: params.workspace_id,
    provider: params.provider,
    encrypted_access_token: encrypt(params.access_token),
    encrypted_refresh_token: params.refresh_token ? encrypt(params.refresh_token) : null,
    expires_at: params.expires_at,
  });

  return id;
}

export async function getCredential(id: string) {
  const result = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);

  if (!result[0]) return null;

  return {
    ...result[0],
    access_token: decrypt(result[0].encrypted_access_token),
    refresh_token: result[0].encrypted_refresh_token
      ? decrypt(result[0].encrypted_refresh_token)
      : null,
  };
}
```

### Pattern 4: Prefixed ID Generation
**What:** Generate IDs with human-readable prefixes using nanoid
**When to use:** All primary keys in application tables (not for system tables like migrations)
**Example:**
```typescript
// src/platform/db/ids.ts
import { customAlphabet } from 'nanoid';

// Use URL-safe alphabet (A-Za-z0-9_-), 24 chars for better collision resistance than UUIDv4
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 24);

export const createId = {
  credential: () => `cred_${nanoid()}`,
  execution: () => `exec_${nanoid()}`,
  configuration: () => `conf_${nanoid()}`,
  // Add more as needed
};

// Usage in schema
export const configurations = platformSchema.table('configurations', {
  id: text('id').primaryKey().$defaultFn(() => createId.configuration()),
  // ... other columns
});
```

### Pattern 5: Per-Schema Migration Configuration
**What:** Separate drizzle.config.ts for each schema with per-schema migration tracking
**When to use:** Multi-schema setup where packages deploy independently
**Example:**
```typescript
// drizzle-integrations.config.ts
import { defineConfig } from 'drizzle-kit';
import { config } from './src/config/index.js';

export default defineConfig({
  out: './src/integrations/db/migrations',
  schema: './src/integrations/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
  },
  migrations: {
    table: '__drizzle_integrations_migrations', // Per-schema tracking
    schema: 'integrations',
  },
  schemaFilter: ['integrations'], // Only manage integrations schema
});
```

### Pattern 6: Soft Delete with Partial Indexes
**What:** Use deleted_at timestamp with partial indexes for unique constraints
**When to use:** All tables requiring soft deletes (most application tables)
**Example:**
```typescript
// Schema definition with soft delete
export const credentials = integrationsSchema.table('credentials', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id').notNull(),
  provider: text('provider').notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  // ... other columns
}, (table) => ({
  // Unique constraint only for non-deleted records
  uniqueWorkspaceProvider: unique('credentials_workspace_provider_unique')
    .on(table.workspace_id, table.provider)
    .where(sql`deleted_at IS NULL`),
}));

// Query helper to exclude soft-deleted
export const activeCredentials = db.select().from(credentials).where(isNull(credentials.deleted_at));
```

### Pattern 7: updated_at via Database Trigger
**What:** Automatic timestamp management via PostgreSQL trigger function
**When to use:** All tables with updated_at columns (ensures consistency)
**Example:**
```sql
-- Migration: 20260120120000_create_updated_at_trigger.sql

-- Create reusable trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to each table
CREATE TRIGGER update_credentials_updated_at
  BEFORE UPDATE ON integrations.credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Anti-Patterns to Avoid
- **Cross-package schema imports:** Don't import schema definitions across packages. Use separate schema files per package.
- **Shared migration directory:** Don't put all migrations in one folder. Per-package migrations enable independent deployments.
- **pgcrypto for credentials:** Don't use database-level encryption (pgcrypto). Application-level encryption provides better security isolation.
- **Manual updated_at in code:** Don't rely on application code to set updated_at. Use triggers for guaranteed consistency.
- **TEXT without length limits:** Don't use unbounded TEXT for known-size fields. Use TEXT for large content, VARCHAR(n) for bounded strings.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration tracking | Custom migration runner with state files | drizzle-kit migrate with __drizzle_migrations table | Database-level locks prevent race conditions, atomic execution, snapshot-based diff detection |
| Connection pooling | Custom connection manager | pg.Pool with proper configuration | Handles connection lifecycle, error recovery, max_connections enforcement, battle-tested |
| ID generation | Custom random string generator | nanoid library | CSPRNG-based (cryptographically secure), collision math verified, 118 bytes, URL-safe by default |
| Credential encryption | Custom cipher implementation | Node.js crypto module with AES-256-CBC | NIST-standard algorithm, audited implementation, IV handling built-in |
| Schema drift detection | Manual SQL comparison scripts | drizzle-kit generate with snapshot diffs | JSON-based snapshots, ambiguous change detection (rename vs drop+add), automated SQL generation |
| Timestamp management | Application-level updated_at setting | PostgreSQL trigger function | Guaranteed consistency, no developer error, works across all clients/tools |
| Soft delete querying | Manual WHERE deleted_at IS NULL in every query | Row-Level Security (RLS) policies | Centralized logic, impossible to forget, applies to all operations |

**Key insight:** Database tooling has matured significantly in 2025-2026. Custom solutions add maintenance burden without providing value. The ecosystem provides production-grade tools for every common pattern.

## Common Pitfalls

### Pitfall 1: Cross-Schema Foreign Key ORM Limitations
**What goes wrong:** Many ORMs struggle with foreign keys across schemas, causing migration generation to fail or create duplicate constraints
**Why it happens:** ORMs introspect schemas independently and don't always handle cross-schema relationships correctly
**How to avoid:**
- Test cross-schema FKs early with your chosen ORM
- Drizzle handles this well via schema-qualified references: `references(() => platformSchema.table.column)`
- Document which tables have cross-schema FKs for future refactoring
**Warning signs:** Migration diffs show FK creation every time, introspection errors mentioning "cross schema reference"

### Pitfall 2: Connection Pool Exhaustion
**What goes wrong:** Application runs out of database connections, queries hang indefinitely, "sorry, too many clients already" errors
**Why it happens:**
- Not releasing connections after use (missing .finally() on transactions)
- Pool size exceeds PostgreSQL max_connections
- Long-running queries holding connections
**How to avoid:**
- Configure pool size correctly: `max_connections = (number_of_app_instances × pool.max) + buffer`
- PostgreSQL recommendation: `pool.max = (core_count * 2) + 1`
- Always release clients in finally blocks
- Monitor pool metrics: `pool.totalCount`, `pool.idleCount`, `pool.waitingCount`
**Warning signs:** Queries timing out, "client has already been released" errors, connections stuck in `pg_stat_activity`

### Pitfall 3: Soft Delete Unique Constraint Conflicts
**What goes wrong:** Insert fails with unique constraint violation even though the existing row is soft-deleted
**Why it happens:** Standard unique indexes include soft-deleted rows in uniqueness checks
**How to avoid:** Use partial indexes with `WHERE deleted_at IS NULL` condition
```typescript
unique('name_unique').on(table.name).where(sql`deleted_at IS NULL`)
```
**Warning signs:** "duplicate key value violates unique constraint" on records you thought were deleted

### Pitfall 4: Migration Ordering Across Schemas
**What goes wrong:** Migration fails because it references a table/column that doesn't exist yet in another schema
**Why it happens:** Per-schema migrations run independently without considering cross-schema dependencies
**How to avoid:**
- Document schema dependency order (e.g., platform → integrations → temporal)
- Run migration commands in dependency order
- Consider a root-level migration orchestrator that runs per-schema migrations in correct sequence
- Avoid cross-schema FKs in initial migrations (add later once both schemas exist)
**Warning signs:** "relation does not exist" errors during migration

### Pitfall 5: Encryption Key Management Mistakes
**What goes wrong:** Credentials become unrecoverable, security audit fails, keys leak into version control
**Why it happens:**
- Key stored in code instead of environment
- No key rotation strategy
- Key length incorrect for cipher (AES-256 needs 32 bytes)
- IV reuse (must be unique per encryption)
**How to avoid:**
- Store key in environment variable as hex string: `openssl rand -hex 32`
- Generate new IV for each encryption operation (randomBytes(16))
- Never commit keys to git
- Document key generation process for ops team
- Validate key length on application startup
**Warning signs:** "Invalid key length" errors, decryption failures after environment changes

### Pitfall 6: Timestamp Type Confusion
**What goes wrong:** Timestamp comparisons fail, timezone bugs in production, date/time math errors
**Why it happens:** Mixing `timestamp` (without timezone) and `timestamp with time zone` (timestamptz)
**How to avoid:**
- **Always use `timestamp with time zone`** for all timestamp columns
- PostgreSQL stores timestamptz in UTC, converts on retrieval
- Drizzle syntax: `timestamp('created_at', { withTimezone: true })`
- Never use JavaScript `Date.now()` in Temporal workflows (non-deterministic)
**Warning signs:** Times off by timezone offset, different results in different environments

### Pitfall 7: Non-Idempotent Manual SQL Migrations
**What goes wrong:** Re-running migration fails or creates duplicate structures
**Why it happens:** TypeScript migrations without IF EXISTS guards, manual SQL without idempotency checks
**How to avoid:**
- Prefer SQL migrations generated by drizzle-kit (inherently idempotent via tracking table)
- For manual SQL, always use: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE IF EXISTS`
- For data migrations, add guard conditions: `WHERE NOT EXISTS (SELECT ...)`
- Test migrations by running twice locally
**Warning signs:** "already exists" errors when re-running migrations

## Code Examples

Verified patterns from official sources and current best practices:

### Example 1: Complete Drizzle Schema with Multi-Schema Support
```typescript
// Source: https://orm.drizzle.team/docs/sql-schema-declaration
import { pgTable, text, timestamp, pgSchema } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Define schema namespace
export const integrationsSchema = pgSchema('integrations');

// Define table in schema
export const credentials = integrationsSchema.table('credentials', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id').notNull(),
  provider: text('provider', {
    enum: ['linear', 'github', 'slack']
  }).notNull(),
  encrypted_access_token: text('encrypted_access_token').notNull(),
  encrypted_refresh_token: text('encrypted_refresh_token'),
  token_type: text('token_type').default('Bearer'),
  scope: text('scope'),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // Partial unique index for soft deletes
  uniqueWorkspaceProvider: unique('credentials_workspace_provider_unique')
    .on(table.workspace_id, table.provider)
    .where(sql`deleted_at IS NULL`),
}));

// Type inference from schema
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
```

### Example 2: Connection Pool Configuration
```typescript
// Source: https://node-postgres.com/features/pooling
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { logger } from '../logging/index.js';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20, // Max number of clients in pool
  min: 5, // Min number of clients to maintain
  idleTimeoutMillis: 30000, // Close idle clients after 30s
  connectionTimeoutMillis: 5000, // Error if can't connect in 5s
  maxUses: 7500, // Close client after 7500 queries (prevent memory leaks)
});

// Handle pool-level errors (idle client disconnects)
pool.on('error', (err, client) => {
  logger.error({ err }, 'Unexpected database pool error');
});

// Handle pool removal (for graceful shutdown)
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

export const db = drizzle(pool);
```

### Example 3: Migration Generation and Application
```bash
# Source: https://orm.drizzle.team/docs/migrations

# Generate migration from schema changes
npx drizzle-kit generate --config=drizzle-integrations.config.ts

# Output: src/integrations/db/migrations/20260120143022_create_credentials/
#   - migration.sql (SQL statements)
#   - snapshot.json (schema state)

# Apply migrations
npx drizzle-kit migrate --config=drizzle-integrations.config.ts

# Migration tracking: Creates integrations.__drizzle_integrations_migrations table
# Columns: id, hash, created_at
# Each migration runs once, hash prevents tampering
```

### Example 4: Credential Encryption with AES-256-CBC
```typescript
// Source: Node.js crypto documentation + 2025 encryption best practices
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// 32-byte key for AES-256 (generate with: openssl rand -hex 32)
const ENCRYPTION_KEY = Buffer.from(
  process.env.CREDENTIAL_ENCRYPTION_KEY!,
  'hex'
);

if (ENCRYPTION_KEY.length !== 32) {
  throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
}

export function encryptToken(plaintext: string): string {
  // Generate unique IV for each encryption (CRITICAL for security)
  const iv = randomBytes(16);

  // Create cipher with AES-256-CBC
  const cipher = createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);

  // Encrypt and concatenate
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // Return IV:ciphertext (both needed for decryption)
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, encryptedHex] = ciphertext.split(':');

  if (!ivHex || !encryptedHex) {
    throw new Error('Invalid ciphertext format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}
```

### Example 5: Query Patterns with Soft Deletes
```typescript
// Source: Drizzle ORM documentation + soft delete best practices
import { db } from './client.js';
import { credentials } from './schema.js';
import { eq, and, isNull } from 'drizzle-orm';

// Get active credential
export async function getActiveCredential(workspaceId: string, provider: string) {
  return await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.workspace_id, workspaceId),
        eq(credentials.provider, provider),
        isNull(credentials.deleted_at) // Exclude soft-deleted
      )
    )
    .limit(1);
}

// Soft delete
export async function deleteCredential(id: string) {
  return await db
    .update(credentials)
    .set({ deleted_at: new Date() })
    .where(eq(credentials.id, id));
}

// Hard delete (permanent, use sparingly)
export async function purgeCredential(id: string) {
  return await db
    .delete(credentials)
    .where(eq(credentials.id, id));
}
```

### Example 6: Cross-Schema Foreign Key
```typescript
// Source: Drizzle ORM multi-schema documentation
import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

// Schema definitions
export const platformSchema = pgSchema('platform');
export const integrationsSchema = pgSchema('integrations');

// Platform schema table
export const workspaces = platformSchema.table('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Integrations schema table with FK to platform schema
export const credentials = integrationsSchema.table('credentials', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id')
    .notNull()
    .references(() => workspaces.id), // Cross-schema FK
  provider: text('provider').notNull(),
  // ... other columns
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| UUIDv4 primary keys | Prefixed nanoid (e.g., cred_abc123) | 2023-2024 | Better DX (human-readable), same collision resistance, URL-safe by default, TypeScript branded types |
| Prisma/TypeORM dominance | Drizzle ORM gaining adoption | 2024-2025 | Lightweight (2MB vs 15MB), faster queries (75ms vs 240ms), native TypeScript schema, serverless-friendly |
| pgcrypto for encryption | Application-level encryption | Ongoing (2025) | Better security isolation, no key exposure to DB, flexible key management, performance neutral |
| UUID v4 | UUID v7 (timestamp-based) | PostgreSQL 18 (Fall 2025) | Better index performance via time-ordering, v7 scheduled for official support |
| Manual migration ordering | Per-schema migration tracking | 2024-2025 | Independent package deployments, clearer ownership, better monorepo support |
| Global ORM connection | Per-package DB clients | 2025 pattern | Maximum flexibility, independent scaling, clearer boundaries during development |

**Deprecated/outdated:**
- **TypeORM**: Still maintained but falling behind in TypeScript-native features, heavier runtime, slower development velocity compared to Drizzle/Kysely
- **Sequelize**: Legacy ORM, not TypeScript-first, older patterns (class-based models), ecosystem moving to modern alternatives
- **PostgreSQL ENUM types**: Still work but TEXT + CHECK constraints are preferred for easier schema evolution (no need for ALTER TYPE)
- **Raw .env files**: dotenv-flow supersedes with environment-specific overrides (.env.local, .env.production)

## Open Questions

Things that couldn't be fully resolved:

1. **Per-schema vs Root-level Migration Commands**
   - What we know: Both patterns work, Drizzle supports multiple config files
   - What's unclear: Best practice for monorepo where packages may deploy independently vs together
   - Recommendation: Start with per-schema configs and commands (`npm run migrate:integrations`), add root orchestrator if needed after observing deployment patterns

2. **Credential Cache TTL**
   - What we know: Short TTL reduces DB load, credentials don't change often
   - What's unclear: Optimal TTL for OAuth tokens (balance: freshness vs performance)
   - Recommendation: Start with 5-minute TTL, monitor hit rate and token refresh frequency, adjust based on data

3. **Cross-Schema FK Enforcement in Production**
   - What we know: PostgreSQL supports cross-schema FKs, ORMs have varying support quality
   - What's unclear: Real-world performance impact at scale, whether to defer constraints
   - Recommendation: Use FKs for now (pragmatic choice per CONTEXT.md), revisit after observing query patterns and performance metrics

4. **Migration Rollback Strategy for Production**
   - What we know: Forward-only works for development, production needs more discipline
   - What's unclear: Whether to implement down migrations or compensating forward migrations
   - Recommendation: Defer until production deployment phase (21+), forward-only is safe for Phase 13

## Sources

### Primary (HIGH confidence)
- [Drizzle ORM - Schema Declaration](https://orm.drizzle.team/docs/sql-schema-declaration) - Multi-schema pgSchema API
- [Drizzle ORM - Migrations](https://orm.drizzle.team/docs/migrations) - Migration generation and tracking
- [Drizzle ORM - drizzle-kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate) - Snapshot-based diff generation
- [Drizzle ORM - drizzle-kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate) - Migration application with tracking table
- [Kysely - Migrations](https://kysely.dev/docs/migrations) - TypeScript migrations, tracking mechanism
- [Kysely - Working with schemas](https://kysely.dev/docs/recipes/schemas) - Multi-schema patterns, withSchema method
- [Prisma - Multi-schema](https://www.prisma.io/docs/orm/prisma-schema/data-model/multi-schema) - Multi-schema support and limitations
- [Prisma - Getting started with Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate/getting-started) - Migration tracking table
- [node-postgres - Pooling](https://node-postgres.com/features/pooling) - Connection pool configuration
- [PostgreSQL Documentation - Encryption Options](https://www.postgresql.org/docs/current/encryption-options.html) - Encryption approaches
- [PostgreSQL Documentation - pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html) - Database-level encryption

### Secondary (MEDIUM confidence)
- [Drizzle vs Prisma: Choosing the Right TypeScript ORM | Better Stack Community](https://betterstack.com/community/guides/scaling-nodejs/drizzle-vs-prisma/) - Performance benchmarks verified with multiple sources
- [The 2025 TypeScript ORM Battle: Prisma vs. Drizzle vs. Kysely | Level Up Coding](https://levelup.gitconnected.com/the-2025-typescript-orm-battle-prisma-vs-drizzle-vs-kysely-007ffdfded67) - Ecosystem state, philosophy comparison
- [Node.js ORMs in 2025: Choosing Between Prisma, Drizzle, TypeORM, and Beyond | TheDataGuy](https://thedataguy.pro/blog/2025/12/nodejs-orm-comparison-2025/) - Current adoption patterns
- [Why we chose NanoIDs for PlanetScale's API — PlanetScale](https://planetscale.com/blog/why-we-chose-nanoids-for-planetscales-api) - Production nanoid usage at scale
- [UUID vs CUID vs NanoID: Choosing the Right ID Generator | Wisp CMS](https://www.wisp.blog/blog/uuid-vs-cuid-vs-nanoid-choosing-the-right-id-generator-for-your-application) - Collision probability analysis
- [Data Encryption in Postgres: A Guidebook | Crunchy Data Blog](https://www.crunchydata.com/blog/data-encryption-in-postgres-a-guidebook) - Application-level vs pgcrypto tradeoffs
- [PostgreSQL Data Security: Encryption and Monitoring Best Practices](https://www.enterprisedb.com/postgresql-best-practices-encryption-monitoring) - 2025 encryption standards
- [Soft Deletion Probably Isn't Worth It — brandur.org](https://brandur.org/soft-deletion) - Soft delete patterns and tradeoffs
- [PostgreSQL soft-delete strategies: balancing data retention - DEV](https://dev.to/oddcoder/postgresql-soft-delete-strategies-balancing-data-retention-50lo) - Partial index patterns
- [Use PostgreSQL Triggers to Automate Creation & Modification Timestamps](https://www.bluelabellabs.com/blog/how-to-use-postgresql-trigger-functions-to-automate-creation-and-last-modification-timestamps/) - Trigger-based updated_at management

### Tertiary (LOW confidence - flagged for validation)
- [Node.js + PostgreSQL: The Simple Trick to Effortlessly Scale 10,000+ Connections | Medium](https://medium.com/@rajat29gupta/node-js-postgresql-the-simple-trick-to-effortlessly-scale-10-000-connections-312c3079d362) - High-scale connection patterns (not verified for this project's scale)
- [Envelope Encryption: A Secure Approach to Secrets Management | Medium](https://medium.com/@tarangchikhalia/envelope-encryption-a-secure-approach-to-secrets-management-c8abce5b24d2) - KMS patterns (deferred to future phases)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official documentation verified, 2025-2026 current, multiple authoritative sources agree
- Architecture: HIGH - Patterns from official docs, verified with Drizzle/Kysely/Prisma documentation, best practices confirmed across sources
- Pitfalls: MEDIUM-HIGH - Common issues documented across multiple sources, some from production experience reports (not all independently verified)
- Encryption: MEDIUM - Application-level encryption approach is industry standard, specific implementation details from Node.js crypto docs (HIGH), envelope encryption patterns noted but deferred (MEDIUM)
- ID generation: HIGH - nanoid collision math verified with official calculators, Stripe-style patterns documented in production use cases

**Research date:** 2026-01-20
**Valid until:** 30-60 days (database tooling is relatively stable, Drizzle ORM updates frequently but maintains API compatibility)

**Drizzle ORM selection rationale:**
After deep investigation of all three options (Drizzle, Kysely, Prisma), Drizzle emerges as the clear winner for this project:

1. **Code-first TypeScript schema** - Fits greenfield development (Phase 13 is building from scratch)
2. **SQL migration files** - User decision in CONTEXT.md prefers SQL over programmatic migrations
3. **Multi-schema native support** - `pgSchema` API handles per-package schemas cleanly
4. **Lightweight & serverless-friendly** - 2MB vs Prisma's 15MB, important for future edge deployment
5. **Active 2025-2026 ecosystem** - Growing adoption, excellent documentation, responsive maintainers
6. **Migration tooling built-in** - drizzle-kit handles generation, application, tracking without external tools

Kysely is excellent but lacks schema definition (pure query builder). Prisma is mature but heavier, slower, and uses non-TypeScript schema files. For this project's needs (greenfield, multi-schema, per-package ownership), Drizzle is the optimal choice.
