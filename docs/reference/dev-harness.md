# The development harness

How guidance reaches whoever is building this repo, and why it is laid out this way. Present tense. The matrix is re-measured with `scripts/harness-probe.sh` whenever the layout or Claude Code changes.

## Layers

| Layer | Path | Loaded by | Holds |
|---|---|---|---|
| Project | `CLAUDE.md` → `AGENTS.md` | every session, whether started at the root or in a package, and every subagent | what the project is: architecture, commands, gotchas, the package pointer block |
| User rules | `~/.claude/rules/sk-*.md`, which sidekick installs | every session. A rule without `paths:` loads at start. `sk-typescript.md` and `sk-clean-code.md` load once a `.ts` or `.tsx` file is read, and `sk-agent-prompts.md` once any file in `packages/agents/` is, because its `agents/**` pattern matches at any depth (sidekick#156) | sidekick's working standards, language, PM conventions and guidance authoring, plus its TypeScript, clean-code and prompt rules |
| Project rules | `.claude/rules/*.md` | every session, whether started at the root or in a package, and every subagent. `aesir-conventions.md` has no `paths:` and loads at start. `typescript.md`, `testing.md` and `postgresql.md` load once a file matching their `paths:` is read | aesir's cross-cutting conventions, and its rules for TypeScript, testing and PostgreSQL |
| Package | `packages/<pkg>/CLAUDE.md` | a session started in that directory; any session or subagent once it reads a file inside the package | what applies only to that package |
| Package skills | `packages/dashboard/.claude/skills/*` | a session started in `packages/dashboard`; any session or subagent once it reads a file inside the package | `impeccable`, `shadcn`, `vercel-react-best-practices` |
| Plugins | `enabledPlugins` in `.claude/settings.json` | every session | sidekick (its `sidekick:*` skills), superpowers and code-review. `claude plugin list` shows each version |
| Hooks | `.claude/settings.json` | each hook only on its own matcher: `guard-schema-drizzle` on `Edit\|Write\|MultiEdit`, `guard-env-commit` on `Bash`, Biome on `Edit\|Write\|MultiEdit`, `session-context` on `SessionStart` after a compaction | the schema retention guard, the `.env` staging guard, Biome on edit, and context re-injection after compaction |
| Personal | `.claude/settings.local.json` (gitignored) | this machine | personal permissions |

Each hook that runs a script names it through `"$CLAUDE_PROJECT_DIR"`, so it resolves from any working directory; the Biome hook is an inline command. A relative path fails once the Bash working directory leaves the root: the shell exits 127, and the call goes through (#89). The guard scripts need `python3` and the Biome hook needs `jq`. Each fails open, so a missing binary disables its hook rather than blocking the call.

## Why the root file is a symlink

`CLAUDE.md` at the repo root is a symlink to `AGENTS.md`, not an `@`-import line. Two facts favour the symlink:

- An `@` import is not expanded for a session started inside a package. A nested `CLAUDE.md`'s upward `@../../AGENTS.md` reaches a Task subagent's context as the literal string, never as the file it names. Measured 2026-09-16 on Claude Code 2.1.273; the probe does not re-measure it.
- A symlink is read as content. Every session and subagent in the matrix under §What each kind of session sees reports `AGENTS.md`'s heading.

The symlink fails silently. On a checkout without symlink support (Windows without developer mode, `core.symlinks=false`), or when the file is fetched raw over HTTP, `CLAUDE.md` becomes a one-line text file reading `AGENTS.md`. Every session there loses all project guidance, and no error or empty file flags it.

## What each kind of session sees

Measured 2026-09-29 on Claude Code 2.1.285 with `scripts/harness-probe.sh`. Each cell is the session's own report of its context, so read it against the two controls. The unscoped user rule `sk-language.md` loaded in every row. The path-scoped `typescript.md` stayed out until a `.tsx` file was read.

| Session | `AGENTS.md` (through `CLAUDE.md`) | `aesir-conventions.md` (no `paths:`) | `typescript.md` (path-scoped) | package `CLAUDE.md` | dashboard skills |
|---|---|---|---|---|---|
| headless, started at the root | seen | seen | not seen | none | not listed |
| headless, started in `packages/dashboard` | seen | seen | not seen | dashboard | listed |
| headless, started in `packages/agents` | seen | seen | not seen | agents | not listed |
| Task subagent dispatched from the root, before any file read | seen | seen | not seen | none | not asked |
| the same subagent, after reading a `.tsx` file in `packages/dashboard` | seen | seen | seen | dashboard only | reported available |

After that read, the subagent also reported the user rules `sk-typescript.md` and `sk-clean-code.md`, which are scoped to `.ts` and `.tsx`. A session started at the root picks up a package's `CLAUDE.md` and skills once it reads a file there. That was measured 2026-09-16 on 2.1.273, and the probe does not re-measure it. A sidekick worker is a session the operator starts, so the session rows describe it too.

## Guidance is a start-of-session snapshot

A session's guidance is fixed when it starts, and a subagent inherits that copy rather than reading the files. Measured 2026-09-29 on Claude Code 2.1.285, in a scratch repo. After the session started, it edited `CLAUDE.md`, edited a rule without `paths:`, and created a new rule. A subagent it then dispatched reported the original `CLAUDE.md`, the original rule and no new rule. The session itself reported the same.

## Consequences

- A task that sends a worker into a package names that package's `CLAUDE.md`; the pointer block in `AGENTS.md` is the backstop.
- A session that edits `AGENTS.md`, a package `CLAUDE.md` or a rule restarts before it dispatches workers or reviewers who must follow the new text.
- Rules are the expensive layer: a rule without `paths:` is in every turn of every session. Add one only when reasoning alone can't get there (`sk-guidance-authoring.md` §Admission).
- Third-party skills are never edited; scoping goes in the package `CLAUDE.md`.
- Hook configuration reloads mid-session: an edited hook command applies from the next tool call (#89, on 2.1.285).
- The Biome hook matches `Edit|Write|MultiEdit` only, so a file written through the shell is not formatted.
- A git worktree session lists the main checkout's skills, while its rules come from the worktree. Run a skill-list check in the main checkout (measured 2026-09-29 on 2.1.285).

## Re-running the experiment

Run `scripts/harness-probe.sh` from anywhere in the repo after a layout change or a Claude Code update, and compare its output with the matrix. It needs `claude` and `jq`, and it runs five headless sessions:

1. three with tools off, started at the root, in `packages/dashboard` and in `packages/agents`, each reporting its instruction files and, from its init message, its skills;
2. one at the root that dispatches a Task subagent, which reports before and after it reads a dashboard file;
3. one in a scratch repo that edits its own guidance mid-session, then dispatches a subagent.

The init message's skill list leaves out a skill marked `user-invocable: false`, such as the dashboard's `shadcn`. The script takes a subagent's reply from the Agent tool's result, so the parent session cannot summarise it.
