---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript in aesir

Aesir-specific additions to `sk-typescript.md`, kept apart from it because `sidekick init` overwrites the `sk-*` files.

This repo's linter is Biome, so the suppression comment to avoid is `// biome-ignore`.

Aesir has domain error classes such as `TokenBudgetExhaustedError`. When narrowing a caught error, chain `instanceof TokenBudgetExhaustedError` before `instanceof Error`.
