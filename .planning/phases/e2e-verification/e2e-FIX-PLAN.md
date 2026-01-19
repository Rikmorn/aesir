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
  - src/scripts/start-dev-agent.ts
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
    - path: "src/scripts/start-dev-agent.ts"
      provides: "OAuth token preference logic"
      contains: "createLinearClientFromFile"
  key_links:
    - from: "README.md"
      to: "src/scripts/linear-oauth.ts"
      via: "documented redirect URI matches code"
      pattern: "localhost:3000/oauth/callback"
    - from: "src/scripts/start-dev-agent.ts"
      to: ".linear-tokens.json"
      via: "OAuth token preference check"
      pattern: "createLinearClientFromFile"
---

<objective>
Fix 4 UAT gaps discovered during E2E verification to enable full milestone validation.

Purpose: Unblock E2E testing by fixing documentation mismatches, missing Docker socket mount, health check timing, and OAuth token usage.
Output: Corrected README.md, .env.example, docker-compose.yml, and start-dev-agent.ts enabling complete E2E flow with app identity.
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
1. Search for "localhost:3333" and replace with "localhost:3000"
2. Search for "/callback" (without /oauth prefix) and replace with "/oauth/callback"
3. The correct redirect URI is: http://localhost:3000/oauth/callback

In .env.example, clean up OAuth documentation using pattern-based fixes:
1. Search for "# not documented" comments and remove them (grep shows lines 22, 37, 38, 39, 40, 42)
2. Add proper documentation comments above each variable:
   - LINEAR_CLIENT_ID: "# OAuth application client ID from linear.app/settings/api/applications"
   - LINEAR_CLIENT_SECRET: "# OAuth application client secret"
   - LINEAR_WEBHOOK_SECRET: "# Signing secret from Linear webhook configuration"
   - SLACK_CHANNEL_ID (first occurrence around line 23): "# Channel ID for approval notifications (format: C0123456789)"
3. Remove duplicate LINEAR_WEBHOOK_SECRET entry (appears at line 42 and line 69 - keep the one in the Linear Webhooks section around line 69)
4. Remove duplicate SLACK_CHANNEL_ID entry (appears at line 23 and line 72 - keep the one in the Linear Webhooks section around line 72)
5. Remove the commented out duplicate OAuth vars: "# LINEAR_CLIENT_ID=your-client-id" and "# LINEAR_CLIENT_SECRET=your-client-secret" (lines 45-46)
6. Update comment on LINEAR_ACCESS_TOKEN from "(should use client and secret id)" to proper description

The script uses port 3000, not 3333. The callback path is /oauth/callback, not /callback.
  </action>
  <verify>
Grep README.md for "localhost:3000/oauth/callback" - should find the correct URI.
Grep README.md for "localhost:3333" - should find NO matches.
Grep .env.example for "not documented" - should find NO matches.
Grep .env.example for "LINEAR_WEBHOOK_SECRET" - should find exactly ONE entry.
Grep .env.example for "SLACK_CHANNEL_ID" - should find exactly ONE entry.
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
1. In the "Prerequisites" section (search for "## Prerequisites"), add:
   - "Docker Desktop running with daemon socket exposed (default on macOS/Windows)"
2. In the "Running the Dev Agent" prerequisites section, add note:
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

In docker-compose.yml, update the temporal service healthcheck:
1. Search for "start_period: 30s" in the temporal service section
2. Change from 30s to 60s to allow more initialization time

Change from:
```yaml
start_period: 30s
```

To:
```yaml
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

<task type="auto">
  <name>Task 4: Implement OAuth token preference in start-dev-agent.ts (Gap 4 - blocker)</name>
  <files>src/scripts/start-dev-agent.ts</files>
  <action>
Implement OAuth token fallback logic so that OAuth tokens from `.linear-tokens.json` are preferred over the `LINEAR_ACCESS_TOKEN` environment variable.

Current code at line 100:
```typescript
const linearClient = getLinearClient(process.env["LINEAR_ACCESS_TOKEN"]!);
```

This ALWAYS uses LINEAR_ACCESS_TOKEN even if OAuth tokens exist. Linear shows user identity (not app identity) when using personal API keys.

Replace with OAuth-first logic:

1. Add import at the top of bootstrap() (after other imports around line 48):
   ```typescript
   const { createLinearClientFromFile, TokenFileNotFoundError } = await import(
     "../integrations/linear/token-store.js"
   );
   ```

2. Replace the linearClient initialization (around line 100) with:
   ```typescript
   // Prefer OAuth tokens from file (shows app identity in Linear)
   // Fall back to LINEAR_ACCESS_TOKEN env var (shows user identity)
   let linearClient;
   try {
     linearClient = await createLinearClientFromFile();
     logger.info("linear_client_init", {
       message: "Using OAuth tokens from .linear-tokens.json (app identity)"
     });
   } catch (err) {
     if (err instanceof TokenFileNotFoundError) {
       logger.warn("linear_client_fallback", {
         message: "OAuth tokens not found, falling back to LINEAR_ACCESS_TOKEN (user identity). Run 'npm run linear-oauth' for app identity."
       });
       linearClient = getLinearClient(process.env["LINEAR_ACCESS_TOKEN"]!);
     } else {
       throw err;
     }
   }
   ```

This ensures:
- OAuth tokens are used when available (app identity in Linear)
- Falls back gracefully to env var with warning (user identity)
- Clear logging about which identity mode is active
  </action>
  <verify>
Grep src/scripts/start-dev-agent.ts for "createLinearClientFromFile" - should find the import and usage.
Grep src/scripts/start-dev-agent.ts for "TokenFileNotFoundError" - should find the import and catch clause.
Grep src/scripts/start-dev-agent.ts for "OAuth tokens" - should find the log messages.
TypeScript compiles: `npx tsc --noEmit src/scripts/start-dev-agent.ts`
  </verify>
  <done>
start-dev-agent.ts checks for OAuth tokens first, falls back to LINEAR_ACCESS_TOKEN with warning.
Linear tasks created by Dev Agent show app identity when OAuth tokens exist.
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
   - `grep -c "SLACK_CHANNEL_ID" .env.example` returns 1

3. Verify Docker Compose changes:
   - `grep -A2 "volumes:" docker-compose.yml | grep docker.sock` returns match
   - `grep "start_period: 60s" docker-compose.yml` returns match

4. Verify OAuth token preference (Gap 4):
   - `grep "createLinearClientFromFile" src/scripts/start-dev-agent.ts` returns match
   - `grep "TokenFileNotFoundError" src/scripts/start-dev-agent.ts` returns match
   - TypeScript compiles without errors
</verification>

<success_criteria>
1. README documents correct OAuth redirect URI (http://localhost:3000/oauth/callback)
2. .env.example has clean documentation for all OAuth/webhook variables (no "not documented" comments, no duplicates)
3. docker-compose.yml has Docker socket mounted for dev-agent
4. docker-compose.yml has 60s start_period for Temporal health check
5. README documents Docker socket and image pull prerequisites
6. start-dev-agent.ts prefers OAuth tokens from .linear-tokens.json over LINEAR_ACCESS_TOKEN env var
7. TypeScript compilation succeeds
</success_criteria>

<output>
After completion, create `.planning/phases/e2e-verification/e2e-FIX-SUMMARY.md`
</output>
