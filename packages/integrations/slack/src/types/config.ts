import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Load environment variables
dotenvFlow.config({ silent: true });

/**
 * Slack integration environment schema
 * Self-contained validation for Slack-specific environment variables
 *
 * Supports two operational modes:
 * - "socket": Uses Slack Socket Mode (requires SLACK_APP_TOKEN)
 * - "http": Uses HTTP webhook receiver (requires SLACK_SIGNING_SECRET)
 */
export const slackEnvSchema = z
  .object({
    // Server
    PORT: z.coerce.number().default(3003),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // Slack Mode
    SLACK_MODE: z.enum(["socket", "http"]).default("socket"),

    // Slack App Credentials
    SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
    SLACK_APP_TOKEN: z.string().optional(), // Required for socket mode (xapp-...)
    SLACK_SIGNING_SECRET: z.string().min(1, "SLACK_SIGNING_SECRET is required"),

    // Slack OAuth
    SLACK_CLIENT_ID: z.string().min(1, "SLACK_CLIENT_ID is required"),
    SLACK_CLIENT_SECRET: z.string().min(1, "SLACK_CLIENT_SECRET is required"),
    SLACK_STATE_SECRET: z.string().optional(), // For OAuth state validation
    OAUTH_CALLBACK_URL: z.string().url().optional(),

    // Database
    DB_HOST: z.string().default("localhost"),
    DB_PORT: z.coerce.number().default(5432),
    DB_USER: z.string().default("temporal"),
    DB_PASSWORD: z.string().default("temporal"),
    DB_NAME: z.string().default("temporal"),
    CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),
  })
  .superRefine((data, ctx) => {
    // Validate socket mode requires app token
    if (data.SLACK_MODE === "socket" && !data.SLACK_APP_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "SLACK_APP_TOKEN is required when SLACK_MODE is 'socket'. Get it from Slack App Settings > Basic Information > App-Level Tokens.",
        path: ["SLACK_APP_TOKEN"],
      });
    }
  });

export type SlackEnv = z.infer<typeof slackEnvSchema>;

/**
 * Raw environment variables (parsed)
 */
export const env = slackEnvSchema.parse(process.env);

/**
 * Typed nested config object
 */
export const config = {
  server: {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    mode: env.SLACK_MODE,
  },
  slack: {
    botToken: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    stateSecret: env.SLACK_STATE_SECRET,
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

export type SlackServiceConfig = typeof config;
