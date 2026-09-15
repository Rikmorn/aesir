# Backlog notes

One note per deferred direction or known debt item that has content worth keeping beyond its issue. The issue is the status; the note is the context, the trigger to revisit, and the references into `docs/history/` and `docs/research/`. When the issue closes, delete the note (git remembers). Hand-maintained; keep it in sync with `ls`.

## Known debt (`kind: tech-debt`)

- [event-routed-sequence-collision](event-routed-sequence-collision.md) — #10 · event.routed is appended at sequence 0, so a conversation's second routing event collides on (conversation, sequence) and is silently dropped.
- [work-tools-absent-from-agent-yaml](work-tools-absent-from-agent-yaml.md) — #11 · work:register and work:query are registered in the tool registry but no production agent YAML lists them, so no agent can call them directly.
- [dev-agent-container-runs-as-root](dev-agent-container-runs-as-root.md) — #12 · docker-compose.yml sets user root on the agent container to reach the Docker socket, bypassing the Dockerfile's non-root aesir user.
- [tests-skipped-pending-infrastructure](tests-skipped-pending-infrastructure.md) — #13 · 11 tests are marked skipped because they need services the fast suite doesn't provide; each needs triage into the integration suite or deletion.
- [human-verification-items](human-verification-items.md) — #14 · 59 human-verification items across the ten shipped milestones plus v2.9's executed-but-unarchived phases have not been checked off.
- [dispatcher-fallback-router-urls](dispatcher-fallback-router-urls.md) — #15 · 22 occurrences of the pre-v2.3 router:3006 fallback URL remain as dead defaults after the router folded into the single agent service.
- [dashboard-dead-code](dashboard-dead-code.md) — #16 · knip flags 3 unused dashboard files, 41 unused exports and 13 unused types, mostly in services/tools.ts, services/overview.ts and the task-graph components.

## Deferred directions (`kind: direction`)

- [bun-as-test-runner](bun-as-test-runner.md) — #17 · Replace vitest with bun test — a migration, not a switch, since 49 of 73 test files use vi.mock, vi.fn or vi.spyOn, plus msw and testcontainers.
- [bun-as-docker-runtime](bun-as-docker-runtime.md) — #18 · Run the agent service and integrations on oven/bun instead of node:22-slim — blocked on the Dockerfile's pnpm deploy step, which has no bun equivalent.
- [sub-agent-discovery](sub-agent-discovery.md) — #19 · Replace hardcoded spawn_agent agent-type references with capability-based sub-agent discovery — deferred because the orchestrator/sub-agent split itself is an open question.
- [domain-modeling](domain-modeling.md) — #20 · Turn dev-agent, product-agent and qa-agent from generic task processors into modelled professionals — the v3.0 vision.
- [human-collaboration](human-collaboration.md) — #21 · Formal agent-to-human delegation — humans as directory entries, materialized delegation, an async handshake with reminders and escalation, and mid-work signal handling.
- [strategy-composition](strategy-composition.md) — #22 · Make platform behaviours (retrieval, compaction, delegation) pluggable per agent definition, the way agents themselves already are — enabling work for a second domain.
- [retrieval-strategies](retrieval-strategies.md) — #23 · BM25-specific ranking, temporal decay and MMR diversity remain deferred — v2.9 already shipped both vector and keyword (tsvector/tsquery) retrieval, fused via Reciprocal Rank Fusion.
- [unified-external-identity](unified-external-identity.md) — #24 · Open product question — should Aesir present as one external identity across Linear, Slack and GitHub instead of exposing dev-agent, product-agent and qa-agent separately?
- [cross-session-learning](cross-session-learning.md) — #25 · Agents improving across conversations, not just within one — persistent identity documents and the pre-compaction knowledge flush are the substrate; nothing consumes them across sessions yet.
- [ops-gaps](ops-gaps.md) — #26 · Dashboard has no authentication, no monitoring or alerting, and configuration is single-environment — the wall between validated architecture and a production platform.
- [slack-mrkdwn-translation](slack-mrkdwn-translation.md) — #27 · Agent replies are Markdown but Slack renders mrkdwn, degrading lists, code fences and links — deferred translation work for the outbound denormalizer.
