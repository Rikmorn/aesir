/**
 * Credential Test Factories
 *
 * Creates deterministic test credentials for Linear, GitHub, and Slack.
 * Uses incrementing counters for predictable test assertions.
 */

export interface TestCredential {
  id: string;
  workspaceId: string;
  provider: "linear" | "github" | "slack";
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let credentialCounter = 0;

export interface CreateTestCredentialOptions {
  id?: string;
  workspaceId?: string;
  provider?: "linear" | "github" | "slack";
  accessToken?: string;
  refreshToken?: string | null;
  tokenType?: string;
  scope?: string | null;
  expiresAt?: Date | null;
}

export function createTestCredential(
  options: CreateTestCredentialOptions = {},
): TestCredential {
  const num = credentialCounter++;

  return {
    id: options.id ?? `test_cred_${num}`,
    workspaceId: options.workspaceId ?? "ws_test",
    provider: options.provider ?? "linear",
    accessToken: options.accessToken ?? `test_token_${num}`,
    refreshToken: options.refreshToken ?? null,
    tokenType: options.tokenType ?? "Bearer",
    scope: options.scope ?? null,
    expiresAt: options.expiresAt ?? null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

/**
 * Reset the credential counter for test isolation.
 * Call this in beforeEach() to ensure consistent IDs across test runs.
 */
export function resetCredentialCounter(): void {
  credentialCounter = 0;
}
