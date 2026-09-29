#!/bin/bash
# PreToolUse hook: refuse a `git add` that names a .env file.
#
# Blocks .env, .env.local, path/to/.env and the like; .env.example and
# .env.template stay allowed. Each segment of a chained command is checked,
# so `git status && git add .env` is caught.
#
# Fails open: anything other than a deliberate block exits 0 or with the
# interpreter's own error, so a missing python3 never wedges every Bash call.
# .gitignore already ignores .env; this guards the forced add.

input=$(cat)

printf '%s' "$input" | python3 -c '
import json, os, re, shlex, sys

try:
    command = json.load(sys.stdin).get("tool_input", {}).get("command", "") or ""
except Exception:
    sys.exit(0)

ALLOWED = {".env.example", ".env.template"}
ENV_FILE = re.compile(r"^\.env(\..+)?$")

for segment in re.split(r"&&|\|\||;|\||\n|\(|\)|`", command):
    try:
        words = shlex.split(segment)
    except ValueError:
        words = segment.split()
    git_at = next((i for i, w in enumerate(words) if os.path.basename(w) == "git"), None)
    if git_at is None or "add" not in words[git_at + 1:]:
        continue
    add_at = words.index("add", git_at + 1)
    for word in words[add_at + 1:]:
        name = os.path.basename(word)
        if ENV_FILE.match(name) and name not in ALLOWED:
            sys.stderr.write(
                "BLOCKED: Refusing to stage {} — .env files hold credentials. "
                "Commit .env.example instead.\n".format(word)
            )
            sys.exit(2)
sys.exit(0)
'
