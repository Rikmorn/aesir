#!/bin/bash
# PreToolUse hook: Prevent removing table definitions from schema.drizzle.ts
# Old definitions must be retained to prevent destructive DROP TABLE migrations.
#
# Covers Edit, Write and MultiEdit. Write carries only the new content, so the
# before-count comes from the file on disk. Shell writes (sed, heredocs) still
# bypass this; covering them means grepping every Bash command for the filename.
#
# Fails open: any error other than a deliberate block exits 0, so a missing
# python3 turns the hook into a no-op rather than wedging every edit.

input=$(cat)

output=$(printf '%s' "$input" | python3 -c '
import json, sys, os, re

# Counts both Drizzle spellings. This repo declares tables as
# pgSchema("agents").table(...), so .table( is the one that actually fires here;
# pgTable( is the standalone API and stays covered for future code.
PATTERN = re.compile(r"pgTable\(|\.table\(")

def count(text):
    return len(PATTERN.findall(text or ""))

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = payload.get("tool_name", "")
tool_input = payload.get("tool_input", {}) or {}
file_path = tool_input.get("file_path", "") or ""

if "schema.drizzle.ts" not in file_path:
    sys.exit(0)

if tool == "Edit":
    before = count(tool_input.get("old_string"))
    after = count(tool_input.get("new_string"))
elif tool == "MultiEdit":
    edits = tool_input.get("edits", []) or []
    before = sum(count(e.get("old_string")) for e in edits)
    after = sum(count(e.get("new_string")) for e in edits)
elif tool == "Write":
    # A new file removes nothing.
    if not os.path.exists(file_path):
        sys.exit(0)
    try:
        with open(file_path, encoding="utf-8") as handle:
            before = count(handle.read())
    except OSError:
        sys.exit(0)
    after = count(tool_input.get("content"))
else:
    sys.exit(0)

if before > 0 and after < before:
    sys.stderr.write(
        "BLOCKED: this {} removes {} of {} table definitions from {}. "
        "Old definitions must be retained -- removing them generates DROP TABLE "
        "migrations. See AGENTS.md > Common Commands > Database schemas.\n".format(
            tool, before - after, before, os.path.basename(file_path)
        )
    )
    sys.exit(2)

sys.exit(0)
' 2>&1)
status=$?

# Only a deliberate block (exit 2) stops the tool call.
if [[ "$status" -eq 2 ]]; then
  printf '%s\n' "$output" >&2
  exit 2
fi

exit 0
