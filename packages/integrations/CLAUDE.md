# packages/integrations

Three independent services, one per business tool: `linear/` (port 3001, schema `linear.*`), `github/` (3002, `github.*`), `slack/` (3003, `slack.*`). Each has `api/`, `client/`, `db/`, `mcp/`, `oauth/`, `webhooks/` and its own README, which is the implementation guide for that service. Project-wide rules are in the root `AGENTS.md`.

- Integrations use their own SDK clients (`@linear/sdk`, `@octokit/rest`, `@slack/bolt`); agents never import them. Agents reach these services over MCP (`POST /mcp/tools/:name`, headers `X-Agent-ID`, `X-Correlation-ID`, `X-Task-ID`).
- Integrations import from `@aesir/platform` only, never from `@aesir/agents`.
- OAuth tokens are stored encrypted in each service's `*.credentials` table; `CREDENTIAL_ENCRYPTION_KEY` must be set.
- Webhooks are normalised into `NormalizedEvent` and posted to the agent service's `POST /events` unfiltered; echo suppression happens in the router, via `actorInfo.isBot`, which the agent-service adapters set.
- Changing a service's MCP tool list or setup means updating its README in the same change.
