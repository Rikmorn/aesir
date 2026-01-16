/**
 * Docker-based Sandbox Implementation
 *
 * Executes commands in isolated Docker containers with resource limits.
 * Uses Dockerode for container management.
 */

import Docker from "dockerode"
import type { Container } from "dockerode"
import { createLogger, type Logger } from "../logging/logger.js"
import type { Sandbox, ExecutionResult, TestResult } from "./types.js"

/**
 * Configuration options for DockerSandbox
 */
export interface DockerSandboxOptions {
  /** Docker image to use (default: 'node:20-slim') */
  image?: string
  /** Memory limit in bytes (default: 512MB) */
  memoryLimit?: number
  /** CPU quota (default: 50000 = 50%) */
  cpuQuota?: number
  /** Docker client instance (for testing) */
  docker?: Docker
  /** Logger instance (optional) */
  logger?: Logger
}

/**
 * Default configuration values
 */
const DEFAULTS = {
  image: "node:20-slim",
  memoryLimit: 512 * 1024 * 1024, // 512MB
  cpuQuota: 50000, // 50% CPU
  stopTimeout: 10, // 10 seconds graceful shutdown
} as const

/**
 * DockerSandbox provides isolated code execution in Docker containers.
 *
 * Implements the Sandbox interface for local development and testing.
 * For production use with untrusted code, consider E2B (Firecracker microVMs).
 *
 * @example
 * ```typescript
 * const sandbox = await DockerSandbox.create()
 * try {
 *   const result = await sandbox.execute(['echo', 'hello'])
 *   console.log(result.stdout) // 'hello\n'
 * } finally {
 *   await sandbox.cleanup()
 * }
 * ```
 */
export class DockerSandbox implements Sandbox {
  private readonly container: Container
  private readonly logger: Logger
  private isCleanedUp = false

  private constructor(container: Container, logger: Logger) {
    this.container = container
    this.logger = logger
  }

  /**
   * Create a new DockerSandbox instance.
   *
   * This is the preferred way to create a sandbox as it handles
   * container creation and startup asynchronously.
   */
  static async create(options: DockerSandboxOptions = {}): Promise<DockerSandbox> {
    const docker = options.docker ?? new Docker()
    const logger = options.logger ?? createLogger({ defaultContext: { component: "DockerSandbox" } })

    const image = options.image ?? DEFAULTS.image
    const memoryLimit = options.memoryLimit ?? DEFAULTS.memoryLimit
    const cpuQuota = options.cpuQuota ?? DEFAULTS.cpuQuota

    logger.info("container_create", { message: `Creating container with image ${image}` })

    const container = await docker.createContainer({
      Image: image,
      Tty: false, // Required for demuxing stdout/stderr
      Cmd: ["sleep", "infinity"], // Keep container running
      HostConfig: {
        AutoRemove: false, // Manual cleanup for error handling
        Memory: memoryLimit,
        CpuQuota: cpuQuota,
      },
    })

    await container.start()
    logger.info("container_start", { message: `Container ${container.id.slice(0, 12)} started`, outcome: "success" })

    return new DockerSandbox(container, logger)
  }

  /**
   * Execute a shell command in the sandbox.
   *
   * @param command - Array of command + arguments (e.g., ['npm', 'install'])
   * @returns Execution result with stdout, stderr, and exit code
   */
  async execute(command: string[]): Promise<ExecutionResult> {
    if (this.isCleanedUp) {
      throw new Error("Sandbox has been cleaned up")
    }

    const timedLog = this.logger.startTimer("container_exec", {
      context: { command: command.join(" ") },
    })

    try {
      const exec = await this.container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false, // Required for demuxing
      })

      const stream = await exec.start({ Detach: false })

      const result = await new Promise<ExecutionResult>((resolve, reject) => {
        const stdout: string[] = []
        const stderr: string[] = []

        // Demux stdout/stderr when Tty: false
        this.container.modem.demuxStream(
          stream,
          { write: (chunk: Buffer) => stdout.push(chunk.toString()) },
          { write: (chunk: Buffer) => stderr.push(chunk.toString()) }
        )

        stream.on("end", async () => {
          try {
            const inspect = await exec.inspect()
            resolve({
              exitCode: inspect.ExitCode ?? 1,
              stdout: stdout.join(""),
              stderr: stderr.join(""),
            })
          } catch (err) {
            reject(err)
          }
        })

        stream.on("error", reject)
      })

      timedLog.success({ context: { exitCode: result.exitCode } })
      return result
    } catch (error) {
      timedLog.failure({ message: String(error) })
      throw error
    }
  }

  /**
   * Write a file to the sandbox filesystem.
   * @param _path - Absolute path in the sandbox
   * @param _content - File content (string)
   */
  async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error("Not implemented - see plan 02-02")
  }

  /**
   * Read a file from the sandbox filesystem.
   * @param _path - Absolute path in the sandbox
   */
  async readFile(_path: string): Promise<string> {
    throw new Error("Not implemented - see plan 02-02")
  }

  /**
   * Run tests in the sandbox.
   * @param _command - Test command (e.g., ['npm', 'test'])
   */
  async runTests(_command: string[]): Promise<TestResult> {
    throw new Error("Not implemented - see plan 02-02")
  }

  /**
   * Clean up sandbox resources. Must be called when done.
   *
   * Uses graceful shutdown with timeout, then force kills if needed.
   * Safe to call multiple times.
   */
  async cleanup(): Promise<void> {
    if (this.isCleanedUp) {
      return
    }

    const timedLog = this.logger.startTimer("container_cleanup", {
      context: { containerId: this.container.id.slice(0, 12) },
    })

    try {
      // Try graceful stop first
      try {
        await this.container.stop({ t: DEFAULTS.stopTimeout })
      } catch {
        // Force kill if graceful stop fails
        await this.container.kill()
      }

      await this.container.remove()
      this.isCleanedUp = true
      timedLog.success()
    } catch (error) {
      timedLog.failure({ message: String(error) })
      throw error
    }
  }
}
