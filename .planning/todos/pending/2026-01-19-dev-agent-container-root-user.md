---
created: 2026-01-19T12:48
title: Run dev-agent container as non-root
area: infrastructure
files:
  - docker-compose.yml:86-89
  - Dockerfile:35-38
---

## Problem

The dev-agent container currently runs as `user: root` (added to docker-compose.yml) to access the Docker socket (`/var/run/docker.sock`) for sandbox container execution.

This was a quick fix to resolve `EACCES` permission errors when the container tried to connect to the Docker socket. The Dockerfile creates a non-root `aesir` user (uid 1001, gid 1001) for security, but this user doesn't have permission to access the Docker socket.

Running containers as root is a security concern, even when isolated.

## Solution

Options to explore:

1. **Docker group GID matching** - Add the container user to a group with the same GID as the host's `docker` group. Varies by system (Linux vs macOS Docker Desktop).

2. **Docker socket proxy** - Use a lightweight proxy like `tecnativa/docker-socket-proxy` that provides filtered access to the Docker API without exposing the full socket.

3. **Docker-in-Docker (dind)** - Run a separate Docker daemon inside the container. More isolated but adds complexity.

4. **Rootless Docker** - Use Docker's rootless mode if the host supports it.

Recommended: Start with option 1 (GID matching) for simplicity, consider option 2 (socket proxy) for better security if GID matching proves fragile across environments.
