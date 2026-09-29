---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript in aesir

This file holds aesir's additions to the user-level `sk-typescript.md`. It lives apart because `sidekick rules install` rewrites the `sk-*` files from its shipped copies.

`sk-typescript.md` bans the linter's suppression comment as a way to bypass the compiler. This repo's linter is Biome, and the ban covers `// biome-ignore` for its type-safety rules: `noExplicitAny`, `noNonNullAssertion`, `noImplicitAnyLet` and `noBannedTypes`. The type-safety suppressions already in the code are debt (#100), not precedent.

A suppression of any other Biome rule is allowed when the text after its colon gives the reason. Two sanctioned cases recur:

- `lint/suspicious/noConsole` in `packages/dashboard`, which has no pino logger.
- The vendored shadcn components under `packages/dashboard/src/components/ui/`, which stay as shadcn ships them.
