---
issue: 12
kind: tech-debt
summary: docker-compose.yml sets user root on the agent container to reach the Docker socket, bypassing the Dockerfile's non-root aesir user.
---

# dev-agent container runs as root to reach the Docker socket

## Context
`docker-compose.yml` sets `user: root` on the agent container so it can open `/var/run/docker.sock` for sandbox container execution, bypassing the Dockerfile's non-root `aesir` user (uid 1001, gid 1001). It was a quick fix for `EACCES` errors when the container tried to reach the socket, recorded 2026-01-19 in a pending todo. Four options were logged at the time: match the host Docker group GID; a socket proxy (`tecnativa/docker-socket-proxy`); Docker-in-Docker; or rootless Docker — with GID matching recommended as the simpler start and the proxy as fallback if GID matching proves fragile across environments.

## Trigger to revisit
Pick this up before deploying anywhere the container boundary needs to hold against a compromised sandbox execution, not just on a trusted single-operator host.

## Reference
- Rikmorn/aesir#12 (status lives there)
- `git show 39c7015c:.planning/todos/pending/2026-01-19-dev-agent-container-root-user.md`
