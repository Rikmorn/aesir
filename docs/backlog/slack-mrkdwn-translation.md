---
issue: 27
kind: direction
summary: Agent replies are Markdown but Slack renders mrkdwn, degrading lists, code fences and links — deferred translation work for the outbound denormalizer.
---

# Markdown to Slack mrkdwn translation

## Context
Agents compose replies in Markdown, but Slack renders mrkdwn — a different, narrower syntax — so lists, code fences and links degrade when delivered there. `docs/history/requirements.md` records this as `FMT-01` under v2.6's deferred "Format Translation" requirements, alongside `FMT-02` (per-channel semantic formatting). The outbound denormalizer, shipped in v2.6's Phase 63, is the single place a translation step would go: it's already the seam that turns domain-language communication actions into channel-specific MCP calls.

## Trigger to revisit
Pick this up when Slack is confirmed as a primary channel after the retarget.

## Reference
- Rikmorn/aesir#27 (status lives there)
- `docs/history/requirements.md` ("Format Translation")
