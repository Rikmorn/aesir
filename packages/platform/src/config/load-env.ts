/**
 * Monorepo-aware environment loader
 *
 * Solves the problem where dotenv-flow looks for .env relative to process.cwd(),
 * which fails when running scripts from package directories via pnpm --filter.
 *
 * Usage in scripts:
 *   import { loadEnvFromRoot } from "@aesir/platform";
 *   loadEnvFromRoot(); // Must be called before accessing process.env
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenvFlow from "dotenv-flow";

/**
 * Find the monorepo root by walking up from the current directory
 * looking for pnpm-workspace.yaml (the definitive marker).
 */
function findMonorepoRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  const root = dirname(current);

  while (current !== root) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = dirname(current);
  }

  // Fallback: try to find it relative to this file's location
  // This handles cases where the script is run from an unexpected directory
  const thisFile = fileURLToPath(import.meta.url);
  const platformDir = dirname(dirname(dirname(thisFile))); // src/config -> src -> platform
  const packagesDir = dirname(platformDir); // platform -> packages
  const repoRoot = dirname(packagesDir); // packages -> root

  if (existsSync(join(repoRoot, "pnpm-workspace.yaml"))) {
    return repoRoot;
  }

  throw new Error(
    "Could not find monorepo root. Expected pnpm-workspace.yaml to exist.",
  );
}

/**
 * Load environment variables from the monorepo root.
 *
 * Call this at the top of scripts before accessing process.env.
 * Safe to call multiple times (dotenv-flow won't override existing vars).
 *
 * @returns The monorepo root path for reference
 */
export function loadEnvFromRoot(): string {
  const root = findMonorepoRoot();

  dotenvFlow.config({
    path: root,
    silent: true,
    default_node_env: "development",
  });

  return root;
}

/**
 * Get the monorepo root path without loading env vars.
 * Useful when you need the path for other purposes.
 */
export function getMonorepoRoot(): string {
  return findMonorepoRoot();
}
