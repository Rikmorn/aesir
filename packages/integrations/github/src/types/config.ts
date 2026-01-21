import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Load environment variables
dotenvFlow.config({ silent: true });

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
  OAUTH_CALLBACK_URL: z.string().url().optional(),

  // Database
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("temporal"),
  DB_PASSWORD: z.string().default("temporal"),
  DB_NAME: z.string().default("temporal"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),
});

export type GitHubEnv = z.infer<typeof githubEnvSchema>;

/**
 * Raw environment variables (parsed)
 */
export const env = githubEnvSchema.parse(process.env);

/**
 * Typed nested config object
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
    oauthCallbackUrl: env.OAUTH_CALLBACK_URL,
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
