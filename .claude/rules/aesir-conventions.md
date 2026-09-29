# Aesir conventions

These conventions apply in every aesir session. They layer on the user-level `sk-*` rules that sidekick installs into `~/.claude/rules/`, and both bind. Where aesir departs from an `sk-*` rule, the ruling is stated here or in the path-scoped rule beside this file.

Conventions that target particular folders or files live in path-scoped rules next to this file: `typescript.md`, `testing.md` and `postgresql.md`.

## Environment

- The only env files are `.env` (gitignored, real credentials) and `.env.example` (tracked template). There are no per-environment files.
- Each service validates its env against a Zod schema at startup and exits when a variable is missing.
- Scripts such as seeds and migrations read the root `.env`: call `loadEnvFromRoot()` from `@aesir/platform` before reading `process.env`.

## Integrations

- Agent code reaches Linear, GitHub and Slack only through `callMcpTool()` over HTTP, never by importing an integration SDK (ADR-0004). `packages/integrations/CLAUDE.md` covers the integration side.
- `packages/agents/README.md` lists the MCP tools and endpoints and shows `callMcpTool` usage. Each integration's README covers its own API and env vars.

## Code

- Log with `createPinoLogger` from `@aesir/platform`. Biome's `noConsole` rejects `console` calls in production code. Where no pino logger exists, as in the dashboard or in startup code that reports an env failure, use `console` under a reasoned suppression (`typescript.md`).
- Runtime schemas at external boundaries (webhooks, API inputs, env vars) are Zod.
- Wrap each external API call in `try`/`catch`, and log the failure with its context: `logger.error({ err, issueId }, "message")`.
- Export a module's types alongside its implementation.

## Services

A service is a factory function with explicit dependencies, not a class.

- Create services at application startup and pass them to handlers.
- Take dependencies through an options object (`db`, `logger`, `config`), and throw at construction when a required one is missing.
- Give every service `health()` and `close()` for its lifecycle. A database service's `health()` runs `SELECT 1`.
- Export the interface beside the factory.

## Tests

- A unit test sits next to its source: `foo.ts` → `foo.test.ts`. Run one with `npx vitest run path/to/foo.test.ts`.
- The LLM-judged scenario suite (`test:agents`) covers agent behaviour. Plumbing, such as the executor, routing, signals, persistence and tool wiring, needs a deterministic test. A design that only a scenario run can check will not be checked.
- When manual testing finds a behaviour problem, codify it as a new scenario; `testing.md` covers how scenarios are written.

## Package READMEs

When you change a package's public interface (new tools, changed APIs, updated setup), update its README in the same change. Agents read package READMEs as implementation guides, so a stale README produces wrong code.

## Sidekick is under test here

This repo is built with [sidekick](https://github.com/Rikmorn/sidekick), and sidekick is under test here. Its `sk-*` rules bind. Its skills and workflows are what is being evaluated, so be critical of how they work.

- Log gaps, annoyances, bugs, confusing output, missing capabilities and improvement ideas in `docs/superpowers/sidekick-testbench-log.md` as they happen, whoever notices them. Each entry gives the date, who, what happened, why it matters, and a proposed disposition. The log is local and not committed.
- At the end of a session, review the log with Roberto. File the entries that deserve it on `Rikmorn/sidekick`, one `area:*` label each, with a body that says what happened in aesir.
- When sidekick blocks the work, or either of you is uncomfortable with how it handles something, fall back to the superpowers workflow for that task and log it. The fallback is the record, not a failure.
