/**
 * GitHub Integration Configuration
 *
 * Provides type-safe environment configuration for the GitHub integration.
 *
 * IMPORTANT: Validation is EAGER - it runs immediately at module load.
 * This ensures fail-fast behavior with clear error messages at service startup.
 */

import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Load environment variables immediately
dotenvFlow.config({ silent: true, default_node_env: "development" });

/**
 * GitHub integration environment schema
 * Self-contained validation for GitHub-specific environment variables
 */
export const githubEnvSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // GitHub OAuth
  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID is required"),
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET is required"),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  GITHUB_OAUTH_CALLBACK_URL: z.string().url().optional(),

  // Database - use DB_* names (standard for all services)
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("temporal"),
  DB_PASSWORD: z.string().default("temporal"),
  DB_NAME: z.string().default("temporal"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),
});

export type GitHubEnv = z.infer<typeof githubEnvSchema>;

// Parse and validate immediately at module load
const result = githubEnvSchema.safeParse(process.env);

if (!result.success) {
  // biome-ignore lint/suspicious/noConsole: Intentional startup error output
  console.error("\n[X] GitHub environment validation failed:\n");
  const fieldErrors = result.error.flatten().fieldErrors;
  for (const [field, errors] of Object.entries(fieldErrors)) {
    if (errors && errors.length > 0) {
      // biome-ignore lint/suspicious/noConsole: Intentional startup error output
      console.error(`  - ${field}: ${errors.join(", ")}`);
    }
  }
  // biome-ignore lint/suspicious/noConsole: Intentional startup error output
  console.error("\nCheck your .env files or environment variables.\n");
  process.exit(1);
}

/**
 * Raw environment variables (eagerly validated)
 * Safe to access - validation already passed.
 */
export const env = result.data;

/**
 * Typed nested config object (eagerly built)
 * Safe to access - validation already passed.
 */
export const config = {
  server: {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
  },
  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    oauthCallbackUrl: env.GITHUB_OAUTH_CALLBACK_URL,
  },
  database: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    name: env.DB_NAME,
    encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
} as const;

export type GitHubServiceConfig = typeof config;
