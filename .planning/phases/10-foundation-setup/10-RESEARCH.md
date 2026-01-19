# Phase 10: Foundation Setup - Research

**Researched:** 2026-01-19
**Domain:** Development tooling, linting/formatting, environment configuration, AI-assisted development
**Confidence:** HIGH

## Summary

This phase establishes standardized development tooling for the Aesir project. The research covers Biome (linting/formatting), dotenv-flow (environment hierarchy), husky/lint-staged (pre-commit hooks), Zod (env validation), and AI context files (.claude/.cursor).

The existing codebase has ~21,500 lines of TypeScript, uses yarn (with packageManager specified), has a comprehensive .env.example, and already uses Zod for agent configuration validation. No existing linting/formatting tools are configured beyond TypeScript's type checking.

**Primary recommendation:** Use Biome 2.3.x with the `--staged` flag for pre-commit hooks (eliminating lint-staged for Biome operations), but run TypeScript type-checking as a separate full-project check since staged-only type checking is fundamentally flawed.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| [@biomejs/biome](https://biomejs.dev/) | 2.3.x | Linting + formatting | 97% Prettier compatibility, 340+ rules, 10-100x faster than ESLint |
| [dotenv-flow](https://github.com/kerimdzhanov/dotenv-flow) | ^4.1.0 | Env file hierarchy | NODE_ENV-based cascading, established pattern |
| [husky](https://github.com/typicode/husky) | ^9.x | Git hooks | De facto standard for JS/TS git hooks |
| [zod](https://zod.dev/) | 3.25.x | Env validation | Already in project, TypeScript-first validation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lint-staged | ^15.x | Run commands on staged files | Only for tsc type-checking (Biome has native --staged) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| dotenv-flow | dotenv + manual logic | dotenv-flow handles hierarchy automatically |
| Husky | Lefthook | Lefthook is faster/dependency-free, but Husky is more widely adopted |
| lint-staged for Biome | Biome --staged | Biome 1.7+ has native --staged flag, eliminating need for lint-staged |

**Installation:**
```bash
npm install --save-dev --exact @biomejs/biome husky lint-staged
npm install dotenv-flow
```

Note: Biome recommends exact version pinning to avoid unexpected behavior between versions.

## Architecture Patterns

### Recommended Project Structure
```
/
├── biome.json              # Biome configuration (root)
├── .env                    # Default fallback values (tracked)
├── .env.example            # Documentation with all vars (tracked)
├── .env.development        # Development defaults (tracked)
├── .env.test               # Test defaults (tracked)
├── .env.production         # Production defaults (tracked, no secrets)
├── .env.local              # Local overrides (gitignored)
├── .env.*.local            # Environment-specific local (gitignored)
├── .husky/
│   └── pre-commit          # Pre-commit hook script
├── .vscode/
│   └── settings.json       # VS Code integration
├── .claude/
│   └── CLAUDE.md           # Claude Code context (or root CLAUDE.md)
├── .cursor/
│   └── rules/              # Cursor AI rules
└── src/
    └── config/
        └── env.ts          # Zod-validated environment config
```

### Pattern 1: Zod Environment Validation with Fail-Fast
**What:** Validate all environment variables at startup using Zod, exit immediately with actionable errors if validation fails
**When to use:** Always - prevents runtime errors from missing configuration
**Example:**
```typescript
// Source: https://dev.to/schead/ensuring-environment-variable-integrity-with-zod-in-typescript-3di5
import { z } from "zod";
import dotenvFlow from "dotenv-flow";

// Load env files based on NODE_ENV
dotenvFlow.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Required secrets (presence only)
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),

  // Optional with defaults
  DATABASE_URL: z.string().url().default("postgresql://localhost:5432/aesir"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Environment validation failed:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Typed config object for application use
export const config = {
  nodeEnv: env.NODE_ENV,
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
  },
  github: {
    token: env.GITHUB_TOKEN,
  },
  database: {
    url: env.DATABASE_URL,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
} as const;
```

### Pattern 2: Biome Configuration for Practical Strict TypeScript
**What:** Ban explicit `any`, enforce naming conventions, warn on console.log
**When to use:** All TypeScript projects wanting strict-but-pragmatic linting
**Example:**
```json
// Source: https://biomejs.dev/reference/configuration/
{
  "$schema": "https://biomejs.dev/schemas/2.3.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["src/**/*.ts", "src/**/*.tsx", "*.json"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80,
    "lineEnding": "lf"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error",
        "noConsoleLog": "error"
      },
      "complexity": {
        "recommended": true
      },
      "style": {
        "useNamingConvention": {
          "level": "error",
          "options": {
            "strictCase": false,
            "conventions": [
              { "selector": { "kind": "variable" }, "formats": ["camelCase", "CONSTANT_CASE"] },
              { "selector": { "kind": "function" }, "formats": ["camelCase"] },
              { "selector": { "kind": "typeLike" }, "formats": ["PascalCase"] },
              { "selector": { "kind": "const", "scope": "global" }, "formats": ["camelCase", "CONSTANT_CASE", "PascalCase"] }
            ]
          }
        }
      }
    }
  },
  "organizeImports": {
    "enabled": true
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "overrides": [
    {
      "includes": ["**/*.test.ts", "**/*.test.tsx"],
      "linter": {
        "rules": {
          "suspicious": {
            "noConsoleLog": "off"
          }
        }
      }
    }
  ]
}
```

### Pattern 3: Pre-commit Hook with Biome Native Staged + Separate Type Check
**What:** Use Biome's built-in --staged flag plus separate full-project type check
**When to use:** All projects using Biome with TypeScript
**Example:**
```bash
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Biome handles its own staged files natively
npx @biomejs/biome check --staged --write --files-ignore-unknown=true --no-errors-on-unmatched

# Stage any auto-fixed files
git update-index --again

# TypeScript type-check must run on full project (staged-only is fundamentally broken)
npx tsc --noEmit
```

### Anti-Patterns to Avoid
- **Staged-only TypeScript type checking:** TypeScript type checking is inherently a whole-project operation. Using tsc-files or similar tools creates false confidence - a change in one file can cause type errors in files that weren't staged.
- **Running ESLint alongside Biome:** Biome includes 340+ rules from ESLint/typescript-eslint. Running both is redundant and slower.
- **Environment files with secrets in version control:** Only .env, .env.development, .env.test should be tracked. All *.local files must be gitignored.
- **Validating env vars on-demand:** Check at startup, not when first accessed. Fail fast.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Env file loading by NODE_ENV | Custom loader checking multiple files | dotenv-flow | Handles priority correctly, skips .env.local in test |
| Env validation | `if (!process.env.X) throw` checks | Zod schema | Type inference, validates all at once, actionable errors |
| Format/lint configuration | ESLint + Prettier configs | Biome single config | One tool, one config, 10-100x faster |
| Git hook management | .git/hooks scripts | Husky | Cross-platform, version controlled, auto-installs |
| Staged file filtering | Manual git diff parsing | Biome --staged or lint-staged | Battle-tested edge case handling |

**Key insight:** The JavaScript ecosystem has mature, well-tested solutions for all these problems. Hand-rolling introduces subtle bugs around edge cases (symlinks, binary files, encoding) that these tools have already solved.

## Common Pitfalls

### Pitfall 1: TypeScript Type Checking on Staged Files Only
**What goes wrong:** Developers expect staged-only type checking to catch all type errors, but TypeScript's type system is project-wide.
**Why it happens:** lint-staged encourages running tools only on staged files, which works for formatters but not type checkers.
**How to avoid:** Run `tsc --noEmit` on the full project in pre-commit. Accept the ~10-15 second overhead.
**Warning signs:** Type errors appearing in CI that weren't caught locally.

### Pitfall 2: Missing NODE_ENV Causes dotenv-flow to Skip Environment Files
**What goes wrong:** dotenv-flow only loads .env.{NODE_ENV} files when NODE_ENV is set. If unset, only .env and .env.local are loaded.
**Why it happens:** Developers run scripts without setting NODE_ENV explicitly.
**How to avoid:** Use `default_node_env: 'development'` option, or set NODE_ENV in package.json scripts.
**Warning signs:** Variables present in .env.development not loading in local development.

### Pitfall 3: Biome Auto-fix Creates Unstaged Changes
**What goes wrong:** Biome fixes files but they're not staged, causing subsequent tsc or checks to see different code than what's committed.
**How to avoid:** Run `git update-index --again` after Biome fixes, or use lint-staged which handles this automatically.
**Warning signs:** Pre-commit passes but CI fails on the same commit.

### Pitfall 4: Forgetting to Remove yarn.lock After npm Migration
**What goes wrong:** Both package-lock.json and yarn.lock exist, causing confusion about which package manager to use.
**Why it happens:** Installing via npm creates package-lock.json but doesn't remove yarn.lock.
**How to avoid:** Explicitly delete yarn.lock and remove packageManager field from package.json during migration.
**Warning signs:** Different team members using different package managers.

### Pitfall 5: AI Context Files Becoming Stale
**What goes wrong:** CLAUDE.md describes patterns that no longer exist in the codebase.
**Why it happens:** Code changes but context files aren't updated.
**How to avoid:** Include CLAUDE.md updates in the definition of done for architectural changes.
**Warning signs:** AI assistants suggesting deprecated patterns.

## Code Examples

Verified patterns from official sources:

### dotenv-flow Configuration
```typescript
// Source: https://github.com/kerimdzhanov/dotenv-flow
import dotenvFlow from "dotenv-flow";

// Load at application entry point, before any other imports that use env vars
dotenvFlow.config({
  default_node_env: "development",  // Fallback when NODE_ENV is unset
  silent: true,                      // Don't log warnings
});

// File loading priority (lowest to highest):
// 1. .env
// 2. .env.local (skipped when NODE_ENV=test)
// 3. .env.${NODE_ENV}
// 4. .env.${NODE_ENV}.local
// 5. Already-set environment variables (CLI, system)
```

### Husky Initialization
```bash
# Source: https://typicode.github.io/husky/
npx husky init

# Creates:
# - .husky/ directory
# - .husky/pre-commit script
# - Adds "prepare": "husky" to package.json
```

### VS Code Settings for Biome
```json
// Source: https://biomejs.dev/reference/vscode/
// .vscode/settings.json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports.biome": "explicit",
    "source.fixAll.biome": "explicit"
  },
  "[typescript]": {
    "editor.defaultFormatter": "biomejs.biome"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "biomejs.biome"
  },
  "[json]": {
    "editor.defaultFormatter": "biomejs.biome"
  },
  "[jsonc]": {
    "editor.defaultFormatter": "biomejs.biome"
  }
}
```

### CLAUDE.md Structure
```markdown
// Source: https://www.anthropic.com/engineering/claude-code-best-practices

# Project: Aesir

Agentic development platform for automated software workflows.

## Architecture

- 3-layer architecture: Platform -> Integrations -> Agents
- LLM calls only via MCP (Model Context Protocol)
- TypeScript with strict mode, Zod for validation

## Common Commands

- `npm run dev` - Start development server
- `npm run test` - Run tests with vitest
- `npm run lint` - Run Biome linting
- `npx biome check --write` - Fix lint/format issues

## Code Patterns

- Use Zod schemas for all external data validation
- Prefer explicit types over inference for public APIs
- Use pino logger, not console.log

## Testing

- Test files: `*.test.ts` next to source files
- Run single test: `npx vitest run path/to/file.test.ts`

## Gotchas

- Temporal workflows have serialization constraints
- LangGraph state must be serializable
```

### .cursor/rules Example
```markdown
// Source: https://cursor.com/docs/context/rules
---
description: "TypeScript coding standards for Aesir project"
globs: ["src/**/*.ts"]
alwaysApply: true
---

# TypeScript Standards

- Use explicit return types for public functions
- Prefer `unknown` over `any`
- Use Zod for runtime validation at boundaries
- No console.log in production code

# Error Handling

- Wrap external API calls in try/catch
- Use typed error classes for domain errors
- Log errors with context using pino logger
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ESLint + Prettier separate | Biome unified | 2024 | Single config, 10-100x faster |
| dotenv manual files | dotenv-flow hierarchy | Established | Automatic NODE_ENV handling |
| Custom git hooks | Husky + native --staged | Biome 1.7 (2024) | lint-staged optional for Biome |
| .cursorrules (single file) | .cursor/rules/ (directory) | 2025 | Per-path rule scoping |

**Deprecated/outdated:**
- **.cursorrules file:** Still supported but deprecated. Use .cursor/rules/ directory instead.
- **lint-staged for Biome:** Biome 1.7+ has native --staged flag, eliminating the need for lint-staged for format/lint operations.
- **rome:** Predecessor to Biome, abandoned. Biome is the maintained fork.

## Open Questions

Things that couldn't be fully resolved:

1. **Biome import sorting stability**
   - What we know: Context document mentions "if problems, leave to VS Code"
   - What's unclear: Whether current Biome 2.3.x has resolved historical issues
   - Recommendation: Enable organizeImports, disable if issues arise

2. **Existing code violation count**
   - What we know: ~21,500 lines of TypeScript exist
   - What's unclear: How many Biome violations exist in current code
   - Recommendation: Run `npx biome check` to audit, then decide fix-all vs gradual

3. **Pre-commit hook timing**
   - What we know: Decision says ~10-15 seconds acceptable
   - What's unclear: Actual timing with full tsc + Biome on this codebase
   - Recommendation: Measure after implementation, optimize if needed

## Sources

### Primary (HIGH confidence)
- [Biome Configuration Reference](https://biomejs.dev/reference/configuration/) - Complete biome.json structure
- [Biome Git Hooks Guide](https://biomejs.dev/recipes/git-hooks/) - Native --staged support
- [dotenv-flow GitHub](https://github.com/kerimdzhanov/dotenv-flow) - File priority and API
- [lint-staged GitHub](https://github.com/lint-staged/lint-staged) - Configuration options
- [Anthropic Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices) - CLAUDE.md guidance
- [Cursor Rules Documentation](https://cursor.com/docs/context/rules) - .cursor/rules format

### Secondary (MEDIUM confidence)
- [Biome noExplicitAny Rule](https://biomejs.dev/linter/rules/no-explicit-any/) - Ban any configuration
- [Biome useNamingConvention Rule](https://biomejs.dev/linter/rules/use-naming-convention/) - Naming conventions
- [Biome noConsole/noConsoleLog](https://biomejs.dev/linter/rules/no-console/) - Console rule options
- [Zod Environment Validation Guide](https://dev.to/schead/ensuring-environment-variable-integrity-with-zod-in-typescript-3di5) - Pattern examples

### Tertiary (LOW confidence)
- [lint-staged TypeScript tsc issue](https://github.com/lint-staged/lint-staged/issues/1352) - Confirms staged-only tsc limitation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official documentation verified
- Architecture: HIGH - Patterns from official sources
- Pitfalls: MEDIUM - Mix of official docs and community experience

**Research date:** 2026-01-19
**Valid until:** 2026-02-19 (Biome releases frequently, check for updates)
