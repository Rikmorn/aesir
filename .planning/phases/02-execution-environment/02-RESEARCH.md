# Phase 2: Execution Environment - Research

**Researched:** 2026-01-16
**Domain:** Docker container execution for sandboxed agent code
**Confidence:** HIGH

<research_summary>
## Summary

Researched the Node.js Docker ecosystem for sandboxed code execution. The standard approach uses Dockerode for container management with @types/dockerode for TypeScript support. The library remains dominant (2M+ weekly downloads) despite a new official @docker/node-sdk (still experimental at v0.0.17).

Key finding: Docker containers provide practical sandboxing for MVP but are not fully secure (shared kernel). For true isolation, consider E2B (Firecracker microVMs) as a future migration path. The context requirement to abstract behind a `Sandbox` interface is sound architecture.

**Primary recommendation:** Use Dockerode + @types/dockerode for MVP. Abstract behind interface per CONTEXT.md. Plan migration to E2B when scale/security needs increase.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| dockerode | 4.0.x | Docker API client | 2M weekly downloads, battle-tested, comprehensive API |
| @types/dockerode | 3.3.47 | TypeScript definitions | Well-maintained, tracks Dockerode closely |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tar-fs | 3.0.x | Create/extract tar archives | File sync in/out of containers |
| tar-stream | 3.1.x | Streaming tar operations | Large file handling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| dockerode | @docker/node-sdk | Official SDK but v0.0.17 experimental, incomplete API coverage |
| dockerode | node-docker-api | 87K downloads vs 2M, less maintained |
| Docker | E2B | Cloud-based, Firecracker microVMs, better security, but adds vendor dependency and cost |

**Installation:**
```bash
npm install dockerode @types/dockerode tar-fs
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Interface Pattern
```typescript
// Abstract sandbox behind interface for future migration
interface Sandbox {
  execute(command: string[]): Promise<ExecutionResult>
  writeFile(path: string, content: string): Promise<void>
  readFile(path: string): Promise<string>
  runTests(testCommand: string[]): Promise<TestResult>
  cleanup(): Promise<void>
}

interface ExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface TestResult extends ExecutionResult {
  passed: boolean
  summary: string
}
```

### Pattern 1: Container Exec with Output Capture
**What:** Execute commands in container and capture stdout/stderr separately
**When to use:** Running any command (npm install, tests, builds)
**Example:**
```typescript
// Source: Dockerode docs + community patterns
import Docker from 'dockerode'

async function execInContainer(
  container: Docker.Container,
  cmd: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false, // Required for demuxing
  })

  const stream = await exec.start({ Detach: false })

  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    // Demux stdout/stderr when Tty: false
    container.modem.demuxStream(
      stream,
      { write: (chunk: Buffer) => stdout.push(chunk) },
      { write: (chunk: Buffer) => stderr.push(chunk) }
    )

    stream.on('end', async () => {
      const inspect = await exec.inspect()
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        exitCode: inspect.ExitCode ?? 1,
      })
    })

    stream.on('error', reject)
  })
}
```

### Pattern 2: Tar-based File Transfer
**What:** Use tar streams for file I/O (Docker's native protocol)
**When to use:** Getting code into container, extracting results
**Example:**
```typescript
// Source: Docker API docs
import tar from 'tar-fs'
import { Readable } from 'stream'

// Write files to container
async function writeToContainer(
  container: Docker.Container,
  localPath: string,
  containerPath: string
): Promise<void> {
  const tarStream = tar.pack(localPath)
  await container.putArchive(tarStream, { path: containerPath })
}

// Read files from container
async function readFromContainer(
  container: Docker.Container,
  containerPath: string
): Promise<Buffer> {
  const stream = await container.getArchive({ path: containerPath })
  // Extract and return file contents
  return extractTarFile(stream)
}
```

### Pattern 3: Container Lifecycle Management
**What:** Create, use, and cleanup containers reliably
**When to use:** Every sandbox session
**Example:**
```typescript
async function withContainer<T>(
  docker: Docker,
  image: string,
  fn: (container: Docker.Container) => Promise<T>
): Promise<T> {
  const container = await docker.createContainer({
    Image: image,
    Tty: false,
    HostConfig: {
      AutoRemove: false, // Manual cleanup for error handling
      Memory: 512 * 1024 * 1024, // 512MB limit
      CpuQuota: 50000, // 50% CPU
    },
  })

  try {
    await container.start()
    return await fn(container)
  } finally {
    try {
      await container.stop({ t: 10 }) // 10s graceful shutdown
    } catch {
      await container.kill() // Force if needed
    }
    await container.remove()
  }
}
```

### Anti-Patterns to Avoid
- **Using Node.js VM module for sandboxing:** Trivially escapable, not secure
- **Shell form CMD in Dockerfile:** Prevents signal handling, use exec form
- **Tty: true for programmatic exec:** Prevents stdout/stderr demuxing
- **Not setting resource limits:** Runaway code can exhaust host resources
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Docker API client | HTTP client wrapper | dockerode | Handles streams, auth, versioning, modem layer |
| Tar packing/unpacking | Manual tar implementation | tar-fs / tar-stream | Edge cases, compression, permissions |
| stdout/stderr demux | Custom buffer parsing | container.modem.demuxStream | Docker's multiplexed stream format is complex |
| Container process isolation | VM module sandbox | Docker containers | VM module is trivially escapable |
| Graceful shutdown | Manual signal handling | Docker stop with timeout | Handles SIGTERM → wait → SIGKILL |

**Key insight:** Docker's API is well-defined but has complex stream handling, tar protocols, and lifecycle management. Dockerode abstracts these correctly.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: stdout/stderr Mixing
**What goes wrong:** Output appears interleaved or corrupted
**Why it happens:** Using `Tty: true` which combines streams
**How to avoid:** Always use `Tty: false` and `demuxStream()`
**Warning signs:** Binary garbage in output, missing stderr

### Pitfall 2: Zombie Containers
**What goes wrong:** Containers accumulate, exhausting resources
**Why it happens:** Not cleaning up on errors, missing finally blocks
**How to avoid:** Use try/finally pattern, consider `AutoRemove: true` for simple cases
**Warning signs:** `docker ps -a` shows many stopped containers

### Pitfall 3: Resource Exhaustion
**What goes wrong:** Host becomes unresponsive during agent execution
**Why it happens:** No memory/CPU limits, infinite loops in generated code
**How to avoid:** Set `Memory` and `CpuQuota` in HostConfig
**Warning signs:** High host CPU/memory during agent runs

### Pitfall 4: Signal Handling Failure
**What goes wrong:** Container takes 30s+ to stop
**Why it happens:** CMD uses shell form, blocking SIGTERM
**How to avoid:** Use exec form `CMD ["node", "app.js"]` in Dockerfile
**Warning signs:** Containers always killed after timeout

### Pitfall 5: Security Overconfidence
**What goes wrong:** Assuming Docker = full isolation
**Why it happens:** Docker uses shared kernel (LXC containers)
**How to avoid:** Treat as defense-in-depth, not security boundary. For true isolation, use gVisor or Firecracker (E2B).
**Warning signs:** Running untrusted code without additional safeguards
</common_pitfalls>

<code_examples>
## Code Examples

### Basic Dockerode Setup
```typescript
// Source: Dockerode README
import Docker from 'dockerode'

const docker = new Docker() // Uses DOCKER_HOST or socket
// Or explicit: new Docker({ socketPath: '/var/run/docker.sock' })
```

### Run Command and Capture Output
```typescript
// Source: Dockerode issues #332, #734
async function runCommand(
  container: Docker.Container,
  cmd: string[]
): Promise<ExecutionResult> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  })

  return new Promise((resolve, reject) => {
    exec.start({}, (err, stream) => {
      if (err) return reject(err)
      if (!stream) return reject(new Error('No stream'))

      const stdout: string[] = []
      const stderr: string[] = []

      container.modem.demuxStream(
        stream,
        { write: (d: Buffer) => stdout.push(d.toString()) },
        { write: (d: Buffer) => stderr.push(d.toString()) }
      )

      stream.on('end', async () => {
        const { ExitCode } = await exec.inspect()
        resolve({
          exitCode: ExitCode ?? 1,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        })
      })
    })
  })
}
```

### Test Execution Pattern
```typescript
// Run npm test and parse results
async function runTests(container: Docker.Container): Promise<TestResult> {
  const result = await runCommand(container, ['npm', 'test', '--', '--json'])

  return {
    ...result,
    passed: result.exitCode === 0,
    summary: result.exitCode === 0
      ? 'All tests passed'
      : `Tests failed with exit code ${result.exitCode}`,
  }
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| dockerode only option | @docker/node-sdk emerging | 2025 | Official SDK exists but experimental (v0.0.17) |
| Docker-only sandboxing | E2B / Firecracker microVMs | 2024+ | Better security isolation for AI agents |
| Manual container orchestration | Testcontainers patterns | 2023+ | Better testing lifecycle management |

**New tools/patterns to consider:**
- **E2B:** Cloud sandbox with Firecracker microVMs, <200ms start, purpose-built for AI agents. Good migration target when MVP proven.
- **gVisor:** Google's userspace kernel for container isolation. Adds overhead but better security.

**Deprecated/outdated:**
- **Node.js VM module for sandboxing:** Never use for untrusted code—trivially escapable
- **docker-run npm package:** Abandoned, use dockerode directly
</sota_updates>

<open_questions>
## Open Questions

1. **Base image selection**
   - What we know: Minimal images (Alpine, distroless) reduce attack surface
   - What's unclear: Best base for Node.js agent workloads (npm install speed vs size)
   - Recommendation: Start with `node:20-slim`, benchmark if needed

2. **Persistent workspace vs fresh containers**
   - What we know: Fresh containers are simpler and more secure
   - What's unclear: Performance impact of recreating for each task
   - Recommendation: Start fresh each task, add volume caching if slow
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [Dockerode GitHub](https://github.com/apocas/dockerode) - API patterns, stream handling
- [@types/dockerode npm](https://www.npmjs.com/package/@types/dockerode) - TypeScript support verification
- [Docker API docs](https://docs.docker.com/reference/cli/docker/container/) - Container lifecycle

### Secondary (MEDIUM confidence)
- [npm trends: dockerode vs alternatives](https://npmtrends.com/dockerode-vs-harbor-master-vs-node-docker-api) - Download statistics
- [E2B documentation](https://e2b.dev/docs) - Cloud sandbox alternative
- [Docker security practices](https://www.docker.com/blog/docker-for-node-js-developers-5-things-you-need-to-know-not-to-fail-your-security/) - Security patterns

### Tertiary (LOW confidence - needs validation)
- Community patterns from GitHub issues/discussions - Verified against docs
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Docker container execution via Node.js
- Ecosystem: Dockerode, tar-fs, E2B (alternative)
- Patterns: Container lifecycle, exec, file transfer, cleanup
- Pitfalls: Streams, resources, security

**Confidence breakdown:**
- Standard stack: HIGH - npm download data, active maintenance
- Architecture: HIGH - patterns from official docs and verified community usage
- Pitfalls: HIGH - documented issues, security research
- Code examples: HIGH - from Dockerode docs and verified patterns

**Research date:** 2026-01-16
**Valid until:** 2026-02-16 (30 days - Docker ecosystem stable)
</metadata>

---

*Phase: 02-execution-environment*
*Research completed: 2026-01-16*
*Ready for planning: yes*
