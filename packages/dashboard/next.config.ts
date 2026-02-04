import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // CRITICAL for monorepo: tells Next.js to trace dependencies from the monorepo root
  // Without this, workspace:* packages won't be copied into .next/standalone
  outputFileTracingRoot: path.join(currentDir, "../../"),
  // Sub-path routing for Nginx reverse proxy
  basePath: "/dashboard",
  // Biome handles linting, not ESLint
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Keep type safety -- typecheck runs separately
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
