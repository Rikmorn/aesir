---
phase: 14-platform-services
plan: 02
subsystem: build
tags: [biome, lint, architecture, layer-boundaries]

dependency-graph:
  requires: [11-02]  # Layer structure from monorepo setup
  provides: [ARCH-07-biome-enforcement]
  affects: [all-future-development]

tech-stack:
  added: []
  patterns: [noRestrictedImports-layer-enforcement]

key-files:
  created: []
  modified:
    - biome.json

decisions:
  - id: "14-02-01"
    decision: "Use Biome noRestrictedImports for layer boundary enforcement"
    rationale: "Clearer error messages than TypeScript project references during development"

metrics:
  duration: "1 min"
  completed: "2026-01-21"
---

# Phase 14 Plan 02: Biome Layer Rules Summary

**One-liner:** Biome noRestrictedImports rules enforce 4-layer architecture at lint time with clear error messages

## What Was Built

Added Biome linting rules to enforce the layer dependency hierarchy:

```
Agents -> Integrations -> Platform -> Common
```

**Layer rules configured:**
- **Common (leaf):** Cannot import from agents, integrations, or platform
- **Platform:** Cannot import from agents or integrations
- **Integrations:** Cannot import from agents
- **Agents:** Can import from all lower layers (no restrictions)

## How It Works

The biome.json now has package-specific overrides using the `noRestrictedImports` rule:

```json
{
  "includes": ["packages/platform/**/*.ts"],
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "patterns": [
              {
                "group": ["@aesir/agents", "@aesir/agents/*"],
                "message": "Platform layer cannot import from agents layer..."
              }
            ]
          }
        }
      }
    }
  }
}
```

When violated, developers see clear error messages:

```
lint/style/noRestrictedImports
Platform layer cannot import from agents layer. Layer order: Agents -> Integrations -> Platform -> Common
```

## Technical Decisions

### 1. Biome noRestrictedImports (not TSConfig alone)

**Choice:** Add Biome rules in addition to TypeScript project references

**Why:** TypeScript project references already enforce boundaries at compile time, but Biome provides:
- Clearer error messages explaining WHY the import is forbidden
- Faster feedback (lint runs faster than type checking)
- Better DX during development

**Tradeoff:** Slight redundancy with TS project references, but defense-in-depth is valuable for architecture enforcement.

### 2. No observability package restrictions

**Choice:** Did not add observability to restricted imports

**Why:** The observability package is designed to be used across all layers for logging. Adding restrictions would prevent legitimate logging imports.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| b168ff2 | feat | add layer boundary rules via noRestrictedImports |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- [x] biome.json has noRestrictedImports overrides for platform, integrations, common
- [x] Platform cannot import from agents or integrations (lint error verified)
- [x] Integrations cannot import from agents (rule configured)
- [x] Common cannot import from any other layer (rule configured)
- [x] Error messages clearly explain the layer order
- [x] Existing codebase passes lint (no layer violations)
- [x] Full build passes (`pnpm build` exits 0)

## Files Changed

| File | Change |
|------|--------|
| biome.json | Added 3 package-specific overrides with noRestrictedImports rules |

## Next Phase Readiness

**Blockers:** None

**Ready for:** Plan 14-03 (whatever is next in the phase)

**Notes:**
- Pre-existing lint violations (noNonNullAssertion, noExplicitAny) remain deferred
- Layer enforcement is now active for all new code
