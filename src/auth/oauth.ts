/**
 * OAuth 2.0 authentication provider for Azure DevOps.
 * Implements authorization code flow with automatic token refresh.
 *
 * Required env vars: ADO_CLIENT_ID, ADO_CLIENT_SECRET, ADO_TENANT_ID
 * Optional env var:  ADO_AUTH_CODE (authorization code for initial exchange)
 *                    ADO_OAUTH_REDIRECT_URI (default: http://localhost/callback)
 *
 * Minimum Azure AD app permissions: Azure DevOps user_impersonation
 */

import type { AuthProvider } from "./types.js";
import { AuthenticationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

// Azure DevOps app resource ID — used as OAuth scope
const ADO_SCOPE = "499b84ac-1321-427f-aa17-267ca6975798/.default";
const DEFAULT_REDIRECT_URI = "http://localhost/callback";
// Refresh token 30 s before actual expiry to avoid clock-skew races
const TOKEN_REFRESH_BUFFER_MS = 30_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface CachedToken {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry in milliseconds (Date.now() epoch) */
  expiresAt: number;
}

export class OAuthAuthProvider implements AuthProvider {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tenantId: string;
  private readonly tokenEndpoint: string;
  private cache: CachedToken | null = null;

  constructor(clientId: string, clientSecret: string, tenantId: string) {
    if (!clientId.trim() || !clientSecret.trim() || !tenantId.trim()) {
      throw new AuthenticationError(
        "OAuth requires ADO_CLIENT_ID, ADO_CLIENT_SECRET, and ADO_TENANT_ID",
      );
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tenantId = tenantId;
    this.tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  }

  async getAuthHeader(): Promise<string> {
    const token = await this.getValidToken();
    return `Bearer ${token}`;
  }

  /** Generates the Azure AD authorization URL for the initial user consent step. */
  getAuthorizationUrl(redirectUri = DEFAULT_REDIRECT_URI): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: ADO_SCOPE,
      response_mode: "query",
    });
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize?${params}`;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async getValidToken(): Promise<string> {
    // Return cached token if it has enough lifetime remaining
    if (this.cache && this.cache.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
      return this.cache.accessToken;
    }

    // Attempt silent refresh using existing refresh token
    if (this.cache?.refreshToken) {
      try {
        await this.refreshAccessToken(this.cache.refreshToken);
        return this.cache!.accessToken;
      } catch (err) {
        logger.warn("OAuth token refresh failed; will attempt re-authorization", {
          error: err instanceof Error ? err.message : String(err),
        });
        this.cache = null;
      }
    }

    // Exchange authorization code (non-interactive flow)
    const authCode = process.env.ADO_AUTH_CODE;
    if (!authCode) {
      const authUrl = this.getAuthorizationUrl(
        process.env.ADO_OAUTH_REDIRECT_URI ?? DEFAULT_REDIRECT_URI,
      );
      throw new AuthenticationError(
        `No valid OAuth token available. Authorize the application by visiting:\n` +
          `  ${authUrl}\n` +
          `Then set ADO_AUTH_CODE=<code> and restart the server.`,
      );
    }

    await this.exchangeAuthCode(authCode);
    return this.cache!.accessToken;
  }

  private async exchangeAuthCode(code: string): Promise<void> {
    const redirectUri = process.env.ADO_OAUTH_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      scope: ADO_SCOPE,
    });
    await this.fetchAndCacheToken(body);
  }

  private async refreshAccessToken(refreshToken: string): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: ADO_SCOPE,
    });
    await this.fetchAndCacheToken(body);
  }

  private async fetchAndCacheToken(body: URLSearchParams): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new AuthenticationError(
        `OAuth token request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      logger.warn("OAuth token endpoint returned an error", { status: response.status });
      throw new AuthenticationError(`OAuth token request failed (HTTP ${response.status})`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new AuthenticationError("OAuth token response was not valid JSON");
    }

    if (!isTokenResponse(data)) {
      throw new AuthenticationError("OAuth token response is missing required fields");
    }

    this.cache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1_000,
    };

    logger.info("OAuth access token acquired/refreshed successfully");
  }
}

function isTokenResponse(data: unknown): data is TokenResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "access_token" in data &&
    typeof (data as Record<string, unknown>).access_token === "string" &&
    "expires_in" in data &&
    typeof (data as Record<string, unknown>).expires_in === "number"
  );
}
