# ADR-0004: Agents reach integrations over MCP, never by importing SDKs

**Status:** accepted (v2.0 / v2.2, 2026-01-25 / 2026-01-31)
**Supersedes / superseded by:** —

## Context

v2.0 established a 3-layer architecture — Platform → Integrations → Agents with clear boundaries — and needed agent code to reach Linear, GitHub, and Slack over HTTP-based tool calls rather than by coupling to any one integration's client SDK. As task delegation (v2.5) and resilience work (v2.8) followed, the framework needed integrations to correlate their own outbound and inbound calls, and needed MCP failures classified in a way agents could reason about rather than an opaque retry failure.

## Decision

Agents call integrations exclusively through MCP HTTP calls — `callMcpTool()` against each integration's `/mcp/tools/:name` endpoint (Linear on :3001, GitHub on :3002, Slack on :3003) — and never import an integration SDK directly. This is enforced by a 3-layer architecture: Platform → Integrations → Agents, where agents depend on integrations only through HTTP/MCP. Each integration owns its own correlation, because it is the one component that sees both sides of a call: outbound MCP calls carry an `X-Task-ID` header that the integration records, and inbound webhooks look that header up non-fatally, rather than the router attempting to match calls after the fact. MCP calls run through a custom retry loop that classifies HTTP errors as permanent or transient, rather than a general-purpose retry library.

## Consequences

- Agents need no integration tokens (`LINEAR_ACCESS_TOKEN`, `GITHUB_TOKEN`, and so on) — only `ANTHROPIC_API_KEY` and workspace IDs.
- Swapping or adding an integration doesn't touch agent code, since agents see only the MCP HTTP contract, never an SDK.
- Bidirectional task correlation works across all three integrations, because the integration layer — not the router — processes both sides of the artifact lifecycle.
- Agents get structured, HTTP-status-aware error context instead of an opaque failure, because the generic retry library (`fetch-retry-ts`) couldn't classify permanent versus transient errors.
- Committed the project to maintaining a custom retry loop and an `X-Task-ID` correlation convention as framework code, rather than depending on a general-purpose HTTP client for that behaviour.

## Sources

- `git show 39c7015c:.planning/PROJECT.md`, `## Key Decisions`: rows "MCP for agent-integration", "3-layer architecture", "X-Task-ID header for MCP correlation", "Custom MCP retry loop over fetch-retry-ts".
- `docs/history/specs/design-vision.md`, `## Design Decisions Log`: row "Integration layer owns correlation, not router".
- `AGENTS.md`, `### Agent MCP Communication` — current MCP client location, endpoints, and agent configuration.
