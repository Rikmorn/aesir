#!/bin/bash
# PreToolUse hook: Prevent removing table definitions from schema.drizzle.ts
# Old definitions must be retained to prevent destructive DROP TABLE migrations.

input=$(cat)

file_path=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

# Only check schema.drizzle.ts files
if [[ "$file_path" != *"schema.drizzle.ts"* ]]; then
  exit 0
fi

old_string=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('old_string',''))" 2>/dev/null)
new_string=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('new_string',''))" 2>/dev/null)

# Count pgTable definitions in old vs new
old_tables=$(echo "$old_string" | grep -c 'pgTable(' || true)
new_tables=$(echo "$new_string" | grep -c 'pgTable(' || true)

if [[ "$old_tables" -gt 0 && "$new_tables" -lt "$old_tables" ]]; then
  echo "BLOCKED: This edit removes table definitions from schema.drizzle.ts. Old definitions must be retained — removing them generates DROP TABLE migrations. See CLAUDE.md > Gotchas > schema.drizzle.ts Retention Rule." >&2
  exit 2
fi

exit 0
