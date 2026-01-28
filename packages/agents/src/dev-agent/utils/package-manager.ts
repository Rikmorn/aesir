/**
 * Package Manager Detection Utility
 *
 * Detects the package manager used by a repository by checking:
 * 1. packageManager field in package.json (e.g., "yarn@4.0.0")
 * 2. Lock files (yarn.lock, pnpm-lock.yaml, package-lock.json)
 * 3. Falls back to npm if nothing detected
 */

import type { DevContainerManager } from "@aesir/platform";

export type PackageManager = "npm" | "yarn" | "pnpm";

interface DetectPackageManagerOptions {
  manager: DevContainerManager;
  taskId: string;
  workdir?: string;
}

/**
 * Detect the package manager for a repository in the sandbox
 */
export async function detectPackageManager(
  options: DetectPackageManagerOptions,
): Promise<PackageManager> {
  const { manager, taskId, workdir = "/workspace/repo" } = options;

  // Try to read package.json and check packageManager field
  const catResult = await manager.execute(taskId, {
    command: ["cat", "package.json"],
    workdir,
    timeoutMs: 5000,
  });

  if (catResult.exitCode === 0) {
    try {
      const packageJson = JSON.parse(catResult.stdout);

      // Check packageManager field (e.g., "yarn@4.0.0", "pnpm@8.0.0")
      if (packageJson.packageManager) {
        const pm = packageJson.packageManager.toLowerCase();
        if (pm.startsWith("yarn")) return "yarn";
        if (pm.startsWith("pnpm")) return "pnpm";
        if (pm.startsWith("npm")) return "npm";
      }
    } catch {
      // JSON parse failed, continue to lock file detection
    }
  }

  // Fall back to lock file detection
  const lockFileChecks = [
    { file: "yarn.lock", pm: "yarn" as const },
    { file: "pnpm-lock.yaml", pm: "pnpm" as const },
    { file: "package-lock.json", pm: "npm" as const },
  ];

  for (const { file, pm } of lockFileChecks) {
    const checkResult = await manager.execute(taskId, {
      command: ["test", "-f", file],
      workdir,
      timeoutMs: 2000,
    });

    if (checkResult.exitCode === 0) {
      return pm;
    }
  }

  // Default to npm
  return "npm";
}

/**
 * Get the test command for a package manager
 */
export function getTestCommand(
  pm: PackageManager,
  testFiles?: string[],
): string[] {
  const base = pm === "npm" ? ["npm", "test"] : [pm, "test"];

  if (testFiles && testFiles.length > 0) {
    // npm uses -- to pass args, yarn and pnpm do too for consistency
    return [...base, "--", ...testFiles];
  }

  return base;
}

/**
 * Get the lint command for a package manager
 */
export function getLintCommand(pm: PackageManager): string[] {
  if (pm === "npm") {
    return ["npm", "run", "lint"];
  }
  return [pm, "lint"];
}
