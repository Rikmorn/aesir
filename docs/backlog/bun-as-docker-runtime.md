---
issue: 18
kind: direction
summary: Run the agent service and integrations on oven/bun instead of node:22-slim — blocked on the Dockerfile's pnpm deploy step, which has no bun equivalent.
---

# Bun as the Docker runtime

## Context
The production image builds on `node:22-slim` and uses `pnpm deploy --prod` to produce a standalone package with resolved dependencies (`Dockerfile`). Moving the runtime to `oven/bun` needs a different build shape: `pnpm deploy` has no bun equivalent, so the deploy step — not the base-image swap — is the actual blocker.

## Trigger to revisit
Pick this up once the retarget session decides the deployment shape; not before.

## Reference
- Rikmorn/aesir#18 (status lives there)
- `Dockerfile`
