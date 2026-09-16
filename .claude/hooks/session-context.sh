#!/bin/bash
# SessionStart hook: Reinject working context after compaction.

branch=$(git branch --show-current 2>/dev/null || echo "unknown")
recent=$(git log --oneline -5 2>/dev/null || echo "  (no commits)")
dirty=$(git status --short 2>/dev/null | head -10)

echo "Session context (post-compaction):"
echo "  Branch: $branch"
echo "  Recent commits:"
echo "$recent" | sed 's/^/    /'

if [[ -n "$dirty" ]]; then
  echo "  Uncommitted changes:"
  echo "$dirty" | sed 's/^/    /'
fi

# Check docker if available
if command -v docker &>/dev/null; then
  running=$(docker compose ps --format "{{.Name}}: {{.Status}}" 2>/dev/null | head -8)
  if [[ -n "$running" ]]; then
    echo "  Docker services:"
    echo "$running" | sed 's/^/    /'
  else
    echo "  Docker: no services running"
  fi
fi
