# The development harness

How guidance reaches whoever is building this repo, and why it is laid out this way. Present tense; the experiment behind the matrix is re-run when the layout or Claude Code changes.

## Layers

| Layer | Path | Loaded by | Holds |
|---|---|---|---|
| Project | `CLAUDE.md` → `AGENTS.md` | every session, every subagent, sidekick's executor (explicit read) | what applies everywhere: architecture, commands, code patterns, the package pointer block |
| Rules | `.claude/rules/*.md` | the main session (path-scoped by `paths:`); sidekick's executor (all files, explicit read); a Task subagent too — every rule file without a `paths:` frontmatter (`grep -L '^paths:' .claude/rules/*.md` lists them; today all are `sk-*` files) is in context at dispatch, and a path-scoped one arrives once it reads a matching file (touch-triggered) | domain rules: TypeScript, PostgreSQL, testing, sidekick's working standards, clean code, language, PM conventions, guidance authoring |
| Package | `packages/<pkg>/CLAUDE.md` | sessions started in that directory; the main session when it works on files there; a Task subagent too, once it reads a file inside that package (touch-triggered, not at dispatch) | what applies only to that package |
| Package skills | `packages/dashboard/.claude/skills/*` | sessions started in `packages/dashboard`; a session started at the repo root too, once it reads a file inside the package (touch-triggered, measured 2026-09-16, Claude Code 2.1.273) | impeccable, shadcn, vercel-react-best-practices |
| Hooks | `.claude/settings.json` | each hook only on its own declared matcher: `guard-schema-drizzle` on `Edit\|Write\|MultiEdit` (shell writes through `sed` or a heredoc still bypass it), `guard-env-commit` on `Bash`, Biome on `Edit\|Write\|MultiEdit`, `session-context` on `SessionStart` (not a tool call at all). The guard hooks (`.claude/hooks/guard-*.sh`) need `python3` on `PATH` and the Biome hook needs `jq`; each script swallows the failure and exits 0, so a missing binary turns the hook into a silent no-op | schema retention guard, `.env` staging guard, Biome on edit, context re-injection after compaction |
| Personal | `.claude/settings.local.json` (gitignored) | this machine | sidekick's config guard, personal permissions |

## Why the root file is a symlink

`CLAUDE.md` at the repo root is a symlink to `AGENTS.md`, not an `@`-import line. Two measured facts favour the symlink, reproducible via §Re-running the experiment:

- An `@` import is not expanded for a session started inside a package (experiments E1, E2a). A nested `CLAUDE.md`'s upward `@../../AGENTS.md` reaches a Task subagent's context as the literal string, never as the file it names (experiment E2b).
- A symlink is read as content, from both the root and a package directory. Heading count comes back `1` from both cwds, which no import-based layout achieved from a package directory (experiment E3).

`sk-executor` reads `./CLAUDE.md` by a fixed path (`~/.claude/agents/sk-executor.md:40`). Measured this session: a scratch file containing an `@`-import line, read with the `Read` tool, comes back as the literal line, not the imported file's content — confirming `Read` does not expand `@`. A plain `@AGENTS.md` line at that path would hand the executor ten characters, not the guidance; through the symlink, the same read returns `AGENTS.md`'s full content.

The symlink fails differently from the alternatives, and silently: on a checkout without symlink support (Windows without developer mode, `core.symlinks=false`) or when the file is fetched raw over HTTP, `CLAUDE.md` becomes a one-line text file reading `AGENTS.md` — every worker there loses all project guidance, with no error and no empty file to flag it.

## What each kind of worker sees (measured 2026-09-16, Claude Code 2.1.273)

| Worker | `AGENTS.md` (via `CLAUDE.md` symlink) | `.claude/rules/sk-typescript.md` (path-scoped) | nested package `CLAUDE.md` | skills listed |
|---|---|---|---|---|
| headless, cwd = repo root | seen | not seen | not seen | seen |
| headless, cwd = `packages/dashboard` | seen | not seen | seen (dashboard) | seen (incl. dashboard skills) |
| headless, cwd = `packages/agents` | seen | not seen | seen (agents); not seen (dashboard) | seen (no dashboard skills) |
| Task subagent from root, before file access (A) | seen — stale, see note | not seen | not seen | seen |
| Task subagent from root, after reading a dashboard file (B) | seen — stale, unchanged from A | seen | seen (dashboard); not seen (agents) | seen — unchanged from A |
| Main session, cwd = repo root, after reading one file inside a package (measured 2026-09-16, Claude Code 2.1.273) | not tested | not tested | seen (the package whose file was read) | seen (the dashboard skills, once a `packages/dashboard/` file is read) |

`not seen` means a row's method asked the question and the layer was absent; `not tested` means that row's method never asked, so no claim is made either way. The two Task-subagent rows' `AGENTS.md` content is also a stale pre-restructure snapshot, captured at dispatch rather than read fresh from disk, not the file as it currently exists. Full per-cell quotes are reproducible via §Re-running the experiment.

## The Part 4 gate

The project reset's Part 4 spec, under "Gates": "a worker spawned in `packages/dashboard` reports the UI skills and the design system; one in `packages/agents` reports the agent-first rules; a root worker reports neither package layer."

All three clauses pass, measured 2026-09-16 and reproducible via §Re-running the experiment:

- **`packages/dashboard` reports the UI skills and the design system — passed.** It lists `impeccable, shadcn, vercel-react-best-practices` among its skills and reports `packages/dashboard/CLAUDE.md`'s `## Design system` heading.
- **`packages/agents` reports the agent-first rules — passed.** It reports `packages/agents/CLAUDE.md`'s `## MANDATORY: Agent-First Decision Checklist` heading.
- **a root worker reports neither package layer — passed.** It states `packages/dashboard/CLAUDE.md` is "not visible in my context. The root CLAUDE.md only points at it," lists no package `CLAUDE.md` — including `packages/agents/CLAUDE.md` — anywhere in its instruction-file enumeration, and lists no package-scoped skill (`impeccable`, `shadcn`, `vercel-react-best-practices`) among the skills it reports.

## Consequences

- A task that sends a worker into a package names that package's `CLAUDE.md`; the pointer block in `AGENTS.md` is the backstop.
- Sidekick's executor reads `./CLAUDE.md`, `./.claude/rules/*.md`, and any `./.sidekick/decisions/*.md` whose name matches the task's surface area; anything it must know lives in one of those or is cited by the task.
- Rules are the expensive layer (every main-session turn). Add one only when reasoning alone can't get there (`.claude/rules/sk-guidance-authoring.md` §Admission).
- Third-party skills are never edited; scoping goes in the package `CLAUDE.md`.
- Hooks in `.claude/settings.json` take effect mid-session, not only at session start: a `PostToolUse` Biome hook added earlier in a session fired on a later `Edit` in that same session, without a restart (measured, Claude Code 2.1.273).
- The Biome hook matches `Edit|Write|MultiEdit` only; a file written through the shell — which this repo's own bypass-permissions instructions direct agents to prefer — is not formatted by it.
- A Task subagent's `AGENTS.md` is the parent session's copy from session start, not the file on disk. Measured: after the file was restructured, a subagent dispatched from a session predating the change still reported the old headings.
- A session that edits `AGENTS.md` or a package `CLAUDE.md` restarts before dispatching workers.
- `/sk-build` dispatching from a long-running session hands its executors stale guidance.

## Re-running the experiment

```bash
P='Do not use any tools. Reply with a bullet list and nothing else: (1) the H1 and H2 headings of every project instruction file currently in your context, (2) the first line of every rule file in your context, (3) the names of every skill listed to you, (4) the H1 of packages/dashboard/CLAUDE.md if you can see it, quoted exactly, (5) the first line of .claude/rules/sk-typescript.md if you can see it, quoted exactly.'
claude -p "$P" --no-session-persistence
(cd packages/dashboard && claude -p "$P" --no-session-persistence)
(cd packages/agents && claude -p "$P" --no-session-persistence)
```

Sources: `~/.claude/agents/sk-executor.md` §execution_flow (installed copy of sidekick's executor); the commands above regenerate the visibility evidence directly.
