---
phase: e2e-verification
plan: FIX
subsystem: infrastructure
tags: [oauth, docker, cloudflare, containerization]
dependency-graph:
  requires: [9.3-01, 9.2-02]
  provides: [containerized-oauth, docker-socket-mount, oauth-token-preference]
  affects: []
tech-stack:
  added: []
  patterns: [docker-profile, env-var-config, token-preference]
key-files:
  created: []
  modified:
    - src/scripts/linear-oauth.ts
    - docker-compose.yml
    - .env.example
    - README.md
    - src/scripts/start-dev-agent.ts
decisions:
  - id: oauth-callback-url-env-var
    choice: OAUTH_CALLBACK_URL environment variable
    rationale: Allows configurable tunnel URLs for containerized OAuth
  - id: oauth-docker-profile
    choice: oauth profile in docker-compose.yml
    rationale: Service runs on-demand, not with regular docker compose up
  - id: oauth-token-preference
    choice: Try OAuth tokens first, fall back to LINEAR_ACCESS_TOKEN
    rationale: OAuth shows app identity; env var shows user identity
metrics:
  duration: 12 min
  completed: 2026-01-19
---

# Phase e2e-verification Plan FIX: E2E Gap Closure Summary

**One-liner:** Containerized OAuth flow with configurable callback URLs via Cloudflare tunnel and OAuth token preference in dev-agent.

## What Was Built

1. **Configurable OAuth Callback URL** (src/scripts/linear-oauth.ts)
   - Read OAUTH_CALLBACK_URL from environment instead of hardcoded localhost
   - Validate OAUTH_CALLBACK_URL in validateEnv()
   - Bind server to 0.0.0.0 for container accessibility
   - Add non-null assertions for TypeScript compliance

2. **OAuth Docker Service** (docker-compose.yml)
   - New oauth service with LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, OAUTH_CALLBACK_URL
   - Uses `oauth` profile so only runs on demand
   - Mounts .linear-tokens.json to host for persistence
   - Added Docker socket mount for dev-agent sandbox execution
   - Increased Temporal health check start_period to 60s
   - Mount tokens file read-only for dev-agent

3. **Environment Documentation** (.env.example)
   - Removed all "not documented" comments
   - Added OAUTH_CALLBACK_URL with tunnel URL example
   - Consolidated Linear section (no duplicates)
   - Proper documentation for all OAuth variables

4. **README OAuth Documentation** (README.md)
   - Rewrote OAuth setup for containerized flow
   - Document OAuth tunnel setup (separate from webhooks)
   - Added OAUTH_CALLBACK_URL environment variable requirement
   - Removed all localhost references for OAuth callbacks
   - Added Docker socket requirement documentation
   - Added sandbox image (node:20-alpine) documentation
   - Added note about multiple tunnels (webhooks + OAuth)

5. **OAuth Token Preference** (src/scripts/start-dev-agent.ts)
   - Import createLinearClientFromFile and TokenFileNotFoundError
   - Try OAuth tokens first (app identity)
   - Fall back to LINEAR_ACCESS_TOKEN with warning (user identity)
   - Log which identity mode is active

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 9a6ebc0 | feat(e2e-fix): make OAuth callback URL configurable |
| 38b880f | feat(e2e-fix): add OAuth service to Docker Compose |
| 5daaa9d | docs(e2e-fix): clean up .env.example documentation |
| a66c38a | docs(e2e-fix): update README with OAuth tunnel setup |
| 2d64726 | docs(e2e-fix): add Dev Agent Docker prerequisites |
| eae9f7c | feat(e2e-fix): implement OAuth token preference in start-dev-agent |
| a1a2f77 | feat(e2e-fix): mount tokens file for dev-agent container |

## Success Criteria Verification

| Criteria | Status |
|----------|--------|
| linear-oauth.ts reads OAUTH_CALLBACK_URL from environment | PASS |
| linear-oauth.ts binds to 0.0.0.0 for container accessibility | PASS |
| docker-compose.yml has oauth service with OAUTH_CALLBACK_URL | PASS |
| docker-compose.yml has Docker socket mounted for dev-agent | PASS |
| docker-compose.yml has tokens file mounted for both oauth and dev-agent | PASS |
| docker-compose.yml has 60s start_period for Temporal health check | PASS |
| .env.example documents OAUTH_CALLBACK_URL with tunnel URL example | PASS |
| .env.example has no "not documented" comments or duplicate variables | PASS |
| README documents OAuth tunnel setup (separate from webhooks) | PASS |
| README has no localhost references for OAuth callbacks | PASS |
| README documents Docker socket requirement for dev-agent | PASS |
| start-dev-agent.ts prefers OAuth tokens, falls back to LINEAR_ACCESS_TOKEN | PASS |
| TypeScript compilation succeeds | PASS |

## Next Steps

The E2E verification gaps are now closed. To use the containerized OAuth flow:

1. Create Cloudflare tunnel routing to `oauth:3000`
2. Set `OAUTH_CALLBACK_URL` in .env.local
3. Run `docker compose --profile oauth run --rm oauth`
4. Tokens saved to .linear-tokens.json
5. Dev agent will prefer OAuth tokens (app identity)
