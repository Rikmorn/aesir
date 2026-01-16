/**
 * Sandbox Interface Types
 *
 * Defines the contract for isolated code execution environments.
 * Implementations can be Docker (local), E2B (cloud), or others.
 */

/**
 * Result of executing a command in the sandbox.
 */
export interface ExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Result of running tests, extends ExecutionResult with test-specific fields.
 */
export interface TestResult extends ExecutionResult {
  passed: boolean
  summary: string
}

/**
 * Sandbox provides isolated code execution.
 *
 * Implementations can be Docker (local), E2B (cloud), or others.
 * Agent code depends on this interface, not concrete implementations.
 */
export interface Sandbox {
  /**
   * Execute a shell command in the sandbox.
   * @param command - Array of command + arguments (e.g., ['npm', 'install'])
   */
  execute(command: string[]): Promise<ExecutionResult>

  /**
   * Write a file to the sandbox filesystem.
   * @param path - Absolute path in the sandbox
   * @param content - File content (string)
   */
  writeFile(path: string, content: string): Promise<void>

  /**
   * Read a file from the sandbox filesystem.
   * @param path - Absolute path in the sandbox
   */
  readFile(path: string): Promise<string>

  /**
   * Run tests in the sandbox.
   * @param command - Test command (e.g., ['npm', 'test'])
   */
  runTests(command: string[]): Promise<TestResult>

  /**
   * Clean up sandbox resources. Must be called when done.
   */
  cleanup(): Promise<void>
}
