---
issue: 26
kind: direction
summary: Dashboard has no authentication, no monitoring or alerting, and configuration is single-environment — the wall between validated architecture and a production platform.
---

# Ops gaps: dashboard auth, monitoring and alerting, multi-environment config

## Context
Three items have sat on `git show 39c7015c:.planning/PROJECT.md`'s "Candidates for future milestones" list unchanged since v2.2: dashboard authentication enforcement, monitoring and alerting for agent health, and multi-environment configuration (dev/staging/prod) in place of the single `.env`. The issue frames these as the wall between "validated architecture" and "production platform" — every milestone since v2.2 has shipped feature work without closing any of the three.

## Trigger to revisit
Pick this up when anyone other than the owner needs to reach a running instance.

## Reference
- Rikmorn/aesir#26 (status lives there)
- `git show 39c7015c:.planning/PROJECT.md` ("Candidates for future milestones")
