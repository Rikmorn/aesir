/**
 * Linear Client Types
 *
 * Type definitions for Linear OAuth configuration and client creation.
 */

/**
 * OAuth configuration for Linear API access
 */
export interface LinearConfig {
  /** OAuth access token for API calls */
  accessToken: string;
  /** OAuth refresh token for token renewal (may be absent if Linear didn't provide one) */
  refreshToken?: string;
  /** Token expiration timestamp (milliseconds since epoch) */
  expiresAt: number;
}
