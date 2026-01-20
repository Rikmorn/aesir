# Phase 11: Monorepo Setup - Research

**Researched:** 2026-01-20
**Domain:** pnpm workspaces, TypeScript project references, monorepo architecture
**Confidence:** HIGH

## Summary

This research covers migrating from a flat npm-based structure to a pnpm workspace monorepo with four packages (`@aesir/common`, `@aesir/platform`, `@aesir/integrations`, `@aesir/agents`). The research confirms pnpm workspaces are the standard approach for TypeScript monorepos, providing better peer dependency handling than npm's `--legacy-peer-deps`, efficient disk usage via content-addressable storage, and native workspace protocol support.

TypeScript project references are the correct mechanism for enforcing import boundaries between packages at compile time. They require `composite: true` and generate `.d.ts` files that allow TypeScript to treat each package as a discrete unit, enabling incremental compilation and preventing arbitrary cross-package imports.

The migration from npm to pnpm is well-supported via `pnpm import`, but the CONTEXT.md decision to start fresh (delete lockfile) is simpler given the peer dependency issues. pnpm's default `auto-install-peers: true` combined with warning-based (not blocking) approach is more pragmatic than npm's strict-or-nothing model.

**Primary recommendation:** Use pnpm workspaces with `workspace:*` protocol for internal dependencies, TypeScript project references with `composite: true` for boundary enforcement, and root-level Biome configuration with `extends: "//"` inheritance in packages.

## Standard Stack

The established tools for TypeScript monorepos:

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| pnpm | 9.x | Package manager + workspaces | Content-addressable storage, strict node_modules, native workspace protocol |
| TypeScript | 5.7.x | Compilation + project references | Official composite/references support for monorepo boundaries |
| Biome | 2.3.x | Linting + formatting | Native monorepo support with nested configs, already in use |
| Vitest | 3.x | Testing | Projects configuration for monorepo test isolation |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| tsup/esbuild | Bundling | If packages need publishing (not needed for private monorepo) |
| Turborepo/Nx | Build orchestration | Only if build times become painful (decision: defer until needed) |
| Changesets | Version management | Only if publishing to npm (not needed - all private) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pnpm | npm workspaces | npm peer deps cause `--legacy-peer-deps` workarounds; no content-addressable storage |
| TypeScript refs | Path aliases only | No boundary enforcement, entire repo as one compilation unit |
| Root Biome | Per-package Biome | Unnecessary complexity, harder to maintain consistency |

**Installation:**
```bash
# Install pnpm globally (if not present)
npm install -g pnpm@9

# Migration (fresh start per CONTEXT.md decision)
rm -rf node_modules package-lock.json
pnpm install
```

## Architecture Patterns

### Recommended Project Structure
```
aesir/
├── packages/
│   ├── common/              # @aesir/common - shared contracts, config, utilities
│   │   ├── src/
│   │   │   ├── config/      # Config loading, env validation
│   │   │   ├── types/       # Cross-layer type contracts
│   │   │   └── utils/       # Shared utilities
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── platform/            # @aesir/platform - deployable platform services
│   │   ├── src/
│   │   │   ├── state/       # LangGraph state definitions
│   │   │   ├── temporal/    # Temporal workflows/activities
│   │   │   └── sandbox/     # Docker sandbox
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── integrations/        # @aesir/integrations - all integrations (split in Phase 16-18)
│   │   ├── src/
│   │   │   ├── linear/
│   │   │   ├── github/
│   │   │   └── slack/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── agents/              # @aesir/agents - agent implementations
│       ├── src/
│       │   ├── dev-agent/
│       │   ├── product-agent/
│       │   └── shared/      # Shared agent code (nodes, tracing)
│       ├── package.json
│       └── tsconfig.json
├── _legacy/                  # Temporary holding for orphan code
├── tests/
│   └── e2e/                  # Cross-package E2E tests
├── pnpm-workspace.yaml
├── package.json              # Root package.json (scripts, devDependencies)
├── tsconfig.json             # Root tsconfig (references only)
├── tsconfig.base.json        # Shared compiler options
├── biome.json                # Root Biome config
└── .npmrc                    # pnpm configuration
```

### Pattern 1: pnpm Workspace Configuration
**What:** Define workspace packages in `pnpm-workspace.yaml`
**When to use:** Always - required for pnpm workspaces
**Example:**
```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

### Pattern 2: Workspace Protocol for Internal Dependencies
**What:** Use `workspace:*` to link packages locally
**When to use:** Always for internal package dependencies
**Example:**
```json
// packages/agents/package.json
{
  "name": "@aesir/agents",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@aesir/common": "workspace:*",
    "@aesir/integrations": "workspace:*"
  }
}
```
**Source:** [pnpm Workspaces](https://pnpm.io/workspaces)

### Pattern 3: TypeScript Project References
**What:** Use `composite` and `references` to enforce boundaries
**When to use:** Always - enables incremental builds and prevents arbitrary imports
**Example:**
```json
// tsconfig.base.json - shared compiler options
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "composite": true,
    "incremental": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

```json
// tsconfig.json (root) - references only, no compiler options
{
  "files": [],
  "references": [
    { "path": "packages/common" },
    { "path": "packages/platform" },
    { "path": "packages/integrations" },
    { "path": "packages/agents" }
  ]
}
```

```json
// packages/common/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

```json
// packages/agents/tsconfig.json - depends on common + integrations
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../common" },
    { "path": "../integrations" }
  ]
}
```
**Source:** [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html), [Nx Blog](https://nx.dev/blog/typescript-project-references)

### Pattern 4: Layer Dependency Enforcement
**What:** References array defines allowed imports
**When to use:** Always - this is how TypeScript enforces boundaries

| Package | Can Import From | Cannot Import From |
|---------|-----------------|-------------------|
| common | (none) | platform, integrations, agents |
| platform | common | integrations, agents |
| integrations | common, platform | agents |
| agents | common, integrations | platform (through common only) |

**Enforcement mechanism:** If `agents/tsconfig.json` does not include `{ "path": "../platform" }` in references, any import from `@aesir/platform` will fail TypeScript compilation.

### Pattern 5: Biome Monorepo Configuration
**What:** Root config with `extends: "//"` in packages
**When to use:** When packages need rule overrides
**Example:**
```json
// biome.json (root) - already exists, update includes
{
  "$schema": "https://biomejs.dev/schemas/2.3.11/schema.json",
  "files": {
    "includes": ["packages/**/*.ts", "packages/**/*.tsx", "*.json"]
  }
  // ... rest of existing config
}
```

```json
// packages/agents/biome.json (only if overrides needed)
{
  "extends": "//",
  "linter": {
    "rules": {
      // package-specific overrides
    }
  }
}
```
**Source:** [Biome Big Projects](https://biomejs.dev/guides/big-projects/)

### Pattern 6: Per-Package Build Scripts
**What:** Each package has build script, root orchestrates
**When to use:** Always for independent package development
**Example:**
```json
// packages/common/package.json
{
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  }
}

// root package.json
{
  "scripts": {
    "build": "tsc -b",
    "build:common": "pnpm --filter @aesir/common build",
    "typecheck": "tsc -b --noEmit"
  }
}
```

### Anti-Patterns to Avoid
- **Circular references:** If A imports from B and B imports from A, create shared package C. Project references will fail compilation on cycles.
- **Skipping `composite: true`:** Without this, project references don't work and you lose incremental builds.
- **Global singletons across packages:** Each package should create its own instances, passed via DI.
- **Publishing `workspace:*`:** On publish, pnpm converts to real versions, but don't manually commit `workspace:*` as literal version numbers.
- **Editing pnpm-lock.yaml manually:** Always let pnpm manage it.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Import boundary enforcement | Custom ESLint/Biome rules | TypeScript project references | Native TypeScript support, compile-time enforcement, no runtime overhead |
| Workspace package linking | Manual symlinks | pnpm `workspace:*` protocol | Automatic, handles edge cases, works with build tools |
| Incremental TypeScript builds | Custom cache logic | `composite: true` + `tsc -b` | Built into TypeScript, handles dependency ordering |
| Cross-package testing | Custom test runner | Vitest projects/workspace | Native support for monorepo test isolation |
| Shared dependencies | Copy to each package | pnpm hoisting | Automatic deduplication, disk space savings |

**Key insight:** TypeScript project references provide boundary enforcement for free. ESLint/Biome rules for import restrictions are unnecessary overhead when references already prevent invalid imports at compile time.

## Common Pitfalls

### Pitfall 1: Peer Dependency Conflicts (LangChain Ecosystem)
**What goes wrong:** LangChain packages have complex peer dependency relationships. All `@langchain/*` packages must share the same `@langchain/core` version.
**Why it happens:** Each LangChain integration declares `@langchain/core` as a peer dependency. Version mismatches cause runtime errors.
**How to avoid:**
1. Install `@langchain/core` at root or in consuming package (agents)
2. Use pnpm's `resolve-peers-from-workspace-root: true` (default)
3. Pin all LangChain packages to compatible versions
**Warning signs:** pnpm peer dependency warnings mentioning `@langchain/core`, runtime errors about missing methods

**Source:** [LangChain Forum](https://forum.langchain.com/t/langgraph-cloud-deployments-pnpm-monorepo/289)

### Pitfall 2: Missing `composite: true` in Package tsconfigs
**What goes wrong:** Project references silently don't enforce boundaries. Full repo compiles as single unit.
**Why it happens:** Easy to forget when copying tsconfig boilerplate.
**How to avoid:** Every package tsconfig must extend base with `composite: true` inherited.
**Warning signs:** Imports work that shouldn't (e.g., agents importing from platform without reference)

### Pitfall 3: Root tsconfig with Compiler Options
**What goes wrong:** Circular reference when package configs try to extend root.
**Why it happens:** If root tsconfig has compiler options AND references, extending it creates circular dependency.
**How to avoid:** Root tsconfig should have only `files: []` and `references: [...]`. Put compiler options in `tsconfig.base.json`.
**Warning signs:** TypeScript error about circular reference during build

**Source:** [moonrepo TypeScript Guide](https://moonrepo.dev/docs/guides/javascript/typescript-project-refs)

### Pitfall 4: Forgetting `declaration: true`
**What goes wrong:** Project references can't find types from dependencies.
**Why it happens:** Project references consume `.d.ts` files, not source files.
**How to avoid:** `composite: true` implies `declaration: true` but verify it's set.
**Warning signs:** "Cannot find module '@aesir/common'" even though reference exists

### Pitfall 5: Not Setting Up pnpm-workspace.yaml Before Migration
**What goes wrong:** `pnpm import` fails for workspaces.
**Why it happens:** pnpm import requires workspace packages to be declared first.
**How to avoid:** Create `pnpm-workspace.yaml` and package structure BEFORE running `pnpm install`.
**Warning signs:** Import errors, packages not linked

**Source:** [pnpm import docs](https://pnpm.io/cli/import)

### Pitfall 6: TypeScript Types "Not Real-Time" Across Packages
**What goes wrong:** Changes in one package don't reflect in dependents until rebuild.
**Why it happens:** Project references use compiled `.d.ts` files, not source.
**How to avoid:** Run `tsc -b --watch` during development, or accept editor type-checking as sufficient.
**Warning signs:** Stale types, type errors that go away after build

### Pitfall 7: Vitest Per-Package Config Without `defineProject`
**What goes wrong:** Test config doesn't inherit correctly in workspace.
**Why it happens:** `defineConfig` is for standalone, `defineProject` is for workspace packages.
**How to avoid:** Use `defineProject()` from `vitest/config` in package-level configs.
**Warning signs:** Config options ignored, tests use wrong settings

**Source:** [Vitest Projects Guide](https://vitest.dev/guide/projects)

## Code Examples

Verified patterns from official sources:

### Complete Package Configuration Example

**Root package.json:**
```json
{
  "name": "aesir",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "prepare": "husky"
  },
  "devDependencies": {
    "@biomejs/biome": "2.3.11",
    "@types/node": "^22.0.0",
    "husky": "^9.1.7",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "packageManager": "pnpm@9.15.0"
}
```

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'packages/*'
```

**.npmrc:**
```ini
# Peer dependency handling
auto-install-peers=true
resolve-peers-from-workspace-root=true

# Workspace behavior
link-workspace-packages=true
prefer-workspace-packages=true

# Fail on workspace cycles (enforces layer rules)
disallow-workspace-cycles=true
```

**Vitest workspace configuration (vitest.config.ts):**
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
  },
});
```

**Package-level Vitest config (packages/common/vitest.config.ts):**
```typescript
import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "common",
    environment: "node",
  },
});
```

### Running Commands

```bash
# Install all workspace packages
pnpm install

# Build all packages (respects dependency order)
pnpm build
# or
tsc -b

# Build specific package
pnpm --filter @aesir/common build

# Run tests across all packages
pnpm test

# Run tests for specific package
pnpm --filter @aesir/agents test

# Typecheck without emit
pnpm typecheck

# Add dependency to specific package
pnpm --filter @aesir/agents add lodash

# Add workspace dependency
pnpm --filter @aesir/agents add @aesir/common
# Results in "workspace:*" in package.json
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| npm workspaces + `--legacy-peer-deps` | pnpm workspaces | pnpm 7+ (2022) | Better peer dep handling, disk efficiency |
| Path aliases only | TypeScript project references | TS 3.0 (2018), mature by 5.x | Compile-time boundary enforcement |
| ESLint for import boundaries | TypeScript references | TS 3.0+ | No runtime overhead, native support |
| Vitest workspace file | Vitest `projects` config | Vitest 3.2 (2025) | `workspace` deprecated, `projects` is current |
| Lerna for orchestration | pnpm built-in + Turborepo/Nx if needed | 2022+ | Lerna largely obsolete for new projects |

**Deprecated/outdated:**
- **Lerna:** Largely replaced by pnpm workspaces + Turborepo/Nx
- **yarn.lock in this repo:** package.json has stale `packageManager: yarn@1.22.19` - must remove
- **Vitest `workspace`:** Deprecated in 3.2, use `projects` instead

## Open Questions

Things that couldn't be fully resolved:

1. **Temporal Worker Bundling in Monorepo**
   - What we know: Temporal workers have strict bundling requirements for workflow code
   - What's unclear: Whether project references affect Temporal's module resolution
   - Recommendation: Keep temporal code in platform package, test bundling early

2. **Docker Multi-Stage Builds with pnpm**
   - What we know: pnpm has different node_modules structure (.pnpm symlinks)
   - What's unclear: Best pattern for minimizing Docker image size
   - Recommendation: Minimal Docker changes in this phase (per CONTEXT.md), polish in Phase 22

3. **LangChain Peer Dependency Resolution**
   - What we know: Complex peer deps exist, pnpm handles better than npm
   - What's unclear: Whether all current LangChain packages have compatible peer deps
   - Recommendation: Run `pnpm install` early in migration, address warnings immediately

## Sources

### Primary (HIGH confidence)
- [pnpm Workspaces](https://pnpm.io/workspaces) - Official workspace documentation
- [pnpm Settings](https://pnpm.io/9.x/npmrc) - .npmrc configuration options
- [pnpm import](https://pnpm.io/cli/import) - Migration from npm
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) - Official TS docs
- [Vitest Projects](https://vitest.dev/guide/projects) - Official Vitest monorepo guide
- [Biome Big Projects](https://biomejs.dev/guides/big-projects/) - Monorepo configuration

### Secondary (MEDIUM confidence)
- [Nx Blog: TypeScript Project References](https://nx.dev/blog/typescript-project-references) - Comprehensive guide with examples
- [moonrepo TypeScript Guide](https://moonrepo.dev/docs/guides/javascript/typescript-project-refs) - Alternative perspective on references
- [LangChain Forum: pnpm Monorepo](https://forum.langchain.com/t/langgraph-cloud-deployments-pnpm-monorepo/289) - Real-world LangChain + pnpm issues

### Tertiary (LOW confidence)
- WebSearch results on common pitfalls - Community experiences, not official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - pnpm + TypeScript refs is well-documented standard
- Architecture: HIGH - Structure matches CONTEXT.md decisions, patterns verified with official docs
- Pitfalls: HIGH - Most pitfalls from official docs (TS handbook, pnpm docs)
- LangChain peer deps: MEDIUM - Known issue area, pnpm handles better but needs validation

**Research date:** 2026-01-20
**Valid until:** 90 days (stable tooling, infrequent breaking changes)
