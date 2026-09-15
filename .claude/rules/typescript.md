---
paths:
  - "packages/**/*.ts"
  - "packages/**/*.tsx"
---

Never bypass the compiler (`as Type`, `!`, `// @ts-ignore`, `// @ts-expect-error`, `// biome-ignore`). If the types don't work, fix the types -- don't silence them. The only exception is test files deliberately passing invalid inputs.

Narrow `unknown` in catch blocks -- never assume the shape of an error. Use `instanceof Error` before accessing `.message` or `.stack`. For domain errors, chain checks: `instanceof TokenBudgetExhaustedError` before `instanceof Error`.

Never use `{}`, `Object`, or `Function` as types -- they erase type information and are effectively `any`. Use `Record<string, unknown>` for genuinely unknown objects, specific function signatures instead of `Function`, and proper interfaces for known shapes.

Don't use optional chaining (`?.`) to paper over nullability. If a value can be null, handle it explicitly with an early return, a guard, or a default -- don't chain past it and hope for the best.
