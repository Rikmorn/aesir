---
phase: e2e-verification
plan: FIX
type: execute
wave: 1
depends_on: []
files_modified:
  - README.md
  - .env.example
  - docker-compose.yml
autonomous: true
gap_closure: true

must_haves:
  truths:
    - "Linear OAuth flow completes with correct redirect URI"
    - "Dev Agent starts and connects to Temporal"
    - "Linear tasks show app identity (not user)"
    - "All Docker containers show healthy status"
  artifacts:
    - path: "README.md"
      provides: "Correct OAuth redirect URI documentation"
      contains: "http://localhost:3000/oauth/callback"
    - path: ".env.example"
      provides: "Complete environment variable documentation"
      contains: "LINEAR_CLIENT_ID"
    - path: "docker-compose.yml"
      provides: "Docker socket mount for dev-agent"
      contains: "/var/run/docker.sock"
  key_links:
    - from: "README.md"
      to: "src/scripts/linear-oauth.ts"
      via: "documented redirect URI matches code"
      pattern: "localhost:3000/oauth/callback"
---

<objective>
Fix 4 UAT gaps discovered during E2E verification to enable full milestone validation.

Purpose: Unblock E2E testing by fixing documentation mismatches, missing Docker socket mount, and health check timing.
Output: Corrected README.md, .env.example, and docker-compose.yml enabling complete E2E flow.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/e2e-verification/e2e-UAT.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix Linear OAuth documentation (Gap 2 - blocker)</name>
  <files>README.md, .env.example</files>
  <action>
Fix redirect URI mismatch between code and documentation.

In README.md, update the Linear OAuth Setup section:
1. Line ~222: Change redirect URI from `http://localhost:3333/callback` to `http://localhost:3000/oauth/callback`
2. Update the OAuth application setup instructions to use the correct URI

In .env.example, clean up OAuth documentation:
1. Remove "# not documented" comments from LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, LINEAR_WEBHOOK_SECRET, SLACK_CHANNEL_ID
2. Add proper documentation for each:
   - LINEAR_CLIENT_ID: "OAuth application client ID from linear.app/settings/api/applications"
   - LINEAR_CLIENT_SECRET: "OAuth application client secret"
   - LINEAR_WEBHOOK_SECRET: "Signing secret from Linear webhook configuration"
   - SLACK_CHANNEL_ID: "Channel ID for approval notifications (format: C0123456789)"
3. Remove duplicate LINEAR_WEBHOOK_SECRET entry (appears twice at lines 42 and 69)
4. Remove the commented out duplicate OAuth vars at lines 45-46
5. Update the comment on line 29 from "(should use client and secret id)" to proper description

The script uses port 3000, not 3333. The callback path is /oauth/callback, not /callback.
  </action>
  <verify>
Grep README.md for "localhost:3000/oauth/callback" - should find the correct URI.
Grep README.md for "localhost:3333" - should find NO matches.
Grep .env.example for "not documented" - should find NO matches.
Grep .env.example for "LINEAR_WEBHOOK_SECRET" - should find exactly ONE entry.
  </verify>
  <done>
README documents correct redirect URI (localhost:3000/oauth/callback).
.env.example has clean, non-duplicate documentation for all OAuth and webhook variables.
  </done>
</task>

<task type="auto">
  <name>Task 2: Fix Dev Agent Docker configuration (Gap 3 - blocker)</name>
  <files>docker-compose.yml, README.md</files>
  <action>
Fix Dev Agent container startup issues.

In docker-compose.yml, update the dev-agent service (around line 82-118):
1. Add Docker socket volume mount to enable sandbox container creation:
   ```yaml
   volumes:
     - /var/run/docker.sock:/var/run/docker.sock
   ```
   This goes after the `ports:` section and before `command:`.

In README.md, add prerequisite documentation:
1. In the "Prerequisites" section (line ~12-18), add:
   - "Docker Desktop running with daemon socket exposed (default on macOS/Windows)"
2. In the "Running the Dev Agent" prerequisites section (line ~344-351), add note:
   - "Docker socket must be accessible for sandbox execution"
3. Add note about pulling required images if running locally:
   ```
   # If running dev-agent locally (not via Docker Compose):
   docker pull node:20-alpine
   ```

Note: When running via Docker Compose, the node:20-alpine image is pulled inside the container which has socket access. When running locally with `npm run dev-agent`, the image must exist locally.
  </action>
  <verify>
Grep docker-compose.yml for "/var/run/docker.sock" - should find the volume mount.
Read docker-compose.yml dev-agent section to confirm volumes key exists.
Grep README.md for "node:20-alpine" - should find prerequisite documentation.
  </verify>
  <done>
docker-compose.yml has Docker socket mounted for dev-agent service.
README documents Docker socket requirement and image pull prerequisite for local runs.
  </done>
</task>

<task type="auto">
  <name>Task 3: Fix Temporal health check timing (Gap 1 - minor)</name>
  <files>docker-compose.yml</files>
  <action>
Fix Temporal container health check that reports unhealthy during startup.

In docker-compose.yml, update the temporal service healthcheck (lines 61-66):
1. Increase start_period from 30s to 60s to allow more initialization time
2. The health check itself (`tctl cluster health`) is correct, just needs more startup time

Change from:
```yaml
healthcheck:
  test: ["CMD", "tctl", "--address", "127.0.0.1:7233", "cluster", "health"]
  interval: 10s
  timeout: 5s
  retries: 10
  start_period: 30s
```

To:
```yaml
healthcheck:
  test: ["CMD", "tctl", "--address", "127.0.0.1:7233", "cluster", "health"]
  interval: 10s
  timeout: 5s
  retries: 10
  start_period: 60s
```

This is a known Temporal Docker issue - the server binds to the network interface before the cluster is fully ready, causing early health checks to fail.
  </action>
  <verify>
Grep docker-compose.yml for "start_period: 60s" - should find the updated value.
Read docker-compose.yml temporal service section to confirm healthcheck configuration.
  </verify>
  <done>
Temporal health check start_period increased to 60s, allowing sufficient initialization time.
  </done>
</task>

</tasks>

<verification>
After completing all tasks:

1. Verify README OAuth documentation:
   - `grep -n "localhost:3000/oauth/callback" README.md` returns match
   - `grep -n "localhost:3333" README.md` returns no matches

2. Verify .env.example cleanup:
   - `grep -c "not documented" .env.example` returns 0
   - `grep -c "LINEAR_WEBHOOK_SECRET" .env.example` returns 1

3. Verify Docker Compose changes:
   - `grep -A2 "volumes:" docker-compose.yml | grep docker.sock` returns match
   - `grep "start_period: 60s" docker-compose.yml` returns match

4. Gap 4 (Linear identity) verification:
   - This gap is downstream of Gap 2 (OAuth)
   - With correct redirect URI documented, user can reconfigure Linear OAuth app
   - After re-running `npm run linear-oauth`, OAuth tokens will be saved
   - Linear tasks will then show app identity instead of user identity
   - No code change required - this is auto-resolved by fixing Gap 2
</verification>

<success_criteria>
1. README documents correct OAuth redirect URI (http://localhost:3000/oauth/callback)
2. .env.example has clean documentation for all OAuth/webhook variables (no "not documented" comments)
3. docker-compose.yml has Docker socket mounted for dev-agent
4. docker-compose.yml has 60s start_period for Temporal health check
5. README documents Docker socket and image pull prerequisites
</success_criteria>

<output>
After completion, create `.planning/phases/e2e-verification/e2e-FIX-SUMMARY.md`
</output>
