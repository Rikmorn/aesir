/**
 * Docker-based Sandbox Implementation
 *
 * Executes commands in isolated Docker containers with resource limits.
 * Uses Dockerode for container management.
 */

import * as path from "node:path";
import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import type { Container } from "dockerode";
import Docker from "dockerode";
import * as tar from "tar-stream";
import type { ExecutionResult, Sandbox, TestResult } from "./types.js";

/**
 * Configuration options for DockerSandbox
 */
export interface DockerSandboxOptions {
  /** Docker image to use (default: 'node:20-slim') */
  image?: string;
  /** Memory limit in bytes (default: 512MB) */
  memoryLimit?: number;
  /** CPU quota (default: 50000 = 50%) */
  cpuQuota?: number;
  /** Docker client instance (for testing) */
  docker?: Docker;
  /** Logger instance (optional) */
  logger?: PinoLogger;
}

/**
 * Default configuration values
 */
const DEFAULTS = {
  image: "node:20-slim",
  memoryLimit: 512 * 1024 * 1024, // 512MB
  cpuQuota: 50000, // 50% CPU
  stopTimeout: 10, // 10 seconds graceful shutdown
} as const;

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
  private readonly container: Container;
  private readonly logger: PinoLogger;
  private isCleanedUp = false;

  private constructor(container: Container, logger: PinoLogger) {
    this.container = container;
    this.logger = logger;
  }

  /**
   * Create a new DockerSandbox instance.
   *
   * This is the preferred way to create a sandbox as it handles
   * container creation and startup asynchronously.
   */
  static async create(
    options: DockerSandboxOptions = {},
  ): Promise<DockerSandbox> {
    const docker = options.docker ?? new Docker();
    const logger =
      options.logger ?? createPinoLogger({ component: "platform:sandbox" });

    const image = options.image ?? DEFAULTS.image;
    const memoryLimit = options.memoryLimit ?? DEFAULTS.memoryLimit;
    const cpuQuota = options.cpuQuota ?? DEFAULTS.cpuQuota;

    logger.info({ image }, `Creating container with image ${image}`);

    const container = await docker.createContainer({
      Image: image,
      Tty: false, // Required for demuxing stdout/stderr
      Cmd: ["sleep", "infinity"], // Keep container running
      HostConfig: {
        AutoRemove: false, // Manual cleanup for error handling
        Memory: memoryLimit,
        CpuQuota: cpuQuota,
      },
    });

    await container.start();
    logger.info(
      { containerId: container.id.slice(0, 12) },
      `Container ${container.id.slice(0, 12)} started`,
    );

    return new DockerSandbox(container, logger);
  }

  /**
   * Execute a shell command in the sandbox.
   *
   * @param command - Array of command + arguments (e.g., ['npm', 'install'])
   * @returns Execution result with stdout, stderr, and exit code
   */
  async execute(command: string[]): Promise<ExecutionResult> {
    if (this.isCleanedUp) {
      throw new Error("Sandbox has been cleaned up");
    }

    const startTime = performance.now();
    const commandStr = command.join(" ");

    try {
      const exec = await this.container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false, // Required for demuxing
      });

      const stream = await exec.start({ Detach: false });

      const result = await new Promise<ExecutionResult>((resolve, reject) => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        // Demux stdout/stderr when Tty: false
        this.container.modem.demuxStream(
          stream,
          { write: (chunk: Buffer) => stdout.push(chunk.toString()) },
          { write: (chunk: Buffer) => stderr.push(chunk.toString()) },
        );

        stream.on("end", async () => {
          try {
            const inspect = await exec.inspect();
            resolve({
              exitCode: inspect.ExitCode ?? 1,
              stdout: stdout.join(""),
              stderr: stderr.join(""),
            });
          } catch (err) {
            reject(err);
          }
        });

        stream.on("error", reject);
      });

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        { command: commandStr, exitCode: result.exitCode, durationMs },
        "Container exec completed",
      );
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        { err: error, command: commandStr, durationMs },
        "Container exec failed",
      );
      throw error;
    }
  }

  /**
   * Write a file to the sandbox filesystem.
   *
   * Uses Docker's putArchive API with tar format for efficient file transfer.
   *
   * @param filePath - Absolute path in the sandbox (e.g., '/app/index.ts')
   * @param content - File content (string)
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (this.isCleanedUp) {
      throw new Error("Sandbox has been cleaned up");
    }

    const startTime = performance.now();

    try {
      const fileName = path.basename(filePath);
      const dirName = path.dirname(filePath);

      // Create tar archive with single file
      const pack = tar.pack();
      pack.entry({ name: fileName }, content);
      pack.finalize();

      // Write tar archive to container
      await this.container.putArchive(pack, { path: dirName });

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        { path: filePath, durationMs },
        "File written to container",
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        { err: error, path: filePath, durationMs },
        "File write failed",
      );
      throw error;
    }
  }

  /**
   * Read a file from the sandbox filesystem.
   *
   * Uses Docker's getArchive API which returns tar format.
   * Extracts the file content from the tar stream.
   *
   * @param filePath - Absolute path in the sandbox
   * @returns File content as string
   * @throws Error if file does not exist
   */
  async readFile(filePath: string): Promise<string> {
    if (this.isCleanedUp) {
      throw new Error("Sandbox has been cleaned up");
    }

    const startTime = performance.now();

    try {
      const stream = await this.container.getArchive({ path: filePath });

      // Extract file content from tar stream
      const content = await this.extractFileFromTar(stream);

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        { path: filePath, durationMs },
        "File read from container",
      );
      return content;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        { err: error, path: filePath, durationMs },
        "File read failed",
      );
      throw error;
    }
  }

  /**
   * Extract file content from a tar stream.
   * @internal
   */
  private extractFileFromTar(
    tarStream: NodeJS.ReadableStream,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const extract = tar.extract();
      const chunks: Buffer[] = [];

      extract.on("entry", (_header, stream, next) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", next);
        stream.resume();
      });

      extract.on("finish", () => {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });

      extract.on("error", reject);
      tarStream.on("error", reject);

      tarStream.pipe(extract);
    });
  }

  /**
   * Run tests in the sandbox.
   *
   * Wraps execute() with test-specific result parsing.
   * A test run is considered passing if exitCode === 0.
   *
   * @param command - Test command (e.g., ['npm', 'test'])
   * @returns TestResult with passed boolean and summary
   */
  async runTests(command: string[]): Promise<TestResult> {
    const result = await this.execute(command);

    return {
      ...result,
      passed: result.exitCode === 0,
      summary:
        result.exitCode === 0
          ? "All tests passed"
          : `Tests failed with exit code ${result.exitCode}`,
    };
  }

  /**
   * Clean up sandbox resources. Must be called when done.
   *
   * Uses graceful shutdown with timeout, then force kills if needed.
   * Safe to call multiple times.
   */
  async cleanup(): Promise<void> {
    if (this.isCleanedUp) {
      return;
    }

    const startTime = performance.now();
    const containerId = this.container.id.slice(0, 12);

    try {
      // Try graceful stop first
      try {
        await this.container.stop({ t: DEFAULTS.stopTimeout });
      } catch {
        // Force kill if graceful stop fails
        await this.container.kill();
      }

      await this.container.remove();
      this.isCleanedUp = true;

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        { containerId, durationMs },
        "Container cleanup completed",
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        { err: error, containerId, durationMs },
        "Container cleanup failed",
      );
      throw error;
    }
  }
}
