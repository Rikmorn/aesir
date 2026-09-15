---
issue: 17
kind: direction
summary: Replace vitest with bun test — a migration, not a switch, since 49 of 73 test files use vi.mock, vi.fn or vi.spyOn, plus msw and testcontainers.
---

# Bun as the test runner

## Context
The 2026-09 reset already moved bun in as the runtime for scripts, replacing tsx. The test suite still runs on vitest, and switching it too would touch a majority of the repo's test files — `find packages -name "*.test.ts" | wc -l` for the total, `grep -lrE "vi\.(mock|fn|spyOn)" packages --include="*.test.ts" | wc -l` for how many use `vi.mock`, `vi.fn` or `vi.spyOn` (49 of 73 as of 2026-09-15) — plus msw and testcontainers-backed integration tests, none of which `bun test` supports as a drop-in replacement.

## Trigger to revisit
Pick this up once bun-as-dev-runtime has been in production use for a while and the suite is green (Rikmorn/aesir#1 closed), and only if the speed gain is worth rewriting 49 files' worth of mocks.

## Reference
- Rikmorn/aesir#17 (status lives there)
- `package.json` (`test`, `test:fast`, `test:integration` scripts — the vitest surface a migration would replace)
