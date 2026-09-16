#!/bin/bash
# PreToolUse hook: Prevent staging .env files with git add.

input=$(cat)

command=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Check for git add targeting .env files (but not .env.example or .env.template)
if echo "$command" | grep -qE 'git\s+add.*\.env' && ! echo "$command" | grep -qE '\.env\.(example|template)'; then
  echo "BLOCKED: Refusing to stage .env — contains credentials. Commit .env.example instead." >&2
  exit 2
fi

exit 0
