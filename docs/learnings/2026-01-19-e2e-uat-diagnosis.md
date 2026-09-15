---
status: diagnosed
trigger: "Diagnose root causes for 4 issues found in E2E UAT testing"
created: 2025-01-19T11:45:00Z
updated: 2025-01-19T11:50:00Z
---

## Issue 1: Temporal Container Unhealthy (Minor)

### Root Cause

The health check uses `tctl cluster health` which fails during container startup because:
1. The internal gRPC server binds to 0.0.0.0:7233, not 127.0.0.1:7233
2. During startup, the health check runs before the server is fully listening
3. The `start_period: 30s` is correctly set but the check itself may fail intermittently

The container is **functionally healthy** (Temporal UI works, gRPC works from outside) but the internal health check reports unhealthy because of localhost binding issues documented in GitHub issues.

### Affected Files

| File | Line | Issue |
|------|------|-------|
| `docker-compose.yml` | 62-66 | Health check command may need adjustment |

### Evidence

- Temporal UI accessible at localhost:8080 (functional)
- 3 containers running (infrastructure works)
- Health check failure is cosmetic, not functional
- Known issue: https://github.com/temporalio/docker-builds/issues/109

### Suggested Fix

Option A (Simple - disable check):
```yaml
healthcheck:
  test: ["CMD", "true"]  # Always pass, rely on startup
  interval: 30s
```

Option B (Better - use temporal CLI with gRPC probe):
```yaml
healthcheck:
  test: ["CMD", "temporal", "operator", "cluster", "health", "--address", "localhost:7233"]
  interval: 10s
  timeout: 5s
  retries: 10
  start_period: 60s  # Increase to allow full initialization
```

Option C (Most robust - HTTP probe via admin API):
```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -q -O- http://localhost:7243/health || exit 1"]
  interval: 10s
  timeout: 5s
  retries: 10
  start_period: 45s
```

---

## Issue 2: Linear OAuth Flow Fails (Blocker)

### Root Cause

**Multiple issues compound:**

1. **Redirect URI mismatch**: Script uses `http://localhost:3000/oauth/callback` but Linear OAuth app may be configured with a different URI
2. **OAuth script not containerized**: Runs locally with `npx tsx`, not in Docker - contradicts "everything containerized" requirement
3. **Documentation incomplete**: `.env.example` still shows `LINEAR_ACCESS_TOKEN` as primary, with `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` marked as "not documented"

### Affected Files

| File | Line | Issue |
|------|------|-------|
| `src/scripts/linear-oauth.ts` | 30 | Hardcoded redirect URI `http://localhost:3000/oauth/callback` |
| `.env.example` | 29-42 | Confusing documentation - shows ACCESS_TOKEN as primary, CLIENT_ID/SECRET as undocumented |
| `docker-compose.yml` | - | Missing linear-oauth service |
| `README.md` | 222 | Documents redirect URI as `http://localhost:3333/callback` - MISMATCH with code |

### Evidence

**Critical mismatch discovered:**
- `src/scripts/linear-oauth.ts` line 30: `http://localhost:3000/oauth/callback`
- `README.md` line 222: `http://localhost:3333/callback`

These don't match. User must configure Linear OAuth app with exact redirect URI used by the script.

### Suggested Fixes

1. **Fix README/code mismatch** - Choose one redirect URI:
   - Code uses port 3000, README says 3333
   - Either update code to 3333 or README to 3000
   - Recommend: Keep 3000 (script already uses it)

2. **Update README Linear OAuth section**:
   ```markdown
   4. Fill in:
      - **Name**: Aesir (or your preferred name)
      - **Redirect URI**: `http://localhost:3000/oauth/callback`  # MUST match exactly
   ```

3. **Update .env.example** to clarify OAuth variables:
   ```bash
   # ===================
   # Linear Configuration
   # ===================

   # For quick start / personal use: Personal API Key
   # API Key: Linear > Settings > API > Personal API keys
   # LINEAR_ACCESS_TOKEN=lin_api_your-token

   # For production: OAuth Application (RECOMMENDED)
   # Creates tasks as app identity, not personal user
   # Create app at: https://linear.app/settings/api/applications
   # Redirect URI: http://localhost:3000/oauth/callback
   LINEAR_CLIENT_ID=your-client-id
   LINEAR_CLIENT_SECRET=your-client-secret

   # After running `npm run linear-oauth`, tokens are stored in .linear-tokens.json
   # The system will auto-refresh tokens using CLIENT_ID and CLIENT_SECRET
   ```

4. **Optionally containerize OAuth flow** (low priority):
   - OAuth is a one-time setup operation
   - Running locally is acceptable for initial setup
   - Add documentation note that this is the one non-containerized step

---

## Issue 3: Dev Agent Won't Start (Blocker)

### Root Cause

**Two separate failure modes:**

#### A. Container Run Failure: Docker Socket Not Accessible

The dev-agent container tries to create a DockerSandbox (`docker-sandbox.ts` line 84-93) which uses Dockerode to connect to `/var/run/docker.sock`. The container doesn't have access to the host's Docker socket.

**Why this happens:**
- Container runs as non-root user `aesir` (Dockerfile line 36-38)
- Docker socket is not mounted into the container
- `docker-compose.yml` does not include volume mount for Docker socket

**Files affected:**
| File | Line | Issue |
|------|------|-------|
| `docker-compose.yml` | 81-118 | Missing Docker socket volume mount |
| `src/sandbox/docker-sandbox.ts` | 75 | Uses `new Docker()` which defaults to `/var/run/docker.sock` |

#### B. Local Run Failure: Missing Docker Image

When running locally (`npm run dev-agent`), the script uses `node:20-alpine` image (specified in `start-dev-agent.ts` line 109).

**However:** `docker-sandbox.ts` line 35 defaults to `node:20-slim`, while `start-dev-agent.ts` line 109 explicitly sets `image: "node:20-alpine"`.

The error "No such image: node:20-alpine" means:
1. User doesn't have this image pulled locally
2. The script doesn't auto-pull images before use

**Files affected:**
| File | Line | Issue |
|------|------|-------|
| `src/scripts/start-dev-agent.ts` | 109 | Uses `node:20-alpine` |
| `src/sandbox/docker-sandbox.ts` | 35 | Default is `node:20-slim` (inconsistent) |

#### C. Environment Variables Not Documented

Some required env vars for dev-agent are undocumented:
- `LINEAR_WEBHOOK_SECRET` - required but marked "not documented" in .env.example
- `SLACK_CHANNEL_ID` - required but marked "not documented" in .env.example

### Suggested Fixes

**For Container Docker Socket Access:**
```yaml
# docker-compose.yml dev-agent service
dev-agent:
  # ... existing config ...
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  # User must be in docker group or run as root for socket access
  user: root  # Or configure docker group properly
```

**Alternatively, for security-conscious deployment:**
- Document that dev-agent cannot create sandboxes when containerized
- Recommend running dev-agent locally for sandbox functionality
- Or use E2B (cloud sandboxes) instead of local Docker

**For Missing Image (local run):**
```bash
# Add to README Quick Start or as pre-requisite:
docker pull node:20-alpine
```

**Or auto-pull in code** (add to docker-sandbox.ts):
```typescript
// Before createContainer, pull image if missing
try {
  await docker.getImage(image).inspect();
} catch {
  await docker.pull(image);
}
```

**For Undocumented Variables:**
Update `.env.example`:
```bash
# Webhook signing secret for verifying Linear webhooks
# Found in Linear > Settings > Webhooks > Your webhook > Signing secret
LINEAR_WEBHOOK_SECRET=your-webhook-signing-secret

# Slack channel ID for approval notifications (format: C0123456789)
# Right-click channel in Slack > Copy link > extract ID from URL
SLACK_CHANNEL_ID=C0123456789
```

---

## Issue 4: Linear Tasks Show User Identity (Major)

### Root Cause

**Downstream effect of Issue 2 (OAuth failure).**

The system is using `LINEAR_ACCESS_TOKEN` (personal API key) instead of OAuth tokens because:
1. OAuth flow fails (Issue 2)
2. Without OAuth tokens, system falls back to personal token
3. Personal tokens create issues as the user, not the app

### Affected Files

| File | Line | Issue |
|------|------|-------|
| `src/scripts/start-dev-agent.ts` | 100 | Uses `LINEAR_ACCESS_TOKEN` directly |
| `src/integrations/linear/index.js` | - | Needs to prefer OAuth tokens over personal token |

### Evidence

- `start-dev-agent.ts` line 100: `getLinearClient(process.env["LINEAR_ACCESS_TOKEN"]!)`
- No code path to use `.linear-tokens.json` OAuth tokens
- Personal token creates tasks as user identity

### Dependency Chain

```
Issue 2 (OAuth fails)
    --> No OAuth tokens available
    --> Falls back to LINEAR_ACCESS_TOKEN
    --> Issue 4 (wrong identity)
```

### Suggested Fix

**Fix Issue 2 first** - once OAuth works, implement token preference:

```typescript
// In start-dev-agent.ts, replace line 100 with:
import { createLinearClientFromFile, getLinearClient } from "../integrations/linear/index.js";

// Try OAuth tokens first, fall back to personal token
let linearClient;
try {
  linearClient = await createLinearClientFromFile();
  logger.info("linear_client", { message: "Using OAuth tokens" });
} catch {
  linearClient = getLinearClient(process.env["LINEAR_ACCESS_TOKEN"]!);
  logger.warn("linear_client", { message: "OAuth tokens not found, using personal token (tasks will show as user)" });
}
```

---

## Summary

| Issue | Severity | Root Cause | Fix Complexity |
|-------|----------|------------|----------------|
| 1. Temporal unhealthy | Minor | Health check command timing | Low - update health check |
| 2. OAuth flow fails | Blocker | Redirect URI mismatch + docs | Medium - fix URI + docs |
| 3. Dev Agent won't start | Blocker | Docker socket + missing image | Medium - add volume + docs |
| 4. User identity | Major | OAuth failure cascade | Dependent on Issue 2 |

### Recommended Fix Order

1. **Issue 2 (OAuth)** - Unblocks Issue 4
2. **Issue 3 (Dev Agent)** - Independent blocker
3. **Issue 4 (Identity)** - Auto-resolved when Issue 2 fixed + token preference added
4. **Issue 1 (Temporal)** - Minor, can wait
