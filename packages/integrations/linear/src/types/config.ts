import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Load environment variables
dotenvFlow.config({ silent: true });

/**
 * Linear integration environment schema
 * Self-contained validation for Linear-specific environment variables
 */
export const linearEnvSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Linear OAuth
  LINEAR_CLIENT_ID: z.string().min(1, "LINEAR_CLIENT_ID is required"),
  LINEAR_CLIENT_SECRET: z.string().min(1, "LINEAR_CLIENT_SECRET is required"),
  LINEAR_WEBHOOK_SECRET: z.string().min(1, "LINEAR_WEBHOOK_SECRET is required"),
  OAUTH_CALLBACK_URL: z.string().url().optional(),

  // Database
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("temporal"),
  DB_PASSWORD: z.string().default("temporal"),
  DB_NAME: z.string().default("temporal"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),
});

export type LinearEnv = z.infer<typeof linearEnvSchema>;

/**
 * Raw environment variables (parsed)
 */
export const env = linearEnvSchema.parse(process.env);

/**
 * Typed nested config object
 */
export const config = {
  server: {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
  },
  linear: {
    clientId: env.LINEAR_CLIENT_ID,
    clientSecret: env.LINEAR_CLIENT_SECRET,
    webhookSecret: env.LINEAR_WEBHOOK_SECRET,
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

export type LinearConfig = typeof config;
