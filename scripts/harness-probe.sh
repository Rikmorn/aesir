#!/bin/bash
# Probe which guidance layers each kind of Claude Code session sees in this repo.
# Usage: scripts/harness-probe.sh   (from anywhere inside the repo; needs `claude` and `jq`)
#
# Prints raw answers; docs/reference/dev-harness.md holds the matrix read from them. Each
# answer is the model reporting its own context, so read it against the controls:
# ~/.claude/rules/sk-language.md is an unscoped user rule and always loads, and
# .claude/rules/typescript.md is path-scoped and loads only after a .ts or .tsx read.
set -u
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
claude --version

FILES='~/.claude/rules/sk-language.md, .claude/rules/aesir-conventions.md, .claude/rules/typescript.md, AGENTS.md (the root CLAUDE.md), packages/dashboard/CLAUDE.md, packages/agents/CLAUDE.md, packages/integrations/CLAUDE.md'
ASK="For each file below, print one line \"<file>: <its first line starting with # >\" if its contents are in your context now, or \"<file>: NOT LOADED\" if not. Answer from your loaded instructions only, and print only those lines. Files: $FILES"

# The init message lists the session's skills, except those marked `user-invocable: false`
# (the dashboard's shadcn is one). A subagent's reply is taken from the Agent tool's result,
# so the parent session cannot summarise it.
SKILLS='select(.type=="system" and .subtype=="init") | "skills: dashboard=\([.skills[]|select(.=="impeccable" or .=="shadcn" or .=="vercel-react-best-practices")]|join(",")) sidekick=\([.skills[]|select(startswith("sidekick:"))]|length)"'
AGENT_REPLY='select(.type=="user") | .message.content[]? | select(.type=="tool_result") | .content | if type=="array" then map(.text? // empty) | join("\n") else . end'
RESULT='select(.type=="result") | .result'

# 1. A session started at the root and in two packages, tools off.
for dir in . packages/dashboard packages/agents; do
  echo; echo "== headless session, cwd = $dir"
  (cd "$dir" && claude -p "Do not use any tools. $ASK" --output-format stream-json --verbose \
      --max-turns 1 --tools "" --no-session-persistence < /dev/null 2>/dev/null) \
    | jq -r "($SKILLS), ($RESULT)"
done

# 2. A Task subagent dispatched from the root: before, then after it reads a dashboard file.
echo; echo "== Task subagent from the root (its own reply)"
claude -p "Use the Agent tool exactly once, with subagent_type general-purpose and this prompt, then reply done. Prompt: 'Step A. Without using any tool, under the heading Before reading: $ASK Step B. Use the Read tool to read the first 5 lines of packages/dashboard/src/app/layout.tsx. Step C. Without using any tool, under the heading After reading, answer the Step A question again. Your final reply must contain both lists.'" \
  --output-format stream-json --verbose --allowedTools "Agent Read" --max-turns 4 \
  --no-session-persistence < /dev/null 2>/dev/null | jq -r "$AGENT_REPLY"

# 3. Mid-session edits: does a session, or a subagent it dispatches afterwards, see guidance
# that changed after the session started? Runs in a scratch repo, so this checkout is never
# edited. The edit is a pre-written script, because Claude Code asks before a command writes
# CLAUDE.md or .claude/ directly, and a headless session cannot answer.
S=$(mktemp -d); trap 'rm -rf "$S"' EXIT
( cd "$S" && git init -q && mkdir -p .claude/rules \
  && printf '# Probe project v1\n' > CLAUDE.md && printf '# Alpha rule v1\n' > .claude/rules/alpha.md \
  && printf '%s\n' "printf '# Probe project v2\n' > CLAUDE.md" "printf '# Alpha rule v2\n' > .claude/rules/alpha.md" \
       "printf '# Beta rule v1\n' > .claude/rules/beta.md" 'echo mutated' > mutate.sh )
Q3='print the first line starting with # of CLAUDE.md, .claude/rules/alpha.md and .claude/rules/beta.md as each appears in your context, or NOT LOADED. Answer from your loaded instructions only.'
echo; echo "== mid-session edits (scratch repo)"
(cd "$S" && claude -p "Do these steps one at a time, never two tool calls at once. 1. Without using any tool, under the heading Parent before: $Q3 2. Run the Bash command: bash mutate.sh and wait until it prints mutated. 3. Only then, use the Agent tool exactly once, with subagent_type general-purpose and this prompt: 'Without using any tool, $Q3' 4. Without using any tool, under the heading Parent after: $Q3" \
  --output-format stream-json --verbose --allowedTools "Bash(bash mutate.sh) Agent" --max-turns 6 \
  --no-session-persistence < /dev/null 2>/dev/null) \
  | jq -r 'select(.type=="assistant" or .type=="user") | .message.content[]?
           | if .type=="text" then .text
             elif .type=="tool_result" then "[tool result] " + (.content | if type=="array" then map(.text? // empty) | join("\n") else . end)
             else empty end'
echo "files on disk after the run: $(head -1 "$S/CLAUDE.md") / $(head -1 "$S/.claude/rules/alpha.md") / $(head -1 "$S/.claude/rules/beta.md" 2>/dev/null || echo 'no beta.md')"
