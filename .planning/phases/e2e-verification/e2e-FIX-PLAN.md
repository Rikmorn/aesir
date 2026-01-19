---
phase: e2e-verification
plan: FIX
type: execute
wave: 1
depends_on: []
files_modified:
  - src/scripts/linear-oauth.ts
  - docker-compose.yml
  - .env.example
  - README.md
  - src/scripts/start-dev-agent.ts
autonomous: true
gap_closure: true

must_haves:
  truths:
    - "OAuth flow runs in a Docker container, not on the host"
    - "OAuth callback URL is configurable via environment variable"
    - "External services reach OAuth via Cloudflare tunnel, not localhost"
    - "Dev Agent starts and connects to Temporal"
    - "Linear tasks show app identity when OAuth tokens exist"
    - "All Docker containers show healthy status"
  artifacts:
    - path: "src/scripts/linear-oauth.ts"
      provides: "Configurable OAuth callback URL from OAUTH_CALLBACK_URL env var"
      contains: "OAUTH_CALLBACK_URL"
    - path: "docker-compose.yml"
      provides: "OAuth service container and Docker socket mount for dev-agent"
      contains: "aesir-oauth"
    - path: ".env.example"
      provides: "Complete environment variable documentation including OAUTH_CALLBACK_URL"
      contains: "OAUTH_CALLBACK_URL"
    - path: "README.md"
      provides: "OAuth tunnel setup documentation, no localhost references for OAuth"
      contains: "oauth tunnel"
    - path: "src/scripts/start-dev-agent.ts"
      provides: "OAuth token preference logic"
      contains: "createLinearClientFromFile"
  key_links:
    - from: "README.md"
      to: "src/scripts/linear-oauth.ts"
      via: "documented tunnel URL matches env var pattern"
      pattern: "OAUTH_CALLBACK_URL"
    - from: "docker-compose.yml"
      to: "src/scripts/linear-oauth.ts"
      via: "oauth service runs the script"
      pattern: "linear-oauth"
    - from: "src/scripts/start-dev-agent.ts"
      to: ".linear-tokens.json"
      via: "OAuth token preference check"
      pattern: "createLinearClientFromFile"
---

<objective>
Fix E2E verification gaps by properly containerizing the OAuth flow per PROJECT.md constraints.

Purpose: All services must run in Docker containers with external access via Cloudflare tunnels. The OAuth flow currently violates this by running on the host with localhost URLs.

Output: Fully containerized OAuth service, configurable callback URLs, updated documentation removing all localhost references for OAuth.
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
  <name>Task 1: Make OAuth callback URL configurable</name>
  <files>src/scripts/linear-oauth.ts</files>
  <action>
Update linear-oauth.ts to read the OAuth callback URL from an environment variable instead of hardcoding localhost.

1. Replace the hardcoded REDIRECT_URI constant (line 30):
   ```typescript
   // OLD:
   const REDIRECT_URI = "http://localhost:3000/oauth/callback";

   // NEW:
   const REDIRECT_URI = process.env["OAUTH_CALLBACK_URL"];
   ```

2. Update validateEnv() function to also check for OAUTH_CALLBACK_URL:
   ```typescript
   function validateEnv(): void {
     if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
       console.error("\n[ERROR] Missing required environment variables:\n");
       if (!CLIENT_ID) console.error("   - LINEAR_CLIENT_ID");
       if (!CLIENT_SECRET) console.error("   - LINEAR_CLIENT_SECRET");
       if (!REDIRECT_URI) console.error("   - OAUTH_CALLBACK_URL");
       console.error(
         "\nCreate a Linear OAuth application at: https://linear.app/settings/api"
       );
       console.error("Set OAUTH_CALLBACK_URL to your Cloudflare tunnel URL for OAuth.");
       console.error("Then add the credentials to .env.local\n");
       process.exit(1);
     }
   }
   ```

3. Update the server.listen() console output (around line 241-245) to show the tunnel URL:
   ```typescript
   server.listen(3000, "0.0.0.0", () => {
     console.log("\n[INFO] Linear OAuth Authorization\n");
     console.log("Open this URL in your browser to authorize:\n");
     console.log(`  ${authUrl.toString()}\n`);
     console.log(`Callback URL configured: ${REDIRECT_URI}`);
     console.log("Waiting for authorization callback on port 3000...\n");
   });
   ```

4. Bind to 0.0.0.0 instead of implicit localhost so Docker container can receive traffic from the tunnel.

The callback URL will be set to the Cloudflare tunnel URL (e.g., https://oauth.example.com/oauth/callback) in the environment.
  </action>
  <verify>
Grep src/scripts/linear-oauth.ts for "OAUTH_CALLBACK_URL" - should find at least 2 matches (env read and error message).
Grep src/scripts/linear-oauth.ts for "localhost:3000" - should find NO matches (removed hardcoded localhost).
Grep src/scripts/linear-oauth.ts for "0.0.0.0" - should find the server.listen binding.
TypeScript compiles: `npx tsc --noEmit src/scripts/linear-oauth.ts`
  </verify>
  <done>
linear-oauth.ts reads OAUTH_CALLBACK_URL from environment, validates it exists, and binds to 0.0.0.0 for container access.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add OAuth service to Docker Compose</name>
  <files>docker-compose.yml</files>
  <action>
Add two things to docker-compose.yml:

1. Add Docker socket volume mount to dev-agent service (after ports section, around line 114):
   ```yaml
   volumes:
     - /var/run/docker.sock:/var/run/docker.sock
   ```

2. Add a new OAuth service for running the OAuth flow. Add this after the cloudflared-health service (around line 186), before the volumes section:

   ```yaml
   # OAuth Authorization - runs Linear OAuth flow in container
   # Usage: docker compose run --rm oauth
   # Requires: OAUTH_CALLBACK_URL pointing to a Cloudflare tunnel
   oauth:
     build:
       context: .
       dockerfile: Dockerfile
     container_name: aesir-oauth
     environment:
       - LINEAR_CLIENT_ID=${LINEAR_CLIENT_ID}
       - LINEAR_CLIENT_SECRET=${LINEAR_CLIENT_SECRET}
       - OAUTH_CALLBACK_URL=${OAUTH_CALLBACK_URL}
     ports:
       - "3000:3000"
     command: ["node", "dist/scripts/linear-oauth.js"]
     volumes:
       # Mount tokens file to host so other services can access it
       - ./.linear-tokens.json:/app/.linear-tokens.json
     networks:
       - aesir-network
     profiles:
       - oauth
   ```

3. Update the Temporal health check start_period from 30s to 60s (around line 66):
   ```yaml
   start_period: 60s
   ```

Notes:
- The oauth service uses the `oauth` profile so it doesn't start with normal `docker compose up`
- User runs `docker compose run --rm oauth` to start the OAuth flow
- Tokens file is mounted as a volume so it persists to host and other containers can access it
- The Cloudflare tunnel for OAuth needs to route to `oauth:3000` when the container is running
  </action>
  <verify>
Grep docker-compose.yml for "aesir-oauth" - should find the container name.
Grep docker-compose.yml for "OAUTH_CALLBACK_URL" - should find it in oauth service environment.
Grep docker-compose.yml for "/var/run/docker.sock" - should find the volume mount.
Grep docker-compose.yml for "start_period: 60s" - should find the updated Temporal health check.
Grep docker-compose.yml for "profiles:" followed by "oauth" - should find the oauth profile.
  </verify>
  <done>
docker-compose.yml has:
- Docker socket mounted for dev-agent
- New oauth service with OAUTH_CALLBACK_URL environment variable
- Temporal health check with 60s start_period
- oauth profile so service only runs on demand
  </done>
</task>

<task type="auto">
  <name>Task 3: Update .env.example with complete documentation</name>
  <files>.env.example</files>
  <action>
Clean up and complete .env.example documentation:

1. Remove all "# not documented" comments (lines 22, 37, 38, 39, 40, 42)

2. Add OAUTH_CALLBACK_URL in the Linear Configuration section (after LINEAR_CLIENT_SECRET):
   ```bash
   # OAuth Callback URL - your Cloudflare tunnel URL for OAuth flow
   # Example: https://oauth.your-domain.com/oauth/callback
   # This must match the Redirect URI in your Linear OAuth application settings
   OAUTH_CALLBACK_URL=https://oauth.your-domain.com/oauth/callback
   ```

3. Fix the Linear section documentation. Replace lines 25-46 with:
   ```bash
   # ===================
   # Linear Configuration
   # ===================

   # Linear API Key or OAuth Access Token
   # API Key: Linear > Settings > API > Personal API keys > Create key
   # Or use OAuth access token from authorization flow (preferred for app identity)
   LINEAR_ACCESS_TOKEN=lin_api_your-token

   # Team ID where tasks will be created
   # Found in Linear team settings URL or via API
   LINEAR_TEAM_ID=your-team-id

   # OAuth Application credentials (for app identity in Linear)
   # Create at: linear.app/settings/api/applications
   LINEAR_CLIENT_ID=your-client-id
   LINEAR_CLIENT_SECRET=your-client-secret

   # OAuth Callback URL - your Cloudflare tunnel URL for OAuth flow
   # Example: https://oauth.your-domain.com/oauth/callback
   # This must match the Redirect URI in your Linear OAuth application settings
   OAUTH_CALLBACK_URL=https://oauth.your-domain.com/oauth/callback
   ```

4. Remove duplicate LINEAR_WEBHOOK_SECRET entry (keep the one around line 69 in the Linear Webhooks section)

5. Remove duplicate SLACK_CHANNEL_ID entry (keep the one around line 72 in the Linear Webhooks section)

6. Add proper comment for SLACK_CHANNEL_ID in Slack Configuration section if keeping one there:
   ```bash
   # Channel ID for agent notifications (format: C0123456789)
   # Find by right-clicking channel > View channel details > scroll to bottom
   SLACK_CHANNEL_ID=C0123456789
   ```

The file should have no "not documented" comments and no duplicate variable definitions.
  </action>
  <verify>
Grep .env.example for "not documented" - should find NO matches.
Grep .env.example for "OAUTH_CALLBACK_URL" - should find exactly ONE definition with documentation.
Grep -c .env.example for "LINEAR_WEBHOOK_SECRET=" - should return 1 (no duplicates).
Grep -c .env.example for "^SLACK_CHANNEL_ID=" - should return 1 (no duplicates).
  </verify>
  <done>
.env.example has:
- Clean documentation for all variables (no "not documented" comments)
- OAUTH_CALLBACK_URL documented with tunnel URL example
- No duplicate variable definitions
- All OAuth-related variables properly documented
  </done>
</task>

<task type="auto">
  <name>Task 4: Update README with OAuth tunnel setup</name>
  <files>README.md</files>
  <action>
Update README.md to document the containerized OAuth flow with Cloudflare tunnel. Make these changes:

1. In the "Linear OAuth Setup" section (around line 195), rewrite the "Production: OAuth App Authorization" subsection:

Replace the content from "#### 1. Create a Linear OAuth Application" through "#### 4. Verify Authorization" with:

```markdown
#### 1. Create a Linear OAuth Application

1. Go to [linear.app/settings/api/applications](https://linear.app/settings/api/applications)
2. Click **Create new OAuth application**
3. Fill in:
   - **Name**: Aesir (or your preferred name)
   - **Redirect URI**: Your OAuth tunnel URL (e.g., `https://oauth.your-domain.com/oauth/callback`)
4. Copy the **Client ID** and **Client Secret**

**Important:** Do NOT use `localhost` for the Redirect URI. The OAuth flow runs in a Docker container and receives callbacks via Cloudflare tunnel.

#### 2. Create OAuth Tunnel in Cloudflare

You need a dedicated tunnel for the OAuth callback (separate from the webhooks tunnel):

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and select Zero Trust
2. Navigate to: **Networks** > **Tunnels**
3. Click **Create a tunnel** (or use existing and add a public hostname)
4. Add a public hostname:

| Field | Value |
|-------|-------|
| Subdomain | `oauth` (or your choice) |
| Domain | `your-cloudflare-domain.com` |
| Path | (leave empty) |
| Service Type | HTTP |
| URL | `oauth:3000` |

This routes `https://oauth.your-domain.com/*` to the OAuth container.

#### 3. Configure Environment Variables

Add to `.env.local`:

```bash
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret
OAUTH_CALLBACK_URL=https://oauth.your-domain.com/oauth/callback
```

The `OAUTH_CALLBACK_URL` must exactly match the Redirect URI configured in your Linear OAuth application.

#### 4. Run Authorization Flow

```bash
# Build if needed
npm run docker:build

# Start the OAuth flow (runs in container)
docker compose --profile oauth run --rm oauth
```

This will:
1. Start a container listening for the OAuth callback
2. Display a URL to open in your browser
3. After authorization, exchange the code for tokens
4. Save tokens to `.linear-tokens.json`

#### 5. Verify Authorization

The OAuth flow displays your authorized workspace and user. The `.linear-tokens.json` file is created in the project root.

**Note:** You need the Cloudflare tunnel running to receive the callback. Either:
- Run `docker compose --profile tunnel up -d` first
- Or have the tunnel configured to route even when containers aren't running
```

2. In the "Prerequisites" section (around line 12), add Docker requirement:
   ```markdown
   - Docker Desktop running (all services run containerized)
   ```

3. In the "Webhook Tunnel Setup" section (around line 516), add a note about multiple tunnels:

After the line "### Prerequisites", add:

```markdown
**Note:** You may need two tunnels:
- **Webhooks tunnel**: Routes to `dev-agent:3001` for Linear/GitHub webhooks
- **OAuth tunnel**: Routes to `oauth:3000` for OAuth callbacks (only needed during authorization)

These can be separate tunnels or separate public hostnames on the same tunnel.
```

4. Remove or update any remaining localhost:3000 or localhost:3333 references for OAuth:
   - Search for "localhost:3333" and "localhost:3000" in OAuth-related contexts
   - Replace with tunnel URL references or env var references
  </action>
  <verify>
Grep README.md for "OAUTH_CALLBACK_URL" - should find documentation of the env var.
Grep README.md for "oauth:3000" - should find the tunnel routing documentation.
Grep README.md for "docker compose --profile oauth" - should find the run command.
Grep README.md for "localhost:3333" - should find NO matches.
Grep README.md for "localhost:3000/oauth" or "localhost:3000/callback" - should find NO matches in OAuth sections.
  </verify>
  <done>
README.md documents:
- OAuth tunnel setup (separate from webhooks tunnel)
- OAUTH_CALLBACK_URL environment variable requirement
- Running OAuth flow via `docker compose --profile oauth run --rm oauth`
- No localhost references for OAuth callbacks
  </done>
</task>

<task type="auto">
  <name>Task 5: Fix Dev Agent Docker configuration</name>
  <files>README.md</files>
  <action>
Add missing Dev Agent Docker prerequisites to README.md:

1. In "Running the Dev Agent" section (around line 340), update the "### Prerequisites" subsection:

After the existing prerequisites (around line 346-352), add:

```markdown
3. **Docker socket accessible**: The dev-agent container needs Docker socket access for sandbox execution:
   - Docker Desktop (macOS/Windows): Enabled by default
   - Docker Engine (Linux): User must be in `docker` group

4. **Sandbox image available**: The container pulls `node:20-alpine` for sandbox execution. On slow networks, first pull may take time.
```

2. In "Running with Docker (Recommended)" section (around line 464), add a note about the Docker socket:

After "### 2. Build and Start", add:

```markdown
**Note:** The dev-agent container mounts the Docker socket to create sandbox containers. This is configured in `docker-compose.yml`. On Linux, ensure your user is in the `docker` group.
```
  </action>
  <verify>
Grep README.md for "Docker socket" - should find prerequisites documentation.
Grep README.md for "node:20-alpine" - should find sandbox image reference.
  </verify>
  <done>
README.md documents Docker socket requirement and sandbox image for Dev Agent.
  </done>
</task>

<task type="auto">
  <name>Task 6: Implement OAuth token preference in start-dev-agent.ts</name>
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
         message: "OAuth tokens not found, falling back to LINEAR_ACCESS_TOKEN (user identity). Run 'docker compose --profile oauth run --rm oauth' for app identity."
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
- Updated message mentions containerized OAuth command
  </action>
  <verify>
Grep src/scripts/start-dev-agent.ts for "createLinearClientFromFile" - should find the import and usage.
Grep src/scripts/start-dev-agent.ts for "TokenFileNotFoundError" - should find the import and catch clause.
Grep src/scripts/start-dev-agent.ts for "OAuth tokens" - should find the log messages.
Grep src/scripts/start-dev-agent.ts for "docker compose --profile oauth" - should find in the fallback warning message.
TypeScript compiles: `npx tsc --noEmit src/scripts/start-dev-agent.ts`
  </verify>
  <done>
start-dev-agent.ts checks for OAuth tokens first, falls back to LINEAR_ACCESS_TOKEN with warning.
Linear tasks created by Dev Agent show app identity when OAuth tokens exist.
Warning message directs users to containerized OAuth command.
  </done>
</task>

<task type="auto">
  <name>Task 7: Mount tokens file for dev-agent container</name>
  <files>docker-compose.yml</files>
  <action>
The dev-agent container needs access to .linear-tokens.json created by the OAuth flow.

Add a volume mount to the dev-agent service (after the Docker socket mount added in Task 2):

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - ./.linear-tokens.json:/app/.linear-tokens.json:ro
```

The `:ro` (read-only) flag is appropriate since dev-agent only reads the tokens file, it doesn't write to it.

Note: If the file doesn't exist, Docker will create an empty directory. The token-store code handles this gracefully by throwing TokenFileNotFoundError, which triggers the fallback to LINEAR_ACCESS_TOKEN.
  </action>
  <verify>
Grep docker-compose.yml for ".linear-tokens.json" - should find volume mounts in both oauth and dev-agent services.
Grep docker-compose.yml for "linear-tokens.json:/app/.linear-tokens.json" - should find 2 matches (oauth writeable, dev-agent read-only).
  </verify>
  <done>
docker-compose.yml mounts .linear-tokens.json for both:
- oauth service (writeable, to save tokens)
- dev-agent service (read-only, to use tokens)
  </done>
</task>

</tasks>

<verification>
After completing all tasks:

1. Verify linear-oauth.ts uses env var:
   - `grep -n "OAUTH_CALLBACK_URL" src/scripts/linear-oauth.ts` returns at least 2 matches
   - `grep -n "localhost:3000" src/scripts/linear-oauth.ts` returns no matches

2. Verify docker-compose.yml changes:
   - `grep -n "aesir-oauth" docker-compose.yml` returns match
   - `grep -n "OAUTH_CALLBACK_URL" docker-compose.yml` returns match
   - `grep -n "/var/run/docker.sock" docker-compose.yml` returns match
   - `grep -n "start_period: 60s" docker-compose.yml` returns match
   - `grep -n ".linear-tokens.json" docker-compose.yml` returns 2 matches

3. Verify .env.example cleanup:
   - `grep -c "not documented" .env.example` returns 0
   - `grep -c "OAUTH_CALLBACK_URL" .env.example` returns 1

4. Verify README changes:
   - `grep -n "OAUTH_CALLBACK_URL" README.md` returns matches
   - `grep -n "docker compose --profile oauth" README.md` returns match
   - `grep -n "localhost:3333" README.md` returns no matches
   - `grep "localhost:3000" README.md | grep -i oauth` returns no matches

5. Verify OAuth token preference (Task 6):
   - `grep "createLinearClientFromFile" src/scripts/start-dev-agent.ts` returns match
   - `grep "TokenFileNotFoundError" src/scripts/start-dev-agent.ts` returns match

6. TypeScript compiles without errors:
   - `npx tsc --noEmit` succeeds
</verification>

<success_criteria>
1. linear-oauth.ts reads OAUTH_CALLBACK_URL from environment (no hardcoded localhost)
2. linear-oauth.ts binds to 0.0.0.0 for container accessibility
3. docker-compose.yml has oauth service with OAUTH_CALLBACK_URL environment
4. docker-compose.yml has Docker socket mounted for dev-agent
5. docker-compose.yml has tokens file mounted for both oauth and dev-agent
6. docker-compose.yml has 60s start_period for Temporal health check
7. .env.example documents OAUTH_CALLBACK_URL with tunnel URL example
8. .env.example has no "not documented" comments or duplicate variables
9. README documents OAuth tunnel setup (separate from webhooks)
10. README has no localhost references for OAuth callbacks
11. README documents Docker socket requirement for dev-agent
12. start-dev-agent.ts prefers OAuth tokens, falls back to LINEAR_ACCESS_TOKEN
13. TypeScript compilation succeeds
</success_criteria>

<output>
After completion, create `.planning/phases/e2e-verification/e2e-FIX-SUMMARY.md`
</output>
