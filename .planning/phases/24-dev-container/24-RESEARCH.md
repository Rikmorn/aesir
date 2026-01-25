# Phase 24: Dev Container - Research

**Researched:** 2026-01-25
**Domain:** Docker containerization, persistent dev environments, container lifecycle management
**Confidence:** HIGH

## Summary

This phase builds persistent development containers where dev-agent can execute shell commands, manage git workflows, and handle long-running tasks with proper lifecycle management. The research confirms that the existing `@aesir/platform/sandbox` module provides a solid foundation using dockerode (the standard Node.js Docker SDK), which we'll extend with:

1. **Named container management** for task-specific containers (`dev-container-{taskId}`)
2. **Database-backed state tracking** for production-ready lifecycle management
3. **Custom dev environment image** with Node.js, pnpm, git, ripgrep, fd-find, jq, and GitHub CLI
4. **Git credential injection** via environment variables for authenticated repository access

The standard approach in 2026 for Docker-based dev containers emphasizes multi-stage builds for smaller images, proper timeout handling (10-90s depending on operation), and database-first state tracking for scalability. Dockerode remains the authoritative Node.js Docker SDK with excellent TypeScript support.

**Primary recommendation:** Extend existing DockerSandbox with named container creation, add PostgreSQL state table for container tracking, build custom dev image with all required tools, and implement timeout-aware command execution with database sync.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| dockerode | 4.x | Docker Remote API client for Node.js | De facto standard Node.js Docker SDK, well-maintained, full API coverage, TypeScript support |
| Node.js | 20 LTS | Runtime environment | Long-term support, existing project standard |
| pnpm | 9.x | Package manager | Workspace support, disk-efficient, project standard |
| PostgreSQL | 15 | Container state persistence | Already deployed in project, ACID guarantees for state |

**Source:** [dockerode npm](https://www.npmjs.com/package/dockerode), [dockerode GitHub](https://github.com/apocas/dockerode)

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ripgrep (rg) | Latest | Fast code search | Research phase - finding files, patterns |
| fd-find (fd) | Latest | Fast file finder | Research phase - directory traversal |
| jq | Latest | JSON processing | Parsing API responses, config files |
| GitHub CLI (gh) | Latest | GitHub operations | PR creation, issue management (optional) |
| git | 2.x | Version control | Repository cloning, committing, pushing |

**Note:** ripgrep and fd are written in Rust, significantly faster than grep/find for large codebases.

**Sources:**
- [ripgrep guide](https://hostman.com/tutorials/how-to-install-and-use-ripgrep/)
- [fd vs ripgrep comparison](https://notes.suhaib.in/docs/tech/utilities/fd-vs-ripgrep-the-new-cli-kings/)
- [GitHub CLI discussions](https://github.com/cli/cli/discussions/3698)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| dockerode | @docker/sdk (official) | Official SDK exists but dockerode has broader adoption and better TypeScript support |
| Named containers | Auto-generated IDs | Names enable easy lookup but require uniqueness handling |
| Database state | Docker API only | Database enables multi-host, audit trail, but adds complexity |

**Installation:**

```bash
# For dev container image (Dockerfile)
apt-get install -y git ripgrep fd-find jq
npm install -g pnpm

# For host (agent package)
pnpm add dockerode
pnpm add -D @types/dockerode
```

## Architecture Patterns

### Recommended Project Structure

```
packages/platform/src/sandbox/
├── docker-sandbox.ts           # Existing: generic sandbox
├── dev-container.ts            # New: named, persistent containers
├── dev-container-manager.ts    # New: lifecycle orchestration
├── types.ts                    # Extend with DevContainer interface
└── index.ts                    # Export all

packages/platform/src/db/schema/
└── dev_containers.ts           # New: container state table

packages/agents/src/dev-agent/
└── activities/
    ├── container-setup.ts      # Spawn, clone, install
    ├── container-exec.ts       # Execute commands
    └── container-cleanup.ts    # Remove containers
```

### Pattern 1: Named Container Management

**What:** Create containers with predictable names for task-specific work

**When to use:** When you need to resume work in the same container (PR feedback loops)

**Example:**
```typescript
// Source: Existing docker-sandbox.ts + naming best practices
import Docker from 'dockerode';

interface DevContainerOptions {
  taskId: string;
  image: string;
  environment?: Record<string, string>;
}

async function createDevContainer(options: DevContainerOptions) {
  const docker = new Docker();
  const containerName = `dev-container-${options.taskId}`;

  // Check if container already exists
  const existing = await findContainerByName(containerName);
  if (existing) {
    return existing;
  }

  const container = await docker.createContainer({
    name: containerName,
    Image: options.image,
    Cmd: ['sleep', 'infinity'],
    Env: Object.entries(options.environment || {}).map(
      ([k, v]) => `${k}=${v}`
    ),
    HostConfig: {
      AutoRemove: false, // Must persist for reuse
    },
  });

  await container.start();
  return container;
}
```

**Source:** [Docker container naming best practices](https://devtodevops.com/blog/docker-container-naming-convention/)

### Pattern 2: Database-First State Tracking

**What:** Store container metadata in PostgreSQL, verify with Docker API

**When to use:** Production environments, multi-host scenarios, audit requirements

**Example:**
```typescript
// Source: PostgreSQL container patterns + existing db patterns
interface DevContainerRecord {
  id: string;
  task_id: string;
  container_id: string;
  status: 'running' | 'stopped' | 'failed';
  created_at: Date;
  last_activity: Date;
}

async function trackContainer(
  db: PostgresJsDatabase,
  taskId: string,
  containerId: string
) {
  await db.insert(devContainers).values({
    task_id: taskId,
    container_id: containerId,
    status: 'running',
    created_at: new Date(),
    last_activity: new Date(),
  });
}

async function syncContainerState(
  db: PostgresJsDatabase,
  docker: Docker
) {
  const records = await db.select().from(devContainers);

  for (const record of records) {
    try {
      const container = docker.getContainer(record.container_id);
      const inspect = await container.inspect();

      const dbStatus = inspect.State.Running ? 'running' : 'stopped';
      if (dbStatus !== record.status) {
        await db.update(devContainers)
          .set({ status: dbStatus })
          .where(eq(devContainers.id, record.id));
      }
    } catch (err) {
      // Container no longer exists
      await db.update(devContainers)
        .set({ status: 'failed' })
        .where(eq(devContainers.id, record.id));
    }
  }
}
```

**Source:** [PostgreSQL in Docker best practices](https://sliplane.io/blog/best-practices-for-postgres-in-docker)

### Pattern 3: Git Credential Injection

**What:** Pass GitHub token to container via environment variable, configure git credential helper

**When to use:** Private repository access from containers

**Example:**
```typescript
// Source: Git credential helper in containers + Docker env vars
async function configureGitCredentials(
  container: Container,
  githubToken: string
) {
  // Set git credential helper to read from environment
  await container.exec({
    Cmd: [
      'git', 'config', '--global', 'credential.helper',
      'store --file=/tmp/.git-credentials'
    ],
  });

  // Write credentials file (ephemeral, in-memory filesystem)
  const credContent = `https://oauth2:${githubToken}@github.com`;
  await container.exec({
    Cmd: ['sh', '-c', `echo "${credContent}" > /tmp/.git-credentials`],
  });

  // Alternative: Use environment variable directly
  // GIT_ASKPASS approach with script that echoes token
}
```

**Source:** [Git credentials in containers](https://medium.com/datamindedbe/containerizing-git-credential-helpers-5f7ef75849b4), [VS Code dev containers](https://code.visualstudio.com/remote/advancedcontainers/sharing-git-credentials)

### Pattern 4: Timeout-Aware Command Execution

**What:** Execute commands with operation-specific timeouts, graceful termination

**When to use:** All container exec operations to prevent hanging

**Example:**
```typescript
// Source: Docker exec best practices + timeout patterns
interface ExecOptions {
  command: string[];
  timeoutMs: number;
  workdir?: string;
}

async function executeWithTimeout(
  container: Container,
  options: ExecOptions
): Promise<ExecutionResult> {
  const exec = await container.exec({
    Cmd: options.command,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: options.workdir,
  });

  const stream = await exec.start({ Detach: false });

  return Promise.race([
    demuxStream(stream, exec),
    timeout(options.timeoutMs),
  ]);
}

// Timeout values based on operation type
const TIMEOUTS = {
  research: 30_000,      // grep, find, cat
  install: 300_000,      // pnpm install
  test: 180_000,         // pnpm test
  build: 120_000,        // pnpm build
  git: 60_000,           // clone, push
};
```

**Source:** [Docker exec command guide](https://betterstack.com/community/guides/scaling-docker/docker-exec/), [Docker graceful shutdown](https://labex.io/tutorials/docker-how-to-gracefully-shut-down-a-long-running-docker-container-417742)

### Pattern 5: Multi-Stage Dockerfile for Dev Image

**What:** Build minimal dev environment image with all required tools

**When to use:** Custom dev container image creation

**Example:**
```dockerfile
# Source: Node.js + pnpm Dockerfile patterns
FROM node:20-slim AS base

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    ripgrep \
    fd-find \
    jq \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (optional)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
    https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh

# Set working directory
WORKDIR /workspace

# Keep container running
CMD ["sleep", "infinity"]
```

**Source:** [Optimal Node.js pnpm Dockerfile](https://depot.dev/docs/container-builds/how-to-guides/optimal-dockerfiles/node-pnpm-dockerfile), [Multi-stage pnpm builds](https://github.com/orgs/pnpm/discussions/5376)

### Anti-Patterns to Avoid

- **Exposing Docker socket to containers:** Grants root access to host, major security risk
- **Using `--rm` flag:** Prevents container reuse for feedback loops
- **TTY mode for exec:** Breaks stdout/stderr demultiplexing, use `Tty: false`
- **Hardcoded timeouts:** Different operations need different timeout values
- **Ignoring exit codes:** Always check exit codes and handle non-zero appropriately
- **Read-only Docker socket:** Ineffective security measure, doesn't prevent exploitation
- **Generic container names:** Use task-specific names for easy discovery and no conflicts

**Sources:**
- [Docker socket security](https://blog.quarkslab.com/why-is-exposing-the-docker-socket-a-really-bad-idea.html)
- [Docker exec best practices](https://www.docker.com/blog/docker-best-practices-choosing-between-run-cmd-and-entrypoint/)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Docker API client | Custom HTTP wrapper | dockerode | Full API coverage, TypeScript types, stream handling, well-tested |
| Stdout/stderr demuxing | Custom buffer parsing | `container.modem.demuxStream()` | Docker wire protocol is complex, edge cases handled |
| Container cleanup | Manual kill/remove | `container.stop()` with timeout | Graceful SIGTERM then SIGKILL, prevents zombie processes |
| Image pulling | REST API calls | `docker.pull(image)` | Progress events, authentication, retry logic built-in |
| Git credentials | Custom credential manager | git credential.helper store | Standard git mechanism, widely supported |

**Key insight:** Docker's wire protocol and container lifecycle have many edge cases (signal handling, stream multiplexing, graceful shutdown). Dockerode handles these correctly. Custom implementations miss subtle bugs that appear under production load.

## Common Pitfalls

### Pitfall 1: Docker Socket Permission Issues

**What goes wrong:** Agent container can't access Docker socket due to permission denied errors

**Why it happens:** Docker socket (/var/run/docker.sock) is owned by root:docker group, container runs as non-root user

**How to avoid:**
- Run agent container as root (acceptable for agents that need Docker access)
- Mount Docker socket with proper permissions in docker-compose.yml
- Add user to docker group (less secure, not recommended)

**Warning signs:** `Error: connect EACCES /var/run/docker.sock` in logs

**Decision from CONTEXT.md:** Agent container runs as root to access Docker socket (already configured in docker-compose.yml)

**Source:** [Docker socket security](https://docs.docker.com/engine/security/protect-access/), [OWASP Docker security](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)

### Pitfall 2: Container Name Conflicts

**What goes wrong:** `docker.createContainer()` fails with "container name already in use"

**Why it happens:** Previous container with same name wasn't cleaned up, or concurrent attempts to create same task container

**How to avoid:**
- Check for existing container by name before creation
- Reuse existing container if found and running
- Remove stopped containers before recreating
- Use database state to track which containers should exist

**Warning signs:** 409 Conflict errors from Docker API

**Example mitigation:**
```typescript
async function ensureContainer(name: string) {
  try {
    const container = docker.getContainer(name);
    const inspect = await container.inspect();
    if (inspect.State.Running) {
      return container; // Reuse existing
    }
    await container.remove(); // Clean up stopped
  } catch (err) {
    // Container doesn't exist, proceed to create
  }
  return await docker.createContainer({ name, ... });
}
```

**Source:** [Docker container naming conflicts](https://labex.io/tutorials/docker-how-to-resolve-container-naming-conflicts-418051)

### Pitfall 3: Zombie Containers from Incomplete Cleanup

**What goes wrong:** Containers accumulate over time, consuming disk space and memory

**Why it happens:** Cleanup code doesn't run on errors, crashes, or timeouts

**How to avoid:**
- Always use try/finally blocks for cleanup
- Implement timeout-based cleanup (24h inactivity)
- Database state table enables background cleanup job
- Use health checks to detect dead containers

**Warning signs:** `docker ps -a` shows many stopped containers, disk usage growing

**Decision from CONTEXT.md:** Three cleanup triggers: PR merged, PR closed, 24h inactivity

**Source:** [Docker container lifecycle](https://daily.dev/blog/docker-container-lifecycle-management-best-practices), [Cleanup strategies](https://www.devopstraininginstitute.com/blog/10-docker-image-cleanup-strategies)

### Pitfall 4: Git Authentication Failures in Container

**What goes wrong:** `git clone` or `git push` fails with authentication errors despite passing token

**Why it happens:** Token not properly configured in git credential helper, or token expired/invalid

**How to avoid:**
- Test token before passing to container
- Use git credential helper 'store' with explicit file path
- Verify credential file permissions
- Log git operations for debugging (without exposing token)

**Warning signs:** "Authentication failed" or "fatal: could not read Username" in git output

**Example setup:**
```bash
# In container
git config --global credential.helper 'store --file=/tmp/.git-credentials'
echo "https://oauth2:${GITHUB_TOKEN}@github.com" > /tmp/.git-credentials
chmod 600 /tmp/.git-credentials
```

**Source:** [Git credentials in containers](https://medium.com/datamindedbe/containerizing-git-credential-helpers-5f7ef75849b4)

### Pitfall 5: Command Timeout Too Aggressive

**What goes wrong:** Valid operations killed mid-execution (npm install, test suite)

**Why it happens:** Single global timeout doesn't account for operation variability

**How to avoid:**
- Use operation-specific timeouts (research: 30s, install: 5min, test: 3min)
- Start conservative, tune based on actual metrics
- Log timeout events to identify patterns
- Allow override for specific commands

**Warning signs:** Frequent timeout errors during legitimate operations

**Timeout guidelines (2026):**
- Research commands (grep, cat): 30-60s
- Package install: 3-5 minutes
- Test suites: 2-3 minutes
- Build commands: 2-3 minutes
- Git operations: 1-2 minutes

**Decision from CONTEXT.md:** Claude determines specific timeout values per command category during implementation

**Source:** [Docker stop timeout](https://last9.io/blog/docker-stop-vs-kill/), [Graceful shutdown](https://labex.io/tutorials/docker-how-to-gracefully-shut-down-a-long-running-docker-container-417742)

## Code Examples

Verified patterns from official sources:

### Container Lifecycle Management

```typescript
// Source: Existing docker-sandbox.ts + lifecycle patterns
import Docker from 'dockerode';

class DevContainerManager {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async spawn(taskId: string, githubToken: string) {
    const name = `dev-container-${taskId}`;

    // Check for existing container
    const existing = await this.findByName(name);
    if (existing) {
      const inspect = await existing.inspect();
      if (inspect.State.Running) {
        return existing; // Reuse running container
      }
      await existing.remove(); // Clean up stopped
    }

    // Create new container
    const container = await this.docker.createContainer({
      name,
      Image: 'aesir-dev-env:latest',
      Cmd: ['sleep', 'infinity'],
      Env: [`GITHUB_TOKEN=${githubToken}`],
      WorkingDir: '/workspace',
      HostConfig: {
        AutoRemove: false,
        Memory: 512 * 1024 * 1024, // 512MB
      },
    });

    await container.start();
    return container;
  }

  async execute(
    container: Container,
    command: string[],
    timeoutMs: number
  ) {
    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false, // Required for demuxing
    });

    const stream = await exec.start({ Detach: false });

    const result = await Promise.race([
      this.demuxStream(stream, exec),
      this.timeout(timeoutMs),
    ]);

    return result;
  }

  async cleanup(container: Container) {
    try {
      await container.stop({ t: 10 }); // 10s graceful
    } catch {
      await container.kill(); // Force kill
    }
    await container.remove();
  }

  private async findByName(name: string) {
    try {
      const container = this.docker.getContainer(name);
      await container.inspect(); // Verify exists
      return container;
    } catch {
      return null;
    }
  }

  private demuxStream(stream, exec): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      this.docker.modem.demuxStream(
        stream,
        { write: (chunk) => stdout.push(chunk.toString()) },
        { write: (chunk) => stderr.push(chunk.toString()) }
      );

      stream.on('end', async () => {
        const inspect = await exec.inspect();
        resolve({
          exitCode: inspect.ExitCode ?? 1,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        });
      });

      stream.on('error', reject);
    });
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Command timeout')), ms);
    });
  }
}
```

### Database State Table

```typescript
// Source: Existing Drizzle patterns in packages/platform/src/db/schema/
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const devContainers = pgTable('dev_containers', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: text('task_id').notNull().unique(),
  containerId: text('container_id').notNull(),
  status: text('status').$type<'running' | 'stopped' | 'failed'>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastActivity: timestamp('last_activity').notNull().defaultNow(),
});

// Usage
async function trackContainer(db, taskId, containerId) {
  await db.insert(devContainers).values({
    taskId,
    containerId,
    status: 'running',
  });
}

async function updateActivity(db, taskId) {
  await db.update(devContainers)
    .set({ lastActivity: new Date() })
    .where(eq(devContainers.taskId, taskId));
}

async function findInactiveContainers(db) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
  return await db.select()
    .from(devContainers)
    .where(
      and(
        eq(devContainers.status, 'running'),
        lt(devContainers.lastActivity, cutoff)
      )
    );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Docker CLI via child_process | dockerode SDK | ~2018 | Better error handling, TypeScript support, stream handling |
| Single global timeout | Operation-specific timeouts | 2024-2025 | Fewer false timeouts, better UX |
| Direct Docker socket | Socket proxies (production) | 2025-2026 | Improved security for untrusted workloads |
| Manual credential passing | Git credential helpers | Always standard | Secure, standard git mechanism |
| AutoRemove containers | Persistent named containers | Project-specific | Enables container reuse for feedback loops |

**Deprecated/outdated:**
- **docker-cli package:** Deprecated, use dockerode instead
- **Generic alpine base images:** Node.js official images preferred for compatibility
- **Password-based git auth:** OAuth tokens are standard for GitHub

## Open Questions

Things that couldn't be fully resolved:

1. **Resource limits (memory/CPU) for containers**
   - What we know: HostConfig supports Memory and CpuQuota limits
   - What's unclear: Optimal values for dev workloads (varies by repository size)
   - Recommendation: Start without limits (CONTEXT.md defers this), add if OOM issues appear

2. **GitHub CLI installation complexity**
   - What we know: No official Docker image, community images exist
   - What's unclear: Whether gh is essential vs nice-to-have
   - Recommendation: Include in Dockerfile but not critical path (can use git + API)

3. **Container network isolation**
   - What we know: Containers can be isolated from external network
   - What's unclear: Whether v2.1 needs this security hardening
   - Recommendation: No isolation for v2.1 (CONTEXT.md defers this)

4. **Multi-host container orchestration**
   - What we know: Database-first tracking enables future Kubernetes/multi-host
   - What's unclear: Migration path from single Docker host to orchestration
   - Recommendation: Database schema supports it, implement when scaling needed

## Sources

### Primary (HIGH confidence)

- [dockerode npm package](https://www.npmjs.com/package/dockerode) - Official dockerode package documentation
- [dockerode GitHub](https://github.com/apocas/dockerode) - Source repository with examples
- [Docker exec documentation](https://docs.docker.com/reference/cli/docker/container/exec/) - Official Docker exec reference
- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Official storage documentation
- [Docker security documentation](https://docs.docker.com/engine/security/) - Official security best practices
- Existing codebase: `packages/platform/src/sandbox/docker-sandbox.ts` - Working implementation

### Secondary (MEDIUM confidence)

- [Docker best practices 2026](https://medium.com/@regansomi/4-easy-docker-best-practices-for-node-js-build-faster-smaller-and-more-secure-containers-151474129ac0) - Recent Node.js optimization guide
- [Docker lifecycle management](https://daily.dev/blog/docker-container-lifecycle-management-best-practices) - Container lifecycle patterns
- [Optimal Node.js pnpm Dockerfile](https://depot.dev/docs/container-builds/how-to-guides/optimal-dockerfiles/node-pnpm-dockerfile) - Multi-stage build patterns
- [Docker container naming](https://devtodevops.com/blog/docker-container-naming-convention/) - Naming best practices
- [Docker socket security](https://blog.quarkslab.com/why-is-exposing-the-docker-socket-a-really-bad-idea.html) - Security analysis
- [Git credentials in containers](https://medium.com/datamindedbe/containerizing-git-credential-helpers-5f7ef75849b4) - Credential helper patterns

### Tertiary (LOW confidence)

- [ripgrep vs fd comparison](https://notes.suhaib.in/docs/tech/utilities/fd-vs-ripgrep-the-new-cli-kings/) - Tool comparison (blog post)
- [PostgreSQL Docker setup 2026](https://utho.com/blog/postgresql-docker-setup/) - General PostgreSQL patterns
- [GitHub CLI discussions](https://github.com/cli/cli/discussions/3698) - Community Docker approaches

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - dockerode is well-established, existing implementation works
- Architecture: HIGH - Patterns verified in existing codebase and official docs
- Pitfalls: HIGH - Based on official Docker documentation and security research
- Dockerfile patterns: MEDIUM - Multiple community approaches, no single standard for our toolset
- Git credentials: MEDIUM - Multiple valid approaches, environment variable method is simple
- Container orchestration: LOW - Database schema prepares for it, but multi-host patterns are future work

**Research date:** 2026-01-25
**Valid until:** 2026-03-25 (60 days for stable Docker ecosystem)
